// Pins the ONE payload envelope Frontdoor's connector actually accepts.
//
// Their published spec (docs/frontdoor-api-spec-2026-06-24.md) documents
// { data: [ { type: 'status', object: {...} } ] }. Measured live against their repaired
// sandbox on 2026-09-16, that shape is REJECTED at unmarshal. The connector wants a FLAT
// event envelope. Walked one validator error at a time:
//
//   data:[{type,object}]  -> 500 CONNECTOR_BLE_0007  Failed to unmarshal struct to JSON string
//   data:{type,object}    -> 400 CONNECTOR_BLE_0042  Type Missing in request
//   {type, data:{...}}    -> 400 CONNECTOR_BLE_0048  ExternalID Missing
//   + external_id in data -> 400 CONNECTOR_BLE_0049  Message Missing
//   + message as a STRING -> 400 CONNECTOR_BLE_0050  Status Missing
//   + status as a STRING  -> 200 {"errors":null}
//
// Fifteen days of the integration stalled on this, so the shape is pinned rather than
// trusted to a comment. The body is captured by stubbing global.fetch and calling the REAL
// exported dispatchStatusUpdate — not by re-reading a hand-copy of the object literal.
'use strict';
const assert = require('node:assert');
const { test } = require('node:test');

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

test('uses the FLAT envelope, not the documented data[] one', async () => {
  const { body } = await capture(ARGS);
  assert.equal(body.type, 'status', 'type at TOP level — anything else is BLE_0042');
  assert.ok(!Array.isArray(body.data), 'data must NOT be an array — that is BLE_0007');
  assert.equal(typeof body.data, 'object', 'data is an object');
  assert.ok(!('object' in body), 'no top-level `object` wrapper');
});

test('carries external_id INSIDE data as a string', async () => {
  const { body } = await capture(ARGS);
  // Top-level external_id (any casing) is what returns BLE_0048 — it has to be nested.
  assert.ok(!('external_id' in body) && !('externalId' in body) && !('ExternalID' in body),
    'external_id must be inside data, not top level');
  assert.equal(body.data.external_id, '22863999', 'external_id present inside data');
  assert.equal(typeof body.data.external_id, 'string', 'external_id is a string');
});

test('message is a non-empty STRING (an object dies at unmarshal)', async () => {
  const { body } = await capture(ARGS);
  assert.equal(typeof body.data.message, 'string', 'message must be a string');
  assert.ok(body.data.message.length > 0, 'message is non-empty — empty is BLE_0049');
  assert.equal(body.data.message, 'Jimmy is on the way', 'the tech note is the useful message');
});

test('message falls back to the description when there is no note', async () => {
  const { body } = await capture({ ...ARGS, note: '' });
  assert.equal(body.data.message, 'Technician in Route to Location', 'never sends an empty message');
});

test('status is a non-empty STRING, not a number and not an object', async () => {
  const { body } = await capture(ARGS);
  assert.equal(typeof body.data.status, 'string', 'status must be a string — a number is BLE_0007');
  assert.ok(body.data.status.length > 0, 'status is non-empty — empty is BLE_0050');
  assert.equal(body.data.status, 'Technician in Route to Location');
});

test('the numeric code still rides along, as a string', async () => {
  const { body } = await capture(ARGS);
  assert.equal(body.data.status_code, '70', 'status_code carried as a string');
});

test('vendor, tenant and source ride along inside data', async () => {
  const { body } = await capture(ARGS);
  assert.equal(body.data.vendor_id, '822418');
  assert.equal(body.data.tenant, 'AHS', 'tenant defaults to AHS');
  assert.equal(body.data.source, 'TN_APPLIANCE_EXCHANGE', 'the source Akshay provisioned for us');
});

test('items only appear when actually supplied', async () => {
  const bare = await capture(ARGS);
  assert.ok(!('items' in bare.body.data), 'no empty items array');
  const withItems = await capture({ ...ARGS, items: [{ id: 0, legacy_item_id: 0, description: '' }] });
  assert.equal(withItems.body.data.items.length, 1, 'items nest inside data when passed');
});

test('FRONTDOOR_LEGACY_SHAPE=1 restores the documented envelope (one-line reversal)', async () => {
  const { body } = await capture(ARGS, { FRONTDOOR_LEGACY_SHAPE: '1' });
  assert.ok(Array.isArray(body.data), 'legacy flag brings back data[]');
  assert.equal(body.data[0].type, 'status');
  assert.equal(body.data[0].object.dispatch_id, 22863999, 'legacy keeps dispatch_id numeric');
});
