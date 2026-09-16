// ADD A MACHINE TO A CLAIM. One write, tech and office.
//
// Teddy, 2026-09-16: "when a guy gets out to a customer's house they'll have multiple
// machines and they need to add a machine, which in turn they need a whole nother TDR for
// that machine... the technician needs the ability to add a machine to a claim on their app,
// the office also needs the same ability."
//
// The button already existed on the tech page. Measured the same day: source='tech_add_machine'
// returns ZERO rows in the entire platform history -- it had never been used once. It did not
// copy warranty_company / claim_number / dispatch_id, so the second appliance landed looking
// like an unrelated cash job with no claim on it. That is the one field the office needs to
// file it, so "add a machine to a claim" was the one thing it did not do.
//
// The rules these tests pin:
//   1. THE CLAIM RIDES. Unticking it is a visible choice, never a silent assumption.
//   2. THE VISIT RIDES -- same truck, same day, same door.
//   3. THE PARENT'S PROGRESS DOES NOT. A machine nobody has looked at is never awaiting_parts
//      and never completed.
//   4. A LEAN-TIER CARD CANNOT LAND A CLAIMLESS MACHINE. The office board's fallback select
//      does not carry claim_number; hydrate() tops it up before the sheet opens.
//   5. A WRITE IS ONLY SAVED WHEN A ROW COMES BACK. An RLS refusal returns zero rows and no
//      error, and calling that success is how a machine goes missing.
//
// Every function is lifted out of the shipped module and EXECUTED against a fake client.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const P = (...a) => path.join(__dirname, '..', 'platform', ...a);
const MOD    = fs.readFileSync(P('ant-add-machine.js'), 'utf8');
const JOB    = fs.readFileSync(P('tech-job.html'), 'utf8');
const BOARD  = fs.readFileSync(P('office-board.html'), 'utf8');

// strip comments so an assertion can never be satisfied by a code comment
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── load the REAL module into a sandbox with a fake window/document ──
function loadModule() {
  const styles = [];
  const win = {};
  const doc = {
    head: { appendChild: (s) => styles.push(s) },
    body: { appendChild() {}, removeChild() {} },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {},
                            querySelector: () => ({ onclick: null, value: '', checked: true,
                                                    textContent: '', focus() {} }),
                            appendChild() {} })
  };
  const ctx = { window: win, document: doc, setTimeout: (f) => f && 0, console };
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  assert.ok(ctx.window.AntAddMachine, 'module did not export AntAddMachine');
  return ctx.window.AntAddMachine;
}
const AAM = loadModule();

// A parent job the way the tech page actually loads it.
function parentJob(over) {
  return Object.assign({
    id: 'job-parent',
    customer_id: 'cust-1',
    status: 'in_progress',
    stop_id: 'stop-1',
    warranty_company: 'AHS',
    claim_number: '12345',
    dispatch_id: 'D-99',
    technician_id: 4,
    scheduled_day: '2026-09-16',
    scheduled_start: '2026-09-16T13:00:00Z',
    service_window: '8-12',
    time_window: '8-11',
    availability: 'anytime',
    access_notes: 'gate code 4455',
    unit: { kind: 'appliance', label: 'AHS fridge' }
  }, over || {});
}

// ── 1 · THE CLAIM RIDES ──────────────────────────────────────────────────────

test('THE WHOLE ASK: the new machine lands ON the claim', () => {
  const row = AAM.fieldsFor(parentJob(), { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(row.warranty_company, 'AHS');
  assert.equal(row.claim_number, '12345');
  assert.equal(row.dispatch_id, 'D-99');
});

test('unticking "same claim" leaves the machine with NO claim -- not a guessed one', () => {
  const row = AAM.fieldsFor(parentJob(), { companyId: 'co-1', unitId: 'u-2', sameClaim: false });
  assert.ok(!('warranty_company' in row), 'warranty_company must not ride when unticked');
  assert.ok(!('claim_number' in row));
  assert.ok(!('dispatch_id' in row));
  // the visit still rides -- it is the same truck at the same door either way
  assert.equal(row.technician_id, 4);
  assert.equal(row.scheduled_day, '2026-09-16');
});

test('a cash job with no claim adds a machine with no claim, and does not invent one', () => {
  const row = AAM.fieldsFor(parentJob({ warranty_company: null, claim_number: null, dispatch_id: null }),
                            { companyId: 'co-1', unitId: 'u-2' });
  assert.ok(!('warranty_company' in row));
  assert.ok(!('claim_number' in row));
  assert.equal(row.customer_id, 'cust-1');
});

// ── 2 · THE VISIT RIDES ──────────────────────────────────────────────────────

test('same truck, same day, same window, same door', () => {
  const row = AAM.fieldsFor(parentJob(), { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(row.technician_id, 4);
  assert.equal(row.scheduled_day, '2026-09-16');
  assert.equal(row.service_window, '8-12');
  assert.equal(row.time_window, '8-11');
  assert.equal(row.access_notes, 'gate code 4455');
  assert.equal(row.customer_id, 'cust-1');
});

test('a blank on the parent is not copied as a blank -- the column is simply left alone', () => {
  const row = AAM.fieldsFor(parentJob({ time_window: '', access_notes: null }),
                            { companyId: 'co-1', unitId: 'u-2' });
  assert.ok(!('time_window' in row), 'an empty string must not be written');
  assert.ok(!('access_notes' in row), 'a null must not be written');
});

test('both machines hang off the SAME stop, so every surface can group them', () => {
  const row = AAM.fieldsFor(parentJob(), { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(row.stop_id, 'stop-1');
  // a job that is not part of a stop yet becomes the anchor of one
  const solo = AAM.fieldsFor(parentJob({ stop_id: null }), { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(solo.stop_id, 'job-parent');
});

// ── 3 · THE PARENT'S PROGRESS DOES NOT RIDE ──────────────────────────────────

test('THE EXPENSIVE ONE: a brand new machine never inherits awaiting_parts or completed', () => {
  assert.equal(AAM.liveStatus('awaiting_parts'), 'scheduled', 'would bury it in the parts queue');
  assert.equal(AAM.liveStatus('completed'), 'scheduled', 'would close a machine nobody looked at');
  assert.equal(AAM.liveStatus('canceled'), 'scheduled');
  assert.equal(AAM.liveStatus('new'), 'scheduled');
});

test('the tech standing there right now keeps the machine in_progress', () => {
  assert.equal(AAM.liveStatus('in_progress'), 'in_progress');
  const row = AAM.fieldsFor(parentJob({ status: 'awaiting_parts' }), { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(row.status, 'scheduled');
});

// ── 4 · A LEAN-TIER CARD CANNOT LAND A CLAIMLESS MACHINE ─────────────────────

test('hydrate tops up the fields the office board\'s LEAN select never loaded', async () => {
  // Exactly what SEL_BASE_MIN gives you: warranty_company but no claim_number, no stop_id.
  const lean = { id: 'job-parent', status: 'scheduled', customer_id: 'cust-1',
                 warranty_company: 'AHS', technician_id: 4, scheduled_day: '2026-09-16' };
  let asked = null;
  const sb = { from: () => ({ select: (c) => { asked = c; return {
    eq: () => ({ limit: () => ({ then: (f) => f({ data: [{ id: 'job-parent', claim_number: '12345',
      dispatch_id: 'D-99', stop_id: 'stop-1', service_window: '8-12', time_window: '8-11',
      availability: null, access_notes: null, scheduled_start: null,
      customer_id: 'cust-1', status: 'scheduled', warranty_company: 'AHS', technician_id: 4,
      scheduled_day: '2026-09-16' }] }) }) }) }; } }) };

  await new Promise((done) => AAM.hydrate(sb, lean, done));
  assert.equal(lean.claim_number, '12345', 'the claim number must be filled in');
  assert.equal(lean.stop_id, 'stop-1');
  assert.ok(/claim_number/.test(asked), 'hydrate must actually ask for claim_number');

  const row = AAM.fieldsFor(lean, { companyId: 'co-1', unitId: 'u-2' });
  assert.equal(row.claim_number, '12345', 'the machine added off a lean card still lands on the claim');
});

test('hydrate does NOT re-fetch a card that already carries everything', async () => {
  let calls = 0;
  const sb = { from: () => { calls++; return { select: () => ({ eq: () => ({ limit: () => ({ then: (f) => f({ data: [] }) }) }) }) }; } };
  const full = parentJob();
  await new Promise((done) => AAM.hydrate(sb, full, done));
  assert.equal(calls, 0, 'a fully-loaded card must not cost a round trip');
});

test('a field that was LOADED and is genuinely empty is an answer, not a gap', async () => {
  let calls = 0;
  const sb = { from: () => { calls++; return { select: () => ({ eq: () => ({ limit: () => ({ then: (f) => f({ data: [{ claim_number: 'SHOULD-NOT-APPEAR' }] }) }) }) }) }; } };
  const j = parentJob({ claim_number: null });   // loaded, and there genuinely isn't one
  await new Promise((done) => AAM.hydrate(sb, j, done));
  assert.equal(calls, 0, 'null means answered -- re-reading it would overwrite a real answer');
  assert.equal(j.claim_number, null);
});

// ⚠️ Testing hydrate() on its own proves the FUNCTION works and nothing whatever about
// open() still calling it. Deleting that one line left this suite green on the first
// mutation run. So this test opens the REAL sheet and watches for the read.
test('open() ACTUALLY hydrates before it draws -- not just a function that exists', async () => {
  let selected = null;
  const sb = { from: () => ({ select: (c) => { selected = c; return {
    eq: () => ({ limit: () => ({ then: (f) => f({ data: [{ id: 'job-parent', claim_number: '12345',
      stop_id: 'stop-1' }] }) }) }) }; } }) };
  const lean = { id: 'job-parent', status: 'scheduled', warranty_company: 'AHS' };
  AAM.open({ sb, companyId: 'co-1', job: lean, source: 'office_add_machine' });
  await new Promise((r) => setImmediate(r));
  assert.ok(selected, 'open() drew the sheet without topping the card up first');
  assert.ok(/claim_number/.test(selected));
  assert.equal(lean.claim_number, '12345', 'the sheet must be looking at the real claim');
});

test('a failed hydrate read invents nothing and still lets the sheet open', async () => {
  const lean = { id: 'job-parent', status: 'scheduled', warranty_company: 'AHS' };
  const sb = { from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ then: (f) => f({ error: { message: 'boom' } }) }) }) }) }) };
  let reached = false;
  await new Promise((done) => AAM.hydrate(sb, lean, () => { reached = true; done(); }));
  assert.ok(reached, 'a failed read must not strand the office with a dead button');
  assert.equal(lean.claim_number, undefined, 'a failed read must not invent a claim number');
});

// ── 5 · A WRITE IS ONLY SAVED WHEN A ROW COMES BACK ──────────────────────────

function fakeSb(plan) {
  const seen = { inserts: [], updates: [] };
  const sb = {
    from: (table) => ({
      insert: (row) => { seen.inserts.push({ table, row }); return {
        select: () => ({ then: (f) => f(plan[table] || { data: [{ id: table + '-new' }] }) }) }; },
      update: (row) => { seen.updates.push({ table, row }); return {
        eq: () => ({ then: (f) => f(plan.updateResult || {}) }) }; }
    })
  };
  return { sb, seen };
}

test('the happy path writes the unit FIRST, then the job that points at it', async () => {
  const { sb, seen } = fakeSb({ unit: { data: [{ id: 'u-2' }] }, job: { data: [{ id: 'job-new' }] } });
  const r = await new Promise((done) =>
    AAM.create({ sb, companyId: 'co-1', job: parentJob(), label: 'Kenmore dishwasher',
                 problem: "won't drain", source: 'tech_add_machine' }, done));
  assert.ok(r.ok);
  assert.equal(r.id, 'job-new');
  assert.equal(seen.inserts[0].table, 'unit', 'a job with no unit is a card nobody can read');
  assert.equal(seen.inserts[0].row.label, 'Kenmore dishwasher');
  assert.equal(seen.inserts[1].table, 'job');
  assert.equal(seen.inserts[1].row.problem, "won't drain");
  assert.equal(seen.inserts[1].row.claim_number, '12345');
  assert.equal(r.claim, 'AHS #12345');
});

test('AN RLS REFUSAL IS NOT A SAVE: zero rows and no error must report failure', async () => {
  const { sb } = fakeSb({ unit: { data: [{ id: 'u-2' }] }, job: { data: [] } });
  const r = await new Promise((done) =>
    AAM.create({ sb, companyId: 'co-1', job: parentJob(), label: 'Kenmore dishwasher' }, done));
  assert.equal(r.ok, false, 'reporting this as success is how a machine goes missing');
});

test('a nameless machine is refused before anything is written', async () => {
  const { sb, seen } = fakeSb({});
  const r = await new Promise((done) =>
    AAM.create({ sb, companyId: 'co-1', job: parentJob(), label: '   ' }, done));
  assert.equal(r.ok, false);
  assert.equal(seen.inserts.length, 0, 'nothing may be written without a machine name');
});

test('a shop without the stop_id column is told plainly, not shown a raw error', async () => {
  const { sb } = fakeSb({ unit: { data: [{ id: 'u-2' }] },
                          job: { error: { message: 'column "stop_id" does not exist' } } });
  const r = await new Promise((done) =>
    AAM.create({ sb, companyId: 'co-1', job: parentJob(), label: 'Dishwasher' }, done));
  assert.equal(r.ok, false);
  assert.ok(/not switched on/i.test(r.error), 'got: ' + r.error);
});

test('a job that is not on a stop yet becomes the stop anchor before the sibling is written', async () => {
  const { sb, seen } = fakeSb({ unit: { data: [{ id: 'u-2' }] }, job: { data: [{ id: 'job-new' }] } });
  const r = await new Promise((done) =>
    AAM.create({ sb, companyId: 'co-1', job: parentJob({ stop_id: null }), label: 'Dishwasher' }, done));
  assert.ok(r.ok);
  assert.equal(seen.updates[0].table, 'job');
  assert.equal(seen.updates[0].row.stop_id, 'job-parent', 'the parent must anchor its own stop');
  assert.equal(seen.inserts[1].row.stop_id, 'job-parent', 'the sibling hangs off the same stop');
});

// ── the label the human reads before ticking the box ─────────────────────────

test('the claim is named in full so the tech knows what he is agreeing to', () => {
  assert.equal(AAM.claimOf(parentJob()), 'AHS #12345');
  assert.equal(AAM.claimOf(parentJob({ claim_number: null })), 'AHS #D-99');
  assert.equal(AAM.claimOf(parentJob({ claim_number: null, dispatch_id: null })), 'AHS');
  assert.equal(AAM.claimOf({ warranty_company: null, claim_number: null }), '');
  assert.equal(AAM.claimOf(null), '');
});

// ── ONE DEFINITION, BOTH SURFACES ────────────────────────────────────────────

test('BOTH the tech app and the office board load the one module', () => {
  assert.ok(/<script src="\/platform\/ant-add-machine\.js\?v=/.test(JOB),
    'tech-job.html must load ant-add-machine.js -- with a ?v=, a shared .js is not covered by the html no-cache rule');
  assert.ok(/<script src="\/platform\/ant-add-machine\.js\?v=/.test(BOARD),
    'office-board.html must load ant-add-machine.js with a ?v=');
});

test('NEITHER surface keeps its own copy of the insert chain', () => {
  // A pasted copy is how the route picker ended up with three vocabularies.
  for (const [name, src] of [['tech-job.html', JOB], ['office-board.html', BOARD]]) {
    const clean = stripComments(src);
    assert.ok(!/from\(['"]unit['"]\)\s*\.insert/.test(clean),
      name + ' must not insert a unit itself -- that write lives in ant-add-machine.js');
  }
});

test('the office board really does offer the button, and calls the shared open()', () => {
  const clean = stripComments(BOARD);
  assert.ok(/id="jmachAdd"/.test(clean), 'the office needs the same ability -- the button must exist');
  assert.ok(/AntAddMachine\.open\(/.test(clean), 'it must go through the shared sheet');
  assert.ok(/source:\s*['"]office_add_machine['"]/.test(clean),
    'the office write must be distinguishable from the tech write in the record');
  assert.ok(/loadMachines\(job\);/.test(clean), 'the drawer must actually call loadMachines');
});

test('the tech page offers it too, and it is no longer buried under the parts tracker', () => {
  const clean = stripComments(JOB);
  assert.ok(/AntAddMachine\.open\(/.test(clean));
  assert.ok(/id="addMachineChip"/.test(clean));
  const machineCard = clean.indexOf('id="machineCard"');
  const parts = clean.indexOf('🔩 Parts');
  assert.ok(machineCard > -1, 'the machine card must exist');
  assert.ok(parts === -1 || machineCard < parts,
    'the machine card must sit ABOVE the parts tracker -- a tech in a kitchen never scrolled to it');
});

test('the tech page LOADS the claim fields, or the machine lands claimless', () => {
  const clean = stripComments(JOB);
  const sel = clean.match(/var base = '([^']+)'/);
  assert.ok(sel, 'could not find the job select -- the lift is broken, not the page');
  for (const k of ['warranty_company', 'claim_number', 'dispatch_id']) {
    assert.ok(sel[1].includes(k),
      'tech-job.html must select ' + k + ' -- it is copied onto the machine being added');
  }
});

test('the dispatch-flag button is LIVE, not pointing at a form that no longer exists', () => {
  // "＋ Add the dishwasher" used to fill an inline form on the page. That form is gone, so a
  // button still reaching for #addMachineBox / #amLabel would silently do nothing -- the exact
  // dead-button class this whole week has been spent removing.
  const clean = stripComments(JOB);
  for (const dead of ['addMachineBox', 'amLabel', 'amProblem']) {
    assert.ok(!clean.includes(dead),
      'tech-job.html still references #' + dead + ', which no longer exists');
  }
  const sfAdd = clean.slice(clean.indexOf("getElementById('sfAdd')"));
  assert.ok(/addMachine\(\s*\{/.test(sfAdd.slice(0, 400)),
    'the flag button must open the shared sheet');
});

test('a machine the dispatch already named is pre-filled, not retyped', () => {
  const clean = stripComments(JOB);
  const sfAdd = clean.slice(clean.indexOf("getElementById('sfAdd')"), clean.indexOf("getElementById('sfAdd')") + 400);
  assert.ok(/label:\s*extra/.test(sfAdd), 'the machine the dispatch named must be filled in');
  assert.ok(/problem:/.test(sfAdd), "what the dispatch said it is doing must be filled in too");
  // and the sheet must actually honour it
  assert.ok(/value="' \+ esc\(o\.label \|\| ''\) \+ '"/.test(MOD),
    'the sheet must render the pre-filled machine name');
});

test('both surfaces read the stop through the shared siblings(), not a second query', () => {
  for (const [name, src] of [['tech-job.html', JOB], ['office-board.html', BOARD]]) {
    const clean = stripComments(src);
    assert.ok(/AntAddMachine\.siblings\(/.test(clean), name + ' must read the stop through the module');
    assert.ok(!/\.or\(['"]stop_id\.eq\./.test(clean),
      name + ' must not keep its own stop query -- two copies drift');
  }
});
