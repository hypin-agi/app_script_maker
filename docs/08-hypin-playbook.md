# 08 – Hypin' playbook: mit érdemes ügynökségként megépíteni

Ez a fejezet konkrét. Nem arról szól, mit *lehet*, hanem arról, mi **térül meg**
egy marketing ügynökségben, és milyen sorrendben érdemes nekiállni.

---

## A megtérülési rangsor

A becslések 20–40 aktív ügyféllel számolnak.

| # | Automatizálás | Havi megtakarítás | Fejlesztés | Nehézség |
|---|---|---|---|---|
| 1 | **Havi ügyfélriport generálás** (Slides/Docs → PDF → email) | 10–15 óra | 6–10 óra | 🟢 Alacsony |
| 2 | **Kampányadat-szinkron** (Meta/Google/TikTok → Sheet → Looker) | 8–12 óra | 8–16 óra | 🟡 Közepes |
| 3 | **Ügyfél-onboarding csomag** (mappa + doksik + naptár + hozzáférések) | 4–6 óra | 4–6 óra | 🟢 Alacsony |
| 4 | **Tartalomnaptár → gyártási workflow** (státusz, értesítés, deadline) | 4–8 óra | 6–8 óra | 🟢 Alacsony |
| 5 | **Büdzsé- és teljesítményőr** (riaszt, ha elszáll a CPA vagy elfogy a keret) | *hibamegelőzés* | 3–5 óra | 🟢 Alacsony |
| 6 | **Ajánlat- és szerződésgenerálás** sablonból | 3–5 óra | 4–6 óra | 🟢 Alacsony |
| 7 | **Forgatás-logisztika** (call sheet, naptár, mappastruktúra) | 2–4 óra | 4–6 óra | 🟢 Alacsony |
| 8 | **Kreatív-teljesítmény tábla** (melyik hook/formátum megy) | 3–6 óra | 8–12 óra | 🟡 Közepes |
| 9 | **Lead-routing** (form → CRM → értesítés → follow-up) | 2–4 óra | 4–6 óra | 🟢 Alacsony |

**Kezdd az 1-essel.** A riportgenerálás a legfájdalmasabb, legismétlődőbb és
leglátványosabb — ráadásul az ügyfél is látja az eredményét.

---

## 1. Havi ügyfélriport — a zászlóshajó

### Felállás

```
[Riport master Sheet]                [Slides sablon]
  ├─ Config   (ügyféllista, kapcsolók)      "{{ugyfel}}", "{{honap}}",
  ├─ Adat     (kampányadatok)               "{{koltes}}", "{{roas}}" …
  ├─ _Log
  └─ README
        │
        ▼  havi trigger (hónap 2. napja)
   ügyfelenként: sablon másolás → placeholder csere → PDF → Drive + email
```

### Kulcsdöntések

- **Slides vagy Docs?** Slides, ha az ügyfél deck-et vár (ez a tipikus).
  Docs, ha szöveges elemzés a lényeg. Slidesnál a `replaceAllText()` egy hívás
  az egész deckre — nagyon gyors.
- **Grafikonok:** ne scriptből rajzold. Tedd a chartot a forrás Sheetbe, és
  **linkeld be** a Slides-ba — frissítéskor a script csak a link-refresh-t kéri.
  Vagy: exportáld a chartot képként, és cseréld a placeholder képet.
- **Darabolás:** 40 ügyfél × (másolás + csere + PDF + email) simán 6 perc fölé
  megy. Kötelező a [folytatásos futás](05-mintak-kodtar.md#folytatásos-futás)
  és az [idempotencia napló](05-mintak-kodtar.md#9-idempotencia-napló).
- **Email-kvóta:** 40 ügyfél × 2 címzett = 80 egység. Workspace-en bőven belefér,
  ingyenes fiókon már veszélyes zóna. Ellenőrizd: `MailApp.getRemainingDailyQuota()`.
- **Kétlépcsős kiküldés:** a script generál és **draftot** készít vagy Drive-ba
  ment, az account manager átnézi, és **egy menüponttal küldi ki**.
  Ügyfélkommunikációban ez sokkal biztonságosabb, mint a teljes automatizmus.

```javascript
function generateMonthlyReports() {
  runSafely_('Havi riportok', () => {
    const cfg = getConfig_();
    if (!cfg.ENABLED) return;

    const clients = readAsObjects_(SpreadsheetApp.getActive().getSheetByName('Config'));
    const done    = getProcessedIds_();
    const period  = Utilities.formatDate(new Date(), cfg.TIMEZONE || 'Europe/Budapest', 'yyyy-MM');

    for (const client of clients.filter(c => c.Aktív === true)) {
      const key = `${client.ÜgyfélID}_${period}`;
      if (done.has(key)) continue;

      const data = collectClientData_(client, period);
      if (!data || data.költés == null) {                 // józansági ellenőrzés
        notifyChat_(`⚠️ ${client.Név}: nincs adat a(z) ${period} időszakra, kihagyom.`);
        continue;
      }
      if (cfg.DRY_RUN) { log_(`DRY RUN – ${client.Név}: ${JSON.stringify(data)}`); continue; }

      const pdf = generateDeck_(cfg.TEMPLATE_ID, cfg.OUTPUT_FOLDER_ID,
                                `${client.Név} – ${period} riport`, data);
      draftReportEmail_(client, pdf, period);             // draft, nem azonnali küldés
      markProcessed_(key, pdf.getUrl());
    }
  });
}
```

---

## 2. Kampányadat-szinkron

### Mit hova

| Forrás | Hogyan éred el | Megjegyzés |
|---|---|---|
| **Google Ads** | Google Ads Scripts (`AdsApp`) → Sheet | ⚠️ **Nem Apps Script!** Külön környezet, 30 perc futásidővel. Ads-adathoz ez a helyes eszköz. |
| **Meta Ads** | Graph API `UrlFetchApp`-pel | Long-lived token kell; token-lejárat figyelése kötelező |
| **TikTok Ads** | Marketing API `UrlFetchApp`-pel | Token-frissítés, rate limit |
| **GA4** | *Google Analytics Data* advanced service | A legtisztább út, nincs kézi OAuth |
| **Search Console** | Advanced service / REST | Napi késleltetés van az adatban |
| **LinkedIn / egyéb** | REST + `OAuth2` library | Az OAuth-flow itt a munka nagyja |

### A minta

```
napi trigger (hajnal)
  → token ellenőrzés (lejár-e 7 napon belül? → riasztás)
  → fetchAll() kötegelve fiókonként
  → józansági ellenőrzés (0 sor? drasztikus eltérés? → NE írj, riassz)
  → nyers adat egy "Raw" lapra (append, nem felülírás)
  → származtatott nézetek formulával vagy scripttel
  → Looker Studio erre a Sheetre néz
```

**Három szabály, ami sok fájdalmat megelőz:**

1. **Soha ne írd felül az élő táblát üres eredménnyel.** Ez a leggyakoribb
   „ügyfél sikoltozik" forgatókönyv.
2. **Append, ne overwrite.** A nyers adat legyen idősoros, dátummal. Így
   visszamenőleg is tudsz elemezni, és egy hibás futás nem semmisít meg mindent.
3. **A token lejáratát figyeld.** A Meta long-lived token ~60 nap. Írj be egy
   ellenőrzést, ami 7 nappal előtte szól. Enélkül minden 2. hónapban néma leállás.

> **Skálázási küszöb:** ha 10+ ügyfél × napi bontás × 12 hónap adatot tartasz
> Sheetben, kb. 50–100 ezer sornál elfogysz. Onnan **BigQuery** (a Looker
> közvetlenül tud rá nézni), és az Apps Script marad a betöltő és a riportgyártó.

---

## 3. Ügyfél-onboarding csomag

Egy sor az „Új ügyfél" lapon → egy gombnyomás → 3 perc alatt kész:

- Drive mappastruktúra (`01_Brief`, `02_Kreatív`, `03_Riport`, `04_Szerződés`)
- Brief és stratégia doksi sablonból, kitöltött fejléccel
- Riport Sheet a master sablonból másolva, ügyfél-ID-vel
- Kickoff meeting a naptárba, meghívókkal
- Bejegyzés a központi ügyféltáblába
- Üdvözlő email draft az account managernek

Ez a legkönnyebben megépíthető és a legjobban „érezhető" automatizálás —
minden új ügyfélnél megspórol fél napot és megszünteti a felejtést.

---

## 4. Tartalomnaptár → gyártási workflow

A tartalomgyártás természetes állapotgép: `Ötlet → Script → Forgatás → Vágás →
Jóváhagyás → Ütemezve → Kint`.

Amit a script csinálhat:

- **Státuszváltáskor értesítés** a felelősnek (Chat/email) — `onEdit` trigger
- **Deadline-figyelés:** ami 48 órán belül esedékes és nincs kész → napi
  összefoglaló a csapatnak
- **Automatikus mappa és nevezéktan** minden új tartalomhoz
  (`2026-03-14_ugyfel_reels_hook-v2`)
- **Jóváhagyási link** generálása (Drive megosztás + email az ügyfélnek)
- **Publikálás utáni visszamérés:** a kint lévő tartalmak teljesítménye
  visszakerül a naptár sorába → látszik, melyik hook/formátum működik

**Ami már nem Apps Script:** a tényleges közzététel ütemezése. Arra
ütemezőeszköz való (Zoomsphere, Later, Meta Business Suite) — az Apps Script
maximum az adatot adja át nekik.

---

## 5. Büdzsé- és teljesítményőr

A legkisebb kód, a legnagyobb hibamegelőzés:

```javascript
function budgetWatchdog() {
  runSafely_('Büdzsé őr', () => {
    const rows = readAsObjects_(sheet_('Kampányok'));
    const alerts = [];

    for (const r of rows) {
      const spent = Number(r.Költés) || 0, budget = Number(r.Büdzsé) || 0;
      const cpa   = Number(r.CPA) || 0,    target = Number(r.CPA_cél) || 0;

      if (budget && spent / budget > 0.9)
        alerts.push(`💸 *${r.Ügyfél} / ${r.Kampány}*: a keret ${Math.round(spent / budget * 100)}%-a elfogyott`);
      if (target && cpa > target * 1.5)
        alerts.push(`📈 *${r.Ügyfél} / ${r.Kampány}*: CPA ${cpa} Ft (cél: ${target} Ft)`);
      if (spent === 0 && r.Státusz === 'Aktív')
        alerts.push(`🛑 *${r.Ügyfél} / ${r.Kampány}*: aktív, de nulla költés – leállt?`);
    }
    if (alerts.length) notifyChat_(alerts.join('\n'));
  });
}
```

A harmadik ellenőrzés (aktív kampány nulla költéssel) az, ami a legtöbb pénzt
menti meg — ez az, amit emberi szemmel napokig nem vesznek észre.

---

## Amit ügynökségként **ne** Apps Scriptben csinálj

| Amit sokan megpróbálnak | Miért rossz ötlet | Helyette |
|---|---|---|
| Hírlevél / hideg email kiküldés Sheetből | Napi 100/1500 címzett kvóta, nincs leiratkozás, égeti a domain reputációt | Mailchimp, Klaviyo, Brevo |
| Social poszt automatikus publikálása | Instabil API-k, tokenlejárat, nincs hibakezelési felület | Zoomsphere, Later, Meta Business Suite |
| Ügyfél-dashboard „webappként" | Nincs státuszkód/header kontroll, lassú, nem skálázik | Looker Studio |
| Teljes CRM Sheetben + scriptben | 10–20 ezer sor felett összeomlik, nincs jogosultságkezelés | Rendes CRM (Zoho, Pipedrive, HubSpot) |
| Videó/kép feldolgozás, tömeges átméretezés | Blob-limit, nincs képfeldolgozás | Cloud Run + sharp/ffmpeg, vagy Canva/CapCut |
| Konkurenciafigyelés scrapinggel | Megosztott Google IP → blokk, kvóta | Erre való SaaS (Brand24, Apify) |
| AI tartalomgenerálás tömegben Sheetből | 6 perc / 30 mp limit, kvóta, drága hibázni | Külön pipeline; Apps Script maximum a brief-adagoló |

> **AI-hívás Apps Scriptből:** működik (`UrlFetchApp` + Gemini/Claude API), és kis
> volumenben (napi pár tucat hívás, pl. poszt-variánsok generálása egy Sheet
> sorból) teljesen jó. De **egyedi függvényben soha** — 200 cellányi `=AI(A1)`
> egyszerre 200 hívást indít, 30 másodperces limittel fejenként.

---

## Az ügynökségi „starter pack" — ezt építsd meg először

Ha most kezdenél, ebben a sorrendben, 3-4 hét alatt:

1. **`_Lib` sablonprojekt** — a `templates/starter/` tartalma: log, riasztás,
   retry, config, batch I/O. Minden további script ebből indul.
2. **Riportgenerátor** (1. pont) — a legnagyobb ROI.
3. **Büdzsé-őr** (5. pont) — legkisebb munka, azonnali érték.
4. **Onboarding csomag** (3. pont) — a csapat ezt fogja a legjobban szeretni.
5. **Adatszinkron** (2. pont) — a legtöbb munka, ezért utoljára; addigra már
   tudod, milyen adat kell valójában a riportokhoz.

Minden egyes projektnél: `README` lap, `ENABLED`/`DRY_RUN`, riasztás, heartbeat.
Kivétel nincs.
