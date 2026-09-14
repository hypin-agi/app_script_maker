/**
 * 10_Main – belépési pontok
 *
 * Itt csak vékony belépési pontok vannak. A tényleges logika a _ végű
 * privát függvényekben él, hogy tesztelhető és olvasható maradjon.
 */

/** Menü a Sheetben – hogy a nem-technikai kolléga is tudja indítani. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Hypin')
    .addItem('▶️ Futtatás most', 'runMainFromMenu')
    .addItem('🧪 Próbafutás (DRY RUN)', 'runDryRunFromMenu')
    .addSeparator()
    .addItem('⏰ Napi trigger telepítése', 'installDailyTrigger')
    .addItem('🧹 Triggerek törlése', 'removeAllTriggers')
    .addSeparator()
    .addItem('⚙️ Első beállítás (setup)', 'setup')
    .addToUi();
}

/* ===========================================================================
 * FŐ FOLYAMAT
 * ======================================================================== */

/** Trigger belépési pont. Ez fut időzítve, és ez a folytatásos futás célja is. */
function main() {
  runSafely_('Fő folyamat', () => withLock_(() => doMain_()));
}

function doMain_() {
  const cfg = getConfig_();

  // 1. Kill switch – az ügyfél/kolléga is át tudja billenteni a Config lapon
  if (!cfg.ENABLED) {
    log_('⏹️ ENABLED = FALSE, kilépek.');
    return;
  }

  // 2. Adatgyűjtés
  const items = collectItems_(cfg);
  log_(`${items.length} elem érkezett feldolgozásra.`);

  // 3. Józansági ellenőrzés – üres/gyanús eredmény soha ne írja felül az éles adatot
  if (!sanityCheck_(items.length, 'main')) return;
  if (!items.length) { log_('Nincs feldolgozandó elem.'); return; }

  // 4. Dry run – mindent kiszámolunk, de nem írunk és nem küldünk
  if (cfg.DRY_RUN) {
    log_('🧪 DRY RUN – ezt csinálnám:\n' +
         items.slice(0, 20).map(i => ' • ' + describeItem_(i)).join('\n') +
         (items.length > 20 ? `\n … és még ${items.length - 20} elem` : ''));
    return;
  }

  // 5. Feldolgozás: idempotensen, a 6 perces limitet kezelve
  const result = processWithContinuation_({
    key: 'main',
    continueFn: 'main',
    items: items,
    idOf: item => item.id,
    handle: item => handleItem_(item, cfg)
  });

  log_(result.done
    ? `✅ Kész: ${result.processed} új elem feldolgozva (${result.total} összesen).`
    : `⏸️ Részlegesen kész: ${result.processed} elem, a folytatás ütemezve.`);
}

/* ===========================================================================
 * ITT ÍRD MEG A SAJÁT LOGIKÁDAT
 * ======================================================================== */

/**
 * Összegyűjti a feldolgozandó elemeket.
 * Minden elemnek legyen STABIL, egyedi `id` mezője – ez az idempotencia alapja.
 * @return {Array<{id:string}>}
 */
function collectItems_(cfg) {
  // PÉLDA – írd át a sajátodra:
  // return readAsObjects_('Adat')
  //   .filter(r => r.Státusz === 'Feldolgozandó')
  //   .map(r => ({ id: `${r.Azonosító}_${fmtDate_()}`, row: r }));
  return [];
}

/**
 * Egy elem feldolgozása. Ha ez elszáll, a withRetry_ újrapróbálja,
 * és az elem nem kerül a feldolgozási naplóba – tehát legközelebb újra sorra kerül.
 * @return {string} rövid eredményleírás a naplóba
 */
function handleItem_(item, cfg) {
  // PÉLDA:
  // const res = httpFetch_(cfg.API_URL + item.id);
  // if (!res.ok) throw new Error(`API hiba (${res.code}): ${res.body.slice(0, 200)}`);
  // return 'ok';
  throw new Error('handleItem_ még nincs megírva.');
}

/** Emberi leírás egy elemről – a DRY RUN naplójához. */
function describeItem_(item) {
  return JSON.stringify(item).slice(0, 200);
}

/* ===========================================================================
 * MENÜ ÉS TRIGGER SEGÉDEK
 * ======================================================================== */

function runMainFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Futtatás most',
    'Éles futtatás indul. Biztos vagy benne?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  main();
  ui.alert('Kész. A részleteket a _Log lapon találod.');
}

function runDryRunFromMenu() {
  const props = PropertiesService.getScriptProperties();
  const original = props.getProperty('DRY_RUN');
  props.setProperty('DRY_RUN', 'true');
  clearConfigCache_();
  try {
    main();
  } finally {
    if (original === null) props.deleteProperty('DRY_RUN');
    else props.setProperty('DRY_RUN', original);
    clearConfigCache_();
  }
  SpreadsheetApp.getUi().alert('Próbafutás kész. Nézd meg a _Log lapot.');
}

/** Napi trigger telepítése. A régit előbb törli, hogy ne duplázódjon. */
function installDailyTrigger() {
  cleanupTriggers_('main');
  ScriptApp.newTrigger('main')
    .timeBased()
    .atHour(7)                       // ⚠️ ablak, nem pontos időpont: 7:00–8:00 között fut
    .everyDays(1)
    .inTimezone(getConfig_().TIMEZONE)
    .create();
  log_('⏰ Napi trigger telepítve (7:00–8:00 között).');
}

/** Minden trigger törlése ebből a projektből. */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  log_(`🧹 ${triggers.length} trigger törölve.`);
}

/* ===========================================================================
 * TESZTEK – futtasd a szerkesztőből, nézd a Végrehajtási naplót
 * ======================================================================== */

function runTests() {
  const tests = [];
  const t = (name, fn) => tests.push({ name: name, fn: fn });
  const eq = (actual, expected, msg) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${msg || ''} – várt: ${JSON.stringify(expected)}, kapott: ${JSON.stringify(actual)}`);
    }
  };

  t('isTransient_ felismeri az 503-at', () => eq(isTransient_(new Error('503 Service Unavailable')), true));
  t('isTransient_ nem retryzi a 404-et', () => eq(isTransient_(new Error('404 Not Found')), false));
  t('tryParseJson_ hibás JSON-ra null', () => eq(tryParseJson_('{nem json'), null));

  const failed = [];
  tests.forEach(x => {
    try { x.fn(); console.log('✅ ' + x.name); }
    catch (e) { failed.push(x.name); console.log('❌ ' + x.name + ': ' + e.message); }
  });
  console.log(failed.length ? `\n${failed.length} teszt bukott: ${failed.join(', ')}` : '\nMinden teszt zöld.');
}
