// office-new-job.test.js — THE DOOR A PHONE LEAD WALKS THROUGH.
//
// Teddy, 2026-09-15, handing over a photo of a Rocketbook page: "Cash job from google."
// The page read: LG · Fridge · 7 years · Ashland City. Measured before building anything:
//   - no cash lead from Ashland City anywhere on the board (every Ashland row is AHS/NSA)
//   - no google_ads_call, no callback_request, no lsa_lead_received in the last 4 days
//   - and platform/office-board.html had NO add-a-job button at all
// Every card on that board arrives from the Xano mirror, a warranty email, or a web form.
// A cash job that came in on the PHONE had nowhere to land, so it lived on paper.
//
// Danielle, the same morning, three times over, correcting herself twice to be precise:
//   "there is no place to add ppl in the new system. Until that is added i cant put any
//    new job in"  ...  "Working on 3 systems."
// She works the board, dispatch, needs-scheduled AND messages, and the call comes in
// wherever she happens to be standing -- so the sheet is ONE module mounted on all four,
// not four copies that drift.
//
// The two decisions worth pinning are REGEX-LIFTED OUT OF THE SHIPPED MODULE, so this test
// runs the rule the office actually gets and cannot drift from it.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const MOD   = read('platform/ant-new-job.js');
const WATCH = read('netlify/functions/platform-lead-watch.js');
const SURFACES = {
  'office-board':    read('platform/office-board.html'),
  'dispatch':        read('platform/dispatch.html'),
  'needs-scheduled': read('platform/needs-scheduled.html'),
  'messages':        read('platform/messages.html'),
};

// Lift the real functions out of the shipped module.
function lift(name) {
  const m = MOD.match(new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}\\n'));
  if (!m) throw new Error('could not lift ' + name + ' out of ant-new-job.js');
  return m[0];
}
const sandbox = {};
new Function('exports', lift('gate') + lift('phoneKey') +
  '\nexports.gate = gate; exports.phoneKey = phoneKey;')(sandbox);
const { gate, phoneKey } = sandbox;

console.log('\n— the gate: what is worth a card —');
t('a real lead passes', gate({ what: 'LG refrigerator', phone: '6155550142', name: 'Sarah Miller' }) === '');
t('name only is enough (an LSA chat lead has no phone)', gate({ what: 'LG refrigerator', name: 'Sarah Miller' }) === '');
t('phone only is enough (a caller who never gave a name)', gate({ what: 'LG refrigerator', phone: '6155550142' }) === '');
t('no appliance is refused', /appliance/i.test(gate({ phone: '6155550142', name: 'Sarah' })));
t('no phone AND no name is refused', /name or a phone/i.test(gate({ what: 'LG refrigerator' })));
t('whitespace is not a name', /name or a phone/i.test(gate({ what: 'LG refrigerator', name: '   ', phone: '  ' })));
t('whitespace is not an appliance', /appliance/i.test(gate({ what: '   ', phone: '6155550142' })));
t('missing input object does not throw', gate() !== '' && typeof gate() === 'string');

console.log('\n— the phone key: one human, one card —');
t('bare 10 digits', phoneKey('6155550142') === '6155550142');
t('formatted', phoneKey('(615) 555-0142') === '6155550142');
t('+1 E.164 (how the mirror stores it)', phoneKey('+16155550142') === '6155550142');
t('1-prefixed', phoneKey('1-615-555-0142') === '6155550142');
t('a 7-digit scrap is NOT a key — a partial suffix would match the wrong person',
  phoneKey('5550142') === '');
t('empty is empty', phoneKey('') === '' && phoneKey(null) === '' && phoneKey(undefined) === '');
t('letters alone are not a key', phoneKey('call me') === '');
// The two formats actually on this board must collapse to the SAME key, or Don Walz
// becomes two customers.
t('+1 form and bare form are the same human',
  phoneKey('+18124802845') === phoneKey('8124802845'));

console.log('\n— the safety net stays hooked up —');
// THE LOAD-BEARING ONE. platform-lead-watch pages the owner when a lead sits unanswered,
// and it filters on an ALLOWLIST of sources. A prettier source string here ('office_google')
// makes every typed lead invisible to that watcher -- silently. That is the exact trap
// cash-ready-notify fell into for three weeks.
t("the quick-add writes source:'manual'", /source:\s*'manual'/.test(MOD));
const allow = WATCH.match(/LEAD_SOURCES\s*=\s*new Set\(\[([^\]]*)\]/);
t('platform-lead-watch still has an allowlist', !!allow);
t("'manual' is ON that allowlist — the typed lead is watched", !!allow && /'manual'/.test(allow[1]), allow && allow[1]);
// .every() on an EMPTY array returns true -- so require at least one match, or this
// assertion passes vacuously the day someone deletes the source line entirely.
const modSources = MOD.match(/source:\s*'[^']+'/g) || [];
t('no other source string sneaks into the module',
  modSources.length === 1 && /^source:\s*'manual'$/.test(modSources[0]), modSources);

console.log('\n— it writes the same shape Ann writes —');
['customer', 'unit', 'job', 'thread_message', 'portal_grant'].forEach(function (tbl) {
  t('inserts into ' + tbl, new RegExp("from\\('" + tbl + "'\\)[\\s\\S]{0,140}insert").test(MOD));
});
t('the job lands in New', /status:\s*'new'/.test(MOD));
t('the unit is trade-aware (vehicle for an automotive shop)', /automotive[\s\S]{0,40}vehicle/.test(MOD));

console.log('\n— a write is only saved when a row comes back —');
// The standing rule: an RLS-blocked write returns ZERO rows and NO error, so `if(r.error)`
// is false and it reads as success. Every insert that MATTERS must prove a row returned.
['customer', 'unit', 'job'].forEach(function (tbl) {
  const seg = MOD.match(new RegExp("sb\\.from\\('" + tbl + "'\\)[\\s\\S]{0,380}"));
  t(tbl + ' insert asks for the row back', !!seg && /\.select\('id'\)/.test(seg[0]));
  t(tbl + ' insert fails loudly when no row comes back',
    !!seg && /if\s*\(\s*\w+\.error\s*\|\|\s*!\w+\.data\s*\|\|\s*!\w+\.data\.length\s*\)\s*return fail\(/.test(seg[0]));
});
t('the trailers (thread/event/portal) are best-effort and never block the job',
  (MOD.match(/try\s*\{\s*sb\.from\('(thread_message|event|portal_grant)'\)/g) || []).length === 3,
  (MOD.match(/try\s*\{\s*sb\.from\('(thread_message|event|portal_grant)'\)/g) || []));

console.log('\n— one definition, not four copies —');
// Danielle works four surfaces. The sheet lives in ONE file; each page loads it and calls
// open(). If any page ever grows its own copy of the insert chain, this fails on purpose.
Object.keys(SURFACES).forEach(function (name) {
  const S = SURFACES[name];
  t(name + ' loads the shared module', /src="\/platform\/ant-new-job\.js"/.test(S));
  t(name + ' carries a ＋ New job button', /id="newjob"[^>]*>＋ New job/.test(S));
  t(name + ' opens the shared sheet', /AntNewJob\.open\(/.test(S));
  // the giveaway that somebody pasted the chain back into a page instead of calling open()
  t(name + ' does not keep its own copy of the insert chain',
    !/from\('portal_grant'\)[\s\S]{0,60}insert/.test(S));
});
t('the module is the only place the sheet is built',
  (MOD.match(/anj-sheet/g) || []).length > 0 &&
  Object.keys(SURFACES).every(function (k) { return !/anj-sheet/.test(SURFACES[k]); }));

console.log('\n— the office can find it —');
t('where it came from is recorded on the thread line', /Lead from ' \+ chan/.test(MOD));
t('and on an audit event with who took it',
  /office_lead_created[\s\S]{0,160}channel:\s*chan[\s\S]{0,60}by:\s*who/.test(MOD));
t('the person is resolved from app_user, never asked of the page', /from\('app_user'\)/.test(MOD));
t("a slow name lookup cannot block the write (defaults to 'Office')", /\|\|\s*'Office'/.test(MOD));

console.log('\n— nothing here can text a customer —');
// A typed lead must never fire an outbound message on its own. The office decides.
t('the quick-add sends no SMS', !/sendSms|send_sms|platform-tech-notify/i.test(MOD));
t('the thread line is recorded inbound, not sent outbound',
  /direction:\s*'in'/.test(MOD) && !/direction:\s*'out'/.test(MOD));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
