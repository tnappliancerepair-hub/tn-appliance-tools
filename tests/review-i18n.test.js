// In-language review-request strings + language normalization.
// pack(lang).{ask,pos,neg,ack} are template FUNCTIONS that render a message.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../netlify/functions/_lib/review-i18n.js');

test('normLang: names + casing → codes, unknown falls back to en (never crashes)', () => {
  assert.equal(i18n.normLang('en'), 'en');
  assert.equal(i18n.normLang('spanish'), 'es');
  assert.equal(i18n.normLang('ES'), 'es');
  assert.equal(i18n.normLang('zzz'), 'en');   // safe fallback
});

test('pack: known + fallback langs return 4 callable templates that render non-empty strings', () => {
  for (const lang of ['en', 'es', 'zzz']) {
    const p = i18n.pack(lang);
    assert.ok(p, `pack(${lang}) returns an object`);
    for (const k of ['ask', 'pos', 'neg', 'ack']) {
      assert.equal(typeof p[k], 'function', `pack(${lang}).${k} is a template function`);
    }
    // render each with enough args and confirm it produces text
    assert.ok(String(p.ask('Teddy', 'washer')).length > 0, `${lang}.ask renders`);
    assert.ok(String(p.pos('Teddy', 'Jimmy', 'washer', 'Nashville', 'https://x')).length > 0, `${lang}.pos renders`);
    assert.ok(String(p.neg('Teddy')).length > 0, `${lang}.neg renders`);
    assert.ok(String(p.ack('Teddy')).length > 0, `${lang}.ack renders`);
  }
});

test('langFromPref is exported and callable', () => {
  assert.equal(typeof i18n.langFromPref, 'function');
});
