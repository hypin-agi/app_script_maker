# 03 – Gondolatiság: milyen fejjel kell nekiállni

Ez a fejezet nem kódról szól. Arról, hogy **hogyan gondolkodj**, mielőtt és
miközben írod. A rossz Apps Script megoldások 90%-a nem azért rossz, mert a kód
hibás — hanem mert rossz kérdésre válaszol.

---

## 1. Nem kódot írsz. Munkaórát szüntetsz meg.

Mielőtt bármit elkezdesz, tedd fel a kérdést:

> **Ki csinálja most kézzel, mennyi ideig, és mi történik, ha rosszul csinálja?**

Ha erre nincs konkrét válasz — nevesített ember, mérhető idő —, akkor nem
automatizálandó folyamatod van, hanem egy ötleted.

**A számítás, amit mindig végezz el:**

```
Megspórolt idő = gyakoriság × időtartam × emberek száma
Befektetés     = fejlesztés + (üzemeltetés × hónapok)
```

40 ügyfél × 20 perc havi riport = 13 óra/hó. Egy 6 órás fejlesztés az első
héten megtérül. Ugyanez egy évente kétszer futó folyamatnál soha nem térül meg —
azt hagyd kézben.

**Amit gyakran elfelejtünk:** az automatizálásnak nem csak időmegtakarítás
lehet a haszna. Egyenletesen jó minőség, hibamentesség, és az, hogy 22:00-kor is
megtörténik, szintén érték.

---

## 2. Az Apps Script ragasztó, nem platform

Ne akard, hogy az Apps Script legyen a rendszer. Legyen a **kapocs** a rendszerek között.

```
❌ Rossz modell:  Apps Script = az alkalmazás
                  (minden logika, minden adat, minden UI benne)

✅ Jó modell:     Apps Script = a Workspace-felület
                  ┌──────────────┐
   nehéz munka →  │ BigQuery /   │
                  │ Cloud Run /  │──► Apps Script ──► Sheet / Docs / Gmail
                  │ külső API    │    (vékony réteg)   (ahol az ember dolgozik)
                  └──────────────┘
```

Ha azon kapod magad, hogy szimulált adatbázist, saját routert vagy ORM-et írsz
Apps Scriptben — megálltál rossz irányba menet.

---

## 3. A Sheet az adatbázisod. Bánj is úgy vele.

A Sheet remek adattár pár ezer sorig. De attól, hogy rugalmas, még kell neki
fegyelem.

**Szabályok, amiket mindig tarts be:**

- **Soha ne indexelj pozíció szerint.** `row[3]` helyett fejléc-térkép:
  ```javascript
  const idx = buildHeaderIndex(sheet); // { 'Ügyfél': 0, 'Költés': 3, ... }
  const cost = row[idx['Költés']];
  ```
  Ha valaki beszúr egy oszlopot, a scriptednek ettől még működnie kell.
- **Egy lap = egy cél.** Külön `Config`, `Data`, `Log`, `Riport` lap.
  A `Config` lapot az account manager szerkeszti, a `Data`-t csak a script.
- **A script által írt területet védd le** (protected range), hogy ne írjanak bele kézzel.
- **Legyen stabil egyedi azonosító** minden soron (UUID vagy külső ID).
  Enélkül nem tudsz idempotens lenni.
- **10 000 sor felett gondolkodj el, 50 000 felett költözz** BigQuerybe.

---

## 4. Idempotencia — elsőként, nem utólag

> **Idempotens = kétszer lefuttatva ugyanazt az eredményt adja, nem duplikál.**

Ez az egyetlen legfontosabb tervezési elv az Apps Scriptben, mert a futásod
**bármikor megszakadhat** (timeout, kvóta, hálózati hiba), és **újra fog indulni**.

Rossz kérdés: *"Hogyan érjem el, hogy mindig lefusson?"*
Jó kérdés: *"Mi történik, ha félbeszakad, és mi történik, ha kétszer fut le?"*

**Gyakorlati minta:** vezess feldolgozási naplót.

```javascript
// Minden feldolgozott elem ID-ját elmentjük. Újrafutáskor kihagyjuk.
const processed = getProcessedIds_();       // Sheet vagy Properties
for (const item of items) {
  if (processed.has(item.id)) continue;     // már megvolt → skip
  handleItem_(item);
  markProcessed_(item.id);                  // AZONNAL jelöld, ne a végén
}
```

A "jelöld meg azonnal" a lényeg. Ha a ciklus végén jelölnél, egy timeout után
az utolsó 200 elem kétszer menne ki emailben.

---

## 5. Kvóta-tudatos tervezés: minden ciklus egy költség

Írás közben tartsd fejben, hogy **minden `getRange()`, `setValue()`, `fetch()`
hívás egy szerverhívás**, és a 6 perc ebből fogy.

```javascript
// ❌ 1000 sor = 2000 szerverhívás = ~3 perc
for (let i = 1; i <= 1000; i++) {
  const v = sheet.getRange(i, 1).getValue();
  sheet.getRange(i, 2).setValue(v * 2);
}

// ✅ 1000 sor = 2 szerverhívás = ~0,2 másodperc
const values = sheet.getRange(1, 1, 1000, 1).getValues();
const out = values.map(([v]) => [v * 2]);
sheet.getRange(1, 2, 1000, 1).setValues(out);
```

**A mentális modell:** olvass be egyszer → dolgozz memóriában → írj ki egyszer.
Ha ez a három lépés megvan, már jobb vagy, mint a scriptek 80%-a.

---

## 6. Fail loudly — a néma hiba a legdrágább

A legrosszabb forgatókönyv nem az, hogy elszáll a script. Az, hogy **csendben
rosszul működik**: üres riportot küld, nulla költést ír, nem frissít semmit.

**Minimum, amit minden éles scriptnek tudnia kell:**

1. **Naplózza**, hogy futott (mikor, meddig, hány elemet dolgozott fel)
2. **Riasszon**, ha hiba van — Chat/Slack üzenet vagy email, nem csak a Google
   automatikus hibaemailje
3. **Józansági ellenőrzés (sanity check):** ha 0 sort dolgozott fel, de tegnap
   4000-et, az hiba, nem siker

```javascript
if (rows.length === 0 && lastRunCount > 100) {
  alert_('⚠️ Gyanús: 0 sor érkezett, tegnap ' + lastRunCount + ' volt. Nem írok felül semmit.');
  return;  // inkább ne csinálj semmit, mint rosszat
}
```

**Alapelv:** kétes helyzetben **ne csinálj semmit, és szólj**. Egy kimaradt
frissítés helyrehozható. Egy felülírt ügyféltábla nem.

---

## 7. Építs kill switchet és dry-run módot

Minden scriptnek legyen két kapcsolója a `Config`-ban:

| Kapcsoló | Mit csinál | Mikor mented meg vele az életed |
|---|---|---|
| `ENABLED` | `false` esetén azonnal kilép | Éles hiba éjszaka, nem érsz kódhoz — az ügyfél is át tudja billenteni |
| `DRY_RUN` | Mindent kiszámol és naplóz, de **nem ír és nem küld** | Első éles futás, változtatás után, ügyfélnek bemutatás |

```javascript
function main() {
  const cfg = getConfig_();
  if (!cfg.ENABLED) { log_('Kikapcsolva, kilépek.'); return; }
  const result = computeEverything_();
  if (cfg.DRY_RUN) { log_('DRY RUN – ezt csinálnám: ' + JSON.stringify(result)); return; }
  applyChanges_(result);
}
```

Ez a két sor több kárt előz meg, mint bármilyen tesztkészlet.

---

## 8. Először a legrondább működő verzió

Ne tervezz két napig. Írd meg 30 perc alatt a legbutább változatot, ami
végigmegy egyetlen elemen. Utána skálázd.

**De három dolgot már az elején jól kell eldöntened**, mert ezeket utólag drága átírni:

1. **Hol az adat?** (melyik Sheet/Drive, milyen struktúra, ki írhatja)
2. **Ki futtatja?** (melyik fiók tulajdonolja — lásd [06](06-biztonsag-es-uzemeltetes.md))
3. **Mi történik hibánál?** (ki kap értesítést, mi a helyreállítás menete)

Minden más fejlődhet menet közben.

---

## 9. Az automatizálás emberi kontextusban él

A script nem vákuumban fut. Mindig tedd fel:

- **Ki veszi észre, ha elromlik?** Ha "senki", akkor nincs monitoring.
- **Hogyan indítja újra egy nem-technikai kolléga?** Ha a válasz "megnyitja a
  szerkesztőt és megnyomja a Run gombot" — az nem megoldás. Kell egy menüpont.
- **Mit lát az ügyfél?** Ha a riport hibás, az a Hypin' hibája, nem a scripté.
- **Mi van, ha a script írója szabadságon van?** Ezért kell README a Sheetben.

**Írj README lapot minden éles Sheetbe.** 10 sor:
mit csinál, mikor fut, ki a gazdája, mit tegyél, ha nem fut, hol a kill switch.

---

## 10. Minden Apps Script megoldás ideiglenes — és ez rendben van

Nem baj, ha egy script 8 hónap múlva kinövi magát. Baj az, ha ez váratlanul ér.

**Írd le az elején a kilépési feltételt:**

> *"Ez a megoldás 10 000 sorig és napi 1 futásig jó. Ha ezt túllépjük, vagy ha
> az ügyfélnek élő dashboard kell, a szinkron BigQuerybe költözik, és az Apps
> Script csak a riport-generálás marad."*

Ez egyetlen mondat a README-ben, de attól kezdve nem "elromlik" a rendszer,
hanem "elérte a tervezett határát". Ez szakmailag és ügyfélkommunikációban is
teljesen más történet.

---

## 11. A DRY szabály: harmadszorra sablon lesz

Amikor **harmadszor** írod ugyanazt a segédfüggvényt (logolás, retry, fejléc-térkép,
Chat-értesítés), akkor:

1. tedd be ebbe a repóba a `templates/starter/` alá, **vagy**
2. csinálj belőle Apps Script **library**-t (verziózva, pinnelt verzióval)

Library-nél vigyázz: lassítja a futást, és a verziófrissítés minden fogyasztót
érint. Kis csapatnál sokszor a **sablon-másolás jobb, mint a library** — kevesebb
csatolás, kevesebb meglepetés.

---

## A "jó → még jobb" létra

Ez a fejezet gyakorlati összefoglalása. Minden script besorolható egy szintre.
**Ügyfélmunka minimum Level 2. Amiért pénzt kérünk, az Level 3.**

### Level 0 – Működik
Lefut kézzel, megcsinálja, amit kell. *Ennyi.*
→ Jó: egyszeri feladat, gyors teszt.

### Level 1 – Megbízható
- `try/catch` mindenhol, ahol külső rendszer van
- Exponenciális backoff átmeneti hibákra
- Naplózás (mikor futott, mit csinált)
- Idempotens: kétszeri futás nem duplikál

### Level 2 – Üzemeltethető
- Konfiguráció **kódon kívül** (Script Properties vagy `Config` lap)
- `DRY_RUN` és `ENABLED` kapcsoló
- Riasztás hibánál (Chat/email), józansági ellenőrzés
- Menüpont a nem-technikai kollégának
- README lap a Sheetben, nevesített gazdával

### Level 3 – Skálázható
- Batch I/O mindenhol (`getValues`/`setValues`, `fetchAll`)
- Cache a drága, ismétlődő lekérésekre
- `LockService` a párhuzamos futás ellen
- Folytatásos futás (continuation) a 6 perces limit körül
- Kvóta- és futásidő-mérés, önkorlátozás

### Level 4 – Átadható
- `clasp` + git, kódreview, verziózott deployment
- Minimalizált OAuth scope-ok, explicit `appsscript.json`
- Szervezeti fiók a tulajdonos, Shared Drive-on
- Teszt-harness a kritikus függvényekre
- Dokumentált architektúra és kilépési terv

### Level 5 – Termék
- Library vagy Workspace Add-on, szemantikus verziózás
- Változásnapló, support-folyamat
- OAuth-verifikáció (ha Marketplace-re megy)
- Monitoring dashboard, SLA-szerű vállalás

---

## Az öt kérdés, amit a kész script előtt tegyél fel magadnak

1. Mi történik, ha **félúton elszáll**?
2. Mi történik, ha **kétszer fut le**?
3. Mi történik, ha a **külső API 500-at ad** vagy üres választ?
4. **Ki veszi észre**, ha három napja nem futott?
5. Ha **holnap kilépnék**, más 10 perc alatt megérti, hogyan működik?

Ha mind az ötre van jó válaszod, kiadható. Ha nincs, még nem kész — akkor is,
ha "működik".
