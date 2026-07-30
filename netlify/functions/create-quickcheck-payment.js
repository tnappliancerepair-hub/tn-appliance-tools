// create-quickcheck-payment — creates the $50 Quick Check Stripe Checkout session
// for the appliance-AI flow. Carries the captured intake (name/phone/address/
// appliance/brand/problem/town/sms-consent) as metadata so, on payment, the
// verify step can create the cash job + fire the 💵 siren. No job exists yet —
// the $50 is what kicks the whole thing off (pay-to-start).
//
//   POST { name, phone, address, city, zip, appliance, brand, problem, payer, sms_consent, town }
//   -> { ok, url }   (redirect the browser to url)

'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');

const PRICE_CENTS = 5000; // LIVE $50 Quick Check (was $1 during testing). ?qc=<token> still charges $1 for test runs.
// Test override: a link carrying ?qc=<this token> charges $1 so we can run the
// full flow end-to-end without flipping the live price (real customers stay $50).
const QC_TEST_TOKEN = 'tn-qc-test-2026';
const TEST_PRICE_CENTS = 100; // $1
// 🎁 Ant's Gift — launch promo: 50% off the Quick Check for EVERYONE (time-limited).
// LAUNCH_DEFAULT = on out of the box; end it anytime by setting vault ANTS_GIFT_LAUNCH=false
// (or flip this to false). The $25 credits toward the part; all sales final (defective
// parts still replaced). Respects COMMUNITY_GIFT_PAUSED. (Teddy 2026-07-30.)
const LAUNCH_DEFAULT = true;
const SITE = 'https://tnapplianceexchange.net';

function s(v, max) { return String(v == null ? '' : v).slice(0, max || 480); }

// Allow the call from any TN Appliance host (www or non-www) so a www page load
// doesn't get "Load failed" on the cross-origin POST.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  // GET ?price=1 → the page asks what to show. Same source of truth as the charge, so
  // "$25 (was $50)" on the page can never disagree with what Stripe actually bills.
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q.price) {
      const paused = String((await getSecret('COMMUNITY_GIFT_PAUSED')) || '').toLowerCase() === 'true';
      const lf = String((await getSecret('ANTS_GIFT_LAUNCH')) ?? '').toLowerCase();
      const on = !paused && (lf === 'true' || (lf === '' && LAUNCH_DEFAULT));
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, promo: 'ants_gift_50', promo_active: on, quick_check_cents: on ? 2500 : 5000, in_home_cents: on ? 5000 : 10000, regular_quick_check_cents: 5000, regular_in_home_cents: 10000 }) };
    }
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const phone = s(b.phone, 40);
  if (phone.replace(/\D/g, '').length < 10) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };

  const email = s(b.email, 120);
  const machine = [s(b.brand, 40), s(b.appliance, 40)].filter(Boolean).join(' ') || 'appliance';
  const isTest = s(b.qc_test, 40) === QC_TEST_TOKEN;
  // service: 'in_home' = $100 tech-comes-out (pay before we schedule), else $50 phone
  // Quick Check. Test token makes either $1. (Teddy 2026-06-27.)
  const service = s(b.service, 20) === 'in_home' ? 'in_home' : 'quick_check';
  const lang = s(b.language, 8).toLowerCase();
  const baseCents = service === 'in_home' ? 10000 : PRICE_CENTS;
  let priceCents = isTest ? TEST_PRICE_CENTS : baseCents;
  // ⛪ Church partnership: a member referred by a Spanish church carries a church
  // code (their church's link/card) → $25 off. Recorded for per-church attribution.
  // Honoring the communities that helped us — Anthony was baptized in one.
  const church = s(b.church, 40).trim().toUpperCase().replace(/[^A-Z0-9 .-]/g, '');
  const CHURCH_OFF = 2500; // $25
  // 🛑 One-flip pause: if we ever get overwhelmed, set env COMMUNITY_GIFT_PAUSED=true
  // and every church/partner code stops discounting (charges full $50). Flip back
  // to re-open. (Cards already handed out just won't discount while paused.)
  const giftPaused = String((await getSecret('COMMUNITY_GIFT_PAUSED')) || '').toLowerCase() === 'true';
  // 🎁 Ant's Gift launch promo: 50% off for everyone (time-limited, reversible via
  // vault ANTS_GIFT_LAUNCH=false). Applied to the base price BEFORE church/partner and
  // never stacks with them (it already gives ≥ their $25). The $25 credits to the part.
  const launchFlag = String((await getSecret('ANTS_GIFT_LAUNCH')) ?? '').toLowerCase();
  const antsGiftApplies = !isTest && !giftPaused && (launchFlag === 'true' || (launchFlag === '' && LAUNCH_DEFAULT));
  if (antsGiftApplies) priceCents = Math.max(100, Math.round(baseCents * 0.5));
  const churchApplies = !isTest && !giftPaused && !antsGiftApplies && church.length >= 2;
  if (churchApplies) priceCents = Math.max(100, priceCents - CHURCH_OFF);
  // 🤝 Community partner program: same $25 gift extended to ANY community org that
  // helps its people — food banks, senior centers, immigrant/refugee groups,
  // shelters, apartment communities, schools, nonprofits. Same mechanism as the
  // church code, but neutral wording on the receipt. Never stacks with a church code.
  const partner = s(b.partner, 40).trim().toUpperCase().replace(/[^A-Z0-9 .-]/g, '');
  const partnerApplies = !isTest && !giftPaused && !antsGiftApplies && !churchApplies && partner.length >= 2;
  if (partnerApplies) priceCents = Math.max(100, priceCents - CHURCH_OFF);
  let productName = isTest
    ? (service === 'in_home' ? 'In-Home Diagnostic — TEST ($1)' : 'Appliance Quick Check — TEST ($1)')
    : (service === 'in_home'
        ? 'In-Home Diagnostic — tech comes to you ($100, credited to your repair)'
        : 'Appliance Quick Check — honest diagnosis ($50, credited to your repair)');
  // Spanish product name so the whole Stripe page reads in Spanish (locale set below).
  if (lang === 'es') {
    productName = isTest
      ? (service === 'in_home' ? 'Diagnóstico a domicilio — PRUEBA ($1)' : 'Revisión rápida — PRUEBA ($1)')
      : (service === 'in_home'
          ? 'Diagnóstico a domicilio — un técnico va a tu casa ($100, se acredita a tu reparación)'
          : 'Revisión rápida de electrodoméstico — diagnóstico honesto ($50, se acredita a tu reparación)');
  }
  if (lang === 'vi') {
    productName = isTest
      ? (service === 'in_home' ? 'Chẩn đoán tại nhà — THỬ ($1)' : 'Kiểm tra nhanh — THỬ ($1)')
      : (service === 'in_home'
          ? 'Chẩn đoán tại nhà — kỹ thuật viên đến tận nơi ($100, được trừ vào chi phí sửa)'
          : 'Kiểm tra nhanh thiết bị — chẩn đoán trung thực ($50, được trừ vào chi phí sửa)');
  }
  if (lang === 'zh') {
    productName = isTest
      ? (service === 'in_home' ? '上门诊断 — 测试 ($1)' : '快速检测 — 测试 ($1)')
      : (service === 'in_home'
          ? '上门诊断 — 技师上门 ($100，可抵扣维修费用)'
          : '电器快速检测 — 诚实诊断 ($50，可抵扣维修费用)');
  }
  if (lang === 'ru') {
    productName = isTest
      ? (service === 'in_home' ? 'Диагностика на дому — ТЕСТ ($1)' : 'Быстрая проверка — ТЕСТ ($1)')
      : (service === 'in_home'
          ? 'Диагностика на дому — мастер приедет к вам ($100, засчитывается в ремонт)'
          : 'Быстрая проверка техники — честная диагностика ($50, засчитывается в ремонт)');
  }
  if (antsGiftApplies) {
    productName += lang === 'es' ? " — 🎁 Regalo de Ant: 50% de descuento (pagas $25, se acredita a tu pieza)"
      : lang === 'zh' ? " — 🎁 Ant 礼物：五折（支付 $25，可抵扣零件）"
      : lang === 'ru' ? " — 🎁 Подарок Ant: скидка 50% ($25, засчитывается в деталь)"
      : lang === 'vi' ? " — 🎁 Quà của Ant: giảm 50% (trả $25, trừ vào linh kiện)"
      : " — 🎁 Ant's Gift: 50% off (you pay $25, credited to your part)";
  } else if (churchApplies) {
    productName += lang === 'es' ? ' — Descuento de iglesia (−$25)' : ' — Church discount (−$25)';
  } else if (partnerApplies) {
    productName += lang === 'es' ? ' — Descuento comunitario (−$25)' : lang === 'zh' ? ' — 社区优惠 (−$25)' : lang === 'ru' ? ' — Скидка для сообщества (−$25)' : ' — Community discount (−$25)';
  }
  try {
    const stripe = new Stripe(key);
    const opts = {
      mode: 'payment',
      // EASIEST checkout (Teddy 2026-06-27): no payment_method_types set, so Stripe
      // Checkout uses the DASHBOARD's automatic payment methods — Apple Pay / Google
      // Pay / Link / card by device (one-tap Apple Pay on iPhone, no typing). The
      // "confirm it's you" wall Teddy hit was just Link recognizing his OWN email;
      // normal customers tap a wallet, save to Link, or type a card (and Checkout
      // always offers "Pay without Link"). To make wallets show, enable Apple Pay/
      // Google Pay + verify the domain in the Stripe Dashboard (Settings > Payments).
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: productName }, unit_amount: priceCents },
        quantity: 1,
      }],
      success_url: `${SITE}/quick-check-thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/appliance-ai.html`,
      metadata: {
        kind: service,
        service: service,
        amount_cents: String(priceCents),
        is_test: isTest ? 'yes' : 'no',
        name: s(b.name, 120), phone: phone, email: email,
        address: s(b.address, 200), city: s(b.city, 80), zip: s(b.zip, 12),
        appliance: s(b.appliance, 60), brand: s(b.brand, 60), machine: s(machine, 80),
        problem: s(b.problem, 400),
        payer: s(b.payer, 20) || 'cash',
        sms_consent: b.sms_consent ? 'yes' : 'no',
        availability: s(b.availability, 300),
        language: s(b.language, 8) || 'en',
        town: s(b.town, 80),
        hose_item: s(b.hose_item, 60),
        hose_choice: s(b.hose_choice, 8),
        floors: s(b.floors, 20),
        floors_label: s(b.floors_label, 120),
        conv_id: s(b.conv_id, 40),
        church_code: churchApplies ? church : '',
        partner_code: partnerApplies ? partner : '',
        ants_gift: antsGiftApplies ? 'yes' : 'no',
        has_video: b.has_video ? 'yes' : 'no',
        has_model: b.has_model ? 'yes' : 'no',
        source: 'appliance_ai_quick_check',
      },
    };
    // Render the whole Stripe Checkout in the customer's language where Stripe
    // supports it (es/fr/vi are supported locales; ar/hi aren't, so those fall back
    // to auto — the product name still carries our wording).
    const STRIPE_LOCALES = { es: 'es', fr: 'fr', vi: 'vi', zh: 'zh', ru: 'ru' };
    if (STRIPE_LOCALES[lang]) opts.locale = STRIPE_LOCALES[lang];
    // pre-fill the Stripe email field so the customer doesn't have to type it (the
    // exact friction that stalled the first test). Falls back to Stripe asking if blank.
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) opts.customer_email = email;
    const session = await stripe.checkout.sessions.create(opts);
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
