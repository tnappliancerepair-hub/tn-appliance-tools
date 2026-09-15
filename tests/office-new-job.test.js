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
// The two decisions worth pinning are REGEX-LIFTED OUT OF THE SHIPPED PAGE, so this test
// runs the rule the office actually gets and cannot drift from it.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const OFFICE = read('platform/office-board.html');
const WATCH  = read('netlify/functions/platform-lead-watch.js');

// Lift the real functions out of the shipped page.
function lift(name) {
  const m = OFFICE.match(new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}\\n'));
  if (!m) throw new Error('could not lift ' + name + ' out of office-board.html');
  return m[0];
}
const sandbox = {};
new Function('exports', lift('newJobGate') + lift('leadPhoneKey') +
  '\nexports.newJobGate = newJobGate; exports.leadPhoneKey = leadPhoneKey;')(sandbox);
const { newJobGate, leadPhoneKey } = sandbox;

console.log('\n— the gate: what is worth a card —');
t('a real lead passes', newJobGate({ what: 'LG refrigerator', phone: '6155550142', name: 'Sarah Miller' }) === '');
t('name only is enough (an LSA chat lead has no phone)', newJobGate({ what: 'LG refrigerator', name: 'Sarah Miller' }) === '');
t('phone only is enough (a caller who never gave a name)', newJobGate({ what: 'LG refrigerator', phone: '6155550142' }) === '');
t('no appliance is refused', /appliance/i.test(newJobGate({ phone: '6155550142', name: 'Sarah' })));
t('no phone AND no name is refused', /name or a phone/i.test(newJobGate({ what: 'LG refrigerator' })));
t('whitespace is not a name', /name or a phone/i.test(newJobGate({ what: 'LG refrigerator', name: '   ', phone: '  ' })));
t('whitespace is not an appliance', /appliance/i.test(newJobGate({ what: '   ', phone: '6155550142' })));
t('missing input object does not throw', newJobGate() !== '' && typeof newJobGate() === 'string');

console.log('\n— the phone key: one human, one card —');
t('bare 10 digits', leadPhoneKey('6155550142') === '6155550142');
t('formatted', leadPhoneKey('(615) 555-0142') === '6155550142');
t('+1 E.164 (how the mirror stores it)', leadPhoneKey('+16155550142') === '6155550142');
t('1-prefixed', leadPhoneKey('1-615-555-0142') === '6155550142');
t('a 7-digit scrap is NOT a key — a partial suffix would match the wrong person',
  leadPhoneKey('5550142') === '');
t('empty is empty', leadPhoneKey('') === '' && leadPhoneKey(null) === '' && leadPhoneKey(undefined) === '');
t('letters alone are not a key', leadPhoneKey('call me') === '');
// The two formats actually on this board must collapse to the SAME key, or Don Walz
// becomes two customers.
t('+1 form and bare form are the same human',
  leadPhoneKey('+18124802845') === leadPhoneKey('8124802845'));

console.log('\n— the safety net stays hooked up —');
// THE LOAD-BEARING ONE. platform-lead-watch pages the owner when a lead sits unanswered,
// and it filters on an ALLOWLIST of sources. A prettier source string here ('office_google')
// makes every typed lead invisible to that watcher -- silently. That is the exact trap
// cash-ready-notify fell into for three weeks.
const mSrc = OFFICE.match(/source:\s*'manual'/);
t("the quick-add writes source:'manual'", !!mSrc);
const allow = WATCH.match(/LEAD_SOURCES\s*=\s*new Set\(\[([^\]]*)\]/);
t('platform-lead-watch still has an allowlist', !!allow);
t("'manual' is ON that allowlist — the typed lead is watched", !!allow && /'manual'/.test(allow[1]), allow && allow[1]);
// .every() on an EMPTY array returns true -- so require at least one match, or this
// assertion passes vacuously the day someone deletes the source line entirely.
const njSources = OFFICE.match(/function openNewJob\(\)[\s\S]*?\n  \}\n/)[0].match(/source:\s*'[^']+'/g) || [];
t('no other source string sneaks into the quick-add',
  njSources.length === 1 && /^source:\s*'manual'$/.test(njSources[0]),
  (OFFICE.match(/function openNewJob\(\)[\s\S]*?\n  \}\n/)[0].match(/source:\s*'[^']+'/g) || []));

console.log('\n— it writes the same shape Ann writes —');
const NJ = OFFICE.match(/function openNewJob\(\)[\s\S]*?\n  \}\n/)[0];
['customer', 'unit', 'job', 'thread_message', 'portal_grant'].forEach(function (tbl) {
  t('inserts into ' + tbl, new RegExp("from\\('" + tbl + "'\\)[\\s\\S]{0,120}insert").test(NJ));
});
t('the job lands in New', /status:\s*'new'/.test(NJ));
t('the unit is trade-aware (vehicle for an automotive shop)', /automotive[\s\S]{0,30}vehicle/.test(NJ));

console.log('\n— a write is only saved when a row comes back —');
// The standing rule: an RLS-blocked write returns ZERO rows and NO error, so `if(r.error)`
// is false and it reads as success. Every insert that MATTERS must prove a row returned.
['customer', 'unit', 'job'].forEach(function (tbl) {
  // the insert call plus the line right after it -- where the row check has to live
  const seg = NJ.match(new RegExp("sb\\.from\\('" + tbl + "'\\)\\.insert[\\s\\S]{0,320}"));
  t(tbl + ' insert asks for the row back', !!seg && /\.select\('id'\)/.test(seg[0]));
  t(tbl + ' insert fails loudly when no row comes back',
    !!seg && /if\(\w+\.error\|\|!\w+\.data\|\|!\w+\.data\.length\)\s*return fail\(/.test(seg[0]));
});
t('the trailers (thread/event/portal) are best-effort and never block the job',
  (NJ.match(/try\{\s*sb\.from\('(thread_message|event|portal_grant)'\)/g) || []).length === 3,
  (NJ.match(/try\{\s*sb\.from\('(thread_message|event|portal_grant)'\)/g) || []));

console.log('\n— the office can find it —');
t('the header carries a ＋ New job button', /id="newjob"[^>]*>＋ New job/.test(OFFICE));
t('it is wired to openNewJob', /getElementById\('newjob'\)[\s\S]{0,60}openNewJob/.test(OFFICE));
t('where it came from is recorded on the thread line', /Lead from '\+chan/.test(NJ));
t('and on an audit event with who took it', /office_lead_created[\s\S]{0,140}channel:\s*chan[\s\S]{0,60}by:\s*whoAmI\(\)/.test(NJ));

console.log('\n— nothing here can text a customer —');
// A typed lead must never fire an outbound message on its own. The office decides.
t('the quick-add sends no SMS', !/sendSms|send_sms|platform-tech-notify|sms/i.test(NJ));
t('the thread line is recorded inbound, not sent outbound', /direction:\s*'in'/.test(NJ) && !/direction:\s*'out'/.test(NJ));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
