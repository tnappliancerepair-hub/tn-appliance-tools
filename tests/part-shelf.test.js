// part-shelf.test.js — the fourth disposition: 🏬 ON OUR SHELF (migration 073).
//
// Danielle, 2026-09-15: "Ok so do we need to return it. Its in storage. So use the valve for
// today's job." A part bought for a job that then died had nowhere to live -- not owed back,
// not used, not stock. Measured on TN when this shipped: 21 parts across 14 CANCELED jobs,
// every one a vendor part on a real claim, not one carrying a disposition.
//
// Every pure function here is REGEX-LIFTED OUT OF THE SHIPPED PAGE, and the mirror guard is the
// real exported function -- so a test can't drift from what the office actually taps.
const fs = require('fs');
const path = require('path');
const m = require('../netlify/functions/platform-tn-parts-migrate.js');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function lift(src, re, name) {
  const mm = src.match(re);
  if (!mm) { t('ANCHOR: could not lift ' + name + ' from the shipped file', false); return null; }
  // eslint-disable-next-line no-new-func
  return new Function(mm[0] + '; return ' + name + ';')();
}

const OFFICE = read('platform/office-board.html');
const RETURNS = read('platform/returns.html');
const TECH = read('platform/tech.html');
const TECHJOB = read('platform/tech-job.html');
const OWNER = read('platform/owner.html');
const ANT = read('netlify/functions/platform-ant.js');
const MIG073 = read('docs/sql/073_part_shelf.sql');

(async function () {

  console.log('\n-- the constraint actually allows it --');
  t("073 widens job_part_disposition_check to four values",
    /check \(disposition = any \(array\['used'::text, 'return'::text, 'not_here'::text, 'shelf'::text\]\)\)/i.test(MIG073));
  t("073 drops the old constraint first (re-runnable)",
    /drop constraint if exists job_part_disposition_check/i.test(MIG073));

  console.log('\n-- partOnThisJob: what bills on THIS job (lifted from office-board.html) --');
  const partOnThisJob = lift(OFFICE, /function partOnThisJob\(disp\)\{[\s\S]*?\n  \}/, 'partOnThisJob');
  if (partOnThisJob) {
    t("a used part is this job's", partOnThisJob('used') === true);
    t("an unmarked part is still this job's", partOnThisJob('') === true && partOnThisJob(null) === true);
    t('a returned part is NOT', partOnThisJob('return') === false);
    t('a never-arrived part is NOT', partOnThisJob('not_here') === false);
    t('a part we KEPT is NOT — it comes off the invoice', partOnThisJob('shelf') === false);
  }
  // The whole reason this predicate exists: three readers used to carry their own copy.
  t('office-board has exactly ONE definition of partOnThisJob',
    (OFFICE.match(/function partOnThisJob\(/g) || []).length === 1);
  t('all three office readers go through it',
    (OFFICE.match(/partOnThisJob\(/g) || []).length >= 4);

  console.log('\n-- the shelf is searchable (lifted from returns.html) --');
  const shelfMatch = lift(RETURNS, /function shelfMatch\(p, q\)\{[\s\S]*?\n  \}/, 'shelfMatch');
  if (shelfMatch) {
    const valve = { number: 'W11548535', name: 'Water inlet valve', source: 'Marcone' };
    t('empty search shows everything', shelfMatch(valve, '') === true && shelfMatch(valve, '  ') === true);
    t("finds it by the word she'd type", shelfMatch(valve, 'valve') === true);
    t('finds it by part number', shelfMatch(valve, 'W11548535') === true);
    t('case does not matter', shelfMatch(valve, 'VALVE') === true && shelfMatch(valve, 'w115') === true);
    t('finds it by parts house', shelfMatch(valve, 'marcone') === true);
    t('a miss is a miss', shelfMatch(valve, 'compressor') === false);
    t('survives a row with null fields', shelfMatch({ number: null, name: null, source: null }, 'x') === false);
  }

  console.log('\n-- the mirror can never erase the shelf (real exported guard) --');
  const KEYS = m._OFFICE_OWNED;
  function mkDb(rows) { global.fetch = async () => ({ ok: true, json: async () => rows }); return m._pf('https://x.test', 'k'); }
  const shelved = [{ xano_id: 'wp:1:A', number: 'A', name: 'Valve', source: 'Marcone', ship_to: null, eta: null, disposition: 'shelf', order_status: null, cost_cents: null, sell_cents: null }];

  let db = mkDb(shelved);
  let row = { company_id: 'c', job_id: 'j', xano_id: 'wp:1:A', number: 'A', name: null, source: null, order_status: null, disposition: 'used' };
  await db.keepTypedParts([row], KEYS);
  t("Xano saying 'used' cannot take a part off the shelf", row.disposition === 'shelf', row);

  db = mkDb(shelved);
  row = { company_id: 'c', job_id: 'j', xano_id: 'wp:1:A', number: 'A', name: null, source: null, order_status: null, disposition: null };
  await db.keepTypedParts([row], KEYS);
  t('a blank from Xano cannot either', row.disposition === 'shelf', row);

  // Narrow on purpose: this is NOT "the platform always outranks Xano" (still Teddy's call).
  db = mkDb([{ xano_id: 'wp:2:B', number: 'B', name: null, source: null, ship_to: null, eta: null, disposition: 'used', order_status: null, cost_cents: null, sell_cents: null }]);
  row = { company_id: 'c', job_id: 'j', xano_id: 'wp:2:B', number: 'B', name: null, source: null, order_status: null, disposition: 'return' };
  await db.keepTypedParts([row], KEYS);
  t('on any OTHER value Xano still wins — the rule stays narrow', row.disposition === 'return', row);

  db = mkDb(shelved);
  row = { company_id: 'c', job_id: 'j', xano_id: 'wp:1:A', number: null, name: null, source: null, order_status: null };
  await db.keepTypedParts([row], KEYS);
  t('a payload with no disposition key never GAINS one (PGRST102)', !('disposition' in row), Object.keys(row));

  console.log('\n-- every surface knows the word --');
  t('office picker offers it', /shelf: '🏬 On our shelf'/.test(OFFICE));
  t('office picker says the money consequence', /if \(v === 'shelf'\) return 'Comes OFF this invoice/.test(OFFICE));
  t("tech's day list reads it as at-the-shop, not on-order",
    /p\.disposition==='shelf'[\s\S]{0,120}On our shelf at the shop/.test(TECH));
  t('tech card leads with it, ahead of any route or tracking read',
    /if\(p\.disposition==='shelf'\)\{[\s\S]{0,200}On our shelf/.test(TECHJOB));
  t('tech card stops counting it as "not shipped yet"',
    /var onShelf=list\.filter/.test(TECHJOB) && /still=list\.length-sent\.length-pick\.length-onShelf\.length/.test(TECHJOB));
  // A part that DID ship and was later put on the shelf must not be subtracted twice.
  t('the shelf bucket is exclusive of "sent", like the pickup bucket',
    /var onShelf=list\.filter\(function\(p\)\{ return p\.disposition==='shelf' && !p\.ship_tracking && !p\.bought_at; \}\);/.test(TECHJOB));
  t('returns page asks the question on canceled jobs only',
    /\.eq\('job\.status','canceled'\)/.test(RETURNS) && /Nobody has said/.test(RETURNS));
  t('returns page offers all three answers',
    /data-disp="return"/.test(RETURNS) && /data-disp="shelf"/.test(RETURNS) && /data-disp="used"/.test(RETURNS));
  t('a refused write is never reported as saved',
    /if\(r\.error \|\| !r\.data \|\| !r\.data\.length\)[\s\S]{0,160}Did NOT save/.test(RETURNS));

  console.log('\n-- the dead-guard class stays dead --');
  // 'unused' and 'missing' have NEVER been allowed by job_part_disposition_check, so any code
  // testing for them was a guard that could not fire -- which is how a never-arrived part was
  // being counted as real parts cost in the P&L.
  const deadGuard = /disposition[\s\S]{0,120}?(===|==|=== )\s*'(unused|missing)'/;
  t("owner P&L no longer excludes values the DB can't hold", !deadGuard.test(OWNER));
  t('owner P&L excludes the three real ones',
    /d==='return'\|\|d==='not_here'\|\|d==='shelf'/.test(OWNER));
  t("platform-ant parts spend no longer names 'unused'/'missing'", !deadGuard.test(ANT));
  t('platform-ant excludes the three real ones',
    /disp === 'return' \|\| disp === 'not_here' \|\| disp === 'shelf'/.test(ANT));

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : '') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
