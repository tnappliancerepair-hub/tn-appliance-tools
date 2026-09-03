// platform-frontdoor-webhook — the multi-tenant Frontdoor/AHS receiver for the NEW
// platform (Frontdoor -> a shop's Supabase board). Frontdoor POSTs dispatch lifecycle
// events (schedule / status / notes / ncc) to a PER-SHOP URL:
//
//   POST /.netlify/functions/platform-frontdoor-webhook?slug=<shop>&k=<TELNYX_TOOL_SECRET>
//        (Authorization: Bearer <FRONTDOOR_WEBHOOK_TOKEN>)   body = [ { …event… } ]
//
// The SHOP is baked into the URL (?slug=…&k=…) exactly like platform-lead / platform-
// precall / the call-brain tools — so no vendor_id→company map is needed; Frontdoor
// registers a distinct callback URL per vendor account. `demo` is an open sandbox.
//
// SAFETY — ships DARK. Until vault PLATFORM_FRONTDOOR_WEBHOOK_LIVE = '1' it authenticates,
// resolves the shop, parses + resolves each event, and returns a dry-run PREVIEW in the
// HTTP response with ZERO writes (no jobs, notes, ledger rows, or texts). Flip the flag to
// go live per shop's URL. Parser: _lib/frontdoor-parse (shared with the legacy receiver).
// Lander: _lib/platform-warranty-db (shared with platform-email-intake).
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const P = require('./_lib/frontdoor-parse');
const { createWarrantyJob, applyDispatchUpdate } = require('./_lib/platform-warranty-db');
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) { sendSms = null; }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function bearerOf(event) {
  const hs = event.headers || {};
  const m = /^Bearer\s+(.+)$/i.exec(String(hs.authorization || hs.Authorization || '').trim());
  return m ? m[1].trim() : '';
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const q = event.queryStringParameters || {};
  const slug = String(q.slug || '').toLowerCase().trim();
  if (!slug) return json(400, { ok: false, error: 'no_slug' });

  // Tool-key gate for REAL shops; the 'demo' tenant is an open sandbox. Fail-open only
  // when TELNYX_TOOL_SECRET isn't vaulted (matches platform-call-brain / platform-lead).
  if (slug !== 'demo') {
    const tk = await getSecret('TELNYX_TOOL_SECRET');
    if (tk && q.k !== tk) return json(403, { ok: false, error: 'forbidden' });
  }
  // Optional Frontdoor bearer (defense in depth). When configured we always enforce it.
  const expectedBearer = (await getSecret('FRONTDOOR_WEBHOOK_TOKEN')) || '';
  if (expectedBearer && bearerOf(event) !== expectedBearer) return json(401, { ok: false, error: 'unauthorized' });

  const live = (await getSecret('PLATFORM_FRONTDOOR_WEBHOOK_LIVE')) === '1';

  const db = await platform();
  if (!db) return json(200, { ok: false, error: 'platform_not_configured' });

  const cos = await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name,trade,settings&limit=1`);
  const co = cos && cos[0];
  if (!co) return json(200, { ok: false, error: 'unknown_shop:' + slug });

  let body; try { body = JSON.parse(event.body || 'null'); } catch (_) { return json(400, { ok: false, error: 'invalid JSON' }); }
  const events = Array.isArray(body) ? body : (body && typeof body === 'object' ? [body] : null);
  if (!events || !events.length) return json(400, { ok: false, error: 'expected a non-empty array of events' });

  const s0 = co.settings || {};
  const ownerCell = String(s0.owner_cell || (s0.business && s0.business.phone) || '').trim();
  async function alertOwner(bodyTxt) {
    if (!live || !sendSms || !ownerCell) return;
    try { await sendSms(ownerCell, bodyTxt, 'owner', 'warranty_intake'); } catch (_) {}
  }

  const results = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') { results.push({ ok: false, error: 'bad event' }); continue; }
    const s = P.summarize(ev);
    try {
      // Idempotency (live only): the (company_id, message_id) unique on email_intake — key
      // it by the event dedup string so a re-delivered status/note isn't applied twice.
      if (live && s.dedup) {
        const seen = await db.get(`email_intake?company_id=eq.${co.id}&message_id=eq.${encodeURIComponent(s.dedup)}&select=id,job_id,status&limit=1`);
        if (seen && seen[0]) { results.push({ operation: s.operation, dispatch_id: s.dispatch_id, deduped: true, status: seen[0].status, job_id: seen[0].job_id }); continue; }
      }

      let res, jobId = null, statusLabel = 'skipped', detail = '';
      if (s.operation === 'schedule') {
        const n = P.scheduleToJob(s);
        if (!live) {
          res = { operation: 'schedule', dispatch_id: s.dispatch_id, area: s.area, mode: 'dry_run', preview: { customer: [n.first, n.last].filter(Boolean).join(' '), appliance: n.appliance, brand: n.brand, city: n.city, warranty_company: n.warranty_company, phone: n.phone ? 'yes' : 'no' } };
        } else {
          const r = await createWarrantyJob(db, co, n);
          jobId = r.job_id; statusLabel = r.deduped ? 'deduped' : 'created';
          detail = r.deduped ? 'already on the board (dispatch match)' : 'new job';
          res = { operation: 'schedule', dispatch_id: s.dispatch_id, area: s.area, job_id: jobId, mode: r.deduped ? 'deduped' : 'created' };
          // expedited / medical / emergency → alert the shop owner the second it lands
          if (/expedit|emerg|medic|urgent/i.test(String(s.priority || '') + ' ' + String(s.dispatch_type || ''))) {
            await alertOwner('🚨 EXPEDITED warranty dispatch — ' + (s.customer || 'customer') + ' · ' + (s.appliance || 'appliance') + (s.city ? ' · ' + s.city : '') + ' (dispatch ' + s.dispatch_id + '). Open AssistAnt.');
          }
        }
      } else if (s.operation === 'status' || s.operation === 'notes' || s.operation === 'ncc') {
        res = await applyDispatchUpdate(db, co, s, live);
        jobId = res.job_id || null;
        statusLabel = res.matched ? (live ? 'applied' : 'preview') : 'unmatched';
        detail = res.matched ? (res.moved_to ? ('moved to ' + res.moved_to) : 'note added') : 'no matching job';
        // auth-denied → loud owner alert
        if (live && s.operation === 'status' && s.status_code != null && P.AUTHO_CODES[Number(s.status_code)] === 'denied' && jobId) {
          await alertOwner('⚠️ AHS AUTH DENIED — dispatch ' + s.dispatch_id + ' (job on your board). ' + (s.status || '') + ' — check the claim.');
        }
      } else {
        res = { operation: s.operation, dispatch_id: s.dispatch_id, mode: 'unknown_op' };
        statusLabel = 'skipped';
      }

      // Audit + idempotency ledger row — LIVE only (dark writes nothing). Reuses email_intake
      // (also the owner's "📥 Emailed jobs" feed); message_id = the event dedup key.
      if (live) {
        try {
          await db.insert('email_intake', {
            company_id: co.id, message_id: s.dedup || null, to_addr: null,
            from_addr: 'frontdoor', subject: 'Frontdoor ' + s.operation + ' ' + s.dispatch_id,
            vendor: P.TENANT_LABEL[s.tenant] || (s.tenant || 'frontdoor'), method: 'frontdoor_webhook',
            confidence: 'high', email_type: s.operation, claim_number: s.dispatch_id || null,
            job_id: jobId, status: statusLabel, detail, raw_excerpt: JSON.stringify(s).slice(0, 2000),
          });
        } catch (_) {}
      }

      results.push(res);
    } catch (e) {
      results.push({ operation: s.operation, dispatch_id: s.dispatch_id, mode: 'error', error: String((e && e.message) || e).slice(0, 140) });
    }
  }

  return json(200, { ok: true, shop: slug, mode: live ? 'live' : 'dark', received: events.length, results });
};
