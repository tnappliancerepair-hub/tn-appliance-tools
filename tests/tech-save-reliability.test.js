// tech-save-reliability.test.js — the poor-signal promise.
//
// Teddy, 2026-09-16: "A lot of these guys are traveling. They've got poor signal...
// we want them to be able to write things in and they can feel confident that it's
// going to save." Andre typed the same report four times and lost it four times.
//
// Loads the REAL shipped platform/ant-save.js into a vm with a fake browser, so the
// test runs the module the techs actually run. The finish-gate assertions are lifted
// straight out of the shipped platform/tech-job.html for the same reason.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SAVE_SRC = fs.readFileSync(path.join(ROOT, 'platform', 'ant-save.js'), 'utf8');
const TECHJOB = fs.readFileSync(path.join(ROOT, 'platform', 'tech-job.html'), 'utf8');
const TECHDAY = fs.readFileSync(path.join(ROOT, 'platform', 'tech.html'), 'utf8');

// ── a fake browser just real enough ──────────────────────────────────────────────
function boot(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const el = () => ({ id: '', style: { cssText: '' }, textContent: '', _a: {},
    setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k] == null ? null : this._a[k]; },
    appendChild() {} });
  const bar = el();
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Object, Array, String, Date, Math, JSON,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    navigator: { onLine: opts.online !== false },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'antsave-bar' ? (sandbox.__barMade ? bar : null) : null),
      createElement: () => { sandbox.__barMade = true; return bar; },
      body: { appendChild() {} }, documentElement: { appendChild() {} },
      addEventListener() {},
    },
    CustomEvent: function (t, d) { this.type = t; this.detail = d && d.detail; },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(SAVE_SRC, sandbox);
  return { AntSave: sandbox.AntSave, store, bar, sandbox };
}

// A stub supabase client. `plan` is a function(call) -> { data, error } or 'boom'.
function stubSb(plan) {
  const calls = [];
  return {
    calls,
    from(table) {
      const c = { table, op: null, row: null, eq: {}, onConflict: null, sel: null };
      const api = {
        insert(r) { c.op = 'insert'; c.row = r; return api; },
        update(r) { c.op = 'update'; c.row = r; return api; },
        upsert(r, o) { c.op = 'upsert'; c.row = r; c.onConflict = o && o.onConflict; return api; },
        select(s) { if (c.op === null) { c.op = 'select'; c.sel = s; } else { c.sel = s; } return api; },
        eq(k, v) { c.eq[k] = v; return api; },
        limit() { return api; },
        then(res, rej) {
          calls.push(c);
          let out;
          try { out = plan(c, calls.length); } catch (e) { return Promise.resolve().then(() => rej ? rej(e) : Promise.reject(e)); }
          if (out === 'boom') return Promise.resolve().then(() => rej ? rej(new TypeError('Failed to fetch')) : undefined);
          return Promise.resolve().then(() => res(out));
        },
      };
      return api;
    },
  };
}
const ROWBACK = { data: [{ id: 'x' }], error: null };
const NETFAIL = { data: null, error: { message: 'TypeError: Failed to fetch' } };
const RLSBLOCK = { data: [], error: null };
const REFUSED = { data: null, error: { message: 'column "part_status" does not exist', code: '42703' } };

let pass = 0, fail = 0;
const ta = async (n, f) => { try { await f(); console.log('  ok  ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + '\n       ' + e.message); fail++; } };

(async () => {
console.log('\ntech-save-reliability');

// ── 1. the three outcomes are three different facts ─────────────────────────────
await ta('a row that comes back is a real save', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => ROWBACK);
  const r = await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', onConflict: 'job_id', row: { job_id: 1, root_cause: 'x' }, key: 'tdr:1' });
  assert.strictEqual(r.ok, true, 'should be ok');
  assert.strictEqual(r.queued, false, 'a landed write is not queued');
  assert.ok(!store.ant_outbox_v1 || JSON.parse(store.ant_outbox_v1).length === 0, 'nothing held');
});

await ta('the server saying no is REFUSED and never queued', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => REFUSED);
  const r = await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', row: { job_id: 1 }, key: 'tdr:1' });
  assert.strictEqual(r.refused, true, 'a coded server error is a refusal');
  assert.strictEqual(r.queued, false, 'a refusal must never be retried forever');
  assert.ok(!store.ant_outbox_v1 || JSON.parse(store.ant_outbox_v1).length === 0, 'refusal not held');
});

await ta('zero rows with NO error is a block, not a save (the documented RLS trap)', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => RLSBLOCK);
  const r = await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', row: { job_id: 1 }, key: 'tdr:1' });
  assert.strictEqual(r.ok, false, 'zero rows is never ok');
  assert.strictEqual(r.refused, true, 'zero rows + no error = blocked');
  assert.strictEqual(r.queued, false);
});

await ta('a dropped connection is HELD, not lost', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => NETFAIL);
  const r = await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', onConflict: 'job_id', row: { job_id: 1, failed_component: 'element' }, key: 'tdr:1' });
  assert.strictEqual(r.queued, true, 'signal failure must queue');
  assert.strictEqual(r.refused, false, 'a dropped connection is not a refusal');
  const q = JSON.parse(store.ant_outbox_v1);
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].row.failed_component, 'element', 'his typing is in the outbox');
});

await ta('a queued write is never called Saved', async () => {
  const { AntSave } = boot();
  const sb = stubSb(() => NETFAIL);
  const r = await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', row: { job_id: 1 }, key: 'tdr:1' });
  assert.ok(!/saved ✓|^saved$/i.test(r.message || ''), 'must not claim a plain "Saved"');
  assert.ok(/on your phone/i.test(r.message || ''), 'says where it actually is: ' + r.message);
});

// ── 2. two fields queued offline must BOTH survive ──────────────────────────────
await ta('two partial report writes MERGE — neither field is thrown away', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => NETFAIL);
  await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', onConflict: 'job_id', row: { job_id: 1, failed_component: 'element' }, key: 'tdr:1' });
  await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', onConflict: 'job_id', row: { job_id: 1, root_cause: 'burnt' }, key: 'tdr:1' });
  const q = JSON.parse(store.ant_outbox_v1);
  assert.strictEqual(q.length, 1, 'one merged write, not two');
  assert.strictEqual(q[0].row.failed_component, 'element', 'the FIRST field survived the second write');
  assert.strictEqual(q[0].row.root_cause, 'burnt');
});

await ta('two notes queued offline both make it — the first is not replaced', async () => {
  const { AntSave, store } = boot();
  const sb = stubSb(() => NETFAIL);
  await AntSave.write({ sb, table: 'job', op: 'append', column: 'office_notes', matchCol: 'id', matchVal: 1, text: 'first note', key: 'onote:1' });
  await AntSave.write({ sb, table: 'job', op: 'append', column: 'office_notes', matchCol: 'id', matchVal: 1, text: 'second note', key: 'onote:1' });
  const q = JSON.parse(store.ant_outbox_v1);
  assert.strictEqual(q.length, 1);
  assert.ok(/first note/.test(q[0].text) && /second note/.test(q[0].text), 'both notes held: ' + q[0].text);
});

// ── 3. an append lands UNDER what arrived while he had no signal ────────────────
await ta('a held note re-reads at send time and never blanks the office copy', async () => {
  const { AntSave, store } = boot();
  const offline = stubSb(() => NETFAIL);
  await AntSave.write({ sb: offline, table: 'job', op: 'append', column: 'office_notes', matchCol: 'id', matchVal: 1, text: 'tech note', key: 'onote:1' });

  // Signal comes back. Meanwhile Danielle typed into the same column.
  let wrote = null;
  const online = stubSb((c) => {
    if (c.op === 'select') return { data: [{ office_notes: 'DANIELLE TYPED THIS WHILE HE WAS OUT' }], error: null };
    wrote = c.row.office_notes; return ROWBACK;
  });
  AntSave.attach(online);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(wrote, 'the held note went out');
  assert.ok(/DANIELLE TYPED THIS/.test(wrote), 'her note survived: ' + wrote);
  assert.ok(/tech note/.test(wrote), 'his note landed too');
  assert.ok(wrote.indexOf('DANIELLE') < wrote.indexOf('tech note'), 'his lands UNDER hers');
  assert.strictEqual(JSON.parse(store.ant_outbox_v1 || '[]').length, 0, 'queue drained');
});

// ── 4. the report can never land after the status that belongs to it ────────────
await ta('a held report and its finish send in order, report first', async () => {
  const { AntSave, store } = boot();
  const offline = stubSb(() => NETFAIL);
  await AntSave.write({ sb: offline, table: 'job_tdr', op: 'upsert', onConflict: 'job_id', row: { job_id: 1, failed_component: 'element' }, key: 'tdr:1' });
  await AntSave.write({ sb: offline, table: 'job', op: 'update', match: { id: 1 }, row: { status: 'completed' }, key: 'jobstatus:1', then: 'job_finished', thenArg: { job: 1, ns: 'completed' } });

  const order = [];
  let fired = null;
  AntSave.on('job_finished', (arg) => { fired = arg; });
  const online = stubSb((c) => { order.push(c.table); return ROWBACK; });
  AntSave.attach(online);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepStrictEqual(order, ['job_tdr', 'job'], 'report before status: ' + order.join(','));
  assert.ok(fired && fired.ns === 'completed', 'the late finish still runs its follow-on (the customer text)');
  assert.strictEqual(JSON.parse(store.ant_outbox_v1 || '[]').length, 0, 'queue drained');
});

await ta('the follow-on does NOT fire while the write is only held', async () => {
  const { AntSave } = boot();
  let fired = false;
  AntSave.on('job_finished', () => { fired = true; });
  const sb = stubSb(() => NETFAIL);
  await AntSave.write({ sb, table: 'job', op: 'update', match: { id: 1 }, row: { status: 'completed' }, key: 'jobstatus:1', then: 'job_finished', thenArg: { job: 1, ns: 'completed' } });
  assert.strictEqual(fired, false, 'a customer must not be told the repair is done before it lands');
});

// ── 5. a refusal leaves the queue instead of looping forever ────────────────────
await ta('a refusal found at flush time is dropped, not retried forever', async () => {
  const { AntSave, store } = boot();
  const offline = stubSb(() => NETFAIL);
  await AntSave.write({ sb: offline, table: 'job_tdr', op: 'upsert', row: { job_id: 1 }, key: 'tdr:1' });
  let tries = 0;
  const online = stubSb(() => { tries++; return REFUSED; });
  AntSave.attach(online);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(tries, 1, 'tried once');
  assert.strictEqual(JSON.parse(store.ant_outbox_v1 || '[]').length, 0, 'a refusal never sits in the queue');
});

// ── 6. what the tech can see ────────────────────────────────────────────────────
await ta('a held write puts a visible count on screen', async () => {
  const { AntSave, bar } = boot();
  const sb = stubSb(() => NETFAIL);
  await AntSave.write({ sb, table: 'job_tdr', op: 'upsert', row: { job_id: 1 }, key: 'tdr:1' });
  assert.strictEqual(bar.style.display, 'block', 'the bar shows');
  assert.ok(/on your phone/i.test(bar.textContent), 'says where it is: ' + bar.textContent);
});

// ── 7. the finish gate — LIFTED OUT OF THE SHIPPED PAGE AND EXECUTED ───────────
// Pattern-matching this was not enough: a dead-guarded `if(false && confirm(...))`
// matched the string and the assertion passed. Presence is not reachability. So the
// real block is cut out of tech-job.html and RUN, with the browser stubbed out.
// Anchored on the stable comment header, never on the condition — anchoring on the
// condition makes every mutation read as "the test file crashed" instead of "the
// gate stopped working".
function liftGate() {
  const a = TECHJOB.indexOf('THE FINISH GATE');
  assert.ok(a > 0, 'finish-gate header not found in tech-job.html');
  const s = TECHJOB.lastIndexOf('\n', a) + 1;
  const e = TECHJOB.indexOf('var outcome=outcomeSel;', a);
  assert.ok(e > s, 'finish-gate tail not found');
  return TECHJOB.slice(s, e);
}
// Run the gate for real. Returns { comp, asked, sentToBox, why }.
function runGate(compIn, outcome, answer) {
  const rec = { asked: false, sentToBox: false, why: '', fieldValue: null };
  const box = { value: compIn };
  const sandbox = {
    console,
    window: { confirm(msg) { rec.asked = true; rec.prompt = msg; return answer; } },
    document: { getElementById: (id) => (id === 'tc' ? box : null) },
    needField(id, why) { rec.sentToBox = true; rec.field = id; rec.why = why; },
    fldDirty() {}, paintFlds() {},
  };
  vm.createContext(sandbox);
  const fn = vm.runInContext(
    '(function(comp, outcomeSel){\n' + liftGate() + '\nreturn comp;\n})', sandbox);
  rec.comp = fn(compIn, outcome);
  rec.fieldValue = box.value;
  return rec;
}

await ta('a blank "what failed" ASKS instead of dead-ending', async () => {
  const r = runGate('', 'fixed', true);
  assert.strictEqual(r.asked, true, 'it must ask him, not silently refuse');
  assert.ok(/what failed/i.test(r.prompt || ''), 'the question names the box');
});

await ta('saying nothing failed finishes the job with an honest value', async () => {
  const r = runGate('', 'fixed', true);
  assert.strictEqual(r.comp, 'No failure found', 'the report carries a real value: ' + r.comp);
  assert.strictEqual(r.fieldValue, 'No failure found', 'and the box on screen shows it');
  assert.strictEqual(r.sentToBox, false, 'he is not bounced back up');
});

await ta('saying "let me fill it in" puts him ON the box and stops', async () => {
  const r = runGate('', 'fixed', false);
  assert.strictEqual(r.comp, undefined, 'the finish stops');
  assert.strictEqual(r.sentToBox, true, 'he is taken to the box');
  assert.strictEqual(r.field, 'tc');
  assert.ok(r.why && r.why.length > 10, 'and told why, right there: ' + r.why);
});

await ta('a filled-in report is never interrupted', async () => {
  const r = runGate('Heating element', 'fixed', true);
  assert.strictEqual(r.asked, false, 'no dialog when he filled it in');
  assert.strictEqual(r.comp, 'Heating element');
});

await ta('a return visit or a not-fixable machine is never blocked on it', async () => {
  ['return_needed', 'not_fixable'].forEach((o) => {
    const r = runGate('', o, false);
    assert.strictEqual(r.asked, false, o + ' should not be gated');
    assert.strictEqual(r.sentToBox, false, o + ' should not be bounced');
  });
});

await ta('the old below-the-button-only refusal is gone', async () => {
  assert.ok(!/err\.textContent='Add what failed/.test(TECHJOB),
    'the message that printed under a button he had already scrolled past is gone');
});

await ta('needField scrolls to the box, reddens it, and clears itself', async () => {
  const nf = TECHJOB.slice(TECHJOB.indexOf('function needField('), TECHJOB.indexOf('function saveTdr()'));
  assert.ok(/scrollIntoView/.test(nf), 'takes him to the box');
  assert.ok(/classList\.add\('needs'\)/.test(nf), 'marks it');
  assert.ok(/removeEventListener\('input',clear\)/.test(nf), 'stops nagging once he types');
  assert.ok(/\.fld\.needs\{/.test(TECHJOB), 'the red style ships with it');
});

// ── 8. the page is actually wired to the outbox ─────────────────────────────────
// Cut one function out of the shipped page by name, so an assertion about the
// report save can never be satisfied by an identical line living in the finish.
function fnBody(name, src) {
  const S = src || TECHJOB;
  const a = S.indexOf('function ' + name + '(');
  assert.ok(a > 0, name + ' not found in the shipped page');
  let i = S.indexOf('{', a), depth = 0;
  for (let j = i; j < S.length; j++) {
    if (S[j] === '{') depth++;
    else if (S[j] === '}') { depth--; if (!depth) return S.slice(a, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

await ta('the outbox is loaded, version-busted, and attached', async () => {
  assert.ok(/ant-save\.js\?v=/.test(TECHJOB),
    'a shared .js is NOT covered by the /*.html no-cache rule — it needs its ?v= bumped with its behaviour');
  assert.ok(/AntSave\.attach\(sb\)/.test(TECHJOB), 'attached so held writes drain the moment he opens a job');
});

await ta('the per-field report save goes through the outbox', async () => {
  const f = fnBody('fldSave');
  assert.ok(/AntSave\.write\(/.test(f), 'fldSave must not write straight to the server');
  assert.ok(!/sb\.from\(/.test(f), 'no bare write left in fldSave');
  assert.ok(/key:'tdr:'\+jobId \}/.test(f),
    'keyed on the job and NOTHING else — a unique-per-tap key would queue a separate write per field and defeat the merge');
});

await ta('the tech-to-office note goes through the outbox, as an APPEND', async () => {
  const f = fnBody('sendOfficeNote');
  assert.ok(/AntSave\.write\(/.test(f), 'the note must not write straight to the server');
  assert.ok(!/sb\.from\(/.test(f), 'no bare read-modify-write left in sendOfficeNote');
  assert.ok(/op:'append'/.test(f),
    'a flat copy would blank whatever the office typed while he had no signal');
});

await ta('the finish and the job status both go through the outbox', async () => {
  const f = fnBody('saveTdr');
  assert.ok(/var putTdr=function\(\)\{ return AntSave\.write\(/.test(f), 'the report write');
  assert.ok(/key:'tdr:'\+jobId \}/.test(f),
    'the finish uses the SAME report key as the per-field saves, so a held field and a held finish collapse into one write instead of fighting');
  assert.ok(/key:'jobstatus:'\+jobId/.test(f), 'the status write');
  assert.ok(!/sb\.from\('job_tdr'\)/.test(f), 'no bare report write left in saveTdr');
  const bare = (f.match(/sb\.from\(/g) || []).length;
  assert.strictEqual(bare, 1, 'only the reassign hand-back writes directly, found ' + bare);
});

await ta('a held report never tells him the office has it', async () => {
  const i = TECHJOB.indexOf('if(r.queued){', TECHJOB.indexOf('var putTdr=function'));
  const blk = TECHJOB.slice(i, i + 900);
  assert.ok(/Saved on your phone/.test(blk), 'says where it is');
  assert.ok(/nothing is lost/i.test(blk), 'tells him he can walk away');
  assert.ok(!/Report saved<\/h2>/.test(blk), 'must not claim the report is filed');
});

// ── 9. the tech's DAY LIST — the other surface he works from ───────────────────
// It carried the same dead end, and worse: its gate refused EVERY outcome, so a
// tech coming back for a part could not save either.
function runDayGate(compIn, outcome, answer) {
  const src = fnBody('saveTdr', TECHDAY);
  const a = src.indexOf('THE FINISH GATE');
  assert.ok(a > 0, 'day-list finish-gate header not found');
  const s0 = src.lastIndexOf('\n', a) + 1;
  const e0 = src.indexOf('if (btn){ btn.disabled=true;', a);
  assert.ok(e0 > s0, 'day-list finish-gate tail not found');
  const rec = { asked: false, sentToBox: false, msg: '' };
  const box = { value: compIn, scrollIntoView() {}, focus() {} };
  const sandbox = {
    console, setTimeout,
    window: { confirm(m) { rec.asked = true; rec.prompt = m; return answer; } },
    document: { getElementById: (id) => (id === 'tc7' ? box : null) },
    saveMsg(jid, text, kind) { rec.sentToBox = true; rec.msg = text; rec.kind = kind; },
  };
  vm.createContext(sandbox);
  const fn = vm.runInContext('(function(id, comp, outcome){\n' + src.slice(s0, e0) + '\nreturn comp;\n})', sandbox);
  rec.comp = fn(7, compIn, outcome);
  return rec;
}

await ta('the day list no longer blocks a return visit on "what failed"', async () => {
  const r = runDayGate('', 'return_needed', false);
  assert.strictEqual(r.asked, false, 'a return visit must not be gated');
  assert.strictEqual(r.sentToBox, false, 'and must not be bounced');
  assert.strictEqual(r.comp, '', 'it goes straight through');
});

await ta('the day list asks instead of dead-ending on a finished job', async () => {
  const yes = runDayGate('', 'fixed', true);
  assert.strictEqual(yes.asked, true, 'it asks');
  assert.strictEqual(yes.comp, 'No failure found', 'and finishes with an honest value');
  const no = runDayGate('', 'fixed', false);
  assert.strictEqual(no.comp, undefined, 'the other answer stops the finish');
  assert.ok(/can\u2019t finish without|cannot finish without|can’t finish without/.test(no.msg), 'and says why: ' + no.msg);
});

await ta('the day list writes go through the outbox too', async () => {
  assert.ok(/ant-save\.js\?v=/.test(TECHDAY), 'loaded and version-busted');
  assert.ok(/AntSave\.attach\(sb\)/.test(TECHDAY), 'attached');
  const rep = fnBody('saveTdr', TECHDAY);
  assert.ok(/AntSave\.write\(/.test(rep) && !/sb\.from\('job_tdr'\)/.test(rep), 'the report');
  assert.ok(/key:'jobstatus:'\+id/.test(rep), 'the finish');
  const note = fnBody('sendOfficeNote', TECHDAY);
  assert.ok(/op:'append'/.test(note), 'the note appends rather than clobbering');
  assert.ok(!/sb\.from\(/.test(note), 'no bare read-modify-write left');
});

await ta('a held day-list report keeps its finish, in order', async () => {
  const rep = fnBody('saveTdr', TECHDAY);
  const i = rep.indexOf('if (r.queued){');
  assert.ok(i > 0, 'the queued branch exists');
  const blk = rep.slice(i, i + 800);
  assert.ok(/key:'jobstatus:'\+id/.test(blk), 'the finish is queued behind the report, not dropped');
  assert.ok(/on your phone/i.test(blk), 'and he is told where it is');
  assert.ok(!/Report saved'/.test(blk), 'it must not claim the office has the report');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
