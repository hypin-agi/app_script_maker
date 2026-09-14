# Lead pontozó és szegmentáló

Meta (vagy bármilyen) űrlapos kampány leadjei érkeznek egy Google Sheetbe.
A script a válaszok alapján **pontozza** a leadet, **szegmensbe sorolja**, és
szegmensenként **más emailt küld** neki — percek alatt, nem másnap.

```
Meta Lead Ads ──► Google Sheet ──► 5 perces trigger
                    (új sor)          │
                                      ├─ email érvényes?  hozzájárulás?  duplikátum?
                                      ├─ pontozás a "Pontozás" lap szabályai szerint
                                      ├─ szegmens a "Szegmensek" lap sávjai szerint
                                      ├─ email a szegmens sablonjából
                                      └─ Hot lead ─► azonnali Chat/email értesítés a salesnek
```

---

## ⚠️ A legfontosabb dolog, mielőtt nekikezdesz

**Az `onEdit` és az `onChange` trigger NEM indul el megbízhatóan, ha a sort
API-n keresztül írja be a Meta, a Zapier, a Make vagy egy másik script.**
Ez a leggyakoribb ok, amiért egy ilyen automatizálás „néha működik".

Ezért itt **időzített trigger (5 perc) pásztázza a feldolgozatlan sorokat**.
Ez egyben a folytatásos futás is: ami nem fért bele, a következő futásban megy.

| Ahogy az adat érkezik | Megbízható trigger | Késleltetés |
|---|---|---|
| Meta → Zapier / Make / n8n → Sheet | ⏰ **időzített (5 perc)** | 0–5 perc |
| Meta Graph API-ból húzva Apps Scripttel | ⏰ időzített | 0–5 perc |
| Meta leadgen **webhook** → Apps Script webapp (`doPost`) | 🔔 webhook | másodperc |
| **Google** Form → Sheet | 🔔 `onFormSubmit` telepített trigger | másodperc |
| Ember gépeli be kézzel | 🔔 `onEdit` | azonnal |

> A lead-válaszidő a lead-gen legnagyobb konverziós tényezője. Az 5 perc bőven
> elég jó; ha másodperc kell, a Meta leadgen webhook az út — de az külön app-
> és végpont-hitelesítést igényel.

---

## Telepítés

### 1. Fájlok

Ez a modul a **starter vázra** épül. Egy új, **standalone** Apps Script projektbe másold:

```
templates/starter/00_Config.gs
templates/starter/01_Lib_Log.gs
templates/starter/02_Lib_Sheet.gs
templates/starter/03_Lib_Http.gs
templates/starter/04_Lib_Runtime.gs
templates/lead-scoring/20_Lead_Scoring.gs
templates/lead-scoring/21_Lead_Mailer.gs
templates/lead-scoring/22_Lead_Main.gs
templates/lead-scoring/appsscript.json
```

> 🚫 **A `templates/starter/10_Main.gs`-t NE másold be.** Az Apps Script fájljai
> közös globális névtérben élnek, és a két fájl `onOpen` / `removeAllTriggers`
> függvénye némán felülírná egymást. Ezt a modul `22_Lead_Main.gs`-e váltja ki.

### 2. Script Properties

Projekt beállítások → Script tulajdonságok:

| Kulcs | Érték |
|---|---|
| `SPREADSHEET_ID` | a leadeket tartalmazó munkafüzet ID-ja |
| `CHAT_WEBHOOK_URL` | Google Chat bejövő webhook (hibákhoz és hot lead értesítéshez) |

### 3. Első beállítás

Futtasd a **`setupLeadScoring()`** függvényt. Létrehozza a `Config`, `Leads`,
`Pontozás`, `Szegmensek`, `Sablonok`, `_Log`, `_Ledger` lapokat mintaadatokkal.

### 4. Élesítés sorrendben

1. **`TEST_EMAIL`** a Config lapon = a saját címed → minden levél oda megy
2. Menü: **🩺 Beállítás ellenőrzése** → amíg nem zöld, ne menj tovább
3. Menü: **🔍 Kijelölt sor pontozása** → nézd meg pár valós leaden, jól pontoz-e
4. Menü: **🧪 Próbafutás** → semmi nem megy ki, de a `_Log` mindent mutat
5. **♻️ Teszt-sorok visszaállítása**, ha újra akarsz tesztelni
6. `TEST_EMAIL` kiürítése, `DRY_RUN` = `FALSE`
7. Menü: **⏰ 5 perces trigger telepítése**
8. `checkHeartbeats()` napi triggerre — ez veszi észre, ha a script **nem is futott**

---

## A lapok

### `Leads` — ide érkezik az adat

Bármilyen fejléc lehet (a Meta a saját mezőneveit adja). A script a **fejléc
neve** alapján dolgozik, nem oszlop-pozíció szerint — így egy beszúrt oszloptól
nem törik el.

Öt oszlopot a script hoz létre és kezel: `Pontszám`, `Szegmens`, `Státusz`,
`Feldolgozva`, `Megjegyzés`. **A `Státusz` az, ami eldönti, mi számít újnak** —
üres = feldolgozandó.

| Státusz | Jelentés |
|---|---|
| *(üres)* | Új lead, a következő futásban feldolgozásra kerül |
| `Elküldve` | Megkapta az emailt |
| `Teszt` | Teszt módban ment ki (`TEST_EMAIL` be volt állítva) |
| `Próbafutás` | `DRY_RUN` – kiszámolva, de nem ment ki |
| `Duplikátum` | Ugyanaz a cím már kapott emailt `DEDUP_HOURS` órán belül |
| `Kihagyva` | Rossz email cím vagy nincs hozzájárulás |
| `Hiba` | A `Megjegyzés` oszlopban a részletek |

> ⚠️ **Ne rendezd és ne törölj sorokat a `Leads` lapon**, ha nincs valódi lead
> azonosító oszlop (`lead_id`, `id`, `Azonosító`). Ilyenkor a sorszám az
> azonosító, és a rendezés összekeverheti. Meta-leadnél a `lead_id` mindig jön —
> vedd bele a szinkronba.

### `Pontozás` — itt hangolod a logikát, kód nélkül

| Aktív | Mező | Operátor | Érték | Pont | Megjegyzés |
|---|---|---|---|---|---|
| `TRUE` | `havi_budzse` | `>=` | `500000` | `30` | Nagy büdzsé |
| `TRUE` | `havi_budzse` | `>=` | `200000` | `15` | Közepes büdzsé |
| `TRUE` | `mikor_indul` | `bármelyik` | `azonnal, 1 hónapon belül` | `25` | Sürgős |
| `TRUE` | `szolgaltatas` | `tartalmazza` | `videó` | `20` | Videós igény |
| `TRUE` | `phone_number` | `nem üres` | | `10` | Megadott telefon |
| `TRUE` | `beosztas` | `tartalmazza` | `hallgató` | `-20` | Nem célcsoport |

**Minden illeszkedő szabály pontja összeadódik.** A negatív pont is működik.

| Operátor | Mit csinál |
|---|---|
| `pontos` | Pontos egyezés (kis/nagybetű és szóköz nem számít) |
| `tartalmazza` | Részszöveg |
| `kezdődik` | Ezzel kezdődik |
| `bármelyik` | Vesszővel elválasztott lista bármelyik eleme |
| `regex` | Reguláris kifejezés |
| `nem üres` / `üres` | Kitöltötte-e a mezőt |
| `>=` `<=` `>` `<` | Számösszehasonlítás |

**A számfelismerés magyar formátumot is ért:** `500 000 Ft`, `1.500.000`, `2,5`.
Tartományos válasznál (`500 000 – 1 000 000 Ft`) az **alsó határral** számol.

> Miért a Sheetben és nem a kódban? Mert a pontozást hangolni kell — és azt az
> account manager is meg tudja tenni, minden változás látszik a Sheet
> verziótörténetében, és nem kell hozzá deployolni.

### `Szegmensek`

| Szegmens | Min pont | Max pont | Sablon ID | Belső értesítés |
|---|---|---|---|---|
| `Hot` | `60` | *(üres = végtelen)* | `hot` | `sales@hypin.hu` |
| `Warm` | `30` | `59` | `warm` | |
| `Cold` | `0` | `29` | `cold` | |

A **🩺 Beállítás ellenőrzése** menüpont figyelmeztet, ha a sávok között **rés**
vagy **átfedés** van — enélkül némán kimaradnának leadek.

### `Sablonok`

| Sablon ID | Tárgy | Forrás | Gmail piszkozat tárgya | HTML törzs |
|---|---|---|---|---|
| `hot` | `Szia {{full_name\|}}! Mikor beszélünk?` | `sheet` | | `<p>Szia…</p>` |
| `warm` | `Köszönjük az érdeklődést` | `gmail-piszkozat` | `WARM sablon v2` | |

**Behelyettesíthető:** a `Leads` lap bármelyik oszlopa (`{{full_name}}`,
`{{email}}`), plusz `{{Pontszám}}`, `{{Szegmens}}`, `{{Dátum}}`.

**Tartalék érték:** `{{full_name|Kedves Érdeklődő}}` — ha a mező üres, a `|`
utáni szöveg kerül be. Így soha nem megy ki „Szia !" kezdetű levél.

A lead válaszai HTML-escape-elve kerülnek a levélbe, tehát egy furcsa karakter
nem tudja széttörni a sablont.

> **Gmail piszkozat forrásnál** a marketinges a Gmailben írja meg a levelet
> formázva, képpel, aláírással. Cserébe ez **Gmail-hozzáférési scope-ot igényel**,
> ami az egyik legtágabb — ezért az alapértelmezett `appsscript.json` nem
> tartalmazza. Ha használod, vedd fel: `"https://mail.google.com/"`.

---

## Beállítások (`Config` lap)

| Kulcs | Alap | Mit csinál |
|---|---|---|
| `ENABLED` | `TRUE` | Fő kapcsoló. `FALSE` = azonnali kilépés. |
| `DRY_RUN` | `FALSE` | Mindent kiszámol és naplóz, de **nem küld**. |
| `TEST_EMAIL` | üres | ⚠️ Ha ki van töltve, **minden** levél ide megy, `[TESZT → eredeti@cím]` tárggyal. |
| `EMAIL_COLUMN` | `email` | A lead email oszlopának neve. |
| `CONSENT_COLUMN` | üres | Hozzájárulás oszlop. Üres = nincs ellenőrzés. |
| `CONSENT_TRUE_VALUES` | `igen,yes,true,elfogadom,1` | Mi számít elfogadásnak. |
| `DEDUP_HOURS` | `72` | Ennyi órán belül ugyanarra a címre nem megy újabb levél. |
| `MAX_PER_RUN` | `150` | Maximum lead egy futásban. |
| `QUOTA_RESERVE` | `20` | Ennyi email-kvótát mindig meghagyunk tartaléknak. |
| `SENDER_NAME` | `Hypin` | A feladó megjelenített neve. |
| `REPLY_TO` | üres | Válasz-cím. |
| `ALERT_EMAIL` | üres | Ide megy a hibariasztás. |

---

## Ami élesben elrontja az ilyen scripteket — és itt meg van oldva

| Kockázat | Mi történne | Hogyan kezeli a modul |
|---|---|---|
| Trigger nem indul API-írásra | „Néha működik", leadek némán kimaradnak | 5 perces időzített pásztázás |
| Kétszeres kiküldés timeout után | A lead kétszer kapja meg | `_Ledger` napló, küldés **után azonnal** jelölve |
| Meta duplikált leadet ad | Ugyanaz a cím több levelet kap | `DEDUP_HOURS` ablak email cím szerint |
| Elfogy a napi email-kvóta | Fél kampány kimarad, csendben | `MailApp.getRemainingDailyQuota()` + `QUOTA_RESERVE` |
| Elgépelt oszlopnév a szabályban | Mindenki 0 pontot kap, mindenki `Cold` | `validateLeadSetup_()` futás előtt megáll |
| Rés a szegmens-sávok között | Egyes pontszámok senkihez nem tartoznak | A validátor jelzi |
| Üres név a sablonban | „Szia !" megy ki az ügyfélnek | `{{mező\|tartalék}}` szintaxis |
| Teszt levél kimegy valódi leadnek | Kínos | `TEST_EMAIL` átirányít, `DRY_RUN` nem küld |
| Hibás email cím | A futás elszáll a közepén | Validáció, `Kihagyva` státusz, a többi megy tovább |
| Nincs marketing hozzájárulás | Jogi kockázat | `CONSENT_COLUMN` ellenőrzés |
| Lassú soronkénti írás | 150 leadnél percekben mérhető | Egy olvasás + egy írás a végén |

---

## Mikor nőd ki

Ez a modul **napi pár száz leadig és 3–6 szegmensig** a jó eszköz. Költözz tovább, ha:

- **több lépcsős nurture kell** (3 nap múlva 2. levél, 7 nap múlva 3.) → marketing automation eszköz
- **napi 1000+ lead** vagy a Workspace email-kvóta (1500 címzett/nap) szűk
- **kell leiratkozás-kezelés, deliverability-mérés, A/B teszt** → email platform
- **a lead életútját is követni kell** (értékesítési fázisok, tevékenységek) → CRM

Ilyenkor is megmarad a hasznos fele: **a pontozás és a szegmentálás maradhat itt**,
a kiküldést pedig átveszi a CRM vagy az email eszköz — a script csak átadja neki
a pontszámot és a szegmenst.
