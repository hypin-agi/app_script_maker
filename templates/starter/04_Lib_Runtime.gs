/**
 * 04_Lib_Runtime – futásidő-kezelés, folytatásos futás, zárolás
 */

/**
 * Futásidő-őr. A hard limit 6 perc; SAFE_RUNTIME_MS-nél megállunk, hogy
 * a kurzormentésre és a folytatás ütemezésére is maradjon idő.
 *
 * @param {number} startedAt  Date.now() a futás elején
 * @return {boolean} true, ha ideje abbahagyni
 */
function isTimeUp_(startedAt) {
  return (Date.now() - startedAt) > SAFE_RUNTIME_MS;
}

/**
 * Folytatásos futás ütemezése.
 * @param {string} fnName   a folytató függvény neve
 * @param {number} [minutes=1]
 */
function scheduleContinuation_(fnName, minutes) {
  cleanupTriggers_(fnName);          // előbb takarítunk: max 20 trigger lehet
  ScriptApp.newTrigger(fnName)
    .timeBased()
    .after((minutes || 1) * 60 * 1000)
    .create();
}

/**
 * Az adott függvényhez tartozó időzített triggerek törlése.
 * ⚠️ Enélkül a folytatásos futás pár nap alatt eléri a 20-as trigger limitet,
 *    és a script "Trigger limit exceeded" hibával áll le.
 */
function cleanupTriggers_(fnName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fnName &&
                 t.getEventType() === ScriptApp.EventType.CLOCK)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Kurzor (folytatási pozíció) olvasása/írása/törlése. */
function getCursor_(key) {
  return Number(PropertiesService.getScriptProperties().getProperty('CURSOR_' + key) || 0);
}
function setCursor_(key, value) {
  PropertiesService.getScriptProperties().setProperty('CURSOR_' + key, String(value));
}
function clearCursor_(key) {
  PropertiesService.getScriptProperties().deleteProperty('CURSOR_' + key);
}

/**
 * Elemek feldolgozása folytatásosan és idempotensen.
 * Ha az idő lejár, elmenti a pozíciót, ütemez egy folytatást, és kilép.
 *
 * @param {Object}   spec
 * @param {string}   spec.key         egyedi név ehhez a munkához
 * @param {string}   spec.continueFn  a folytató (belépési) függvény neve
 * @param {Array}    spec.items       a teljes munkalista
 * @param {Function} spec.idOf        (item) => idempotencia-kulcs
 * @param {Function} spec.handle      (item) => eredmény
 * @return {{done:boolean, processed:number, total:number}}
 */
function processWithContinuation_(spec) {
  const started = Date.now();
  const done = getProcessedIds_();
  let cursor = getCursor_(spec.key);
  let processed = 0;

  while (cursor < spec.items.length) {
    if (isTimeUp_(started)) {
      setCursor_(spec.key, cursor);
      scheduleContinuation_(spec.continueFn, 1);
      log_(`⏸️ Időkorlát – folytatás a ${cursor}. elemtől (${spec.items.length}-ből).`);
      return { done: false, processed: processed, total: spec.items.length };
    }

    const item = spec.items[cursor];
    const id = String(spec.idOf(item));

    if (!done.has(id)) {
      const result = spec.handle(item);
      markProcessed_(id, result);       // AZONNAL jelölünk, nem a ciklus végén
      done.add(id);
      processed++;
    }
    cursor++;
  }

  clearCursor_(spec.key);
  cleanupTriggers_(spec.continueFn);
  return { done: true, processed: processed, total: spec.items.length };
}

/**
 * Zárolt futtatás – ha a scriptet trigger és ember is indíthatja,
 * előbb-utóbb egyszerre fut kétszer.
 *
 * @param {Function} fn
 * @param {number}   [waitMs=30000]
 */
function withLock_(fn, waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 30000)) {
    log_('🔒 Másik futás dolgozik, kilépek.');
    return null;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();     // MINDIG finally-ben
  }
}

/** Dátum formázása a konfigurált időzónában. */
function fmtDate_(date, pattern) {
  return Utilities.formatDate(date || new Date(),
    getConfig_().TIMEZONE, pattern || 'yyyy-MM-dd');
}
