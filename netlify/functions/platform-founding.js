// platform-founding — the honest spot counter behind the switching offer.
//
// Public and deliberately dumb: it returns two numbers and nothing else. No names,
// no slugs, no emails. A scarcity counter that can be read is a scarcity counter
// somebody will check, so it must not leak who the other shops are.
//
// WHY THIS IS REAL SCARCITY AND NOT A MARKETING TIMER: the constraint is genuine.
// Whole-shop software failing means a shop cannot run their day, and the founding
// deal promises the founder answers you personally. That is not something one
// person does for fifty shops at once. Five shops supported beautifully beat fifty
// who churn angry. So the cap exists whether or not it is on a landing page - the
// page just says it out loud.
//
//   GET  -> { ok, total, claimed, remaining, open }
//
// Set FOUNDING_TOTAL to change the cap. Set FOUNDING_CLOSED=true to end the offer
// without editing the page.
'use strict';

const { getSecret } = require('./_lib/secrets');

// Shops that exist for our own reasons and were never a founding signup.
const INTERNAL = /^(demo|demoline|tn|test|zz|clone-audit|hcp-import-demo|test-shop|tn-appliance-exchange-llc)/i;

function json(code, body, maxAge) {
  return {
    statusCode: code,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge || 60}` },
    body: JSON.stringify(body),
  };
}

exports.handler = async function () {
  const total = Math.max(1, parseInt(process.env.FOUNDING_TOTAL || '20', 10) || 20);
  const closed = String(process.env.FOUNDING_CLOSED || '') === 'true';

  // A counter that fails should never invent a number. If we can't count, we say
  // the offer is open and show no figure rather than print a fake one.
  let claimed = null;
  try {
    const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
    const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
    if (url && key) {
      const base = String(url).replace(/\/+$/, '');
      const r = await fetch(`${base}/rest/v1/company?select=slug&limit=500`, {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const rows = await r.json().catch(() => []);
        claimed = (Array.isArray(rows) ? rows : []).filter((c) => !INTERNAL.test(String(c.slug || ''))).length;
      }
    }
  } catch (_) { claimed = null; }

  const remaining = claimed == null ? null : Math.max(0, total - claimed);
  return json(200, {
    ok: true,
    total,
    claimed,
    remaining,
    open: !closed && (remaining == null || remaining > 0),
  });
};
