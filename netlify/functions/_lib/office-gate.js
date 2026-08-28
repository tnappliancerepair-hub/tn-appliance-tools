// office-gate — Teddy 2026-08-28 (final): "No more texting Danielle, Sofia or Carrie.
// Only text me cash job intake and intake for warranty jobs. Eliminate the others."
//
// ONE rule, consulted by every internal send path so no office text can leak:
//   • Danielle / Sofia / Carrie  → NOTHING, ever.
//   • Teddy                      → ONLY a cash-job-intake OR warranty-job-intake alert.
//   • everything else to the office (new-job sirens, callbacks, schedule requests,
//     parts flags, briefings, drafts, review replies, system-health pings…) → dropped.
// The board/queues still carry it all — this only silences the phone.
//
// Reversible: OFFICE_SMS_KILL=0 restores the old behavior (nothing suppressed).
'use strict';

const OFFICE = new Set(['6154850713', '6292594602', '2258035669', '6154855795']); // Danielle, Sofia, Carrie, Teddy
const TEDDY = '6154855795';

// The ONLY two things Teddy still wants texted — both to him only.
const CASH_INTAKE_TAGS = new Set(['quick_check', 'quick_check_lead', 'ann_new_job', 'cash_intake', 'cash_lead', 'self_pay_lead']);
const WARRANTY_INTAKE_TAGS = new Set(['warranty_quick_check', 'warranty_intake', 'warranty_new_job', 'warranty_lead']);
const ALLOWED_TO_TEDDY = new Set([...CASH_INTAKE_TAGS, ...WARRANTY_INTAKE_TAGS]);

// Kept defined (not allowlisted) so morning-us can one-line-restore system-health pings
// to Teddy if he wants them back — he explicitly said "eliminate the others" tonight.
const HEALTH_TAGS = new Set(['gmail_token_alert', 'job_safety', 'overtext_alert', 'colony_watchdog', 'loop_down', 'system_health']);

const KILL = String(process.env.OFFICE_SMS_KILL || '1') !== '0';

function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

// true = this send should be suppressed.
function officeBlocked(to, tag) {
  if (!KILL) return false;
  const d = last10(to);
  if (!OFFICE.has(d)) return false;                    // not an office number — never our concern
  if (d === TEDDY && ALLOWED_TO_TEDDY.has(String(tag || ''))) return false; // Teddy + cash/warranty intake
  return true;                                         // everyone else, and every other tag: suppressed
}

module.exports = { officeBlocked, last10, OFFICE, CASH_INTAKE_TAGS, WARRANTY_INTAKE_TAGS, HEALTH_TAGS };
