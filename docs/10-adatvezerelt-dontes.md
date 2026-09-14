# 10 – Beérkező adat vizsgálata és döntés

*„Új sor érkezik a Sheetbe, a script megnézi a tartalmát, és aszerint csinál valamit."*

Ez az Apps Script legtermészetesebb feladata — és egyben az, amit a leggyakrabban
építenek meg rosszul. Ez a fejezet a mintát írja le általánosan; a működő
megvalósítás: [`templates/lead-scoring/`](../templates/lead-scoring/README.md).

---

## 1. A legfontosabb kérdés: mi indítja el?

Ezen bukik el a legtöbb ilyen automatizálás. A válasz attól függ, **hogyan
kerül be az adat** a Sheetbe.

| Ahogy a sor létrejön | `onEdit` | `onChange` | `onFormSubmit` | Mit használj |
|---|---|---|---|---|
| Ember gépeli be | ✅ | ✅ | – | `onEdit` telepített trigger |
| **Google Form** beküldés | ❌ | ✅ | ✅ | `onFormSubmit` telepített trigger |
| **Zapier / Make / n8n** írja be | ❌ | ⚠️ megbízhatatlan | ❌ | ⏰ **időzített trigger** |
| **Meta / TikTok / CRM** integráció API-n át | ❌ | ⚠️ megbízhatatlan | ❌ | ⏰ **időzített trigger** |
| Másik Apps Script írja | ❌ | ❌ | ❌ | ⏰ időzített, vagy közvetlen függvényhívás |
| Külső rendszer webhookja | – | – | – | 🔔 webapp `doPost` |

> **A szabály:** *az Apps Script triggerei nem indulnak el megbízhatóan olyan
> változásra, amit az API vagy egy másik script okozott.* Ha az adat nem emberi
> gépelésből vagy Google Formból jön, **ne eseményre építs — pásztázz**.

Ez nem korlátozás, amit meg kell kerülni. Ez a helyes architektúra: a pásztázó
minta ráadásul **újraindítható és utolérő** — ha a script két órára leállt, a
következő futás a teljes lemaradást feldolgozza. Egy elmulasztott esemény
viszont örökre elveszik.

---

## 2. A három architektúra-minta

### A) Eseményvezérelt — *Google Form vagy kézi bevitel*

```
sor létrejön ──► onFormSubmit / onEdit ──► döntés ──► akció
```
✅ Azonnali (másodperc). ❌ Csak a fenti két esetben megbízható, és ha a
végrehajtás elszáll, az esemény **nem jön vissza**.

**Ezért:** még eseményvezérelt esetben is írj egy naponta futó „utolérő"
pásztázást, ami a kimaradt sorokat feldolgozza.

### B) Pásztázó (polling) — *az alapértelmezés*

```
⏰ 5 percenként ──► "melyik sor még feldolgozatlan?" ──► döntés ──► akció ──► állapot visszaírása
```
✅ Megbízható minden adatforrásnál, utolér, újraindítható, egyszerű.
❌ 0–5 perc késleltetés (ami a gyakorlatban szinte mindig elég).

**Ez a minta ráadásul ingyen megoldja a 6 perces limitet is:** amit egy futás
nem ér el, azt a következő viszi. Nem kell hozzá folytatásos trigger.

### C) Webhook — *ha másodperc kell*

```
külső rendszer ──► doPost webapp ──► sorba tesz ──► ⏰ trigger feldolgozza
```
✅ Valós idejű átvétel. ❌ Több beállítás, hitelesítés kell, és a webapp csak
**átvesz**, nem dolgoz fel (különben a küldő timeoutol, és belefutsz a
30 párhuzamos végrehajtás limitbe). Lásd [05/11](05-mintak-kodtar.md#11-webhook-fogadó-dopost).

---

## 3. Az állapotoszlop — a minta gerince

A pásztázó megoldás egyetlen dolgon áll vagy bukik: **honnan tudja, mi az új?**

Rossz válaszok:
- ❌ *„az utolsó sor óta"* → egy középre beszúrt sor kimarad
- ❌ *„az utolsó futás időbélyege óta"* → a késve érkező adat kimarad
- ❌ *„ami még nincs a naplóban"* → működik, de a felhasználó nem látja, mi történt

Jó válasz: **`Státusz` oszlop a táblában.**

```
Státusz üres  →  feldolgozandó
Státusz kitöltve  →  kész (és a Megjegyzés oszlopban ott van, MIÉRT)
```

Miért ez a legjobb:
1. **Látható.** Az account manager ránéz, és látja, melyik lead miért maradt ki.
2. **Javítható.** Ha valami elromlott, kitörli a státuszt, és újrafut.
3. **Nem igényel külön nyilvántartást** a felhasználó felé.

Az állapotoszlop mellé viszont **kell egy belső napló is** (`_Ledger`), mert az
irreverzibilis műveletnél (email, számla, API-hívás) az a hiteles forrás:
a státuszírás elveszhet egy összeomlásban, a napló nem — így soha nem megy ki
kétszer ugyanaz a levél.

```javascript
// Sorrend, ami számít:
sendEmail_(lead);                    // 1. irreverzibilis művelet
markProcessed_(key, 'elküldve');     // 2. AZONNAL naplózni
updates.push({ row, values });       // 3. státusz a végén, batchben
```

---

## 4. A döntési logika helye: a Sheetben, ne a kódban

Ez a különbség egy Level 1 és egy Level 3 megoldás között.

```javascript
// ❌ A logika a kódban: minden hangoláshoz fejlesztő és deploy kell
if (lead.budget > 500000 && lead.urgency === 'azonnal') segment = 'hot';

// ✅ A logika a "Pontozás" lapon: az account manager hangolja, látszik a verziótörténetben
const rules = loadRules_();          // Mező | Operátor | Érték | Pont
const score = scoreLead_(lead, rules);
```

**Amit a Sheetbe tegyél:** küszöbértékek, pontszámok, szegmenshatárok,
email sablonok, kapcsolók, címzettlisták.
**Amit a kódban hagyj:** a *motor* — hogyan értelmezi a szabályokat.

Egy pontozási rendszert **hangolni kell**, és ez sosem ér véget. Ha ehhez
minden alkalommal hozzád kell nyúlni, a rendszer 3 hónap múlva elavult
küszöbökkel fog futni.

---

## 5. Elágazás tervezése: rés és átfedés

Ha pontszám alapján sávokra osztasz, két néma hiba leselkedik:

```
Hot:  60–∞     Warm: 30–59     Cold: 0–29        ✅ hézagmentes
Hot:  60–∞     Warm: 35–59     Cold: 0–29        ❌ a 30–34 pontos leadek eltűnnek
Hot:  50–∞     Warm: 30–59     Cold: 0–29        ❌ átfedés: az 55 pontos kettőbe is esik
```

Mindkettő **csendben** okoz kárt. Ezért a megoldásban legyen egy **validátor**,
ami futás előtt ellenőrzi a sávokat, és inkább **meg sem indul**, ha talál hibát:

```javascript
const problems = validateSetup_();
if (problems.length) { alert_('Hibás beállítás, nem indulok:\n' + problems.join('\n')); return; }
```

Ugyanez a validátor fogja meg az elgépelt oszlopnevet is — ami a másik klasszikus:
ha a szabály `havi_budzset` mezőre hivatkozik, de az oszlop `havi_budzse`,
akkor **minden lead 0 pontot kap, és mindenki a legalacsonyabb szegmensbe esik**.
A script „működik", csak rosszul.

---

## 6. Mielőtt cselekszel: a kapuk

Minden beérkező adatot ellenőrizni kell, mielőtt döntesz róla. Sorrend számít —
a legolcsóbb és legbiztosabb kizárások jönnek előre:

1. **Már feldolgoztuk?** (napló) → kilép
2. **Használható az adat?** (érvényes email, kötelező mező megvan) → `Kihagyva`
3. **Szabad-e?** (marketing hozzájárulás, opt-out lista) → `Kihagyva`
4. **Duplikátum?** (ugyanaz a cím X órán belül) → `Duplikátum`
5. **Van erőforrás?** (napi email-kvóta, `getRemainingDailyQuota()`) → riaszt és vár
6. **Csak most** jön a döntés és az akció

Mindegyik kapunál **jegyezd fel a `Megjegyzés` oszlopba, miért állt meg**.
Ez a különbség aközött, hogy „nem kapott levelet" és „nem kapott levelet, mert
hibás volt az email címe" — az elsővel senki nem tud mit kezdeni.

---

## 7. Amit sokan kihagynak

| Kockázat | Miért fáj | Megoldás |
|---|---|---|
| Nincs teszt mód | Az első éles futás valódi ügyfeleknek megy ki | `TEST_EMAIL`: mindent egy címre irányít |
| Nincs `DRY_RUN` | Nem látod előre, mit csinálna | Kiszámol és naplóz, de nem küld |
| Soronkénti `setValue` | 150 sornál percek | Egy olvasás + egy írás a végén |
| Sorszám az azonosító | Rendezés/törlés után összekeveredik | Valódi ID oszlop (`lead_id`) |
| Nincs mennyiségi plafon | Egy hibás import 5000 levelet küld | `MAX_PER_RUN` limit |
| Nincs heartbeat | Két hete nem fut, senki nem tudja | `checkHeartbeats()` napi triggeren |
| A felhasználó nem tudja újraindítani | Minden hiba hozzád jut vissza | Menüpont + „töröld a Státuszt és újrafut" a README lapon |

---

## 8. Mikor nem ez a jó eszköz

Ez a minta **napi pár száz elemig** kiváló. Költözz tovább, ha:

- **több lépcsős, időzített utánkövetés** kell (3 nap múlva 2. levél, 7 nap múlva 3.)
  → marketing automation eszköz; az Apps Script ezt csak fájdalmasan szimulálja
- **napi 1000+ kiküldés** → a Workspace email-kvóta (1500 címzett/nap) elfogy
- **leiratkozás-kezelés, deliverability, A/B teszt** kell → email platform
- **az elem életútját is követni kell** (fázisok, tevékenységek, előzmények) → CRM

A jó hír: ilyenkor sem dobod el a munkát. **A döntési logika — a pontozás és a
szegmentálás — maradhat Apps Scriptben**, és csak a kiküldést veszi át a
másik rendszer. Ez pontosan az a hibrid felállás, amiről a
[03. fejezet](03-gondolatisag.md#2-az-apps-script-ragasztó-nem-platform) beszél.

---

## Működő megvalósítás

[`templates/lead-scoring/`](../templates/lead-scoring/README.md) — Meta űrlapos
leadek pontozása és 3 szegmensre bontása, szegmensenként külön emaillel.
Tartalmazza a fenti minták mindegyikét: pásztázó trigger, állapotoszlop,
Sheet-alapú szabályok, validátor, kapuk, teszt mód, kvóta-őr, duplikátum-védelem.
