// set-call-forwarding — point a Telnyx number straight at a cell (or turn it
// off), at the carrier level, BEFORE the call ever reaches Vapi. Used to send
// the old 615-280-2949 line (AHS calls it, they were dropping in Vapi) directly
// to Teddy's cell. Reversible: pass enabled=false to remove the forward.
//
//   GET /.netlify/functions/set-call-forwarding?number=+16152802949&to=+16154855795&token=<secret>
//   GET /.netlify/functions/set-call-forwarding?number=+16152802949&enabled=false&token=<secret>
//
// Uses the TELNYX_API_KEY already in Netlify env.
'use strict';

const TOKEN = 'tn-fwd-2026-06-17';

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  if ((p.token || '') !== TOKEN) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'bad token' }) };

  const number = (p.number || '').trim();
  const to = (p.to || '+16154855795').trim();
  const enabled = String(p.enabled == null ? 'true' : p.enabled).toLowerCase() !== 'false';
  if (!number) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'number required (E.164, e.g. +16152802949)' }) };

  const apiKey = process.env.TELNYX_API_KEY || '';
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'TELNYX_API_KEY not set in Netlify env' }) };

  // Find the number's Telnyx id.
  let found = null;
  try {
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(`https://api.telnyx.com/v2/phone_numbers?page[size]=250&page[number]=${page}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'telnyx list failed', status: r.status, body: (await r.text()).slice(0, 400) }) };
      const d = await r.json();
      const items = Array.isArray(d.data) ? d.data : [];
      found = items.find((n) => n.phone_number === number);
      if (found) break;
      const total = (d.meta && d.meta.total_pages) || 1;
      if (page >= total || items.length === 0) break;
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'list error: ' + (e.message || e) }) };
  }
  if (!found) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'number not in Telnyx account', number }) };

  // PATCH voice call_forwarding.
  try {
    const r = await fetch(`https://api.telnyx.com/v2/phone_numbers/${found.id}/voice`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_forwarding: enabled
          ? { call_forwarding_enabled: true, forwards_to: to, forwarding_type: 'always' }
          : { call_forwarding_enabled: false },
      }),
    });
    const body = await r.text();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: r.ok, number, id: found.id, enabled, forwards_to: enabled ? to : null, status: r.status, response: body.slice(0, 400) }, null, 2) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'patch error: ' + (e.message || e) }) };
  }
};
