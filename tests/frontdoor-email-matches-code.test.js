'use strict';
// The partner email is the one artifact with real-world consequences and, until this test,
// zero coverage. On 2026-09-17 the draft claimed EIGHT statuses fire automatically when three
// do -- because a FD_STATUS_MAP entry was read as proof of wiring. The code was corrected and
// pinned by frontdoor-payload-shape.test.js; this file pins the DRAFT to that same code, so
// the two can never drift apart again.
//
// Everything here is parsed out of the real files. Nothing is hand-copied.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const fd = require('../netlify/functions/_lib/frontdoor');
const EMAIL = fs.readFileSync(path.join(__dirname, '..', 'docs', 'frontdoor-reply-2026-09-17.md'), 'utf8');

// The "What we send" table: | code | status | fires from | today |
function sendTable() {
  const rows = [];
  const lines = EMAIL.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*code\s*\|\s*status\s*\|\s*fires from\s*\|\s*today\s*\|/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) break;
    rows.push({ code: Number(cells[0]), status: cells[1], from: cells[2], today: cells[3] });
  }
  return rows;
}

const byCode = new Map(Object.entries(fd.STATUS).map(([k, v]) => [v.code, { key: k, ...v }]));

test('the email table found rows -- a parse miss must read as a broken test, never a clean pass', () => {
  const rows = sendTable();
  assert.ok(rows.length >= 20, 'parsed only ' + rows.length + ' rows out of the email table');
});

test('every code the email advertises exists in the connector, with that exact code', () => {
  for (const r of sendTable()) {
    assert.ok(byCode.has(r.code), 'email advertises code ' + r.code + ' (' + r.status + ') which is NOT in STATUS');
  }
});

test('the email advertises exactly the statuses we can send -- no more, no fewer', () => {
  const emailCodes = new Set(sendTable().map((r) => r.code));
  const codeCodes = new Set([...byCode.keys()]);
  const over = [...emailCodes].filter((c) => !codeCodes.has(c));
  const under = [...codeCodes].filter((c) => !emailCodes.has(c));
  assert.deepEqual(over, [], 'email promises codes the connector cannot send: ' + over.join(', '));
  assert.deepEqual(under, [], 'connector can send codes the email never mentions: ' + under.join(', '));
});

test('"**live**" in the email means wired:true in the code -- exactly, both directions', () => {
  const emailLive = new Set(sendTable().filter((r) => /\*\*live\*\*/.test(r.today)).map((r) => byCode.get(r.code).key));
  const codeWired = new Set(Object.entries(fd.STATUS).filter(([, v]) => v.wired).map(([k]) => k));
  const over = [...emailLive].filter((k) => !codeWired.has(k));
  const under = [...codeWired].filter((k) => !emailLive.has(k));
  assert.deepEqual(over, [], 'email calls these live but no call site fires them: ' + over.join(', '));
  assert.deepEqual(under, [], 'these fire live but the email does not say so: ' + under.join(', '));
});

test('"mapped" in the email means mapped:true in the code -- exactly, both directions', () => {
  const emailMapped = new Set(sendTable().filter((r) => /^mapped$/.test(r.today)).map((r) => byCode.get(r.code).key));
  const codeMapped = new Set(Object.entries(fd.STATUS).filter(([, v]) => v.mapped).map(([k]) => k));
  const over = [...emailMapped].filter((k) => !codeMapped.has(k));
  const under = [...codeMapped].filter((k) => !emailMapped.has(k));
  assert.deepEqual(over, [], 'email calls these mapped but the code does not: ' + over.join(', '));
  assert.deepEqual(under, [], 'code marks these mapped but the email does not: ' + under.join(', '));
});

test('every other row reads "ready" -- a blank or a stray word is an unreviewed claim', () => {
  for (const r of sendTable()) {
    const st = byCode.get(r.code);
    if (st.wired || st.mapped) continue;
    assert.equal(r.today, 'ready', 'code ' + r.code + ' (' + r.status + ') has neither tier but the email says "' + r.today + '"');
  }
});

test('the counts the email states in prose match the counts in the code', () => {
  const wired = Object.values(fd.STATUS).filter((v) => v.wired).length;
  const mapped = Object.values(fd.STATUS).filter((v) => v.mapped).length;
  const total = Object.keys(fd.STATUS).length;
  const words = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight' };
  assert.ok(EMAIL.includes(total + ' statuses'), 'email should say "' + total + ' statuses"');
  assert.ok(EMAIL.includes(words[wired] + ' fire automatically'),
    'email should say "' + words[wired] + ' fire automatically" (code has ' + wired + ' wired)');
  // The mapped tier is now EMPTY. A leftover "N more are already mapped" sentence would be a
  // promise about a tier that no longer exists, so when the code has none the email must claim
  // none -- and the moment a status goes back to mapped, the sentence has to come back with it.
  if (mapped === 0) {
    assert.ok(!/are already mapped/.test(EMAIL),
      'no status is mapped any more, but the email still claims some are');
  } else {
    assert.ok(EMAIL.includes(words[mapped] + ' more are already mapped'),
      'email should say "' + words[mapped] + ' more are already mapped" (code has ' + mapped + ')');
  }
});

test('every authorization code we tell them we do NOT push is inbound-only', () => {
  // The paragraph that promises we never assert an AHS decision. If one of these ever
  // sneaks into the outbound catalog, that promise becomes a lie in writing.
  const para = EMAIL.split('**We have deliberately not built a push for any authorization outcome**')[1];
  assert.ok(para, 'the do-not-push paragraph is missing from the email');
  const claimed = [...para.slice(0, 600).matchAll(/\b(\d{2,3})\s+[A-Z]/g)].map((m) => Number(m[1]));
  assert.ok(claimed.length >= 7, 'parsed only ' + claimed.length + ' codes out of the do-not-push paragraph');
  const outbound = new Set([...byCode.keys()]);
  // INBOUND_STATUS is keyed BY code (code -> description), not an object per status.
  const inbound = new Set(Object.keys(fd.INBOUND_STATUS).map(Number));
  for (const c of claimed) {
    assert.ok(!outbound.has(c), 'email promises we never push ' + c + ' but it IS in the outbound catalog');
    assert.ok(inbound.has(c), 'email names ' + c + ' as an inbound decision but it is not in INBOUND_STATUS');
  }
});

test('every code in the 11-step demo is one we can actually send', () => {
  const demo = EMAIL.split('| # | code | status | note we sent |')[1] || '';
  const codes = [...demo.split('\n---')[0].matchAll(/^\|\s*\d+\s*\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  assert.equal(codes.length, 11, 'expected 11 demo steps, parsed ' + codes.length);
  for (const c of codes) assert.ok(byCode.has(c), 'demo step used code ' + c + ' which is not in STATUS');
});

test('the vendor ids in the email are our real ones, with the right areas', () => {
  for (const [vid, meta] of Object.entries(fd.VENDOR_AREAS)) {
    const re = new RegExp(vid + '[^\\n]{0,40}' + meta.area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    assert.ok(re.test(EMAIL), 'email should pair vendor ' + vid + ' with "' + meta.area + '"');
  }
});

test('the email never leaks a secret or the owner cell', () => {
  assert.ok(!/615-?485-?5795/.test(EMAIL), "the owner's cell must never appear in a partner email");
  assert.ok(!/(eyJ|sk_live|Bearer\s+[A-Za-z0-9._-]{20})/.test(EMAIL), 'the email looks like it carries a token');
});

test('the note length the email quotes is one composeTdrNote could actually produce', () => {
  // The email tells them the Job Complete note ran 886 characters and asks whether the field
  // stores ~900. If the composer's cap ever drops below what we advertised, the email is
  // promising a report we can no longer compose.
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'frontdoor-tdr.js'), 'utf8');
  const caps = [...src.matchAll(/trimTo\([^,]+,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(caps.length, 'no trimTo cap found in frontdoor-tdr.js -- the parse broke');
  const cap = Math.max(...caps);
  const claimed = Number((EMAIL.match(/(\d{3,4})\s+characters/) || [])[1]);
  assert.ok(claimed, 'the email no longer states a character count for the report');
  assert.ok(claimed <= cap,
    'email advertises a ' + claimed + '-char report but composeTdrNote caps at ' + cap);
});
