/**
 * 03_Lib_Http – külső hívások retry-jal és párhuzamosan
 */

/**
 * Újrapróbálás exponenciális backoffal.
 * Az átmeneti hiba (500, 503, rate limit) nem kivétel, hanem üzemszerű
 * működés a Google és a legtöbb külső API esetén – tervezz rá.
 *
 * @param {Function} fn
 * @param {{tries?:number, baseMs?:number, label?:string}} [opts]
 */
function withRetry_(fn, opts) {
  const o = Object.assign({ tries: 4, baseMs: 800, label: 'művelet' }, opts || {});
  let lastErr;

  for (let attempt = 1; attempt <= o.tries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient_(err) || attempt === o.tries) break;
      const wait = o.baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
      console.log(`[retry] ${o.label} – ${attempt + 1}. próba ${wait} ms múlva (${err})`);
      Utilities.sleep(wait);   // ⚠️ blokkol: a 6 perces keretből fogy
    }
  }
  throw new Error(`${o.label} – ${o.tries} próbálkozás után sem sikerült: ${lastErr}`);
}

/** Átmeneti (újrapróbálható) hiba-e? */
function isTransient_(err) {
  const m = String((err && err.message) || err).toLowerCase();
  return ['internal error', 'service unavailable', 'rate limit', 'timeout',
          'timed out', 'try again', 'backend error', 'too many requests',
          'temporarily unavailable', '429', '500', '502', '503', '504']
    .some(s => m.indexOf(s) !== -1);
}

/**
 * Egyetlen HTTP hívás – mindig muteHttpExceptions-szel, retry-jal.
 * @param {string} url
 * @param {Object} [options]  UrlFetchApp opciók
 * @return {{ok:boolean, code:number, body:string, json:*}}
 */
function httpFetch_(url, options) {
  const opts = Object.assign({ method: 'get', muteHttpExceptions: true }, options || {});
  const res = withRetry_(() => UrlFetchApp.fetch(url, opts), { label: 'fetch ' + shortUrl_(url) });
  const code = res.getResponseCode();
  const body = res.getContentText();
  return {
    ok: code >= 200 && code < 300,
    code: code,
    body: body,
    json: tryParseJson_(body)
  };
}

/**
 * Párhuzamos HTTP hívás kötegelve – az EGYETLEN valódi párhuzamosítás
 * a platformon. 50 hívásnál nagyságrendi gyorsulás a soros hívásokhoz képest.
 *
 * @param {Object[]} requests   UrlFetchApp.fetchAll kérésobjektumok
 * @param {number}   [chunkSize=30]
 * @return {Array<{ok:boolean, code:number, url:string, body:string, json:*}>}
 */
function fetchAllChunked_(requests, chunkSize) {
  const size = chunkSize || 30;
  const out = [];

  for (let i = 0; i < requests.length; i += size) {
    const chunk = requests.slice(i, i + size)
      .map(r => Object.assign({ muteHttpExceptions: true }, r));   // e nélkül egy 404 eldobja az egész köteget

    const responses = withRetry_(
      () => UrlFetchApp.fetchAll(chunk),
      { label: `fetchAll ${i}–${i + chunk.length}` }
    );

    responses.forEach((res, j) => {
      const code = res.getResponseCode();
      const body = res.getContentText();
      out.push({
        ok: code >= 200 && code < 300,
        code: code,
        url: chunk[j].url,
        body: body,
        json: tryParseJson_(body)
      });
    });
  }
  return out;
}

function tryParseJson_(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function shortUrl_(url) {
  return String(url).split('?')[0].slice(0, 80);
}

/* ---------------------------------------------------------------------------
 * Cache – nagy értékekkel is (a CacheService kulcsonként ~100 kB-ot bír)
 * ------------------------------------------------------------------------ */

const CACHE_MAX_TTL = 21600;   // 6 óra = a platform maximuma

function cacheGetJson_(key) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + '__meta');
  if (!meta) return null;

  const chunks = Number(meta);
  const keys = [];
  for (let i = 0; i < chunks; i++) keys.push(`${key}__${i}`);

  const parts = cache.getAll(keys);
  let joined = '';
  for (let i = 0; i < chunks; i++) {
    const part = parts[`${key}__${i}`];
    if (part === undefined) return null;    // hiányos cache → kezeld cache miss-ként
    joined += part;
  }
  return tryParseJson_(joined);
}

function cachePutJson_(key, obj, ttl) {
  const cache = CacheService.getScriptCache();
  const text = JSON.stringify(obj);
  const SIZE = 90 * 1024;                   // ráhagyás a ~100 kB-os limithez
  const map = {};
  let chunks = 0;

  for (let i = 0; i < text.length; i += SIZE) {
    map[`${key}__${chunks++}`] = text.slice(i, i + SIZE);
  }
  map[key + '__meta'] = String(chunks);
  cache.putAll(map, Math.min(ttl || CACHE_MAX_TTL, CACHE_MAX_TTL));
}
