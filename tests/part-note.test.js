// part-note.test.js — THE PER-PART CONVERSATION between the office and the tech (074).
//
// Teddy, 2026-09-15: "they need to be able to mark where those parts are so the tech knows
// where they're at. They need to be able to communicate back and forth on that... And if the
// tech doesn't need that, they need to be able to communicate back to the office. Like, hey,
// I didn't need this part. I need to return it. Or, hey, I used the part. The job's complete.
// Or, hey, I used this part, but I didn't need that part."
//
// MEASURED BEFORE BUILDING, on TN's live board: 1,194 parts across 466 open jobs.
//   ship_to (where the part IS) set on 25.  eta set on 5.
//   Of 495 'used' marks, THREE came from a tech -- the other 492 are the Xano mirror.
// Nobody uses a button that has no effect, and the tech's tap had none: it wrote a column and
// told nobody. Jimmy tapped ❌ Not here on BOTH dryer thermostats for Bailey Pope (SquareTrade
// 007984184139) on 9/11; the office tile HID the parts (the invoice rule ran on the attention
// surface) and returns.html reads 'return' OR must_return, so they surfaced nowhere at all.
//
// The module is the real file. The tile's attention counting is REGEX-LIFTED OUT OF THE
// SHIPPED PAGE so this test cannot drift from what Danielle actually sees.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Load the shipped module exactly as a browser would.
const root = {};
new Function('window', read('platform/ant-part-note.js') + '\n//# sourceURL=ant-part-note.js')(root);
const N = root.AntPartNote;

const OFFICE  = read('platform/office-board.html');
const TECHJOB = read('platform/tech-job.html');
const TECH    = read('platform/tech.html');
const MIGRATE = read('netlify/functions/platform-tn-parts-migrate.js');
const SPSYNC  = read('netlify/functions/platform-sp-parts-sync.js');

console.log('\n— the sentence a tap writes —');
t('✅ Used says it plainly', /used it/i.test(N.sentenceFor('used')), N.sentenceFor('used'));
t("↩️ Return says he didn't need it", /didn.t need/i.test(N.sentenceFor('return')));
t('❌ Not here says it never showed up', /never showed up/i.test(N.sentenceFor('not_here')));
t('🏬 Shelf says we kept it', /shelf/i.test(N.sentenceFor('shelf')));
t('un-tapping says the part is still open', /still open/i.test(N.sentenceFor('cleared')));
t('an unknown action writes NOTHING (never an empty signed line)', N.sentenceFor('zzz') === '');

console.log('\n— what the office\'s change says —');
t('route + parts house + ETA all land in one line',
  /Marcone/.test(N.routeSentence('Pickup — parts house', 'Marcone', '2026-09-18')) &&
  /Sep 18/.test(N.routeSentence('Pickup — parts house', 'Marcone', '2026-09-18')));
t('a route with nothing set says nothing', N.routeSentence('', '', '') === '');
t('ETA alone is still worth saying', /Sep 18/.test(N.routeSentence('', '', '2026-09-18')));
t('a route we did not mint is shown verbatim, not swallowed',
  /Back of the van/.test(N.routeSentence('Back of the van', '', '')));

console.log('\n— APPEND, NEVER REPLACE (the rule office_notes earned the hard way) —');
const hers = N.append('', 'Ordered from Marcone, ETA Thursday.', 'Danielle');
t('first line carries who said it', /Danielle/.test(hers) && /Marcone/.test(hers));
const both = N.append(hers, "Didn't need it — sending it back.", 'Jimmy');
t('HER line survives HIS reply', /Marcone/.test(both) && /sending it back/i.test(both));
t('his line comes after hers', both.indexOf('Marcone') < both.indexOf('sending it back'));
t('blank text can never append an empty signed line', N.append(hers, '   ', 'Jimmy') === hers);
t('appending to a null note works', /Jimmy/.test(N.append(null, 'hi', 'Jimmy')));

console.log('\n— the patch each side writes —');
const p1 = N.patch('', 'Used it.', 'Jimmy', 'tech');
t("tech's patch is stamped role=tech", p1.note_role === 'tech');
t("tech's patch records who", p1.note_by === 'Jimmy');
t('patch carries a timestamp', !!p1.note_at && !isNaN(new Date(p1.note_at)));
t('an unknown role can never be stored (the CHECK only allows office|tech)',
  N.patch('', 'x', 'Q', 'customer').note_role === 'office');

console.log('\n— WHO IS WAITING ON WHOM (the whole unread signal) —');
t('tech spoke last → the office owes an answer', N.techSpokeLast({ note: 'x', note_role: 'tech' }));
t('office spoke last → his card lights up', N.officeSpokeLast({ note: 'x', note_role: 'office' }));
t('a role with NO note is not a message', !N.techSpokeLast({ note: '', note_role: 'tech' }));
t('answering takes the ball back (role flips, chip moves)',
  N.officeSpokeLast({ note: 'a\n\nb', note_role: 'office' }) && !N.techSpokeLast({ note: 'a\n\nb', note_role: 'office' }));
t('a part nobody has spoken about lights up neither side',
  !N.techSpokeLast({}) && !N.officeSpokeLast({}));

console.log('\n— the missing part is the loudest thing on the board —');
t("'never came' is flagged", N.isMissing({ disposition: 'not_here' }));
t('a used part is not a missing part', !N.isMissing({ disposition: 'used' }));
t('a returned part is not a missing part', !N.isMissing({ disposition: 'return' }));

console.log('\n— THE VANISHING ACT, lifted out of the shipped board —');
// partOnThisJob is a MONEY rule. The bug was running it on the office's ATTENTION surface,
// which made a tech's "❌ Not here" delete itself from the tile. These two assertions are the
// regression: the money rule still excludes it, and the tile still counts it.
const mm = OFFICE.match(/function partOnThisJob\(disp\)\s*\{[\s\S]*?\n  \}/);
t('ANCHOR: partOnThisJob still lifts out of office-board.html', !!mm);
if (mm) {
  const partOnThisJob = new Function(mm[0] + '; return partOnThisJob;')();
  t('MONEY: a never-arrived part is still off the invoice', partOnThisJob('not_here') === false);
  t('MONEY: a returned part is still off the invoice', partOnThisJob('return') === false);
  t('MONEY: a kept part is still off the invoice', partOnThisJob('shelf') === false);
  t('MONEY: a used part is still billed', partOnThisJob('used') === true);
}
t('ATTENTION: the tile counts missing parts BEFORE the invoice rule runs',
  /isMissing\(p\)\)\s*att\.missing\+\+[\s\S]{0,200}?if \(!partOnThisJob/.test(OFFICE));
t('ATTENTION: the tile counts tech-spoke parts BEFORE the invoice rule runs',
  /techSpokeLast\(p\)\)\s*att\.techsaid\+\+[\s\S]{0,120}?if \(!partOnThisJob/.test(OFFICE));
t('the board shows a NEVER CAME chip', /NEVER CAME/.test(OFFICE));
t('the board shows a TECH ON PARTS chip', /TECH ON PARTS/.test(OFFICE));

console.log('\n— both sides read and write the SAME columns —');
for (const [name, src] of [['office-board', OFFICE], ['tech-job', TECHJOB], ['tech day list', TECH]]) {
  t(name + ' loads the one note module', /ant-part-note\.js/.test(src));
  t(name + ' asks for note_role (without it there is no unread signal)', /note_role/.test(src));
}
t('office drawer selects the note body', /note,note_at,note_by,note_role/.test(OFFICE));
t('tech job selects the note body', /note,note_at,note_by,note_role/.test(TECHJOB));
t('the board TILE selects note_role (the chip needs it)', /bought_at,note,note_role/.test(OFFICE));

console.log('\n— one tap is the message —');
t("the tech's disposition tap writes a sentence", /partDisp[\s\S]{0,900}?AntPartNote\.sentenceFor/.test(TECHJOB));
t("the tech's tap re-reads the note live before appending", /partDisp[\s\S]{0,900}?select\('note'\)/.test(TECHJOB));
t('the tech has a per-part send button', /data-pact="note"/.test(TECHJOB));
t("the office's route change writes a sentence", /routeSentence\(patch\.ship_to, patch\.source, patch\.eta\)/.test(OFFICE));
t('the office only speaks when something actually MOVED (retyping a name stays silent)',
  /var moved = \(patch\.ship_to\|\|''\)!==was\.ship_to/.test(OFFICE));
t('the office has a per-part send button', /tp_notesend/.test(OFFICE));

console.log('\n— the note has a real author —');
// Caught before shipping: the first cut attributed the office's line with `(me&&me.name)`,
// but office-board.html has NO `me` -- it only ever loaded the company. `me &&` does NOT
// guard an UNDECLARED identifier (that is a ReferenceError, not undefined), so every office
// note would have thrown. Three people work this board; "the office said it" is not good
// enough when a tech is deciding whether to trust an ETA.
t('office-board resolves who is signed in', /from\('app_user'\)[\s\S]{0,200}?auth_user_id/.test(OFFICE));
t('office-board has a whoAmI that defaults to Office', /function whoAmI\(\)\s*\{\s*return officeName \|\| 'Office'/.test(OFFICE));
t('the office writes its notes as whoAmI(), never an undeclared `me`',
  /AntPartNote\.patch\([^)]*whoAmI\(\)/.test(OFFICE));
t('office-board never dereferences a `me` it does not declare', !/[^A-Za-z_.$]me\./.test(OFFICE));

console.log('\n— a write is only saved when a ROW COMES BACK —');
t('tech tap checks for a returned row', /partDisp[\s\S]{0,1400}?Array\.isArray\(r\.data\)/.test(TECHJOB));
t('tech per-part note checks for a returned row', /partNoteSend[\s\S]{0,1200}?Array\.isArray\(r\.data\)/.test(TECHJOB));
t('office per-part note checks for a returned row', /tp_notesend[\s\S]{0,900}?!res\.data\.length/.test(OFFICE));

console.log('\n— nothing else may erase what a human said —');
t('the mirror guard names every note column', ["'note'", "'note_at'", "'note_by'", "'note_role'"]
  .every((k) => new RegExp('OFFICE_OWNED[^;]*' + k).test(MIGRATE)));
t('the vendor sync is forbidden from touching the note', /never touches[\s\S]{0,260}note/i.test(SPSYNC));
t('the vendor sync writes no note field at all', !/\bnote\s*:/.test(SPSYNC.replace(/\/\/.*$/gm, '')));

console.log('\n— the customer must NEVER see this —');
// portal_get is an allowlist and job_part.note is not on it (verified live against the
// deployed function: its only 'note' is schedule_offer.note). This is the standing-rule
// sentinel so a future hand can't quietly add it to the customer's payload.
const PORTAL = read('platform/portal.html');
t('the customer portal never loads the note module', !/ant-part-note\.js/.test(PORTAL));
t('the customer portal never renders a part note', !/AntPartNote/.test(PORTAL));
t('the customer portal never reads job_part directly (parts come from the allowlisted RPC)',
  !/from\(['"]job_part['"]\)/.test(PORTAL));
t('no portal-facing file names a note column', !/note_role|note_by/.test(PORTAL));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
