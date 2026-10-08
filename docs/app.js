(() => {
  'use strict';

  const R = window.Regles;
  const API = window.PREMIS_API;
  const DEMO = !API || new URLSearchParams(location.search).has('demo');
  const POLL_ESTAT_MS = 3000;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    llista: $('#llista'),
    cerca: $('#cerca'),
    filtre: $('#filtre'),
    ordre: $('#ordre'),
    comptador: $('#comptador'),
    subtitol: $('#subtitol'),
    resum: $('#resum'),
    regles: $('#regles'),
    sorteig: $('#sorteig'),
    sorteigN: $('#sorteig-n'),
    sorteigText: $('#sorteig-text'),
    fitxa: $('#fitxa'),
    fitxaNom: $('#fitxa-nom'),
    fitxaSub: $('#fitxa-sub'),
    fitxaCos: $('#fitxa-cos'),
    menu: $('#menu'),
    menuCarrega: $('#menu-carrega'),
    menuNom: $('#menu-nom'),
    inputCsv: $('#input-csv'),
    sync: $('#sync'),
    syncText: $('#sync-text'),
    toast: $('#toast'),
  };

  const guardat = llegeix('pa-ui', {});
  const ui = {
    tab: guardat.tab || 'persones',
    ordre: guardat.ordre || 'punts',
    filtre: '',
    cerca: '',
    fitxa: null, // id de la persona oberta
  };

  let dades = null;
  let persones = [];
  let perId = new Map();
  let servidor = { v: -1, vd: -1, marques: {} };
  // Canvis fets en aquest mòbil que encara no ha confirmat el servidor.
  let pendents = llegeix('pa-pendents', {});
  let darreraSync = 0;
  let errorSync = false;
  let enviant = false;

  /* ---------- Utilitats ---------- */

  function llegeix(clau, perDefecte) {
    try {
      const v = localStorage.getItem(clau);
      return v ? JSON.parse(v) : perDefecte;
    } catch {
      return perDefecte;
    }
  }

  function desa(clau, valor) {
    try {
      localStorage.setItem(clau, JSON.stringify(valor));
    } catch {
      /* sense emmagatzematge: no passa res */
    }
  }

  const normalitza = R.normalitza;

  const escapa = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  // "XAVIER DE SAN MARTÍN" → "Xavier de San Martín"; "DIADA DE L'AVI" → "Diada de l'Avi"
  const PARTICULES = new Set(['de', 'del', 'dels', 'la', 'les', 'el', 'els', 'i', 'a', 'al', 'als', 'y']);
  const ROMA = /^(?=[xvi]+$)x{0,3}(ix|iv|v?i{0,3})$/;
  const DIES = { dl: 'dilluns', dt: 'dimarts', dc: 'dimecres', dj: 'dijous', dv: 'divendres', ds: 'dissabte', dg: 'diumenge' };
  const capitalitza = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((paraula, i) => {
        if (i > 0 && PARTICULES.has(paraula)) return paraula;
        if (ROMA.test(paraula)) return paraula.toUpperCase();
        // l'avi → l'Avi (i a l'inici, L'Avi)
        const [, ap = '', ll, resta] = paraula.match(/^([dl]')?(.)(.*)$/su);
        return (i === 0 ? ap.toUpperCase() : ap) + ll.toUpperCase() + resta.replace(/-(\p{L})/gu, (m) => m.toUpperCase());
      })
      .join(' ');

  // "ENTRENAMENT DT 01/09" → "Entrenament dimarts 01/09"
  const nomEsdeveniment = (s) =>
    capitalitza(s).replace(/^(Entrenament) (\p{L}{2})\b/u, (m, e, d) => (DIES[d.toLowerCase()] ? `${e} ${DIES[d.toLowerCase()]}` : m));

  const punts = (n) => `${n} ${n === 1 ? 'punt' : 'punts'}`;

  function ressalta(text, consulta) {
    if (!consulta) return escapa(text);
    // Treure els diacrítics manté la longitud per a lletres llatines, així que els índexs coincideixen.
    const net = String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const i = net.indexOf(consulta);
    if (i < 0) return escapa(text);
    return (
      escapa(text.slice(0, i)) +
      '<mark>' +
      escapa(text.slice(i, i + consulta.length)) +
      '</mark>' +
      escapa(text.slice(i + consulta.length))
    );
  }

  const dataHora = (t) =>
    t
      ? new Date(t).toLocaleString('ca-ES', {
          day: 'numeric',
          month: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 3500);
  }

  function nomPersona() {
    return llegeix('pa-nom', '');
  }

  function demanaNom() {
    const nou = prompt('Com et dius? (queda apuntat a cada premi que marquis)', nomPersona());
    if (nou !== null) desa('pa-nom', nou.trim().slice(0, 40));
    pintaMenu();
  }

  const icona = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    music:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  };

  /* ---------- Comunicació amb el servidor ---------- */

  function codi() {
    return llegeix('pa-codi', '');
  }

  async function crida(params, cos) {
    if (DEMO) return demo(params, cos);
    let res;
    if (cos) {
      // Sense capçalera Content-Type → text/plain, i així no hi ha preflight CORS.
      res = await fetch(API, { method: 'POST', body: JSON.stringify({ ...cos, codi: codi() }) });
    } else {
      const qs = new URLSearchParams({ ...params, codi: codi(), _: Date.now() });
      res = await fetch(API + '?' + qs, { cache: 'no-store' });
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error === 'codi') {
      const nou = prompt(codi() ? 'Codi incorrecte. Torna-ho a provar:' : "Introdueix el codi d'accés:");
      if (nou === null) throw new Error('Cal el codi');
      desa('pa-codi', nou.trim());
      return crida(params, cos);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  function aplicaDades(d) {
    dades = d;
    persones = R.calcula(d).map((p) => ({
      ...p,
      nomVisible: capitalitza(R.nomComplet(p)),
      aliesVisible: aliesDiferent(p) ? capitalitza(p.alies) : '',
      cercable: normalitza([p.nom, p.cognom, p.alies].join(' ')),
    }));
    perId = new Map(persones.map((p) => [p.id, p]));
    const nEvs = d.esdeveniments.filter(R.compta).length;
    els.subtitol.textContent = d.persones.length
      ? `${persones.length} persones · ${nEvs} esdeveniments`
      : 'Sense dades';
    pintaMenu();
    render();
  }

  // Només val la pena mostrar l'àlies si diu una cosa diferent del nom.
  function aliesDiferent(p) {
    const a = normalitza(p.alies);
    return a && a !== normalitza(p.nom) && a !== normalitza(R.nomComplet(p));
  }

  async function carregaDades(fresc) {
    const data = await crida(fresc ? { a: 'dades', fresc: 1 } : { a: 'dades' });
    aplicaDades(data.dades);
  }

  async function carregaEstat(fresc) {
    const data = await crida(fresc ? { a: 'estat', fresc: 1 } : { a: 'estat' });
    await aplicaServidor(data);
  }

  async function aplicaServidor(data) {
    // Algú ha carregat un CSV nou: torna a llegir les dades.
    const dadesNoves = servidor.vd !== -1 && data.vd !== servidor.vd;
    servidor = data;
    let canvi = false;
    for (const [clau, p] of Object.entries(pendents)) {
      // Treu els pendents que el servidor ja reflecteix
      // (o fa massa que es van enviar: algú altre ho pot haver canviat després).
      if (p.enviat && (!!servidor.marques[clau] === p.lliurat || Date.now() - p.ts > 20000)) {
        delete pendents[clau];
        canvi = true;
      }
    }
    if (canvi) desa('pa-pendents', pendents);
    darreraSync = Date.now();
    errorSync = false;
    if (dadesNoves) {
      await carregaDades();
      toast("S'han actualitzat les dades d'assistència");
    } else render();
    pintaSync();
  }

  async function enviaPendents() {
    if (enviant) return;
    const [clau, p] = Object.entries(pendents).find(([, p]) => !p.enviat) || [];
    if (!clau) return;
    enviant = true;
    const [id, premi] = clau.split('|');
    try {
      const data = await crida(null, { accio: 'marca', id, premi, lliurat: p.lliurat, per: nomPersona() });
      if (pendents[clau] === p) {
        p.enviat = true;
        p.ts = Date.now();
      }
      desa('pa-pendents', pendents);
      await aplicaServidor(data);
    } catch {
      errorSync = true;
      pintaSync();
      return;
    } finally {
      enviant = false;
    }
    enviaPendents();
  }

  function marca(id, premi, lliurat) {
    pendents[id + '|' + premi] = { lliurat, enviat: false, ts: Date.now() };
    desa('pa-pendents', pendents);
    render();
    pintaSync();
    enviaPendents();
  }

  function marcaDe(id, premi) {
    const clau = id + '|' + premi;
    if (pendents[clau]) {
      return pendents[clau].lliurat ? { per: nomPersona(), t: null, pendent: true } : null;
    }
    return servidor.marques[clau] || null;
  }

  /** Estat de cada premi per a una persona: ok (lliurat), pend (per lliurar) o lluny. */
  function premisDe(p) {
    return R.PREMIS.map((pr) => {
      const m = marcaDe(p.id, pr.id);
      const guanyat = p.punts >= pr.punts;
      return { ...pr, m, guanyat, estat: m ? 'ok' : guanyat ? 'pend' : 'lluny' };
    });
  }

  function pintaSync() {
    const n = Object.keys(pendents).length;
    let estat = 'ok';
    let text = 'Al dia';
    if (errorSync) {
      estat = 'error';
      text = n ? `Sense connexió · ${n} per enviar` : 'Sense connexió';
    } else if (n) {
      estat = 'pending';
      text = `Enviant ${n}…`;
    } else if (!darreraSync) {
      estat = '';
      text = 'Connectant…';
    }
    if (DEMO) text = 'Demo · ' + text;
    els.sync.dataset.state = estat;
    els.syncText.textContent = text;
  }

  /* ---------- Vista: persones ---------- */

  function ompleFiltre() {
    const opcions = [
      ['', 'Tothom'],
      ['pendents', 'Amb premis per lliurar'],
      ['musics', 'Músics'],
      ...R.PREMIS.map((pr) => ['p:' + pr.id, `Per lliurar: ${pr.nom}`]),
      ['sorteig', 'Entren al sorteig'],
    ];
    els.filtre.innerHTML = opcions
      .map(([v, t]) => `<option value="${v}"${v === ui.filtre ? ' selected' : ''}>${escapa(t)}</option>`)
      .join('');
    els.ordre.value = ui.ordre;
  }

  function passaFiltre(p, premis) {
    const f = ui.filtre;
    if (!f) return true;
    if (f === 'pendents') return premis.some((x) => x.estat === 'pend');
    if (f === 'musics') return p.music;
    if (f === 'sorteig') return R.alSorteig(p.punts);
    if (f.startsWith('p:')) return premis.some((x) => x.id === f.slice(2) && x.estat === 'pend');
    return true;
  }

  const perNom = (a, b) => a.nomVisible.localeCompare(b.nomVisible, 'ca');

  function filaPersona(p, premis, consulta) {
    const pend = premis.filter((x) => x.estat === 'pend').length;
    const sorteig = R.alSorteig(p.punts);
    const meta = [];
    if (p.aliesVisible) meta.push(`<span>${ressalta(p.aliesVisible, consulta)}</span>`);
    if (p.music) meta.push(`<span class="etiqueta etiqueta--music">${icona.music}Músic</span>`);
    if (pend) meta.push(`<span class="etiqueta etiqueta--pend">${pend} per lliurar</span>`);
    return (
      `<button type="button" class="fila" data-id="${escapa(p.id)}">` +
      `<span class="punts${sorteig ? ' is-sorteig' : ''}"><span>${p.punts}<small>punts</small></span></span>` +
      `<span class="fila__cos"><span class="fila__nom">${ressalta(p.nomVisible, consulta)}</span>` +
      (meta.length ? `<span class="fila__meta">${meta.join('')}</span>` : '') +
      `</span>` +
      `<span class="punts-premis" aria-hidden="true">${premis
        .map((x) => `<i class="${x.estat === 'lluny' ? '' : 'is-' + x.estat}"></i>`)
        .join('')}</span>` +
      `</button>`
    );
  }

  function renderPersones() {
    if (!dades) return;
    const consulta = normalitza(ui.cerca);
    let pendentsTotals = 0;
    const visibles = [];
    for (const p of persones) {
      const premis = premisDe(p);
      pendentsTotals += premis.filter((x) => x.estat === 'pend').length;
      if (consulta && !p.cercable.includes(consulta)) continue;
      if (!passaFiltre(p, premis)) continue;
      visibles.push({ p, premis });
    }
    visibles.sort((a, b) =>
      ui.ordre === 'nom' ? perNom(a.p, b.p) : b.p.punts - a.p.punts || perNom(a.p, b.p),
    );

    els.comptador.textContent =
      (visibles.length === persones.length
        ? `${persones.length} persones`
        : `${visibles.length} de ${persones.length} persones`) +
      ` · ${pendentsTotals} premis per lliurar en total`;

    if (!persones.length) {
      els.llista.innerHTML =
        '<div class="empty"><p>Encara no hi ha dades d\'assistència.</p>' +
        '<button type="button" class="btn" data-accio="csv">Carrega el CSV</button></div>';
      return;
    }
    if (!visibles.length) {
      els.llista.innerHTML = '<p class="empty">Ningú coincideix amb la cerca.</p>';
      return;
    }
    els.llista.innerHTML =
      '<ul>' + visibles.map(({ p, premis }) => `<li>${filaPersona(p, premis, consulta)}</li>`).join('') + '</ul>';
  }

  /* ---------- Vista: fitxa ---------- */

  const TEXT_ESTAT = { N: 'No vinc', P: 'Puc venir', '?': 'Potser', '-': '—' };

  function renderFitxa() {
    const p = perId.get(ui.fitxa);
    if (!p) {
      if (els.fitxa.open) els.fitxa.close();
      return;
    }
    els.fitxaNom.textContent = p.nomVisible;
    const sub = [];
    if (p.aliesVisible) sub.push(`<span>${escapa(p.aliesVisible)}</span>`);
    // Per als músics, l'etiqueta ja diu la posició.
    if (!p.music) sub.push(`<span>${escapa(capitalitza(p.posicio) || 'Sense posició')}</span>`);
    else sub.push(`<span class="etiqueta etiqueta--music">${icona.music}Músic</span>`);
    els.fitxaSub.innerHTML = sub.join('<span aria-hidden="true">·</span>');

    const premis = premisDe(p);
    const seguent = premis.find((x) => !x.guanyat);
    const pend = premis.filter((x) => x.estat === 'pend').length;
    const html = [];

    html.push(
      `<div class="marcador"><span class="marcador__n">${p.punts}</span><span class="marcador__text">` +
        `<strong>punts</strong><br>` +
        (seguent
          ? `Següent: ${seguent.nom.toLowerCase()} · ${seguent.punts - p.punts === 1 ? 'falta' : 'falten'} ${punts(seguent.punts - p.punts)}`
          : R.alSorteig(p.punts)
            ? 'Tots els premis i el sorteig'
            : `Tots els premis · ${punts(R.SORTEIG_MIN - p.punts)} més per al sorteig`) +
        `</span></div>`,
    );

    if (p.music && p.auto) {
      html.push(
        `<p class="avis avis--music">Músic: inclou ${p.auto} ${p.auto === 1 ? 'punt automàtic' : 'punts automàtics'} ` +
          `dels dimarts, que no tenen assaig de músics.</p>`,
      );
    }
    if (R.alSorteig(p.punts)) html.push('<p class="avis avis--sorteig">Entra al sorteig</p>');

    html.push('<ul class="premis">');
    for (const x of premis) {
      let estat;
      if (x.estat === 'ok') {
        estat = x.m.pendent
          ? 'Lliurat · enviant…'
          : `Lliurat${x.m.per ? ' per ' + escapa(x.m.per) : ''}${x.m.t ? ' · ' + dataHora(x.m.t) : ''}`;
        if (!x.guanyat) estat += ' · ja no hi arriba';
      } else if (x.estat === 'pend') estat = 'Per lliurar · toca per marcar-lo';
      else estat = `${x.punts - p.punts === 1 ? 'Falta' : 'Falten'} ${punts(x.punts - p.punts)}`;
      const cls = `premi is-${x.estat}${x.m && x.m.pendent ? ' is-pendent-envio' : ''}`;
      const cos =
        `<span class="premi__llindar">${x.punts} pt</span>` +
        `<span class="premi__cos"><span class="premi__nom">${escapa(x.nom)}</span>` +
        `<span class="premi__estat">${estat}</span></span>` +
        `<span class="check">${icona.check}</span>`;
      html.push(
        x.estat === 'lluny'
          ? `<li><div class="${cls}">${cos}</div></li>`
          : `<li><button type="button" class="${cls}" data-premi="${x.id}" aria-pressed="${x.estat === 'ok'}">${cos}</button></li>`,
      );
    }
    html.push('</ul>');

    html.push(
      `<details class="detall"><summary>Detall d'assistència</summary><ul>` +
        p.detall
          .map((d, i) => {
            const text =
              d.tipus === 'vinc'
                ? '✓ +1'
                : d.tipus === 'auto'
                  ? 'Dimarts músic +1'
                  : d.tipus === 'no-compta'
                    ? 'Vinc · no compta'
                    : TEXT_ESTAT[p.s[i]] || '—';
            return `<li class="ev--${d.tipus || 'res'}"><span>${escapa(nomEsdeveniment(d.nom))}</span><span>${text}</span></li>`;
          })
          .join('') +
        `</ul></details>`,
    );

    // Manté el desplegable obert si ja ho estava.
    const obert = els.fitxaCos.querySelector('details[open]');
    els.fitxaCos.innerHTML = html.join('');
    if (obert) els.fitxaCos.querySelector('details').open = true;
    els.fitxa.dataset.pend = pend;
  }

  function obreFitxa(id) {
    ui.fitxa = id;
    els.fitxaCos.innerHTML = '';
    renderFitxa();
    if (!els.fitxa.open) els.fitxa.showModal();
    els.fitxaCos.scrollTop = 0;
  }

  /* ---------- Vista: resum ---------- */

  function renderResum() {
    if (!dades) return;
    els.resum.innerHTML = R.PREMIS.map((pr) => {
      let guanyats = 0;
      let lliurats = 0;
      for (const p of persones) {
        if (p.punts < pr.punts) continue;
        guanyats++;
        if (marcaDe(p.id, pr.id)) lliurats++;
      }
      const falten = guanyats - lliurats;
      return (
        `<li><button type="button" data-premi="${pr.id}">` +
        `<span class="resum__nom">${escapa(pr.nom)}<small>${punts(pr.punts)} · ${guanyats} ${
          guanyats === 1 ? 'persona' : 'persones'
        }</small></span>` +
        `<span class="resum__xifres"><strong class="${falten ? '' : 'is-zero'}">${
          falten ? falten + ' per lliurar' : 'Tots lliurats'
        }</strong>${lliurats} lliurats</span>` +
        `<span class="barra"><span style="width:${guanyats ? (lliurats / guanyats) * 100 : 0}%"></span></span>` +
        `</button></li>`
      );
    }).join('');

    const exclosos = dades.esdeveniments.filter((e) => !R.compta(e));
    const dimarts = dades.esdeveniments.filter((e) => R.compta(e) && R.esDimarts(e));
    els.regles.innerHTML =
      `<p>Cada diada o entrenament amb resposta <strong>Vinc</strong> suma 1 punt. "Puc venir" i "Potser" no compten.</p>` +
      `<p>Els premis s'acumulen:</p><ul>${R.PREMIS.map(
        (pr) => `<li>${pr.punts} punts: ${escapa(pr.nom)}</li>`,
      ).join('')}<li>Més de ${R.SORTEIG_MIN - 1} punts: entra al sorteig</li></ul>` +
      (exclosos.length
        ? `<p>No compten: ${exclosos.map((e) => escapa(nomEsdeveniment(e))).join(', ')}.</p>`
        : '') +
      `<p>Els <strong>músics</strong> sumen 1 punt automàtic cada dimarts (${dimarts.length} ${
        dimarts.length === 1 ? 'entrenament' : 'entrenaments'
      }), perquè aquell dia no tenen assaig.</p>`;
  }

  /* ---------- Vista: sorteig ---------- */

  function llistaSorteig() {
    return persones.filter((p) => R.alSorteig(p.punts)).sort(perNom);
  }

  function renderSorteig() {
    if (!dades) return;
    const llista = llistaSorteig();
    els.sorteigN.textContent = llista.length;
    els.sorteigText.textContent = llista.length === 1 ? 'persona entra al sorteig' : 'persones entren al sorteig';
    els.sorteig.innerHTML = llista.length
      ? llista
          .map(
            (p) =>
              `<li><button type="button" class="fila" data-id="${escapa(p.id)}"><span class="fila__cos">` +
              `<span class="fila__nom">${escapa(p.nomVisible)}</span>` +
              (p.aliesVisible || p.music
                ? `<span class="fila__meta">${p.aliesVisible ? `<span>${escapa(p.aliesVisible)}</span>` : ''}${
                    p.music ? `<span class="etiqueta etiqueta--music">${icona.music}Músic</span>` : ''
                  }</span>`
                : '') +
              `</span><span class="punts is-sorteig"><span>${p.punts}<small>punts</small></span></span></button></li>`,
          )
          .join('')
      : `<li class="empty">Encara ningú té més de ${R.SORTEIG_MIN - 1} punts.</li>`;
  }

  async function copiaSorteig() {
    const text = llistaSorteig()
      .map((p, i) => `${i + 1}. ${p.nomVisible}${p.aliesVisible ? ` (${p.aliesVisible})` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Llista copiada');
    } catch {
      prompt('Copia la llista:', text);
    }
  }

  /* ---------- Render general ---------- */

  function render() {
    if (ui.tab === 'persones') renderPersones();
    if (ui.tab === 'resum') renderResum();
    if (ui.tab === 'sorteig') renderSorteig();
    if (els.fitxa.open) renderFitxa();
  }

  function pintaPestanyes() {
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === ui.tab);
    });
    document.querySelectorAll('.vista').forEach((v) => {
      v.hidden = v.id !== 'vista-' + ui.tab;
    });
  }

  function canviaPestanya(tab) {
    ui.tab = tab;
    desa('pa-ui', { tab: ui.tab, ordre: ui.ordre });
    pintaPestanyes();
    render();
    window.scrollTo(0, 0);
  }

  function pintaMenu() {
    els.menuNom.textContent = nomPersona() || 'Sense nom';
    const c = dades && dades.carrega;
    els.menuCarrega.textContent = c
      ? `Dades: ${c.fitxer || 'CSV'} · ${dataHora(c.t)}${c.per ? ' · ' + c.per : ''}`
      : 'Encara no s’ha carregat cap CSV';
  }

  /* ---------- Càrrega del CSV ---------- */

  async function carregaCsv(text, fitxer) {
    let taula;
    try {
      taula = R.preparaCarrega(text);
    } catch (err) {
      alert("No s'ha pogut llegir el CSV.\n\n" + err.message);
      return;
    }
    const resum = R.calcula(R.compacta(taula.capcalera, taula.files));
    const evs = taula.capcalera.slice(5);
    const noCompten = evs.filter((e) => !R.compta(e)).length;
    const ok = confirm(
      `${fitxer}\n\n` +
        `${resum.length} persones amb alguna assistència\n` +
        `${evs.length} esdeveniments (${noCompten} no compten)\n` +
        `${resum.filter((p) => R.alSorteig(p.punts)).length} entren al sorteig\n\n` +
        `Substituirà les dades actuals per a tothom. Els premis ja marcats es mantenen. Continuar?`,
    );
    if (!ok) return;
    try {
      const data = await crida(null, { accio: 'carrega', ...taula, fitxer, per: nomPersona() });
      aplicaDades(data.dades);
      carregaEstat().catch(() => {});
      toast(`Dades carregades: ${resum.length} persones`);
    } catch (err) {
      alert("No s'han pogut desar les dades.\n\n" + err.message);
    }
  }

  /* ---------- Esdeveniments ---------- */

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b && b.dataset.tab !== ui.tab) canviaPestanya(b.dataset.tab);
  });

  els.cerca.addEventListener('input', () => {
    ui.cerca = els.cerca.value.trim();
    renderPersones();
  });

  els.filtre.addEventListener('change', () => {
    ui.filtre = els.filtre.value;
    renderPersones();
  });

  els.ordre.addEventListener('change', () => {
    ui.ordre = els.ordre.value;
    desa('pa-ui', { tab: ui.tab, ordre: ui.ordre });
    renderPersones();
  });

  els.llista.addEventListener('click', (e) => {
    if (e.target.closest('[data-accio="csv"]')) return els.inputCsv.click();
    const b = e.target.closest('.fila');
    if (b) obreFitxa(b.dataset.id);
  });

  els.sorteig.addEventListener('click', (e) => {
    const b = e.target.closest('.fila');
    if (b) obreFitxa(b.dataset.id);
  });

  els.resum.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-premi]');
    if (!b) return;
    ui.filtre = 'p:' + b.dataset.premi;
    ui.cerca = els.cerca.value = '';
    ompleFiltre();
    canviaPestanya('persones');
  });

  els.fitxaCos.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-premi]');
    if (!b) return;
    const p = perId.get(ui.fitxa);
    const premi = R.PREMIS.find((x) => x.id === b.dataset.premi);
    if (marcaDe(p.id, premi.id)) {
      // Desmarcar demana confirmació per evitar tocs accidentals.
      if (!confirm(`Desmarcar ${premi.nom.toLowerCase()} com a lliurat a ${p.nomVisible}?`)) return;
      marca(p.id, premi.id, false);
    } else {
      marca(p.id, premi.id, true);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  });

  // Tancar els diàlegs: botó X o toc fora.
  for (const dlg of [els.fitxa, els.menu]) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-tanca]')) dlg.close();
    });
  }
  els.fitxa.addEventListener('close', () => {
    ui.fitxa = null;
    // Si cercaves algú, buida la cerca per buscar el següent ràpidament.
    if (ui.cerca) {
      els.cerca.value = ui.cerca = '';
      renderPersones();
    }
  });

  $('#btn-menu').addEventListener('click', () => {
    pintaMenu();
    els.menu.showModal();
  });
  $('#btn-perfil').addEventListener('click', demanaNom);
  $('#btn-csv').addEventListener('click', () => els.inputCsv.click());
  els.inputCsv.addEventListener('change', async () => {
    const f = els.inputCsv.files[0];
    els.inputCsv.value = '';
    if (!f) return;
    els.menu.close();
    await carregaCsv(await f.text(), f.name);
  });

  $('#btn-copia').addEventListener('click', copiaSorteig);

  // Refresc manual: el servidor torna a llegir el full saltant-se la memòria cau.
  const btnRefresca = $('#btn-refresca');
  btnRefresca.addEventListener('click', async () => {
    btnRefresca.disabled = true;
    btnRefresca.classList.add('is-girant');
    try {
      await enviaPendents();
      await carregaDades(true);
      await carregaEstat(true);
      toast('Dades i premis actualitzats');
    } catch {
      errorSync = true;
      pintaSync();
      toast("No s'ha pogut refrescar. Comprova la connexió.");
    } finally {
      btnRefresca.disabled = false;
      btnRefresca.classList.remove('is-girant');
    }
  });
  els.sync.addEventListener('click', () => {
    toast(
      darreraSync
        ? `Darrera actualització: ${new Date(darreraSync).toLocaleTimeString('ca-ES')}`
        : 'Encara no s’ha pogut connectar.',
    );
    refresca();
  });

  /* ---------- Bucle de sincronització ---------- */

  async function refresca() {
    try {
      await enviaPendents();
      await carregaEstat();
    } catch {
      errorSync = true;
      pintaSync();
    }
  }

  async function inicia() {
    ompleFiltre();
    pintaPestanyes();
    pintaSync();
    try {
      await carregaDades();
      await carregaEstat();
    } catch (err) {
      errorSync = true;
      pintaSync();
      els.llista.innerHTML = `<div class="empty"><p>No s'han pogut carregar les dades.<br>${escapa(
        err.message,
      )}</p><button type="button" class="btn" onclick="location.reload()">Torna-ho a provar</button></div>`;
      return;
    }
    if (!nomPersona()) demanaNom();

    setInterval(() => {
      if (document.visibilityState === 'visible') refresca();
    }, POLL_ESTAT_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresca();
    });
    window.addEventListener('online', refresca);
  }

  /* ---------- Mode demo (sense backend) ---------- */

  function demo(params, cos) {
    const estat = llegeix('pa-demo-estat', { v: 0, vd: 0, marques: {} });
    const espera = (x) => new Promise((r) => setTimeout(() => r(x), 250));
    if (cos && cos.accio === 'carrega') {
      desa('pa-demo-dades', {
        ...R.compacta(cos.capcalera, cos.files),
        carrega: { fitxer: cos.fitxer, per: cos.per, t: Date.now(), n: cos.files.length },
      });
      estat.vd++;
      desa('pa-demo-estat', estat);
      return espera({ dades: llegeix('pa-demo-dades') });
    }
    if (cos) {
      const clau = cos.id + '|' + cos.premi;
      if (cos.lliurat) estat.marques[clau] = { per: cos.per, t: Date.now() };
      else delete estat.marques[clau];
      estat.v++;
      desa('pa-demo-estat', estat);
      return espera(estat);
    }
    if (params.a === 'dades') return Promise.resolve({ dades: llegeix('pa-demo-dades') || dadesDemo() });
    return Promise.resolve(estat);
  }

  function dadesDemo() {
    const esdeveniments = [
      'ENTRENAMENT DT 01/09',
      'ENTRENAMENT DV 04/09',
      'FESTA MAJOR DE SABADELL',
      'ENTRENAMENT DT 08/09',
      'ENTRENAMENT DJ 10/09',
      'PILAR I OFRENA AL FOSSAR DE LES MORERES',
      'DIADA DE 1714',
      'PREGÓ DE LA FESTA MAJOR DEL POBLENOU',
      "XXXII DIADA DE L'AVI EMILI MIRÓ",
      'ENTRENAMENT DT 15/09',
      'ENTRENAMENT DV 18/09',
      'FESTA MAJOR DEL POBLENOU',
      'ENTRENAMENT DT 22/09',
      'ENTRENAMENT DC 23/09',
      'MATINADES DE LA MERCÈ',
      'LA MERCÈ',
      'CONCERT DELS AMICS DE LES ARTS',
      'ENTRENAMENT DT 29/09',
      'ENTRENAMENT DV 02/10',
      'XXX CONCURS DE CASTELLS DE TARRAGONA',
    ];
    const gent = [
      ['ANNA', 'PUIG', 'ANNETA', 'CROSSES'],
      ['JORDI', 'SOLER', 'JORDI', 'LATERALS'],
      ['MARIA', 'FONT', 'MARIA F.', 'BAIXOS'],
      ['PAU', 'VIDAL', 'PAU', 'MÚSICS'],
      ['LAIA', 'ROCA', 'LAIA', 'MANS'],
      ['MARC', 'SERRA', 'MARQUET', 'CORDONS'],
      ['NÚRIA', 'COSTA', 'NÚRIA', 'MÚSICS'],
      ['ORIOL', 'MARTÍ', 'ORIOL', 'NOVATOS'],
      ['CLARA', 'PONS', 'CLARA', 'AGULLES+CONTRAFORTS'],
      ['ARNAU', 'GIL', 'ARNAU', 'CANALLA'],
      ['JÚLIA', 'BOSCH', 'JULIETA', 'CROSSES'],
      ['POL', 'CASAS', 'POL', 'NOVATOS'],
    ];
    // Assistències deterministes perquè la demo sigui sempre igual.
    const persones = gent.map(([nom, cognom, alies, posicio], i) => ({
      id: String(100 + i),
      nom,
      cognom,
      alies,
      posicio,
      s: esdeveniments.map((_, j) => ((i * 7 + j * 3) % 11 < 11 - i * 0.8 ? 'V' : 'N')).join(''),
    }));
    return { esdeveniments, persones, carrega: null };
  }

  // Per provar en local: Premis.carregaCsv(text, 'nom.csv') des de la consola.
  if (DEMO) window.Premis = { carregaCsv };

  inicia();
})();
