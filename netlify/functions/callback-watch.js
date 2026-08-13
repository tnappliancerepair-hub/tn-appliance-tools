// callback-watch — Danielle stepped back from the phones (Teddy, 2026-06-23),
// so inbound callbacks pile up unworked and risk turning into bad reviews.
// This scheduled function watches the OPEN callback queue and SMSes Teddy a
// short digest — new callbacks alert immediately, persistent ones re-nudge
// every ~2h. At-risk callers (repeat callers, "tech came out but...", asked
// for a live rep, complaints) are flagged at the top so they get called first.
//
// Runs every 30 min; a CT-hour guard limits it to 8am-8pm. Dedups on the
// open-set signature so it can't spam (the call-spam lesson).
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const { sendSms } = require('./_lib/sms');
const { officeTaskAlert } = require('./_lib/office-alert');
const OWNER = '+16154855795';
const RENUDGE_MS = 2 * 3600 * 1000; // re-nudge persistent unworked every 2h

function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
function ctHour() { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10); }

// At-risk = likely to become a bad review if not called back fast.
const RISK = /tech came out|still (broken|not|won)|not fix|not work|again|second (time|visit)|2nd|complaint|unhappy|frustrat|manager|refund|wrong|angry|upset|live (rep|person|agent)|speak (to|with) (someone|a)|transfer|representative|escalat/i;

exports.handler = async function () {
  const h = ctHour();
  if (!(Number.isFinite(h) && h >= 8 && h < 20)) return { statusCode: 200, body: 'outside hours' };

  let open = [];
  try {
    const r = await fetch(`${XANO}/list_callback_requests?days=2`);
    const d = await r.json();
    open = ((d && d.callbacks) || []).filter((c) => !c.handled);
  } catch (e) { return { statusCode: 200, body: 'fetch failed: ' + (e.message || e) }; }

  if (!open.length) return { statusCode: 200, body: 'no open callbacks' };

  // Repeat callers (same phone 2+ times) = frustration signal.
  const phoneCounts = {};
  open.forEach((c) => { const p = String(c.phone || '').replace(/\D/g, '').slice(-10); if (p) phoneCounts[p] = (phoneCounts[p] || 0) + 1; });

  const scored = open.map((c) => {
    const p = String(c.phone || '').replace(/\D/g, '').slice(-10);
    const repeat = p && phoneCounts[p] >= 2;
    const risky = RISK.test(c.summary || '') || RISK.test(c.caller_type || '');
    return { c, atRisk: !!(repeat || risky), repeat };
  });
  scored.sort((a, b) => (b.atRisk ? 1 : 0) - (a.atRisk ? 1 : 0) || (a.c.created_at || 0) - (b.c.created_at || 0));

  // Signature for dedup (which IDs are open) + last-alert lookup.
  const sig = scored.map((s) => s.c.id).sort((a, b) => a - b).join(',');
  const hh = hdr();
  let lastSig = '', lastMs = 0;
  if (hh) {
    try {
      const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, {
        method: 'POST', headers: hh,
        body: JSON.stringify({ search: { action: 'callback_watch_alert' }, sort: { id: 'desc' }, per_page: 1, page: 1 }),
      });
      const j = await r.json().catch(() => ({}));
      const row = (j.items || [])[0];
      let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      lastSig = (m && m.sig) || ''; lastMs = (m && m.at_ms) || 0;
    } catch (_) {}
  }

  const changed = sig !== lastSig;
  const stale = Date.now() - lastMs > RENUDGE_MS;
  if (!changed && !stale) return { statusCode: 200, body: 'no change, recently alerted' };

  // Build the digest.
  const riskCount = scored.filter((s) => s.atRisk).length;
  const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : (p || ''); };
  const lines = scored.slice(0, 8).map((s) => {
    const flag = s.atRisk ? '⚠️ ' : '';
    const who = (s.c.name || 'caller').slice(0, 22);
    const why = String(s.c.summary || s.c.caller_type || '').replace(/\s+/g, ' ').slice(0, 50);
    return `${flag}${who} ${fmtPhone(s.c.phone)}${s.repeat ? ' (called back several times)' : ''} - ${why}`;
  });
  const body =
    `[ant] ${open.length} callback${open.length === 1 ? '' : 's'} waiting, no one working them` +
    (riskCount ? ` (${riskCount} AT-RISK ⚠️)` : '') + `:\n\n` +
    lines.join('\n') +
    `\n\nCall these before they become bad reviews -> tnapplianceexchange.net/callbacks.html`;

  try { await officeTaskAlert(body, 'callback_watch'); } catch (_) {}   // → Danielle+Sofia, biz hours

  if (hh) {
    try {
      await fetch(`${META}/table/${EVENT_LOG}/content`, {
        method: 'POST', headers: hh,
        body: JSON.stringify({ action: 'callback_watch_alert', metadata: { sig, open: open.length, at_risk: riskCount, at_ms: Date.now() } }),
      });
    } catch (_) {}
  }

  return { statusCode: 200, body: `alerted: ${open.length} open, ${riskCount} at-risk` };
};
