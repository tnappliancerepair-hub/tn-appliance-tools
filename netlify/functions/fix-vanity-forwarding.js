// fix-vanity-forwarding — DIAGNOSE + UNDO the 6/2 call-forwarding that is
// sending customer calls to personal cells.
//
// Background: setup-vanity-forwarding.js (6/2) set call_forwarding
// (forwarding_type "always") on the vanity numbers to ring a personal cell.
// On 6/6 we made 866-268-0111 the PRIMARY published customer number, so every
// customer call now force-forwards to a personal phone instead of routing to
// the Ant Inbound voice app. This undoes that.
//
// USAGE (trigger from any browser, phone is fine):
//   Diagnose (no changes) — shows EVERY Telnyx number whose call-forwarding is
//   ON and where it points, so we can see exactly which numbers are leaking:
//     /.netlify/functions/fix-vanity-forwarding?token=<TOKEN>
//
//   Fix — disable call-forwarding so the numbers fall back to their Voice App
//   (Ant Inbound) routing. Pass a comma list of numbers, or "all":
//     /.netlify/functions/fix-vanity-forwarding?token=<TOKEN>&disable=+18662680111,+18882688998
//     /.netlify/functions/fix-vanity-forwarding?token=<TOKEN>&disable=all
//
// SAFETY: diagnose first. Disabling forwarding only routes correctly if the
// number is assigned to a Voice Application (connection_id present in the
// diagnose output). If a number shows forwarding ON but NO connection, do not
// blind-disable it — it would route calls nowhere. Confirm the connection
// first (866-268-0111 should be on the Ant Inbound voice app per CLAUDE.md).
//
// Reuses TELNYX_API_KEY (already in Netlify env). Delete this file once the
// routing is confirmed clean so the URL can't be re-used.

const HARDCODED_TOKEN = 'tn-fwd-fix-2026-06-08-q3m8z';

async function listAllNumbers(apiKey) {
  let all = [];
  let page = 1;
  while (true) {
    const r = await fetch(
      `https://api.telnyx.com/v2/phone_numbers?page[size]=250&page[number]=${page}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`telnyx list failed ${r.status}: ${txt.slice(0, 300)}`);
    }
    const d = await r.json();
    const items = Array.isArray(d.data) ? d.data : [];
    all = all.concat(items);
    const total = (d.meta && d.meta.total_pages) || 1;
    if (page >= total || items.length === 0) break;
    page++;
  }
  return all;
}

async function getVoiceSettings(apiKey, id) {
  const r = await fetch(`https://api.telnyx.com/v2/phone_numbers/${id}/voice`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const d = await r.json().catch(() => ({}));
  return d.data || {};
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  if ((params.token || '') !== HARDCODED_TOKEN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'bad token' }) };
  }
  const apiKey = process.env.TELNYX_API_KEY || '';
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'TELNYX_API_KEY not set' }) };
  }

  let numbers;
  try {
    numbers = await listAllNumbers(apiKey);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e.message || e) }) };
  }

  // Build a forwarding report for every number.
  const report = [];
  for (const n of numbers) {
    const v = await getVoiceSettings(apiKey, n.id);
    const cf = (v && v.call_forwarding) || {};
    report.push({
      number: n.phone_number,
      id: n.id,
      connection_id: n.connection_id || v.connection_id || null,
      forwarding_enabled: !!cf.call_forwarding_enabled,
      forwards_to: cf.forwards_to || null,
      forwarding_type: cf.forwarding_type || null,
    });
  }

  const leaking = report.filter((r) => r.forwarding_enabled);

  // DIAGNOSE mode (default) — no changes.
  if (!params.disable) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          mode: 'diagnose',
          note: 'Numbers with forwarding_enabled=true are sending calls to forwards_to instead of their Voice App. To fix, re-call with &disable=<comma list> or &disable=all.',
          numbers_forwarding: leaking,
          all_numbers: report,
        },
        null,
        2,
      ),
    };
  }

  // FIX mode — disable call_forwarding on the requested numbers.
  const wanted =
    params.disable === 'all'
      ? leaking.map((r) => r.number)
      : params.disable.split(',').map((s) => s.trim());

  const results = [];
  for (const num of wanted) {
    const row = report.find((r) => r.number === num);
    if (!row) {
      results.push({ number: num, ok: false, reason: 'not_in_account' });
      continue;
    }
    if (!row.connection_id) {
      results.push({
        number: num,
        ok: false,
        reason: 'no_voice_app_connection — disabling would route calls NOWHERE; assign a Voice App first',
      });
      continue;
    }
    try {
      const r = await fetch(`https://api.telnyx.com/v2/phone_numbers/${row.id}/voice`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_forwarding: { call_forwarding_enabled: false },
        }),
      });
      const body = await r.text();
      results.push({ number: num, ok: r.ok, status: r.status, response: body.slice(0, 300) });
    } catch (e) {
      results.push({ number: num, ok: false, error: String(e.message || e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'fix', disabled: results }, null, 2),
  };
};
