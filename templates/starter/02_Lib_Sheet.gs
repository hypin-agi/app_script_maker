/**
 * 02_Lib_Sheet – Sheet I/O batchben, fejléc-alapon
 *
 * Alapelv: olvass egyszer → dolgozz memóriában → írj egyszer.
 */

/**
 * Lap tartalma objektumok tömbjeként, fejléc szerint.
 * Így egy beszúrt oszlop nem töri el a scriptet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet|string} sheetOrName
 * @return {Object[]} minden elem tartalmaz egy _rowNumber mezőt is
 */
function readAsObjects_(sheetOrName) {
  const sheet = typeof sheetOrName === 'string' ? sheet_(sheetOrName) : sheetOrName;
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();      // 1 olvasás
  const header = values.shift().map(h => String(h).trim());

  return values.map((row, i) => {
    const obj = { _rowNumber: i + 2 };
    header.forEach((key, c) => { if (key) obj[key] = row[c]; });
    return obj;
  });
}

/**
 * Egyetlen oszlop visszaírása, egyetlen hívással.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} columnName
 * @param {Object[]} objects  readAsObjects_() eredménye, módosítva
 */
function writeColumn_(sheet, columnName, objects) {
  if (!objects.length) return;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h).trim());
  const col = header.indexOf(columnName) + 1;
  if (col === 0) throw new Error(`Nincs "${columnName}" nevű oszlop a(z) "${sheet.getName()}" lapon.`);

  sheet.getRange(2, col, objects.length, 1)
       .setValues(objects.map(o => [o[columnName] === undefined ? '' : o[columnName]]));
}

/**
 * Sorok hozzáfűzése batchben (appendRow helyett, ami soronként hív szervert).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array[]} rows
 */
function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  const width = Math.max.apply(null, rows.map(r => r.length));
  const normalized = rows.map(r => r.concat(new Array(width - r.length).fill('')));
  sheet.getRange(sheet.getLastRow() + 1, 1, normalized.length, width).setValues(normalized);
}

/** Lap lekérése névvel, beszédes hibaüzenettel. */
function sheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error(`Nincs "${name}" nevű lap a munkafüzetben.`);
  return sheet;
}

/**
 * Lap lekérése vagy létrehozása.
 * @param {string}   name
 * @param {string[]} [header]
 * @param {boolean}  [hide=true]  belső lapoknál rejtsük el
 */
function getOrCreateSheet_(name, header, hide) {
  const book = ss_();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    if (header && header.length) {
      sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    if (hide !== false && name.charAt(0) === '_') sheet.hideSheet();
  }
  return sheet;
}

/* ---------------------------------------------------------------------------
 * Idempotencia – hogy egy újrafutás soha ne duplikáljon.
 * ------------------------------------------------------------------------ */

/** @return {Set<string>} a már feldolgozott kulcsok */
function getProcessedIds_() {
  const sheet = getOrCreateSheet_(SHEETS.LEDGER, ['kulcs', 'időpont', 'eredmény']);
  const last = sheet.getLastRow();
  if (last < 2) return new Set();
  return new Set(sheet.getRange(2, 1, last - 1, 1).getValues().flat().map(String));
}

/**
 * Feldolgozottnak jelöl egy elemet.
 * ⚠️ MINDIG közvetlenül a művelet UTÁN hívd, ne a ciklus végén – különben egy
 *    timeout után minden újra lefut (pl. kétszer megy ki ugyanaz az email).
 */
function markProcessed_(key, result) {
  getOrCreateSheet_(SHEETS.LEDGER, ['kulcs', 'időpont', 'eredmény'])
    .appendRow([String(key), new Date(), result === undefined ? 'ok' : String(result)]);
}

/**
 * Józansági ellenőrzés: ne engedjük, hogy üres vagy gyanúsan kicsi eredmény
 * felülírja az élő adatot. Kétes helyzetben inkább NE csinálj semmit, és szólj.
 *
 * @param {number} current      most kapott elemszám
 * @param {string} key          mihez hasonlítsunk (property kulcs)
 * @param {number} [tolerance]  megengedett visszaesés aránya (0.5 = felére eshet)
 * @return {boolean} true, ha szabad folytatni
 */
function sanityCheck_(current, key, tolerance) {
  const props = PropertiesService.getScriptProperties();
  const prop = 'LASTCOUNT_' + key;
  const previous = Number(props.getProperty(prop) || 0);
  const limit = tolerance === undefined ? 0.5 : tolerance;

  if (previous > 10 && current < previous * limit) {
    alert_(`⚠️ *${APP_NAME}* – gyanús adatmennyiség (${key}): most ${current}, ` +
           `korábban ${previous}. Nem írok felül semmit.`);
    return false;
  }
  props.setProperty(prop, String(current));
  return true;
}
