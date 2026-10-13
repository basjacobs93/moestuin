// Tekent de plattegrond, tijdlijn, taken en hoeveelheden uit het plan van planner.js.
(function () {
  const P = window.Planner;
  const $ = (s) => document.querySelector(s);

  // Testen met een andere datum: index.html?vandaag=2027-05-01 (en eventueel &modus=datum).
  // index.html?concept toont het concept uit de editor in plaats van tuin.yaml.
  const zoek = new URLSearchParams(location.search);
  const param = zoek.get('vandaag');
  const CONCEPT = zoek.has('concept');
  const VANDAAG = param ? P.leesDatum(param) : P.vandaag();

  let plan;
  let familieKleur = {};
  const staat = { modus: 'seizoen', datum: VANDAAG, gekozen: null };

  // ---------- hulpjes ----------

  const el = Tekening.el;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const kort = (d) => P.fmtDatum(d, { day: 'numeric', month: 'short' });
  const lang = (d) => P.fmtDatum(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const getal = (n, dec = 0) => n.toLocaleString('nl-NL', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  const kleur = (t) => familieKleur[t.gewas.familie] || 'var(--s-overig)';

  function opslag(sleutel, waarde) {
    try {
      if (waarde === undefined) return JSON.parse(localStorage.getItem(sleutel) || 'null');
      localStorage.setItem(sleutel, JSON.stringify(waarde));
    } catch (_) { return null; }
  }
  const klaar = new Set(opslag('moestuin-klaar') || []);

  const tooltip = $('#tooltip');
  function toonTip(e, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }
  const verbergTip = () => { tooltip.hidden = true; };

  // ---------- laden ----------

  async function laad() {
    try {
      const [tuinTxt, gewTxt] = await Promise.all(['tuin.yaml', 'gewassen.yaml'].map(async (f) => {
        if (f === 'tuin.yaml' && CONCEPT) {
          const concept = opslag('moestuin-concept');
          if (concept) return ['concept uit de editor', concept.yaml];
        }
        const r = await fetch(f, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`Kan ${f} niet laden (${r.status}).`);
        return [f, await r.text()];
      }));
      if (CONCEPT && tuinTxt[0] !== 'tuin.yaml') $('#concept').hidden = false;
      const lees = ([f, txt]) => {
        try { return jsyaml.load(txt) || {}; } catch (e) { throw new Error(`Fout in ${f}:\n${e.message}`); }
      };
      plan = P.bouwPlan(lees(tuinTxt), lees(gewTxt));
    } catch (e) {
      const f = $('#fout');
      f.hidden = false;
      f.textContent = location.protocol === 'file:'
        ? 'Open deze pagina via een webserver, bijv. `python3 -m http.server` in deze map, en ga naar http://localhost:8000.'
        : e.message;
      return;
    }

    familieKleur = Tekening.familieKleuren(plan.families);

    const { tuin } = plan;
    document.title = `${tuin.naam} · moestuinplanner`;
    $('#titel').textContent = tuin.naam;
    $('#ondertitel').textContent = `Seizoen ${tuin.jaar} · ${getal(tuin.lengte, 1)} × ${getal(tuin.breedte, 1)} m · ${plan.teelten.length} teelten · ${plan.taken.length} taken`;

    if (plan.waarschuwingen.length) {
      const w = $('#waarschuwingen');
      w.hidden = false;
      w.querySelector('summary').textContent = `⚠️ ${plan.waarschuwingen.length} aandachtspunt${plan.waarschuwingen.length > 1 ? 'en' : ''} in je plan`;
      w.querySelector('ul').replaceChildren(...plan.waarschuwingen.map((t) => el('li', { tekst: t })));
    }

    initPlattegrond();
    tekenNu();
    tekenTaken();
    tekenTabel();
    tekenAlles();
    let timer;
    addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(tekenAlles, 150); });
  }

  function tekenAlles() {
    tekenPlattegrond();
    tekenGantt();
  }

  // ---------- nu ----------

  function tekenNu() {
    const van = P.plusDagen(VANDAAG, -7);
    const tot = P.plusDagen(VANDAAG, 21);
    let lijst = plan.taken.filter((t) => t.datum >= van && t.datum <= tot && !(t.datum < VANDAAG && klaar.has(t.id)));
    let uitleg = `Van een week geleden tot drie weken vooruit (vandaag is het ${lang(VANDAAG)}, week ${P.weekNummer(VANDAAG)}).`;
    if (!lijst.length) {
      lijst = plan.taken.filter((t) => t.datum >= VANDAAG).slice(0, 5);
      uitleg = lijst.length ? 'De komende weken is er niets gepland. Dit zijn de eerstvolgende taken:' : 'Er staan geen taken meer gepland.';
    }
    $('#nu-uitleg').textContent = uitleg;
    $('#nu-lijst').replaceChildren(...lijst.map(taakRegel));
  }

  function taakRegel(t) {
    const zelfdeWeek = P.weekNummer(t.datum) === P.weekNummer(VANDAAG) && Math.abs(t.datum - VANDAAG) < 7 * 864e5;
    const li = el('li', { class: [klaar.has(t.id) && 'klaar', zelfdeWeek && 'deze-week'].filter(Boolean).join(' ') });
    const vink = el('input', { type: 'checkbox', 'aria-label': 'afgevinkt' });
    vink.checked = klaar.has(t.id);
    vink.addEventListener('change', () => {
      vink.checked ? klaar.add(t.id) : klaar.delete(t.id);
      opslag('moestuin-klaar', [...klaar]);
      document.querySelectorAll(`[data-taak="${CSS.escape(t.id)}"]`).forEach((r) => {
        r.classList.toggle('klaar', vink.checked);
        r.querySelector('input').checked = vink.checked;
      });
      if ($('#verberg-klaar').checked) tekenTaken();
    });
    li.dataset.taak = t.id;
    li.append(
      vink,
      el('span', { class: 'datum', tekst: P.fmtDatum(t.datum, { weekday: 'short', day: 'numeric', month: 'short' }) }),
      el('span', { tekst: t.icoon, title: t.soort }),
      el('span', {}, el('span', { class: 'tekst', tekst: t.teelt ? `${t.teelt.gewas.emoji} ${t.tekst}` : t.tekst }), t.plek ? el('span', { class: 'plek', tekst: ` · ${t.plek}` }) : null),
    );
    return li;
  }

  // ---------- plattegrond ----------

  function weekStarts() {
    const lijst = [];
    let d = P.plusDagen(plan.bereik.begin, -((plan.bereik.begin.getUTCDay() + 6) % 7));
    while (d < plan.bereik.eind) { lijst.push(d); d = P.plusDagen(d, 7); }
    return lijst;
  }

  function initPlattegrond() {
    const weken = weekStarts();
    const schuif = $('#schuif');
    schuif.max = weken.length - 1;
    let i = weken.findIndex((w) => P.plusDagen(w, 7) > VANDAAG);
    if (i < 0 || VANDAAG < plan.bereik.begin) i = weken.findIndex((w) => w.getUTCFullYear() === plan.tuin.jaar && w.getUTCMonth() >= 5);
    schuif.value = Math.max(0, i);
    staat.datum = weken[schuif.value];

    const zetDatumLabel = () => {
      $('#schuif-datum').textContent = staat.modus === 'datum'
        ? `week ${P.weekNummer(staat.datum)} · ${kort(staat.datum)} ${staat.datum.getUTCFullYear()}`
        : '';
    };
    schuif.addEventListener('input', () => {
      staat.datum = weken[+schuif.value];
      zetDatumLabel();
      tekenPlattegrond();
    });
    document.querySelectorAll('.segment button').forEach((b) => b.addEventListener('click', () => {
      staat.modus = b.dataset.modus;
      document.querySelectorAll('.segment button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      schuif.disabled = staat.modus !== 'datum';
      zetDatumLabel();
      tekenPlattegrond();
    }));

    if (new URLSearchParams(location.search).get('modus') === 'datum') document.querySelector('[data-modus="datum"]').click();

    const gebruikt = new Set(plan.teelten.map((t) => t.gewas.familie));
    $('#legenda').replaceChildren(...Object.entries(plan.families)
      .filter(([k]) => gebruikt.has(k))
      .map(([k, f]) => el('span', {}, el('i', { style: `background:${familieKleur[k]}` }), f.naam)));
  }

  function tekenPlattegrond() {
    Tekening.plattegrond($('#plan'), plan, {
      modus: staat.modus, datum: staat.datum, kleuren: familieKleur,
      gekozenStrook: staat.gekozen, onStrook: kiesStrook,
    });
  }

  function kiesStrook(strook) {
    staat.gekozen = strook.id;
    tekenPlattegrond();
    const d = $('#detail');
    d.replaceChildren(el('h3', { tekst: `${strook.bed} · strook ${getal(strook.lengte, 2)} × ${getal(strook.breedte, 2)} m` }));
    d.append(el('div', { class: 'teelten' }, strook.teelten.map(teeltDetail)));
  }

  function teeltDetail(t) {
    const g = t.gewas;
    const rijen = [];
    const methode = { zaaien: 'direct zaaien', voorzaaien: 'binnen voorzaaien', poten: 'poten', planten: t.plantgoed ? 'plantjes kopen' : 'planten', vast: 'vaste plant, staat er al' }[t.methode];
    rijen.push(['Familie', plan.families[g.familie].naam]);
    rijen.push(['Methode', methode]);
    if (t.binnen) rijen.push(['Voorzaaien', lang(t.binnen)]);
    if (t.methode !== 'vast') rijen.push([t.methode === 'voorzaaien' || t.methode === 'planten' ? 'Uitplanten' : t.methode === 'poten' ? 'Poten' : 'Zaaien', lang(t.grond)]);
    rijen.push([g.oogstLabel || 'Oogst', `${kort(t.oogstStart)} – ${kort(t.oogstEind)}`]);
    rijen.push(['Afstand', g.breedwerpig ? 'breedwerpig' : `${g.rij} × ${g.plant} cm (${t.rijen} rij${t.rijen > 1 ? 'en' : ''})`]);
    if (t.aantal) rijen.push(['Planten', getal(t.aantal)]);
    if (t.zaad) rijen.push(['Nodig', `${getal(t.zaad.aantal)} ${t.zaad.eenheid}`]);
    if (t.opbrengst) rijen.push(['Opbrengst', `± ${getal(t.opbrengst.hoeveel, 1)} ${t.opbrengst.eenheid}`]);
    return el('div', { class: 'teelt' },
      el('strong', { tekst: `${g.emoji} ${g.naam}${t.herhaling ? ` (zaaiing ${t.herhaling})` : ''}${t.isNateelt ? ' · nateelt' : ''}` }),
      el('dl', {}, rijen.flatMap(([a, b]) => [el('dt', { tekst: a }), el('dd', { tekst: b })])),
      t.notitie ? el('p', { class: 'tip', tekst: `📝 ${t.notitie}` }) : null,
      g.tip ? el('p', { class: 'tip', tekst: `💡 ${g.tip}` }) : null,
    );
  }

  // ---------- tijdlijn ----------

  function tekenGantt() {
    const doos = $('#gantt');
    const { begin, eind } = plan.bereik;
    const labelB = 190;
    const breed = Math.max(720, doos.clientWidth || 900);
    const plotB = breed - labelB - 12;
    const rijH = 24;
    const kopH = 26;
    const rijen = plan.teelten;
    const H = kopH + rijen.length * rijH + 8;
    const x = (d) => labelB + ((d - begin) / (eind - begin)) * plotB;

    const svg = el('svg', { width: breed, height: H, role: 'img', 'aria-label': 'Tijdlijn van alle teelten' });
    svg.append(el('defs', {}, el('pattern', { id: 'arcering', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      el('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: 'var(--tekst-3)', 'stroke-width': 2 })),
      el('clipPath', { id: 'labelkolom' }, el('rect', { x: 0, y: 0, width: labelB - 8, height: H }))));

    // maanden
    let d = P.utc(begin.getUTCFullYear(), begin.getUTCMonth() + 1, 1);
    let i = 0;
    while (d < eind) {
      const volgende = P.utc(d.getUTCFullYear(), d.getUTCMonth() + 2, 1);
      if (i++ % 2 === 0) svg.append(el('rect', { x: x(d), y: kopH, width: x(volgende) - x(d), height: H - kopH, fill: 'var(--bg)' }));
      const label = P.MAANDEN[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : '');
      svg.append(el('text', { x: (x(d) + x(volgende)) / 2, y: 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--tekst-2)', tekst: label }));
      d = volgende;
    }

    let vorigBed = null;
    rijen.forEach((t, r) => {
      const y = kopH + r * rijH;
      if (t.strook.bed !== vorigBed) {
        if (vorigBed !== null) svg.append(el('line', { x1: 0, x2: breed, y1: y, y2: y, stroke: 'var(--lijn)' }));
        vorigBed = t.strook.bed;
        svg.append(el('text', { x: 0, y: y + 16, 'font-size': 11, 'font-weight': 600, fill: 'var(--tekst-3)', tekst: t.strook.bed }));
      }
      svg.append(el('text', { x: 58, y: y + 16, 'font-size': 12, fill: 'var(--tekst)', 'clip-path': 'url(#labelkolom)', tekst: `${t.gewas.emoji} ${t.gewas.naam}${t.herhaling ? ' ' + t.herhaling : ''}` }));

      const g = el('g', {
        onmousemove: (e) => toonTip(e, `<b>${esc(t.gewas.emoji + ' ' + t.gewas.naam)} · ${esc(t.strook.bed)}</b>` +
          (t.binnen ? `<div class="r">voorzaaien ${kort(t.binnen)}</div>` : '') +
          `<div class="r">${t.vast && t.methode === 'vast' ? 'vaste plant' : 'in de grond ' + kort(t.grond)}</div><div class="r">${esc(t.gewas.oogstLabel || 'oogst')} ${kort(t.oogstStart)} – ${kort(t.oogstEind)}</div>`),
        onmouseleave: verbergTip,
      });
      const bh = 12, by = y + (rijH - bh) / 2;
      g.append(el('rect', { x: labelB, y, width: plotB, height: rijH, fill: 'transparent' })); // ruim hover-vlak
      if (t.binnen) g.append(el('rect', { x: x(t.binnen), y: by, width: Math.max(0, x(t.grond) - x(t.binnen) - 2), height: bh, rx: 3, fill: 'url(#arcering)', stroke: 'var(--tekst-3)', 'stroke-width': 1 }));
      g.append(el('rect', { x: x(t.grond), y: by, width: Math.max(0, x(t.oogstStart) - x(t.grond) - 2), height: bh, rx: 3, fill: kleur(t), 'fill-opacity': 0.35 }));
      g.append(el('rect', { x: x(t.oogstStart), y: by, width: Math.max(2, x(t.oogstEind) - x(t.oogstStart)), height: bh, rx: 3, fill: kleur(t) }));
      if (t.vast) g.append(el('rect', { x: x(t.oogstEind) + 2, y: by, width: Math.max(0, x(plan.bereik.eind) - x(t.oogstEind) - 2), height: bh, rx: 3, fill: kleur(t), 'fill-opacity': 0.35 }));
      svg.append(g);
    });

    if (VANDAAG >= begin && VANDAAG <= eind) {
      svg.append(el('line', { x1: x(VANDAAG), x2: x(VANDAAG), y1: kopH - 4, y2: H, stroke: 'var(--vandaag)', 'stroke-width': 2 }));
      svg.append(el('text', { x: x(VANDAAG) + 4, y: H - 4, 'font-size': 10, fill: 'var(--vandaag)', tekst: 'vandaag' }));
    }
    doos.replaceChildren(svg);
  }

  // ---------- takenkalender ----------

  function tekenTaken() {
    const verledenWeg = $('#verberg-verleden').checked;
    const klaarWeg = $('#verberg-klaar').checked;
    const weekBegin = P.plusDagen(VANDAAG, -((VANDAAG.getUTCDay() + 6) % 7));
    const lijst = plan.taken.filter((t) => !(verledenWeg && t.datum < weekBegin) && !(klaarWeg && klaar.has(t.id)));
    const doos = $('#takenkalender');
    if (!lijst.length) { doos.replaceChildren(el('p', { class: 'leeg', tekst: 'Geen taken om te tonen.' })); return; }
    const perMaand = new Map();
    for (const t of lijst) {
      const k = P.fmtDatum(t.datum, { month: 'long', year: 'numeric' });
      if (!perMaand.has(k)) perMaand.set(k, []);
      perMaand.get(k).push(t);
    }
    doos.replaceChildren(...[...perMaand].flatMap(([maand, taken]) => [
      el('h3', { class: 'maand', tekst: maand }),
      el('ul', { class: 'takenlijst' }, taken.map(taakRegel)),
    ]));
  }
  $('#verberg-verleden').addEventListener('change', tekenTaken);
  $('#verberg-klaar').addEventListener('change', tekenTaken);

  $('#ics').addEventListener('click', () => {
    const stempel = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const icsTekst = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const dag = (d) => P.iso(d).replace(/-/g, '');
    const regels = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//moestuinplanner//NL', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsTekst(plan.tuin.naam)}`];
    for (const t of plan.taken) {
      const tip = t.teelt && t.teelt.gewas.tip ? `\n${t.teelt.gewas.tip}` : '';
      regels.push('BEGIN:VEVENT',
        `UID:${t.id.replace(/\s+/g, '_')}@moestuinplanner`,
        `DTSTAMP:${stempel}`,
        `DTSTART;VALUE=DATE:${dag(t.datum)}`,
        `DTEND;VALUE=DATE:${dag(P.plusDagen(t.datum, 1))}`,
        `SUMMARY:${icsTekst(`${t.icoon} ${t.tekst}`)}`,
        `DESCRIPTION:${icsTekst((t.plek ? `Plek: ${t.plek}` : '') + tip)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    }
    regels.push('END:VCALENDAR');
    const blob = new Blob([regels.join('\r\n')], { type: 'text/calendar' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `moestuin-${plan.tuin.jaar}.ics` });
    document.body.append(a);
    a.click();
    a.remove();
  });

  // ---------- hoeveelheden ----------

  function tekenTabel() {
    const kop = el('tr', {}, ['Gewas', 'Teelten', 'Oppervlakte', 'Planten', 'Zaad / plantgoed', 'Verwachte oogst', 'Eerste actie']
      .map((t, i) => el('th', { class: i > 0 && i < 6 ? 'getal' : null, tekst: t })));
    const rijen = plan.totalen.map((s) => el('tr', {},
      el('td', {}, el('span', { class: 'bolletje', style: `background:${familieKleur[s.gewas.familie]}` }), `${s.gewas.emoji} ${s.gewas.naam}`),
      el('td', { class: 'getal', tekst: s.teelten }),
      el('td', { class: 'getal', tekst: `${getal(s.oppervlakte, 1)} m²` }),
      el('td', { class: 'getal', tekst: s.aantal ? getal(s.aantal) : '–' }),
      el('td', { class: 'getal', tekst: s.zaad ? `${getal(s.zaad.aantal)} ${s.zaad.eenheid}` : '–' }),
      el('td', { class: 'getal', tekst: s.opbrengst ? `± ${getal(s.opbrengst.hoeveel, 1)} ${s.opbrengst.eenheid}` : '–' }),
      el('td', { tekst: lang(s.eerste) }),
    ));
    const totaal = plan.totalen.reduce((a, s) => a + s.oppervlakte, 0);
    const tuinOpp = plan.tuin.lengte * plan.tuin.breedte;
    $('#tabel').replaceChildren(
      el('thead', {}, kop),
      el('tbody', {}, rijen),
      el('tfoot', {}, el('tr', {},
        el('th', { tekst: 'Totaal beteeld' }), el('td'),
        el('td', { class: 'getal', tekst: `${getal(totaal, 1)} m²` }),
        el('td', { colspan: 4, tekst: `van ${getal(tuinOpp)} m² tuin (met nateelten telt een strook dubbel)` }))),
    );
  }

  laad();
})();
