'use strict';
// John, 2026-09-16: "the sign button not working now for the customer to sign — he said it
// worked earlier." It is not a dead button, it is the signature PAD, and it is a timing race,
// which is exactly why it comes and goes.
//
// platform/tech.html's openSignPad still carried the defect tech-job.html had fixed on
// 2026-09-14: it floored a zero measurement to a 1x1 bitmap (Math.max(1,...)) that silently
// swallows every stroke, and it wired sizePad straight to 'resize' — where re-committing
// canvas.width CLEARS the canvas. The customer's name field sits right above the pad, so the
// phone keyboard opening or closing fires resize and wipes a signature already drawn.
//
// These tests LIFT the real sizePad/ensureSized out of the shipped page and EXECUTE them
// against a fake canvas. Pattern-matching would only prove the words are there.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'platform', 'tech.html');
const SRC = fs.readFileSync(FILE, 'utf8');

// Anchor the lift on the STABLE comment header, never on the condition — anchoring on the
// condition means every mutation breaks the LIFT and reads as "the test file crashed"
// instead of "the guard stopped working".
const ANCHOR = "// Size the bitmap to the real pixel density";

function liftPad() {
  const a = SRC.indexOf(ANCHOR);
  assert.ok(a > 0, 'sizePad block still carries its comment header');
  const end = SRC.indexOf("window.addEventListener('resize', sizePad)", a);
  assert.ok(end > a, 'the pad is still wired to resize');
  return SRC.slice(a, end);
}

// A canvas that behaves like the real one in the ONE way that matters: assigning .width or
// .height clears the bitmap. That is the whole reason a blind re-commit destroys a signature.
function makeCanvas(rect) {
  const cv = {
    _w: 0, _h: 0, ink: 0, clears: 0,
    get width() { return this._w; },
    set width(v) { this._w = v; this.ink = 0; this.clears++; },
    get height() { return this._h; },
    set height(v) { this._h = v; this.ink = 0; },
    getBoundingClientRect() { return rect(); },
  };
  return cv;
}

function run(rect, dpr = 2) {
  const cv = makeCanvas(rect);
  const ctx = { setTransform() {}, lineWidth: 0, lineCap: '', lineJoin: '', strokeStyle: '' };
  const raf = [];
  const sandbox = {
    cv, ctx,
    window: { devicePixelRatio: dpr, addEventListener() {} },
    requestAnimationFrame: (fn) => raf.push(fn),
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(liftPad() + '\nthis.sizePad = sizePad; this.ensureSized = ensureSized; this.isSized = function(){ return sized; };', sandbox);
  return { cv, sandbox, raf };
}

test('a pad that has not been laid out yet is REFUSED, not floored to 1x1', () => {
  const { cv, sandbox } = run(() => ({ width: 0, height: 0 }));
  assert.strictEqual(sandbox.sizePad(), false, 'sizePad reports it could not measure');
  assert.notStrictEqual(cv.width, 1, 'it does NOT bake a 1x1 bitmap that swallows strokes');
  assert.strictEqual(cv.width, 0, 'nothing is committed from a zero rect');
});

test('a refused first measure is retried on the next frame', () => {
  let w = 0;
  const { cv, raf } = run(() => ({ width: w, height: 190 }));
  assert.strictEqual(raf.length, 1, 'a failed size schedules exactly one rAF retry');
  w = 300;                       // layout settles
  raf[0]();                      // the retry runs
  assert.strictEqual(cv.width, 600, 'the retry commits the real size (300 * dpr 2)');
});

test('a real measurement sizes the pad for the device pixel ratio', () => {
  const { cv, sandbox } = run(() => ({ width: 320, height: 190 }));
  assert.strictEqual(sandbox.sizePad(), true);
  assert.strictEqual(cv.width, 640);
  assert.strictEqual(cv.height, 380);
});

// THE ONE THAT MATTERS: the keyboard opening/closing fires resize. If resize re-commits the
// same dimensions, the customer's half-drawn signature is erased under their finger.
test('re-measuring the SAME size does not wipe a signature already drawn', () => {
  const { cv, sandbox } = run(() => ({ width: 320, height: 190 }));
  sandbox.sizePad();
  cv.ink = 5;                    // the customer signs
  const clearsBefore = cv.clears;
  sandbox.sizePad();             // keyboard opens  -> resize
  sandbox.sizePad();             // keyboard closes -> resize
  assert.strictEqual(cv.ink, 5, 'the signature survives the keyboard');
  assert.strictEqual(cv.clears, clearsBefore, 'the bitmap was never re-committed');
});

test('a genuine size change DOES re-commit (rotate the phone)', () => {
  let w = 320;
  const { cv, sandbox } = run(() => ({ width: w, height: 190 }));
  sandbox.sizePad();
  cv.ink = 5;
  w = 700;                       // landscape
  sandbox.sizePad();
  assert.strictEqual(cv.width, 1400, 'the new width is committed');
  assert.strictEqual(cv.ink, 0, 'and clearing on a real resize is expected');
});

test('the first finger-down sizes a pad that was never laid out at open time', () => {
  let w = 0;
  const { cv, sandbox } = run(() => ({ width: w, height: 190 }));
  assert.strictEqual(sandbox.isSized(), 0, 'it opened unsized');
  w = 320;                       // laid out by the time a finger lands
  sandbox.ensureSized();
  assert.strictEqual(cv.width, 640, 'the stroke lands on a correctly-sized pad');
});

test('ensureSized does not re-size a pad that is already good', () => {
  const { cv, sandbox } = run(() => ({ width: 320, height: 190 }));
  sandbox.sizePad();
  cv.ink = 5;
  const clearsBefore = cv.clears;
  sandbox.ensureSized();
  assert.strictEqual(cv.ink, 5, 'an already-sized pad is left alone mid-signature');
  assert.strictEqual(cv.clears, clearsBefore);
});

// Non-vacuity: prove the shipped file really carries the guard, not just that a lifted
// copy behaves. Comments stripped so an assertion can never fire on the explanation.
test('the shipped page refuses a zero rect and never floors the bitmap', () => {
  const block = liftPad().replace(/\/\/[^\n]*/g, '');
  assert.ok(/r\.width\s*>\s*0\s*&&\s*r\.height\s*>\s*0/.test(block), 'it checks the rect is real');
  assert.ok(!/Math\.max\s*\(\s*1\s*,/.test(block), 'no Math.max(1, ...) floor survives');
});

test('the shipped page guards the re-commit behind a dimension change', () => {
  const block = liftPad().replace(/\/\/[^\n]*/g, '');
  assert.ok(/if\s*\(\s*w\s*!==\s*lastW\s*\|\|\s*h\s*!==\s*lastH\s*\)/.test(block),
    'canvas.width is only assigned when the size actually changed');
});

test('the first finger-down is wired to ensureSized on a LIVE line of start()', () => {
  const i = SRC.indexOf('function start(e){');
  assert.ok(i > 0, 'start() is still there');
  const line = SRC.slice(i, SRC.indexOf('\n', i)).replace(/\/\/.*$/, '');
  assert.ok(/ensureSized\s*\(/.test(line), 'start() calls ensureSized');
  assert.ok(!/(false|0|null|undefined)\s*&&\s*ensureSized/.test(line), 'and it is not short-circuited off');
});
