// "Saved ✓" over a write that saved nothing.
//
// THE FINDING (proven live against production, 2026-09-17, anon PATCH on a real job row):
//     without .select()  ->  HTTP 204, EMPTY BODY, no error
//     with    .select()  ->  HTTP 200, []
// supabase-js hands the first back as { data:null, error:null }, so the near-universal call
// shape `if (r.error) { complain } else { "Saved ✓" }` prints SUCCESS over a refused write.
// Swept the platform the same day: 79 of 123 writes had no .select() at all.
//
// This is THE reason the Supabase platform was structurally less trustworthy than the Xano
// system it replaces. Xano fails LOUDLY. Supabase RLS fails SILENTLY. It has been paid for
// five separate times, each found by a human watching their own work disappear.
//
// WHAT THIS TEST DOES: loads the REAL vendored supabase-js bundle + the REAL shipped guard
// into a sandbox with a fetch that behaves like PostgREST (204/empty with no Prefer header,
// 200/[] when a representation is requested), then EXECUTES real write chains through the
// real builder. Nothing here is a mock of our own code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + '\n         got  ' + a + '\n         want ' + b); }
};
const ok = (l, c) => eq(l, !!c, true);
const no = (l, c) => eq(l, !!c, false);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── a browser-shaped sandbox: the real bundle, the real guard ──────────────────────────
function boot(fetchImpl) {
  const el = () => ({ setAttribute(){}, getAttribute(){return null;}, style:{}, appendChild(){},
                      removeChild(){}, addEventListener(){}, innerHTML:'', textContent:'' });
  const sb = {
    console: { log(){}, warn(){}, error(){}, info(){}, debug(){} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Promise, JSON, Date, Math, Array, Object, String, Number, Boolean, Error, RegExp, Map, Set,
    TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
    Headers: global.Headers, Response: global.Response, Request: global.Request, Blob: global.Blob,
    crypto: require('crypto').webcrypto, process, fetch: fetchImpl,
    location: { href: 'https://tnapplianceexchange.net/platform/tech.html',
                origin: 'https://tnapplianceexchange.net', protocol: 'https:',
                host: 'tnapplianceexchange.net', reload(){} },
    navigator: { userAgent: 'node', onLine: true },
    addEventListener(){}, removeEventListener(){},
    localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
    document: {
      getElementById(){ return null; },
      getElementsByTagName(n){ return n === 'script'
        ? [{ src: 'https://tnapplianceexchange.net/platform/vendor/supabase-js.js' }] : []; },
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      createElement(){ return el(); }, addEventListener(){}, removeEventListener(){},
      cookie: '',
      currentScript: { tagName: 'SCRIPT', src: 'https://tnapplianceexchange.net/platform/vendor/supabase-js.js' },
      head: el(), body: null, documentElement: el(),
    },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(R('platform/vendor/supabase-js.js'), ctx, { filename: 'supabase-js.js' });
  vm.runInContext(R('platform/vendor/supa-guard.js'), ctx, { filename: 'supa-guard.js' });
  return ctx;
}

// PostgREST to the letter: no representation asked for -> 204 with an EMPTY body; asked for
// -> 200 with whatever rows matched. `rows` decides what a matching write returns.
function server(rows) {
  const seen = [];
  const f = async (url, opts) => {
    const o = opts || {};
    const h = {};
    try {
      if (o.headers && typeof o.headers.forEach === 'function' && !Array.isArray(o.headers)) {
        o.headers.forEach((v, k) => { h[String(k).toLowerCase()] = v; });
      } else {
        Object.keys(o.headers || {}).forEach((k) => { h[String(k).toLowerCase()] = o.headers[k]; });
      }
    } catch (e) {}
    seen.push({ url: String(url), method: o.method, headers: h, body: o.body });
    const body = typeof rows === 'function' ? rows(String(url), o) : rows;
    // A plain READ is a GET: PostgREST always returns a body, no Prefer header involved.
    if (!o.method || String(o.method).toUpperCase() === 'GET') {
      return new Response(JSON.stringify(body || []), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body && body.__error) {
      return new Response(JSON.stringify({ message: body.__error, code: body.__code || '42501' }),
        { status: body.__status || 403, headers: { 'content-type': 'application/json' } });
    }
    if (!/return=representation/.test(h.prefer || '')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body || []), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  f.seen = seen;
  return f;
}
const client = (f) => { const c = boot(f); return { sb: c.supabase.createClient('https://x.supabase.co', 'pk_test'), ctx: c }; };

(async () => {

console.log('\nthe guard is even installed on the real bundle');
{
  const f = server([]); const { ctx } = client(f);
  ok('createClient was wrapped', !!ctx.__ANT_WRITE_GUARD);
  ok('the raw library still exposes createClient', typeof ctx.supabase.createClient === 'function');
}

console.log('\nTHE BUG: a refused single-row update no longer reads as success');
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job').update({ time_window: '8-11' }).eq('id', 'JOB1');
  ok('the write now carries an error', !!r.error);
  eq('and it is our verdict, not an invented server code', r.error && r.error.code, 'ANT_WRITE_REFUSED');
  ok('the message tells a human nothing was changed', /did NOT save/i.test((r.error || {}).message || ''));
  ok('it names the table so the office can report it', /on job/.test((r.error || {}).message || ''));
  eq('data is an empty list, never null', r.data, []);
}

console.log('\n...because the request now ASKS for a representation (this is the mechanism)');
{
  const f = server([]); const { sb } = client(f);
  await sb.from('job').update({ a: 1 }).eq('id', 'JOB1');
  eq('exactly one round trip — the forced select is not a second request', f.seen.length, 1);
  const req = f.seen[0];
  eq('still a PATCH', req.method, 'PATCH');
  ok('the URL now carries select=', /[?&]select=/.test(req.url));
  eq('and PostgREST is told to return the row', req.headers.prefer, 'return=representation');
}

console.log('\na write that really landed is untouched');
{
  const f = server([{ id: 'JOB1' }]); const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'JOB1');
  eq('no error', r.error, null);
  eq('the row comes back', r.data, [{ id: 'JOB1' }]);
}

console.log('\na caller who already wrote .select() is not double-selected');
{
  const f = server([{ id: 'JOB1' }]); const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'JOB1').select('id');
  eq('one round trip', f.seen.length, 1);
  ok('their columns win — we did not overwrite select with *', /select=id(&|$)/.test(f.seen[0].url));
  eq('and it still succeeds', r.error, null);
}
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'JOB1').select('id');
  eq('an explicit .select() that comes back empty is ALSO a refusal', r.error && r.error.code, 'ANT_WRITE_REFUSED');
}

console.log('\ninsert and upsert: a successful one can never return zero rows');
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job_part').insert({ job_id: 'J', number: 'W10' });
  eq('an insert that returns nothing is refused', r.error && r.error.code, 'ANT_WRITE_REFUSED');
}
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job_tdr').upsert({ job_id: 'J', outcome: 'fixed' }, { onConflict: 'job_id' });
  eq('an upsert that returns nothing is refused', r.error && r.error.code, 'ANT_WRITE_REFUSED');
}
{
  const f = server([{ id: 'P1' }]); const { sb } = client(f);
  const r = await sb.from('job_part').insert({ job_id: 'J' });
  eq('a real insert passes through', r.error, null);
  eq('with its row', r.data, [{ id: 'P1' }]);
}

console.log('\nDELETE is never called a failure — nothing-to-delete is a real, normal answer');
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job_tag').delete().eq('job_id', 'J');
  eq('zero rows deleted is NOT an error', r.error, null);
  eq('the caller can still look at what came back', r.data, []);
}

console.log('\na BULK / conditional update is exempt — zero rows is its normal case');
{
  // dispatch.html withdrawOtherOffers: withdraw every OTHER pending offer on a job. When there
  // is no other pending offer -- the common case -- zero rows matched and nothing is wrong.
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('schedule_offer')
    .update({ status: 'withdrawn' }).eq('job_id', 'J1').eq('status', 'pending').neq('id', 'KEEP');
  eq('no false alarm on the real withdraw-other-offers call', r.error, null);
}
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).in('id', ['A', 'B']);
  eq('an .in() batch update is exempt too', r.error, null);
}
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).neq('id', 'X');
  eq('id=neq is not an identity write, so it is exempt', r.error, null);
}

console.log('\na REAL server error is passed through untouched — we never mask Postgres');
{
  const f = server({ __error: 'new row violates row-level security policy', __code: '42501', __status: 403 });
  const { sb } = client(f);
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'J');
  ok('there is an error', !!r.error);
  eq('it is still the database\'s code, not ours', (r.error || {}).code, '42501');
  ok('and the database\'s own words survive', /row-level security/.test((r.error || {}).message || ''));
}

console.log('\nthe promise contract still behaves like a promise');
{
  const f = server([{ id: 'X' }]); const { sb } = client(f);
  let ran = false;
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'J').then(function (x) { ran = true; return x; });
  ok('.then() still receives the result', ran);
  eq('and forwards it', r.data, [{ id: 'X' }]);
}
{
  const f = server([{ id: 'X' }]); const { sb } = client(f);
  let ran = false;
  await sb.from('job').update({ a: 1 }).eq('id', 'J').finally(function () { ran = true; });
  ok('.finally() still runs', ran);
}
{
  const f = server([]); const { sb } = client(f);
  let caught = false;
  await sb.from('job').update({ a: 1 }).eq('id', 'J').catch(function () { caught = true; });
  no('a refusal resolves (it is a value, not a throw) — call sites read r.error', caught);
}

console.log('\nREADS are untouched — an empty result set is not an error');
{
  const f = server([]); const { sb } = client(f);
  const r = await sb.from('job').select('id').eq('id', 'nope');
  eq('a select that finds nothing stays clean', r.error, null);
  eq('empty list', r.data, []);
}

console.log('\nthe guard can never be the reason a page breaks');
{
  // Loading it twice must not double-wrap (it would re-force select on an already-selected
  // builder and could recurse). Idempotence is the property that makes it safe on any page.
  const f = server([{ id: 'X' }]); const { sb, ctx } = client(f);
  const before = ctx.supabase.createClient;
  vm.runInContext(R('platform/vendor/supa-guard.js'), ctx, { filename: 'supa-guard-2.js' });
  // NOTE: compare the FUNCTIONS by identity. An eq() here compares JSON.stringify of two
  // functions -- both `undefined` -- so it can never fail. That exact vacuous assertion let
  // this mutation survive on the first run.
  ok('a second load does not re-wrap createClient', ctx.supabase.createClient === before);
  const r = await sb.from('job').update({ a: 1 }).eq('id', 'J');
  eq('and writes still work after it', r.error, null);
  // A client built AFTER a double-load must still make exactly one round trip.
  const sb2 = ctx.supabase.createClient('https://x.supabase.co', 'pk_test');
  const n0 = f.seen.length;
  await sb2.from('job').update({ a: 1 }).eq('id', 'J');
  eq('a client created after a second load still sends one request', f.seen.length - n0, 1);
}

// ── coverage: shipped, loaded everywhere, and cache-busted ─────────────────────────────
console.log('\nthe shipped guard actually contains the rule (not just this test)');
{
  const G = stripComments(R('platform/vendor/supa-guard.js'));
  ok('it wraps createClient', /supabase\.createClient\s*=\s*function/.test(G));
  ok('it forces a representation', /origSel\(\)/.test(G));
  ok('it judges by identity', /id=eq\\\./.test(G));
  ok('insert and upsert are always judged', /verb === 'insert' \|\| verb === 'upsert'/.test(G));
  no('delete is never judged', /VERDICT\s*=\s*\{[^}]*delete\s*:\s*1/.test(G));
  ok('it exposes itself for diagnostics', /__ANT_WRITE_GUARD/.test(G));
}

console.log('\nevery page that talks to Supabase loads the guard, and busts its cache');
{
  const files = fs.readdirSync(path.join(root, 'platform')).filter((f) => f.endsWith('.html'));
  let checked = 0;
  files.forEach((f) => {
    const src = R('platform/' + f);
    if (!/supabase\.createClient/.test(stripComments(src))) return;
    checked++;
    const tag = (src.match(/<script src="[^"]*supa-guard\.js([^"]*)"[^>]*>/) || [])[0];
    ok(f + ' loads supa-guard.js', !!tag);
    // A stale cached guard is a page running WITHOUT the protection while every other file
    // is new. netlify.toml no-caches /*.html only, so a shared .js keeps whatever the phone
    // holds — the documented trap that took the day list down on 2026-09-16.
    ok(f + ' cache-busts it (?v=)', /\?v=/.test(tag || ''));
    // ORDER IS THE WHOLE THING. The guard wraps createClient, so it must run AFTER the
    // library exists and BEFORE the page builds its client. Either way round and the guard
    // silently does nothing -- a page that looks protected and is not.
    const gAt = src.indexOf('supa-guard.js');
    const libAt = src.indexOf('vendor/supabase-js.js');
    const createAt = src.indexOf('supabase.createClient');
    ok(f + ' loads the guard AFTER the supabase library', libAt >= 0 && gAt > libAt);
    ok(f + ' loads the guard BEFORE it builds a client', gAt < createAt);
  });
  ok('found real pages to check', checked >= 20);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch((e) => { console.log('HARNESS ERROR: ' + (e && e.message ? e.message : e)); process.exit(1); });
