# 02 – Képességtérkép: mit tud valójában az Apps Script

## Mi ez technikailag, egy bekezdésben

Egy **Google szerverein futó JavaScript-környezet**, ami közvetlen, bejelentkezett
hozzáférést kap a Workspace szolgáltatásaihoz. Nincs szerver, nincs deploy-pipeline,
nincs auth-implementáció: beírod, hogy `SpreadsheetApp.getActiveSheet()`, és az
már a te jogosultságaiddal olvassa a táblát.

**Runtime:** V8 (2025 februárja óta a régi Rhino hivatalosan elavult).
Modern szintaxis megy: `let/const`, arrow function, template literal, osztályok,
destrukturálás, spread, `Map`/`Set`, opcionális láncolás.

**Ami nincs benne, pedig JavaScript:** `setTimeout`, `setInterval`, `fetch`,
`require`/`import` (npm modulok), DOM, Node API-k, valódi async I/O, worker szálak.
A `Promise` és az `async/await` szintaktikailag létezik, de **minden beépített
szolgáltatás szinkron és blokkoló** — nem nyersz vele párhuzamosságot.

---

## A négy felület, amit építhetsz

Ez a legfontosabb mentális térkép: minden Apps Script projekt ezek egyike (vagy kombinációja).

### 1. Kötött script (container-bound)
Egy konkrét Sheet / Doc / Slide / Form "mögé" van írva. Eléri a gazdafájlt
`getActive...()`-tel, tud menüt és oldalsávot adni hozzá.

- ✅ Legegyszerűbb, azonnali kontextus
- ❌ A fájl másolásakor a script is másolódik (verziókáosz), és a fájl sorsához kötött

### 2. Önálló script (standalone)
Saját fájl a Drive-ban. `openById()`-vel nyit meg bármit.

- ✅ Több fájlt kezel, Shared Drive-ra tehető, tisztán verziózható
- ✅ **Ügyfélmunkához szinte mindig ez a helyes választás**
- ❌ Nincs automatikus `getActive...()` kontextus

### 3. Webalkalmazás (web app)
`doGet(e)` / `doPost(e)` → publikus vagy belső URL. Vissza HTML-t vagy szöveget/JSON-t ad.

- ✅ Űrlap, belső eszköz, webhook-fogadó, "futtasd kívülről" gomb
- ❌ Nincs státuszkód- és header-kontroll (lásd [01](01-dontesi-keret.md) 🔴 3. pont)

### 4. Bővítmény (add-on)
- **Editor add-on:** Sheets/Docs/Slides/Forms oldalsáv és menü
- **Google Workspace Add-on:** `CardService`-szel épített kártyás UI, ami
  Gmailben, Naptárban, Drive-ban, Chatben és a Szerkesztőkben is megjelenik —
  ez a modern, egységes út
- **Chat app:** bot a Google Chatben (az `AddOnsResponseService` már GA)

Belső (domain-on belüli) terjesztés egyszerű. **Nyilvános Marketplace-publikálás
viszont OAuth-verifikációt, és érzékeny scope-oknál biztonsági auditot (CASA)
igényel — ez hetekben és pénzben mérhető.** Tervezz vele.

---

## Beépített szolgáltatások — mit érsz el közvetlenül

| Szolgáltatás | Mire jó | Tipikus ügynökségi haszon |
|---|---|---|
| `SpreadsheetApp` | Sheet olvasás/írás, formázás, szűrő, védett tartomány, feltételes formázás | Riport-tábla, adatbázis-pótlék, kampány tracker |
| `DocumentApp` | Docs generálás, szövegcsere, stílus, táblázat | Ajánlat, szerződés, brief, kreatív dokumentáció |
| `SlidesApp` | Slide sablon kitöltés, kép csere, szövegcsere | **Havi ügyfélriport deck automatikus generálása** |
| `FormsApp` | Form létrehozás, kérdések, válaszok kiolvasása | Ügyfél-onboarding, belső kérés-űrlap |
| `GmailApp` / `MailApp` | Küldés, keresés, szálak, címkék, mellékletek, draftok | Riportküldés, melléklet-archiválás, email-alapú trigger |
| `DriveApp` | Fájl/mappa létrehozás, másolás, jogosultság, keresés | Ügyfél-mappastruktúra generálás, asset rendszerezés |
| `CalendarApp` | Esemény létrehozás, módosítás, keresés, vendégek | Forgatásnap, kampányindulás, deadline naptár |
| `UrlFetchApp` | HTTP hívás (GET/POST/…), `fetchAll()` kötegelve | Meta/Google Ads/TikTok/GA4 API, webhook küldés |
| `HtmlService` | Saját HTML UI: oldalsáv, dialógus, webapp | Belső eszköz felület, beviteli űrlap |
| `CardService` | Workspace Add-on kártyás UI | Gmail/Chat oldalsáv |
| `ContentService` | Szöveg/JSON/CSV/XML válasz webappból | Egyszerű API-végpont, webhook válasz |
| `PropertiesService` | Kulcs-érték tár (script / user / document szinten) | Konfiguráció, kurzor, utolsó futás ideje |
| `CacheService` | Rövid életű cache (max 6 óra) | API-válasz cache, ismétlődő lekérés elkerülése |
| `LockService` | Párhuzamos futás elleni zár | Duplikált feldolgozás megakadályozása |
| `ScriptApp` | Trigger létrehozás/törlés, OAuth token, deployment info | Folytatásos futás, önütemezés |
| `Utilities` | base64, HMAC/SHA digest, UUID, `sleep`, CSV-parse, dátumformázás | Aláírt webhook, egyedi azonosító, késleltetés |
| `LanguageApp` | Gépi fordítás | Többnyelvű tartalom gyorsvázlat |
| `MapsApp` | Útvonal, geokódolás, statikus térkép | Lokációs kampány, forgatási logisztika |
| `Session` | Aktuális felhasználó, időzóna, locale | Naplózás, jogosultság-ellenőrzés |
| `JDBC` | MySQL / SQL Server / Oracle kapcsolat | Külső DB olvasás — ritka, de létezik |
| `XmlService` | XML/RSS parse | RSS-figyelés, régi API-k |

## Advanced Services — a "gyorsabb sáv"

A `appsscript.json`-ban bekapcsolható haladó szolgáltatások közvetlenül a Google
REST API-kat érik el. Ugyanaz az adat, de **jóval hatékonyabban**, mert
kötegelt (batch) műveleteket is tudsz.

- **Sheets API** – `batchUpdate` több tartomány formázására/írására egy hívásban
- **Drive API** – haladó keresés, revíziók, megosztási beállítások, Shared Drive
- **Docs / Slides API** – strukturált, batch dokumentumszerkesztés
- **Gmail API** – finomabb szálkezelés, címkék, batch
- **Admin SDK (Directory / Reports)** – felhasználókezelés, audit log
- **Google Analytics Data (GA4)** – riportlekérés közvetlenül
- **BigQuery** – query futtatás, eredmény Sheetbe
- **Calendar / People / Tasks / YouTube / Chat**

**Ökölszabály:** ha a beépített szolgáltatással ciklusban hívogatsz valamit,
nézd meg, van-e hozzá Advanced Service `batch` metódus. Gyakran 10–50× gyorsulás.

## Ami *nem* Apps Script, de ugyanaz az érzés

- **Google Ads Scripts** – külön környezet (`AdsApp`), saját limitekkel
  (ott 30 perc a futásidő). Google Ads-kezeléshez ezt használd, nem az Apps Scriptet.
- **AppSheet** – no-code app Sheet fölé; ha UI kell, sokszor ez a jobb.
- **Looker Studio community connector** – Apps Scriptben írod, de a Looker futtatja.

---

## Triggerek — mi indíthatja el

### Egyszerű triggerek (simple)
Automatikusan működnek, nem kell engedély, **de korlátozottak**:
`onOpen(e)`, `onEdit(e)`, `onSelectionChange(e)`, `onInstall(e)`, `doGet(e)`, `doPost(e)`

- ⏱️ **30 másodperc** a limit
- 🚫 Nem érnek el engedélyt igénylő szolgáltatást (pl. `GmailApp` küldés, más fájl megnyitása)
- 🚫 Nem futnak le, ha a fájlt API-ból vagy másik scriptből módosítják
- 🚫 Nem futnak csak-olvasható megnyitásnál

### Telepített triggerek (installable)
Ezek a valódi munkalovak. Engedélyt kérnek, és **annak a nevében futnak,
aki létrehozta őket**.

| Típus | Mikor fut |
|---|---|
| Időzített | 1 / 5 / 10 / 15 / 30 percenként, óránként, naponta, hetente, havonta, vagy konkrét időpontban (`.after(ms)`) |
| Szerkesztéskor (`onEdit`) | Cella módosul (felhasználó által) |
| Változáskor (`onChange`) | Sor/oszlop beszúrás, lapstruktúra változás |
| Űrlap beküldéskor | Form válasz érkezik |
| Megnyitáskor | Fájl megnyílik |
| Naptár frissítéskor | Esemény változik |
| Add-on triggerek | Homepage / kontextus (pl. Gmail üzenet megnyitása) |

**Fontos korlátok:**
- Max **20 trigger / felhasználó / script** — ezért kell az egyszeri triggereket törölni futás után
- Az időzítés **ablak, nem időpont**: "8:00" = "8:00 és 9:00 között"
- A trigger a létrehozó jogosultságával fut → ha ő elmegy a cégtől, leáll
- Hiba esetén a tulajdonos kap emailt (ezt ne tekintsd monitoringnak)

```javascript
// Napi futás, reggel 7 és 8 között
ScriptApp.newTrigger('dailySync')
  .timeBased()
  .atHour(7)
  .everyDays(1)
  .inTimezone('Europe/Budapest')
  .create();

// Egyszeri, 2 perc múlva (folytatásos futáshoz)
ScriptApp.newTrigger('continueProcessing')
  .timeBased()
  .after(2 * 60 * 1000)
  .create();
```

---

## Egyedi függvények (custom functions)

`=MYFUNC(A1)` a cellában. Csábító, de szigorú szabályai vannak:

- ⏱️ **30 másodperc** futásidő
- 🚫 **Nem érhet el engedélyt igénylő szolgáltatást** (nincs Gmail, nincs másik fájl)
- 🚫 Nem írhat máshova, csak a saját cellájába visszatérési értékkel
- 🔁 Az eredmény cache-elődik; ugyanarra a bemenetre nem fut újra
- 💥 500 cellában `=MYFUNC()` + `UrlFetchApp` = kvótarobbanás

**Használd:** tiszta számításra, szövegformázásra, üzleti logikára.
**Ne használd:** API-hívásra, adatlekérésre, bármire, ami mellékhatással jár.

---

## Amit sokan nem tudnak, hogy tud

- **PDF generálás** natívan: `DriveApp.getFileById(id).getAs('application/pdf')`,
  vagy Sheet export URL-lel — nem kell hozzá külső eszköz
- **HMAC aláírás**: `Utilities.computeHmacSha256Signature()` — aláírt webhookok
  validálásához és külső API-k autentikálásához
- **Párhuzamos HTTP**: `UrlFetchApp.fetchAll([...])` — az *egyetlen* valódi
  párhuzamosítás a platformon, és rengeteget gyorsít
- **Naptári fájlformátumok**: iCal, vCard generálás `ContentService`-szel
- **OAuth más szolgáltatásokhoz**: a Google `OAuth2` library-vel bármilyen
  külső OAuth-os API-hoz (pl. Meta, LinkedIn) hitelesítés
- **Chat-értesítés webhookkal**: 5 sor kód, és a script szól a csapatnak
- **Sheet mint mini-adatbázis SQL-lel**: `=QUERY()` formula + script kombináció
- **Futtatás kívülről**: Apps Script API (`scripts.run`) vagy webapp URL — így
  hívhatja Cloud Scheduler, n8n, vagy akár egy másik script

---

## Mit hoz a 2025–2026-os időszak

- **Apps Script "core service"** a Workspace-ben → vállalati adatvédelem,
  admin-kontrollok és hivatalos támogatás alá esik (ügyfélmunkánál jó érv)
- **Gemini a szerkesztőben** – oldalsávról kódgenerálás és magyarázat,
  a projekt és a gazdafájl kontextusával
- **Rhino runtime elavult** (2025.02.20) → minden új projekt V8
- **Workspace Add-on + Chat** irány egységesedik (`AddOnsResponseService` GA)

A Gemini-asszisztens gyors, de a [03. fejezet](03-gondolatisag.md) elveit nem
helyettesíti: generált kódnál is neked kell megválaszolnod, hogy mi történik
hibánál, ki futtatja, és mi van kvótatúllépéskor.
