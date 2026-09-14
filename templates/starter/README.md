# Starter projektváz

Éles használatra kész Apps Script alapváz. Innen indul minden Hypin' script,
hogy ne kelljen minden alkalommal újra megírni a logolást, a riasztást, a
retry-t és a folytatásos futást.

## Mit tud out of the box

| Elem | Hol | Mit old meg |
|---|---|---|
| Konfiguráció Script Propertiesből + `Config` lapról | `00_Config.gs` | A kapcsolókat az account manager is átállíthatja |
| `ENABLED` kill switch és `DRY_RUN` mód | `00_Config.gs`, `10_Main.gs` | Éjszakai hiba, biztonságos élesítés |
| `runSafely_()` – naplózás, futásidő, riasztás | `01_Lib_Log.gs` | Soha ne legyen néma hiba |
| Google Chat + email riasztás | `01_Lib_Log.gs` | A csapat azonnal értesül |
| Heartbeat + elmaradás-figyelés | `01_Lib_Log.gs` | Észreveszi, ha a trigger **nem is futott** |
| Batch Sheet I/O, fejléc-térkép | `02_Lib_Sheet.gs` | Gyors, és egy beszúrt oszlop nem töri el |
| Idempotencia napló | `02_Lib_Sheet.gs` | Újrafutás nem duplikál |
| Józansági ellenőrzés | `02_Lib_Sheet.gs` | Üres adat nem írja felül az ügyfél tábláját |
| Retry exponenciális backoffal | `03_Lib_Http.gs` | Az átmeneti API-hiba nem buktatja a futást |
| `fetchAllChunked_()` párhuzamos HTTP | `03_Lib_Http.gs` | Nagyságrendi gyorsulás |
| Chunkolt cache (>100 kB is) | `03_Lib_Http.gs` | Drága lekérések megspórolása |
| Folytatásos futás + trigger-takarítás | `04_Lib_Runtime.gs` | A 6 perces limit kezelése |
| `withLock_()` | `04_Lib_Runtime.gs` | Nem fut kétszer egyszerre |
| Menü + teszt-harness | `10_Main.gs` | Kézi indítás, alap tesztek |

## Telepítés

1. **Másold be a fájlokat** egy új, **standalone** Apps Script projektbe
   (Shared Drive-on, céges tulajdonos fiókkal).
   `clasp`-pal: `clasp create --type standalone --title "Hypin – [PROJEKT]"`, majd `clasp push`.

2. **Projekt beállítások → `appsscript.json` megjelenítése**, és írd felül a
   manifesztet az itteni tartalommal. Ellenőrizd az időzónát és a scope-okat.

3. **Script Properties beállítása** (Projekt beállítások → Script tulajdonságok):

   | Kulcs | Érték | Kötelező |
   |---|---|---|
   | `SPREADSHEET_ID` | a munkafüzet ID-ja | igen (standalone-nál) |
   | `CHAT_WEBHOOK_URL` | Google Chat bejövő webhook | ajánlott |
   | *(saját API kulcsok)* | … | szükség szerint |

4. **Futtasd a `setup()` függvényt** – létrehozza a `Config`, `_Log`, `_Ledger` lapokat.

5. **Töltsd ki a `Config` lapot**, és állítsd `DRY_RUN = TRUE`-ra.

6. **Írd meg a `collectItems_()` és `handleItem_()` függvényt** a `10_Main.gs`-ben.

7. **Próbafutás:** menü → *🧪 Próbafutás (DRY RUN)*. Nézd meg a `_Log` lapot.

8. **Élesítés:** `DRY_RUN = FALSE`, majd menü → *⏰ Napi trigger telepítése*.

9. **Készíts `README` lapot** a Sheetben ([minta](../../docs/06-biztonsag-es-uzemeltetes.md#a-mit-csinál-ez-readme-lap)),
   és állítsd be a `checkHeartbeats()` napi triggerét.

## Konvenciók

- **`_` végű függvény = privát.** Nem jelenik meg a Run menüben, és custom
  functionként sem hívható. A belépési pontok (`main`, `onOpen`, menüpontok)
  `_` nélküliek.
- **Fájlnév-prefix (`00_`, `01_`, `10_`).** Az Apps Script fájljai egyetlen közös
  globális névtérben élnek, és a legfelső szintű utasítások fájlsorrendben futnak.
- **Két azonos nevű függvény némán felülírja egymást** – ezért a `Lib_` prefixek.
- **Minden trigger-belépési pont `runSafely_()`-be csomagolva.**

## Checklist élesítés előtt

- [ ] Standalone script, Shared Drive-on, céges tulajdonos fiókkal
- [ ] `timeZone` helyesen (`Europe/Budapest`)
- [ ] `oauthScopes` minimalizálva – csak ami tényleg kell
- [ ] Nincs titok a kódban és a `Config` lapon (csak Script Propertiesben)
- [ ] Sikeres `DRY_RUN` éles adaton
- [ ] Kétszeri futtatás nem duplikál (idempotencia-teszt)
- [ ] Szándékos hiba → megérkezik a Chat/email riasztás
- [ ] `checkHeartbeats()` napi triggeren
- [ ] `trimLog()` havi triggeren
- [ ] `README` lap kitöltve a Sheetben
