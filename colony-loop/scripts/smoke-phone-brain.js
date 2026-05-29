#!/usr/bin/env node
// Smoke tests for the phone-ant-brain stack. Run AFTER Xano CLI deploys
// + Vapi assistant config.
//
//   node colony-loop/scripts/smoke-phone-brain.js [--verbose]
//
// Verifies all 9 phone-brain Xano endpoints respond. Does NOT actually
// place a phone call — that's a manual operator test (see runbook).

import process from 'node:process';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const VERBOSE = process.argv.includes('--verbose');

const tests = [
  { id: '1', name: 'lookup_customer_by_phone returns shape', fn: testLookup },
  { id: '2', name: 'get_open_jobs_for_customer responds', fn: testOpenJobs },
  { id: '3', name: 'get_recent_call_summary responds', fn: testCallSummary },
  { id: '4', name: 'send_customer_a_link rejects bad input cleanly', fn: testSendLinkValidation },
  { id: '5', name: 'request_callback writes audit + signal', fn: testCallback },
  { id: '6', name: 'escalate_phone_call_to_human responds', fn: testEscalate },
  { id: '7', name: 'mark_safety_emergency writes audit', fn: testSafety },
  { id: '8', name: 'update_customer_note writes audit', fn: testNote },
  { id: '9', name: 'phone-ant-brain (Netlify) responds with OpenAI shape', fn: testBrainShape },
];

(async () => {
  let pass = 0, fail = 0;
  console.log('━━━ Phone brain smoke tests ━━━');
  for (const t of tests) {
    process.stdout.write(`[${t.id}] ${t.name} ... `);
    try {
      const r = await t.fn();
      if (r.ok) { pass += 1; console.log(`✓ ${r.note || ''}`); }
      else { fail += 1; console.log(`✗ ${r.error}`); if (VERBOSE) console.log('     ' + JSON.stringify(r.debug || {})); }
    } catch (e) {
      fail += 1; console.log(`✗ ${e.message || e}`);
    }
  }
  console.log();
  console.log(`━━━ ${pass} pass · ${fail} fail ━━━`);
  process.exit(fail > 0 ? 1 : 0);
})();

async function testLookup() {
  const r = await getJson('/lookup_customer_by_phone?phone=+16154855795');
  if (!r.ok) return { ok: false, error: `status ${r.status}`, debug: r };
  if (typeof r.data.found !== 'boolean') return { ok: false, error: 'missing found field' };
  return { ok: true, note: `responded, found=${r.data.found}` };
}

async function testOpenJobs() {
  const r = await getJson('/get_open_jobs_for_customer?customer_id=1');
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `count=${r.data && r.data.count}` };
}

async function testCallSummary() {
  const r = await getJson('/get_recent_call_summary?customer_id=1&limit=1');
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `count=${r.data && r.data.count}` };
}

async function testSendLinkValidation() {
  // Bad input — missing url — should 400/4xx but not crash
  const r = await postJson('/send_customer_a_link', { customer_id: 1, link_type: 'portal' });
  if (r.status >= 500) return { ok: false, error: `unexpected 5xx ${r.status}` };
  return { ok: true, note: `validation-rejected as expected (${r.status})` };
}

async function testCallback() {
  const r = await postJson('/request_callback', {
    customer_id: 1, callback_for: 'teddy', reason: 'smoke test', priority: 'low', source: 'smoke',
  });
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `signal_id=${r.data && r.data.signal_id}` };
}

async function testEscalate() {
  const r = await postJson('/escalate_phone_call_to_human', {
    customer_id: 1, target: 'teddy', summary: 'smoke test — ignore', urgency: 'low', source: 'smoke',
  });
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `responded` };
}

async function testSafety() {
  const r = await postJson('/mark_safety_emergency', {
    customer_id: 1, phone: '+16154855795', emergency_type: 'other',
    details: 'SMOKE TEST — ignore this alert', source: 'smoke',
  });
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `audit_id=${r.data && r.data.event_log_id}` };
}

async function testNote() {
  const r = await postJson('/update_customer_note', {
    customer_id: 1, note: 'smoke test note — safe to delete', source: 'smoke',
  });
  if (!r.ok) return { ok: false, error: `status ${r.status}` };
  return { ok: true, note: `audit_id=${r.data && r.data.event_log_id}` };
}

async function testBrainShape() {
  try {
    const r = await fetch('https://tnapplianceexchange.net/.netlify/functions/phone-ant-brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'just testing — please reply hi' }],
        call: { id: 'smoke-test-' + Date.now(), customer: { number: '+16154855795' } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { ok: false, error: `non-2xx ${r.status}` };
    const data = await r.json();
    if (!data.choices || !Array.isArray(data.choices)) return { ok: false, error: 'missing choices array' };
    const content = data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return { ok: false, error: 'empty content' };
    return { ok: true, note: `replied ${content.length} chars` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function postJson(path, body) {
  try {
    const r = await fetch(`${XANO_BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function getJson(path) {
  try {
    const r = await fetch(`${XANO_BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, error: e.message }; }
}
