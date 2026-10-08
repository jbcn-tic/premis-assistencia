/**
 * Regles dels premis d'assistència i lectura del CSV.
 *
 * Funcions pures, sense DOM: les fa servir app.js al navegador i les proves
 * (node --test) des de Node.
 */
(function (root) {
  'use strict';

  // Premis acumulats: en arribar als punts, es guanya el premi (i es manté).
  const PREMIS = [
    { id: 'enganxina', nom: 'Enganxina', punts: 3 },
    { id: 'beguda', nom: 'Beguda', punts: 6 },
    { id: 'clauer', nom: 'Clauer', punts: 9 },
    { id: 'sopar', nom: 'Sopar i beguda', punts: 12 },
    { id: 'mocador', nom: 'Mocador', punts: 15 },
  ];

  // "Més de 15 punts" → entra al sorteig.
  const SORTEIG_MIN = 16;

  // Esdeveniments del CSV que no sumen punts.
  const NO_COMPTEN = [
    'PILAR I OFRENA AL FOSSAR DE LES MORERES',
    'PREGÓ DE LA FESTA MAJOR DEL POBLENOU',
    'MATINADES DE LA MERCÈ',
    'CONCERT DELS AMICS DE LES ARTS',
  ];

  // Els músics no tenen assaig els dimarts: aquests entrenaments els sumen 1 punt sempre.
  const ES_DIMARTS = /^ENTRENAMENT\s+DT\b/i;
  const ES_MUSIC = /music/;

  // Estats d'assistència del CSV ↔ codi d'un caràcter.
  const ESTATS = { Vinc: 'V', 'No vinc': 'N', 'Puc venir': 'P', Potser: '?' };
  const VINC = 'V';

  // Columnes de la persona que es guarden (la resta, com telèfon o correu, no surten del mòbil).
  const COLUMNES_PERSONA = ['ID', 'Nom', 'Primer cognom', 'Àlies', 'Posició'];

  const normalitza = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const NO_COMPTEN_NORM = NO_COMPTEN.map(normalitza);

  /* ---------- CSV ---------- */

  /** Parser RFC 4180 (cometes, salts de línia dins de camps, CRLF, BOM). */
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
    const primera = text.slice(0, text.indexOf('\n') >>> 0);
    // Excel en català/castellà exporta amb punt i coma.
    const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
    const files = [];
    let fila = [];
    let camp = '';
    let entreCometes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (entreCometes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            camp += '"';
            i++;
          } else entreCometes = false;
        } else camp += c;
      } else if (c === '"') entreCometes = true;
      else if (c === sep) {
        fila.push(camp);
        camp = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        fila.push(camp);
        files.push(fila);
        fila = [];
        camp = '';
      } else camp += c;
    }
    if (camp || fila.length) {
      fila.push(camp);
      files.push(fila);
    }
    return files.filter((f) => f.some((c) => c.trim()));
  }

  /**
   * Del CSV exportat a la taula que es guarda al full: només ID, nom, cognom,
   * àlies, posició i els esdeveniments, i només la gent amb algun "Vinc".
   */
  function preparaCarrega(text) {
    const [cap, ...files] = parseCsv(text);
    if (!cap) throw new Error('El fitxer és buit.');
    const net = cap.map((c) => c.trim());
    const idx = COLUMNES_PERSONA.map((nom) => net.findIndex((c) => normalitza(c) === normalitza(nom)));
    const falten = COLUMNES_PERSONA.filter((_, i) => idx[i] < 0);
    if (falten.length) throw new Error('Falten columnes al CSV: ' + falten.join(', '));

    // Una columna és un esdeveniment si tots els seus valors són estats d'assistència.
    const esdeveniments = [];
    net.forEach((nom, i) => {
      if (idx.includes(i)) return;
      let algun = false;
      for (const f of files) {
        const v = (f[i] || '').trim();
        if (!v) continue;
        if (!(v in ESTATS)) return;
        algun = true;
      }
      if (algun) esdeveniments.push(i);
    });
    if (!esdeveniments.length) throw new Error("No s'ha trobat cap columna d'assistència (Vinc / No vinc).");

    const out = [];
    for (const f of files) {
      const id = (f[idx[0]] || '').trim();
      if (!id) continue;
      if (!esdeveniments.some((i) => (f[i] || '').trim() === 'Vinc')) continue;
      out.push([...idx.map((i) => (f[i] || '').trim()), ...esdeveniments.map((i) => (f[i] || '').trim())]);
    }
    return {
      capcalera: [...COLUMNES_PERSONA, ...esdeveniments.map((i) => net[i])],
      files: out,
    };
  }

  /** Taula del full (capçalera + files) → format compacte que serveix el backend. */
  function compacta(capcalera, files) {
    const n = COLUMNES_PERSONA.length;
    return {
      esdeveniments: capcalera.slice(n),
      persones: files.map((f) => ({
        id: String(f[0]),
        nom: f[1],
        cognom: f[2],
        alies: f[3],
        posicio: f[4],
        s: f
          .slice(n)
          .map((v) => ESTATS[String(v).trim()] || '-')
          .join(''),
      })),
    };
  }

  /* ---------- Punts ---------- */

  const compta = (nomEsdeveniment) => !NO_COMPTEN_NORM.includes(normalitza(nomEsdeveniment));
  const esDimarts = (nomEsdeveniment) => ES_DIMARTS.test(String(nomEsdeveniment).trim());
  const esMusic = (posicio) => ES_MUSIC.test(normalitza(posicio));

  /**
   * dades = { esdeveniments: [noms], persones: [{ id, nom, cognom, alies, posicio, s }] }
   * on `s` té un caràcter per esdeveniment (V, N, P, ?, -).
   * Torna les persones amb algun "Vinc" que compti, amb els punts i el detall.
   */
  function calcula(dades) {
    const evs = dades.esdeveniments.map((nom) => ({ nom, compta: compta(nom), dimarts: esDimarts(nom) }));
    const persones = [];
    for (const p of dades.persones) {
      const music = esMusic(p.posicio);
      const detall = [];
      let punts = 0;
      let reals = 0;
      let auto = 0;
      evs.forEach((ev, i) => {
        const vinc = p.s[i] === VINC;
        let tipus = '';
        if (ev.compta && vinc) tipus = 'vinc';
        else if (ev.compta && music && ev.dimarts) tipus = 'auto';
        else if (vinc) tipus = 'no-compta';
        if (tipus === 'vinc') reals++;
        if (tipus === 'auto') auto++;
        if (tipus === 'vinc' || tipus === 'auto') punts++;
        detall.push({ nom: ev.nom, tipus });
      });
      // Qui no ha vingut a res que compti no ha participat (encara que sigui músic).
      if (!reals) continue;
      persones.push({ ...p, music, punts, auto, detall });
    }
    return persones;
  }

  const premisGuanyats = (punts) => PREMIS.filter((pr) => punts >= pr.punts);
  const alSorteig = (punts) => punts >= SORTEIG_MIN;
  const nomComplet = (p) => [p.nom, p.cognom].filter(Boolean).join(' ');

  const api = {
    PREMIS,
    SORTEIG_MIN,
    NO_COMPTEN,
    ESTATS,
    normalitza,
    parseCsv,
    preparaCarrega,
    compacta,
    compta,
    esDimarts,
    esMusic,
    calcula,
    premisGuanyats,
    alSorteig,
    nomComplet,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Regles = api;
})(this);
