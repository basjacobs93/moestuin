// Rekenlogica: van tuin.yaml + gewassen.yaml naar teelten, taken en hoeveelheden.
// Bevat geen DOM-code, zodat het ook met node te testen is.
(function (root) {
  const DAG = 86400000;

  // ---------- datums (alles in UTC, om zomertijd-gedoe te vermijden) ----------

  const utc = (j, m, d) => new Date(Date.UTC(j, m - 1, d));
  const plusDagen = (d, n) => new Date(d.getTime() + Math.round(n) * DAG);
  const plusWeken = (d, n) => plusDagen(d, n * 7);
  const vandaag = () => { const n = new Date(); return utc(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
  const maandDag = (d) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const iso = (d) => d.toISOString().slice(0, 10);

  function weekNummer(d) {
    const t = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
    const week1 = utc(t.getUTCFullYear(), 1, 4);
    return 1 + Math.round(((t - week1) / DAG - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  }

  function maandagVanWeek(jaar, week) {
    const jan4 = utc(jaar, 1, 4);
    return plusDagen(jan4, -((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  }

  // Accepteert 2027-04-15, 04-15 (jaar uit tuin.yaml) of "week 15" / "w15".
  function leesDatum(v, jaar) {
    if (v instanceof Date) return utc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
    const s = String(v).trim().toLowerCase();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return utc(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})$/))) return utc(jaar, +m[1], +m[2]);
    if ((m = s.match(/^(?:w|week)\s*(\d{1,2})(?:\s+(\d{4}))?$/))) return maandagVanWeek(m[2] ? +m[2] : jaar, +m[1]);
    throw new Error(`Onbekende datum "${v}". Gebruik 2027-04-15, 04-15 of week 15.`);
  }

  // "03-15" of Date -> 315
  function leesMaandDag(v) {
    if (v instanceof Date) return maandDag(v);
    const m = String(v).trim().match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) throw new Error(`Onbekend venster "${v}". Gebruik MM-DD, bijv. 03-15.`);
    return +m[1] * 100 + +m[2];
  }

  function leesVensters(v, gewasNaam) {
    if (!Array.isArray(v) || v.length === 0) throw new Error(`Gewas "${gewasNaam}" heeft geen geldig venster.`);
    const lijst = Array.isArray(v[0]) ? v : [v];
    return lijst.map(([a, b]) => [leesMaandDag(a), leesMaandDag(b)]);
  }

  const inVenster = (md, [a, b]) => (a <= b ? md >= a && md <= b : md >= a || md <= b);
  const inEenVenster = (d, vensters) => vensters.some((v) => inVenster(maandDag(d), v));

  // Vroegste datum >= `nodig` die in een venster valt.
  function eersteMogelijk(nodig, vensters) {
    if (inEenVenster(nodig, vensters)) return nodig;
    const kandidaten = [];
    for (const j of [nodig.getUTCFullYear(), nodig.getUTCFullYear() + 1]) {
      for (const [a] of vensters) {
        const d = utc(j, Math.floor(a / 100), a % 100);
        if (d >= nodig) kandidaten.push(d);
      }
    }
    return kandidaten.sort((x, y) => x - y)[0] || nodig;
  }

  const fmtVenster = (vensters) =>
    vensters.map(([a, b]) => `${fmtMD(a)} – ${fmtMD(b)}`).join(' of ');
  const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const fmtMD = (md) => `${md % 100} ${MAANDEN[Math.floor(md / 100) - 1]}`;

  // ---------- gewassen ----------

  const METHODES = ['zaaien', 'voorzaaien', 'poten', 'planten'];

  function leesOpbrengst(v, gewasNaam) {
    if (v == null) return null;
    const m = String(v).trim().match(/^([\d.,]+)\s*([a-zA-Z]+)\s*\/\s*(m2|m²|plant)$/);
    if (!m) throw new Error(`Gewas "${gewasNaam}": opbrengst "${v}" niet begrepen. Gebruik bijv. "3 kg/m2" of "1 stuks/plant".`);
    return { hoeveel: parseFloat(m[1].replace(',', '.')), eenheid: m[2], per: m[3] === 'plant' ? 'plant' : 'm2' };
  }

  function normaliseerGewas(sleutel, g, families) {
    const naam = g.naam || sleutel;
    const vast = !!g.vast;
    if (vast && !g.oogst) throw new Error(`Gewas "${naam}": een vaste plant heeft een oogstperiode nodig (oogst: [MM-DD, MM-DD]).`);
    if (vast && !g.methode) g = { ...g, methode: 'planten' };
    if (!METHODES.includes(g.methode)) {
      throw new Error(`Gewas "${naam}": methode moet een van ${METHODES.join(', ')} zijn.`);
    }
    if (g.familie && !families[g.familie]) {
      throw new Error(`Gewas "${naam}": onbekende familie "${g.familie}".`);
    }
    if (g.methode === 'voorzaaien' && !g.uitplanten_na) {
      throw new Error(`Gewas "${naam}": bij voorzaaien is uitplanten_na (weken) nodig.`);
    }
    return {
      sleutel,
      naam,
      emoji: g.emoji || '🌱',
      familie: g.familie || 'overig',
      methode: g.methode,
      vensters: vast && !g.venster ? [] : leesVensters(g.venster, naam),
      vast,
      oogstVenster: vast ? leesVensters(g.oogst, naam)[0] : null,
      uitplantenNa: g.uitplanten_na || 0,
      rij: g.rij || 30,
      plant: g.plant || 30,
      breedwerpig: !!g.breedwerpig,
      zaadGramM2: g.zaad_g_m2 || null,
      uitdunnen: !!g.uitdunnen,
      oogstNa: g.oogst_na || 60,
      oogstDuur: g.oogst_duur || 2,
      oogstLabel: g.oogst_label || null,
      opbrengst: leesOpbrengst(g.opbrengst, naam),
      plantgoedNaam: g.plantgoed_naam || null,
      zaadFactor: g.zaad_factor || null,
      taken: g.taken || [],
      tip: g.tip || '',
    };
  }

  // ---------- plan bouwen ----------

  function bouwPlan(tuinDoc, gewassenDoc) {
    const waarschuwingen = [];
    const t = (tuinDoc && tuinDoc.tuin) || {};
    const tuin = {
      naam: t.naam || 'Moestuin',
      lengte: t.lengte || 10,
      breedte: t.breedte || 5,
      jaar: t.jaar || new Date().getFullYear(),
    };
    const jaar = tuin.jaar;

    const families = { ...(gewassenDoc.families || {}), ...(tuinDoc.families || {}) };
    if (!families.overig) families.overig = { naam: 'Overig' };

    // Gewassen uit tuin.yaml vullen de database aan of overschrijven velden ervan.
    const ruw = { ...(gewassenDoc.gewassen || {}) };
    for (const [k, v] of Object.entries(tuinDoc.gewassen || {})) ruw[k] = { ...(ruw[k] || {}), ...v };
    const gewassen = {};
    for (const [k, v] of Object.entries(ruw)) gewassen[k] = normaliseerGewas(k, v, families);

    const bedden = [];
    const teelten = [];

    (tuinDoc.bedden || []).forEach((b, bi) => {
      const naam = String(b.naam ?? `Bed ${bi + 1}`);
      const [x, y] = b.positie || [0, 0];
      const [w, h] = b.maat || [1, 1];
      const bed = { index: bi, naam, x, y, w, h, soort: b.soort || 'bed', notitie: b.notitie || '', stroken: [] };
      bedden.push(bed);

      if (x < 0 || y < 0 || x + w > tuin.lengte + 1e-9 || y + h > tuin.breedte + 1e-9) {
        waarschuwingen.push(`${naam}: ligt (deels) buiten de tuin van ${tuin.lengte} × ${tuin.breedte} m.`);
      }

      const lijst = (b.teelt || []).map((te) => (typeof te === 'string' ? { gewas: te } : te));
      if (!lijst.length) return;

      // Het bed wordt in de lengterichting (lange kant) in stroken verdeeld.
      const langsX = w >= h;
      const L = Math.max(w, h);
      const K = Math.min(w, h);
      const vast = lijst.reduce((s, te) => s + (te.deel || 0), 0);
      const zonderDeel = lijst.filter((te) => !te.deel).length;
      if (vast > L + 1e-9) {
        waarschuwingen.push(`${naam}: de stroken zijn samen ${vast} m, maar het bed is maar ${L} m lang.`);
      }
      const rest = zonderDeel ? Math.max(0, L - vast) / zonderDeel : 0;

      let offset = 0;
      lijst.forEach((te, si) => {
        const deel = te.deel || rest;
        const n = Math.max(1, te.herhaal || 1);
        const elke = te.elke || 3;
        for (let i = 0; i < n; i++) {
          const sub = deel / n;
          const o = offset + i * sub;
          const rect = langsX ? { x: x + o, y, w: sub, h: K } : { x, y: y + o, w: K, h: sub };
          const strook = { id: `${naam}-${si + 1}${n > 1 ? String.fromCharCode(97 + i) : ''}`, bed: naam, rect, lengte: sub, breedte: K, teelten: [] };
          bed.stroken.push(strook);

          // De keten: de teelt zelf, plus eventuele nateelten (daarna).
          const keten = [{ ...te, _verschuiving: i * elke }, ...(te.daarna || []).map((d) => (typeof d === 'string' ? { gewas: d } : d))];
          let vrijVanaf = null;
          keten.forEach((k, ki) => {
            const teelt = maakTeelt(k, strook, vrijVanaf, ki > 0, gewassen, jaar, waarschuwingen);
            if (!teelt) return;
            teelt.id = `${strook.id}-${ki + 1}`;
            teelt.bron = ki === 0 ? te : (te.daarna || [])[ki - 1]; // het object uit tuin.yaml (voor de editor)
            teelt.herhaling = n > 1 && ki === 0 ? `${i + 1}/${n}` : null;
            strook.teelten.push(teelt);
            teelten.push(teelt);
            vrijVanaf = teelt.oogstEind;
          });
        }
        offset += deel;
      });
    });

    // Overlappende bedden?
    for (let i = 0; i < bedden.length; i++) {
      for (let j = i + 1; j < bedden.length; j++) {
        const a = bedden[i], b = bedden[j];
        if (a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) {
          waarschuwingen.push(`${a.naam} en ${b.naam} overlappen elkaar.`);
        }
      }
    }

    const taken = [];
    for (const teelt of teelten) taken.push(...takenVoor(teelt, jaar));
    for (const [i, e] of (tuinDoc.taken || []).entries()) {
      try {
        const d = leesDatum(e.datum, jaar);
        taken.push({ id: `eigen-${i}-${iso(d)}`, datum: d, soort: 'eigen', icoon: '📌', tekst: e.wat, teelt: null });
      } catch (err) {
        waarschuwingen.push(`Eigen taak "${e.wat}": ${err.message}`);
      }
    }
    taken.sort((a, b) => a.datum - b.datum || volgorde(a) - volgorde(b));

    const alleData = [...taken.map((t) => t.datum), ...teelten.map((t) => t.oogstEind)];
    const begin = alleData.length ? new Date(Math.min(...alleData)) : utc(jaar, 1, 1);
    const eind = alleData.length ? new Date(Math.max(...alleData)) : utc(jaar, 12, 31);

    return {
      tuin, families, gewassen, bedden, teelten, taken, waarschuwingen,
      bereik: {
        begin: utc(Math.min(begin.getUTCFullYear(), jaar), begin.getUTCFullYear() < jaar ? begin.getUTCMonth() + 1 : 1, 1),
        eind: utc(eind.getUTCFullYear(), eind.getUTCMonth() + 2, 1),
      },
      totalen: totalenPerGewas(teelten),
    };
  }

  const SOORT_VOLGORDE = ['eigen', 'voorbereiden', 'binnen', 'afharden', 'zaaien', 'poten', 'uitplanten', 'uitdunnen', 'verzorgen', 'oogsten', 'opruimen'];
  const volgorde = (t) => SOORT_VOLGORDE.indexOf(t.soort);

  function maakTeelt(k, strook, vrijVanaf, isNateelt, gewassen, jaar, waarschuwingen) {
    if (!k.gewas) return null; // nog geen gewas gekozen (editor): strook blijft leeg
    const g = gewassen[k.gewas];
    const plek = `${strook.bed} (${strook.id})`;
    if (!g) {
      waarschuwingen.push(`${plek}: gewas "${k.gewas}" staat niet in gewassen.yaml.`);
      return null;
    }
    if (g.vast) return vasteTeelt(k, strook, g, plek, jaar, waarschuwingen);

    // Voorgezaaide gewassen kun je ook als plantje kopen.
    const plantgoed = !!k.plantgoed && g.methode === 'voorzaaien';
    const methode = plantgoed ? 'planten' : g.methode;
    // Het venster gaat over de eerste handeling; bij gekochte plantjes verschuift dat naar het uitplanten.
    const vensterVerschuiving = plantgoed ? g.uitplantenNa : 0;
    const vensters = g.vensters;

    let start; // datum van de eerste handeling (zaaien / binnen zaaien / poten / planten)
    try {
      if (k.datum != null) {
        start = leesDatum(k.datum, jaar);
      } else if (vrijVanaf) {
        // Nateelt: zo vroeg mogelijk, zodat hij in de grond kan als de voorganger klaar is.
        const nodig = plusWeken(vrijVanaf, -(g.methode === 'voorzaaien' && !plantgoed ? g.uitplantenNa : 0));
        start = plusWeken(eersteMogelijk(plusWeken(nodig, -vensterVerschuiving), vensters), vensterVerschuiving);
        if (start < nodig) start = nodig;
      } else {
        const [a] = vensters[0];
        start = plusWeken(utc(jaar, Math.floor(a / 100), a % 100), vensterVerschuiving);
      }
    } catch (err) {
      waarschuwingen.push(`${plek}: ${err.message}`);
      return null;
    }
    if (k._verschuiving) start = plusWeken(start, k._verschuiving);

    if (!inEenVenster(plusWeken(start, -vensterVerschuiving), vensters)) {
      const wat = g.methode === 'voorzaaien' ? (plantgoed ? 'uitplanten' : 'voorzaaien') : g.methode;
      const vensterTekst = plantgoed
        ? vensters.map(([a, b]) => `${fmtMD(maandDag(plusWeken(utc(jaar, Math.floor(a / 100), a % 100), vensterVerschuiving)))} – ${fmtMD(maandDag(plusWeken(utc(jaar, Math.floor(b / 100), b % 100), vensterVerschuiving)))}`).join(' of ')
        : fmtVenster(vensters);
      waarschuwingen.push(`${plek}: ${g.naam} ${wat} op ${fmtDatum(start)} valt buiten het gebruikelijke venster (${vensterTekst}).`);
    }

    const binnen = methode === 'voorzaaien' ? start : null;
    const grond = methode === 'voorzaaien' ? plusWeken(start, g.uitplantenNa) : start;
    const oogstStart = plusDagen(grond, g.oogstNa);
    const oogstEind = plusWeken(oogstStart, g.oogstDuur);

    if (vrijVanaf && grond < vrijVanaf) {
      waarschuwingen.push(`${plek}: ${g.naam} moet ${fmtDatum(grond)} de grond in, maar de vorige teelt staat er tot ${fmtDatum(vrijVanaf)}.`);
    }

    return {
      gewas: g, strook, methode, plantgoed, isNateelt,
      binnen, grond, oogstStart, oogstEind,
      ...hoeveelheden(g, strook, methode),
      notitie: k.notitie || '',
    };
  }

  // Vaste planten (fruit): staan er al het hele jaar, of worden op `datum` geplant.
  // Ze oogsten elk jaar in dezelfde periode.
  function vasteTeelt(k, strook, g, plek, jaar, waarschuwingen) {
    let grond = utc(jaar, 1, 1);
    let methode = 'vast';
    if (k.datum != null) {
      try {
        grond = leesDatum(k.datum, jaar);
      } catch (err) {
        waarschuwingen.push(`${plek}: ${err.message}`);
        return null;
      }
      methode = 'planten';
      if (g.vensters.length && !inEenVenster(grond, g.vensters)) {
        waarschuwingen.push(`${plek}: ${g.naam} planten op ${fmtDatum(grond)} valt buiten het gebruikelijke venster (${fmtVenster(g.vensters)}).`);
      }
    }
    const [a, b] = g.oogstVenster;
    const oogstStart = eersteMogelijk(methode === 'planten' ? plusDagen(grond, g.oogstNa) : grond, [[a, a]]);
    const j = oogstStart.getUTCFullYear() + (b < a ? 1 : 0);
    const oogstEind = utc(j, Math.floor(b / 100), b % 100);
    return {
      gewas: g, strook, methode, plantgoed: false, isNateelt: false, vast: true,
      binnen: null, grond, oogstStart, oogstEind,
      ...hoeveelheden(g, strook, methode),
      notitie: k.notitie || '',
    };
  }

  function hoeveelheden(g, strook, methode) {
    const opp = strook.lengte * strook.breedte;
    let aantal = null;
    let rijen = null;
    if (!g.breedwerpig) {
      rijen = Math.max(1, Math.floor((strook.breedte * 100) / g.rij + 1e-6));
      const perRij = Math.max(1, Math.floor((strook.lengte * 100) / g.plant + 1e-6));
      aantal = rijen * perRij;
    }
    let zaad = null;
    if (g.breedwerpig) {
      if (g.zaadGramM2) zaad = { aantal: Math.ceil(opp * g.zaadGramM2), eenheid: 'gram zaad' };
    } else if (methode === 'poten') {
      zaad = { aantal, eenheid: g.plantgoedNaam || 'pootgoed' };
    } else if (methode === 'planten') {
      zaad = { aantal, eenheid: 'plantjes' };
    } else if (methode === 'vast') {
      zaad = null;
    } else {
      const factor = g.zaadFactor || (g.uitdunnen ? 2 : 1.5);
      zaad = { aantal: Math.ceil(aantal * factor), eenheid: 'zaden' };
    }
    let opbrengst = null;
    if (g.opbrengst) {
      const basis = g.opbrengst.per === 'plant' ? aantal || 0 : opp;
      opbrengst = { hoeveel: basis * g.opbrengst.hoeveel, eenheid: g.opbrengst.eenheid };
    }

    return { oppervlakte: opp, rijen, aantal, zaad, opbrengst };
  }

  function takenVoor(t, jaar) {
    const g = t.gewas;
    const plek = t.strook.bed;
    const lijst = [];
    const voeg = (datum, soort, icoon, tekst) =>
      lijst.push({ id: `${t.id}-${soort}-${iso(datum)}`, datum, soort, icoon, tekst, teelt: t, plek });

    if (t.methode === 'voorzaaien') {
      voeg(t.binnen, 'binnen', '🏠', `${g.naam} binnen voorzaaien`);
      voeg(plusWeken(t.grond, -1), 'afharden', '🌤️', `${g.naam}: plantjes overdag buiten zetten (afharden)`);
      voeg(t.grond, 'uitplanten', '🪴', `${g.naam} uitplanten`);
    } else if (t.methode === 'planten') {
      voeg(t.grond, 'uitplanten', '🪴', `${g.naam} planten${t.plantgoed ? ' (gekochte plantjes)' : ''}`);
    } else if (t.methode === 'vast') {
      // staat er al: geen plantklus
    } else if (t.methode === 'poten') {
      voeg(t.grond, 'poten', '🫳', `${g.naam} poten`);
    } else {
      voeg(t.grond, 'zaaien', '🌱', `${g.naam} zaaien`);
    }
    if (g.uitdunnen && t.methode === 'zaaien') {
      voeg(plusWeken(t.grond, 3), 'uitdunnen', '✂️', `${g.naam} uitdunnen tot ${g.plant} cm`);
    }
    for (const e of g.taken) {
      let d;
      if (e.weken != null) d = plusWeken(t.grond, e.weken);
      else if (e.datum != null && t.vast) {
        // vaste planten: elk jaar; na het planten pas vanaf het eerste oogstjaar
        d = leesDatum(e.datum, t.oogstStart.getUTCFullYear());
      } else if (e.datum != null) {
        d = leesDatum(e.datum, t.grond.getUTCFullYear());
        if (d < t.grond || d > t.oogstEind) continue;
      } else continue;
      voeg(d, e.weken != null && e.weken < 0 ? 'voorbereiden' : 'verzorgen', '🔧', `${g.naam}: ${e.wat}`);
    }
    voeg(t.oogstStart, 'oogsten', '🧺', g.oogstLabel ? `${g.naam}: ${g.oogstLabel.toLowerCase()}` : `${g.naam}: eerste oogst`);
    if (!g.oogstLabel && !t.vast) voeg(t.oogstEind, 'opruimen', '🧹', `${g.naam}: laatste oogst, strook vrij`);
    return lijst;
  }

  function totalenPerGewas(teelten) {
    const per = new Map();
    for (const t of teelten) {
      const k = t.gewas.sleutel + '|' + (t.zaad ? t.zaad.eenheid : '');
      if (!per.has(k)) {
        per.set(k, { gewas: t.gewas, oppervlakte: 0, aantal: 0, zaad: t.zaad ? { aantal: 0, eenheid: t.zaad.eenheid } : null, opbrengst: null, eerste: t.binnen || t.grond, teelten: 0 });
      }
      const s = per.get(k);
      s.teelten++;
      s.oppervlakte += t.oppervlakte;
      s.aantal += t.aantal || 0;
      if (s.zaad && t.zaad) s.zaad.aantal += t.zaad.aantal;
      if (t.opbrengst) {
        s.opbrengst = s.opbrengst || { hoeveel: 0, eenheid: t.opbrengst.eenheid };
        s.opbrengst.hoeveel += t.opbrengst.hoeveel;
      }
      const eerste = t.binnen || t.grond;
      if (eerste < s.eerste) s.eerste = eerste;
    }
    return [...per.values()].sort((a, b) => a.eerste - b.eerste);
  }

  // Welke teelt staat op datum d in de strook (van in de grond tot laatste oogst)?
  const inGrondOp = (strook, d) => strook.teelten.find((t) => t.grond <= d && (t.vast || d <= t.oogstEind)) || null;

  const fmtDatum = (d, opties = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    d.toLocaleDateString('nl-NL', { ...opties, timeZone: 'UTC' });

  const api = { bouwPlan, leesDatum, weekNummer, plusDagen, plusWeken, vandaag, utc, iso, fmtDatum, inGrondOp, MAANDEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(this);
