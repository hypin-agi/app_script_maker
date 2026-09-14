/**
 * 00_Config – konfiguráció és alapbeállítások
 *
 * A fájlnév-prefix (00_, 01_, 10_) szándékos: az Apps Script fájljai egyetlen
 * közös globális névtérben élnek, és a legfelső szintű utasítások fájlsorrendben
 * futnak le. A prefix egyben olvashatósági rend is.
 */

/** A projekt neve – naplóban és riasztásban jelenik meg. */
const APP_NAME = 'Hypin – [PROJEKT NEVE]';

/** Biztonsági futásidő-küszöb. A hard limit 6 perc; itt hagyunk tartalékot. */
const SAFE_RUNTIME_MS = 4.5 * 60 * 1000;

/** Belső lapnevek. A _ előtag jelzi: ezeket a script kezeli, ember ne írja. */
const SHEETS = {
  CONFIG: 'Config',
  LOG:    '_Log',
  LEDGER: '_Ledger'
};

/**
 * Egyesített konfiguráció: Script Properties + Config lap.
 * A Config lap felülírja a Script Properties azonos kulcsait, így az
 * account manager a Sheetből is tud kapcsolgatni.
 *
 * ⚠️ Titok (API kulcs, token) KIZÁRÓLAG Script Propertiesbe kerülhet,
 *    a Config lapot mindenki látja, akinek a Sheethez hozzáférése van.
 *
 * @return {Object} a konfigurációs kulcs-érték párok
 */
function getConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('__cfg');
  if (hit) return JSON.parse(hit);

  const cfg = Object.assign({}, PropertiesService.getScriptProperties().getProperties());

  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      .filter(([k]) => k !== '' && k != null)
      .forEach(([k, v]) => { cfg[String(k).trim()] = v; });
  }

  // Típuskonverziók – a Sheetből vegyes típusok érkeznek.
  cfg.ENABLED = String(cfg.ENABLED).toLowerCase() !== 'false';
  cfg.DRY_RUN = String(cfg.DRY_RUN).toLowerCase() === 'true';
  cfg.TIMEZONE = cfg.TIMEZONE || Session.getScriptTimeZone() || 'Europe/Budapest';

  cache.put('__cfg', JSON.stringify(cfg), 300);   // 5 perc
  return cfg;
}

/** Konfiguráció-cache ürítése – hívd meg, ha épp a Config lapot állítgatod. */
function clearConfigCache_() {
  CacheService.getScriptCache().remove('__cfg');
}

/**
 * A munkafüzet. Standalone scriptnél a SPREADSHEET_ID property alapján nyit,
 * kötött scriptnél a gazdafájlt adja vissza.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActive();
  if (!active) {
    throw new Error('Nincs munkafüzet: állítsd be a SPREADSHEET_ID script property-t.');
  }
  return active;
}

/**
 * Egyszeri beállítás – futtasd kézzel a telepítéskor.
 * Létrehozza a szükséges lapokat és a kapcsolókat.
 */
function setup() {
  const sheet = getOrCreateSheet_(SHEETS.CONFIG, ['Kulcs', 'Érték', 'Leírás'], false);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 4, 3).setValues([
      ['ENABLED',     true,  'Fő kapcsoló. FALSE = a script azonnal kilép.'],
      ['DRY_RUN',     false, 'TRUE = mindent kiszámol és naplóz, de nem ír és nem küld.'],
      ['ALERT_EMAIL', '',    'Ide megy a hibaértesítés.'],
      ['TIMEZONE',    'Europe/Budapest', 'Dátumformázás időzónája.']
    ]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  getOrCreateSheet_(SHEETS.LOG,    ['időpont', 'üzenet']);
  getOrCreateSheet_(SHEETS.LEDGER, ['kulcs', 'időpont', 'eredmény']);
  clearConfigCache_();
  log_('✅ Setup lefutott. Töltsd ki a Config lapot, majd futtasd DRY_RUN módban.');
}
