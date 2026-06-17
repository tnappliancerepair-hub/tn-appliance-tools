// parts-lookup-direct — calls the Mac parts daemon DIRECTLY via the Cloudflare
// tunnel URL (PARTS_DAEMON_URL in the vault), synchronously. This replaces the
// slow path (Netlify -> Xano signal -> Mac loop poll -> daemon -> event_log ->
// read back). One hop, ~3-5s, no queue, no 60s loop tick.
//
//   GET ?path=lookup&supplier=marcone&model=795.72059.110[&debug=1]
//   GET ?path=lookup&supplier=amazon&model=...&component=water+filter
//   GET ?path=intel&source=msa&brand=Whirlpool&model=...
//   GET ?path=search&model=...   |   ?path=health
//
//   -> { ok, source_url, status, data }   (data = daemon's JSON response)
'use strict';

const { getSecret } = require('./_lib/secrets');

const ALLOWED = new Set(['lookup', 'intel', 'search', 'health']);
const DAEMON_TIMEOUT_MS = 20000;

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  const q = event.queryStringParameters || {};
  const path = String(q.path || 'lookup').toLowerCase();
  if (!ALLOWED.has(path)) return j(400, { ok: false, error: 'bad path' });

  const base = (await getSecret('PARTS_DAEMON_URL') || '').trim().replace(/\/+$/, '');
  if (!base) return j(503, { ok: false, error: 'daemon_not_registered', hint: 'Run the tunnel on the Mac (npm run tunnel) so it registers its URL.' });

  // forward the query params the daemon understands (everything except our own `path`)
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) { if (k !== 'path' && v != null) params.set(k, String(v)); }
  const url = `${base}/${path}${params.toString() ? ('?' + params.toString()) : ''}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DAEMON_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 2000) }; }
    return j(200, { ok: r.ok, source_url: url, status: r.status, data });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return j(200, { ok: false, error: aborted ? 'daemon_timeout' : ('daemon_unreachable: ' + String((err && err.message) || err)), source_url: url, hint: 'Is serve.js + the tunnel running on the Mac?' });
  }
};
