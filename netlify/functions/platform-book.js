// platform-book — PUBLIC online-booking endpoint for a shop's "Book us" page.
//
// Unlike platform-lead (secret-gated, for Ann's tools), this is public + unauthenticated
// so a shop can put its booking link on its website / Google Business Profile. It only
// accepts bookings for an ACTIVE shop that hasn't turned booking off, has a honeypot +
// required-field guard against spam, and lands the request as a real job on that shop's
// board (status "new") via the shared createLeadJob — same lander Ann uses, so it dedupes,
// mints a portal token, and shows on the office board + tech app instantly.
//
//   GET  ?slug=<shop>            -> { ok, slug_name, trade, accent, phone, area, booking_enabled }  (for the branded page)
//   POST { slug, name, phone, appliance, problem, address, city, state, zip, availability, email, company_website(honeypot) }
//        -> { ok, message, job_id }
//
// Per-shop off switch: company.settings.booking.enabled === false.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { createLeadJob } = require('./_lib/platform-db');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'content-type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function shopInfo(slug) {
  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/company?slug=eq.${encodeURIComponent(slug)}&select=id,name,trade,status,settings&limit=1`, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => []);
  return (d && d[0]) || null;
}
function bookingEnabled(co) {
  const b = (co.settings && co.settings.booking) || {};
  const st = String(co.status || 'active').toLowerCase();
  const active = ['active', 'trial', 'trialing', 'test', ''].includes(st);
  return active && b.enabled !== false;
}
function display(co) {
  const s = co.settings || {};
  const biz = s.business || {};
  const site = s.site || {};
  return {
    slug_name: co.name,
    trade: co.trade || 'appliance',
    accent: s.brand_color || site.brand_color || '',
    phone: biz.phone || s.phone || '',
    area: biz.area || site.area || biz.city || site.city || '',
    booking_enabled: bookingEnabled(co),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const gslug = String(q.slug || '').toLowerCase().trim();

  if (event.httpMethod === 'GET') {
    if (!gslug) return json(200, { ok: false, error: 'need slug' });
    const co = await shopInfo(gslug);
    if (!co) return json(200, { ok: false, error: 'unknown_shop' });
    return json(200, { ok: true, ...display(co) });
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }
  // Honeypot — bots fill the hidden company_website field. Silently accept, do nothing.
  if (String(p.company_website || '').trim()) return json(200, { ok: true, message: 'booked' });

  const slug = String(p.slug || gslug || '').toLowerCase().trim();
  if (!slug) return json(200, { ok: false, error: 'need slug' });
  const co = await shopInfo(slug);
  if (!co) return json(200, { ok: false, error: 'unknown_shop' });
  if (!bookingEnabled(co)) return json(200, { ok: false, error: 'booking_unavailable' });

  const name = String(p.name || '').trim();
  const phone = String(p.phone || '').trim();
  const appliance = String(p.appliance || p.what || '').trim();
  if (!name || String(phone).replace(/\D/g, '').length < 10) return json(200, { ok: false, error: 'Please enter your name and a valid phone number.' });

  // Fold address + availability into the detail so the office sees everything on the job
  // (no schema change; createLeadJob puts detail into the problem + the thread).
  const bits = [];
  const problem = String(p.problem || p.detail || p.issue || '').trim(); if (problem) bits.push(problem);
  const addr = [p.address, p.city, p.state, p.zip].map((x) => String(x || '').trim()).filter(Boolean).join(', '); if (addr) bits.push('Address: ' + addr);
  const avail = String(p.availability || '').trim(); if (avail) bits.push('Prefers: ' + avail);
  const email = String(p.email || '').trim(); if (email) bits.push('Email: ' + email);
  const detail = bits.join(' · ');

  const res = await createLeadJob({
    slug, name, phone,
    what: appliance || (co.trade === 'automotive' ? 'Vehicle' : 'Appliance'),
    detail, city: String(p.city || '').trim(), source: 'online_booking',
  });
  if (!res || !res.ok) return json(200, { ok: false, error: (res && res.error) || 'could_not_book' });
  return json(200, { ok: true, message: 'booked', job_id: res.job_id, deduped: !!res.deduped });
};
