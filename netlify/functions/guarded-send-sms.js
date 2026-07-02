// guarded-send-sms — the canonical, safe way to send a CUSTOMER text.
//
// Every current/future sender (Netlify functions, and the colony loop once it's
// pulled) should call THIS instead of Xano send_sms directly, so opt-out +
// quiet-hours + frequency + global-rate are enforced in one place.
//
//   POST { phone, message, tag?, kind?, allowQuiet? }
//     -> { ok, sent, reason, shadow? }
//
//   GET ?audit=1        -> opt-out list, recent blocks/would-blocks, today's volume
//   GET ?check=+1615...  -> { phone, opted_out, in_quiet_hours, sent_24h, sent_7d }
//   GET ?optout=+1...&secret=<VAPI_ADMIN_SECRET>  -> manually opt a number out
//   GET ?optin=+1...&secret=<VAPI_ADMIN_SECRET>   -> manually re-subscribe
'use strict';

const guard = require('./_lib/sms-guard');
const crud = require('./_lib/xano/metadata-crud');

const ADMIN = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : d; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};

  // ── GET: audit / check / manual opt-out-in ──
  if (event.httpMethod === 'GET') {
    if (q.optout || q.optin) {
      if (q.secret !== ADMIN) return { statusCode: 401, headers: CORS, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
      if (q.optout) { await guard.recordOptOut(q.optout, 'manual_admin'); return ok({ ok: true, opted_out: guard.toE164(q.optout) }); }
      await guard.clearOptOut(q.optin, 'manual_admin'); return ok({ ok: true, opted_in: guard.toE164(q.optin) });
    }
    if (q.check) {
      const to = guard.toE164(q.check); const now = Date.now();
      return ok({ ok: true, phone: to, opted_out: await guard.isOptedOut(to), in_quiet_hours: guard.inQuietHours(), sent_24h: await guard.sentSince(to, now - 86400000), sent_7d: await guard.sentSince(to, now - 7 * 86400000) });
    }
    // audit
    try {
      const outs = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_out' }, { id: 'desc' }, 200);
      const ins = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_in' }, { id: 'desc' }, 200);
      const blocked = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_blocked' }, { id: 'desc' }, 100);
      const would = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_would_block' }, { id: 'desc' }, 100);
      const now = Date.now();
      // Currently-opted-out = newest opt_out newer than newest opt_in, per phone.
      const newest = (rows, ph) => Math.max(0, ...(rows || []).filter((r) => guard.toE164(metaOf(r).phone) === ph).map(tsOf));
      const phones = [...new Set((outs || []).map((r) => guard.toE164(metaOf(r).phone)).filter(Boolean))];
      const currentlyOut = phones.filter((ph) => newest(outs, ph) > newest(ins, ph));
      const day = (rows) => (rows || []).filter((r) => tsOf(r) >= now - 86400000).length;
      return ok({
        ok: true,
        enforce_mode: guard.ENFORCE, quiet_window_ct: `${guard.QUIET_START}:00–${guard.QUIET_END}:00`,
        caps: { per_24h: guard.CAP_24H, per_7d: guard.CAP_7D, global_10min: guard.GLOBAL_10MIN },
        opted_out_count: currentlyOut.length,
        opted_out_sample: currentlyOut.slice(0, 20).map(mask),
        blocked_24h: day(blocked), would_block_24h: day(would),
        recent_would_block: (would || []).slice(0, 10).map((r) => ({ phone: mask(metaOf(r).phone), reason: metaOf(r).reason, kind: metaOf(r).kind })),
      });
    } catch (e) { return ok({ ok: false, error: String(e.message || e) }); }
  }

  // ── POST: send a guarded customer text ──
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const phone = body.phone || body.to;
  const message = body.message || body.body;
  if (!phone || !message) return ok({ ok: false, sent: false, reason: 'missing phone or message' });
  const res = await guard.guardedSend({ phone, message, tag: body.tag, kind: body.kind, allowQuiet: !!body.allowQuiet });
  return ok({ ok: true, ...res });
};
