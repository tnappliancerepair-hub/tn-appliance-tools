// Sofia 2026-09-16: "I submitted a report yesterday and copied and pasted the information
// from the job board into AHS and it left it all blank. I had to resubmit and type out."
//
// Cause: the office drawer renders the report as <input>/<textarea>, and a drag-selection
// across a page SKIPS form-control contents. Selecting the panel and hitting copy yields the
// labels with nothing between them. The panel also never showed the part number at all --
// measured 307 of 412 filed AHS/Frontdoor reports carry one the office could not see.
//
// These lift the real helpers OUT of the shipped page and EXECUTE them, so the test cannot
// drift from what the office actually gets.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'platform', 'office-board.html'), 'utf8');

// Comments explain the rules; they must never be what satisfies one.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// Lift a named function by brace-balancing from its declaration.
function liftFn(name, src) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'office-board.html no longer defines ' + name + '()');
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'could not brace-balance ' + name);
  return src.slice(start, end);
}

// ── copyText: the honesty guard ────────────────────────────────────────────────────────
function makeCopyEnv({ clipboardOk = null, execOk = false, secure = true } = {}) {
  const calls = { written: [], exec: 0 };
  const sandbox = {
    navigator: clipboardOk === null ? {} : {
      clipboard: {
        writeText(s) {
          calls.written.push(s);
          return clipboardOk ? Promise.resolve() : Promise.reject(new Error('refused'));
        },
      },
    },
    window: { isSecureContext: secure },
    document: {
      createElement: () => ({
        style: {}, setAttribute() {}, select() { }, setSelectionRange() {},
        set value(v) { calls.taValue = v; }, get value() { return calls.taValue; },
      }),
      body: { appendChild() {}, removeChild() {} },
      execCommand(cmd) { calls.exec++; return execOk; },
    },
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext(liftFn('copyText', SRC) + '; this.copyText = copyText;', sandbox);
  return sandbox;
}

function copyOnce(env, str) {
  return new Promise((resolve) => {
    env.copyText(str, () => resolve({ ok: true }), (why) => resolve({ ok: false, why }));
  });
}

test('a clipboard write that lands reports success', async () => {
  const env = makeCopyEnv({ clipboardOk: true });
  const r = await copyOnce(env, 'Failed: heating element');
  assert.equal(r.ok, true);
  assert.deepEqual(env.calls.written, ['Failed: heating element']);
});

test('a REFUSED clipboard write falls back, and a failed fallback reports failure', async () => {
  const env = makeCopyEnv({ clipboardOk: false, execOk: false });
  const r = await copyOnce(env, 'Failed: heating element');
  assert.equal(r.ok, false, 'a refused copy must never report success');
  assert.match(r.why, /by hand/i, 'must tell her what to do instead');
  assert.equal(env.calls.exec, 1, 'must have tried the execCommand fallback');
});

test('no clipboard API at all still copies via the fallback', async () => {
  const env = makeCopyEnv({ clipboardOk: null, execOk: true });
  const r = await copyOnce(env, 'Part 279838');
  assert.equal(r.ok, true);
  assert.equal(env.calls.taValue, 'Part 279838', 'the fallback must carry the real value');
});

test('an insecure context skips the clipboard API and uses the fallback', async () => {
  const env = makeCopyEnv({ clipboardOk: true, execOk: true, secure: false });
  const r = await copyOnce(env, 'x');
  assert.equal(r.ok, true);
  assert.equal(env.calls.written.length, 0, 'must not call clipboard API off a secure context');
  assert.equal(env.calls.exec, 1);
});

test('an empty field says so instead of silently "copying" nothing', async () => {
  for (const blank of ['', '   ', null, undefined]) {
    const env = makeCopyEnv({ clipboardOk: true });
    const r = await copyOnce(env, blank);
    assert.equal(r.ok, false, JSON.stringify(blank) + ' must not report a successful copy');
    assert.match(r.why, /nothing/i);
  }
});

// ── claimText: what actually lands in the AHS claim ────────────────────────────────────
function makeClaimEnv(fields, outcomeValue, row) {
  const outs = SRC.match(/var TDR_OUTCOMES = \[[\s\S]*?\];/);
  assert.ok(outs, 'TDR_OUTCOMES is gone');
  const sandbox = {
    document: { getElementById: (id) => (id in fields ? { value: fields[id] } : null) },
    box: {
      querySelector: (sel) =>
        sel.includes('.on') && outcomeValue ? { getAttribute: () => outcomeValue } : null,
    },
    t: row || {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    outs[0] + ';' + liftFn('tdrVal', SRC) + ';' + liftFn('outcomeLabel', SRC) + ';' +
    liftFn('claimText', SRC) + '; this.claimText = claimText; this.outcomeLabel = outcomeLabel;',
    sandbox,
  );
  return sandbox;
}

test('the copied report carries the part number the panel used to hide', () => {
  const env = makeClaimEnv(
    { t_model: 'WTW5000DW1', t_fc: 'Hub and actuator', t_pn: 'W10721967',
      t_rc: 'Clothes still wet after spin', t_notes: 'Ordered the hub', t_lh: '1.5' },
    'return_needed', { brand: 'Whirlpool' },
  );
  const out = env.claimText();
  assert.match(out, /W10721967/, 'the part number is the whole reason this exists');
  assert.match(out, /Whirlpool WTW5000DW1/);
  assert.match(out, /Hub and actuator/);
  assert.match(out, /Clothes still wet after spin/);
  assert.match(out, /Ordered the hub/);
  assert.match(out, /1\.5 hrs/);
});

test('the outcome copies as words, not an emoji', () => {
  const env = makeClaimEnv({ t_fc: 'x' }, 'return_needed', {});
  assert.equal(env.outcomeLabel(), 'Needs another stop');
  assert.doesNotMatch(env.claimText(), /🔁/, 'an emoji is not something you paste into a claim');
});

test('one labor hour is singular', () => {
  const env = makeClaimEnv({ t_fc: 'x', t_lh: '1' }, null, {});
  assert.match(env.claimText(), /Labor: 1 hr\b/);
});

test('empty fields are left out rather than pasted as empty labels', () => {
  const env = makeClaimEnv({ t_model: '', t_fc: 'Heating element', t_pn: '', t_rc: '', t_notes: '', t_lh: '' }, null, {});
  const out = env.claimText();
  assert.match(out, /Failed: Heating element/);
  assert.doesNotMatch(out, /What happened/);
  assert.doesNotMatch(out, /Tech notes/);
  assert.doesNotMatch(out, /Labor/);
  assert.doesNotMatch(out, /Machine/);
});

test('a report with no failed component still copies the part number', () => {
  const env = makeClaimEnv({ t_fc: '', t_pn: 'DA97-22162A' }, null, {});
  assert.match(env.claimText(), /DA97-22162A/);
});

// ── the panel itself ───────────────────────────────────────────────────────────────────
test('the office panel shows the part number and notes the tech filed', () => {
  const clean = stripComments(SRC);
  for (const id of ['t_pn', 't_notes']) {
    assert.ok(clean.includes('id="' + id + '"'), 'office TDR panel lost ' + id);
  }
  assert.match(clean, /esc\(t\.part_number\|\|''\)/, 'part number must render from the tech row');
  assert.match(clean, /esc\(t\.notes\|\|''\)/, 'notes must render from the tech row');
});

test('every report field carries its own copy button', () => {
  const clean = stripComments(SRC);
  for (const id of ['t_model', 't_fc', 't_pn', 't_rc', 't_notes', 't_lh']) {
    assert.ok(
      clean.includes("lab('") && new RegExp("lab\\('[^']*','" + id + "'\\)").test(clean),
      id + ' has no copy button — she would have to hand-select it again',
    );
  }
  assert.ok(clean.includes('id="t_copyall"'), 'the whole-report copy button is gone');
});

test('the new fields save under the never-blank rule', () => {
  const clean = stripComments(SRC);
  assert.match(clean, /keep\('part_number',\s*document\.getElementById\('t_pn'\)\.value,\s*t\.part_number\)/,
    'part_number must go through keep() or the office can blank what the tech filed');
  assert.match(clean, /keep\('notes',\s*document\.getElementById\('t_notes'\)\.value,\s*t\.notes\)/,
    'notes must go through keep()');
});

// ── Danielle 2026-09-16: "on the old Xano system she had a Copy all button, on the new
// Supabase one each area has its own little copy area — she really liked that last one."
//
// The whole-report copy ALREADY existed here. It read "Copy the whole report" and sat at the
// BOTTOM of the panel next to Save, under two textareas and a 6-button outcome grid. The Xano
// button she likes says "Copy all" and lives in the panel HEADER. A feature she cannot NAME,
// in a place she does not look, is a feature she does not have.
test('Copy all is in the TDR panel HEADER, by the name she hunts for', () => {
  const clean = stripComments(SRC);
  // Two other lines say "TDR — technician report" (the loading + error placeholders).
  // The REAL rendered header is the one carrying the claim hint — pin that one.
  const hdr = clean.split('\n').find((l) => l.includes('class="sec"')
    && l.includes('TDR — technician report')
    && l.includes('what the office files the claim from'));
  assert.ok(hdr, 'the TDR panel section header is gone');
  assert.ok(/id="t_copyall_top"/.test(hdr), 'Copy all is not in the panel header — she scrolls past it');
  assert.ok(/📋 Copy all</.test(hdr), 'the header button must read "Copy all" — the words she looks for');
});

test('the button next to Save reads "Copy all" too', () => {
  const clean = stripComments(SRC);
  assert.ok(/id="t_copyall">📋 Copy all</.test(clean),
    'the bottom copy button must carry the same name, or one of the two is unfindable');
  assert.ok(!/Copy the whole report</.test(clean),
    'the old wording is back — she does not scan for "the whole report"');
});

test('both Copy all buttons run the SAME composer — no second copy of the rule', () => {
  const clean = stripComments(SRC);
  assert.ok(/\['t_copyall_top'\s*,\s*'t_copyall'\]/.test(clean),
    'both copy buttons must be wired from one list');
  const composes = clean.match(/copyText\(\s*claimText\(\)/g) || [];
  assert.strictEqual(composes.length, 1,
    'claimText is composed in more than one place — the emoji-vs-words rule will drift');
  // and the one call site must be REACHABLE. Presence is not reachability: a falsy
  // short-circuit in front of it reads as wired and does nothing.
  const guarded = /(?:false|0|null|undefined)\s*&&\s*copyText\(\s*claimText\(\)/.test(clean);
  assert.ok(!guarded, 'the copy call is dead-guarded — the button would do nothing');
});
