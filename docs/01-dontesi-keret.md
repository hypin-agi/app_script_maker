# 01 – Döntési keret: mire jó, és mire nem való az Apps Script

## Az egymondatos szabály

> Az Apps Script akkor a jó választás, ha **az adat és a felhasználó is a Google
> Workspace-en belül él**, a munka **elfér 6 percben** (vagy darabolható), és
> **egy ember munkaóráját váltod ki** vele — nem terméket építesz.

Minden más döntés ebből vezethető le.

---

## A 6 kérdéses szűrő (mielőtt egy sort írnál)

Fuss végig rajta 3 perc alatt. Ha kettőnél több piros, ne Apps Scriptben oldd meg.

| # | Kérdés | 🟢 Zöld | 🟡 Sárga | 🔴 Piros |
|---|---|---|---|---|
| 1 | **Hol van az adat?** | 70%+ Workspace-ben (Sheets, Drive, Gmail, Calendar, Docs) | Vegyes: fél Sheet, fél külső API | Semmi nincs Google-ban |
| 2 | **Ki használja?** | Belső kolléga vagy ügyfél, aki már a Sheetben dolgozik | Ügyfél, akinek külön be kell léptetni | Nyilvános, ismeretlen, sok felhasználó |
| 3 | **Mennyi adat / futás?** | < 20 000 sor, < 100 külső hívás | 20–100 ezer sor, 100–1000 hívás | Százezres nagyságrend, streaming |
| 4 | **Elfér 6 percben?** | Igen, bőven | Nem, de természetesen darabolható | Nem, és egyben kell futnia (tranzakció) |
| 5 | **Mi van, ha 30 percig nem fut le?** | Senki nem veszi észre | Valaki idegesen keres | Pénz vagy SLA áll meg |
| 6 | **Ki üzemelteti 6 hónap múlva?** | Van nevesített gazdája, céges fiókon | Nálam van, de dokumentált | Egy kolléga privát fiókján, aki lehet, hogy elmegy |

**Olvasat:**
- 5–6 zöld → csináld Apps Scriptben, ma délután kész.
- Vegyes → csináld, de olvasd el a [03](03-gondolatisag.md) és [04](04-korlatok-es-kvotak.md) fejezetet, és tervezz darabolást + riasztást.
- 2+ piros → lásd lentebb: *"Mivel váltsd ki"*.

---

## 🟢 Zöld zóna — itt az Apps Script verhetetlen

Ezek azok az esetek, ahol semmi más nem gyorsabb, olcsóbb és egyszerűbb.

### 1. Workspace-en belüli ragasztás
A klasszikus: **X történik → Y legyen belőle**, mindkettő Google-ban.

- Google Form kitöltés → sor a Sheetben → automatikus email + Calendar esemény + Drive mappa létrehozás
- Új sor a Sheetben → Docs sablonból generált ajánlat PDF → elküldve
- Gmail címke → melléklet mentése Drive-ba → naplózás Sheetbe
- Sheet cella módosul → Chat/Slack értesítés a csapatnak

Miért itt nyersz: nincs auth, nincs infra, nincs havidíj. A `SpreadsheetApp`,
`GmailApp`, `DriveApp` már be van jelentkezve.

### 2. Sablonozott dokumentumgyártás tömegben
Ajánlat, szerződés, havi ügyfélriport, certificate, számlamelléklet.

Docs vagy Slides sablon → placeholder csere → PDF export → email vagy Drive.
Ez az egyik legjobb ROI-jú automatizálás egy ügynökségben: 40 ügyfél × 20 perc
havi riportgyártás = **13 munkaóra/hó** megspórolva.

### 3. Ütemezett adatszinkron külső API-ból Sheetbe
Meta Ads / Google Ads / TikTok / GA4 / CRM adat → napi frissítés Sheetbe →
Looker Studio dashboard épül rá.

Amíg napi 1–4 futásról és pár ezer sorról van szó, ez pont Apps Script-méret.

### 4. Egyedi UI nem-technikai kollégáknak
Menüpont, oldalsáv, gomb a Sheetben. Az account manager nem fog scriptet futtatni
a szerkesztőből, de egy `▶️ Riport generálás` menüpontot megnyom.

```javascript
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Hypin')
    .addItem('Havi riport generálás', 'generateMonthlyReport')
    .addItem('Kampányadatok frissítése', 'syncAdsData')
    .addSeparator()
    .addItem('Beállítások', 'showSettingsSidebar')
    .addToUi();
}
```

### 5. Adatminőség-őr és értesítő
Figyeli a Sheetet/Drive-ot, és szól, ha valami elromlik: nem jött meg a napi
adat, elfogyott a büdzsé, lejárt egy szerződés, üres egy kötelező mező.
Alacsony kód, magas érték.

### 6. Looker Studio community connector
Ha egy olyan adatforrást kell Looker Studióba kötni, amihez nincs kész konnektor
(saját API, egzotikus SaaS), az Apps Script a hivatalos út.

### 7. Belső mikro-webapp
Egy űrlap + egy Sheet + egy `doGet()`. Belső eszközre, 5–50 felhasználóval
tökéletes: szabadságkérő, eszközfoglaló, gyors adatrögzítő.

### 8. Gmail / Calendar / Chat add-on belső használatra
Oldalsáv a Gmailben, ami egy kattintással beírja az ügyfelet a CRM Sheetbe.
Amíg a saját domainen belül marad, nincs Marketplace-verifikáció.

---

## 🟡 Sárga zóna — megoldható, de tervezni kell

Ezek működnek, de csak ha tudatosan építed meg őket. Olvasd el hozzá a
[minták fejezetet](05-mintak-kodtar.md).

| Feladat | Mi a kockázat | Mit kell tenned |
|---|---|---|
| 50 000+ sor feldolgozása | 6 perces timeout | Darabolás + folytatásos futás (continuation pattern), `PropertiesService`-ben tárolt kurzor |
| 500+ külső API hívás | Timeout és kvóta | `UrlFetchApp.fetchAll()` kötegelve, cache, éjszakai futás |
| Tömeges email (100+ címzett) | Napi kvóta: 100 (ingyenes) / 1500 (Workspace) címzett | Kvótaellenőrzés `MailApp.getRemainingDailyQuota()`, darabolás napokra, vagy dedikált email-eszköz (Mailchimp, Klaviyo) |
| Webhook fogadás | Nincs sorbanállás, max 30 párhuzamos futás | Csak alacsony volumennél; azonnal írd Sheetbe/Properties-be és külön trigger dolgozza fel |
| Ügyfélnek átadott megoldás | Tulajdonlás, jogosultság, támogatás | Céges fiók, Shared Drive, dokumentáció, kill switch |
| Több fejlesztő ugyanazon | Nincs natív merge, egymásra mentés | `clasp` + git, lásd [07](07-fejlesztoi-workflow.md) |
| Pénzügyi / számlázási logika | Nincs tranzakció, van race condition | `LockService`, idempotencia-napló, kétszeres könyvelés elleni védelem |

---

## 🔴 Piros zóna — itt ne Apps Scriptben gondolkodj

Ez a fejezet lényege. Ezeket **nem** azért nem szabad, mert "nehéz", hanem mert
az eszköz alapvetően nem erre való, és hónapok múlva fizeted meg az árát.

### 1. Hosszan futó, nehéz adatfeldolgozás (ETL)
**Miért nem:** 6 perc kemény fal. Nincs párhuzamosság, nincs valódi async,
egy szálon fut minden. Százezres sorszámnál a `getValues()` memóriából is kifut.
**Helyette:** BigQuery + ütemezett query, Cloud Run job, vagy Python/Node az
adatoldalon. Apps Script maradhat a *trigger* és a *megjelenítés*.

### 2. Valós idejű rendszer
**Miért nem:** a legsűrűbb időzített trigger **1 perc**, és az sem pontos —
"körülbelül percenként" fut. Nincs websocket, nincs SSE, nincs streaming.
Hidegindítás másodpercekben mérhető.
**Helyette:** Pub/Sub + Cloud Run, vagy egy rendes backend.

### 3. Publikus termék backendje / nyilvános REST API
**Miért nem — és ez a legalábecsültebb pont:**
- **Nem tudsz saját HTTP státuszkódot visszaadni.** Egy hiba is `200 OK`.
- **Nem tudsz saját response headert küldeni.** Se `Cache-Control`, se saját CORS.
- Böngészőből `application/json` POST-nál a preflight `OPTIONS` elhasal
  (kerülőút: `text/plain` content-type és `e.postData.contents` parse).
- A hívás átirányít `script.googleusercontent.com`-ra — a redirectet a kliensnek kezelnie kell.
- Max 30 párhuzamos futás **felhasználónként**, nincs SLA, nincs autoscale.

**Helyette:** Cloud Run, Vercel, Supabase Edge Function. Apps Script webapp csak
belső eszköznek vagy alacsony forgalmú webhook-vevőnek jó.

### 4. Titkos vagy szabályozott adat kezelése
**Miért nem:** nincs valódi secret store. A `PropertiesService`-ben tárolt API
kulcsot **minden szerkesztő látja** (aki a scriptet szerkesztheti). Nincs
környezet-szétválasztás (dev/prod), nincs kulcsrotáció, a naplózás korlátozott.
**Ne tegyél bele:** kártyaadatot, egészségügyi adatot, jelszót, olyan ügyféladatot,
amire szerződéses titoktartás van.
**Helyette:** Secret Manager + Cloud Run, vagy legalább szigorúan korlátozott
szerkesztői kör és scope-minimalizálás.

### 5. Nagy fájlok és médiafeldolgozás
**Miért nem:** a `Blob` kb. 50 MB-ig kezelhető, nincs natív képmanipuláció,
videó-renderelés pedig végképp nincs. Egy 200 MB-os videó áthelyezése Drive-ban
még megy (`DriveApp`), de a tartalmát nem nyúlod meg.
**Helyette:** Cloud Run + ffmpeg/sharp, vagy külső média-API.

### 6. Komplex, nagy kódbázis több fejlesztővel
**Miért nem:** nincs natív modulrendszer (a `.gs` fájlok egy közös globális
névtérben élnek), nincs npm import, nincs beépített tesztfuttató, nincs típus.
`clasp` + TypeScript + bundler sokat javít, de ez már egy toldozott láncolat.
**Küszöb:** ha 2000 sor fölé nő, vagy 3+ fejlesztő nyúl hozzá — költöztesd.

### 7. Precíz ütemezés
**Miért nem:** az időzített trigger ablakot kap, nem időpontot. A "minden nap
8:00" valójában "8:00 és 9:00 között". Ha az ügyfél 8:00-kor várja a riportot,
ne ígérd 8:00-ra.
**Helyette:** Cloud Scheduler, ami cron-pontos, és hívhat Apps Script webappot is.

### 8. Amit egy no-code eszköz 10 perc alatt megold
**Miért nem:** ha a feladat "Typeform → Slack → Notion", a Make/n8n/Zapier
gyorsabb, átláthatóbb és karbantarthatóbb. Az Apps Script akkor nyer, ha
Workspace-mélység kell (cellaformázás, Docs-sablon, Gmail-szál kezelés) — abban
a no-code eszközök gyengék.

### 9. Tömeges hideg email / hírlevél
**Miért nem:** napi 100 / 1500 címzett kvóta, nincs leiratkozás-kezelés, nincs
deliverability-monitoring, és a Google-fiókod reputációját égeted.
**Helyette:** bármelyik rendes email-eszköz. Apps Script maximum tranzakciós
emailre (értesítés, riport kiküldése 20 ügyfélnek) jó.

### 10. Scraping ipari méretben
**Miért nem:** a `UrlFetchApp` megosztott Google IP-ről megy, gyorsan blokkolják,
és a napi hívásszám kvótás. Egy-két oldal lekérése rendben, 10 000 nem.

### 11. Olyan folyamat, ahol nincs Google-fiók a képben
Ha nincs Workspace az egyenletben, akkor az Apps Script csak egy furcsa,
korlátozott JavaScript-futtató. Ilyenkor semmilyen előnye nem marad.

---

## Mivel váltsd ki, ha pirosat kaptál

| A probléma | Ez legyen helyette | Miért |
|---|---|---|
| Túl sok adat, túl lassú | **BigQuery** (+ Sheets connected sheets) | Milliós sorok, SQL, ingyenes keret bőven elég |
| Túl hosszú futás | **Cloud Run Job / Cloud Functions** | Nincs 6 perces fal, fizetős de fillér |
| Kell pontos ütemezés | **Cloud Scheduler** | Valódi cron |
| Kell rendes API | **Cloud Run / Vercel / Supabase** | Státuszkód, header, CORS, skálázás |
| Több SaaS összekötése | **Make / n8n / Zapier** | Gyorsabb, vizuális, van hibakezelése |
| Kell app UI | **AppSheet** vagy egy rendes frontend | Az Apps Script HtmlService nem SPA-platform |
| Kell dashboard | **Looker Studio** | Ne Sheetben rajzolj chartot scriptből |
| Kell adatbázis | **Supabase / Firestore / BigQuery** | A Sheet nem adatbázis 10 000 sor felett |

**Fontos:** ezek nem "vagy-vagy". A legjobb felállás gyakran **hibrid**:
a nehéz munka Cloud Runban / BigQueryben fut, az Apps Script pedig az, ami a
Workspace felé néz — menüt ad, Sheetbe ír, Docsot generál, emailt küld.

---

## Költség-őszinteség

Az Apps Script "ingyenes", de nem ingyen van:

- **Nincs licencköltsége** — ez igaz, és ez a legnagyobb előnye.
- **Van üzemeltetési költsége** — valakinek figyelnie kell, hogy fut-e.
- **Van kockázati költsége** — ha a scriptet író kolléga fiókjához van kötve
  és elmegy, a trigger leáll, az ügyfél nem kap riportot, és senki nem tudja, miért.
- **Van "elakadási" költsége** — ha rossz eszközt választottál, a 3. hónapban
  úgyis újra kell írni, de addigra már ráépült három folyamat.

Ezért van az, hogy egy jó Apps Script megoldásnak **mindig van kilépési terve**:
leírod, mi váltja le, ha kinövi magát. Lásd [03 – Gondolatiság](03-gondolatisag.md).

---

## Döntési fa — 30 másodperc alatt

```
Google Workspace-en belül van az adat ÉS a felhasználó?
├─ NEM ──────────────────────────────► Make / n8n / Cloud Run
└─ IGEN
   │
   Elfér 6 percben (vagy szépen darabolható)?
   ├─ NEM ───────────────────────────► BigQuery / Cloud Run Job
   └─ IGEN
      │
      Nyilvános felhasználóknak szól, SLA-val?
      ├─ IGEN ────────────────────────► Rendes backend (Cloud Run / Vercel)
      └─ NEM
         │
         Érzékeny / szabályozott adat van benne?
         ├─ IGEN ─────────────────────► GCP + Secret Manager, vagy ne automatizáld
         └─ NEM ──────────────────────► ✅ APPS SCRIPT — csináld meg ma
```
