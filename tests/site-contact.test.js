// "Is there any way to add a tenant to a order so I can call them ahead of time to see if
// parts arrived" -- a tech, 2026-09-17, texted from the road 21 minutes out from a stop.
//
// He is right and there was nowhere to put it. The platform carries exactly ONE phone per
// customer. On a rental the account is the landlord; the person who signs for the part and
// opens the door is the TENANT. Measured on TN's own board before building it: 11 jobs ever
// have a second phone buried in free text, and 6 of those 11 are a DIFFERENT number than
// the one on file. Small -- and every one is a truck roll riding on a call the tech cannot
// place from the app.
//
// TWO THINGS THIS TEST EXISTS TO PIN:
//
//   1. THE TWO COPIES STAY BYTE-IDENTICAL. siteCallHtml is defined LOCALLY on each tech
//      surface rather than in a shared .js -- same reasoning as oneTdr(): a shared module
//      that fails to load white-screens the tech app, and this is one small pure function.
//      The shipped comment PROMISES a test pins them. This is that test. Three copies of
//      the route picker drifted into three vocabularies; two copies of this will not.
//
//   2. NOTHING AUTOMATED EVER TEXTS IT. This is a NUMBER TO CALL. We have no consent from
//      this person and they are not the account holder. The migration says so in words;
//      words do not enforce. The allowlist below does: every place in the repo that names
//      site_contact_phone must be a place we chose, or this fails.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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

function liftFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('could not find function ' + name);
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error('unbalanced ' + name);
  return src.slice(at, end);
}

const DAY = R('platform/tech.html');        // the tech's day list
const JOB = R('platform/tech-job.html');    // the tech's job page
const BOARD = R('platform/office-board.html');
const SQL = R('docs/sql/078_site_contact.sql');

// ── 1. THE PROMISE IN THE CODE COMMENT ─────────────────────────────────────
console.log('\n-- two copies, one function --');

const dayFn = liftFn(DAY, 'siteCallHtml');
const jobFn = liftFn(JOB, 'siteCallHtml');
eq('the two siteCallHtml copies are byte-identical', dayFn === jobFn, true);
ok('both pages carry the "pinned byte-identical by a test" promise',
  /pinned byte-identical by a test/.test(DAY) && /pinned byte-identical by a test/.test(JOB));

// Each page's own esc() is what the lifted function calls. Lift THAT too, from the same
// file -- if a page ever stopped escaping, the copy from that page must be the one that
// fails, not a borrowed one.
function envFor(src) {
  return new Function([liftFn(src, 'esc'), liftFn(src, 'siteCallHtml'),
    'return siteCallHtml;'].join('\n'))();
}
const dayCall = envFor(DAY);
const jobCall = envFor(JOB);

// ── 2. WHAT THE TECH ACTUALLY GETS ─────────────────────────────────────────
console.log('\n-- the link itself --');

const TENANT = { id: 'j1', site_contact_name: 'Maria (tenant)', site_contact_phone: '(615) 555-0142' };
const html = dayCall(TENANT);
ok('a job with a second contact renders a tappable link', /^<a /.test(html));
ok('it dials the digits, not the punctuation the office typed', html.includes('href="tel:6155550142"'));
ok("the tech sees WHO he is calling before he taps", html.includes('Maria (tenant)'));
ok('it routes through the shop line like every other call on the page', html.includes('class="antcall"'));
ok('the job rides along so the call is logged against it', html.includes('data-job="j1"'));
eq('the job page renders the identical link', jobCall(TENANT), html);

// The quiet case is the common one: most jobs have no second contact and must look exactly
// as they did yesterday. A stray empty <a> on every card is its own bug.
eq('no second contact -> nothing rendered at all', dayCall({ id: 'j2' }), '');
eq('a name with no phone renders nothing -- there is nothing to dial',
  dayCall({ id: 'j3', site_contact_name: 'Maria' }), '');
eq('whitespace is not a phone number', dayCall({ id: 'j4', site_contact_phone: '   ' }), '');
eq('a phone of pure punctuation is not a phone number',
  dayCall({ id: 'j5', site_contact_phone: '()- ' }), '');
eq('null job -> nothing, never a throw', dayCall(null), '');

// The office types this by hand, into a free-text box, on a phone.
ok('a +1 prefix survives the strip',
  dayCall({ id: 'j6', site_contact_phone: '+1 615 555 0142' }).includes('href="tel:+16155550142"'));
ok('a name-only blank falls back to something the tech can read',
  dayCall({ id: 'j7', site_contact_phone: '6155550142' }).includes('Also at this address'));
no('the fallback never renders an empty label',
  />\s*📞\s*<\/a>/.test(dayCall({ id: 'j8', site_contact_phone: '6155550142' })));
ok('a name with a quote cannot break out of the attribute',
  !dayCall({ id: 'j9', site_contact_name: 'Bob "Buddy"', site_contact_phone: '6155550142' })
    .includes('data-name="Bob "Buddy""'));
no('a name with a tag cannot inject markup',
  dayCall({ id: 'j10', site_contact_name: '<script>x</script>', site_contact_phone: '6155550142' })
    .includes('<script>'));

// ── 3. THE TIERED-SELECT TRAP ──────────────────────────────────────────────
// A field the query never asks for makes a feature structurally dead while it looks wired.
// This bit the dispatch board (technician2_id) and the day list (ship_tracking) already.
console.log('\n-- every surface actually ASKS for the columns --');

const daySel = (DAY.match(/'id,status,problem,scheduled_day[^\n]*/) || [''])[0];
ok("the day list select carries the name", daySel.includes('site_contact_name'));
ok("the day list select carries the phone", daySel.includes('site_contact_phone'));

const jobSel = (JOB.match(/var base = '[^\n]*/) || [''])[0];
ok("the job page select carries the name", jobSel.includes('site_contact_name'));
ok("the job page select carries the phone", jobSel.includes('site_contact_phone'));

const richSel = (BOARD.match(/var SEL_BASE_RICH = [^\n]*/) || [''])[0];
ok('the board tier that opens the drawer carries the name', richSel.includes('site_contact_name'));
ok('the board tier that opens the drawer carries the phone', richSel.includes('site_contact_phone'));

const drawerSel = (BOARD.match(/sb\.from\('job'\)\.select\('id,problem,availability[^\n]*/) || [''])[0];
ok("the drawer's own read carries the name", drawerSel.includes('site_contact_name'));
ok("the drawer's own read carries the phone", drawerSel.includes('site_contact_phone'));

// ── 4. SOMEBODY CAN ACTUALLY TYPE IT ───────────────────────────────────────
// Two doors on purpose: the office puts it on when the claim comes in with a tenant, and
// the tech adds it standing in the driveway when the customer hands him a second number.
console.log('\n-- two ways in, both of which SAVE --');

ok('the office drawer has the two inputs', /d_scname/.test(BOARD) && /d_scphone/.test(BOARD));
// The office handler is an onclick, not a named function -- anchor on the wiring line.
const dAt = BOARD.indexOf("getElementById('d_save').onclick");
ok('the office Save handler is wired', dAt > 0);
const dSave = BOARD.slice(dAt, dAt + 2600);
ok("the office's Save writes the name", /site_contact_name\s*:\s*gv\('d_scname'\)/.test(dSave));
ok("the office's Save writes the phone", /site_contact_phone\s*:\s*gv\('d_scphone'\)/.test(dSave));

ok('the tech job-details editor has the two inputs', /jd_scname/.test(JOB) && /jd_scphone/.test(JOB));
const jdSave = (JOB.match(/sb\.from\('job'\)\.update\(\{problem:gv\('jd_prob'\)[^\n]*/) || [''])[0];
ok("the tech's own edit writes the name", jdSave.includes("site_contact_name:gv('jd_scname')"));
ok("the tech's own edit writes the phone", jdSave.includes("site_contact_phone:gv('jd_scphone')"));

ok('the day-list card actually calls the renderer', /links \+= siteCallHtml\(j\)/.test(DAY));
ok('the job-page header actually calls the renderer', /\+siteCallHtml\(job\)\+/.test(JOB));

// ── 5. THE RULE WITH TEETH: NOBODY TEXTS THIS NUMBER ───────────────────────
// The migration says it in words. Words do not enforce. Every occurrence of the column
// anywhere in the repo has to be a place we chose -- so the day this leaks into a send
// path, notify helper, or colony agent, this line goes red instead of a stranger getting
// a text from a shop they never hired.
console.log('\n-- it is a number to call, never a messaging identity --');

const hits = execSync(
  "grep -rln 'site_contact_name\\|site_contact_phone' --include='*.js' --include='*.html' " +
  "--include='*.sql' --include='*.xs' --include='*.json' . " +
  "| grep -v '^./node_modules' | grep -v '^./tests/' | sed 's|^\\./||' | sort",
  { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);

// NOTE: table/jobs.xs carries a legacy `on_site_contact_id` -- an int FK from the Xano era,
// a different thing entirely. Matching on the exact column names keeps it out of this set.
eq('the columns exist in exactly the four places we put them', hits, [
  'docs/sql/078_site_contact.sql',
  'platform/office-board.html',
  'platform/tech-job.html',
  'platform/tech.html'
]);

const SENDERS = ['netlify/functions', 'colony-loop'];
SENDERS.forEach(function (dir) {
  const leaked = hits.filter((f) => f.indexOf(dir + '/') === 0);
  eq('nothing under ' + dir + ' has ever heard of this number', leaked, []);
});

// And on the pages that DO know it, every mention has to be a SHAPE we chose. This is the
// assertion with teeth. The first cut of it only asked whether a line that names the phone
// ALSO names a sender -- and a mutation walked straight past it by putting
// `var _sc = j && j.site_contact_phone` on the line ABOVE the fetch. Same family as the
// dead-guard trap: a same-line check is not a reachability check. So instead: classify
// every line that names the columns, and fail on anything that is not one of the four
// shapes this feature is made of. A stray read anywhere near a send path has no shape and
// goes red on sight.
const SHAPES = [
  [/,site_contact_name,site_contact_phone,/, 'select'],
  [/String\(\(j && j\.site_contact_(name|phone)\) \|\| ''\)/, 'read'],
  [/di\('(d|jd)_sc(name|phone)'/, 'input'],
  [/site_contact_(name|phone)\s*:\s*gv\('(d|jd)_sc(name|phone)'\)/, 'save']
];
[['tech.html', DAY], ['tech-job.html', JOB], ['office-board.html', BOARD]].forEach(function (pair) {
  const stray = pair[1].split('\n')
    .filter((l) => /site_contact_name|site_contact_phone/.test(l))
    .filter((l) => !SHAPES.some((sh) => sh[0].test(l)))
    .map((l) => l.trim().slice(0, 90));
  eq(pair[0] + ': every mention is a shape we chose -- select, read, input or save', stray, []);
});

// Belt and suspenders, and it names the actual risk out loud: every text on both tech
// surfaces goes through platform-tech-notify, which resolves the phone SERVER-side off the
// customer row. The browser never hands a number to a sender, and this number never rides
// along on a line that does.
[['tech.html', DAY], ['tech-job.html', JOB]].forEach(function (pair) {
  const lines = pair[1].split('\n').filter((l) => /site_contact_phone/.test(l));
  ok(pair[0] + ': the phone is never named on a line that sends anything',
    lines.every((l) => !/platform-tech-notify|sendSms|send-pay-link|human-line-send|do=message|do=waiver_link|do=review/.test(l)));
});

// ── 6. THE MIGRATION SAYS WHY ──────────────────────────────────────────────
console.log('\n-- the record of the decision --');
ok('078 adds both columns', /site_contact_name\s+text/.test(SQL) && /site_contact_phone\s+text/.test(SQL));
ok('078 is re-runnable', (SQL.match(/add column if not exists/g) || []).length === 2);
ok('078 quotes the tech who asked for it', /call them\s+(?:--\s+)?ahead of time/.test(SQL));
ok('078 records the never-text rule in the schema itself', /Never auto-texted/.test(SQL));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
