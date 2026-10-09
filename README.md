# Premis d'assistència

Web pensada per a mòbil per lliurar els premis d'assistència de setembre (fins al
primer cap de setmana d'octubre). Diverses persones poden marcar premis alhora i
tothom veu els canvis en pocs segons.

- **Persones** — tothom qui ha vingut a alguna cosa, amb els punts i l'estat de
  cada premi. Cercador per nom, cognom o àlies (sense accents), filtres (amb
  premis per lliurar, músics, per premi, sorteig) i ordre per punts o per nom.
  En tocar una persona s'obre la fitxa: punts, premis guanyats i per guanyar,
  i el detall de cada esdeveniment. Toca un premi per marcar-lo com a lliurat.
- **Repartir** — per a qui reparteix un premi concret: tries el premi (enganxina,
  beguda…) i només surt qui hi opta, amb cercador i filtre per lliurar /
  lliurats / tots. Un toc a la fila el marca com a lliurat; les files marcades
  es queden a la vista fins que canvies de filtre, perquè la llista no es mogui
  sota el dit.
- **Premis** — quants se n'han guanyat i quants falten per lliurar de cada un.
  Tocant-ne un s'obre *Repartir* amb aquell premi.
- **Sorteig** — qui hi entra, amb un botó per copiar la llista.

## Regles

Cada diada o entrenament amb resposta **Vinc** suma 1 punt ("Puc venir" i
"Potser" no compten). Els premis s'acumulen:

| Punts | Premi          |
| ----- | -------------- |
| 3     | Enganxina      |
| 6     | Beguda         |
| 9     | Clauer         |
| 12    | Sopar i beguda |
| 15    | Mocador        |
| >15   | Sorteig        |

No compten: Pilar i ofrena al Fossar de les Moreres, Pregó de la Festa Major
del Poblenou, Matinades de la Mercè i Concert dels Amics de les Arts.

Els **músics** (posició "Músics") sumen 1 punt automàtic a cada entrenament de
dimarts (`ENTRENAMENT DT …`), perquè aquell dia no tenen assaig. Només surt a
la llista qui té com a mínim un "Vinc" que compti.

Tot això és a [`docs/regles.js`](docs/regles.js).

## Com funciona

```
docs/          → frontend estàtic (GitHub Pages)
apps-script/   → backend (Google Apps Script vinculat a un full de càlcul)
test/          → proves de les regles (npm test)
```

El CSV es carrega des de l'app (menú ⋮ → *Carrega el CSV d'assistència*). El
mòbil el llegeix i només envia ID, nom, primer cognom, àlies, posició i les
respostes de cada esdeveniment: **telèfons i correus no surten del mòbil**. El
backend ho desa a la pestanya **`Assistència`** del full i els lliuraments a
**`Lliuraments`** (persona, premi, per qui i quan). Tornar a carregar un CSV
substitueix l'assistència però manté els premis marcats.

El frontend consulta l'estat cada 3 s. Si algú carrega un CSV nou, la resta
d'aparells el recullen sols. Si no hi ha cobertura, les marques es guarden al
mòbil i s'envien quan torna la connexió (l'indicador de dalt ho mostra).

Desmarcar un premi demana confirmació, per evitar tocs accidentals.

> Els CSV tenen dades personals: **no es pugen mai al repositori** (`*.csv` és
> a `.gitignore`).

## On és cada cosa

- **Full de càlcul:** [Premis d'assistència 2026](https://docs.google.com/spreadsheets/d/1t0eee2QVuaMrSPuzZ9sJIB1JrwMg5i2pKX53TFZO8l8/edit)
  (compte direccio@jovedebarcelona.cat).
- **Apps Script** vinculat al full: [editor](https://script.google.com/d/130KH9H18vWRrud9HPSUNZmsHExIOi-KUUUX-qlQJZ6zpIXXfh8voHj1Q/edit).
  Fitxers `Codi` (= `apps-script/Codi.gs`), `appsscript` i `Secret`.
- **Codi d'accés:** és a `Secret` (constant `CODI_ACCES`), que **només és a Apps
  Script**, no al repositori. La web el demana el primer cop i el recorda.
  També es pot posar com a propietat de l'script `CODI`, que té prioritat.

## Canviar el backend

1. Edita `apps-script/Codi.gs` i enganxa'l al fitxer `Codi` de l'editor.
2. **Implementa → Gestiona les implementacions → ✏️ → Versió: nova** i desa.
   La URL `/exec` no canvia.

Si es fa un projecte nou des de zero: crea un full, **Extensions → Apps
Script**, enganxa-hi `Codi.gs`, `appsscript.json` i un fitxer `Secret` amb
`const CODI_ACCES = '…';`, executa `prepara` per autoritzar-lo, implementa'l com
a aplicació web (executa com a "Jo", accés "Qualsevol persona") i posa la URL a
`docs/config.js`.

Si s'edita el full a mà, executa `buidaCache` (o toca ⟳ a la web) perquè l'app
ho torni a llegir.

## Desenvolupament

GitHub Pages deixa els fitxers en memòria cau 10 minuts: quan canviïs `app.js`,
`style.css`, `regles.js` o `config.js`, puja el número `?v=` de `index.html`
perquè els mòbils agafin la versió nova de seguida.

Sense URL a `config.js` (o amb `?demo` a la URL) l'app funciona en mode demo
amb dades inventades guardades al navegador.

```bash
npm run dev
```

```bash
npm test
```
