// Gedeelde tekencode voor de planner (index.html) en de editor (editor.html).
(function (root) {
  const P = root.Planner;
  const NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = ['svg', 'g', 'rect', 'text', 'tspan', 'line', 'path', 'clipPath', 'defs', 'pattern', 'title'];

  function el(tag, attrs = {}, ...kinderen) {
    const e = SVG_TAGS.includes(tag) ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'tekst') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kinderen.flat()) if (k != null) e.append(k);
    return e;
  }

  // Families krijgen in vaste volgorde een kleur; vanaf de achtste en "overig" grijs.
  function familieKleuren(families) {
    const kleuren = {};
    Object.keys(families).filter((k) => k !== 'overig')
      .forEach((k, i) => { kleuren[k] = i < 7 ? `var(--s${i + 1})` : 'var(--s-overig)'; });
    kleuren.overig = 'var(--s-overig)';
    return kleuren;
  }

  // Tekent de plattegrond in `doos`.
  // opties:
  //   modus         'seizoen' (hele keten per strook) of 'datum' (wat staat er op `datum`)
  //   datum         Date, bij modus 'datum'
  //   kleuren       uitkomst van familieKleuren
  //   gekozenStrook id van de geselecteerde strook
  //   gekozenBed    index van het geselecteerde bed
  //   onStrook      klik op een strook
  //   onBed         klik op een bed (alleen als onVerplaats gezet is)
  //   onVerplaats   (bed, x, y) na het slepen van een bed; maakt bedden sleepbaar
  function plattegrond(doos, plan, o = {}) {
    const { tuin } = plan;
    const kleur = (t) => (o.kleuren || {})[t.gewas.familie] || 'var(--s-overig)';
    const beschikbaar = doos.clientWidth || 800;
    const staand = beschikbaar < 560; // op een telefoon de tuin rechtop zetten
    const M = 22; // marge links voor de meterlat
    const MB = 36; // marge boven: meterlat plus ruimte voor bednamen
    const S = (beschikbaar - M - 4) / (staand ? tuin.breedte : tuin.lengte); // pixels per meter
    const W = (staand ? tuin.breedte : tuin.lengte) * S;
    const H = (staand ? tuin.lengte : tuin.breedte) * S;
    // tuincoördinaten (x langs lengte, y langs breedte) -> scherm
    const scherm = (r) => (staand
      ? { x: M + r.y * S, y: MB + r.x * S, w: r.h * S, h: r.w * S }
      : { x: M + r.x * S, y: MB + r.y * S, w: r.w * S, h: r.h * S });

    const svg = el('svg', { viewBox: `0 0 ${W + M + 4} ${H + MB + 4}`, role: 'img', 'aria-label': `Plattegrond van ${tuin.naam}` });
    const defs = el('defs');
    svg.append(defs);
    svg.append(el('rect', { x: M, y: MB, width: W, height: H, rx: 6, fill: 'var(--gras)', stroke: 'var(--lijn)' }));

    // meterlat
    const lat = el('g', { 'font-size': 10, fill: 'var(--tekst-3)' });
    for (let m = 0; m <= (staand ? tuin.breedte : tuin.lengte); m++) {
      lat.append(el('text', { x: M + m * S, y: 11, 'text-anchor': 'middle', tekst: m }));
      if (m > 0) lat.append(el('line', { x1: M + m * S, x2: M + m * S, y1: MB, y2: MB + H, stroke: 'var(--tekst-3)', 'stroke-opacity': 0.12 }));
    }
    for (let m = 1; m <= (staand ? tuin.lengte : tuin.breedte); m++) {
      lat.append(el('text', { x: M - 6, y: MB + m * S + 3, 'text-anchor': 'end', tekst: m }));
      lat.append(el('line', { x1: M, x2: M + W, y1: MB + m * S, y2: MB + m * S, stroke: 'var(--tekst-3)', 'stroke-opacity': 0.12 }));
    }
    svg.append(lat);

    const sleepbaar = !!o.onVerplaats;
    let clipNr = 0;
    for (const bed of plan.bedden) {
      const b = scherm(bed);
      const g = el('g', { class: 'bed' + (sleepbaar ? ' sleepbaar' : '') + (o.gekozenBed === bed.index ? ' gekozen' : '') });
      const vulling = { compost: 'var(--aarde)', pad: 'var(--pad)', kas: 'var(--kaart)' }[bed.soort] || 'var(--aarde-licht)';
      g.append(el('rect', { class: 'bedvlak', x: b.x, y: b.y, width: b.w, height: b.h, rx: 3, fill: vulling, stroke: 'var(--aarde)', 'stroke-width': 1.5, 'fill-opacity': bed.soort === 'compost' ? 0.5 : 1 }));
      const naamErin = plan.bedden.some((a) => a !== bed && a.y + a.h <= bed.y + 1e-9 && bed.y - (a.y + a.h) < 0.25 && a.x < bed.x + bed.w && bed.x < a.x + a.w);
      g.append(el('text', { x: b.x + (naamErin ? 5 : 1), y: naamErin ? b.y + 14 : b.y - 5, 'font-size': 11, 'font-weight': 600, fill: 'var(--tekst-2)', tekst: bed.naam }));

      for (const strook of bed.stroken) {
        const r = scherm(strook.rect);
        const id = `clip${clipNr++}`;
        defs.append(el('clipPath', { id }, el('rect', { x: r.x, y: r.y, width: r.w, height: r.h })));

        const actief = o.modus === 'datum' ? P.inGrondOp(strook, o.datum) : null;
        const hoofd = o.modus === 'datum' ? actief : strook.teelten[0];
        const sg = el('g', sleepbaar ? {} : {
          class: 'strook' + (o.gekozenStrook === strook.id ? ' gekozen' : ''),
          tabindex: 0,
          role: 'button',
          'aria-label': `${strook.bed}: ${strook.teelten.map((t) => t.gewas.naam).join(', daarna ')}`,
          onclick: () => o.onStrook && o.onStrook(strook),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onStrook && o.onStrook(strook); } },
        });
        sg.append(el('rect', {
          class: 'vlak', x: r.x + 1, y: r.y + 1, width: Math.max(0, r.w - 2), height: Math.max(0, r.h - 2), rx: 2,
          fill: hoofd ? `color-mix(in srgb, ${kleur(hoofd)} 30%, var(--kaart))` : 'var(--aarde-licht)',
          stroke: hoofd ? kleur(hoofd) : 'var(--aarde)', 'stroke-width': 1, 'stroke-dasharray': hoofd ? null : '3 3',
        }));

        // label: in seizoensmodus de hele keten, op datum wat er dan staat
        let regels;
        if (o.modus !== 'datum') {
          regels = strook.teelten.map((t, i) => ({ tekst: `${i ? '→ ' : ''}${t.gewas.emoji} ${t.gewas.naam}${t.herhaling ? ' ' + t.herhaling : ''}`, sterk: i === 0 }));
        } else if (actief) {
          const fase = o.datum >= actief.oogstStart ? 'oogsten' : 'groeit';
          regels = [{ tekst: `${actief.gewas.emoji} ${actief.gewas.naam}`, sterk: true }, { tekst: fase }];
        } else {
          const binnen = strook.teelten.find((t) => t.binnen && t.binnen <= o.datum && o.datum < t.grond);
          const volgende = strook.teelten.find((t) => t.grond > o.datum);
          regels = binnen ? [{ tekst: `🏠 ${binnen.gewas.naam} staat binnen` }]
            : volgende ? [{ tekst: `leeg · straks ${volgende.gewas.naam}` }]
            : [{ tekst: 'leeg' }];
        }
        const fs = Math.max(9, Math.min(12, S * 0.16));
        const txt = el('text', { 'clip-path': `url(#${id})`, 'font-size': fs, fill: 'var(--tekst)' });
        regels.forEach((rg, i) => txt.append(el('tspan', {
          x: r.x + 6, y: r.y + 6 + fs * (i + 1) * 1.15, 'font-weight': rg.sterk ? 600 : 400,
          fill: rg.sterk ? 'var(--tekst)' : 'var(--tekst-2)', tekst: rg.tekst,
        })));
        sg.append(txt);
        g.append(sg);
      }
      if (!bed.stroken.length) {
        const label = bed.soort === 'compost' || bed.soort === 'kas' ? bed.soort : bed.soort === 'bed' && sleepbaar ? 'leeg bed' : null;
        if (label) g.append(el('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--tekst-2)', tekst: label }));
      }
      if (sleepbaar) maakSleepbaar(g, bed, svg, S, staand, o);
      svg.append(g);
    }
    doos.replaceChildren(svg);
  }

  // Bed verslepen met muis of vinger; een klik zonder beweging selecteert het bed.
  function maakSleepbaar(g, bed, svg, S, staand, o) {
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      const schaal = svg.getScreenCTM().a; // schermpixels per svg-eenheid
      let dx = 0, dy = 0, bewogen = false;
      g.setPointerCapture(e.pointerId);
      g.classList.add('sleept');
      const beweeg = (ev) => {
        dx = (ev.clientX - start.x) / schaal;
        dy = (ev.clientY - start.y) / schaal;
        if (Math.hypot(dx, dy) > 3) bewogen = true;
        if (bewogen) g.setAttribute('transform', `translate(${dx} ${dy})`);
      };
      const los = () => {
        g.removeEventListener('pointermove', beweeg);
        g.removeEventListener('pointerup', los);
        g.removeEventListener('pointercancel', los);
        g.classList.remove('sleept');
        if (!bewogen) { if (o.onBed) o.onBed(bed); return; }
        let mx = dx / S, my = dy / S;
        if (staand) [mx, my] = [my, mx];
        o.onVerplaats(bed, bed.x + mx, bed.y + my);
      };
      g.addEventListener('pointermove', beweeg);
      g.addEventListener('pointerup', los);
      g.addEventListener('pointercancel', los);
    });
  }

  root.Tekening = { el, familieKleuren, plattegrond };
})(this);
