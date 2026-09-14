# 06 – Biztonság és üzemeltetés

Ez a fejezet arról szól, ami a kód *után* jön — és amitől egy script vagy
évekig szolgál, vagy egy hónap múlva csendben elhal.

---

## 1. A legfontosabb kérdés: kinek a nevében fut?

Az Apps Script **nem egy semleges szerver**. Mindig valakinek a jogosultságával
dolgozik, és az a valaki felelős azért, amit csinál.

| Kontextus | Ki nevében fut | Kockázat |
|---|---|---|
| Kézi futtatás a szerkesztőből | Aki megnyomja | Alacsony |
| Telepített trigger | **Aki létrehozta a triggert** | A fiók megszűnésével leáll |
| Egyszerű trigger (`onEdit`) | Aki szerkesztett (korlátozott jogokkal) | Alacsony |
| Webapp – *Execute as: Me* | **A deployoló** | ⚠️ Magas: aki eléri az URL-t, a te jogaiddal cselekszik |
| Webapp – *Execute as: User accessing* | A hívó felhasználó | Alacsonyabb, de csak bejelentkezett felhasználóknál |
| Library | A **hívó** script jogosultságával | Az engedélyeket a hívó kéri |

### A webapp-csapda

```
Execute as: Me  +  Who has access: Anyone
= bárki a világon a te Google-fiókod jogosultságaival futtathat kódot
```

Ez teljesen legitim beállítás **webhook-fogadóhoz** — de akkor **kötelező** a
saját hitelesítés (megosztott titok vagy HMAC aláírás, lásd [05/11](05-mintak-kodtar.md#11-webhook-fogadó-dopost)).
Enélkül a végpontod nyitott ajtó a Drive-odhoz.

**Ökölszabály:** ha a webapp bármilyen adatot *ír* vagy *kiad*, és „Anyone"-ra
van állítva, **kell bele token-ellenőrzés**.

---

## 2. OAuth scope-ok: kérj keveset

Az Apps Script alapból **kitalálja** a szükséges scope-okat a kódból — és
általában túl tágat választ. Ha a kódban van egy `DriveApp`, az `.../auth/drive`
scope-ot kér: **hozzáférést a felhasználó teljes Drive-jához**.

Ezért az éles projektekben **írd ki explicit módon** az `appsscript.json`-ban:

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

| Tág scope | Szűkebb alternatíva | Mit ad |
|---|---|---|
| `auth/spreadsheets` | `spreadsheets.currentonly` | Csak a gazdafájlt (kötött scriptnél) |
| `auth/drive` | `drive.file` | Csak a script által létrehozott/megnyitott fájlokat |
| `auth/gmail.modify` | `gmail.send` vagy `gmail.readonly` | Csak küldés / csak olvasás |
| `auth/calendar` | `calendar.events` | Csak eseményeket, naptárbeállításokat nem |

**Miért számít ez tényleg:**
1. Az ügyfél az engedélykérő képernyőn látja, mit kérsz. „Teljes hozzáférés a
   Drive-hoz" — ez elad vagy megbuktat egy projektet.
2. Marketplace-publikálásnál a tág („restricted") scope-ok **biztonsági auditot
   (CASA)** vonnak maguk után: hetek és pénz.
3. Egy kompromittált script annyi kárt tud okozni, amennyi scope-ot kapott.

---

## 3. Titkok kezelése — amit tudni kell

**Az Apps Scriptben nincs valódi secret store.** Ezt fogadd el, és tervezz köré.

| Hol tárolható | Ki látja | Használható titokra? |
|---|---|---|
| Kód (`.gs` fájl) | Minden szerkesztő, és a git történet | ❌ **Soha** |
| `Config` lap a Sheetben | Mindenki, akinek a Sheethez hozzáférése van | ❌ Soha |
| Script Properties | Minden **szerkesztő** (a Projekt beállításoknál látszik) | 🟡 Elfogadható, ha a szerkesztői kör szűk |
| User Properties | Csak az adott felhasználó | 🟢 Felhasználónkénti token |
| GCP Secret Manager (UrlFetch-en át) | Csak akinek IAM joga van | 🟢 Ez a helyes, de körülményes |

**Gyakorlati minimum ügyfélmunkánál:**

- API kulcs **kizárólag** Script Propertiesben
- A script **szerkesztői körét** tartsd 1–2 emberre (a nézők/ügyfelek a Sheetet
  kapják meg, nem a scriptet — ezért is jobb a **standalone script**, mint a kötött)
- Amit ki tudsz váltani szolgáltatásfiókkal vagy szűkebb jogú tokennel, azt váltsd ki
- Kulcsrotáció: írd be a README-be, mikor és ki cseréli

> **Tudd, hogy az Apps Script natívan nem tud Google-szolgáltatásokhoz
> service accountot használni.** Domain-wide delegation csak kézzel, a `OAuth2`
> library-vel és JWT-vel oldható meg. Ha ezt kell csinálnod, az általában jelzés:
> a feladat Cloud Runba való.

---

## 4. Tulajdonlás — a leggyakoribb elhalási ok

**A forgatókönyv:** egy kolléga megírja a scriptet a saját fiókjában, beállít egy
napi triggert, minden működik. Nyolc hónap múlva kilép. A fiókot felfüggesztik.
A trigger **csendben leáll**. Az ügyfél három hétig nem kap riportot, és senki
nem tudja, miért.

### Így kerüld el

1. **Standalone script, Shared Drive-on.** A Shared Drive-on lévő fájlnak a
   *csapat* a tulajdonosa, nem egy ember. Ha valaki kilép, a fájl marad.
2. **Nevesített gazda fiók.** Ideális esetben egy dedikált Workspace-fiók
   (pl. `automation@hypin.hu`), ami a triggereket tulajdonolja.
   Ennek saját, külön kvótája is van — ez plusz előny.
3. **Legalább két ember legyen szerkesztő.**
4. **README lap minden éles Sheetben** (lásd lentebb).
5. **Offboarding-checklist:** kilépő kolléga esetén nézd végig, milyen triggerek
   futnak a fiókján.

### A "mit csinál ez?" README lap

Minden éles Sheetbe tegyél egy `README` lapot. Tíz sor, de mindent megold:

```
Mit csinál:      Naponta lehúzza a Meta Ads költést és frissíti a Riport lapot.
Mikor fut:       Minden nap 7:00 és 8:00 között.
Tulajdonos:      automation@hypin.hu   (felelős: Bástya)
Ha nem fut:      1. Config lap → ENABLED = TRUE?
                 2. Menü: ⚡ Hypin → Kampányadatok frissítése (kézi indítás)
                 3. _Log lap → utolsó bejegyzés
Kill switch:     Config lap → ENABLED = FALSE
Hova szól hiba:  Google Chat „Hypin – Automatizálás" tér
Korlát:          10 000 sorig / napi 1 futásig. Efölött BigQuerybe költözik.
```

---

## 5. Monitoring — ne a Google hibaemailjére támaszkodj

A Google küld emailt, ha egy trigger hibára fut. **De nem küld semmit, ha:**

- a trigger nem fut le (kvóta elfogyott, fiók felfüggesztve)
- a script lefut, de hibás/üres adattal dolgozik
- a külső API 200-at ad, de üres választ

### Minimum monitoring — heartbeat

Írasd ki minden futás végén az időbélyeget, és egy **külön, ritka trigger**
figyelje, hogy nem avult-e el:

```javascript
function beat_(jobName) {
  PropertiesService.getScriptProperties()
    .setProperty('HEARTBEAT_' + jobName, String(Date.now()));
}

/** Naponta egyszer fut, más scriptből vagy ugyanabból. */
function checkHeartbeats() {
  const EXPECTED = { dailySync: 26, weeklyReport: 8 * 24 };   // órában
  const props = PropertiesService.getScriptProperties();

  Object.keys(EXPECTED).forEach(job => {
    const last = Number(props.getProperty('HEARTBEAT_' + job) || 0);
    const hours = (Date.now() - last) / 36e5;
    if (!last || hours > EXPECTED[job]) {
      notifyChat_(`🔴 *${job}* nem futott le ${Math.round(hours)} órája ` +
                  `(elvárt: ${EXPECTED[job]} órán belül).`);
    }
  });
}
```

Ez a 20 sor az, ami megkülönbözteti a Level 1 és a Level 2 scriptet.

### Cloud Logging

A `console.log()` a Cloud Loggingba megy. Teljes értékű naplózáshoz és hosszabb
megőrzéshez **kösd a scriptet standard GCP projekthez** (Projekt beállítások →
Google Cloud Platform projekt). Ezt amúgy is meg kell tenned, ha:
- OAuth-verifikáció kell (Marketplace),
- vagy hosszabb naplóhistória, hibariport kell.

---

## 6. Adatvédelem ügyfélmunkánál

Marketing ügynökségként rendszeresen ügyféladatot mozgatsz. Néhány dolog,
amit ki kell mondani, mielőtt automatizálsz:

- **Adatminimalizálás.** Ne szinkronizálj át olyan mezőt, amire nincs szükség.
  Egy kampányriporthoz nem kell a leadek email címe.
- **Hol landol az adat?** Ha a script ügyféladatot a Hypin' Drive-jára másol,
  az adatfeldolgozás — legyen róla megállapodás.
- **Ne építs személyes adatból „árnyék-adatbázist"** Sheetekben, amiről később
  senki nem tudja, kinél van és meddig.
- **Törlési igény.** Ha az ügyfél kéri az adat törlését, tudnod kell, melyik
  Sheetben, melyik logban, melyik Drive-mappában van meg. Ezért is jó, ha a
  README-ben le van írva, mit hol tárolsz.
- **Naplózás visszafogottan.** Ne logolj teljes payloadot, ha személyes adatot tartalmaz.
- **Ügyfél-környezetben futó script:** ha az ügyfél Workspace-ében fut a script,
  az ő kvótáját és az ő adatait érinti — ezt írásban tisztázd, és adj át
  dokumentációt (README lap + kill switch).

Az Apps Script 2025 óta Workspace **core service** — vállalati adatvédelem és
admin-kontrollok alá esik. Ez jó érv ügyfélbeszélgetésben, de nem helyettesíti
a fentieket.

---

## 7. Incidens-playbook

Amikor „nem megy a script", ebben a sorrendben nézd:

1. **Fut egyáltalán?** Szerkesztő → *Végrehajtások* (Executions). Van-e bejegyzés
   a várt időben? Mi a státusza?
2. **Ki a trigger tulajdonosa?** Szerkesztő → *Triggerek*. Ha a listád üres, de
   más fiókon fut, akkor az ő nézetében kell nézni.
3. **Kvóta?** A `Service invoked too many times` / `too much computer time`
   hibák a napi keret kimerülését jelzik. Nézd meg, nem fut-e másik script
   ugyanazon a fiókon.
4. **Kill switch?** `Config` lap → `ENABLED`. (Meglepően gyakran valaki átállította.)
5. **Külső API?** `_Log` lap + a válaszkódok. 401 → lejárt token. 429 → rate limit.
6. **Jogosultság?** Változott-e a fájl megosztása? Kikerült-e a tulajdonos fiók
   valamelyik mappából?
7. **Adat?** Változott-e a forrástábla szerkezete (átnevezett oszlop, beszúrt sor)?

**Helyreállítás:** a jól megépített script idempotens, tehát a javítás után
**egyszerűen újra lehet futtatni** — ez a legfontosabb ok, amiért a
[03. fejezet](03-gondolatisag.md) 4. pontját komolyan kell venni.

---

## Biztonsági checklist éles indulás előtt

- [ ] A script **standalone**, Shared Drive-on
- [ ] Nevesített, céges tulajdonos fiók (nem magánszemély, nem @gmail.com)
- [ ] Legalább 2 szerkesztő
- [ ] Explicit, **minimalizált** `oauthScopes` az `appsscript.json`-ban
- [ ] Nincs titok a kódban és a Config lapon
- [ ] Webapp esetén: hozzáférés és „execute as" tudatosan beállítva
- [ ] Webapp esetén: van token/aláírás-ellenőrzés
- [ ] Van kill switch (`ENABLED`) és `DRY_RUN`
- [ ] Van riasztás (Chat vagy email) minden hibaágon
- [ ] Van heartbeat-figyelés
- [ ] Van `README` lap: mit csinál, mikor fut, ki a gazdája, mi a teendő hiba esetén
- [ ] Az ügyféladat köre és tárolási helye tisztázott
