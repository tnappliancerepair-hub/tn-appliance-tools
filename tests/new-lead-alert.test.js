// new-lead-alert — the gate that decides which inbound caller is a NEW CASH LEAD, and
// who hears about it. Every rule is LIFTED OUT OF THE SHIPPED FILE so the test cannot
// drift from what actually texts Teddy and Danielle.
//
// What is load-bearing here, in order:
//   1. Danielle must actually RECEIVE this. She has been hard-blocked since 2026-08-28
//      and Teddy asked for her by name on 2026-09-15. A tag allowlisted for her but not
//      for him (or the reverse) drops one copy SILENTLY -- office-gate refuses and the
//      caller sees `sent:false`, which nothing looks at. So both sides are pinned.
//   2. It must NOT be gated to business hours. "even after hours" was explicit, and
//      every sibling watcher in this repo IS gated, so the absence is easy to "fix" by
//      accident. Pinned by reading the shipped source.
//   3. A known customer is not a new lead; our own crew and lines are not leads; a
//      toll-free caller is not a homeowner. Everything else IS a lead, including an
//      out-of-region area code -- Nashville is a transplant city.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const SRC = fs.readFileSync(require.resolve('../netlify/functions/new-lead-alert.js'), 'utf8');
const gate = require('../netlify/functions/_lib/office-gate');

function lift(name) {
  // (?:async )? matters: without it the lift starts mid-token inside `async function`
  // and hands back a SYNC body full of awaits, which will not even parse.
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m = re.exec(SRC);
  assert.ok(m, `could not lift ${name}() out of new-lead-alert.js`);
  return m[0];
}
function liftConst(name) {
  const re = new RegExp(`const ${name}\\s*=\\s*([^;]+);`, 'm');
  const m = re.exec(SRC);
  assert.ok(m, `could not lift const ${name} out of new-lead-alert.js`);
  return `const ${name} = ${m[1].trim()};`;
}
// The INTERNAL set spans many lines; take it up to its closing paren.
function liftInternal() {
  const m = /const INTERNAL = new Set\(\[[\s\S]*?\n\]\);/m.exec(SRC);
  assert.ok(m, 'could not lift INTERNAL out of new-lead-alert.js');
  return m[0];
}

const H = (() => {
  const src = [
    liftInternal(),
    liftConst('TOLLFREE'),
    liftConst('LINES'),
    liftConst('SERVICE_AREA'),
    lift('last10'), lift('pretty'), lift('clockCT'), lift('dialedDigits'), lift('skipReason'),
    'return { INTERNAL, TOLLFREE, LINES, SERVICE_AREA, last10, pretty, clockCT, dialedDigits, skipReason };',
  ].join('\n');
  return new Function(src)();
})();

const c = (caller, extra) => Object.assign({ caller: H.last10(caller) }, extra || {});

// ── 1. WHO HEARS ABOUT IT ───────────────────────────────────────────────────────────
test('BOTH Teddy and Danielle can receive a new_cash_lead', () => {
  assert.strictEqual(gate.officeBlocked('+16154855795', 'new_cash_lead'), false, 'Teddy must receive his own alert');
  assert.strictEqual(gate.officeBlocked('+16154850713', 'new_cash_lead'), false, 'Danielle was named explicitly');
});

test('the door opened for Danielle is exactly one tag wide', () => {
  assert.deepStrictEqual([...gate.ALLOWED_TO_DANIELLE], ['new_cash_lead']);
  for (const tag of ['lsa_lead', 'callback_request', 'platform_cash_lead', 'warranty_intake', 'deploy_down', 'quick_check']) {
    assert.strictEqual(gate.officeBlocked('+16154850713', tag), true, `${tag} must NOT reach Danielle`);
  }
});

test('Sofia and Carrie stay shut, on this tag and every other', () => {
  for (const who of ['+16292594602', '+12258035669']) {
    for (const tag of ['new_cash_lead', 'lsa_lead', 'quick_check', 'warranty_intake']) {
      assert.strictEqual(gate.officeBlocked(who, tag), true, `${tag} must not reach ${who}`);
    }
  }
});

test('the alert texts only those two numbers, and never a customer', () => {
  const nums = SRC.match(/\+1\d{10}/g) || [];
  assert.deepStrictEqual([...new Set(nums)].sort(), ['+16154850713', '+16154855795']);
  assert.ok(!/sendSms\w*\((?!OWNER|DANIELLE)/.test(SRC.replace(/\/\/.*$/gm, '')), 'no send to anything but OWNER/DANIELLE');
});

// ── 2. NO HOURS GATE ────────────────────────────────────────────────────────────────
test('there is no business-hours gate — an after-hours lead still texts', () => {
  const code = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/OPEN_H|CLOSE_H|ctHour|business.?hours/i.test(code),
    'a business-hours gate crept back in — "even after hours" was explicit');
});

test('the role used is internal, so quiet hours cannot suppress it either', () => {
  assert.ok(/sendSmsDetailed\(OWNER, body, 'owner'/.test(SRC));
  assert.ok(/sendSmsDetailed\(DANIELLE, body, 'office'/.test(SRC));
});

// ── 3. WHO COUNTS AS A LEAD ─────────────────────────────────────────────────────────
test('our own crew and our own lines are never a lead', () => {
  for (const n of ['6154855795', '6154850713', '6159671304', '5049099413', '6158291654', '8133527686']) {
    assert.strictEqual(H.skipReason(c(n)), 'internal', `${n} is one of ours`);
  }
  for (const n of ['6152802949', '6155889500', '6158458500', '6158578800', '6155551212']) {
    assert.strictEqual(H.skipReason(c(n)), 'internal', `${n} is one of our lines`);
  }
});

test('a toll-free caller is not a homeowner', () => {
  for (const n of ['8007764663', '8444284083', '8002511608', '8887654321', '8339990000']) {
    assert.strictEqual(H.skipReason(c(n)), 'toll_free', `${n} should be cut`);
  }
});

test('an out-of-region area code IS still a lead — people keep their old cell', () => {
  for (const n of ['2143500974', '4083070514', '3604733227', '5617192555', '8433100571']) {
    assert.strictEqual(H.skipReason(c(n)), '', `${n} must survive — no area-code filter`);
  }
});

test('the local-only dial is OFF by default — Teddy asked for every new caller', () => {
  assert.ok(/const localOnly\s*=[\s\S]{0,140}=== 'true'/.test(SRC),
    'out-of-region filtering must be opt-IN; defaulting it on quietly narrows what he asked for');
  assert.ok(/localOnly && !SERVICE_AREA\.test/.test(SRC), 'and it must only apply when explicitly on');
});

test('with the dial ON, out-of-region is cut but our regions still pass', () => {
  for (const n of ['2143500974', '4083070514', '3604733227']) {
    assert.strictEqual(H.skipReason(c(n), true), 'out_of_area');
    assert.strictEqual(H.skipReason(c(n), false), '', 'default must still let it through');
  }
  for (const n of ['6155255531', '9313845037', '6292607112', '5042598381', '9857882176', '2255551234']) {
    assert.strictEqual(H.skipReason(c(n), true), '', `${n} is in a region we drive to`);
  }
});

test("today's four real LSA callers all survive the gate", () => {
  for (const n of ['6155255531', '6154764519', '9313845037', '6154292905']) {
    assert.strictEqual(H.skipReason(c(n)), '', `${n} was a real paid lead`);
  }
});

// ── 4. WHAT THE TEXT SAYS ───────────────────────────────────────────────────────────
test('the number is rendered both readably and dialably', () => {
  assert.strictEqual(H.pretty('+16155255531'), '(615) 525-5531');
  assert.strictEqual(H.pretty('9313845037'), '(931) 384-5037');
  // the raw 10 digits also ride in the body so a phone linkifies it
  assert.ok(/Call them back: \$\{c\.caller\}/.test(SRC));
});

test('the dialed line is named, so an ads lead reads differently from a walk-in', () => {
  assert.strictEqual(H.LINES['6152802949'], 'the main line');
  assert.strictEqual(H.LINES['6158458500'], 'the Google Ads line');
  assert.strictEqual(H.LINES['9999999999'], undefined); // unknown line falls back, never guesses
});

test('the dialed line is recovered from the raw payload for rows logged before the field existed', () => {
  const raw = '{"data":{"payload":{"assistant_id":"a","to":"+16152802949","from":"+16155255531"}}}';
  assert.strictEqual(H.dialedDigits({ raw }), '6152802949');
  assert.strictEqual(H.dialedDigits({ to_resolved: '16158458500', raw }), '6158458500', 'explicit field wins');
  assert.strictEqual(H.dialedDigits({}), '');
});

test('times read in Central', () => {
  // 2026-09-15 19:49:00Z == 2:49 PM CDT, the first of the afternoon LSA cluster
  assert.strictEqual(H.clockCT(Date.UTC(2026, 8, 15, 19, 49, 0)), '2:49 PM');
  assert.strictEqual(H.clockCT(Date.UTC(2026, 8, 16, 5, 30, 0)), '12:30 AM'); // after-hours still formats
});

// ── 5. IT CANNOT FLOOD, AND IT CANNOT GO SILENT ─────────────────────────────────────
test('one text per caller per day, and a per-run cap', () => {
  assert.ok(/const DEDUP_H\s*=\s*24/.test(SRC), 'dedup window must be a day');
  assert.ok(/const MAX_PER_RUN\s*=\s*6/.test(SRC), 'a burst must not flood');
  assert.ok(/queue\.slice\(0, MAX_PER_RUN\)/.test(SRC), 'the cap must actually be applied');
});

// Don't pattern-match this one — RUN it. A grep for /catch/ also matches the harmless
// inner catch around JSON.parse, which is how a crude assertion cries wolf.
const LEDGER = (() => {
  const src = [liftConst('XANO'), liftConst('DEDUP_H'), lift('last10'), lift('alreadyAlerted'),
    'return alreadyAlerted;'].join('\n');
  return new Function(src)();
})();

test('the dedup ledger fails CLOSED — a bad read sends nothing', async () => {
  const orig = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
    await assert.rejects(LEDGER(), /event_log read 502/,
      'a failed ledger read must THROW; an empty set would re-text every caller in the window');
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    await assert.rejects(LEDGER(), /ECONNRESET/, 'a dead ledger read must not read as "nobody alerted yet"');
  } finally { global.fetch = orig; }
});

test('the dedup ledger reads callers, and forgets them after a day', async () => {
  const orig = global.fetch;
  const now = Date.now();
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [
      { metadata: { caller: '6155255531', at_ms: now - 3600000 } },              // 1h ago
      { metadata: JSON.stringify({ caller: '9313845037', at_ms: now - 60000 }) }, // string metadata
      { metadata: { caller: '6154292905', at_ms: now - 30 * 3600000 } },          // 30h ago -> expired
      { metadata: { at_ms: now } },                                               // no caller -> ignored
    ] }) });
    const seen = await LEDGER();
    assert.ok(seen.has('6155255531'), 'an alert an hour ago still counts');
    assert.ok(seen.has('9313845037'), 'metadata stored as a JSON string must still parse');
    assert.ok(!seen.has('6154292905'), 'a 30h-old alert must not silence a caller ringing again today');
  } finally { global.fetch = orig; }
});

test('an unresolvable customer lookup is treated as UNKNOWN, not as known', () => {
  const fn = lift('knownCustomer');
  assert.ok(/catch \(_\) \{ return null; \}/.test(fn), 'a slow lookup must not swallow a real lead');
  assert.ok(/if \(!r\.ok\) return null;/.test(fn));
});

test('every attempt is ledgered even when the send is refused', () => {
  assert.ok(/logEvent\('new_cash_lead_alerted'/.test(SRC));
  assert.ok(/teddy_sent:[\s\S]{0,120}danielle_sent:/.test(SRC), 'both outcomes recorded separately');
});

test('a caller with no caller ID is dropped rather than texted about', () => {
  assert.ok(/if \(dg\.length !== 10\) continue;/.test(SRC));
});

test('the cron is scheduled on the WRAPPER, never on the curlable core', () => {
  const toml = fs.readFileSync(require.resolve('../netlify.toml'), 'utf8');
  assert.ok(/\[functions\."new-lead-alert-cron"\]\s*\n\s*schedule = "\*\/2 \* \* \* \*"/.test(toml),
    'the wrapper must be scheduled every 2 minutes');
  // A schedule block on the core edge-403s every manual call, which would kill ?dry=1 --
  // the only way to see who is about to be texted before it happens.
  assert.ok(!/\[functions\."new-lead-alert"\]/.test(toml),
    'the core must stay curlable — do not schedule it');
  assert.ok(/require\('\.\/new-lead-alert'\)/.test(
    fs.readFileSync(require.resolve('../netlify/functions/new-lead-alert-cron.js'), 'utf8')),
    'the wrapper must call the core, not reimplement it');
});
