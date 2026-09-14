# 07 – Fejlesztői workflow: hogyan dolgozz profin

A böngészős szerkesztő tökéletes egy 50 soros scripthez. Egy éles, ügyfélnek
átadott megoldáshoz kevés. Ez a fejezet arról szól, mikor és hogyan lépj tovább.

---

## Mikor lépj ki a böngészőből

| Jel | Mit csinálj |
|---|---|
| < 200 sor, egy ember, egyszeri feladat | Maradj a böngészőben. Ne bonyolítsd. |
| Ügyfélnek adod át | `clasp` + git — legalább a kód mentése verziókezelőbe |
| Ketten nyúltok hozzá | `clasp` + git **kötelező** (a böngészőben nincs merge) |
| 500+ sor, vagy típusokat hiányolsz | TypeScript + `clasp` |
| npm csomagot akarsz használni | Bundler (esbuild) + `clasp` |

---

## clasp: a parancssori eszköz

```bash
npm install -g @google/clasp
clasp login                       # böngészős OAuth

# Meglévő projekt letöltése
clasp clone <SCRIPT_ID>

# Új projekt
clasp create --title "Hypin – Meta Sync" --type standalone

# Munkafolyamat
clasp pull                        # szerver → lokál (ha a böngészőben is nyúltak hozzá)
clasp push                        # lokál → szerver
clasp push --watch                # automatikus feltöltés mentéskor
clasp open                        # megnyitja a szerkesztőben
clasp deployments                 # deployment-ek listája
clasp deploy -d "v1.3 – ROAS oszlop"
```

> A `clasp login` OAuth tokent ír a gépedre. Céges gépen tartsd, `.clasprc.json`
> **soha ne kerüljön git-be**.

### Kötelező `.gitignore`

```gitignore
.clasp.json          # script ID-t és lokális útvonalat tartalmaz
.clasprc.json        # OAuth token – SOHA ne kerüljön be
node_modules/
build/
*.local.*
```

> A `.clasp.json`-t sokan bent hagyják, mert csak egy ID. Két okból ne tedd:
> egyrészt fejlesztőnként más lehet (dev/prod projekt), másrészt a script ID
> önmagában is információ. Adj helyette `.clasp.example.json`-t.

---

## Az `appsscript.json` anatómiája

Ez a projekt manifesztje. A szerkesztőben alapból rejtett
(*Projekt beállítások → „appsscript.json" megjelenítése*). **Kapcsold be, és
kezeld tudatosan.**

```json
{
  "timeZone": "Europe/Budapest",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Sheets", "serviceId": "sheets", "version": "v4" },
      { "userSymbol": "Drive",  "serviceId": "drive",  "version": "v3" }
    ],
    "libraries": []
  },
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

| Mező | Miért fontos |
|---|---|
| `timeZone` | **Ezt mindig állítsd be.** Ettől függ, mikor fut a napi trigger, és mit ír a `new Date()` a Sheetbe. Az alapérték gyakran amerikai. |
| `runtimeVersion` | `V8` — a Rhino 2025 óta elavult |
| `oauthScopes` | Explicit scope-minimalizálás, lásd [06](06-biztonsag-es-uzemeltetes.md) |
| `exceptionLogging` | `STACKDRIVER` → hibák a Cloud Loggingba |
| `enabledAdvancedServices` | A batch API-k engedélyezése |
| `webapp` | Ki futtatja és ki érheti el — **biztonsági döntés** |

---

## Verziók és deployment: a legtöbbet félreértett rész

Az Apps Scriptben a **mentés ≠ élesítés**. Két dolog van:

- **HEAD (`@HEAD`)** – a legutóbb mentett kód. A szerkesztőből futtatva és a
  **triggerek által** mindig ez fut.
- **Verziózott deployment** – egy befagyasztott pillanatkép. A webapp és a
  library ezt szolgálja ki (ha nem `@HEAD`-re deployoltál).

**A gyakorlati következmények:**

1. **Triggerek mindig a HEAD-et futtatják.** Tehát amint mentesz egy félkész
   kódot, a következő trigger-futás azt viszi. *Ezért kell a `DRY_RUN` és az `ENABLED`.*
2. **Webappnál a mentés nem elég.** Ha módosítasz és nem csinálsz új deployment-et
   (vagy nem `@HEAD`-re deployoltál), a felhasználók a régi kódot kapják. Ez a
   „miért nem látszik a javításom?" klasszikus oka.
3. **Library-nél a fogyasztó verziót pinnel.** Új verzió = a fogyasztóknál kézzel
   át kell állítani.

### Dev / prod szétválasztás

Az Apps Scriptben nincs beépített környezetkezelés. Két bevált megoldás:

**A) Két külön script projekt (ajánlott ügyfélmunkához)**
```
Hypin – Meta Sync [DEV]    → teszt Sheet, teszt API kulcs
Hypin – Meta Sync [PROD]   → éles Sheet, éles kulcs, triggerek
```
Ugyanaz a git repo, két `clasp` target:
```bash
clasp push                                  # a .clasp.json szerinti projekt
# vagy explicit:
npx clasp push --project .clasp.prod.json
```

**B) Egy projekt, környezetfüggő konfiguráció**
```javascript
function getEnv_() {
  return PropertiesService.getScriptProperties().getProperty('ENV') || 'dev';
}
const TARGETS = {
  dev:  { sheetId: '1abc...', chatWebhook: '...' },
  prod: { sheetId: '1xyz...', chatWebhook: '...' }
};
```

Kisebb kockázat: A). Kevesebb adminisztráció: B). Ügyféladat esetén **mindig A**.

---

## TypeScript és npm

A `clasp` transzpilálja a `.ts` fájlokat. Típusokhoz:

```bash
npm install --save-dev @types/google-apps-script typescript
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019"],
    "types": ["google-apps-script"],
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

**Amire figyelj:**
- **Ne használj `import`/`export`-ot** a fájlok között — az Apps Script fájljai
  egy közös globális névtérben élnek. A `clasp` a moduláris fájlokat nem tudja
  natívan összefűzni.
- **Névütközés némán felülír.** Két fájlban két azonos nevű függvény → az egyik
  eltűnik, hibaüzenet nélkül. Használj prefixet (`Http_get_`, `Sheet_read_`)
  vagy objektum-névteret.
- **Fájlsorrend számít** a legfelső szintű utasításoknál (a `const X = ...`
  fut betöltéskor), a függvénydeklarációknál nem. Ezért a fájlnév-prefix
  (`00_Config`, `01_Lib_…`, `10_Main`) nemcsak rendrakás, hanem funkcionális.

**npm csomag kell?** Akkor bundler:
```bash
esbuild src/main.ts --bundle --format=iife --global-name=App \
  --target=es2019 --outfile=build/bundle.js
clasp push
```
De előbb kérdezd meg: **tényleg kell?** Egy bundler bevezetése után már nem
„gyors kis script" a projekt — lehet, hogy Cloud Runba való.

---

## Tesztelés

Nincs beépített tesztfuttató. Amit reálisan tehetsz:

**1. Tiszta függvények szétválasztása.** A logikát vidd olyan függvényekbe,
amik nem hívnak Google szolgáltatást — ezeket lokálisan, node-dal is tesztelheted.

```javascript
// ✅ Tesztelhető: nincs benne SpreadsheetApp
function calculateRoas_(rows, costCol, revCol) { /* ... */ }

// A Google-szolgáltatásokat érintő rész maradjon vékony
function updateRoasSheet() {
  const rows = sheet.getDataRange().getValues();
  const out  = calculateRoas_(rows, 3, 4);
  sheet.getRange(...).setValues(out);
}
```

**2. Egyszerű teszt-harness a projektben:**

```javascript
function runTests() {
  const tests = [];
  const t = (name, fn) => tests.push({ name, fn });
  const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(`${msg || ''} – várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`);
  };

  t('ROAS számítás', () => eq(calcRoas_(100, 400), 4));
  t('Nulla költés nem oszt nullával', () => eq(calcRoas_(0, 400), ''));
  t('Fejléc-térkép', () => eq(buildHeaderIndex_(['A', 'B']), { A: 0, B: 1 }));

  const failed = [];
  tests.forEach(x => {
    try { x.fn(); Logger.log('✅ ' + x.name); }
    catch (e) { failed.push(x.name); Logger.log('❌ ' + x.name + ': ' + e.message); }
  });
  Logger.log(failed.length ? `\n${failed.length} teszt bukott: ${failed}` : '\nMinden teszt zöld.');
}
```

**3. `DRY_RUN` mint integrációs teszt.** Az éles adaton lefuttatott dry-run
többet ér, mint tíz unit teszt — mert a valódi adatszerkezetet is ellenőrzi.

---

## Gemini a szerkesztőben

A Gemini oldalsáv a szerkesztőben ismeri a projekted és a gazdafájl kontextusát
— gyorsan ad vázat, magyaráz kódot, debugol.

**Amire jó:** boilerplate, API-szintaxis felidézése, hibaüzenet értelmezése,
egy ismeretlen szolgáltatás első használata.

**Amit nem tesz meg helyetted:** nem dönti el, hogy egyáltalán Apps Script kell-e
(→ [01](01-dontesi-keret.md)), nem tervez idempotenciát, nem talál ki
kvótastratégiát, nem tudja, ki lesz a script gazdája. A generált kódra ugyanúgy
fusd le a lenti reviewt.

---

## Kód-review checklist

Mielőtt éles lesz, vagy mielőtt átadod:

**Helyesség**
- [ ] Nincs `getValue()`/`setValue()` ciklusban
- [ ] Nincs pozíció szerinti oszlop-indexelés (fejléc-térkép van)
- [ ] Minden külső hívás `try/catch` + retry alatt
- [ ] `muteHttpExceptions: true` minden `fetch`/`fetchAll`-nál
- [ ] Az idempotencia bizonyíthatóan működik (kétszer futtatva nem duplikál)

**Robusztusság**
- [ ] Van futásidő-őr, ha a munka nőhet
- [ ] Az egyszeri triggerek törlődnek (20-as limit)
- [ ] Van józansági ellenőrzés üres/gyanús adatra
- [ ] `LockService`, ha kétszer indulhat egyszerre

**Üzemeltethetőség**
- [ ] `ENABLED` és `DRY_RUN` kapcsoló
- [ ] Riasztás minden hibaágon (Chat/email)
- [ ] Naplózás Sheetbe **és** `console.log`-gal
- [ ] Heartbeat + elmaradás-figyelés
- [ ] Menüpont a kézi indításhoz
- [ ] `README` lap a Sheetben

**Biztonság**
- [ ] Nincs titok a kódban
- [ ] `oauthScopes` explicit és minimális
- [ ] `timeZone` helyesen beállítva
- [ ] Webapp hozzáférés és „execute as" tudatos
- [ ] Standalone script, Shared Drive, céges tulajdonos

**Átadhatóság**
- [ ] Git-ben van, értelmes commit üzenetekkel
- [ ] A dev és a prod el van választva
- [ ] Le van írva a kilépési feltétel (mikor nőjük ki)
