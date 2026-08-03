// Unit tests for the forward-eval grading logic (pure, no network).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ev = require('../netlify/functions/_lib/brain-eval.js');

test('normalizePart: case + dashes/spaces collapse (kills false mismatches)', () => {
  assert.equal(ev.normalizePart('w10-190965'), 'W10190965');
  assert.equal(ev.normalizePart('W10 190 965'), 'W10190965');
  assert.equal(ev.normalizePart(null), '');
});

test('normalizeComponent: "Ice Maker" == "icemaker"', () => {
  assert.equal(ev.normalizeComponent('Ice Maker'), 'icemaker');
  assert.equal(ev.normalizeComponent('icemaker'), 'icemaker');
});

test('gradeAgainstOutcome: top-1 / top-3 / component matching', () => {
  const pred = {
    pred_parts: [{ part: 'W10190965', confidence: 0.8 }, { part: 'WPW10730972' }, { part: 'W11XYZ' }],
    pred_component: 'Ice Maker',
  };
  // exact fix as #1, with formatting + component-spacing differences → all hit
  let g = ev.gradeAgainstOutcome(pred, { actual_part: 'w10-190965', actual_component: 'icemaker assembly' });
  assert.equal(g.hit_top1, true);
  assert.equal(g.hit_top3, true);
  assert.equal(g.component_hit, true);

  // fix was the 2nd guess → top3 but not top1
  g = ev.gradeAgainstOutcome(pred, { actual_part: 'WPW10730972' });
  assert.equal(g.hit_top1, false);
  assert.equal(g.hit_top3, true);

  // total miss
  g = ev.gradeAgainstOutcome(pred, { actual_part: 'DA97-22162A' });
  assert.equal(g.hit_top1, false);
  assert.equal(g.hit_top3, false);
});

test('gradeAgainstOutcome: no actual data → ungradeable (null), not a miss', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: [{ part: 'X' }], pred_component: 'pump' }, { actual_part: '', actual_component: '' });
  assert.equal(g.part_gradeable, false);
  assert.equal(g.hit_top1, null);
  assert.equal(g.hit_top3, null);
  assert.equal(g.component_hit, false);
});

test('gradeAgainstOutcome: accepts bare-string parts too', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: ['W10190965', 'ABC'] }, { actual_part: 'W10190965' });
  assert.equal(g.hit_top1, true);
});

test('extractPartTokens: pulls part#s out of messy tech notes', () => {
  assert.deepEqual(ev.extractPartTokens('Range Oven Door Outer Panel (White) WPW10118454'), ['WPW10118454']);
  assert.deepEqual(ev.extractPartTokens('Ccuasm, Vmax Part #W11101488, Actuator Part #W10815026'), ['W11101488', 'W10815026']);
  assert.deepEqual(ev.extractPartTokens('DA97-22162A'), ['DA9722162A']);          // dashes are internal to a part#
  assert.deepEqual(ev.extractPartTokens('No part needed'), []);                    // nothing to grade
  assert.deepEqual(ev.extractPartTokens('compressor'), []);                        // component name, no part#
});

test('gradeAgainstOutcome: right guess buried in a free-text note = HIT, not miss', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: ['WPW10118454', 'X2', 'X3'] }, { actual_part: 'Range Oven Door Outer Panel (White) WPW10118454' });
  assert.equal(g.part_gradeable, true);
  assert.equal(g.hit_top1, true);
});

test('gradeAgainstOutcome: matches ANY part in a multi-part fix', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: ['W10815026'] }, { actual_part: 'Ccuasm, Vmax Part #W11101488, Actuator Part #W10815026' });
  assert.equal(g.hit_top1, true);   // guessed one of the two real parts
});

test('gradeAgainstOutcome: "No part needed" is ungradeable, never a miss', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: ['WPW10121138'] }, { actual_part: 'No part needed' });
  assert.equal(g.part_gradeable, false);
  assert.equal(g.hit_top1, null);
});

test('gradeAgainstOutcome: component-only fix grades the component tier even when part is ungradeable', () => {
  const g = ev.gradeAgainstOutcome({ pred_parts: ['WPW10310240'], pred_component: 'Compressor' }, { actual_part: 'compressor', actual_component: 'compressor' });
  assert.equal(g.part_gradeable, false);
  assert.equal(g.hit_top1, null);
  assert.equal(g.component_hit, true);
});
