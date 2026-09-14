/**
 * 20_Lead_Scoring – pontozómotor
 *
 * A pontozási szabályok NEM a kódban vannak, hanem a "Pontozás" lapon.
 * Ez szándékos: az account manager és az ügyfél is tudja hangolni anélkül,
 * hogy fejlesztőhöz kellene fordulni – és minden változás látszik a Sheet
 * verziótörténetében.
 */

/** A modul által használt lapnevek. */
const LEAD_SHEETS = {
  LEADS:     'Leads',
  RULES:     'Pontozás',
  SEGMENTS:  'Szegmensek',
  TEMPLATES: 'Sablonok'
};

/** A script által a Leads lapra írt oszlopok (automatikusan létrejönnek). */
const LEAD_OUT_COLUMNS = ['Pontszám', 'Szegmens', 'Státusz', 'Feldolgozva', 'Megjegyzés'];

/** Támogatott operátorok a Pontozás lapon. */
const LEAD_OPERATORS = ['pontos', 'tartalmazza', 'kezdődik', 'bármelyik', 'regex',
                        'nem üres', 'üres', '>=', '<=', '>', '<'];

/* ===========================================================================
 * SZABÁLYOK
 * ======================================================================== */

/**
 * Pontozási szabályok beolvasása a "Pontozás" lapról.
 * @return {Array<{field:string, op:string, value:*, points:number, label:string}>}
 */
function loadRules_() {
  return readAsObjects_(LEAD_SHEETS.RULES)
    .filter(r => r['Mező'] !== '' && r['Mező'] != null &&
                 String(r['Aktív']).toLowerCase() !== 'false')
    .map(r => ({
      field:  String(r['Mező']).trim(),
      op:     String(r['Operátor'] || 'pontos').trim().toLowerCase(),
      value:  r['Érték'],
      points: Number(r['Pont']) || 0,
      label:  String(r['Megjegyzés'] || '')
    }));
}

/**
 * Egy lead kipontozása. Az összes illeszkedő szabály pontja összeadódik
 * (a negatív pont is működik, pl. "diák" = -20).
 *
 * @param {Object} lead   readAsObjects_() egy eleme
 * @param {Array}  rules  loadRules_() eredménye
 * @return {{score:number, hits:string[]}}
 */
function scoreLead_(lead, rules) {
  let score = 0;
  const hits = [];

  rules.forEach(rule => {
    if (matchesRule_(lead[rule.field], rule)) {
      score += rule.points;
      hits.push(`${rule.label || rule.field}: ${rule.points >= 0 ? '+' : ''}${rule.points}`);
    }
  });
  return { score: score, hits: hits };
}

/**
 * Illeszkedik-e egy válasz a szabályra.
 * Minden szöveges összehasonlítás kis/nagybetű-független és trimmelt –
 * az űrlapkitöltők válaszai sosem tiszták.
 */
function matchesRule_(raw, rule) {
  const text = String(raw == null ? '' : raw).trim();
  const want = String(rule.value == null ? '' : rule.value).trim();
  const lc = text.toLowerCase();
  const wl = want.toLowerCase();

  switch (rule.op) {
    case 'pontos':      return lc === wl;
    case 'tartalmazza': return wl !== '' && lc.indexOf(wl) !== -1;
    case 'kezdődik':    return wl !== '' && lc.indexOf(wl) === 0;
    case 'bármelyik':   return want.split(/[,;|]/).map(s => s.trim().toLowerCase())
                                   .filter(s => s !== '')
                                   .some(v => lc === v);
    case 'regex':
      try { return new RegExp(want, 'i').test(text); } catch (e) { return false; }
    case 'nem üres':    return text !== '';
    case 'üres':        return text === '';
    case '>=': case '<=': case '>': case '<': {
      const a = parseNumberHu_(text);
      const b = parseNumberHu_(want);
      if (isNaN(a) || isNaN(b)) return false;
      if (rule.op === '>=') return a >= b;
      if (rule.op === '<=') return a <= b;
      if (rule.op === '>')  return a > b;
      return a < b;
    }
    default: return false;     // ismeretlen operátort a validateLeadSetup_ jelzi
  }
}

/**
 * Magyar formátumú szám kiolvasása szövegből.
 * Kezeli: "500 000 Ft", "1.500.000", "2,5", "500 000 – 1 000 000 Ft" (→ 500000).
 * Tartományos válasznál az ALSÓ határt adja vissza – ezzel érdemes számolni
 * a ">=" típusú szabályoknál.
 */
function parseNumberHu_(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();

  const cleaned = String(value == null ? '' : value)
    .replace(/[\s ]/g, '')            // szóköz és nbsp (ezres elválasztó)
    .replace(/(ft|huf|eur|usd|€|\$)/gi, '')
    .replace(/\.(?=\d{3}\b)/g, '')         // 1.500.000 → 1500000
    .replace(',', '.')                     // magyar tizedesvessző
    .replace(/[^0-9.\-]/g, ' ')
    .trim();

  const first = cleaned.split(/\s+/)[0];
  const n = parseFloat(first);
  return isNaN(n) ? NaN : n;
}

/* ===========================================================================
 * SZEGMENSEK
 * ======================================================================== */

/**
 * Szegmensek beolvasása, csökkenő pontsorrendben (így az első találat
 * mindig a legmagasabb illeszkedő szegmens).
 */
function loadSegments_() {
  return readAsObjects_(LEAD_SHEETS.SEGMENTS)
    .filter(r => r['Szegmens'] !== '' && r['Szegmens'] != null)
    .map(r => ({
      name:       String(r['Szegmens']).trim(),
      min:        Number(r['Min pont']),
      max:        (r['Max pont'] === '' || r['Max pont'] == null)
                    ? Number.POSITIVE_INFINITY : Number(r['Max pont']),
      templateId: String(r['Sablon ID'] || '').trim(),
      notify:     String(r['Belső értesítés'] || '').trim()
    }))
    .sort((a, b) => b.min - a.min);
}

/** @return {Object|null} a pontszámhoz tartozó szegmens */
function resolveSegment_(score, segments) {
  for (const s of segments) {
    if (score >= s.min && score <= s.max) return s;
  }
  return null;
}

/* ===========================================================================
 * SABLONOK
 * ======================================================================== */

/** Email sablonok beolvasása a "Sablonok" lapról, ID szerint indexelve. */
function loadTemplates_() {
  const map = {};
  readAsObjects_(LEAD_SHEETS.TEMPLATES).forEach(r => {
    const id = String(r['Sablon ID'] || '').trim();
    if (!id) return;
    map[id] = {
      subject:      String(r['Tárgy'] || ''),
      source:       String(r['Forrás'] || 'sheet').trim().toLowerCase(),
      draftSubject: String(r['Gmail piszkozat tárgya'] || '').trim(),
      html:         String(r['HTML törzs'] || '')
    };
  });
  return map;
}

/**
 * Gmail piszkozat törzsének kiolvasása tárgy alapján.
 * Így a marketinges a Gmailben, formázva és aláírással írhatja meg a levelet,
 * nem HTML-t másolgat a Sheetbe.
 */
function draftBody_(subject) {
  const cacheKey = 'draft:' + subject;
  const cached = cacheGetJson_(cacheKey);
  if (cached && cached.html) return cached.html;

  const drafts = GmailApp.getDrafts();
  for (const d of drafts) {
    const msg = d.getMessage();
    if (msg.getSubject().trim() === subject) {
      const html = msg.getBody();
      cachePutJson_(cacheKey, { html: html }, 600);   // 10 perc
      return html;
    }
  }
  throw new Error(`Nincs Gmail piszkozat ezzel a tárggyal: "${subject}"`);
}

/* ===========================================================================
 * SABLON-BEHELYETTESÍTÉS
 * ======================================================================== */

/**
 * {{Oszlopnév}} helyettesítése. Támogatja a tartalék értéket:
 * {{Név|kedves Érdeklődő}} – ha a mező üres, a | utáni szöveg kerül be.
 * Így soha nem megy ki "Szia !" kezdetű levél.
 *
 * @param {boolean} escape  HTML-escape (törzsnél igen, tárgynál nem)
 */
function renderTemplate_(text, context, escape) {
  return String(text).replace(
    /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
    (match, key, fallback) => {
      const v = context[key];
      const empty = (v === undefined || v === null || String(v).trim() === '');
      const out = empty ? (fallback === undefined ? '' : fallback) : String(v);
      return escape ? escapeHtml_(out) : out;
    }
  );
}

function renderHtml_(text, context) { return renderTemplate_(text, context, true); }
function renderText_(text, context) { return renderTemplate_(text, context, false); }

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Egyszerű HTML → sima szöveg, a levél plain-text változatához. */
function htmlToPlain_(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
