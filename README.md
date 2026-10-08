# Premis d'assistència

Web pensada per a mòbil per lliurar els premis d'assistència de setembre (fins al
primer cap de setmana d'octubre). Diverses persones poden marcar premis alhora i
tothom veu els canvis en pocs segons.

- **Persones** — tothom qui ha vingut a alguna cosa, amb els punts i l'estat de
  cada premi. Cercador per nom, cognom o àlies (sense accents), filtres (amb
  premis per lliurar, músics, per premi, sorteig) i ordre per punts o per nom.
  En tocar una persona s'obre la fitxa: punts, premis guanyats i per guanyar,
  i el detall de cada esdeveniment. Toca un premi per marcar-lo com a lliurat.
- **Premis** — quants se n'han guanyat i quants falten per lliurar de cada un.
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

## Posar-ho en marxa

1. Crea un full de càlcul de Google nou (p. ex. "Premis d'assistència 2026").
2. Al full, **Extensions → Apps Script**. Enganxa-hi `apps-script/Codi.gs` i
   `apps-script/appsscript.json` (cal activar "Mostra el fitxer de manifest"
   a la configuració del projecte).
3. (Recomanat) A **Configuració del projecte → Propietats de l'script**,
   afegeix `CODI` amb una paraula clau. La web la demanarà el primer cop i la
   recordarà.
4. Executa la funció `prepara` un cop per autoritzar-la i crear les pestanyes.
5. **Implementa → Implementació nova → Aplicació web**, executa com a "Jo" i
   accés "Qualsevol persona". Copia la URL acabada en `/exec`.
6. Posa aquesta URL a `docs/config.js` i publica.
7. Obre la web, menú ⋮ → *Carrega el CSV d'assistència*.

Si s'edita el full a mà, executa `buidaCache` (o toca ⟳ a la web) perquè l'app
ho torni a llegir.

## Desenvolupament

Sense URL a `config.js` (o amb `?demo` a la URL) l'app funciona en mode demo
amb dades inventades guardades al navegador.

```bash
npm run dev
```

```bash
npm test
```
