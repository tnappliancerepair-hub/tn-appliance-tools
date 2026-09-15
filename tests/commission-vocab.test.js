// commission-vocab — the commission rule is a STRING MATCH, so the word is the feature.
//
// platform/pay-calc.js ruleFor() is the one resolver every pay surface reads. It matches
// commission_type === 'labor_pct' / 'flat_per_job' EXACTLY, and anything else falls through
// to the company default. That fallback is silent: the row still shows the tech's pct, the
// owner board still renders it, and the payout quietly uses a different number.
//
// It bit for real (2026-09-15): three writers had each invented their own spelling —
// owner-actions wrote 'percent', platform-provision wrote 'pct' on every tech it created,
// and platform-ant read 'flat'. Lee Harding sat with no usable rule and was being figured at
// the company default 40% instead of his 50%.
//
// So these assertions pin the vocabulary to the two values the resolver actually honors,
// lifted OUT OF the shipped resolver so the test can't drift from what ships.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const PAYCALC = R('platform/pay-calc.js');

// The allowed set, lifted from the resolver itself rather than hardcoded here.
const RULE_FN = (PAYCALC.match(/function ruleFor\([\s\S]*?\n  \}/) || [''])[0];
const ALLOWED = [...RULE_FN.matchAll(/t\.commission_type === '([a-z_]+)'/g)].map((m) => m[1]);

test('the resolver honors exactly two commission_type values', () => {
  assert.ok(RULE_FN.length > 50, 'lifted ruleFor() out of pay-calc.js');
  assert.deepStrictEqual(ALLOWED.sort(), ['flat_per_job', 'labor_pct'],
    'pay-calc ruleFor() is the source of truth for the vocabulary');
});

// Every file that writes or reads technician.commission_type must use only those words.
const FILES = [
  'platform/owner.html',
  'platform/office-board.html',
  'platform/tech.html',
  'platform/pay-calc.js',
  'netlify/functions/_lib/owner-actions.js',
  'netlify/functions/platform-ant.js',
  'netlify/functions/platform-provision.js',
];

test('no surface invents its own spelling for commission_type', () => {
  const bad = [];
  for (const f of FILES) {
    const src = R(f);
    // Only technician commission_type — the `partner` table has its own separate vocabulary
    // (sub_pct / flat_per_account) and is deliberately out of scope here.
    for (const m of src.matchAll(/commission_type *(?:===?|:) *'([a-z_]+)'/g)) {
      const val = m[1];
      if (!ALLOWED.includes(val) && val !== 'sub_pct' && val !== 'flat_per_account') {
        bad.push(`${f}: '${val}'`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], 'a commission_type nothing reads pays the wrong number silently');
});

test('the two real writers spell it the way the resolver reads it', () => {
  // owner.html's commission card — the human path.
  assert.ok(/commission_type *: *'labor_pct'/.test(R('platform/owner.html')),
    'owner.html writes labor_pct');
  // owner-actions set_tech_commission — the Ant/API path. This one was writing 'percent'.
  const OA = R('netlify/functions/_lib/owner-actions.js');
  const INTENT = (OA.match(/set_tech_commission: \{[\s\S]*?\n  \},/) || [''])[0];
  assert.ok(INTENT.includes('set_tech_commission') || INTENT.length > 0, 'lifted the intent');
  assert.ok(/commission_type: *'labor_pct'/.test(INTENT),
    'set_tech_commission writes labor_pct, not percent');
  // ⚠️ Strip comments first. The bare substring also matches the comment that RECORDS why
  // the spelling changed — a test that fires on a code comment cries wolf and gets waved
  // through. (Second time today; anchor to the write, never to prose.)
  const INTENT_CODE = INTENT.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/commission_type: *'percent'/.test(INTENT_CODE),
    "the dead 'percent' spelling is gone from the actual write");
  // provisioning — every tech a new shop creates.
  const PP = R('netlify/functions/platform-provision.js');
  assert.ok(!/commission_type: *'pct'/.test(PP),
    "platform-provision no longer stamps the dead 'pct' on every new tech");
});

test('a tech with no override is paid the company default, not zero', () => {
  // pay-calc has always done this. platform-ant did not — it read the tech row only, so a
  // tech with no override saw his own money card read $0 while the owner board showed him
  // earning. A tech who opens his pay and sees zero stops trusting the number.
  const ANT = R('netlify/functions/platform-ant.js');
  const SNAP = (ANT.match(/async function buildTechSnapshot[\s\S]*?\n\}/) || [''])[0];
  assert.ok(SNAP.length > 100, 'lifted buildTechSnapshot()');
  // Pin the FETCH, not just the word. `settings` appears downstream in coSettings/coComm
  // too, so a loose /settings/ passes even when the select no longer asks for the column —
  // the read would silently return undefined and every tech falls back to 0 again.
  assert.ok(/company\?id=eq\.\$\{ctx\.companyId\}&select=[^`]*settings/.test(SNAP),
    'the company SELECT actually asks for settings');
  assert.ok(/coComm[\s\S]*labor_pct/.test(SNAP),
    'it reads the company commission default as the fallback');
  assert.ok(!/commission_type === 'flat'[^_]/.test(SNAP),
    "it no longer matches the dead 'flat' spelling");
});
