// Pins the ONE payload Frontdoor's connector actually SAVES.
//
// History matters here, because this file used to pin the opposite thing. On 2026-09-16 we
// walked their validator one error at a time and landed on a FLAT envelope
// {type, data:{external_id, message, status}} that returned 200 {"errors":null} on every
// call. We shipped it and pinned it. Akshay Kyatam, 2026-09-17: that request was never
// saved -- "Surprisingly, the API still returned a 200 response even for incorrect
// request." So the old green test was pinning a false positive.
//
// THE RULE THAT REPLACES IT: a 200 from this endpoint is not evidence. The only shapes
// asserted below are ones measured against their sandbox with a CONTROL -- Akshay's own
// working body -- and one field changed per request:
//
//   ak_exact   (his body verbatim)          -> 200
//   ak_numcode (status_code as a NUMBER)    -> 500 CONNECTOR_BLE_0007
//   ak_strid   (dispatch_id as a STRING)    -> 500 CONNECTOR_BLE_0007
//   ak_noitems / ak_nouser / ak_times       -> 200  (all three optional)
//
// So the envelope was never wrong -- it is the { data:[{type,object}] } their spec
// documented all along. Fifteen days went to ONE JSON type, on two adjacent id fields that
// want OPPOSITE types: status_code is a string, dispatch_id is a number.
//
// The body is captured by stubbing global.fetch and calling the REAL exported
// dispatchStatusUpdate -- not by re-reading a hand-copy of the object literal.
'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.FRONTDOOR_CLIENT_ID = 'probe-client';
process.env.FRONTDOOR_API_USERNAME = 'probe-user';
process.env.FRONTDOOR_API_PASSWORD = 'probe-pass';
process.env.FRONTDOOR_VENDOR_ID = '822418';
process.env.FRONTDOOR_ENV = 'sandbox';

const fd = require('../netlify/functions/_lib/frontdoor');

// Capture the webhook body without any network. The token call is stubbed too so the
// helper never reaches FusionAuth.
async function capture(args, env) {
  const prevFetch = global.fetch;
  const prevEnv = { ...process.env };
  if (env) Object.assign(process.env, env);
  let captured = null;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (/oauth2\/token/.test(u)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }) };
    }
    captured = { url: u, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, text: async () => '{"errors":null}' };
  };
  try {
    await fd.dispatchStatusUpdate(args);
  } finally {
    global.fetch = prevFetch;
    for (const k of Object.keys(process.env)) if (!(k in prevEnv)) delete process.env[k];
    Object.assign(process.env, prevEnv);
  }
  return captured;
}

const ARGS = {
  dispatchId: '22863999', statusCode: 70,
  description: 'Technician in Route to Location',
  note: 'Jimmy is on the way', vendorId: '822418',
};

test('posts to the dispatch-connector webhook path', async () => {
  const c = await capture(ARGS);
  assert.ok(/\/dispatch-connector\/v1\/webhook$/.test(c.url), 'webhook path unchanged');
});

test('uses the DOCUMENTED data[] envelope -- the one that saves', async () => {
  const { body } = await capture(ARGS);
  assert.ok(Array.isArray(body.data), 'data is an array -- the flat envelope 200s and saves nothing');
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].type, 'status', 'type sits beside object, inside data[]');
  assert.equal(typeof body.data[0].object, 'object', 'object is a real object, not a JSON string');
  assert.ok(!('type' in body), 'no top-level type -- that is the flat envelope');
  assert.ok(!('external_id' in body), 'no top-level external_id -- that is the flat envelope');
});

test('dispatch_id is a NUMBER (a string is BLE_0007)', async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  assert.equal(typeof o.dispatch_id, 'number', 'measured: ak_strid -> 500 CONNECTOR_BLE_0007');
  assert.equal(o.dispatch_id, 22863999);
});

test('status_code is a STRING (a number is BLE_0007)', async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  assert.equal(typeof o.status_code, 'string', 'measured: ak_numcode -> 500 CONNECTOR_BLE_0007');
  assert.equal(o.status_code, '70');
  // The asymmetry is the whole point: the two id-ish fields want opposite types.
  assert.notEqual(typeof o.status_code, typeof o.dispatch_id, 'string vs number, deliberately');
});

test('the human-readable description rides alongside the code', async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  // Akshay: "We use the status_code value for status processing. However, we recommend
  // sending both the status_code and description fields."
  assert.equal(o.description, 'Technician in Route to Location');
  assert.ok(o.description.length > 0, 'never send a bare code with no description');
});

test("the tech's note is carried as note, not folded into description", async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  assert.equal(o.note, 'Jimmy is on the way');
  assert.equal(o.description, 'Technician in Route to Location', 'the note never overwrites the status wording');
});

test('an absent note sends empty, never undefined', async () => {
  const { body } = await capture({ ...ARGS, note: '' });
  assert.equal(body.data[0].object.note, '', 'a missing key would drop out of JSON entirely');
});

test('vendor, tenant and source are present and correctly typed', async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  assert.equal(o.vendor_id, '822418');
  assert.equal(typeof o.vendor_id, 'string', 'vendor_id is a string in their working body');
  assert.equal(o.tenant, 'AHS', 'tenant defaults to AHS');
  assert.equal(o.source, 'TN_APPLIANCE_EXCHANGE', 'the source Akshay provisioned for us');
});

test('a status carries a person -- username defaults, and is overridable', async () => {
  const { body } = await capture(ARGS);
  assert.equal(body.data[0].object.username, 'TN APPLIANCE EXCHANGE', 'their portal shows who made the change');
  const named = await capture({ ...ARGS, username: 'Jimmy Pivacek' });
  assert.equal(named.body.data[0].object.username, 'Jimmy Pivacek');
});

test('items only appear when actually supplied', async () => {
  const bare = await capture(ARGS);
  assert.ok(!('items' in bare.body.data[0].object), 'no empty items array -- measured optional');
  const withItems = await capture({ ...ARGS, items: [{ id: 822, legacy_item_id: 822, description: 'Dryer' }] });
  assert.equal(withItems.body.data[0].object.items.length, 1, 'items nest inside object when passed');
});

test('timestamps are ISO strings and default to now', async () => {
  const { body } = await capture(ARGS);
  const o = body.data[0].object;
  [o.updated_at, o.start_time, o.end_time].forEach((t) => {
    assert.equal(typeof t, 'string');
    assert.ok(!isNaN(Date.parse(t)), 'parseable ISO -- measured tolerated alongside their +0000 form');
  });
});

test('the 200-but-never-saved flat envelope cannot come back', async () => {
  // It was shipped, pinned green, and wrote nothing to their portal for a day. Keeping it
  // behind a vault flag would be a one-line reversal to a silent no-op, so it is gone --
  // including via the old FRONTDOOR_LEGACY_SHAPE key, which is now inert.
  const { body } = await capture(ARGS, { FRONTDOOR_LEGACY_SHAPE: '1' });
  assert.ok(Array.isArray(body.data), 'the flag no longer changes the envelope');
  assert.ok(!('message' in body.data[0].object), 'no `message` field -- that was the flat shape');
  assert.ok(!('status' in body.data[0].object), 'no `status` field -- that was the flat shape');

  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'netlify', 'functions', '_lib', 'frontdoor.js'), 'utf8');
  const live = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/external_id/.test(live), 'the flat envelope is not built anywhere on a live line');
});

test('refuses to push with no vendor_id, and the error names the fix', async () => {
  // Measured 2026-09-17: a blank vendor_id comes back 400 CONNECTOR_BLE_0030 "VendorID
  // missing" -- which reads like their problem and is our own unset config. Fail here,
  // with our real vendor ids in the message, instead of at their end.
  const prevFetch = global.fetch;
  global.fetch = async (url) => (/oauth2\/token/.test(String(url))
    ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 't', expires_in: 3600 }) }
    : { ok: true, status: 200, text: async () => '{"errors":null}' });
  try {
    await assert.rejects(
      () => fd.dispatchStatusUpdate({ ...ARGS, vendorId: '   ' }),
      (e) => /vendor_id/i.test(e.message) && /822418/.test(e.message) && /North Shore/.test(e.message),
      'the message has to carry the fix, not just the complaint');
  } finally { global.fetch = prevFetch; }
});

test('a supplied vendor_id still goes through untouched', async () => {
  const { body } = await capture({ ...ARGS, vendorId: '839828' });
  assert.equal(body.data[0].object.vendor_id, '839828', 'Middle TN vendor rides through');
});

// --- catalog integrity -------------------------------------------------------------
// Added 2026-09-17 after expanding STATUS 13 -> 23 dropped PARTS_ARRIVED by accident, and
// frontdoor-test's `|| STATUS.EN_ROUTE` fallback sent a Parts-Arrived note out under status
// 70 with a clean 200. A wrong status that looks like a success is the exact failure mode
// this whole integration has been paying for, so the catalog is pinned three ways.

test('every status the tech app can send exists in the catalog', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tech-job.html'), 'utf8');
  const m = html.match(/const FD_STATUS_MAP\s*=\s*\{([^}]*)\}/);
  assert.ok(m, 'FD_STATUS_MAP not found in tech-job.html');
  const keys = [...m[1].matchAll(/:\s*'([A-Z_]+)'/g)].map((x) => x[1]);
  assert.ok(keys.length >= 8, `expected the lifecycle map, got ${keys.length} entries`);
  for (const k of keys) {
    assert.ok(fd.STATUS[k], `tech-job.html maps to '${k}' but STATUS has no such key -- it would silently send the wrong status`);
  }
});

test('no two statuses share a code, and outbound never collides with inbound', () => {
  const codes = Object.values(fd.STATUS).map((v) => v.code);
  assert.equal(codes.length, new Set(codes).size, 'duplicate status_code in STATUS');
  for (const [k, v] of Object.entries(fd.STATUS)) {
    assert.ok(!fd.INBOUND_STATUS[v.code],
      `${k} (${v.code}) is in INBOUND_STATUS -- that is Frontdoor's decision to set, not ours to push`);
  }
});

test("we never push a status that is the warranty company's decision", () => {
  // Authorization outcomes + cash-out are theirs. Pushing one would be claiming a decision
  // we do not make, which is how an integration loses its credentials.
  for (const code of [350, 360, 370, 450, 470, 480, 500]) {
    assert.ok(fd.INBOUND_STATUS[code], `${code} should be named as inbound-only`);
    assert.ok(!Object.values(fd.STATUS).some((v) => v.code === code),
      `${code} (${fd.INBOUND_STATUS[code]}) must not be in the outbound catalog`);
  }
});

test('the catalog still contains every code we have told Frontdoor we send', () => {
  // This is the one that would have caught the real mistake. Expanding STATUS 13 -> 23
  // dropped PARTS_ARRIVED, and nothing noticed because PARTS_ARRIVED is not in the tech
  // app's lifecycle map -- it fires from the office parts flow. Once a code is in an email
  // to the partner it is a commitment, so the committed set is pinned here by number.
  const CLAIMED = {
    10: 'Job Complete', 20: 'In Progress', 30: 'Appointment Set', 40: 'Job Cancelled',
    60: 'Unable to Contact Customer', 70: 'Technician in Route', 80: 'Technician May Be Delayed',
    90: 'Technician Arrived', 100: 'In Progress w/ Parts on Order', 110: 'In Progress w/ Need to Replace',
    120: 'Customer Missed Appointment', 140: 'Incomplete', 150: 'On Hold', 160: 'Parts/Equipment Status',
    260: 'Dispatch Accepted', 270: 'Reschedule Appointment Set', 280: 'Left message for Customer',
    290: 'Authorization Reported', 380: 'Parts Ordered', 400: 'Return Appointment Set',
    410: 'Parts Arrived', 440: 'Job Invoiced', 460: '2nd Opinion Requested',
  };
  const have = new Set(Object.values(fd.STATUS).map((v) => v.code));
  const missing = Object.keys(CLAIMED).map(Number).filter((c) => !have.has(c));
  assert.deepEqual(missing, [],
    'dropped from the catalog after being promised to Frontdoor: ' + missing.map((c) => `${c} ${CLAIMED[c]}`).join(', '));
});
