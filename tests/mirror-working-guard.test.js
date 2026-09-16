// Jimmy, 2026-09-16: he tapped On my way at 9:49 and his job read Complete. He tapped
// Start at 10:59 and the mirror re-completed it at 11:01. Nothing on the platform did it
// -- every platform path that writes 'completed' also writes completed_at, and his was
// null. The stale 'completed' came from Xano (the Xano-side TDR card closes visit one by
// writing scheduling_status alone, no timestamp), and this mirror carried it back down
// every 5 minutes. He could not hold his own job open.
//
// RANK cannot catch it -- in_progress(2) < completed(4) reads as moving FORWARD -- so the
// guard is separate. These assertions lift RANK, the clock helpers and BOTH guard blocks
// OUT of the shipped mirror and EXECUTE them, so the test cannot drift from what runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const SRC = fs.readFileSync(__dirname + '/../netlify/functions/platform-tn-mirror.js', 'utf8');

const RANK_SRC = (SRC.match(/const RANK = \{[^}]*\};/) || [])[0];
const CLOCK_SRC = (SRC.match(/const CT_DAY = new Intl\.DateTimeFormat[\s\S]*?const isTodayCT = [^\n]*\n/) || [])[0];
const HELD_SRC = (SRC.match(/const wasDone = [\s\S]*?\n {6}\}\n/) || [])[0];
const WORKING_SRC = (SRC.match(/A TECH WORKING THE JOB TODAY[\s\S]*?\n( {6}if \([\s\S]*?\n {6}\}\n)/) || [])[1];

assert.ok(RANK_SRC, 'RANK must exist in platform-tn-mirror.js');
assert.ok(CLOCK_SRC, 'the America/Chicago day helpers must exist');
assert.ok(HELD_SRC, 'the never-walk-backwards guard must exist');
const RECOVER_SRC = (SRC.match(/RECOVER a row that is already poisoned[\s\S]*?\n( {6}if \([\s\S]*?\n {6}\}\n)/) || [])[1];
assert.ok(WORKING_SRC, 'the tech-working-today guard must exist');
assert.ok(RECOVER_SRC, 'the phantom-recovery branch must exist');

// Run the REAL guard blocks over one (jr, ex) pair and report what the mirror would write.
const applyGuard = new Function('jr', 'ex', `
  ${RANK_SRC}
  ${CLOCK_SRC}
  let held = 0, keptWorking = 0;
  ${HELD_SRC}
  ${WORKING_SRC}
  ${RECOVER_SRC}
  return { status: jr.status, held, keptWorking };
`);

// An ISO stamp N days from now, at 2pm CT-ish so it lands on the intended calendar day.
const stamp = (offsetDays) => {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  n.setUTCHours(19, 0, 0, 0); // 19:00Z == 2pm CDT / 1pm CST — same CT day either way
  return n.toISOString();
};

// ── THE BUG ──────────────────────────────────────────────────────────────────────────
test("a tech en route TODAY holds his job open against a stale Xano completed", () => {
  const r = applyGuard({ status: 'completed' }, { status: 'scheduled', completed_at: null, en_route_at: stamp(0), started_at: null });
  assert.strictEqual(r.status, 'scheduled', 'Jimmy tapped On my way — the job is not finished');
  assert.strictEqual(r.keptWorking, 1);
});

test("a tech who STARTED today holds it too", () => {
  const r = applyGuard({ status: 'completed' }, { status: 'in_progress', completed_at: null, en_route_at: null, started_at: stamp(0) });
  assert.strictEqual(r.status, 'in_progress');
  assert.strictEqual(r.keptWorking, 1);
});

// ── THE LOAD-BEARING ONE ─────────────────────────────────────────────────────────────
// 334 jobs legitimately read completed in Xano with no platform stamp (finished office-side).
// A stamp-only guard would have un-completed every one of them. Same-day is the discriminator.
test("a tech en route YESTERDAY does NOT hold it — Xano's completion stands", () => {
  const r = applyGuard({ status: 'completed' }, { status: 'in_progress', completed_at: null, en_route_at: stamp(-1), started_at: stamp(-1) });
  assert.strictEqual(r.status, 'completed', 'yesterday is history; the office closed this job');
  assert.strictEqual(r.keptWorking, 0);
});

test("a job nobody has touched on the platform takes Xano's completed", () => {
  const r = applyGuard({ status: 'completed' }, { status: 'scheduled', completed_at: null, en_route_at: null, started_at: null });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

test('a null/garbage timestamp never reads as today', () => {
  for (const bad of [null, undefined, '', 'not-a-date', 0]) {
    const r = applyGuard({ status: 'completed' }, { status: 'scheduled', completed_at: null, en_route_at: bad, started_at: bad });
    assert.strictEqual(r.status, 'completed', String(bad));
  }
});

// ── the guard must not reach past the one case it exists for ─────────────────────────
// THE CASE THAT FOUND A BUG IN THIS GUARD. A parts job completes on visit one (real stamp),
// parts arrive, the office books the return trip, the tech drives back. He carries an old
// completed_at by design. An earlier cut gated this guard on !wasDone and handed him Jimmy's
// exact phantom on every second visit. The gate is ex.status, not the stamp.
test('a RETURN TRIP holds open even though visit one left a real completion stamp', () => {
  const r = applyGuard(
    { status: 'completed' },
    { status: 'in_progress', completed_at: stamp(-9), en_route_at: stamp(0), started_at: stamp(0) },
  );
  assert.strictEqual(r.status, 'in_progress', 'he is standing at the door on visit two');
  assert.strictEqual(r.keptWorking, 1);
});

test('it does not fire when the platform already completed the job', () => {
  const r = applyGuard({ status: 'completed' }, { status: 'completed', completed_at: stamp(0), en_route_at: stamp(0), started_at: stamp(0) });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

test('it does not fire when the platform canceled the job', () => {
  const r = applyGuard({ status: 'completed' }, { status: 'canceled', completed_at: null, en_route_at: stamp(0), started_at: null });
  // A canceled job is out of scope for this guard on purpose -- a tech en route to a job the
  // office killed is a dispatch problem, not a stale-status problem, and silently re-opening it
  // would hide the cancellation. What happens to the status is the PRE-EXISTING rank tie
  // (completed and canceled are both 4, and `back` needs strictly greater), untouched by this fix.
  assert.strictEqual(r.keptWorking, 0, 'the working guard must not reach a canceled job');
});

test('it only fires on a Xano completed — a normal forward move still lands', () => {
  const r = applyGuard({ status: 'awaiting_parts' }, { status: 'in_progress', completed_at: null, en_route_at: stamp(0), started_at: stamp(0) });
  assert.strictEqual(r.status, 'awaiting_parts', 'Xano moving the job forward is still the system of record');
  assert.strictEqual(r.keptWorking, 0);
});

// ── the guards that were already here must keep working ──────────────────────────────
test('never-walk-backwards still holds a further-along platform status', () => {
  const r = applyGuard({ status: 'scheduled' }, { status: 'in_progress', completed_at: null, en_route_at: null, started_at: null });
  assert.strictEqual(r.status, 'in_progress');
  assert.strictEqual(r.held, 1);
});

test('a real platform completion is never undone', () => {
  const r = applyGuard({ status: 'scheduled' }, { status: 'completed', completed_at: stamp(0), en_route_at: null, started_at: null });
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.held, 1);
});

// ── the wiring: the guard can only work if the mirror actually READS those two columns ──
test('the mirror selects en_route_at and started_at', () => {
  const sel = (SRC.match(/select=xano_id,status,completed_at[^`'"]*/) || [])[0] || '';
  assert.ok(sel, 'the status-guard select must still be there');
  assert.ok(/\ben_route_at\b/.test(sel), 'en_route_at must be in the select or the guard is blind');
  assert.ok(/\bstarted_at\b/.test(sel), 'started_at must be in the select or the guard is blind');
});

test('the guard is same-day scoped, not stamp-only', () => {
  assert.ok(/isTodayCT\(ex\.en_route_at\) \|\| isTodayCT\(ex\.started_at\)/.test(SRC),
    'dropping the same-day restriction would un-complete the 334 legitimately-completed jobs');
});


// ── RECOVERY: the row is ALREADY poisoned ────────────────────────────────────────────
// The hold above only helps while the platform row is still clean -- it holds ex.status, so
// once the stale 'completed' has landed it is inert forever. That is Jimmy's real sequence:
// the mirror wrote completed BEFORE he got there, then he tapped On my way at 9:49 into an
// already-finished job. Verified on his live row 2026-09-16: status completed, completed_at
// null, en_route_at 14:49Z, started_at 15:59Z.
test('a poisoned row a tech STARTED today recovers to in_progress', () => {
  const r = applyGuard(
    { status: 'completed' },
    { status: 'completed', completed_at: null, en_route_at: stamp(0), started_at: stamp(0) },
  );
  assert.strictEqual(r.status, 'in_progress', 'he is standing in the kitchen');
  assert.strictEqual(r.keptWorking, 1);
});

test('a poisoned row a tech is only EN ROUTE to recovers to scheduled', () => {
  const r = applyGuard(
    { status: 'completed' },
    { status: 'completed', completed_at: null, en_route_at: stamp(0), started_at: null },
  );
  assert.strictEqual(r.status, 'scheduled', 'he is driving -- not there yet');
  assert.strictEqual(r.keptWorking, 1);
});

// THE OTHER LOAD-BEARING ONE. A real platform completion has a stamp. Recovery must never
// reach it, or every job a tech finished today gets re-opened under him.
test('a REAL platform completion today is never recovered', () => {
  const r = applyGuard(
    { status: 'completed' },
    { status: 'completed', completed_at: stamp(0), en_route_at: stamp(0), started_at: stamp(0) },
  );
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});

test('a stamp-less completion nobody is working today is left alone', () => {
  // This is the 334. Finished office-side, no platform stamp, no tech en route.
  const r = applyGuard(
    { status: 'completed' },
    { status: 'completed', completed_at: null, en_route_at: stamp(-8), started_at: null },
  );
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptWorking, 0);
});
