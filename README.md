# app_script_maker

**Hypin' belső tudásanyag és sablonkészlet Google Apps Script megoldásokhoz.**

Ez a repo nem egy konkrét script. Ez az a gondolkodási keret, amivel eldöntöd,
hogy **kell-e** Apps Script, **mit** építs, **hogyan** építsd meg jól, és mikor
kell inkább **másik eszközt** választani.

---

## Mi ez és kinek szól

Marketing ügynökségi környezetben az Apps Script a leggyorsabb út attól, hogy
"ezt minden héten kézzel csináljuk" eljuss addig, hogy "ez magától megy".
Cserébe könnyű vele rosszul is dolgozni: építeni valamit, ami két hónap múlva
némán elhal, és senki nem veszi észre, hogy az ügyfél nem kapott riportot.

Ez a tudásanyag arról szól, hogyan kerüld el ezt.

## Hogyan használd

| Ha ezt kérdezed | Ezt olvasd |
|---|---|
| "Egyáltalán Apps Script kell ide?" | [01 – Döntési keret](docs/01-dontesi-keret.md) |
| "Mit tud egyáltalán?" | [02 – Képességtérkép](docs/02-kepessegterkep.md) |
| "Milyen fejjel álljak neki?" | [03 – Gondolatiság](docs/03-gondolatisag.md) |
| "Hol fog elhasalni?" | [04 – Korlátok és kvóták](docs/04-korlatok-es-kvotak.md) |
| "Hogy írjam meg jól?" | [05 – Minták és kódtár](docs/05-mintak-kodtar.md) |
| "Ki futtatja, mi van, ha elromlik?" | [06 – Biztonság és üzemeltetés](docs/06-biztonsag-es-uzemeltetes.md) |
| "Hogyan dolgozzak rajta profin?" | [07 – Fejlesztői workflow](docs/07-fejlesztoi-workflow.md) |
| "Mit építsek ügynökségként?" | [08 – Hypin' playbook](docs/08-hypin-playbook.md) |
| "Hogyan adjam át a feladatot?" | [09 – Brief sablon](docs/09-brief-sablon.md) |
| "Beérkező adat alapján döntsön" | [10 – Adatvezérelt döntés](docs/10-adatvezerelt-dontes.md) |

## Sablonok

| Mappa | Mi ez |
|---|---|
| [`templates/starter/`](templates/starter/README.md) | Éles használatra kész projektváz: config, logolás, riasztás, retry, batch I/O, idempotencia, kill switch. **Minden új script ebből induljon.** |
| [`templates/lead-scoring/`](templates/lead-scoring/README.md) | Működő megoldás: Meta űrlapos leadek pontozása a válaszaik alapján, 3 szegmensre bontás, szegmensenként külön email. |

## A három mondat, amit érdemes fejből tudni

1. **Az Apps Script ragasztó, nem platform.** Akkor nyersz vele, ha Workspace-en
   belüli dolgokat kötsz össze. Ha a munka 90%-a Google-ön kívül van, rossz eszköz.
2. **6 perc a fal.** Minden tervezési döntés ebből indul: batch, darabolás,
   újraindíthatóság.
3. **A néma hiba a legdrágább.** Egy script, ami hibázik és szól róla, jobb, mint
   egy script, ami "működik", de hetek óta üres riportot küld.

---

*Karbantartja: Hypin' — a konkrét kvótaszámokat évente egyszer ellenőrizd a
[hivatalos Google oldalon](https://developers.google.com/apps-script/guides/services/quotas).*
