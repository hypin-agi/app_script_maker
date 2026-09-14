# 09 – Brief sablon: hogyan kérj (vagy adj) Apps Script feladatot

A rossz Apps Script megoldások fele a briefben dől el. Ez a sablon arra való,
hogy 10 perc kitöltéssel elkerüld a 10 óra újraírást — akkor is, ha kollégának
adod ki, akkor is, ha AI-jal (Gemini, Claude) íratod meg.

---

## A rövid változat — 6 kérdés

Ha semmi másra nincs idő, ez a hat mondat legyen meg:

```
1. MI A FÁJDALOM?     Ki csinálja most kézzel, milyen gyakran, mennyi ideig?
2. MI A KIMENET?      Mi legyen a végeredmény? (fájl, email, Sheet-sor, értesítés)
3. HOL AZ ADAT?       Konkrét Sheet/Drive/API + link vagy ID
4. MIKOR FUSSON?      Kézi indítás / napi / heti / eseményre
5. KI A GAZDÁJA?      Melyik fiók tulajdonolja, ki kap hibariasztást
6. MI A HIBA ÁRA?     Mi történik, ha rossz adattal fut le, vagy nem fut le?
```

---

## A teljes brief sablon

Másold ki, töltsd ki, tedd a repo `briefs/` mappájába vagy a projekt Sheetjébe.

```markdown
# Apps Script brief – [PROJEKT NEVE]

## 1. Üzleti cél
**A fájdalom:** <ki csinálja most kézzel, milyen gyakran, mennyi ideig>
**A megtakarítás:** <gyakoriság × időtartam × emberek> = ___ óra/hó
**A siker mércéje:** <mitől mondjuk azt, hogy működik>

## 2. Bemenet
| Forrás | Típus | Azonosító / link | Ki írja | Mekkora |
|---|---|---|---|---|
| pl. Kampány master | Google Sheet | 1abc… | account team | ~4 000 sor |
| pl. Meta Graph API | REST | v21.0 /insights | – | 12 fiók, napi bontás |

**Az adat szerkezete változhat?** <igen/nem — ha igen, fejléc-térkép kötelező>

## 3. Kimenet
- [ ] Sheet-frissítés — melyik lap, felülír vagy hozzáfűz?
- [ ] Generált dokumentum — sablon ID, cél mappa, névkonvenció
- [ ] Email — kinek, milyen tárggyal, draft vagy azonnali küldés?
- [ ] Értesítés — Chat tér / Slack csatorna
- [ ] Naptáresemény / Drive mappa / egyéb: ______

## 4. Indítás
- [ ] Kézi (menüpont a Sheetben — mi legyen a neve?)
- [ ] Időzített: ____________  ⚠️ *a trigger ablakot kap, nem pontos időpontot*
- [ ] Eseményre: form beküldés / cella szerkesztés / email érkezés
- [ ] Külső hívás (webhook) — ki hívja, milyen payloaddal?

## 5. Volumen és teljesítmény
- Elemszám futásonként: ______
- Külső API hívások száma futásonként: ______
- Belefér 6 percbe?  ☐ igen  ☐ nem → **folytatásos futás kell**
- Várható növekedés 12 hónapon belül: ______

## 6. Tulajdonlás és jogosultság
- Tulajdonos fiók: ______________ (⚠️ ne magánfiók, ne @gmail.com)
- Szerkesztők: ______________ (min. 2 fő)
- Hol lakik: ☐ Shared Drive  ☐ egyéb: ______
- Kötött vagy standalone script: ☐ standalone (alapértelmezés)  ☐ kötött, mert: ______
- Szükséges scope-ok (a lehető legszűkebbek): ______________
- Van benne személyes/ügyfél-érzékeny adat? ☐ nincs  ☐ van → mi, és hol tároljuk?

## 7. Hibakezelés
- Riasztás címzettje: ______________ (Chat tér / email)
- **Mi történik, ha üres adat jön?** ☐ ne írj semmit + riassz  ☐ egyéb: ______
- **Mi történik, ha kétszer fut le?** → idempotencia kulcs: ______________
- Kell `DRY_RUN` mód? ☐ igen (alapértelmezés)  ☐ nem, mert: ______
- Kell kill switch? ☐ igen (alapértelmezés)  ☐ nem, mert: ______

## 8. Határok
**Amit ez a megoldás NEM csinál:** <ezt írd le, hogy ne legyen vita később>
**Kilépési feltétel:** <milyen méretnél/igénynél költözik más eszközre, és mire>

## 9. Elfogadási kritériumok
- [ ] `DRY_RUN` futás éles adaton, hibátlan naplóval
- [ ] Kétszeri futtatás nem duplikál semmit
- [ ] Szándékos hiba (rossz token) → megérkezik a riasztás
- [ ] A menüpont működik nem-technikai kolléga fiókjából is
- [ ] `README` lap kitöltve a Sheetben
- [ ] Kód git-ben
```

---

## Ha AI-jal íratod meg

A generált kód általában szintaktikailag jó, de **alapból Level 0** (lásd
[03](03-gondolatisag.md)): nem idempotens, nincs benne retry, riasztás,
kvótatudatosság. Ezért a promptba tedd bele explicit módon:

```
Írj Google Apps Script kódot a következő feladatra: <feladat>

Kötelező elemek:
- Batch I/O: getValues()/setValues(), soha ne cellánként
- Fejléc-alapú oszlopkeresés, ne fix indexek
- try/catch + exponenciális backoff minden külső hívásnál,
  muteHttpExceptions: true minden fetchnél
- Idempotens feldolgozás: feldolgozási napló, hogy újrafutáskor ne duplikáljon
- Futásidő-őr 4,5 percnél, kurzormentés + folytatásos trigger,
  a régi triggerek törlésével
- Konfiguráció Script Propertiesből / Config lapról, ENABLED és DRY_RUN kapcsolóval
- Józansági ellenőrzés: ha 0 elem jön, ne írjon felül semmit, hanem riasszon
- Naplózás console.log-gal ÉS egy _Log lapra
- Riasztás hibánál Google Chat webhookra
- _ végű privát segédfüggvények, vékony belépési pont
- Magyar kommentek, magyar naplóüzenetek

Kontextus: <adatszerkezet, fejlécek, API végpontok, volumen>
```

Utána **mindig** fusd le a [kód-review checklistet](07-fejlesztoi-workflow.md#kód-review-checklist).
Az AI nem tudja, ki lesz a script gazdája, és nem tudja, mi az ára egy néma hibának.

---

## Amiért a briefet vissza kell dobni

Ha ezek bármelyike igaz, ne kezdj kódolni, hanem kérdezz:

- 🚩 „Csináljunk egy scriptet, ami mindent automatizál" — nincs meghatározott kimenet
- 🚩 Nincs megnevezve, kinek a fiókján fut
- 🚩 Nincs megválaszolva, mi történik hibánál
- 🚩 A volumen ismeretlen („sok sor")
- 🚩 A kért dolog valójában dashboard (→ Looker Studio) vagy adatbázis (→ BigQuery)
- 🚩 A folyamat, amit automatizálnál, önmagában rossz — **először a folyamatot
  javítsd, utána automatizáld.** Egy rossz folyamat automatizálva csak
  gyorsabban rossz.
