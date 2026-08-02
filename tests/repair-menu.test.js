// Money logic — the flat-rate parts pricing rule + repair price-book.
// Runs with zero deps via Node's built-in test runner: `node --test`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../netlify/functions/_lib/repair-menu.js');

test('sellPrice: parts formula (cost ÷ .75 at $30+, else cost + $10)', () => {
  assert.equal(menu.sellPrice(20), 30);        // under $30 → +$10
  assert.equal(menu.sellPrice(29.99), 39.99);  // just under → +$10
  assert.equal(menu.sellPrice(30), 40);        // $30 → cost / 0.75
  assert.equal(menu.sellPrice(45), 60);
  assert.equal(menu.sellPrice(100), 133.33);   // rounded to 2dp
  assert.equal(menu.sellPrice(0), 0);          // no cost → no price
});

test('sellPrice: warranty parts billed at cost (vendor supplies, no markup)', () => {
  assert.equal(menu.sellPrice(60, { warranty: true }), 60);
  assert.equal(menu.sellPrice(15, { warranty: true }), 15);
});

test('byKey: resolves a known repair, returns null for unknown', () => {
  const r = menu.byKey('fridge_ice_maker');
  assert.ok(r, 'known key resolves');
  assert.equal(r.flat_labor, 140);
  assert.equal(menu.byKey('does_not_exist'), null);
});

test('price-book integrity: every repair has key + appliance + positive numeric flat_labor', () => {
  assert.ok(Array.isArray(menu.REPAIRS) && menu.REPAIRS.length > 0, 'REPAIRS is a non-empty array');
  for (const r of menu.REPAIRS) {
    assert.ok(r.key, 'repair has a key');
    assert.ok(r.appliance, `${r.key} has an appliance`);
    assert.equal(typeof r.flat_labor, 'number', `${r.key} flat_labor is a number`);
    assert.ok(r.flat_labor > 0, `${r.key} flat_labor > 0`);
  }
});
