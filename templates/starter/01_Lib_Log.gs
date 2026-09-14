/**
 * 01_Lib_Log – naplózás, riasztás, biztonságos futtatás
 */

/**
 * Minden trigger- és menü-belépési pont ezen keresztül fusson.
 * Naplóz, méri a futásidőt, és hiba esetén riaszt – mielőtt továbbdobja.
 *
 * @param {string}   name  Emberi név a naplóhoz (pl. 'Napi szinkron')
 * @param {Function} fn    A tényleges munka
 * @return {*} az fn visszatérési értéke
 */
function runSafely_(name, fn) {
  const started = Date.now();
  try {
    log_(`▶️ ${name} indul`);
    const result = fn();
    const secs = Math.round((Date.now() - started) / 1000);
    log_(`✅ ${name} kész (${secs} mp)`);
    beat_(name);
    return result;
  } catch (err) {
    const detail = err && err.stack ? err.stack : String(err);
    log_(`❌ ${name} hibára futott: ${detail}`);
    alert_(`❌ *${APP_NAME} – ${name}* hibára futott\n\`\`\`${detail}\`\`\``);
    throw err;            // továbbdobjuk, hogy a Végrehajtások nézetben is hibás legyen
  }
}

/**
 * Naplózás: Cloud Loggingba ÉS a _Log lapra.
 * A Sheet-napló az, amit a nem-technikai kolléga is meg tud nyitni.
 * @param {string} message
 */
function log_(message) {
  const text = String(message);
  console.log(text);
  try {
    getOrCreateSheet_(SHEETS.LOG, ['időpont', 'üzenet'])
      .appendRow([new Date(), text.slice(0, 5000)]);
  } catch (e) {
    console.log('A Sheet-naplózás nem sikerült: ' + e);   // soha ne buktassa a futást
  }
}

/**
 * Riasztás: Google Chat webhook + (ha van beállítva) email.
 * A riasztás hibája soha nem dobhatja el a futást.
 * @param {string} message
 */
function alert_(message) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('CHAT_WEBHOOK_URL');

  if (url) {
    try {
      UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ text: String(message) }),
        muteHttpExceptions: true
      });
    } catch (e) {
      console.log('Chat riasztás nem ment ki: ' + e);
    }
  }

  try {
    const to = getConfig_().ALERT_EMAIL;
    if (to) {
      MailApp.sendEmail(String(to), `[${APP_NAME}] Hiba`, String(message));
    }
  } catch (e) {
    console.log('Email riasztás nem ment ki: ' + e);
  }
}

/** Életjel rögzítése – ezt figyeli a checkHeartbeats(). */
function beat_(jobName) {
  PropertiesService.getScriptProperties()
    .setProperty('HEARTBEAT_' + jobName, String(Date.now()));
}

/**
 * Elmaradt futások figyelése. Állítsd be a saját feladataidra,
 * és tedd napi triggerre. Ez fogja észrevenni a NÉMA leállást
 * (kvóta elfogyott, fiók felfüggesztve) – amiről a Google nem küld emailt.
 */
function checkHeartbeats() {
  const EXPECTED_HOURS = {
    // 'Napi szinkron': 26,
    // 'Havi riportok': 24 * 33
  };
  const props = PropertiesService.getScriptProperties();
  const late = [];

  Object.keys(EXPECTED_HOURS).forEach(job => {
    const last = Number(props.getProperty('HEARTBEAT_' + job) || 0);
    const hours = last ? (Date.now() - last) / 36e5 : Infinity;
    if (hours > EXPECTED_HOURS[job]) {
      late.push(`🔴 *${job}*: ${last ? Math.round(hours) + ' órája nem futott' : 'még soha nem futott'} ` +
                `(elvárt: ${EXPECTED_HOURS[job]} órán belül)`);
    }
  });
  if (late.length) alert_(`${APP_NAME} – elmaradt futások:\n` + late.join('\n'));
}

/** A napló méretének karbantartása – tedd havi triggerre. */
function trimLog() {
  const KEEP = 2000;
  const sheet = getOrCreateSheet_(SHEETS.LOG, ['időpont', 'üzenet']);
  const extra = sheet.getLastRow() - KEEP - 1;
  if (extra > 0) sheet.deleteRows(2, extra);
}
