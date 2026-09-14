# 04 – Korlátok és kvóták: hol fog elhasalni

> ⚠️ **A számokat a Google időnként módosítja.** Évente egyszer ellenőrizd:
> [developers.google.com/apps-script/guides/services/quotas](https://developers.google.com/apps-script/guides/services/quotas)
> A lenti táblázat a 2026-os állapotot tükrözi, és arra jó, hogy **nagyságrendben**
> tervezz — ne arra, hogy a limit utolsó egységéig menj.

---

## A kvóták működésének logikája

Négy dolgot kell érteni, és utána minden hibaüzenet érthetővé válik:

1. **A kvóta felhasználóhoz tartozik, nem scripthez.** Ha ugyanaz a fiók
   üzemeltet 10 scriptet, azok **közösen** fogyasztják a napi keretet.
2. **24 órás csúszóablak**, az első kérés után indul — nem éjfélkor nullázódik.
3. **Ezek kemény limitek.** Nem lehet pénzért megemelni őket. (Ez a legfontosabb
   különbség a Google Clouddal szemben.)
4. **Workspace-fiók nagyságrendekkel többet kap, mint ingyenes @gmail.com.**
   Ügyfélmunkát soha ne futtass ingyenes fiókról.

---

## A fontos számok

### Futásidő

| Limit | Ingyenes | Workspace | Mit jelent a gyakorlatban |
|---|---|---|---|
| **Script futásideje / indítás** | **6 perc** | **6 perc** | A fal. Mindkét fióktípusnál ugyanaz. Erre tervezz. |
| Egyedi függvény (`=MYFUNC()`) | 30 mp | 30 mp | Cellába írt függvényre |
| Trigger összes futásideje / nap | ~90 perc | ~6 óra | Percenkénti trigger × 6 perc gyorsan elfogy |
| Párhuzamos futások / felhasználó | 30 | 30 | Webhook-fogadónál ez a plafon |
| Triggerek száma / script / felhasználó | 20 | 20 | Az egyszeri triggereket **törölni kell** futás után |

### Email

| Limit | Ingyenes | Workspace |
|---|---|---|
| **Email címzettek / nap** | **~100** | **~1 500** |
| Címzettek / üzenet | 50 | 50 |
| Mellékletek száma / üzenet | 250 | 250 |
| Melléklet összméret | ~25 MB | ~25 MB |

> **A kvóta címzettet számol, nem levelet.** 1 email 150 címzettnek = 150 egység.
> Ugyanúgy, mint 150 külön email. A maradékot lekérdezheted:
> `MailApp.getRemainingDailyQuota()` — **éles kiküldés előtt mindig nézd meg.**

### Külső hívások (UrlFetch)

| Limit | Ingyenes | Workspace |
|---|---|---|
| **Hívások / nap** | **~20 000** | **~100 000** |
| Válasz mérete | ~50 MB | ~50 MB |
| POST body | ~50 MB | ~50 MB |
| Fejlécek száma / méret | 100 db / ~8 kB | 100 db / ~8 kB |
| URL hossza | ~2 kB | ~2 kB |

### Tárolás

| Hol | Limit | Mire jó |
|---|---|---|
| `PropertiesService` – érték | ~9 kB / kulcs | Konfiguráció, kurzor, tokenek |
| `PropertiesService` – összesen | ~500 kB / tár | **Nem adatbázis.** Ne tárolj benne listát. |
| `CacheService` – érték | ~100 kB / kulcs | API-válasz cache |
| `CacheService` – élettartam | max **6 óra** (21 600 mp), alapból 10 perc | Rövid távú gyorsítótár |
| `Blob` méret | ~50 MB | Fájlkezelés plafonja |

### Napi létrehozási limitek

Dokumentum-, táblázat-, prezentáció- és naptáresemény-létrehozásra is van napi
korlát (ingyenes fióknál pár száz, Workspace-nél ezres nagyságrend). Ha havi
riportot generálsz 40 ügyfélnek, ez nem lesz gond. Ha 5 000 certificate-et,
igen — akkor darabold napokra.

---

## A 6 perces fal — a legfontosabb korlát

### Miért ilyen szigorú

Az Apps Script **egyszálú és szinkron**. Nincs valódi párhuzamosság, nincs
háttérfeldolgozás. Minden szolgáltatáshívás (`getValues`, `fetch`, `sendEmail`)
blokkol, amíg vissza nem jön. A 6 perc ezekből fogy el.

### Hogyan kerüld meg — a három technika

**1. Csökkentsd a hívásszámot (ezt csináld először)**

A scriptek többsége nem azért lassú, mert sok a munka, hanem mert rosszul kéri.
Egy `getValues()` ezer sorra kb. annyi idő, mint egyetlen `getValue()` egy cellára.

**2. Párhuzamosíts HTTP-t `fetchAll()`-lal**

Ez az egyetlen valódi párhuzamosítás a platformon:

```javascript
// ❌ 50 hívás egymás után ≈ 50 × 400ms = 20 másodperc
const results = urls.map(u => UrlFetchApp.fetch(u));

// ✅ 50 hívás párhuzamosan ≈ 2 másodperc
const results = UrlFetchApp.fetchAll(urls.map(url => ({
  url, method: 'get', muteHttpExceptions: true
})));
```

**3. Darabold folytatásos futásra (continuation pattern)**

Ha a munka egyben nem fér bele, vezess kurzort, és időhatár előtt ütemezd újra
magad. A teljes, működő mintát lásd: [05 – Minták](05-mintak-kodtar.md#folytatásos-futás).

```javascript
const START = Date.now();
const SAFE_MS = 4.5 * 60 * 1000;   // 4,5 perc — hagyj tartalékot a lezárásra

while (hasMoreWork_()) {
  if (Date.now() - START > SAFE_MS) {
    saveCursor_(cursor);
    scheduleContinuation_();      // trigger 1-2 perc múlva
    return;
  }
  processNextBatch_();
}
```

**Soha ne menj 5,5 percig.** A mentés, naplózás és a folytatás ütemezése is
időbe telik — ha azok közben jársz le, elveszíted a kurzort.

---

## Ami nem kvóta, de ugyanúgy megállít

### Nincs valódi async
`async/await` és `Promise` szintaktikailag megy (V8), de **nem ad párhuzamosságot**:
nincs esemény-ciklus, nincs `setTimeout`. Aki Node-ból jön, ezen bukik el először.
Késleltetésre: `Utilities.sleep(ms)` — ami blokkol, és a 6 percedből fogy.

### Nincs npm és nincs modulrendszer
A `.gs` fájlok **egyetlen közös globális névtérben** élnek. Nincs `import`,
nincs `require`. Két azonos nevű függvény két fájlban → az egyik némán felülírja
a másikat. Ezért használj **prefixet** (`Sheet_read`, `Http_get`) vagy
objektum-névtereket. Külső könyvtárhoz: `clasp` + bundler (esbuild/webpack),
lásd [07](07-fejlesztoi-workflow.md).

### Nincs státuszkód- és header-kontroll webappban
Amit a `ContentService` visszaad, az mindig `200 OK`. A hibát a **body-ban** kell
jeleznie:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return json_({ ok: true, id: handle_(data) });
  } catch (err) {
    // Nincs 500-as státusz — a hívónak a body-t kell néznie
    return json_({ ok: false, error: String(err) });
  }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Böngészőből POST-olva: **ne küldj `application/json` content-type-ot**, mert a
preflight `OPTIONS` kérést az Apps Script nem kezeli. Használj `text/plain`-t, és
parse-old a `e.postData.contents`-et.

### A trigger időpont nem pontos
"Naponta 8-kor" = "8:00 és 9:00 között valamikor". Ha az ügyfélnek 8:00-ra
ígérsz riportot, ígérj 9:00-ra — vagy hívasd a webappot **Cloud Schedulerrel**.

### A trigger a létrehozó nevében fut
Ha a kolléga fiókjához van kötve, és ő elmegy / felfüggesztik a fiókját,
**a trigger csendben leáll**. Lásd [06 – Biztonság és üzemeltetés](06-biztonsag-es-uzemeltetes.md).

### A Sheet is elfárad
A script limitje előtt sokszor a táblázat adja fel: ~5–10 millió cella az elvi
plafon, de a valóságban 50 ezer sor + sok formula + feltételes formázás mellett
már a megnyitás is lassú. **Ökölszabály: 10 000 sor felett gondolkodj,
50 000 felett költözz.**

---

## Gyakori hibaüzenetek és a valódi okuk

| Hibaüzenet | Mi történt valójában | Megoldás |
|---|---|---|
| `Exceeded maximum execution time` | 6 perc letelt | Batch I/O, `fetchAll`, folytatásos futás |
| `Service invoked too many times for one day: <szolgáltatás>` | Napi kvóta elfogyott (gyakran email vagy urlfetch) | Darabolás napokra, kvótaellenőrzés futás előtt |
| `Service using too much computer time for one day` | A napi trigger-futásidő fogyott el | Ritkítsd a triggert, optimalizálj |
| `Too many simultaneous invocations` | 30+ párhuzamos futás (tipikusan webhook-özön) | `LockService`, sorbanállás Sheetben, külön feldolgozó trigger |
| `Authorization is required to perform that action` | Egyszerű trigger próbál engedélyköteles szolgáltatást hívni | Telepített triggert használj helyette |
| `You do not have permission to call X` | Hiányzó OAuth scope vagy nincs jogod a fájlhoz | `appsscript.json` scope-ok, fájlmegosztás ellenőrzése |
| `Service Spreadsheets failed while accessing document` | Átmeneti Google-hiba vagy zárolt/túl nagy dokumentum | Exponenciális backoff retry |
| `Documents/Rate limit exceeded` (503, "Internal error") | Átmeneti, terheléses hiba | Retry backoffal — **ez normális, tervezz rá** |
| `Address unavailable` / `DNS error` | Külső API nem elérhető | Retry + riasztás, `muteHttpExceptions: true` |
| A trigger némán nem fut | A tulajdonos fiókja felfüggesztve, vagy a napi kvóta elfogyott | Heartbeat-figyelés, lásd [06](06-biztonsag-es-uzemeltetes.md) |

---

## Kvóta-higiénia checklist

Minden éles script előtt fusd végig:

- [ ] Workspace-fiókon fut (nem @gmail.com)
- [ ] Nevesített, céges tulajdonos fiók (nem magánszemély)
- [ ] Email küldés előtt `MailApp.getRemainingDailyQuota()` ellenőrzés
- [ ] Nincs `getValue()`/`setValue()` ciklusban
- [ ] Több mint 10 HTTP hívásnál `fetchAll()`
- [ ] Ismétlődő, drága lekérésre `CacheService`
- [ ] Van futásidő-őr (4,5 perces biztonsági küszöb)
- [ ] Az egyszeri triggerek törlődnek futás után (20-as limit!)
- [ ] Van retry backoffal minden külső hívásra
- [ ] Van riasztás kvóta- és futáshibára
