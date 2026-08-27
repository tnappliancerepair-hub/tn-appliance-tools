// onboard-shop — THE mass-production button. Stands up a whole shop in ONE call, the
// way Housecall Pro has a new signup live instantly. It orchestrates the five existing
// pieces (all data/API — zero code edits, zero deploy per shop):
//   1) an Ann phone number   (reuse a passed number, an already-registered one, or buy one)
//   2) the platform tenant + the owner's login   (platform-provision)
//   3) the shop in Ann's data-driven registry     (trial-ann-admin add_shop)
//   4) the shop's Ann AI assistant                 (trial-ann-admin create)
//   5) the number bound to that assistant          (trial-ann-admin bind)
// Fully idempotent: re-running with the same slug reuses the number, tenant, login, and
// assistant instead of duplicating them — so a retry is safe and a batch can be replayed.
//
//   GET/POST ?action=onboard&secret=<admin>
//     &name=The%20Appliance%20Guy &type=appliance &area=Greater%20Richmond
//     &about=... &hours=Mon-Fri%208-5
//     &owner_first=TK &owner_name=TK%20Cousins &owner_email=tk@x.com &owner_cell=+18045551234
//     [ &slug=the-appliance-guy ]                       (else auto-slugged from name)
//     [ &number=+18046061234 ]                          (use a number you already bought)
//     [ &buy_area=804 &buy_ends=1234 | &buy_contains=606 ]   (or buy one on the fly)
//  -> { ready, slug, ann_number, board_url, portal_note, owner_login:{email,temp_password},
//       assistant_id, steps:{...} }
'use strict';

const { getSecret } = require('./_lib/secrets');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
let shops = null; try { shops = require('./_lib/trial-shops'); } catch (_) {}

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function slugify(s) { return String(s || '').toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
function e164(p) { const d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d; if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'content-type': 'application/json' }, body: '' };
  const q = Object.assign({}, event.queryStringParameters || {}, (function () { try { return JSON.parse(event.body || '{}'); } catch (_) { return {}; } })());
  const secret = q.secret || '';
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (secret !== guard) return { statusCode: 403, body: 'forbidden' };
  if (String(q.action || 'onboard') !== 'onboard') return json(200, { ok: false, error: 'unknown action' });

  const SITE = 'https://' + (event.headers && (event.headers['x-forwarded-host'] || event.headers.host) || 'tnapplianceexchange.net');
  const FN = SITE + '/.netlify/functions/';
  const sub = async (fn, params) => {
    const qs = Object.entries(Object.assign({ secret }, params)).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    try {
      const r = await fetch(FN + fn + '?' + qs, { signal: AbortSignal.timeout(25000) });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, d };
    } catch (e) { return { ok: false, status: 0, d: { error: String((e && e.message) || e) } }; }
  };

  const name = String(q.name || '').trim();
  const type = String(q.type || 'appliance').toLowerCase().trim();
  const ownerCell = e164(q.owner_cell || q.owner_phone || '');
  const ownerEmail = String(q.owner_email || '').trim();
  if (!name) return json(200, { ok: false, error: 'need &name=' });
  if (!ownerCell) return json(200, { ok: false, error: 'need &owner_cell= (where the shop gets its lead texts)' });
  const slug = slugify(q.slug || name);
  if (!slug) return json(200, { ok: false, error: 'could not derive a slug — pass &slug=' });
  const steps = {};

  // existing registry entry (idempotency source of truth for number + assistant)
  let existing = null; try { existing = await shops.getAsync(slug); } catch (_) {}
  if (existing && existing._source === 'file') return json(200, { ok: false, error: 'slug "' + slug + '" is a curated file shop — pick another slug' });

  // ── 1) Ann phone number ────────────────────────────────────────────────────
  let number = e164(q.number || '');
  if (!number && existing && existing.annNumber) number = e164(existing.annNumber);
  if (!number && q.buy_area) {
    const sr = await sub('telnyx-provision', { action: 'searchnew', area: String(q.buy_area).replace(/\D/g, ''), ends: q.buy_ends || '', contains: q.buy_contains || '' });
    const cands = (sr.d && (q.buy_contains ? sr.d.contains_matches : sr.d.ending_matches)) || [];
    const pick = cands[0];
    if (!pick) { steps.number = { ok: false, error: 'no number matched — try a different buy_area/buy_ends/buy_contains', searched: (sr.d && sr.d.returned) || 0 }; }
    else {
      const buy = await sub('telnyx-provision', { action: 'buynew', number: pick, confirm: 'yes' });
      if (buy.ok && buy.d && (buy.d.ok || buy.d.ordered || buy.d.order_id)) { number = e164(pick); steps.number = { ok: true, bought: number }; }
      else steps.number = { ok: false, error: 'buy failed', detail: buy.d };
    }
  }
  if (number && !steps.number) steps.number = { ok: true, using: number, note: q.number ? 'passed' : 'reused' };
  if (!number) steps.number = steps.number || { ok: false, error: 'no number — pass &number= or &buy_area=; onboarding continues, bind a number later' };

  // ── 2) platform tenant + owner login ───────────────────────────────────────
  const prov = await sub('platform-provision', {
    action: 'provision', slug, name, trade: type,
    owner_email: ownerEmail, owner_name: q.owner_name || q.owner_first || '', owner_phone: ownerCell,
    area: q.area || '', seed: '1',
  });
  steps.tenant = prov.d && prov.d.ok
    ? { ok: true, company_id: prov.d.company && prov.d.company.id, login: prov.d.login || null }
    : { ok: false, error: (prov.d && (prov.d.error || prov.d.step)) || 'provision failed', detail: prov.d };

  // ── 3) Ann registry ────────────────────────────────────────────────────────
  const reg = await sub('trial-ann-admin', {
    action: 'add_shop', slug, name, type, area: q.area || '', about: q.about || '', hours: q.hours || '',
    owner_first: q.owner_first || '', owner_cell: ownerCell, email: ownerEmail,
    platform_slug: slug, ann_number: number || '',
  });
  steps.registry = reg.d && reg.d.ok ? { ok: true } : { ok: false, error: (reg.d && reg.d.error) || 'add_shop failed' };

  // ── 4) Ann assistant (reuse if already made) ───────────────────────────────
  let assistantId = (existing && existing.assistantId) || '';
  if (!assistantId) {
    const cr = await sub('trial-ann-admin', { action: 'create', shop: slug });
    assistantId = (cr.d && (cr.d.assistant_id || (cr.d.response && cr.d.response.id))) || '';
    steps.assistant = assistantId ? { ok: true, created: assistantId } : { ok: false, error: (cr.d && cr.d.error) || 'create failed', detail: cr.d };
  } else steps.assistant = { ok: true, reused: assistantId };

  // ── 5) bind number → assistant ─────────────────────────────────────────────
  if (number && assistantId) {
    const bd = await sub('trial-ann-admin', { action: 'bind', id: assistantId, number, shop: slug });
    steps.bind = bd.d && bd.d.ok ? { ok: true, number } : { ok: false, error: (bd.d && bd.d.error) || 'bind failed', detail: bd.d };
  } else steps.bind = { ok: false, skipped: true, why: !number ? 'no number yet' : 'no assistant' };

  const ready = !!(steps.tenant.ok && steps.registry.ok && steps.assistant.ok && (steps.bind.ok || !number));
  return json(200, {
    ok: true, ready, slug,
    ann_number: number || null,
    board_url: SITE + '/platform/office-board.html',
    owner_login: (steps.tenant.ok && steps.tenant.login) || null,
    assistant_id: assistantId || null,
    portal_note: 'Leads land on the board automatically; the customer gets the intake link; the cockpit is /platform/tech-job.html?job=<id>',
    steps,
    tell_owner: ready
      ? `${name} is live. Ann answers ${number || '(no number yet)'} 24/7, leads hit ${ownerCell}, board: ${SITE}/platform/office-board.html`
      : 'Some steps need attention — see steps{} above.',
  });
};
