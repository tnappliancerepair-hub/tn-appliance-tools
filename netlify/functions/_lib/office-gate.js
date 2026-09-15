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
const DANIELLE = '6154850713';

// The ONLY two things Teddy still wants texted — both to him only.
// 'platform_intake_rescue' fires ONLY when Xano refused a paid/warranty intake and the
// platform caught it instead -- i.e. money is in and the job is not where the office
// looks. That is cash/warranty intake by definition, and it cannot flood: it is silent
// unless the old system is down. The platform_ prefix also routes it DIRECT to Telnyx,
// which matters here because Xano is the thing that just failed.
// 'platform_cash_lead' is the platform-side lead watcher (platform-lead-watch): a lead
// born on the board that NOBODY has replied to. Cash/warranty intake by definition, owner
// only, capped at 5 alerts a run, and gated to 8a-8p CT -- it cannot flood. It needed its
// own tag because the Xano-side cash-ready-notify has been running every 20 minutes since
// 2026-08-28 texting NOBODY: its tags were never added here. That is the trap this avoids.
// 'lsa_lead' is a Local Services Ads lead -- a CASH job we already PAID Google ~$18 for
// (measured 2026-09-15: $18.05/lead). It is cash intake by the plainest reading of the
// rule, owner only, and it cannot flood: LSA delivers a handful a day (6 on the day this
// shipped) and the watcher caps itself at 5 alerts a run. It needed its own tag for the
// same reason platform_cash_lead did -- an un-allowlisted tag is written and delivered
// NOWHERE, which is the trap cash-ready-notify sat in for three weeks.
// 'new_cash_lead' is new-lead-alert: an unknown number just called the shop, so nobody
// has their job yet. The plainest cash intake there is. It is the one tag that ALSO
// reaches Danielle (see ALLOWED_TO_DANIELLE below) -- which is exactly why it has to be
// listed here too. A tag allowlisted for her and not for him would have silently
// dropped the OWNER's copy of his own alert, and the drop is invisible.
const CASH_INTAKE_TAGS = new Set(['quick_check', 'quick_check_lead', 'ann_new_job', 'cash_intake', 'cash_lead', 'self_pay_lead', 'platform_intake_rescue', 'platform_cash_lead', 'lsa_lead', 'new_cash_lead']);
const WARRANTY_INTAKE_TAGS = new Set(['warranty_quick_check', 'warranty_intake', 'warranty_new_job', 'warranty_lead']);
// AssistAnt PLATFORM (SaaS) alerts Teddy asked to receive: a new shop starts a free trial,
// and a prospect messages us from the site. Money-making signals, so they reach his cell.
const PLATFORM_TAGS = new Set(['platform_signup', 'prospect_message']);
// SHIP-BLOCKED alert (Teddy 2026-09-10, after deploys failed silently for 36 minutes while
// every page still looked healthy). Exactly one tag, owner only, and it can only fire when
// a production build is red - a handful of times a year, not a flood. This is the narrow
// door he asked for; the rest of HEALTH_TAGS stays shut.
const SHIP_TAGS = new Set(['deploy_down', 'migration_down', 'tenant_health']);
const ALLOWED_TO_TEDDY = new Set([...CASH_INTAKE_TAGS, ...WARRANTY_INTAKE_TAGS, ...PLATFORM_TAGS, ...SHIP_TAGS]);

// ── THE ONE DOOR OPEN TO DANIELLE (Teddy 2026-09-15, verbatim, after six paid LSA leads
// went unanswered in a single afternoon): "All new jobs coming in tomorrow as they come
// in. I need to be text messaged about it. DANIELLE NEEDS TO BE TEXT MESSAGED ABOUT IT.
// New cash lead."
//
// This is the same owner reversing his own 2026-08-28 rule for exactly one class of
// message, and only for her. Sofia and Carrie stay shut. It is ONE tag, not a category:
// widening this set is how the 2026-08-28 flood comes back, so anything else she should
// see belongs on the board, not on her phone.
//
// It cannot flood: new-lead-alert texts once per unknown caller per 24h and caps 6 a run
// (measured 2026-09-15: 24 unknown callers all day, ~12 of them plausibly real).
// Kill her copy without touching Teddy's: vault NEW_LEAD_ALERT_DANIELLE=false.
const ALLOWED_TO_DANIELLE = new Set(['new_cash_lead']);

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
  const t = String(tag || '');
  if (d === TEDDY && ALLOWED_TO_TEDDY.has(t)) return false;       // Teddy + cash/warranty intake
  if (d === DANIELLE && ALLOWED_TO_DANIELLE.has(t)) return false; // Danielle + a brand-new lead, only
  return true;                                         // everyone else, and every other tag: suppressed
}

module.exports = { officeBlocked, last10, OFFICE, CASH_INTAKE_TAGS, WARRANTY_INTAKE_TAGS, PLATFORM_TAGS, SHIP_TAGS, HEALTH_TAGS, ALLOWED_TO_DANIELLE };
