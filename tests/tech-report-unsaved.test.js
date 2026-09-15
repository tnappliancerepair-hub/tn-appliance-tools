// tech-job — a re-render must never eat what the tech is typing.
//
// Jimmy, 2026-09-15, from the field: "Not saving in the (what failed) box." He was right.
// render() rebuilds the whole report card from the server copy of the TDR, and loadJob() ->
// render() is fired by ordinary actions -- adding a photo is the one that got him. He types
// the failed component, taps the camera, the upload succeeds, loadJob() runs, and the box he
// just filled comes back EMPTY with a button under it reading "Saved". Nothing had saved and
// nothing said so.
//
// The two helpers are LIFTED OUT OF THE SHIPPED FILE and EXECUTED against a fake DOM, so this
// test can never drift from what a tech actually gets. Pattern-matching the source would only
// prove the words are there; executing proves the behavior.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const SRC = fs.readFileSync(require.resolve('../platform/tech-job.html'), 'utf8');

// Anchored to the FUNCTION and to its closing brace at this file's 2-space indent -- never to
// a character count. (?:async )? matters on any lift: without it the match can start mid-token
// inside "async function" and hand back a sync body full of awaits that will not parse.
function lift(name) {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([\\s\\S]*?\\n  \\}`, 'm');
  const m = re.exec(SRC);
  assert.ok(m, `could not lift ${name}() out of tech-job.html`);
  return m[0];
}

const FLD_COLS = { tb: 'brand', tm: 'model', tc: 'failed_component', tp: 'part_number', tr: 'root_cause', th: 'labor_hours' };

function harness() {
  const els = {};
  const doc = { getElementById: (id) => els[id] || null };
  const fldLast = {};
  let painted = 0;
  const body = [lift('grabUnsavedFlds'), lift('restoreUnsavedFlds')].join('\n')
    + '\nreturn { grabUnsavedFlds: grabUnsavedFlds, restoreUnsavedFlds: restoreUnsavedFlds };';
  const H = new Function('FLD_COLS', 'fldLast', 'document', 'fldDirty', 'paintFlds', body)(
    FLD_COLS, fldLast, doc, function () {}, function () { painted++; });
  const mk = (v) => ({ value: v, classList: { toggle() {}, contains() { return false; } } });
  return { els, fldLast, H, mk, painted: () => painted };
}

test('text the tech typed but has not saved is carried across a re-render', () => {
  const h = harness();
  h.els.tc = h.mk('Heating element burned open'); h.fldLast.tc = '';
  const carried = h.H.grabUnsavedFlds();
  assert.strictEqual(carried.tc, 'Heating element burned open');
  // the photo upload rebuilds the card from the server, which has nothing yet
  h.els.tc = h.mk('');
  h.H.restoreUnsavedFlds(carried);
  assert.strictEqual(h.els.tc.value, 'Heating element burned open', 'his typing must survive');
});

test('a field already on the server is NOT carried — it would fight the server copy', () => {
  const h = harness();
  h.els.tr = h.mk('already saved'); h.fldLast.tr = 'already saved';
  assert.deepStrictEqual(h.H.grabUnsavedFlds(), {});
});

test('an empty untouched field carries nothing', () => {
  const h = harness();
  h.els.tb = h.mk('');       h.fldLast.tb = '';
  h.els.tm = h.mk('   ');    h.fldLast.tm = '';
  assert.deepStrictEqual(h.H.grabUnsavedFlds(), {});
});

test('restore NEVER clobbers a newer value that arrived from the server', () => {
  // The office can fill the same TDR from the board. If the re-render brought down real text,
  // the tech's stale local copy must lose -- silently overwriting the office is the 2026-09-08
  // bug in the other direction.
  const h = harness();
  h.els.tc = h.mk('office typed this while he was out');
  h.H.restoreUnsavedFlds({ tc: 'stale local text' });
  assert.strictEqual(h.els.tc.value, 'office typed this while he was out');
});

test('every report column is eligible, not just the one Jimmy reported', () => {
  const h = harness();
  Object.keys(FLD_COLS).forEach((id) => { h.els[id] = h.mk('typed ' + id); h.fldLast[id] = ''; });
  assert.deepStrictEqual(Object.keys(h.H.grabUnsavedFlds()).sort(), Object.keys(FLD_COLS).sort());
});

test('restore is unconditionally safe — null, empty, and missing elements', () => {
  const h = harness();
  assert.doesNotThrow(() => h.H.restoreUnsavedFlds(null));
  assert.doesNotThrow(() => h.H.restoreUnsavedFlds({}));
  assert.doesNotThrow(() => h.H.restoreUnsavedFlds({ nosuchfield: 'x' }));
});

test('render() captures BEFORE it rebuilds, and restores AFTER the fields are re-wired', () => {
  // Order is the whole fix. wireFieldSaves() resets fldLast from the fresh DOM, so a restore
  // that ran first would be wiped; a capture that ran after the rebuild would find nothing.
  const grab = SRC.indexOf('var carried = grabUnsavedFlds();');
  const wire = SRC.indexOf('wireFieldSaves();');
  const restore = SRC.indexOf('restoreUnsavedFlds(carried);');
  assert.ok(grab > 0 && wire > 0 && restore > 0, 'all three calls must be present');
  assert.ok(grab < wire, 'capture must happen before the DOM is rebuilt');
  assert.ok(wire < restore, 'restore must happen after wireFieldSaves resets fldLast');
});

test('an EMPTY report box never claims to be Saved', () => {
  // The button doubles as the status line. Reading "Saved" over a box with nothing in it is
  // exactly what told Jimmy his text had landed when it had not.
  const body = lift('fldDirty') + '\nreturn fldDirty;';
  const els = {};
  const doc = { getElementById: (id) => els[id] || null };
  const fldLast = {};
  const fldDirty = new Function('fldLast', 'document', body)(fldLast, doc);
  const mkBtn = () => ({ textContent: '', classList: { toggle() {} } });

  els.tc = { value: '' };                 els.fsbtn_tc = mkBtn(); fldLast.tc = '';
  fldDirty('tc');
  assert.notStrictEqual(els.fsbtn_tc.textContent, 'Saved', 'an empty box must not read "Saved"');

  els.tc = { value: 'Drain pump' };       fldLast.tc = 'Drain pump';
  fldDirty('tc');
  assert.match(els.fsbtn_tc.textContent, /Saved/, 'a field that really is saved says so');

  els.tc = { value: 'Drain pump, seized' }; fldLast.tc = 'Drain pump';
  fldDirty('tc');
  assert.strictEqual(els.fsbtn_tc.textContent, 'Save', 'unsaved edits ask to be saved');
});
