// Editor voor tuin.yaml: formulier + sleepbare plattegrond + YAML, met live voorbeeld.
(function () {
  const P = window.Planner;
  const T = window.Tekening;
  const el = T.el;
  const $ = (s) => document.querySelector(s);
  const CONCEPT = 'moestuin-concept';
  const SCHEMA = { schema: jsyaml.CORE_SCHEMA }; // datums blijven tekst, zoals je ze typt

  let gewassenDoc;      // gewassen.yaml
  let doc;              // de tuin die we bewerken (zelfde structuur als tuin.yaml)
  let plan = null;      // laatste geslaagde berekening
  let kleuren = {};
  let gekozenBed = null;
  let laatsteYaml = ''; // YAML van de huidige toestand
  let opgeslagenYaml = '';
  let bestand = null;   // bestandskoppeling (File System Access API), als de browser dat kan
  const ongedaan = [];
  const openBedden = new Set();
  const openTeelten = new WeakSet();
  const infoVan = new WeakMap(); // teelt-object -> element voor de berekende info

  const kort = (d) => P.fmtDatum(d, { day: 'numeric', month: 'short' });
  const getal = (n, dec = 2) => n.toLocaleString('nl-NL', { maximumFractionDigits: dec });
  const rond = (v) => Math.round(v * 100) / 100;

  function opslag(sleutel, waarde) {
    try {
      if (waarde === undefined) return JSON.parse(localStorage.getItem(sleutel) || 'null');
      if (waarde === null) localStorage.removeItem(sleutel);
      else localStorage.setItem(sleutel, JSON.stringify(waarde));
    } catch (_) { return null; }
  }

  // ---------- YAML lezen en schrijven ----------

  function lees(tekst) {
    const d = jsyaml.load(tekst, SCHEMA) || {};
    if (typeof d !== 'object' || Array.isArray(d)) throw new Error('tuin.yaml moet beginnen met tuin:, bedden: enzovoort.');
    d.tuin = d.tuin || {};
    d.bedden = (d.bedden || []).map((b) => ({
      ...b,
      positie: Array.isArray(b.positie) ? b.positie : [0, 0],
      maat: Array.isArray(b.maat) ? b.maat : [1.2, 3],
      teelt: (b.teelt || []).map((t) => {
        const o = typeof t === 'string' ? { gewas: t } : { ...t };
        if (o.daarna) o.daarna = o.daarna.map((n) => (typeof n === 'string' ? { gewas: n } : { ...n }));
        return o;
      }),
    }));
    d.taken = d.taken || [];
    return d;
  }

  const KOP = `# Mijn moestuin. Gemaakt met editor.html; je kunt dit bestand ook met de hand bewerken.
# Gewassen staan in gewassen.yaml.
#
# Coördinaten in meters vanaf linksboven: x langs de lengte, y langs de breedte.
# Bed:   positie [x, y] (linkerbovenhoek), maat [breed, hoog], soort (bed/kas/compost/pad/overig)
# Teelt: gewas, deel (strooklengte in m, weglaten = rest), datum (2027-04-15, 04-15 of week 15),
#        plantgoed (plantjes kopen), herhaal + elke (gespreid zaaien), daarna (nateelten), notitie
# Vorige jaren (voor de wisselteelt): vorige_jaren > jaar > bednaam > lijst teelten
`;

  const flow = (v) => jsyaml.dump(v, { ...SCHEMA, flowLevel: 0, lineWidth: -1 }).trim();
  const leeg = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

  function schoonTeelt(t) {
    const o = {};
    for (const [k, v] of Object.entries(t)) {
      if (leeg(v) || (k === 'plantgoed' && !v)) continue;
      o[k] = k === 'daarna' ? v.map((n) => (Object.keys(schoonTeelt(n)).length === 1 && n.gewas ? n.gewas : schoonTeelt(n))) : v;
    }
    if (!o.herhaal || o.herhaal <= 1) { delete o.herhaal; delete o.elke; }
    return o;
  }

  function naarYaml(d) {
    const r = [KOP, 'tuin:'];
    for (const [k, v] of Object.entries(d.tuin)) if (!leeg(v)) r.push(`  ${k}: ${flow(v)}`);
    r.push('', 'bedden:');
    const vast = ['naam', 'soort', 'positie', 'maat', 'notitie'];
    for (const b of d.bedden) {
      const sleutels = [...vast, ...Object.keys(b).filter((k) => !vast.includes(k) && k !== 'teelt')];
      let eerste = true;
      for (const k of sleutels) {
        if (leeg(b[k]) || (k === 'soort' && b[k] === 'bed')) continue;
        r.push(`${eerste ? '  - ' : '    '}${k}: ${flow(b[k])}`);
        eerste = false;
      }
      const teelt = b.teelt.filter((t) => t.gewas).map(schoonTeelt);
      if (teelt.length) {
        r.push(`${eerste ? '  - ' : '    '}teelt:`);
        for (const t of teelt) r.push(`      - ${flow(t)}`);
      } else if (eerste) r.push('  - {}');
      r.push('');
    }
    const taken = d.taken.filter((t) => t.datum || t.wat);
    if (taken.length) {
      r.push('taken:');
      for (const t of taken) r.push(`  - ${flow({ datum: t.datum, wat: t.wat })}`);
      r.push('');
    }
    const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !['tuin', 'bedden', 'taken'].includes(k)));
    if (Object.keys(rest).length) r.push(jsyaml.dump(rest, { ...SCHEMA, lineWidth: -1 }));
    return r.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  // ---------- laden ----------

  async function laad() {
    let bestandTekst;
    try {
      const [t, g] = await Promise.all(['tuin.yaml', 'gewassen.yaml'].map(async (f) => {
        const r = await fetch(f, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`Kan ${f} niet laden (${r.status}).`);
        return r.text();
      }));
      bestandTekst = t;
      gewassenDoc = jsyaml.load(g) || {};
      opgeslagenYaml = naarYaml(lees(bestandTekst));
    } catch (e) {
      const f = $('#fout');
      f.hidden = false;
      f.textContent = location.protocol === 'file:'
        ? 'Open deze pagina via een webserver, bijv. `python3 -m http.server` in deze map, en ga naar http://localhost:8000/editor.html.'
        : e.message;
      return;
    }

    const concept = opslag(CONCEPT);
    if (concept && concept.yaml && concept.yaml !== opgeslagenYaml) {
      try {
        doc = lees(concept.yaml);
        meld(`Je niet-opgeslagen wijzigingen van ${new Date(concept.tijd).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })} zijn teruggezet.`);
      } catch (_) { doc = null; }
    }
    if (!doc) doc = lees(bestandTekst);
    laatsteYaml = naarYaml(doc);

    if (!('showSaveFilePicker' in window)) $('#opslaan').hidden = true;
    herbereken();
    tekenFormulier();
    ververs();
    let timer;
    addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(tekenPlan, 150); });
  }

  function meld(tekst) {
    const m = $('#melding');
    m.hidden = !tekst;
    m.textContent = tekst || '';
  }

  // ---------- wijzigingen verwerken ----------

  let wachtrij;
  // Na elke wijziging: opnieuw rekenen en tekenen (kort uitgesteld tijdens typen).
  function gewijzigd(direct = false) {
    clearTimeout(wachtrij);
    if (direct) vastleggen();
    else wachtrij = setTimeout(vastleggen, 250);
  }

  function vastleggen() {
    const yaml = naarYaml(doc);
    if (yaml !== laatsteYaml) {
      ongedaan.push(laatsteYaml);
      if (ongedaan.length > 100) ongedaan.shift();
      laatsteYaml = yaml;
    }
    herbereken();
    ververs();
  }

  function herbereken() {
    try {
      plan = P.bouwPlan(doc, gewassenDoc);
      kleuren = T.familieKleuren(plan.families);
      $('#fout').hidden = true;
    } catch (e) {
      $('#fout').hidden = false;
      $('#fout').textContent = e.message;
    }
  }

  function ververs() {
    tekenPlan();
    tekenInfo();
    const ta = $('#yaml');
    if (document.activeElement !== ta) ta.value = laatsteYaml;
    $('#ongedaan').disabled = !ongedaan.length;
    const gewijzigd = laatsteYaml !== opgeslagenYaml;
    opslag(CONCEPT, gewijzigd ? { yaml: laatsteYaml, tijd: Date.now() } : null);
    $('#status').textContent = gewijzigd
      ? 'Niet opgeslagen. Je wijzigingen staan wel veilig in deze browser.'
      : 'Alles opgeslagen ✓';
    $('#status').classList.toggle('vies', gewijzigd);
  }

  // ---------- voorbeeld ----------

  function tekenPlan() {
    if (!plan) return;
    T.plattegrond($('#plan'), plan, {
      modus: 'seizoen', kleuren, gekozenBed,
      onBed: (bed) => kiesBed(bed.index, true),
      onVerplaats: verplaatsBed,
    });
    const gebruikt = new Set(plan.teelten.map((t) => t.gewas.familie));
    $('#legenda').replaceChildren(...Object.entries(plan.families)
      .filter(([k]) => gebruikt.has(k))
      .map(([k, f]) => el('span', {}, el('i', { style: `background:${kleuren[k]}` }), f.naam)));

    const beteeld = plan.bedden.reduce((s, b) => s + (b.soort === 'bed' ? b.w * b.h : 0), 0);
    $('#samenvatting').textContent = `${plan.bedden.length} bedden · ${getal(beteeld, 1)} m² bed op ${getal(plan.tuin.lengte * plan.tuin.breedte, 1)} m² tuin · ${plan.teelten.length} teelten · ${plan.taken.length} taken`;
    $('#waarschuwingen').replaceChildren(...plan.waarschuwingen.map((w) => el('li', { tekst: `⚠️ ${w}` })));
  }

  function verplaatsBed(bed, x, y) {
    const b = doc.bedden[bed.index];
    const snap = (v) => Math.round(v * 20) / 20;
    b.positie = [
      rond(Math.min(Math.max(0, snap(x)), Math.max(0, (doc.tuin.lengte || 0) - b.maat[0]))),
      rond(Math.min(Math.max(0, snap(y)), Math.max(0, (doc.tuin.breedte || 0) - b.maat[1]))),
    ];
    gekozenBed = bed.index;
    openBedden.add(b);
    tekenFormulier();
    gewijzigd(true);
  }

  function kiesBed(i, scroll) {
    gekozenBed = i;
    const b = doc.bedden[i];
    openBedden.add(b);
    tekenFormulier();
    tekenPlan();
    if (scroll) {
      const kaart = document.querySelector(`[data-bed="${i}"]`);
      if (kaart) kaart.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Berekende data per teelt in het formulier.
  function tekenInfo() {
    if (!plan) return;
    const per = new Map();
    for (const t of plan.teelten) {
      if (!t.bron) continue;
      if (!per.has(t.bron)) per.set(t.bron, []);
      per.get(t.bron).push(t);
    }
    document.querySelectorAll('[data-info]').forEach((e) => { e.textContent = ''; });
    for (const [bron, lijst] of per) {
      const doel = infoVan.get(bron);
      if (!doel) continue;
      const t = lijst[0];
      const delen = [];
      if (t.binnen) delen.push(`🏠 ${kort(t.binnen)}`);
      delen.push(t.methode === 'vast' ? 'vaste plant' : `${{ zaaien: '🌱', poten: '🫳' }[t.methode] || '🪴'} ${kort(t.grond)}`);
      delen.push(`🧺 ${kort(t.oogstStart)} – ${kort(t.oogstEind)}`);
      const aantal = lijst.reduce((s, x) => s + (x.aantal || 0), 0);
      if (aantal) delen.push(`${aantal} planten`);
      if (lijst.length > 1) delen.push(`${lijst.length} zaaiingen: ${lijst.map((x) => kort(x.binnen || x.grond)).join(', ')}`);
      doel.textContent = delen.join(' · ');
    }
  }

  // ---------- formulier ----------

  function tekenFormulier() {
    const f = $('#formulier');
    const scroll = f.scrollTop;
    f.replaceChildren(
      tuinKaart(),
      el('h2', { class: 'kopje' }, 'Bedden'),
      ...doc.bedden.map(bedKaart),
      el('button', { type: 'button', class: 'knop toevoegen', onclick: nieuwBed, tekst: '+ Bed toevoegen' }),
      takenKaart(),
    );
    f.scrollTop = scroll;
    tekenInfo();
  }

  // Een invoerveld dat direct naar doc schrijft.
  function veld(obj, sleutel, o = {}) {
    const input = el('input', {
      type: 'text', inputmode: o.getal ? 'decimal' : null, placeholder: o.placeholder || '',
      class: o.klasse || null, 'aria-label': o.label, title: o.titel || null,
    });
    const v = obj[sleutel];
    input.value = v == null ? '' : o.getal ? String(v).replace('.', ',') : String(v);
    input.addEventListener('input', () => {
      const ruw = input.value.trim();
      let w = ruw;
      if (o.getal) {
        w = ruw === '' ? undefined : Number(ruw.replace(',', '.'));
        if (w !== undefined && !Number.isFinite(w)) { input.classList.add('ongeldig'); return; }
        if (w !== undefined && o.geheel) w = Math.round(w);
      }
      input.classList.remove('ongeldig');
      if (w === undefined || w === '') {
        if (o.verplicht) { input.classList.add('ongeldig'); return; }
        if (Array.isArray(obj)) return;
        delete obj[sleutel];
      } else obj[sleutel] = w;
      if (o.na) o.na();
      gewijzigd();
    });
    return o.label && !o.zonderLabel ? el('label', { class: 'veld' }, el('span', { tekst: o.label }), input, o.eenheid ? el('small', { tekst: o.eenheid }) : null) : input;
  }

  function knopje(tekst, titel, actie, extra = '') {
    return el('button', { type: 'button', class: `mini ${extra}`, title: titel, 'aria-label': titel, onclick: actie, tekst });
  }

  function tuinKaart() {
    const t = doc.tuin;
    return el('section', { class: 'kaart' },
      el('h2', { tekst: 'Tuin' }),
      el('div', { class: 'velden' },
        el('label', { class: 'veld breed' }, el('span', { tekst: 'Naam' }), veld(t, 'naam', { label: 'Naam', zonderLabel: true })),
        veld(t, 'lengte', { label: 'Lengte', getal: true, eenheid: 'm', verplicht: true }),
        veld(t, 'breedte', { label: 'Breedte', getal: true, eenheid: 'm', verplicht: true }),
        veld(t, 'jaar', { label: 'Seizoen', getal: true, geheel: true, verplicht: true }),
      ),
    );
  }

  function gewasKeuze(obj, na) {
    const s = el('select', { 'aria-label': 'Gewas' });
    const gewassen = plan ? plan.gewassen : {};
    const families = plan ? plan.families : {};
    if (!obj.gewas) s.append(el('option', { value: '', tekst: 'Kies een gewas…' }));
    if (obj.gewas && !gewassen[obj.gewas]) s.append(el('option', { value: obj.gewas, tekst: `⚠️ ${obj.gewas} (onbekend)` }));
    for (const [fk, f] of Object.entries(families)) {
      const lijst = Object.values(gewassen).filter((g) => g.familie === fk).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
      if (lijst.length) s.append(el('optgroup', { label: f.naam }, lijst.map((g) => el('option', { value: g.sleutel, tekst: `${g.emoji} ${g.naam}` }))));
    }
    s.value = obj.gewas || '';
    s.addEventListener('change', () => {
      obj.gewas = s.value;
      if (na) na();
      gewijzigd(true);
    });
    return s;
  }

  function verschuif(lijst, i, d) {
    const j = i + d;
    if (j < 0 || j >= lijst.length) return;
    [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
    tekenFormulier();
    gewijzigd(true);
  }

  function verwijder(lijst, i) {
    lijst.splice(i, 1);
    tekenFormulier();
    gewijzigd(true);
  }

  function bedKaart(b, i) {
    const L = Math.max(...b.maat);
    const gebruikt = b.teelt.reduce((s, t) => s + (Number(t.deel) || 0), 0);
    const rest = b.teelt.filter((t) => !t.deel).length;
    let ruimte = '';
    if (b.teelt.length) {
      ruimte = rest
        ? `${getal(gebruikt)} m vast, ${getal(Math.max(0, L - gebruikt))} m verdeeld over ${rest} ${rest > 1 ? 'stroken' : 'strook'}`
        : `${getal(gebruikt)} van ${getal(L)} m in gebruik`;
    }

    const kaart = el('details', { class: 'kaart bed-kaart' + (gekozenBed === i ? ' gekozen' : ''), 'data-bed': i });
    kaart.open = openBedden.has(b);
    kaart.addEventListener('toggle', () => {
      if (kaart.open) { openBedden.add(b); if (gekozenBed !== i) { gekozenBed = i; tekenPlan(); document.querySelectorAll('.bed-kaart.gekozen').forEach((k) => k.classList.remove('gekozen')); kaart.classList.add('gekozen'); } }
      else openBedden.delete(b);
    });

    const gewasNamen = b.teelt.filter((t) => t.gewas).map((t) => (plan && plan.gewassen[t.gewas] ? plan.gewassen[t.gewas].emoji : '•')).join(' ');
    kaart.append(el('summary', {},
      el('strong', { tekst: b.naam || `Bed ${i + 1}` }),
      el('span', { class: 'samenvat', tekst: ` ${getal(b.maat[0])} × ${getal(b.maat[1])} m${b.soort && b.soort !== 'bed' ? ' · ' + b.soort : ''}` }),
      el('span', { class: 'emojis', tekst: gewasNamen }),
    ));

    const soort = el('select', { 'aria-label': 'Soort' }, ['bed', 'kas', 'compost', 'pad', 'overig'].map((s) => el('option', { value: s, tekst: s })));
    soort.value = b.soort || 'bed';
    soort.addEventListener('change', () => { b.soort = soort.value; gewijzigd(true); });

    const herteken = () => { kaart.querySelector('summary strong').textContent = b.naam || `Bed ${i + 1}`; };
    kaart.append(
      el('div', { class: 'velden' },
        el('label', { class: 'veld breed' }, el('span', { tekst: 'Naam' }), veld(b, 'naam', { label: 'Naam', zonderLabel: true, na: herteken })),
        el('label', { class: 'veld' }, el('span', { tekst: 'Soort' }), soort),
        veld(b.positie, 0, { label: 'x', getal: true, eenheid: 'm', titel: 'Afstand vanaf de linkerkant' }),
        veld(b.positie, 1, { label: 'y', getal: true, eenheid: 'm', titel: 'Afstand vanaf de bovenkant' }),
        veld(b.maat, 0, { label: 'Breed', getal: true, eenheid: 'm' }),
        veld(b.maat, 1, { label: 'Hoog', getal: true, eenheid: 'm' }),
      ),
      el('div', { class: 'bed-acties' },
        knopje('⟲ Draaien', 'Breedte en hoogte omwisselen', () => { b.maat = [b.maat[1], b.maat[0]]; tekenFormulier(); gewijzigd(true); }),
        knopje('⧉ Dupliceren', 'Bed dupliceren', () => dupliceer(i)),
        knopje('🗑 Verwijderen', 'Bed verwijderen', () => { if (confirm(`${b.naam || 'Dit bed'} verwijderen?`)) { gekozenBed = null; verwijder(doc.bedden, i); } }, 'gevaar'),
        knopje('↑', 'Bed omhoog in de lijst', () => verschuif(doc.bedden, i, -1)),
        knopje('↓', 'Bed omlaag in de lijst', () => verschuif(doc.bedden, i, 1)),
      ),
    );

    if (b.soort === 'bed' || !b.soort || b.teelt.length) {
      kaart.append(
        el('div', { class: 'teelt-kop' },
          el('span', { tekst: 'Teelten, in volgorde langs de lange kant' }),
          el('span', { class: 'ruimte' + (gebruikt > L + 1e-9 ? ' te-vol' : ''), tekst: ruimte })),
        ...b.teelt.map((t, j) => teeltRij(b, t, j)),
        el('button', { type: 'button', class: 'mini toevoegen', tekst: '+ teelt', onclick: () => { b.teelt.push({ gewas: '' }); tekenFormulier(); } }),
      );
    }
    if (b.notitie != null || kaart.open) {
      kaart.append(el('label', { class: 'veld breed notitie' }, el('span', { tekst: 'Notitie' }), veld(b, 'notitie', { label: 'Notitie', zonderLabel: true })));
    }
    return kaart;
  }

  function teeltRij(b, t, j) {
    const g = plan && plan.gewassen[t.gewas];
    const rij = el('div', { class: 'teelt-rij' });
    const info = el('div', { class: 'info', 'data-info': '' });
    infoVan.set(t, info);

    const meer = el('div', { class: 'meer' });
    meer.hidden = !openTeelten.has(t);
    const heeftExtra = t.plantgoed || t.herhaal > 1 || t.notitie; // knop "⋯" krijgt dan een stip

    const plantgoed = el('input', { type: 'checkbox', disabled: !(g && g.methode === 'voorzaaien') || null });
    plantgoed.checked = !!t.plantgoed;
    plantgoed.addEventListener('change', () => { t.plantgoed = plantgoed.checked; gewijzigd(true); });

    meer.append(
      el('label', { class: 'vink', title: 'Alleen bij gewassen die je normaal voorzaait' }, plantgoed, ' plantjes kopen'),
      veld(t, 'herhaal', { label: 'Herhaal', getal: true, geheel: true, eenheid: '×', klasse: 'kort', titel: 'Strook in delen opsplitsen en gespreid zaaien' }),
      veld(t, 'elke', { label: 'Elke', getal: true, geheel: true, eenheid: 'wk', klasse: 'kort', placeholder: '3' }),
      el('label', { class: 'veld breed' }, el('span', { tekst: 'Notitie' }), veld(t, 'notitie', { label: 'Notitie', zonderLabel: true })),
    );

    rij.append(
      el('div', { class: 'teelt-hoofd' },
        gewasKeuze(t, () => tekenFormulier()),
        veld(t, 'deel', { label: 'Lengte (m)', zonderLabel: true, getal: true, placeholder: 'rest', klasse: 'kort', titel: 'Lengte van de strook in meter; leeg = de rest van het bed' }),
        veld(t, 'datum', { label: 'Datum', zonderLabel: true, placeholder: 'auto', klasse: 'datum', titel: 'Bijv. 04-15, 2027-04-15 of week 15; leeg = begin van het zaaivenster' }),
        knopje('⋯', 'Meer opties: plantjes kopen, gespreid zaaien, nateelt, notitie', (e) => {
          meer.hidden = !meer.hidden;
          meer.hidden ? openTeelten.delete(t) : openTeelten.add(t);
          e.currentTarget.classList.toggle('open', !meer.hidden);
        }, (heeftExtra ? 'actief' : '') + (openTeelten.has(t) ? ' open' : '')),
        knopje('↑', 'Strook naar voren', () => verschuif(b.teelt, j, -1)),
        knopje('↓', 'Strook naar achteren', () => verschuif(b.teelt, j, 1)),
        knopje('✕', 'Teelt verwijderen', () => verwijder(b.teelt, j), 'gevaar'),
      ),
      info,
      meer,
    );

    // nateelten
    const daarna = t.daarna || [];
    daarna.forEach((n, k) => {
      const ninfo = el('div', { class: 'info', 'data-info': '' });
      infoVan.set(n, ninfo);
      rij.append(el('div', { class: 'nateelt' },
        el('div', { class: 'teelt-hoofd' },
          el('span', { class: 'pijl', tekst: '→' }),
          gewasKeuze(n),
          veld(n, 'datum', { label: 'Datum', zonderLabel: true, placeholder: 'auto', klasse: 'datum', titel: 'Leeg = zodra de vorige teelt klaar is' }),
          knopje('✕', 'Nateelt verwijderen', () => { daarna.splice(k, 1); if (!daarna.length) delete t.daarna; tekenFormulier(); gewijzigd(true); }, 'gevaar'),
        ),
        ninfo,
      ));
    });
    meer.append(el('button', {
      type: 'button', class: 'mini toevoegen', tekst: '+ nateelt',
      title: 'Komt in dezelfde strook zodra deze teelt klaar is',
      onclick: () => { t.daarna = daarna; daarna.push({ gewas: '' }); tekenFormulier(); },
    }));
    if (g && g.tip) rij.title = g.tip;
    return rij;
  }

  function takenKaart() {
    return el('section', { class: 'kaart' },
      el('h2', { tekst: 'Eigen taken' }),
      el('p', { class: 'uitleg', tekst: 'Taken die niet bij een gewas horen, zoals compost opbrengen.' }),
      ...doc.taken.map((t, i) => el('div', { class: 'teelt-hoofd taak-rij' },
        veld(t, 'datum', { label: 'Datum', zonderLabel: true, placeholder: '03-01', klasse: 'datum' }),
        veld(t, 'wat', { label: 'Wat', zonderLabel: true, placeholder: 'Wat moet er gebeuren?', klasse: 'groot' }),
        knopje('✕', 'Taak verwijderen', () => verwijder(doc.taken, i), 'gevaar'),
      )),
      el('button', { type: 'button', class: 'mini toevoegen', tekst: '+ taak', onclick: () => { doc.taken.push({ datum: '', wat: '' }); tekenFormulier(); } }),
    );
  }

  function nieuwBed() {
    const laatste = doc.bedden.filter((b) => (b.soort || 'bed') === 'bed').pop();
    const maat = laatste ? [...laatste.maat] : [1.2, 3];
    let positie = [0.4, 0.4];
    if (laatste) {
      const x = rond(laatste.positie[0] + laatste.maat[0] + 0.4);
      positie = x + maat[0] <= (doc.tuin.lengte || 0) ? [x, laatste.positie[1]] : [0, 0];
    }
    const b = { naam: `Bed ${doc.bedden.length + 1}`, positie, maat, teelt: [] };
    doc.bedden.push(b);
    gekozenBed = doc.bedden.length - 1;
    openBedden.add(b);
    tekenFormulier();
    gewijzigd(true);
    document.querySelector(`[data-bed="${gekozenBed}"]`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function dupliceer(i) {
    const kopie = lees(naarYaml({ ...doc, bedden: [doc.bedden[i]] })).bedden[0];
    kopie.naam = `${kopie.naam} (kopie)`;
    kopie.positie = [rond(kopie.positie[0] + 0.3), rond(kopie.positie[1] + 0.3)];
    doc.bedden.splice(i + 1, 0, kopie);
    gekozenBed = i + 1;
    openBedden.add(kopie);
    tekenFormulier();
    gewijzigd(true);
  }

  // ---------- YAML-tab ----------

  let yamlTimer;
  $('#yaml').addEventListener('input', () => {
    clearTimeout(yamlTimer);
    yamlTimer = setTimeout(() => {
      const fout = $('#yaml-fout');
      try {
        const nieuw = lees($('#yaml').value);
        P.bouwPlan(nieuw, gewassenDoc); // geeft een foutmelding bij een onbruikbaar plan
        doc = nieuw;
        fout.hidden = true;
        tekenFormulier();
        gewijzigd(true);
      } catch (e) {
        fout.hidden = false;
        fout.textContent = e.message;
      }
    }, 500);
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    document.querySelectorAll('[data-paneel]').forEach((p) => { p.hidden = p.dataset.paneel !== b.dataset.tab; });
    if (b.dataset.tab === 'plan') tekenPlan();
    else $('#yaml').value = laatsteYaml;
  }));

  // ---------- werkbalk ----------

  function maakOngedaan() {
    if (!ongedaan.length) return;
    clearTimeout(wachtrij);
    laatsteYaml = ongedaan.pop();
    doc = lees(laatsteYaml);
    herbereken();
    tekenFormulier();
    ververs();
  }
  $('#ongedaan').addEventListener('click', maakOngedaan);
  addEventListener('keydown', (e) => {
    const inVeld = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inVeld) {
      e.preventDefault();
      maakOngedaan();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      ('showSaveFilePicker' in window ? opslaan : download)();
    }
  });

  function huidigeYaml() {
    clearTimeout(wachtrij);
    vastleggen();
    return laatsteYaml;
  }

  function markeerOpgeslagen(tekst) {
    opgeslagenYaml = laatsteYaml;
    ververs();
    $('#status').textContent = tekst;
  }

  async function opslaan() {
    const yaml = huidigeYaml();
    try {
      if (!bestand) {
        bestand = await showSaveFilePicker({
          suggestedName: 'tuin.yaml',
          types: [{ description: 'YAML', accept: { 'text/yaml': ['.yaml', '.yml'] } }],
        });
        $('#opslaan').textContent = `💾 Opslaan in ${bestand.name}`;
      }
      const w = await bestand.createWritable();
      await w.write(yaml);
      await w.close();
      markeerOpgeslagen(`Opgeslagen in ${bestand.name} ✓`);
    } catch (e) {
      if (e.name !== 'AbortError') alert(`Opslaan lukte niet: ${e.message}`);
    }
  }
  $('#opslaan').addEventListener('click', opslaan);

  function download() {
    const yaml = huidigeYaml();
    const a = el('a', { href: URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' })), download: 'tuin.yaml' });
    document.body.append(a);
    a.click();
    a.remove();
    markeerOpgeslagen('Gedownload. Zet tuin.yaml in de map van de planner ✓');
  }
  $('#download').addEventListener('click', download);

  $('#kopieer').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(huidigeYaml());
      $('#status').textContent = 'YAML gekopieerd ✓';
    } catch (_) {
      alert('Kopiëren lukte niet; gebruik het tabblad YAML.');
    }
  });

  $('#bekijk').addEventListener('click', () => {
    const yaml = huidigeYaml();
    opslag(CONCEPT, { yaml, tijd: Date.now() }); // ook als er niets gewijzigd is
  });

  $('#opnieuw').addEventListener('click', async () => {
    if (!confirm('Alle wijzigingen weggooien en opnieuw beginnen vanaf tuin.yaml?')) return;
    const r = await fetch('tuin.yaml', { cache: 'no-cache' });
    const tekst = await r.text();
    ongedaan.push(laatsteYaml);
    doc = lees(tekst);
    opgeslagenYaml = laatsteYaml = naarYaml(doc);
    meld('');
    herbereken();
    tekenFormulier();
    ververs();
  });

  laad();
})();
