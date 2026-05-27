// Creates a Stripe subscription for a tenant. POST {company_id,
// price_id, payment_method?, customer_email}. Returns Checkout
// Session URL for the operator to pay.
//
// ENV REQUIRED: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_PER_TECH_MONTHLY
const Stripe = require('stripe');

const SUCCESS = 'https://tnapplianceexchange.net/company-admin.html?subscription=active';
const CANCEL = 'https://tnapplianceexchange.net/company-admin.html?subscription=canceled';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const companyId = Number(body.company_id || 0);
  const techCount = Number(body.tech_count || 1);
  const email = String(body.customer_email || '').trim();

  if (!companyId || !email) {
    return jsonResp(400, { ok: false, error: 'company_id + customer_email required' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_PER_TECH_MONTHLY;
  if (!key || !priceId) {
    return jsonResp(200, {
      ok: true,
      placeholder: true,
      url: `mailto:tnappliancerepair@gmail.com?subject=Ant%20subscription%20-%20company%20${companyId}&body=Set%20up%20billing%20for%20${techCount}%20techs%20at%20%2449%2Fmo%20each`,
      note: 'STRIPE_SECRET_KEY or STRIPE_PRICE_ID_PER_TECH_MONTHLY not set — returned mailto placeholder',
    });
  }

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: techCount }],
      success_url: SUCCESS,
      cancel_url: CANCEL,
      customer_email: email,
      metadata: { company_id: String(companyId), tech_count: String(techCount) },
    });
    return jsonResp(200, { ok: true, url: session.url, session_id: session.id });
  } catch (err) {
    return jsonResp(500, { ok: false, error: err.message });
  }
};

function jsonResp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
