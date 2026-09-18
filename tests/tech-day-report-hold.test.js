// tech-day-report-hold.test.js — John, 2026-09-18:
//   "as he adds things to his report they aren't saving still."
//
// He was right, and it was never the save path. platform/tech.html — the DAY LIST,
// where every tech lands first — had NO per-field save, NO blur handler and NO
// carry-across. Report text reached the server ONLY on the "Save report + finish"
// tap, and the only saveDraft() call in the file lives inside that same handler. So
// before he taps finish, his typing is protected by nothing: not the server, not the
// phone. loadJobs() rebuilds every card from the server and destroys the boxes, and
// it fires from On-my-way, Start, Complete, Confirm-signed, the signature pad, the
// part flag, the job-details edit and every day chip.
//
// The job page got the carry-across on 2026-09-15 for Jimmy's identical bug. The day
// list never did — the fourth time the day list has lagged the job page.
//
// Everything below is LIFTED OUT OF THE SHIPPED PAGE and EXECUTED. Pattern-matching
// the source would only prove the words are there.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const LIST = fs.readFileSync(path.join(ROOT, 'platform', 'tech.html'), 'utf8');
const JOBP = fs.readFileSync(path.join(ROOT, 'platform', 'tech-job.html'), 'utf8');

function lift(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(m, 'could not find function ' + name + ' -- the lift is broken, not the page');
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}
function liftVar(src, name) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\{'));
  assert.ok(m, 'could not find var ' + name);
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1) + ';'; }
  }
  throw new Error('unbalanced braces lifting var ' + name);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── a fake card: the eight report boxes for one job ──────────────────────────────
function makeEl(tag) {
  return {
    tagName: tag || 'INPUT', value: '', className: '', innerHTML: '',
    _a: {}, _ev: {},
    setAttribute(k, v) { this._a[k] = String(v); },
    getAttribute(k) { return k in this._a ? this._a[k] : null; },
    addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); },
    fire(t) { (this._ev[t] || []).forEach((f) => f()); },
    closest() { return null; },
  };
}
const PRE = ['tb', 'tm', 'tc', 'tp', 'tps', 'tr', 'th', 'tno'];

function boot(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const els = {};
  PRE.forEach((p) => { const e = makeEl(p === 'tps' ? 'SELECT' : p === 'tno' ? 'TEXTAREA' : 'INPUT'); els[p + '1'] = e; });

  const writes = [];
  const sandbox = {
    console, Promise, Object, Array, String, Date, Math, JSON, parseFloat, isNaN, setTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { getElementById: (id) => els[id] || null },
    me: { company_id: 'co-1' },
    myTech: { name: 'John Houk' },
    sb: {},
    esc: (s) => String(s),
    msgs: [],
    AntSave: {
      write(o) { writes.push(o); return Promise.resolve(opts.result || { ok: true, queued: false, refused: false }); },
    },
  };
  sandbox.saveMsg = (id, text, kind) => sandbox.msgs.push({ id, text, kind });
  vm.createContext(sandbox);

  const SRC = [
    lift(LIST, 'draftKey'), lift(LIST, 'saveDraft'), lift(LIST, 'clearDraft'), lift(LIST, 'getDraft'),
    lift(LIST, 'draftKind'), lift(LIST, 'saveDraftKind'),
    liftVar(LIST, 'TDR_FLDS'),
    lift(LIST, 'cardTyping'), lift(LIST, 'holdTyping'), lift(LIST, 'fieldBlurSave'),
    lift(LIST, 'wireTdrFields'), lift(LIST, 'restoreDrafts'),
  ].join('\n');
  vm.runInContext(SRC, sandbox);
  return { s: sandbox, els, store, writes };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

let pass = 0, fail = 0;
const ta = async (n, f) => { try { await f(); console.log('  ok  ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + '\n       ' + e.message); fail++; } };

(async () => {
console.log('\ntech-day-report-hold');

// ── 1. the bug itself: typing survives a card rebuild ───────────────────────────
await ta('typing is held on the phone the moment it is typed', async () => {
  const { s, els, store } = boot();
  s.wireTdrFields(1);
  els.tr1.value = 'drain pump seized'; els.tr1.fire('input');
  const d = JSON.parse(store.ant_tdr_draft_1);
  assert.strictEqual(d.row.root_cause, 'drain pump seized', 'his words are on the phone');
  assert.strictEqual(d.kind, 'typing', 'held typing is the typing kind, not a failed save');
});

await ta('a card rebuild puts the typing back — the whole John bug', async () => {
  const { s, els, store } = boot();
  s.wireTdrFields(1);
  els.tc1.value = 'heating element'; els.tc1.fire('input');
  els.tr1.value = 'open circuit';    els.tr1.fire('input');
  // loadJobs() -> innerHTML wipes the card. Fresh, empty boxes.
  PRE.forEach((p) => { els[p + '1'].value = ''; els[p + '1']._a = {}; });
  s.wireTdrFields(1); s.restoreDrafts([{ id: 1 }]);
  assert.strictEqual(els.tc1.value, 'heating element', 'failed component came back');
  assert.strictEqual(els.tr1.value, 'open circuit', 'root cause came back');
});

await ta('restoring held typing says NOTHING — it is not an error', async () => {
  const { s, els } = boot();
  s.wireTdrFields(1);
  els.tr1.value = 'x'; els.tr1.fire('input');
  els.tr1.value = '';
  s.restoreDrafts([{ id: 1 }]);
  assert.strictEqual(s.msgs.length, 0, 'ordinary typing must not shout "never saved": ' + JSON.stringify(s.msgs));
});

await ta('a failed-save draft still shouts — the two drafts are different facts', async () => {
  const { s, els } = boot({ storage: { ant_tdr_draft_1: JSON.stringify({ row: { root_cause: 'burnt' }, at: Date.now() }) } });
  s.restoreDrafts([{ id: 1 }]);
  assert.strictEqual(els.tr1.value, 'burnt', 'the unsent report is back on screen');
  assert.ok(s.msgs.some((m) => m.kind === 'err' && /never saved/i.test(m.text)), 'a failed save is loud');
});

await ta('typing OVERWRITES the re-rendered box; a failed draft never stomps the server', async () => {
  // typing is newer than the render by construction -- he typed it after the last blur.
  const { s, els } = boot();
  s.wireTdrFields(1);
  els.tr1.value = 'bad pump and belt'; els.tr1.fire('input');
  els.tr1.value = 'bad pump';                       // what the server had
  s.restoreDrafts([{ id: 1 }]);
  assert.strictEqual(els.tr1.value, 'bad pump and belt', 'the newer typing wins');

  const b = boot({ storage: { ant_tdr_draft_1: JSON.stringify({ row: { root_cause: 'old' }, at: Date.now() }) } });
  b.els.tr1.value = 'office rewrote this';
  b.s.restoreDrafts([{ id: 1 }]);
  assert.strictEqual(b.els.tr1.value, 'office rewrote this', 'a failed draft only fills blanks');
});

// ── 2. blur saves the field, so nothing waits on the finish tap ─────────────────
await ta('blur sends that one field as a single-column upsert', async () => {
  const { s, els, writes } = boot();
  s.wireTdrFields(1);
  // OTHER boxes are full too. A blur must send ONE column, not sweep the card: the
  // office edits these same fields from the board, and a sweep would stomp whatever
  // they just typed with the stale text sitting in his box.
  els.tr1.value = 'stale text in another box';
  els.tb1.value = 'Whirlpool';
  els.tc1.value = 'lid lock'; els.tc1.fire('input'); els.tc1.fire('blur');
  await tick();
  assert.strictEqual(writes.length, 1, 'one write');
  const w = writes[0];
  assert.strictEqual(w.table, 'job_tdr');
  assert.strictEqual(w.op, 'upsert');
  assert.strictEqual(w.onConflict, 'job_id', 'must upsert on job_id or it creates a second report');
  assert.strictEqual(w.row.failed_component, 'lid lock');
  assert.strictEqual(w.row.job_id, 1);
  assert.strictEqual(w.row.company_id, 'co-1');
  assert.ok(!('root_cause' in w.row), 'blur must not sweep root_cause — PostgREST merge-duplicates leaves unsent columns alone');
  assert.ok(!('brand' in w.row), 'blur must not sweep brand');
  assert.deepStrictEqual(Object.keys(w.row).sort(), ['company_id', 'failed_component', 'job_id', 'tech'],
    'exactly the keyed row + the one column he left: ' + JSON.stringify(w.row));
});

await ta('the report row is attributed from the first keystroke', async () => {
  const { s, els, writes } = boot();
  s.wireTdrFields(1);
  els.tb1.value = 'Whirlpool'; els.tb1.fire('input'); els.tb1.fire('blur');
  await tick();
  assert.strictEqual(writes[0].row.tech, 'John Houk', 'a blur-save can CREATE the row — name him on it');
});

await ta('blur with nothing changed does not write', async () => {
  const { s, els, writes } = boot();
  els.tr1.value = 'already on the server';
  s.wireTdrFields(1);                 // snapshots the rendered value
  els.tr1.fire('blur');
  await tick();
  assert.strictEqual(writes.length, 0, 'no-op blur must not hit the network');
});

await ta('an empty box that was never filled does not write', async () => {
  const { s, els, writes } = boot();
  s.wireTdrFields(1);
  els.tno1.fire('blur');
  await tick();
  assert.strictEqual(writes.length, 0);
});

await ta('clearing a box that HAD a value writes null', async () => {
  const { s, els, writes } = boot();
  els.tr1.value = 'was here';
  s.wireTdrFields(1);
  els.tr1.value = ''; els.tr1.fire('blur');
  await tick();
  assert.strictEqual(writes.length, 1, 'erasing is a real edit');
  assert.strictEqual(writes[0].row.root_cause, null, 'sends null, not ""');
});

await ta('labor hours go over as a number, junk goes over as null', async () => {
  let { s, els, writes } = boot();
  s.wireTdrFields(1);
  els.th1.value = '2.5'; els.th1.fire('input'); els.th1.fire('blur');
  await tick();
  assert.strictEqual(writes[0].row.labor_hours, 2.5, 'numeric column gets a number');

  ({ s, els, writes } = boot());
  s.wireTdrFields(1);
  els.th1.value = 'about two'; els.th1.fire('input'); els.th1.fire('blur');
  await tick();
  assert.strictEqual(writes[0].row.labor_hours, null, 'a numeric column can never take words');
});

await ta('the part-status dropdown saves on change, not only on blur', async () => {
  const { s, els, writes } = boot();
  s.wireTdrFields(1);
  els.tps1.value = 'please_order'; els.tps1.fire('change');
  await tick();
  assert.ok(writes.some((w) => w.row.part_status === 'please_order'), 'a picker has no blur on a phone');
});

// ── 3. a landed field stops being held; a queued one keeps being held ───────────
await ta('a field the server took is dropped from the draft', async () => {
  const { s, els, store } = boot();
  s.wireTdrFields(1);
  els.tc1.value = 'element'; els.tc1.fire('input');
  els.tr1.value = 'burnt';   els.tr1.fire('input');
  els.tc1.fire('blur');
  await tick();
  const d = JSON.parse(store.ant_tdr_draft_1);
  assert.ok(!('failed_component' in d.row), 'it is on the server now — stop holding it');
  assert.strictEqual(d.row.root_cause, 'burnt', 'the field he has NOT sent is still held');
});

await ta('a QUEUED field is still held — queued is on the phone, not on the server', async () => {
  const { s, els, store } = boot({ result: { ok: false, queued: true, refused: false } });
  s.wireTdrFields(1);
  els.tc1.value = 'element'; els.tc1.fire('input');
  els.tc1.fire('blur');
  await tick();
  const d = JSON.parse(store.ant_tdr_draft_1);
  assert.strictEqual(d.row.failed_component, 'element', 'a dead zone must not look like a save');
});

await ta('a REFUSED field says so out loud and is still held', async () => {
  const { s, els, store } = boot({ result: { ok: false, queued: false, refused: true, message: 'blocked' } });
  s.wireTdrFields(1);
  els.tr1.value = 'x'; els.tr1.fire('input'); els.tr1.fire('blur');
  await tick();
  assert.ok(s.msgs.some((m) => m.kind === 'err' && /did NOT save/i.test(m.text)), 'refusal is never silent');
  assert.ok(JSON.parse(store.ant_tdr_draft_1).row.root_cause, 'still held on the phone');
});

// ── 4. the wiring itself, on the real page ─────────────────────────────────────
await ta('every report box on the page is in the map', async () => {
  const { s } = boot();
  const cols = Object.keys(s.TDR_FLDS);
  ['tb', 'tm', 'tc', 'tp', 'tps', 'tr', 'th', 'tno'].forEach((p) => {
    assert.ok(cols.indexOf(p) >= 0, 'box ' + p + ' has no column mapped — it would silently never save');
  });
});

await ta('renderJobs wires the boxes BEFORE it restores drafts', async () => {
  // Reversed, wireTdrFields snapshots the DRAFT as data-saved and blur skips the write.
  const body = stripComments(lift(LIST, 'renderJobs'));
  const w = body.indexOf('wireTdrFields(');
  const r = body.indexOf('restoreDrafts(');
  assert.ok(w > 0, 'renderJobs never wires the fields — save-on-blur is dead code');
  assert.ok(r > 0, 'renderJobs never restores drafts');
  assert.ok(w < r, 'wire must run first or the first blur after a rebuild is a no-op');
});

await ta('wiring is idempotent — a second pass does not double-bind', async () => {
  const { s, els, writes } = boot();
  s.wireTdrFields(1); s.wireTdrFields(1);
  els.tr1.value = 'x'; els.tr1.fire('input'); els.tr1.fire('blur');
  await tick();
  assert.strictEqual(writes.length, 1, 'one blur must be one write');
});

// ── 5. Lee: a waiver signed on the customer's phone shows up by itself ──────────
await ta('the day list watches for a release signed elsewhere', async () => {
  const src = stripComments(LIST);
  assert.ok(/function\s+checkWaivers\s*\(/.test(src), 'no waiver re-read at all');
  assert.ok(/watchWaivers\s*\(\s*\)\s*;/.test(src), 'the watcher is never started');
  assert.ok(/visibilitychange/.test(src), 'nothing re-reads when he comes back to the app');
  assert.ok(/waiver_signed_at/.test(src.slice(src.indexOf('function checkWaivers'))), 'it must read the signed stamp');
});

await ta('the waiver check patches one line — it does not rebuild the cards', async () => {
  // A full loadJobs() on a timer would destroy whatever he is typing. That is exactly
  // why the hold-on-type work above had to land with this, not after it.
  const src = stripComments(LIST);
  const i = src.indexOf('function checkWaivers');
  const j = src.indexOf('function watchWaivers');
  const body = src.slice(i, j);
  assert.ok(!/loadJobs\s*\(/.test(body), 'a background refresh must never rebuild a card he is typing in');
  assert.ok(/\.select\(\s*['"]id,waiver_signed_at,waiver_name['"]/.test(body), 'reads three columns, not the whole day');
});

await ta('the JOB PAGE watches for it too — he texts the link from either screen', async () => {
  const src = stripComments(JOBP);
  assert.ok(/function\s+checkWaiver\s*\(/.test(src), 'the job page never re-reads the release');
  assert.ok(/watchWaiver\s*\(\s*\)\s*;/.test(src), 'the watcher is never started on the job page');
  assert.ok(/visibilitychange/.test(src), 'nothing re-reads when he comes back to the app');
});

await ta('the job page patches the banner — it does not re-render the whole job', async () => {
  const src = stripComments(JOBP);
  const body = src.slice(src.indexOf('function checkWaiver'), src.indexOf('function watchWaiver'));
  assert.ok(!/loadJob\s*\(/.test(body), 'a full re-render on a timer would blow away his typing, his scroll and any open panel');
  assert.ok(/\.select\(\s*['"]id,waiver_signed_at,waiver_name['"]/.test(body), 'reads three columns, not the whole job');
});

await ta('a signed release clears the finish gate in memory', async () => {
  // Otherwise the tech signs, the banner flips, and Complete still asks "Release isn't
  // signed. Confirm the customer signed it?" about a release that IS signed.
  const body = stripComments(lift(JOBP, 'paintWaiverSigned'));
  assert.ok(/job\.waiver_signed_at\s*=/.test(body), 'must update the in-memory job or the finish gate keeps prompting');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
