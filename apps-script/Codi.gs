/**
 * Backend de "Premis d'assistència".
 *
 * Script vinculat a un full de càlcul (Extensions → Apps Script). Guarda:
 *   - "Assistència": l'última càrrega del CSV (només ID, nom, cognom, àlies,
 *     posició i l'estat de cada esdeveniment). Es pot editar a mà.
 *   - "Lliuraments": quin premi s'ha donat a qui, per qui i quan.
 * El frontend (GitHub Pages) consulta l'estat cada pocs segons per veure els
 * canvis dels altres.
 *
 * Endpoints (web app, "Qualsevol persona"):
 *   GET  ?a=dades&codi=…   → { dades: { esdeveniments, persones, carrega } }
 *   GET  ?a=estat&codi=…   → { v, vd, marques: { "<id>|<premi>": { per, t } } }
 *        (amb &fresc=1 qualsevol dels dos GET torna a llegir el full)
 *   POST {codi, accio:'marca', id, premi, lliurat, per}       → igual que ?a=estat
 *   POST {codi, accio:'carrega', capcalera, files, fitxer, per} → igual que ?a=dades
 *
 * Si la propietat de l'script CODI té valor, totes les peticions l'han de
 * portar (protecció bàsica perquè les dades no siguin públiques).
 */

const FULL_ASSISTENCIA = 'Assistència';
const FULL_LLIURAMENTS = 'Lliuraments';
const PREMIS_VALIDS = ['enganxina', 'beguda', 'clauer', 'sopar', 'mocador'];
const COLUMNES_PERSONA = 5; // ID, Nom, Primer cognom, Àlies, Posició
const ESTATS = { Vinc: 'V', 'No vinc': 'N', 'Puc venir': 'P', Potser: '?' };
const CACHE_S = 21600;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!codiValid_(p.codi)) return json_({ error: 'codi' });
  if (p.a === 'dades') {
    if (p.fresc) CacheService.getScriptCache().remove('dades');
    return json_({ dades: dades_() });
  }
  if (p.fresc) return json_(desaEstatACache_(llegeixEstatDelFull_()));
  return json_(estat_());
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'json' });
  }
  if (!codiValid_(body.codi)) return json_({ error: 'codi' });
  const per = String(body.per || '').slice(0, 40);

  if (body.accio === 'carrega') {
    if (!Array.isArray(body.capcalera) || !Array.isArray(body.files)) {
      return json_({ error: 'parametres' });
    }
    return json_({ dades: carrega_(body.capcalera, body.files, String(body.fitxer || ''), per) });
  }

  if (PREMIS_VALIDS.indexOf(body.premi) < 0 || !body.id) return json_({ error: 'parametres' });
  marca_(String(body.id), body.premi, !!body.lliurat, per);
  return json_(estat_());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function codiValid_(codi) {
  const esperat = PropertiesService.getScriptProperties().getProperty('CODI');
  return !esperat || String(codi || '').trim().toLowerCase() === esperat.trim().toLowerCase();
}

function full_(nom, capcalera) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    if (capcalera) {
      sh.getRange(1, 1, 1, capcalera.length).setValues([capcalera]);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function versio_(clau) {
  return Number(PropertiesService.getScriptProperties().getProperty(clau) || 0);
}

function incrementa_(clau) {
  const v = versio_(clau) + 1;
  PropertiesService.getScriptProperties().setProperty(clau, String(v));
  return v;
}

/* ---------- Dades d'assistència ---------- */

function dades_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dades');
  if (cached) return JSON.parse(cached);

  const sh = full_(FULL_ASSISTENCIA);
  const valors = sh.getDataRange().getDisplayValues();
  const capcalera = valors[0] || [];
  const persones = [];
  for (let i = 1; i < valors.length; i++) {
    const f = valors[i];
    const id = String(f[0] || '').trim();
    if (!id) continue;
    persones.push({
      id: id,
      nom: f[1],
      cognom: f[2],
      alies: f[3],
      posicio: f[4],
      s: f
        .slice(COLUMNES_PERSONA)
        .map((v) => ESTATS[String(v).trim()] || '-')
        .join(''),
    });
  }
  const props = PropertiesService.getScriptProperties();
  const result = {
    esdeveniments: capcalera.slice(COLUMNES_PERSONA).filter(String),
    persones: persones,
    carrega: JSON.parse(props.getProperty('CARREGA') || 'null'),
  };
  cache.put('dades', JSON.stringify(result), CACHE_S);
  return result;
}

function carrega_(capcalera, files, fitxer, per) {
  const amplada = capcalera.length;
  if (amplada <= COLUMNES_PERSONA) throw new Error('Capçalera sense esdeveniments');
  const taula = [capcalera.map(String)].concat(
    files.map((f) => {
      const fila = [];
      for (let i = 0; i < amplada; i++) fila.push(String(f[i] == null ? '' : f[i]));
      return fila;
    }),
  );

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = full_(FULL_ASSISTENCIA);
    sh.clear();
    const rang = sh.getRange(1, 1, taula.length, amplada);
    rang.setNumberFormat('@'); // tot com a text: els ID i les dates no es converteixen
    rang.setValues(taula);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);

    PropertiesService.getScriptProperties().setProperty(
      'CARREGA',
      JSON.stringify({ fitxer: fitxer.slice(0, 120), per: per, t: Date.now(), n: files.length }),
    );
    incrementa_('VERSIO_DADES');
    CacheService.getScriptCache().removeAll(['dades', 'estat']);
  } finally {
    lock.releaseLock();
  }
  return dades_();
}

/* ---------- Lliuraments de premis ---------- */

function fullLliuraments_() {
  return full_(FULL_LLIURAMENTS, ['ID', 'Premi', 'Lliurat', 'Per', 'Hora', 'Clau']);
}

function estat_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('estat');
  if (cached) return JSON.parse(cached);
  return desaEstatACache_(llegeixEstatDelFull_());
}

function llegeixEstatDelFull_() {
  const sh = fullLliuraments_();
  const n = sh.getLastRow() - 1;
  const marques = {};
  if (n > 0) {
    sh.getRange(2, 1, n, 5)
      .getValues()
      .forEach((r) => {
        if (r[2] === true) {
          marques[r[0] + '|' + r[1]] = {
            per: r[3],
            t: r[4] instanceof Date ? r[4].getTime() : null,
          };
        }
      });
  }
  return { v: versio_('VERSIO'), vd: versio_('VERSIO_DADES'), marques: marques };
}

function desaEstatACache_(estat) {
  CacheService.getScriptCache().put('estat', JSON.stringify(estat), CACHE_S);
  return estat;
}

function marca_(id, premi, lliurat, per) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = fullLliuraments_();
    const clau = id + '|' + premi;
    const n = sh.getLastRow() - 1;
    let fila = -1;
    if (n > 0) {
      const claus = sh.getRange(2, 6, n, 1).getValues();
      for (let i = 0; i < claus.length; i++) {
        if (claus[i][0] === clau) {
          fila = i + 2;
          break;
        }
      }
    }
    const ara = new Date();
    const valors = [[id, premi, lliurat, per, ara, clau]];
    if (fila > 0) sh.getRange(fila, 1, 1, 6).setValues(valors);
    else {
      sh.appendRow(valors[0]);
      fila = sh.getLastRow();
    }
    sh.getRange(fila, 1).setNumberFormat('@').setValue(id);

    const v = incrementa_('VERSIO');
    const estat = estat_();
    if (lliurat) estat.marques[clau] = { per: per, t: ara.getTime() };
    else delete estat.marques[clau];
    estat.v = v;
    desaEstatACache_(estat);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Utilitats per executar des de l'editor ---------- */

/** Executa-la un cop des de l'editor per autoritzar i crear les pestanyes. */
function prepara() {
  full_(FULL_ASSISTENCIA);
  fullLliuraments_();
  buidaCache();
  Logger.log('Persones carregades: ' + dades_().persones.length);
}

/** Si s'edita el full a mà, força que l'app ho torni a llegir. */
function buidaCache() {
  incrementa_('VERSIO_DADES');
  CacheService.getScriptCache().removeAll(['dades', 'estat']);
}
