// One-shot: configure call-forwarding on the 888 + 866 vanity numbers via
// the Telnyx API so they ring Teddy's cell. Bypasses the locked-out
// Telnyx portal entirely.
//
// Usage:
//   GET /.netlify/functions/setup-vanity-forwarding?to=+16154855795&token=<secret>
//
// Requires the same TELNYX_API_KEY env var that customer-sms-inbound etc.
// already use. Default forward target is Teddy's cell so the typical call is
// just /.netlify/functions/setup-vanity-forwarding?token=<secret>
//
// Token is hardcoded so Teddy doesn't need to set any Netlify env var.
// Delete this whole file after the routing is set so the URL can't be
// re-used to redirect calls.
const HARDCODED_TOKEN = 'tn-vanity-fix-2026-06-02-x9k7q';

const VANITY_NUMBERS = ['+18882688998', '+18662680111'];

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const target = params.to || '+16154855795'; // Teddy's cell default
  const supplied = params.token || '';

  const apiKey = process.env.TELNYX_API_KEY || '';
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'TELNYX_API_KEY not set in Netlify env' }) };
  }

  if (supplied !== HARDCODED_TOKEN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'bad token' }) };
  }

  const results = [];
  // Step 1 — list phone numbers, find the vanity ones by phone_number field
  let allNumbers = [];
  try {
    let page = 1;
    while (true) {
      const r = await fetch(`https://api.telnyx.com/v2/phone_numbers?page[size]=250&page[number]=${page}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        return { statusCode: 502, body: JSON.stringify({ error: 'telnyx list failed', status: r.status, body: txt.slice(0, 500) }) };
      }
      const d = await r.json();
      const items = Array.isArray(d.data) ? d.data : [];
      allNumbers = allNumbers.concat(items);
      const total = d.meta && d.meta.total_pages ? d.meta.total_pages : 1;
      if (page >= total || items.length === 0) break;
      page++;
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'list error: ' + (e.message || e) }) };
  }

  for (const vanity of VANITY_NUMBERS) {
    const found = allNumbers.find((n) => n.phone_number === vanity);
    if (!found) {
      results.push({ number: vanity, ok: false, reason: 'not_in_account' });
      continue;
    }
    // Step 2 — set call_forwarding on the voice settings
    try {
      const patchRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${found.id}/voice`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          call_forwarding: {
            call_forwarding_enabled: true,
            forwards_to: target,
            forwarding_type: 'always',
          },
        }),
      });
      const body = await patchRes.text();
      results.push({
        number: vanity,
        id: found.id,
        status: patchRes.status,
        ok: patchRes.ok,
        response: body.slice(0, 400),
      });
    } catch (e) {
      results.push({ number: vanity, ok: false, error: e.message || String(e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, count: VANITY_NUMBERS.length, results }, null, 2),
  };
};
