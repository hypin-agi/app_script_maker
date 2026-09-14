# 05 – Minták és kódtár

Copy-paste kész megoldások a visszatérő problémákra. Minden minta V8 runtime-ot
feltételez. A `_` végű függvénynevek Apps Script konvenció szerint **privátok**
(nem jelennek meg a Run menüben, és custom functionként sem hívhatók).

**Tartalom:**
[Batch I/O](#1-batch-io--a-legnagyobb-nyereség) ·
[Fejléc-térkép](#2-fejléc-térkép--sose-indexelj-pozíció-szerint) ·
[Retry](#3-retry-exponenciális-backoffal) ·
[Párhuzamos HTTP](#4-párhuzamos-http-fetchall) ·
[Folytatásos futás](#folytatásos-futás) ·
[Zárolás](#6-zárolás-lockservice) ·
[Cache](#7-cache-nagy-értékekkel-is) ·
[Konfiguráció](#8-konfiguráció-kódon-kívül) ·
[Idempotencia](#9-idempotencia-napló) ·
[Riasztás](#10-riasztás-és-naplózás) ·
[Webhook](#11-webhook-fogadó-dopost) ·
[Sablon → PDF](#12-dokumentum-generálás-sablonból--pdf) ·
[Advanced API](#13-advanced-service-sheets-batchupdate) ·
[Antiminták](#antiminták--amit-azonnal-írj-át)

---

## 1. Batch I/O — a legnagyobb nyereség

**Az arany szabály: olvass egyszer → dolgozz memóriában → írj egyszer.**

```javascript
function updateMargins_(sheet) {
  const range  = sheet.getDataRange();
  const values = range.getValues();           // 1 olvasás
  const header = values.shift();

  const iCost = header.indexOf('Költés');
  const iRev  = header.indexOf('Bevétel');
  const iRoas = header.indexOf('ROAS');

  for (const row of values) {
    const cost = Number(row[iCost]) || 0;
    row[iRoas] = cost > 0 ? (Number(row[iRev]) || 0) / cost : '';
  }

  // Csak a ROAS oszlopot írjuk vissza, egyetlen hívással
  sheet.getRange(2, iRoas + 1, values.length, 1)
       .setValues(values.map(r => [r[iRoas]]));
}
```

**Amit kerülj:** olvasás és írás **váltogatását**. Minden írás után egy olvasás
kikényszeríti a belső puffer ürítését, és elveszted a batch előnyét.
Ha muszáj sorrendet kikényszeríteni: `SpreadsheetApp.flush()`.

---

## 2. Fejléc-térkép — sose indexelj pozíció szerint

Ha valaki beszúr egy oszlopot, a scripted nem törhet el.

```javascript
/** A lap tartalmát objektumok tömbjeként adja vissza. */
function readAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values.shift().map(h => String(h).trim());

  return values.map((row, i) => {
    const obj = { _rowNumber: i + 2 };        // 1-alapú, fejléccel együtt
    header.forEach((key, c) => { if (key) obj[key] = row[c]; });
    return obj;
  });
}

/** Egy adott oszlop visszaírása objektumtömbből, egyetlen hívással. */
function writeColumn_(sheet, columnName, objects) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = header.indexOf(columnName) + 1;
  if (col === 0) throw new Error('Nincs ilyen oszlop: ' + columnName);
  sheet.getRange(2, col, objects.length, 1)
       .setValues(objects.map(o => [o[columnName]]));
}
```

---

## 3. Retry exponenciális backoffal

A Google szolgáltatások és a külső API-k **rendszeresen** dobnak átmeneti hibát.
Ez nem kivétel, hanem üzemszerű működés — tervezz rá.

```javascript
/**
 * Újrapróbálja a műveletet növekvő várakozással.
 * @param {Function} fn        A művelet (visszatérési értékét továbbadja)
 * @param {Object}   [opts]    { tries, baseMs, label }
 */
function withRetry_(fn, opts) {
  const o = Object.assign({ tries: 4, baseMs: 800, label: 'művelet' }, opts || {});
  let lastErr;

  for (let attempt = 1; attempt <= o.tries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient_(err) || attempt === o.tries) break;
      // 800ms, 1600ms, 3200ms + véletlen jitter (hogy ne torlódjanak)
      const wait = o.baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
      Logger.log('[retry] %s – %s. próba %sms múlva (%s)', o.label, attempt + 1, wait, err);
      Utilities.sleep(wait);
    }
  }
  throw new Error(`${o.label} – ${o.tries} próbálkozás után sem sikerült: ${lastErr}`);
}

function isTransient_(err) {
  const m = String(err && err.message || err).toLowerCase();
  return ['internal error', 'service unavailable', 'rate limit', 'timeout',
          'timed out', 'try again', 'backend error', 'too many requests',
          '429', '500', '502', '503', '504']
    .some(s => m.includes(s));
}

// Használat:
const data = withRetry_(() => fetchAdsInsights_(accountId), { label: 'Meta insights' });
```

> **Figyelem:** a backoff `Utilities.sleep()`-et használ, ami blokkol, és a
> 6 perces keretedből fogy. 4 próbálkozás ≈ 6 másodperc várakozás — ez elfér,
> de ne állíts 10 próbálkozást.

---

## 4. Párhuzamos HTTP (`fetchAll`)

Az **egyetlen valódi párhuzamosítás** a platformon. 20–50 hívásnál 10× gyorsulás.

```javascript
/** URL-ek lekérése kötegelve, hibatűrően. */
function fetchAllChunked_(requests, chunkSize) {
  const size = chunkSize || 30;
  const out = [];

  for (let i = 0; i < requests.length; i += size) {
    const chunk = requests.slice(i, i + size)
      .map(r => Object.assign({ muteHttpExceptions: true }, r));

    const responses = withRetry_(() => UrlFetchApp.fetchAll(chunk),
                                 { label: `fetchAll ${i}-${i + size}` });

    responses.forEach((res, j) => {
      const code = res.getResponseCode();
      out.push({
        ok: code >= 200 && code < 300,
        code: code,
        url: chunk[j].url,
        body: res.getContentText()
      });
    });
  }
  return out;
}

// Használat:
const results = fetchAllChunked_(campaignIds.map(id => ({
  url: `https://graph.facebook.com/v21.0/${id}/insights?access_token=${token}`,
  method: 'get'
})));

const failed = results.filter(r => !r.ok);
if (failed.length) alert_(`${failed.length} kampány lekérése hibázott.`);
```

> A `muteHttpExceptions: true` nélkül egyetlen 404 az **egész köteget** eldobja.
> Ezért mindig tedd be.

---

## Folytatásos futás

A 6 perces limit megkerülésének standard mintája: kurzort mentesz, és
időhatár előtt újraütemezed magad.

```javascript
const SAFE_RUNTIME_MS = 4.5 * 60 * 1000;   // 4,5 perc, tartalékkal
const CURSOR_KEY      = 'SYNC_CURSOR';
const CONTINUE_FN     = 'processAllItems';

function processAllItems() {
  const started = Date.now();
  const props   = PropertiesService.getScriptProperties();
  let cursor    = Number(props.getProperty(CURSOR_KEY) || 0);

  cleanupTriggers_(CONTINUE_FN);           // fontos: 20-as trigger limit!

  const items = loadItems_();              // teljes munkalista
  log_(`Indulás a ${cursor}. elemtől, összesen ${items.length}.`);

  while (cursor < items.length) {
    if (Date.now() - started > SAFE_RUNTIME_MS) {
      props.setProperty(CURSOR_KEY, String(cursor));
      scheduleContinuation_(CONTINUE_FN, 1);
      log_(`Időkorlát – folytatás a ${cursor}. elemtől.`);
      return;                              // NEM hiba: tervezett megszakítás
    }
    processItem_(items[cursor]);
    cursor++;
  }

  props.deleteProperty(CURSOR_KEY);
  cleanupTriggers_(CONTINUE_FN);
  log_(`✅ Kész: ${items.length} elem feldolgozva.`);
}

function scheduleContinuation_(fnName, minutes) {
  ScriptApp.newTrigger(fnName)
    .timeBased()
    .after((minutes || 1) * 60 * 1000)
    .create();
}

/** Törli az adott függvényhez tartozó triggereket (max 20 lehet összesen!). */
function cleanupTriggers_(fnName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fnName &&
                 t.getEventType() === ScriptApp.EventType.CLOCK)
    .forEach(t => ScriptApp.deleteTrigger(t));
}
```

**Amire figyelj:**
- A `cleanupTriggers_` **kötelező** — enélkül 20 futás után `Trigger limit` hibát kapsz.
- Mindig hagyj tartalékot (4,5 perc a 6-ból): a mentés és az ütemezés is idő.
- A feldolgozás legyen **idempotens** (lásd 9. pont) — az utolsó elem befejezetlen maradhat.

---

## 6. Zárolás (LockService)

Ha egy scriptet trigger és ember is indíthat, előbb-utóbb egyszerre fut kétszer.

```javascript
function syncWithLock() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {          // 30 mp várakozás a zárra
    log_('Másik futás dolgozik, kilépek.');
    return;
  }
  try {
    doTheWork_();
  } finally {
    lock.releaseLock();                    // MINDIG finally-ben
  }
}
```

| Zár típusa | Hatóköre |
|---|---|
| `getScriptLock()` | Az egész script, minden felhasználóra — **ezt használd alapból** |
| `getUserLock()` | Csak az aktuális felhasználó futásaira |
| `getDocumentLock()` | A kötött dokumentumra |

---

## 7. Cache nagy értékekkel is

A `CacheService` értékenként ~100 kB-ot bír. Nagyobb payloadhoz darabolj.

```javascript
const CACHE_TTL = 21600;   // 6 óra = a maximum

function cacheGetJson_(key) {
  const cache = CacheService.getScriptCache();
  const meta  = cache.get(key + '__meta');
  if (!meta) return null;

  const chunks = Number(meta);
  const parts  = cache.getAll(
    Array.from({ length: chunks }, (_, i) => `${key}__${i}`)
  );
  let joined = '';
  for (let i = 0; i < chunks; i++) {
    const part = parts[`${key}__${i}`];
    if (part === undefined) return null;     // hiányos cache → kezeld cache miss-ként
    joined += part;
  }
  try { return JSON.parse(joined); } catch (e) { return null; }
}

function cachePutJson_(key, obj, ttl) {
  const cache = CacheService.getScriptCache();
  const text  = JSON.stringify(obj);
  const SIZE  = 90 * 1024;                   // biztonsági ráhagyás a 100 kB-hoz
  const map   = {};
  let chunks  = 0;

  for (let i = 0; i < text.length; i += SIZE) {
    map[`${key}__${chunks++}`] = text.slice(i, i + SIZE);
  }
  map[key + '__meta'] = String(chunks);
  cache.putAll(map, ttl || CACHE_TTL);
}

// Használat: drága API-lekérés cache-elése
function getExchangeRates_() {
  const cached = cacheGetJson_('fx_rates');
  if (cached) return cached;
  const fresh = withRetry_(() => JSON.parse(UrlFetchApp.fetch(FX_URL).getContentText()));
  cachePutJson_('fx_rates', fresh, 3600);    // 1 óra
  return fresh;
}
```

> **A cache nem megbízható tár.** Bármikor kiürülhet. Csak olyat tegyél bele,
> amit újra le tudsz kérni.

---

## 8. Konfiguráció kódon kívül

Két szintje van, és mindkettőre szükség van:

- **Script Properties** – technikai értékek, tokenek, azonosítók (a script gazdája állítja)
- **`Config` lap a Sheetben** – üzleti kapcsolók, amiket az account manager is átállíthat

```javascript
/** Egyesített konfiguráció: Script Properties + Config lap. */
function getConfig_() {
  const cached = CacheService.getScriptCache().get('__cfg');
  if (cached) return JSON.parse(cached);

  const cfg = Object.assign({}, PropertiesService.getScriptProperties().getProperties());

  const sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (sheet) {
    sheet.getDataRange().getValues()
      .slice(1)                                    // fejléc nélkül
      .filter(([k]) => k)
      .forEach(([k, v]) => { cfg[String(k).trim()] = v; });
  }

  // Típuskonverziók — a Sheetből minden stringként vagy vegyesen jön
  cfg.ENABLED = String(cfg.ENABLED).toLowerCase() !== 'false';
  cfg.DRY_RUN = String(cfg.DRY_RUN).toLowerCase() === 'true';

  CacheService.getScriptCache().put('__cfg', JSON.stringify(cfg), 300);  // 5 perc
  return cfg;
}
```

**Config lap javasolt felépítése:**

| Kulcs | Érték | Leírás |
|---|---|---|
| `ENABLED` | `TRUE` | Fő kapcsoló. `FALSE` = a script azonnal kilép. |
| `DRY_RUN` | `FALSE` | `TRUE` = mindent kiszámol, de nem ír és nem küld. |
| `ALERT_EMAIL` | `bastya@hypin.hu` | Ide megy a hibaértesítés. |
| `LOOKBACK_DAYS` | `7` | Hány napra visszamenőleg szinkronizáljon. |

> 🔒 **Titkot (API kulcs, token) soha ne a Config lapra tegyél** — azt bárki látja,
> akinek a Sheethez hozzáférése van. Script Propertiesbe való, és tudd, hogy azt
> is látja minden **szerkesztő**. Lásd [06](06-biztonsag-es-uzemeltetes.md).

---

## 9. Idempotencia napló

Hogy egy újrafutás soha ne duplikáljon.

```javascript
const LEDGER_SHEET = '_Ledger';

function getProcessedIds_() {
  const sheet = getOrCreateSheet_(LEDGER_SHEET, ['id', 'timestamp', 'result']);
  const last = sheet.getLastRow();
  if (last < 2) return new Set();
  return new Set(
    sheet.getRange(2, 1, last - 1, 1).getValues().flat().map(String)
  );
}

function markProcessed_(id, result) {
  getOrCreateSheet_(LEDGER_SHEET, ['id', 'timestamp', 'result'])
    .appendRow([String(id), new Date(), result || 'ok']);
}

function getOrCreateSheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (header) sheet.appendRow(header);
    sheet.hideSheet();
  }
  return sheet;
}

// Használat — figyeld a sorrendet:
function sendClientReports() {
  const done = getProcessedIds_();
  for (const client of listClients_()) {
    const key = `${client.id}_${todayKey_()}`;
    if (done.has(key)) continue;            // már ment ma
    sendReport_(client);
    markProcessed_(key, 'elküldve');        // AZONNAL, nem a ciklus végén
  }
}
```

> **A `markProcessed_` mindig közvetlenül a művelet után menjen.** Ha a végén
> jelölnél, egy 6 perces timeout után az összes email újra kimenne.

---

## 10. Riasztás és naplózás

### Google Chat értesítés (a leggyorsabb csatorna)

```javascript
function notifyChat_(text) {
  const url = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL');
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Chat értesítés nem ment ki: ' + e);   // a riasztás hibája ne dobja el a futást
  }
}
```

### Egységes hibakezelő burkoló

Minden trigger-belépési pontot ebbe csomagolj:

```javascript
/** Minden trigger ezen keresztül fusson. */
function runSafely_(name, fn) {
  const started = Date.now();
  try {
    log_(`▶️ ${name} indul`);
    const result = fn();
    log_(`✅ ${name} kész (${Math.round((Date.now() - started) / 1000)} mp)`);
    return result;
  } catch (err) {
    const msg = `❌ *${name}* hibára futott\n\`\`\`${err.stack || err}\`\`\``;
    log_(msg);
    notifyChat_(msg);
    const to = getConfig_().ALERT_EMAIL;
    if (to) MailApp.sendEmail(to, `[Apps Script hiba] ${name}`, String(err.stack || err));
    throw err;                    // dobd tovább: így a futásnaplóban is hibás lesz
  }
}

// Trigger belépési pont:
function dailySync() { runSafely_('Napi szinkron', doDailySync_); }
```

### Naplózás Sheetbe (amit az ügyfél is lát)

```javascript
function log_(message) {
  console.log(message);                       // Cloud Logging – itt keresd hiba esetén
  try {
    getOrCreateSheet_('_Log', ['időpont', 'üzenet'])
      .appendRow([new Date(), String(message).slice(0, 5000)]);
  } catch (e) { /* a naplózás soha ne buktassa a futást */ }
}

/** Havonta futtatva tartja karban a napló méretét. */
function trimLog_() {
  const sheet = getOrCreateSheet_('_Log');
  const keep = 2000;
  const extra = sheet.getLastRow() - keep - 1;
  if (extra > 0) sheet.deleteRows(2, extra);
}
```

> A `console.log` a Cloud Loggingba megy (Apps Script szerkesztő → *Végrehajtások*).
> A Sheet-napló viszont az, amit a nem-technikai kolléga is meg tud nyitni.
> **Mindkettő kell.**

---

## 11. Webhook fogadó (doPost)

```javascript
function doPost(e) {
  try {
    // 1. Hitelesítés – enélkül bárki hívhatja a végpontodat
    const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!e.parameter.token || e.parameter.token !== secret) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    // 2. NE dolgozz fel itt – csak vedd át és tedd sorba
    const payload = JSON.parse(e.postData.contents);
    getOrCreateSheet_('_Inbox', ['érkezett', 'payload', 'státusz'])
      .appendRow([new Date(), JSON.stringify(payload), 'új']);

    // 3. Gyorsan válaszolj (a küldő általában néhány mp-en belül timeoutol)
    return json_({ ok: true });

  } catch (err) {
    log_('doPost hiba: ' + err);
    return json_({ ok: false, error: String(err) });   // a státusz akkor is 200 lesz
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**A minta lényege: a webhook csak *átvesz*, nem *dolgoz fel*.** A tényleges munkát
egy percenkénti trigger végzi az `_Inbox` lapról. Így:
- a küldő nem timeoutol,
- nem futsz bele a 30 párhuzamos végrehajtás limitbe,
- hiba esetén a payload megmarad és újrapróbálható.

**Aláírt webhook (pl. Meta, Stripe) ellenőrzése:**

```javascript
function verifySignature_(body, signatureHeader, secret) {
  const computed = Utilities.computeHmacSha256Signature(body, secret);
  const hex = computed
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
  return hex === String(signatureHeader).replace(/^sha256=/, '');
}
```

---

## 12. Dokumentum generálás sablonból → PDF

Az egyik legjobb ROI-jú minta ügynökségi környezetben.

```javascript
/**
 * Docs sablon kitöltése és PDF mentése.
 * @param {string} templateId  A sablon Google Doc ID-ja
 * @param {string} folderId    Cél mappa
 * @param {Object} data        { '{{ügyfél}}': 'Hypin', ... }
 */
function generatePdfFromTemplate_(templateId, folderId, fileName, data) {
  const folder = DriveApp.getFolderById(folderId);
  const copy   = DriveApp.getFileById(templateId).makeCopy(fileName + ' (draft)', folder);

  const doc  = DocumentApp.openById(copy.getId());
  const body = doc.getBody();
  Object.keys(data).forEach(k => body.replaceText(escapeRegex_(k), String(data[k])));
  doc.saveAndClose();                                    // kötelező a PDF export előtt!

  const pdf = folder.createFile(
    DriveApp.getFileById(copy.getId()).getAs(MimeType.PDF).setName(fileName + '.pdf')
  );
  copy.setTrashed(true);                                 // a munkapéldány mehet
  return pdf;
}

function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Slides deck ugyanez, még egyszerűbben:**

```javascript
function generateDeck_(templateId, folderId, name, data) {
  const copy = DriveApp.getFileById(templateId)
    .makeCopy(name, DriveApp.getFolderById(folderId));
  const deck = SlidesApp.openById(copy.getId());
  Object.keys(data).forEach(k => deck.replaceAllText(k, String(data[k])));
  deck.saveAndClose();
  return copy;
}
```

> A `replaceText` **reguláris kifejezést** vár, ezért escape-elni kell.
> `saveAndClose()` nélkül a PDF export a mentés előtti állapotot exportálja.

---

## 13. Advanced Service: Sheets batchUpdate

Ha sok tartományt kell formázni vagy írni, a beépített `SpreadsheetApp` lassú.
Kapcsold be a `appsscript.json`-ban a Sheets API-t, és menj batchben.

```javascript
/** Több lap egyidejű olvasása EGY hívással. */
function readManyRanges_(spreadsheetId, ranges) {
  const res = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, { ranges: ranges });
  return (res.valueRanges || []).map(vr => vr.values || []);
}

/** Több formázási művelet EGY hívásban. */
function highlightRows_(spreadsheetId, sheetId, rowIndexes) {
  const requests = rowIndexes.map(r => ({
    repeatCell: {
      range: { sheetId: sheetId, startRowIndex: r, endRowIndex: r + 1 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.9, blue: 0.9 } } },
      fields: 'userEnteredFormat.backgroundColor'
    }
  }));
  if (requests.length) {
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
  }
}
```

`appsscript.json`:

```json
{
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Sheets", "serviceId": "sheets", "version": "v4" }
    ]
  }
}
```

---

## Antiminták — amit azonnal írj át

| ❌ Antiminta | Miért baj | ✅ Helyette |
|---|---|---|
| `getValue()` / `setValue()` ciklusban | Soronként egy szerverhívás; 1000 sor ≈ 3 perc | `getValues()` / `setValues()` egyszer |
| Olvasás és írás váltogatása | Minden írás után kényszerített flush | Olvasd be, dolgozz memóriában, írd ki |
| `catch (e) { }` üresen | Néma hiba — a legdrágább hibafajta | Naplózz és riassz, vagy dobd tovább |
| `Utilities.sleep()` a „rate limit ellen" ciklusban | A 6 perces keretedet égeted | `fetchAll()` kötegelve, cache |
| API-hívás egyedi függvényben (`=MYFUNC()`) | 30 mp limit + cellánkénti kvótarobbanás | Menüpont vagy trigger, ami Sheetbe ír |
| API kulcs a kódban | Minden szerkesztő látja, git-be is bekerül | Script Properties + korlátozott szerkesztői kör |
| Trigger a saját privát fiókodon | Kilépésnél/felfüggesztésnél némán leáll | Céges, nevesített tulajdonos fiók |
| Egyszeri trigger törlés nélkül | 20 trigger után `Trigger limit` hiba | `cleanupTriggers_()` minden futás elején |
| `SpreadsheetApp.getActiveSheet()` triggerben | Triggerben nincs „aktív" lap, kiszámíthatatlan | `openById()` + `getSheetByName()` |
| Üres eredmény felülírja az éles adatot | Csendben kiürül az ügyfél riportja | Józansági ellenőrzés: ha 0 sor, ne írj |
| Minden egy `main()` függvényben | Tesztelhetetlen, olvashatatlan | Kis, tiszta `_` függvények + vékony belépési pont |
| `fetch()` `muteHttpExceptions` nélkül batchben | Egy 404 eldobja az egész köteget | Mindig `muteHttpExceptions: true` |
