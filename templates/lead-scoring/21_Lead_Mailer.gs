/**
 * 21_Lead_Mailer – email küldés szegmens szerint
 */

/**
 * A szegmenshez tartozó email kiküldése egy leadnek.
 *
 * @param {string} email    a lead (validált) email címe
 * @param {Object} lead     a teljes lead sor objektumként
 * @param {Object} segment  loadSegments_() egy eleme
 * @param {Object} tpl      loadTemplates_() egy eleme
 * @param {Object} scored   scoreLead_() eredménye
 * @param {Object} cfg      getConfig_()
 */
function sendSegmentEmail_(email, lead, segment, tpl, scored, cfg) {
  const context = Object.assign({}, lead, {
    'Pontszám': scored.score,
    'Szegmens': segment.name,
    'Email':    email,
    'Dátum':    fmtDate_(new Date(), 'yyyy. MM. dd.')
  });

  const body = (tpl.source === 'gmail-piszkozat' || tpl.source === 'gmail-draft')
    ? renderHtml_(draftBody_(tpl.draftSubject), context)
    : renderHtml_(tpl.html, context);

  const subject = renderText_(tpl.subject, context);

  // Teszt mód: minden levél a TEST_EMAIL címre megy, az eredeti címzettel a tárgyban.
  const testMode  = !!cfg.TEST_EMAIL;
  const recipient = testMode ? String(cfg.TEST_EMAIL).trim() : email;
  const finalSubject = testMode ? `[TESZT → ${email}] ${subject}` : subject;

  const options = { htmlBody: body, body: htmlToPlain_(body) };
  if (cfg.SENDER_NAME) options.name = String(cfg.SENDER_NAME);
  if (cfg.REPLY_TO)    options.replyTo = String(cfg.REPLY_TO);

  withRetry_(
    () => MailApp.sendEmail(Object.assign({ to: recipient, subject: finalSubject }, options)),
    { label: `email → ${recipient}`, tries: 3 }
  );

  log_(`📨 ${testMode ? '[TESZT] ' : ''}${email} → ${segment.name} (${scored.score} pont)`);
}

/**
 * Belső értesítés forró leadről. Külön try/catch-ben hívjuk:
 * ha ez elszáll, az ügyfélnek szóló levél már kiment, nem szabad újraküldeni.
 */
function notifyInternal_(recipients, email, lead, scored, segment, sheet, cfg) {
  const url = leadRowUrl_(sheet, lead._rowNumber);
  const details = Object.keys(lead)
    .filter(k => k.charAt(0) !== '_' && LEAD_OUT_COLUMNS.indexOf(k) === -1)
    .map(k => `• ${k}: ${lead[k]}`)
    .join('\n');

  const text =
    `🔥 *Új ${segment.name} lead* – ${scored.score} pont\n` +
    `${email}\n\n${details}\n\n` +
    `Pontok: ${scored.hits.join(', ') || '–'}\n${url}`;

  alertToChat_(text);

  String(recipients).split(/[,;]/).map(s => s.trim()).filter(isValidEmail_)
    .forEach(to => {
      MailApp.sendEmail({
        to: to,
        subject: `🔥 Új ${segment.name} lead (${scored.score} pont) – ${email}`,
        htmlBody: `<p><b>${escapeHtml_(email)}</b> – ${scored.score} pont – ${escapeHtml_(segment.name)}</p>` +
                  `<pre>${escapeHtml_(details)}</pre>` +
                  `<p><a href="${url}">Megnyitás a táblázatban</a></p>`
      });
    });
}

/** Csak Chat-értesítés, email nélkül (a riasztástól eltérően ez nem hiba). */
function alertToChat_(message) {
  const url = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL');
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: String(message) }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.log('Chat értesítés nem ment ki: ' + e);
  }
}

/** Közvetlen link a lead sorára. */
function leadRowUrl_(sheet, row) {
  return `${ss_().getUrl()}#gid=${sheet.getSheetId()}&range=A${row}`;
}

/** Egyszerű, de gyakorlatias email-validáció. */
function isValidEmail_(email) {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(email || '').trim());
}
