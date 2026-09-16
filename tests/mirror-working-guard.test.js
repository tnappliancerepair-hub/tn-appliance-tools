// A job booked for a visit that has not happened yet must never read Complete.
//
// Jimmy, 2026-09-16: "This job shows Complete, only thing I did was hit on the way. Haven't even
// been to the job." The tap did not complete it. Xano job 21941 was closed for VISIT ONE on
// 09-10 18:39:57Z (event_log office_set_job_status, actor tech, from in_progress) with no
// timestamp; parts were ordered; the office booked the return trip HERE for 09-16; and the
// mirror carried that six-day-old completion back down every 5 minutes onto a visit nobody had
// made. He opened his stop and it already said Complete.
//
// Every rule below is LIFTED OUT OF THE SHIPPED MIRROR and executed, so this file cannot drift
// from the code that actually runs. The lift is anchored on the block's stable comment header,
// never on the condition -- anchoring on the condition means every mutation breaks the LIFT and
// reads as "the test file crashed" instead of "the guard stopped working."
const assert = require('assert');
const fs = require('fs');

const SRC = fs.readFileSync(__dirname + '/../netlify/functions/platform-tn-mirror.js', 'utf8');

const RANK_SRC  = (SRC.match(/const RANK = \{[^}]*\};/) || [])[0];
const CLOCK_SRC = (SRC.match(/const CT_DAY = new Intl\.DateTimeFormat[\s\S]*?const isTodayCT = [^\n]*\n/) || [])[0];
const HELD_SRC  = (SRC.match(/const wasDone = [\s\S]*?\n {6}\}\n/) || [])[0];
const GUARD_SRC = (SRC.match(/A JOB BOOKED FOR TODAY OR LATER IS NOT A FINISHED JOB[\s\S]*?\n( {6}const bookDay[\s\S]*?\n {6}\}\n)/) || [])[1];

assert.ok(RANK_SRC,  'could not lift RANK from the mirror');
assert.ok(CLOCK_SRC, 'could not lift the CT clock helpers from the mirror');
assert.ok(HELD_SRC,  'could not lift the never-walk-backwards block from the mirror');
assert.ok(GUARD_SRC, 'could not lift the booked-ahead guard from the mirror');

// Run the real blocks in order, exactly as the mirror runs them inside its per-job loop.
const applyGuard = new Function('jr', 'ex', `
  ${RANK_SRC}
  ${CLOCK_SRC}
  let held = 0, keptWorking = 0;
  ${HELD_SRC}
  ${GUARD_SRC}
  return { status: jr.status, held, keptWorking };
`);

// 19:00Z is 2pm CDT / 1pm CST -- the same CT calendar day either side of the DST flip.
const stamp = (offsetDays) => {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  n.setUTCHours(19, 0, 0, 0);
  return n.toISOString();
};
const day = (offsetDays) => {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(n);
};
const XANO_DONE = () => ({ xano_id: 21941, status: 'completed' });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('\nbooked-ahead guard (lifted from the shipped mirror)\n');

// ── THE FIX TEDDY ASKED FOR: it fires on the BOOKING, before the tech touches anything ──
t('a return trip booked for TOMORROW is not complete, even with nobody en route', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(1) });
  assert.strictEqual(r.status, 'scheduled');
  assert.strictEqual(r.keptWorking, 1);
});

t('a job booked for TODAY is not complete before anyone leaves for it', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(0) });
  assert.strictEqual(r.status, 'scheduled');
});

t("Jimmy's row: booked today, he started -> in_progress", () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(0), en_route_at: stamp(0), started_at: stamp(0) });
  assert.strictEqual(r.status, 'in_progress');
});

t('en route but not started is still only scheduled -- he has not arrived', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(0), en_route_at: stamp(0) });
  assert.strictEqual(r.status, 'scheduled');
});

t('a clean platform row keeps its own status rather than being guessed at', () => {
  const r = applyGuard(XANO_DONE(), { status: 'awaiting_parts', completed_at: null, scheduled_day: day(2) });
  assert.strictEqual(r.status, 'awaiting_parts');
  assert.strictEqual(r.keptWorking, 1);
});

// ── THE 330 THAT MUST NOT MOVE ──
t('a job finished office-side and scheduled in the PAST stays completed', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(-3) });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

t('a job finished office-side with NO scheduled day stays completed', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: null });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

t('yesterday-en-route on a past-booked job does not reopen it', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: null, scheduled_day: day(-1), en_route_at: stamp(-1), started_at: stamp(-1) });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

// ── A REAL PLATFORM COMPLETION IS NEVER UNDONE ──
t("a job completed TODAY on the platform is not reopened by its own booking", () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: stamp(0), scheduled_day: day(0), en_route_at: stamp(0), started_at: stamp(0) });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0, 'a same-day completion must never be undone by its own scheduled_day');
});

t('a tech poking a genuinely-completed job the same day does not reopen it', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: stamp(-1), scheduled_day: day(-1), en_route_at: stamp(0) });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

// ── THE RETURN TRIP: visit one has a REAL stamp and the tech drives back carrying it ──
t('visit one completed 6 days ago, visit two booked today -> not complete', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: stamp(-6), scheduled_day: day(0) });
  assert.strictEqual(r.status, 'scheduled', 'a booking made AFTER the completion outranks it');
  assert.strictEqual(r.keptWorking, 1);
});

t('visit one completed 6 days ago, visit two booked today, tech started -> in_progress', () => {
  const r = applyGuard(XANO_DONE(), { status: 'completed', completed_at: stamp(-6), scheduled_day: day(0), started_at: stamp(0) });
  assert.strictEqual(r.status, 'in_progress');
});

// ── CANCELED IS TERMINAL ──
t('a canceled platform row is never dragged back to scheduled', () => {
  const r = applyGuard(XANO_DONE(), { status: 'canceled', completed_at: null, scheduled_day: day(1) });
  assert.strictEqual(r.keptWorking, 0);
});

// ── THE STRUCTURAL BLIND SPOT THIS EXISTS TO COVER ──
t('RANK reads in_progress -> completed as FORWARD, so it can never catch this', () => {
  const RANK = new Function(`${RANK_SRC} return RANK;`)();
  assert.ok(RANK.in_progress < RANK.completed, 'if this ever flips, the guard is redundant');
  assert.ok(RANK.scheduled < RANK.completed);
});

// ── WIRING: the guard is only as good as the columns the mirror asks Xano's twin for ──
t('the mirror selects every column the guard reads', () => {
  const sel = (SRC.match(/select=xano_id,status,completed_at[^`'"]*/) || [])[0] || '';
  ['completed_at', 'en_route_at', 'started_at', 'scheduled_day'].forEach((c) =>
    assert.ok(sel.includes(c), 'the guard reads ' + c + ' but the select does not fetch it'));
});

t('the guard is driven by the booking, not only by a tech tap', () => {
  assert.ok(/scheduled_day/.test(GUARD_SRC), 'the guard must key on the booked day');
  assert.ok(/bookDay > doneDay|bookDay >= todayCT/.test(GUARD_SRC), 'the booking must be compared to the calendar');
});

t('a real platform completion still gates the tap-only path', () => {
  assert.ok(/workingToday && !ex\.completed_at/.test(GUARD_SRC),
    'same-day activity alone must not reopen a job that carries a real completion stamp');
});

console.log('\n' + n + '/' + n + ' passed\n');
