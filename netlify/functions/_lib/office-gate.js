// office-gate — Teddy 2026-08-28: "Kill all text to the office immediately. Only
// cash intake to me and Danielle." One rule, consulted by every internal send path
// so no office text can leak: a text to an OFFICE cell (Danielle / Sofia / Carrie /
// Teddy) is SUPPRESSED unless it's a cash-intake alert going to Teddy or Danielle.
//
// A tiny SYSTEM-HEALTH allowlist survives to Teddy ONLY (his phone), so killing the
// office noise doesn't blind him to a real failure — "Gmail auth died", "system
// down", "a job's about to be missed", "SMS flood detected". Everything else to the
// office (new-job sirens, callbacks, schedule requests, parts flags, briefings,
// drafts, warranty pings…) is dropped — the board/queues still have it all.
//
// Reversible: OFFICE_SMS_KILL=0 restores the old behavior (nothing suppressed).
'use strict';

const OFFICE = new Set(['6154850713', '6292594602', '2258035669', '6154855795']); // Danielle, Sofia, Carrie, Teddy
const CASH_OK = new Set(['6154855795', '6154850713']);                              // cash intake → Teddy + Danielle
const TEDDY = '6154855795';
// Cash-intake alerts (the ONLY office text Teddy wants). Exact tags — 'warranty_quick_check'
// deliberately excluded (it contains "quick_check" but is warranty, not cash).
const CASH_TAGS = new Set(['quick_check', 'quick_check_lead', 'ann_new_job', 'cash_intake', 'cash_lead', 'self_pay_lead']);
// System-health/safety alerts that still reach Teddy's phone only (kept so a failure isn't silent).
const HEALTH_TAGS = new Set(['gmail_token_alert', 'job_safety', 'overtext_alert', 'colony_watchdog', 'loop_down', 'system_health']);

const KILL = String(process.env.OFFICE_SMS_KILL || '1') !== '0';

function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

// true = this send should be suppressed (an office text that isn't allowed).
function officeBlocked(to, tag) {
  if (!KILL) return false;
  const d = last10(to);
  if (!OFFICE.has(d)) return false;                       // not an office number — never our concern
  const t = String(tag || '');
  if (CASH_TAGS.has(t) && CASH_OK.has(d)) return false;   // cash intake → Teddy/Danielle: allowed
  if (HEALTH_TAGS.has(t) && d === TEDDY) return false;    // system-health → Teddy only: allowed
  return true;                                            // every other office text: suppressed
}

module.exports = { officeBlocked, last10, OFFICE, CASH_TAGS, HEALTH_TAGS };
