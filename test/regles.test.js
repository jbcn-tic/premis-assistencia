const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../docs/regles.js');

const CSV = [
  '﻿ID,Nom,"Primer cognom",Àlies,Posició,"Posició tronc",Telèfon,Email,Habitual?,"ENTRENAMENT DT 01/09","ENTRENAMENT DV 04/09","DIADA DE 1714","MATINADES DE LA MERCÈ","ENTRENAMENT DT 08/09"',
  '1,ANNA,"DE LA ROSA",ANNETA,CROSSES,QUINTS,600000000,a@x.cat,Sí,Vinc,Vinc,"No vinc",Vinc,',
  '2,JOAN,PUIG,JOAN,MÚSICS,ALTRES,600000001,j@x.cat,No,,Vinc,,,"Puc venir"',
  '3,PERE,SOLER,PERE,MÚSICS,ALTRES,600000002,p@x.cat,No,,,,Vinc,',
  '4,MARTA,ROCA,MARTA,BAIXOS,BAIXOS,600000003,m@x.cat,No,"No vinc",Potser,,,',
].join('\r\n');

test('parseCsv entén cometes, cometes dobles, CRLF i punt i coma', () => {
  assert.deepEqual(R.parseCsv('a,"b ""c"", d"\r\n1,2\r\n'), [
    ['a', 'b "c", d'],
    ['1', '2'],
  ]);
  assert.deepEqual(R.parseCsv('a;b\n"x;y";z'), [
    ['a', 'b'],
    ['x;y', 'z'],
  ]);
});

test('preparaCarrega es queda només amb les columnes necessàries i la gent amb algun Vinc', () => {
  const { capcalera, files } = R.preparaCarrega(CSV);
  assert.deepEqual(capcalera, [
    'ID',
    'Nom',
    'Primer cognom',
    'Àlies',
    'Posició',
    'ENTRENAMENT DT 01/09',
    'ENTRENAMENT DV 04/09',
    'DIADA DE 1714',
    'MATINADES DE LA MERCÈ',
    'ENTRENAMENT DT 08/09',
  ]);
  assert.deepEqual(
    files.map((f) => f[0]),
    ['1', '2', '3'],
  );
  assert.ok(!JSON.stringify(files).includes('@'), 'no hi ha correus');
});

test('preparaCarrega avisa si falten columnes', () => {
  assert.throws(() => R.preparaCarrega('Nom,Cognom\nA,B'), /Falten columnes/);
});

test('calcula punts: esdeveniments que no compten i dimarts automàtics dels músics', () => {
  const { capcalera, files } = R.preparaCarrega(CSV);
  const persones = R.calcula(R.compacta(capcalera, files));
  const per = Object.fromEntries(persones.map((p) => [p.id, p]));

  // Anna: DT 01/09 + DV 04/09 (Matinades no compta).
  assert.equal(per['1'].punts, 2);
  assert.equal(per['1'].music, false);

  // Joan (músic): DV 04/09 + els dos dimarts automàtics.
  assert.equal(per['2'].punts, 3);
  assert.equal(per['2'].auto, 2);
  assert.equal(per['2'].music, true);

  // Pere (músic) només va venir a Matinades, que no compta: no ha participat.
  assert.equal(per['3'], undefined);
  // Marta no té cap Vinc.
  assert.equal(per['4'], undefined);
});

test('un músic que confirma un dimarts no suma dos punts', () => {
  const dades = {
    esdeveniments: ['ENTRENAMENT DT 01/09', 'ENTRENAMENT DV 04/09'],
    persones: [{ id: '9', nom: 'X', cognom: 'Y', alies: '', posicio: 'MÚSICS', s: 'VV' }],
  };
  assert.equal(R.calcula(dades)[0].punts, 2);
});

test('premis acumulats i sorteig a partir de 16 punts', () => {
  assert.deepEqual(R.premisGuanyats(2), []);
  assert.deepEqual(
    R.premisGuanyats(9).map((p) => p.id),
    ['enganxina', 'beguda', 'clauer'],
  );
  assert.equal(R.premisGuanyats(15).length, 5);
  assert.equal(R.alSorteig(15), false);
  assert.equal(R.alSorteig(16), true);
});

test('compta() ignora majúscules i accents', () => {
  assert.equal(R.compta('Matinades de la Merce'), false);
  assert.equal(R.compta('LA MERCÈ'), true);
});
