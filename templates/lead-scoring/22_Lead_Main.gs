/**
 * 22_Lead_Main – belépési pontok, fő folyamat, beállítás
 *
 * ⚠️ FONTOS: a Meta (és a Zapier/Make) az API-n keresztül írja a sorokat,
 *    az API-írásra pedig SEM az onEdit, SEM az onChange trigger nem
 *    megbízható. Ezért NEM eseményre, hanem 5 percenkénti időzített
 *    triggerrel pásztázzuk a feldolgozatlan sorokat.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Hypin – Lead')
    .addItem('▶️ Új leadek feldolgozása', 'runLeadsFromMenu')
    .addItem('🧪 Próbafutás (nem küld emailt)', 'runLeadDryRun')
    .addSeparator()
    .addItem('🩺 Beállítás ellenőrzése', 'showValidation')
    .addItem('🔍 Kijelölt sor pontozása', 'scoreSelectedRow')
    .addSeparator()
    .addItem('⏰ 5 perces trigger telepítése', 'installLeadTrigger')
    .addItem('🧹 Triggerek törlése', 'removeAllTriggers')
    .addItem('♻️ Teszt-sorok visszaállítása', 'resetTestRows')
    .addSeparator()
    .addItem('⚙️ Első beállítás (setup)', 'setupLeadScoring')
    .addToUi();
}

/* ===========================================================================
 * FŐ FOLYAMAT
 * ======================================================================== */

/** Trigger belépési pont – ez fut 5 percenként. */
function processNewLeads() {
  runSafely_('Lead feldolgozás', () => withLock_(() => doProcessLeads_()));
}

function doProcessLeads_() {
  const cfg = getConfig_();
  if (!cfg.ENABLED) { log_('⏹️ ENABLED = FALSE, kilépek.'); return; }

  // A hibás beállítás (elgépelt oszlopnév, hiányzó sablon) rosszabb, mint a nem futás.
  const problems = validateLeadSetup_();
  if (problems.length) {
    alert_(`⚠️ *${APP_NAME}* – hibás beállítás, nem indulok:\n• ` + problems.join('\n• '));
    return;
  }

  const sheet = sheet_(LEAD_SHEETS.LEADS);
  ensureColumns_(sheet, LEAD_OUT_COLUMNS);

  const ctx = {
    cfg:         cfg,
    sheet:       sheet,
    rules:       loadRules_(),
    segments:    loadSegments_(),
    templates:   loadTemplates_(),
    processed:   getProcessedIds_(),
    recent:      buildRecentEmailMap_(),
    emailColumn: findEmailColumn_(sheet, cfg),
    dedupMs:     (Number(cfg.DEDUP_HOURS) || 72) * 3600 * 1000
  };

  const pending = readAsObjects_(sheet)
    .filter(l => String(l['Státusz'] == null ? '' : l['Státusz']).trim() === '');

  if (!pending.length) { log_('Nincs új lead.'); return; }

  // Kvóta-őr: a napi email-keret felhasználónkénti és kemény limit.
  const reserve   = Number(cfg.QUOTA_RESERVE) || 20;
  const maxPerRun = Number(cfg.MAX_PER_RUN) || 150;
  const remaining = MailApp.getRemainingDailyQuota();
  const budget    = Math.max(0, Math.min(pending.length, maxPerRun, remaining - reserve));

  log_(`${pending.length} feldolgozatlan lead; ebben a futásban max ${budget} (email-kvóta: ${remaining}).`);

  if (budget === 0) {
    alert_(`📭 *${APP_NAME}* – nincs elég email-kvóta (${remaining} maradt), ` +
           `${pending.length} lead vár feldolgozásra.`);
    return;
  }
  if (budget < pending.length) {
    log_(`ℹ️ ${pending.length - budget} lead a következő futás(ok)ra marad.`);
  }

  // Itt nincs szükség folytatásos futásra: az 5 perces trigger MAGA a folytatás.
  const started = Date.now();
  const updates = [];
  let sent = 0, skipped = 0, failed = 0;

  for (let i = 0; i < budget; i++) {
    if (isTimeUp_(started)) {
      log_('⏸️ Időkorlát – a maradék a következő futásban megy.');
      break;
    }
    const lead = pending[i];
    try {
      const outcome = handleLead_(lead, ctx);
      updates.push({ row: lead._rowNumber, values: outcome.values });
      if (outcome.sent) sent++; else skipped++;
    } catch (err) {
      failed++;
      updates.push({ row: lead._rowNumber, values: {
        'Státusz':     'Hiba',
        'Feldolgozva': new Date(),
        'Megjegyzés':  String((err && err.message) || err).slice(0, 500)
      }});
      log_(`❌ ${lead._rowNumber}. sor: ${err}`);
    }
  }

  // Egyetlen batch írás a végén. Az idempotenciát a _Ledger biztosítja, ezért
  // egy elveszett státuszírás sem okoz kétszeres kiküldést.
  writeBackStatuses_(sheet, updates);

  log_(`✅ ${sent} email kiment, ${skipped} kihagyva, ${failed} hiba.`);
  if (failed) {
    alert_(`⚠️ *${APP_NAME}* – ${failed} lead feldolgozása hibára futott. Részletek a _Log lapon.`);
  }
}

/**
 * Egy lead teljes feldolgozása: szűrők → pontozás → szegmens → email.
 * @return {{sent:boolean, values:Object}} a Leads lapra visszaírandó mezők
 */
function handleLead_(lead, ctx) {
  const cfg = ctx.cfg;
  const now = new Date();
  const email = String(lead[ctx.emailColumn] || '').trim().toLowerCase();
  const key = leadKey_(lead, email);

  const stop = (status, note) => ({
    sent: false,
    values: { 'Státusz': status, 'Feldolgozva': now, 'Megjegyzés': note || '' }
  });

  // 0. Egy korábbi, megszakadt futásban már kiment? (A napló a hiteles forrás.)
  if (ctx.processed.has(key)) return stop('Kész', 'Egy korábbi futásban már kiment.');

  // 1. Használható email cím?
  if (!isValidEmail_(email)) return stop('Kihagyva', `Hibás vagy hiányzó email: "${email}"`);

  // 2. Marketing hozzájárulás (ha van ilyen mező az űrlapon)
  if (cfg.CONSENT_COLUMN) {
    const given = String(lead[cfg.CONSENT_COLUMN] || '').trim().toLowerCase();
    const accepted = String(cfg.CONSENT_TRUE_VALUES || 'igen,yes,true,igaz,elfogadom,1')
      .split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');
    if (accepted.indexOf(given) === -1) {
      return stop('Kihagyva', 'Nincs marketing hozzájárulás.');
    }
  }

  // 3. Duplikátum – a Meta űrlapok rendszeresen adnak ismétlődő leadet
  const lastSent = ctx.recent[email];
  if (lastSent && (Date.now() - lastSent) < ctx.dedupMs) {
    const hours = Math.round((Date.now() - lastSent) / 36e5);
    return stop('Duplikátum', `${hours} órája már kapott emailt erre a címre.`);
  }

  // 4. Pontozás és szegmentálás
  const scored = scoreLead_(lead, ctx.rules);
  const segment = resolveSegment_(scored.score, ctx.segments);
  if (!segment) {
    return { sent: false, values: {
      'Pontszám': scored.score, 'Szegmens': '', 'Státusz': 'Hiba',
      'Feldolgozva': now, 'Megjegyzés': `Nincs szegmens ${scored.score} pontra.`
    }};
  }

  const tpl = ctx.templates[segment.templateId];
  if (!tpl) throw new Error(`Nincs "${segment.templateId}" azonosítójú sablon a Sablonok lapon.`);

  const base = { 'Pontszám': scored.score, 'Szegmens': segment.name, 'Feldolgozva': now };

  // 5. Próbafutás: mindent kiszámolunk, de nem küldünk
  if (cfg.DRY_RUN) {
    log_(`🧪 ${email} → ${scored.score} pont → ${segment.name} [${scored.hits.join(', ') || 'nincs találat'}]`);
    return { sent: false, values: Object.assign({}, base, {
      'Státusz': 'Próbafutás', 'Megjegyzés': scored.hits.join(', ')
    })};
  }

  // 6. Küldés, majd AZONNALI naplózás – ez akadályozza meg a kétszeres kiküldést
  sendSegmentEmail_(email, lead, segment, tpl, scored, cfg);
  markProcessed_(key, `${segment.name} / ${scored.score} pont`);
  ctx.processed.add(key);
  ctx.recent[email] = Date.now();

  // 7. Belső értesítés – ha ez hibázik, az ügyfél levele már kiment, ne dobjuk el a futást
  if (segment.notify) {
    try {
      notifyInternal_(segment.notify, email, lead, scored, segment, ctx.sheet, cfg);
    } catch (e) {
      log_(`⚠️ Belső értesítés nem ment ki (${email}): ${e}`);
    }
  }

  return { sent: true, values: Object.assign({}, base, {
    'Státusz': cfg.TEST_EMAIL ? 'Teszt' : 'Elküldve',
    'Megjegyzés': scored.hits.join(', ')
  })};
}

/* ===========================================================================
 * SEGÉDEK
 * ======================================================================== */

/**
 * Idempotencia-kulcs. Ha van valódi lead azonosító, azt használjuk –
 * enélkül a sorszám a fallback, ami törlésre/rendezésre érzékeny.
 */
function leadKey_(lead, email) {
  const id = lead['lead_id'] || lead['Lead ID'] || lead['id'] || lead['ID'] ||
             lead['Azonosító'] || ('sor' + lead._rowNumber);
  return `lead:${email}:${String(id).trim()}`;
}

/** Az email oszlop megtalálása: config, majd a szokásos elnevezések. */
function findEmailColumn_(sheet, cfg) {
  const header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
    .getValues()[0].map(h => String(h).trim());

  if (cfg.EMAIL_COLUMN && header.indexOf(String(cfg.EMAIL_COLUMN).trim()) !== -1) {
    return String(cfg.EMAIL_COLUMN).trim();
  }
  const candidate = header.find(h => /^(e-?mail|email cím|email_address|work_email)$/i.test(h));
  if (candidate) return candidate;

  throw new Error('Nem találom az email oszlopot. Állítsd be az EMAIL_COLUMN kulcsot a Config lapon.');
}

/** Email → utolsó kiküldés időbélyege, a _Ledger alapján. */
function buildRecentEmailMap_() {
  const sheet = getOrCreateSheet_(SHEETS.LEDGER, ['kulcs', 'időpont', 'eredmény']);
  const last = sheet.getLastRow();
  const map = {};
  if (last < 2) return map;

  sheet.getRange(2, 1, last - 1, 2).getValues().forEach(row => {
    const key = String(row[0]);
    if (key.indexOf('lead:') !== 0) return;
    const email = key.split(':')[1];
    const ts = row[1] instanceof Date ? row[1].getTime() : Date.parse(row[1]);
    if (!email || isNaN(ts)) return;
    if (!map[email] || ts > map[email]) map[email] = ts;
  });
  return map;
}

/** Hiányzó kimeneti oszlopok létrehozása a fejlécben. */
function ensureColumns_(sheet, names) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const missing = names.filter(n => header.indexOf(n) === -1);
  if (!missing.length) return;

  const need = lastCol + missing.length - sheet.getMaxColumns();
  if (need > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), need);

  sheet.getRange(1, lastCol + 1, 1, missing.length)
       .setValues([missing]).setFontWeight('bold');
  log_(`ℹ️ Létrehozott oszlopok a(z) "${sheet.getName()}" lapon: ${missing.join(', ')}`);
}

/**
 * Státuszok visszaírása EGY olvasással és EGY írással.
 * (Soronkénti setValue helyett – 150 leadnél ez percekben mérhető különbség.)
 */
function writeBackStatuses_(sheet, updates) {
  if (!updates.length) return;

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h).trim());
  const colIndex = {};
  LEAD_OUT_COLUMNS.forEach(name => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Hiányzó kimeneti oszlop: ${name}`);
    colIndex[name] = i;
  });

  const cols = Object.keys(colIndex).map(k => colIndex[k]);
  const minCol = Math.min.apply(null, cols);
  const maxCol = Math.max.apply(null, cols);
  const rows = updates.map(u => u.row);
  const minRow = Math.min.apply(null, rows);
  const maxRow = Math.max.apply(null, rows);
  const width = maxCol - minCol + 1;

  // Beolvassuk a blokkot, hogy a közbeeső oszlopok értékét ne írjuk felül.
  const range = sheet.getRange(minRow, minCol + 1, maxRow - minRow + 1, width);
  const block = range.getValues();

  updates.forEach(u => {
    Object.keys(u.values).forEach(name => {
      if (colIndex[name] === undefined) return;
      block[u.row - minRow][colIndex[name] - minCol] = u.values[name];
    });
  });
  range.setValues(block);
}

/* ===========================================================================
 * VALIDÁCIÓ – ez fogja meg az elgépelt oszlopneveket élesítés ELŐTT
 * ======================================================================== */

/** @return {string[]} a talált problémák (üres tömb = minden rendben) */
function validateLeadSetup_() {
  const problems = [];
  const book = ss_();

  Object.keys(LEAD_SHEETS).forEach(k => {
    if (!book.getSheetByName(LEAD_SHEETS[k])) {
      problems.push(`Hiányzik a "${LEAD_SHEETS[k]}" lap – futtasd a setupLeadScoring() függvényt.`);
    }
  });
  if (problems.length) return problems;

  const leads = book.getSheetByName(LEAD_SHEETS.LEADS);
  if (leads.getLastRow() < 1 || leads.getLastColumn() < 1) {
    return ['A "Leads" lapon nincs fejléc.'];
  }
  const header = leads.getRange(1, 1, 1, leads.getLastColumn()).getValues()[0]
    .map(h => String(h).trim());

  try { findEmailColumn_(leads, getConfig_()); }
  catch (e) { problems.push(e.message); }

  const rules = loadRules_();
  if (!rules.length) {
    problems.push('A "Pontozás" lapon nincs aktív szabály – minden lead 0 pontot kapna.');
  }
  rules.forEach((r, i) => {
    if (header.indexOf(r.field) === -1) {
      problems.push(`Pontozás ${i + 2}. sor: nincs "${r.field}" nevű oszlop a Leads lapon.`);
    }
    if (LEAD_OPERATORS.indexOf(r.op) === -1) {
      problems.push(`Pontozás ${i + 2}. sor: ismeretlen operátor "${r.op}". ` +
                    `Használható: ${LEAD_OPERATORS.join(', ')}`);
    }
  });

  const segments = loadSegments_();
  const templates = loadTemplates_();
  if (!segments.length) problems.push('A "Szegmensek" lapon nincs egyetlen szegmens sem.');

  segments.forEach(s => {
    if (isNaN(s.min)) problems.push(`"${s.name}" szegmens: a "Min pont" nem szám.`);
    if (!templates[s.templateId]) {
      problems.push(`"${s.name}" szegmens sablonja hiányzik a Sablonok lapról: "${s.templateId}".`);
    }
  });

  // Rés és átfedés keresése – e nélkül némán kimaradhatnak leadek
  const sorted = segments.slice().sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min <= sorted[i - 1].max) {
      problems.push(`Átfedő szegmensek: "${sorted[i - 1].name}" és "${sorted[i].name}".`);
    } else if (sorted[i].min > sorted[i - 1].max + 1) {
      problems.push(`Rés a szegmensek között: ${sorted[i - 1].max + 1}–${sorted[i].min - 1} ` +
                    `pont egyik szegmensbe sem esik.`);
    }
  }
  if (sorted.length && sorted[0].min > 0) {
    problems.push(`A legalacsonyabb szegmens ${sorted[0].min} ponttól indul – ` +
                  `a 0–${sorted[0].min - 1} pontos leadek kimaradnának.`);
  }
  return problems;
}

/* ===========================================================================
 * MENÜ ÉS TRIGGER
 * ======================================================================== */

function runLeadsFromMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Feldolgozás most',
      'Éles futás indul, a leadek megkapják az emailt. Biztos?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  processNewLeads();
  ui.alert('Kész. A részleteket a _Log lapon találod.');
}

function runLeadDryRun() {
  const props = PropertiesService.getScriptProperties();
  const original = props.getProperty('DRY_RUN');
  props.setProperty('DRY_RUN', 'true');
  clearConfigCache_();
  try {
    processNewLeads();
  } finally {
    if (original === null) props.deleteProperty('DRY_RUN');
    else props.setProperty('DRY_RUN', original);
    clearConfigCache_();
  }
  SpreadsheetApp.getUi().alert('Próbafutás kész – email NEM ment ki. Nézd meg a _Log lapot.');
}

function showValidation() {
  const problems = validateLeadSetup_();
  SpreadsheetApp.getUi().alert(
    problems.length ? '⚠️ Talált problémák' : '✅ Minden rendben',
    problems.length ? '• ' + problems.join('\n• ') : 'A beállítás konzisztens, indulhat a feldolgozás.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** A kijelölt sor pontozásának megmutatása – szabályhangoláshoz. */
function scoreSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== LEAD_SHEETS.LEADS) {
    ui.alert(`Állj egy sorra a "${LEAD_SHEETS.LEADS}" lapon.`);
    return;
  }
  const row = sheet.getActiveRange().getRow();
  if (row < 2) { ui.alert('A fejlécen állsz – válassz egy adatsort.'); return; }

  const lead = readAsObjects_(sheet).find(l => l._rowNumber === row);
  if (!lead) { ui.alert('Nincs adat ebben a sorban.'); return; }

  const scored = scoreLead_(lead, loadRules_());
  const segment = resolveSegment_(scored.score, loadSegments_());
  ui.alert(`${row}. sor pontozása`,
    `Pontszám: ${scored.score}\nSzegmens: ${segment ? segment.name : '– nincs találat –'}\n\n` +
    `Illeszkedő szabályok:\n${scored.hits.map(h => '• ' + h).join('\n') || '– egy sem –'}`,
    ui.ButtonSet.OK);
}

/** 5 perces trigger – a Meta API-írásra nem megbízható az onEdit/onChange. */
function installLeadTrigger() {
  cleanupTriggers_('processNewLeads');
  ScriptApp.newTrigger('processNewLeads').timeBased().everyMinutes(5).create();
  log_('⏰ 5 perces trigger telepítve.');
  SpreadsheetApp.getUi().alert('Kész: a script 5 percenként ellenőrzi az új leadeket.');
}

function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  log_(`🧹 ${triggers.length} trigger törölve.`);
}

/** Teszt módban feldolgozott sorok visszaállítása, hogy újra tesztelhess. */
function resetTestRows() {
  const sheet = sheet_(LEAD_SHEETS.LEADS);
  const rows = readAsObjects_(sheet)
    .filter(l => ['Teszt', 'Próbafutás'].indexOf(String(l['Státusz']).trim()) !== -1);
  if (!rows.length) { SpreadsheetApp.getUi().alert('Nincs teszt státuszú sor.'); return; }

  writeBackStatuses_(sheet, rows.map(l => ({
    row: l._rowNumber,
    values: { 'Státusz': '', 'Feldolgozva': '', 'Megjegyzés': '', 'Pontszám': '', 'Szegmens': '' }
  })));

  // A hozzájuk tartozó naplóbejegyzések törlése, hogy ne szűrje ki a duplikátum-védelem
  const ledger = getOrCreateSheet_(SHEETS.LEDGER, ['kulcs', 'időpont', 'eredmény']);
  const emails = new Set(rows.map(l => String(l[findEmailColumn_(sheet, getConfig_())] || '')
    .trim().toLowerCase()));
  const values = ledger.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    const key = String(values[i][0]);
    if (key.indexOf('lead:') === 0 && emails.has(key.split(':')[1])) ledger.deleteRow(i + 1);
  }
  log_(`♻️ ${rows.length} teszt sor visszaállítva.`);
  SpreadsheetApp.getUi().alert(`${rows.length} sor visszaállítva, újra tesztelhető.`);
}

/* ===========================================================================
 * ELSŐ BEÁLLÍTÁS
 * ======================================================================== */

function setupLeadScoring() {
  setup();   // Config, _Log, _Ledger a starter vázból

  const cfgSheet = sheet_(SHEETS.CONFIG);
  const existing = new Set(cfgSheet.getRange(1, 1, Math.max(1, cfgSheet.getLastRow()), 1)
    .getValues().flat().map(v => String(v).trim()));

  const extra = [
    ['EMAIL_COLUMN',        'email',   'A Leads lap email oszlopának neve.'],
    ['CONSENT_COLUMN',      '',        'Hozzájárulás oszlop neve (üres = nincs ellenőrzés).'],
    ['CONSENT_TRUE_VALUES', 'igen,yes,true,elfogadom,1', 'Elfogadott értékek, vesszővel.'],
    ['DEDUP_HOURS',         72,        'Ennyi órán belül ugyanarra a címre nem megy újabb email.'],
    ['MAX_PER_RUN',         150,       'Maximum lead egy futásban.'],
    ['QUOTA_RESERVE',       20,        'Ennyi email-kvótát mindig hagyunk meg tartaléknak.'],
    ['SENDER_NAME',         'Hypin',   'A feladó megjelenített neve.'],
    ['REPLY_TO',            '',        'Válasz-cím (üres = a küldő fiók).'],
    ['TEST_EMAIL',          '',        '⚠️ Ha ki van töltve, MINDEN email ide megy teszt módban.']
  ].filter(r => !existing.has(r[0]));

  if (extra.length) {
    cfgSheet.getRange(cfgSheet.getLastRow() + 1, 1, extra.length, 3).setValues(extra);
  }

  const leads = getOrCreateSheet_(LEAD_SHEETS.LEADS,
    ['created_time', 'lead_id', 'full_name', 'email', 'phone_number'], false);
  ensureColumns_(leads, LEAD_OUT_COLUMNS);

  const rules = getOrCreateSheet_(LEAD_SHEETS.RULES,
    ['Aktív', 'Mező', 'Operátor', 'Érték', 'Pont', 'Megjegyzés'], false);
  if (rules.getLastRow() < 2) {
    rules.getRange(2, 1, 5, 6).setValues([
      [true, 'havi_budzse',  '>=',          500000,     30, 'Nagy büdzsé'],
      [true, 'havi_budzse',  '>=',          200000,     15, 'Közepes büdzsé'],
      [true, 'mikor_indul',  'bármelyik',   'azonnal, 1 hónapon belül', 25, 'Sürgős'],
      [true, 'szolgaltatas', 'tartalmazza', 'videó',    20, 'Videós igény'],
      [true, 'phone_number', 'nem üres',    '',         10, 'Megadott telefonszám']
    ]);
  }

  const segments = getOrCreateSheet_(LEAD_SHEETS.SEGMENTS,
    ['Szegmens', 'Min pont', 'Max pont', 'Sablon ID', 'Belső értesítés'], false);
  if (segments.getLastRow() < 2) {
    segments.getRange(2, 1, 3, 5).setValues([
      ['Hot',  60, '', 'hot',  ''],
      ['Warm', 30, 59, 'warm', ''],
      ['Cold',  0, 29, 'cold', '']
    ]);
  }

  const templates = getOrCreateSheet_(LEAD_SHEETS.TEMPLATES,
    ['Sablon ID', 'Tárgy', 'Forrás', 'Gmail piszkozat tárgya', 'HTML törzs'], false);
  if (templates.getLastRow() < 2) {
    templates.getRange(2, 1, 3, 5).setValues([
      ['hot',  'Szia {{full_name|}}! Mikor tudunk beszélni?', 'sheet', '',
       '<p>Szia {{full_name|Kedves Érdeklődő}}!</p><p>Köszönjük az érdeklődést. ' +
       'Foglalj időpontot: <a href="https://példa.hu/naptar">itt</a>.</p>'],
      ['warm', 'Köszönjük az érdeklődést, {{full_name|}}', 'sheet', '',
       '<p>Szia {{full_name|Kedves Érdeklődő}}!</p><p>Összeszedtünk pár esettanulmányt.</p>'],
      ['cold', 'Hasznos anyagok tőlünk', 'sheet', '',
       '<p>Szia {{full_name|Kedves Érdeklődő}}!</p><p>Itt egy ingyenes útmutató.</p>']
    ]);
  }

  clearConfigCache_();
  log_('✅ Lead scoring setup kész. Töltsd ki a Config lapot, majd: 🩺 Beállítás ellenőrzése.');
}

/* ===========================================================================
 * TESZTEK
 * ======================================================================== */

function runLeadTests() {
  const tests = [];
  const t = (name, fn) => tests.push({ name: name, fn: fn });
  const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`${msg || ''} várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`);
    }
  };
  const rule = (op, value, points) => ({ field: 'x', op: op, value: value, points: points || 10, label: '' });

  t('pontos egyezés kis/nagybetűtől függetlenül', () => eq(matchesRule_(' Igen ', rule('pontos', 'igen')), true));
  t('tartalmazza', () => eq(matchesRule_('Videó és fotó', rule('tartalmazza', 'videó')), true));
  t('bármelyik lista', () => eq(matchesRule_('azonnal', rule('bármelyik', 'azonnal, 1 hónapon belül')), true));
  t('nem üres üres mezőre hamis', () => eq(matchesRule_('', rule('nem üres', '')), false));
  t('ismeretlen operátor nem illeszkedik', () => eq(matchesRule_('bármi', rule('izé', 'x')), false));

  t('magyar ezres szóköz', () => eq(parseNumberHu_('500 000 Ft'), 500000));
  t('magyar ezres pont', () => eq(parseNumberHu_('1.500.000'), 1500000));
  t('magyar tizedesvessző', () => eq(parseNumberHu_('2,5'), 2.5));
  t('tartomány alsó határa', () => eq(parseNumberHu_('500 000 – 1 000 000 Ft'), 500000));
  t('szám összehasonlítás', () => eq(matchesRule_('500 000 Ft', rule('>=', 200000)), true));

  t('pontszám összeadódik', () => eq(scoreLead_({ x: 'igen' },
    [rule('pontos', 'igen', 30), rule('nem üres', '', 10)]).score, 40));
  t('negatív pont levon', () => eq(scoreLead_({ x: 'diák' },
    [rule('pontos', 'diák', -20)]).score, -20));

  const segs = [{ name: 'Hot', min: 60, max: Infinity }, { name: 'Warm', min: 30, max: 59 },
                { name: 'Cold', min: 0, max: 29 }];
  t('szegmens: felső sáv', () => eq(resolveSegment_(75, segs).name, 'Hot'));
  t('szegmens: határérték', () => eq(resolveSegment_(59, segs).name, 'Warm'));
  t('szegmens: nincs találat', () => eq(resolveSegment_(-5, segs), null));

  t('sablon behelyettesítés', () => eq(renderHtml_('Szia {{n}}!', { n: 'Anna' }), 'Szia Anna!'));
  t('tartalék érték üres mezőre', () => eq(renderHtml_('Szia {{n|Érdeklődő}}!', { n: '' }), 'Szia Érdeklődő!'));
  t('HTML escape', () => eq(renderHtml_('{{n}}', { n: '<b>x</b>' }), '&lt;b&gt;x&lt;/b&gt;'));
  t('tárgy nem escape-elődik', () => eq(renderText_('{{n}}', { n: 'A & B' }), 'A & B'));

  t('email validáció – jó', () => eq(isValidEmail_('a.b@hypin.hu'), true));
  t('email validáció – rossz', () => eq(isValidEmail_('nincs-kukac'), false));

  const failed = [];
  tests.forEach(x => {
    try { x.fn(); console.log('✅ ' + x.name); }
    catch (e) { failed.push(x.name); console.log('❌ ' + x.name + ': ' + e.message); }
  });
  console.log(failed.length
    ? `\n${failed.length} teszt bukott: ${failed.join(', ')}`
    : `\nMind a ${tests.length} teszt zöld.`);
}
