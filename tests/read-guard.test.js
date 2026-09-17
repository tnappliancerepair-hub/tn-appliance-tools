// The READ-side twin of the silent-write bug.
//
// PostgREST caps a response at 1,000 rows SERVER SIDE and does NOT error -- it quietly hands
// back less. Measured live 2026-09-10 on the real board query:
//
//     GET /rest/v1/job?status=not.in.(completed,canceled)&limit=2000
//     -> content-range: 0-999/1210        1,000 rows returned, 1,210 exist
//
// So `.limit(3000)` reads like "give me everything" and is a 1,000-row wall. ant-page.js is the
// ONE browser-side pager every such read goes through -- and it carried the MONEY pages
// (owner take-home, a tech's pay) with no test at all since the day it shipped. This is that test.
//
// AND the regression that conversion introduces, which is the reason this file exists:
// AntPage.all RESOLVES on a lost page. It hands back what it got plus {error, partial} rather
// than rejecting -- deliberately, so a list still renders. On a MONEY surface that silence is
// the whole bug: a short read draws a confident WRONG take-home, and the page's own .catch()
// never fires. A money page must check {error || partial} or it is worse than before.
const fs = require('fs');
const path = require('path');
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

// ── the REAL shipped pager, loaded the way a browser loads it ───────────────
const win = { console: { warn() {}, error() {} } };
new Function('window', R('platform/ant-page.js'))(win);
const AntPage = win.AntPage;

// Stand in for PostgREST: honours range() and HARD-CAPS any page at 1000 the way the real
// server does. `lose` makes one page fail every time (both the call and its one retry) so we
// can prove what a genuinely lost page does.
function server(total, opts) {
  opts = opts || {};
  const calls = [];
  function q() {
    const st = { order: null, range: null };
    const b = {
      order(col, o) { st.order = col + '.' + (o && o.ascending ? 'asc' : 'desc'); return b; },
      range(from, to) { st.range = [from, to]; return b; },
      then(res, rej) {
        calls.push({ order: st.order, from: st.range[0], to: st.range[1] });
        const page = Math.floor(st.range[0] / 1000);
        if (opts.lose === page) return Promise.resolve({ data: null, error: { message: 'lost page ' + page } }).then(res, rej);
        const size = Math.min(1000, st.range[1] - st.range[0] + 1);   // the server-side cap
        const out = [];
        for (let i = st.range[0]; i < Math.min(total, st.range[0] + size); i++) out.push({ id: i + 1 });
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      }
    };
    return b;
  }
  return { q, calls };
}

(async function () {
  console.log('\nAntPage.all reads EVERY row, not the first 1,000');
  {
    const s = server(2400);
    const r = await AntPage.all(() => s.q(), { label: 'job' });
    eq('2,400 rows come back whole', r.data.length, 2400);
    eq('took 3 pages', r.pages, 3);
    no('not flagged partial', r.partial);
    eq('no error', r.error, null);
    eq('page boundaries are right', s.calls.map(c => c.from), [0, 1000, 2000]);
  }
  {
    const s = server(1000);
    const r = await AntPage.all(() => s.q(), { label: 'exact' });
    // Exactly-1000 is the nastiest case: a full page means "there may be more", so it MUST
    // ask again. Stopping here is precisely the bug (the board served exactly 1,000 of 1,129).
    eq('a full first page still asks for a second', s.calls.length, 2);
    eq('and returns all 1,000', r.data.length, 1000);
  }
  {
    const s = server(12);
    const r = await AntPage.all(() => s.q(), { label: 'small' });
    eq('a short read stops after one page', s.calls.length, 1);
    eq('12 rows', r.data.length, 12);
  }

  console.log('\nevery page is ordered — .range() over an UNORDERED result skips or duplicates rows');
  {
    const s = server(2400);
    await AntPage.all(() => s.q(), { label: 'ordered' });
    ok('every page carries a stable ascending order', s.calls.every(c => c.order === 'id.asc'));
  }

  console.log('\nA LOST PAGE IS REPORTED — never treated as end-of-table');
  {
    const s = server(2400, { lose: 1 });
    const r = await AntPage.all(() => s.q(), { label: 'lossy' });
    ok('it resolves rather than rejecting (a list still renders)', !!r);
    ok('but it says plainly that it is incomplete', !!r.error);
    ok('and flags partial', r.partial === true);
    eq('it hands back only what it actually got', r.data.length, 1000);
    // Silently returning 1,000 of 2,400 with no error IS the bug this whole file is about.
    no('it does NOT pretend the read was complete', r.error === null && r.partial === false);
    eq('the lost page was retried once before giving up', s.calls.filter(c => c.from === 1000).length, 2);
  }
  {
    // A transient blip must NOT lose the tail: one retry, then carry on.
    let first = true;
    const s = server(2400);
    const rawQ = s.q;
    const r = await AntPage.all(() => {
      const b = rawQ();
      const origThen = b.then;
      b.then = function (res, rej) {
        if (first) { first = false; return Promise.resolve({ data: null, error: { message: 'blip' } }).then(res, rej); }
        return origThen.call(b, res, rej);
      };
      return b;
    }, { label: 'blip' });
    eq('one transient failure is retried and the read completes', r.data.length, 2400);
    no('and is not flagged partial', r.partial);
  }
  {
    const s = server(50000);
    const r = await AntPage.all(() => s.q(), { label: 'runaway', maxPages: 3 });
    ok('a runaway read stops at maxPages', r.partial === true);
    eq('and reports how far it got', r.data.length, 3000);
  }

  console.log('\nTHE MONEY SURFACES REFUSE TO RENDER A NUMBER OFF A SHORT READ');
  // The regression this closes: AntPage.all resolves on failure, so the page's own .catch()
  // stops firing. Without an explicit {error || partial} check the owner sees a confident
  // WRONG take-home and a tech sees pay that is quietly missing rows.
  [
    ['platform/owner.html', /Promise\.all\(\[\s*jobsP[\s\S]{0,1200}?\}\)\.catch/],
    ['platform/tech.html', /Promise\.all\(\[jobsP,invP,payP\][\s\S]{0,1200}?invByJob/]
  ].forEach(([p, blockRe]) => {
    const clean = stripComments(R(p));
    const m = clean.match(blockRe);
    ok(p + ': found the money Promise.all block', !!m);
    const block = m ? m[0] : '';
    const guard = block.match(/r\s*&&\s*\(\s*r\.error\s*\|\|\s*r\.partial\s*\)/);
    ok(p + ': checks BOTH r.error and r.partial on every result', !!guard);
    // Presence is not reachability -- a dead-guarded check reads identical to a live one.
    no(p + ': the check is not dead-guarded',
      /(false|0|null|undefined)\s*&&[\s\S]{0,80}r\.partial/.test(block));
    // THE RULE: decide whether the read is trustworthy BEFORE touching a single row.
    // Anything looser has no teeth -- a guard parked just above render() reads as "before
    // the total" while being semantically identical to the shipped code, so that assertion
    // could not fail. (It didn't: this mutation survived the first run.) Requiring the
    // refusal to precede the FIRST use of the results is strict, checkable, and real.
    const firstUse = block.search(/res\[\s*0\s*\]/);
    ok(p + ': it refuses BEFORE it touches a single row',
      guard && firstUse > -1 && firstUse > block.indexOf(guard[0]));
    ok(p + ': and returns instead of falling through', /\breturn;/.test(block));
    // It must say the numbers are missing, not show a zero that looks like a real answer.
    ok(p + ': it tells the human the number is missing, not a wrong total',
      /rather than a wrong total/i.test(block));
  });

  console.log('\nno raw over-the-cap read is left anywhere on the platform');
  // A .limit() bigger than the server cap is a silent lie: it reads as "everything" and
  // returns 1,000. ant-page.js itself is the pager, so it is the one file allowed to page.
  const pages = fs.readdirSync(path.join(root, 'platform')).filter(f => /\.html$/.test(f));
  let offenders = [];
  pages.forEach((f) => {
    const clean = stripComments(R('platform/' + f));
    const hits = clean.match(/\.limit\(\s*(1[0-9]{3,}|[2-9][0-9]{3,})\s*\)/g);
    if (hits) offenders.push(f + ' ' + hits.join(','));
  });
  eq('zero raw .limit(>=1000) reads across every platform page', offenders, []);

  console.log('\nevery page that pages loads the pager + busts its cache');
  // A page calling AntPage.all without the module throws; a STALE cached copy is the same
  // fatal. netlify.toml no-caches /*.html ONLY -- a shared .js stays on the phone.
  pages.forEach((f) => {
    const src = R('platform/' + f);
    if (!/AntPage\.all\(/.test(stripComments(src))) return;
    const tag = (src.match(/<script src="\/platform\/ant-page\.js([^"]*)"/) || [])[0];
    ok(f + ' loads ant-page.js', !!tag);
    ok(f + ' cache-busts it (?v=)', /\?v=/.test(tag || ''));
    // Shipped 2026-09-10 with no ?v= on any of the five pages -- latent until the day
    // ant-page.js changes, at which point every phone keeps the old pager and the money
    // pages go back to under-reading with nothing on screen to say so.
    ok(f + ' loads the pager BEFORE it calls it', src.indexOf(tag) < src.indexOf('AntPage.all('));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
