import { config } from './config.js';
import * as xano from './xano.js';

export function normalizeE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (String(phone).startsWith('+')) return String(phone);
  return null;
}

// ── Global outbound-SMS circuit breaker ──────────────────────────────────────
// 2026-06-16, per Teddy: "we should never send 15k texts." A stale-signal
// backlog (or any runaway emitter) must NEVER be able to blast thousands of
// texts. EVERY send routes through dispatchSms(), which tracks sends in a
// rolling window; once they exceed the cap it HALTS all outbound texts and
// alerts Teddy once (the alert bypasses the breaker so it still gets out).
// Tunable via env: SMS_BREAKER_MAX (default 50), SMS_BREAKER_WINDOW_MIN (10).
const SMS_BREAKER_MAX = Number(process.env.SMS_BREAKER_MAX || 50);
const SMS_BREAKER_WINDOW_MS = Number(process.env.SMS_BREAKER_WINDOW_MIN || 10) * 60 * 1000;
let _sendTimes = [];
let _breakerAlertedAt = 0;

function breakerAllows() {
  const now = Date.now();
  _sendTimes = _sendTimes.filter((t) => now - t < SMS_BREAKER_WINDOW_MS);
  return _sendTimes.length < SMS_BREAKER_MAX;
}

async function dispatchSms(phone, body, context = {}) {
  if (!breakerAllows()) {
    const now = Date.now();
    // Alert Teddy at most once / 30 min, bypassing the breaker so it gets out.
    if (now - _breakerAlertedAt > 30 * 60 * 1000) {
      _breakerAlertedAt = now;
      try {
        await xano.sendSms(
          config.ownerPhone,
          '[ant] 🚨 SMS circuit breaker TRIPPED — over ' + SMS_BREAKER_MAX + ' texts in ' +
            Math.round(SMS_BREAKER_WINDOW_MS / 60000) + 'min. Halting all outbound texts. ' +
            'Something is over-emitting — check the loop.',
          { recipient_role: 'owner', action: 'sms_breaker_alert', company_id: config.companyId }
        );
      } catch (_) {}
    }
    // Local-only (NOT Xano): a tripped breaker means we're already under load;
    // writing the block to Xano event_log is the exact write-flood we're avoiding.
    xano.logLocal('sms_breaker_blocked', {
      to: phone,
      action: (context && (context.action || context.outcome)) || '',
      body_preview: String(body || '').slice(0, 120),
    });
    return { success: false, breaker_tripped: true };
  }
  _sendTimes.push(Date.now());
  return xano.sendSms(phone, body, context);
}

// All sms helpers now pass company_id in context so the Xano send_sms
// endpoint can route to the per-tenant Telnyx FROM number (once the
// endpoint is refactored to read company.telnyx_from_customer /
// telnyx_from_tech instead of env vars).

// 2026-06-02: owner-SMS volume cap. Teddy got 1421 messages in one day
// from the broken operator_status_briefing storm + the long tail of
// daily/weekly/EOD/health digests. Per his ask: keep Teddy-Tool
// heads-ups (new job prediag, intake bundle, tech assigned, job
// started/completed, low-rating, inbound call, urgent escalation),
// silence everything else. Quieted SMSes write to event_log so they
// can still be reviewed on a dashboard.
//
// Denylist by substring on context.action. Caller can override with
// context.force_send=true for genuine emergencies.
const OWNER_SMS_QUIET_PATTERNS = [
  'operator_status',       // the 1421-storm offender
  'daily_briefing',
  'daily_revenue',
  'weekly_performance',
  'daily_claude_spend',
  'daily_job_prep',
  'daily_tech_briefing',
  'capacity_check',
  'schedule_gap',
  'tech_late_check',
  'tdr_completeness_report',
  'office_eod',
  'office_morning_briefing',
  'daily_hcp_coverage',
  'email_intake_summary',
  'unpaid_self_pay',
  'resume_nudge',
  'parts_arrival_check',   // the digest, not per-job follow-up
  'tdr_reminder',
  'colony_architect',      // build summaries
  'industry_intel',
  'zone_profitability',
  'tech_comparison',
  'tech_burnout_signal',
  'truck_inventory_reconciler',
  'parts_cost_optimizer',
  'no_show_check',         // moves to dashboard
  'colony_loop_self_watch',
  'parallel_intake_watch',
  'xano_api_watch',
  'marketing_site_watch',
];

function isQuietedForOwner(action) {
  if (!action) return false;
  const a = String(action).toLowerCase();
  return OWNER_SMS_QUIET_PATTERNS.some((p) => a.includes(p));
}

export async function toOwner(body, context = {}) {
  const action = context.action || context.outcome || context.call_site || '';
  // 2026-06-19 — Per Teddy: owner SMS is CANCELED. Reports/notifications are
  // SAVED to the owner portal (event_log 'owner_report') instead of texting his
  // phone. Only force_send (genuine emergencies, e.g. the SMS breaker alert)
  // still texts. Customer-reply forwards are a SEPARATE path (the inbound
  // webhook) and are unaffected — Teddy still sees those.
  if (!context.force_send) {
    try {
      await xano.recordEventLog('owner_report', {
        source: action || 'owner',
        body: String(body || '').slice(0, 4000),
        recipient_role: 'owner',
        at_ms: Date.now(),
      });
    } catch (_) {
      xano.logLocal('owner_report_save_failed', { action, body_preview: String(body || '').slice(0, 200) });
    }
    // Owner gets it as a free desktop/web-push notification (shares the office channel).
    await fireWebPush('office', 0, body);
    return { success: false, canceled: true, saved_to_portal: true, action };
  }
  return dispatchSms(config.ownerPhone, body, {
    ...context, recipient_role: 'owner', company_id: config.companyId,
  });
}

export async function toDanielle(body, context = {}) {
  // Web push to the office (Danielle/owner desktop) alongside the SMS.
  await fireWebPush('office', 0, body);
  return dispatchSms(config.daniellePhone, body, {
    ...context, recipient_role: 'warranty_handler', company_id: config.companyId,
  });
}

export async function toCustomer(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  // FORWARD-ONLY for the NEW-JOB OUTREACH only (greeting/availability/pre-diag).
  // The backlog never gets those. Reminders + confirmations are exempt — they
  // flow for everyone (Teddy: "reminders are fine"). The job_created agent also
  // guards this, so this is belt-and-suspenders for the outreach path only.
  const OUTREACH_ACTIONS = ['new_job_greeting', 'availability_nudge', 'availability_request', 'resume_nudge'];
  const _act = String((context && (context.action || context.outcome)) || '');
  if (config.customerOutreachSinceMs > 0 && context && context.job_id && OUTREACH_ACTIONS.includes(_act)) {
    try {
      const jd = await xano.getJobForDashboard(Number(context.job_id));
      const c = jd && jd.job && jd.job.created_at;
      const createdMs = (typeof c === 'number') ? c : (Date.parse(c) || Number(c) || 0);
      if (createdMs && createdMs < config.customerOutreachSinceMs) {
        xano.logLocal('customer_outreach_skipped_backlog', { job_id: context.job_id, action: _act });
        return { success: false, skipped_backlog: true, job_id: context.job_id };
      }
    } catch (_) { /* lookup failed → fall through (greeting dedup + job_created guard still protect) */ }
  }
  return dispatchSms(e164, body, {
    ...context, recipient_role: 'customer', company_id: config.companyId,
  });
}

// 2026-06-04: HARDLINE per Teddy after Jimmy reported 30 texts/day
// overwhelming him in the field. Tech SMS is now ALLOW-LIST ONLY,
// not deny-list. Three channels survive:
//   1. daily_tech_briefing  (morning brief — first thing)
//   2. prediag_request_sent (fresh Teddy Tool pre-diag drops)
//   3. tech_eod_report      (end of day report)
// EVERYTHING ELSE is quieted. If something genuinely urgent needs
// to reach a tech, they call them — SMS storm is over.
const TECH_SMS_ALLOW_PATTERNS = [
  'daily_tech_briefing',
  'prediag_request',           // Teddy drops pre-diag → tech needs to see
  'tech_eod_report',           // end-of-day wrap-up
  'ant_field_assist_intro',    // one-time onboarding (rare)
];

function isAllowedForTech(action) {
  if (!action) return false;
  const a = String(action).toLowerCase();
  return TECH_SMS_ALLOW_PATTERNS.some((p) => a.includes(p));
}

function isQuietedForTech(action) {
  // Inverse of allow — if not in allow list, it's quieted.
  return !isAllowedForTech(action);
}

// 2026-06-16 per Teddy: HARD weekend mute. Zero automated texts to the field
// techs on Saturday or Sunday (America/Chicago) — they don't want weekend
// pestering. Overrides even the allow-list. Owner-as-tech (Teddy, tech_id 1)
// is exempt; this is about the field techs, not the owner's own heads-ups.
// Suppressed texts still write to event_log so nothing is lost.
function isWeekendCT(d = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short',
  }).format(d);
  return wd === 'Sat' || wd === 'Sun';
}

// Drop a tech notification into the in-app Messages inbox. Best-effort + never
// throws — an inbox hiccup must never block the SMS path. Needs a tech_id in
// context (most agents pass it); skips owner-as-tech (he has the cockpit).
async function mirrorToInbox(context, body) {
  if (!config.techInboxEnabled) return;
  const techId = Number(context && context.tech_id) || 0;
  if (!techId || techId === 1) return;
  try {
    await xano.postTechInbox(techId, body, { senderName: 'Ant 🐜', jobId: Number(context && context.job_id) || 0 });
  } catch (e) {
    xano.logLocal('tech_inbox_mirror_failed', { tech_id: techId, err: String(e.message || e) });
  }
  // Native app push (FCM/APNs) — gated until the native app + keys exist.
  if (config.pushEnabled) {
    try {
      await fetch(`${config.netlifyFunctionsBase}/send-push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech_id: techId, title: 'Ant 🐜', body: String(body || '').slice(0, 280) }),
      });
    } catch (e) {
      xano.logLocal('tech_push_failed', { tech_id: techId, err: String(e.message || e) });
    }
  }
  // Web push — the no-app path that works on Android/desktop/iOS-PWA today.
  await fireWebPush('tech', techId, body);
}

// Web push to a subscribed device (best-effort; no-ops if no subscription/keys).
// Works across Android, desktop, and iOS home-screen PWAs — the universal path.
export async function fireWebPush(role, uid, body) {
  try {
    await fetch(`${config.netlifyFunctionsBase}/web-push-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, uid: Number(uid) || 0, title: 'Ant 🐜', body: String(body || '').slice(0, 280) }),
    });
  } catch (e) {
    xano.logLocal('web_push_failed', { role, uid, err: String(e.message || e) });
  }
}

export async function toTech(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  const action = context.action || context.outcome || '';
  const isOwnerAsTech = (e164 === config.ownerPhone) || (Number(context.tech_id) === 1);

  // Weekend hard-mute (field techs only). No force_send escape — Teddy asked
  // for ALL texts silenced Sat/Sun. BUT it still lands in the in-app inbox, so
  // the tech sees it without a weekend text (previously it just vanished).
  if (isWeekendCT() && !isOwnerAsTech) {
    await mirrorToInbox(context, body);
    xano.logLocal('tech_sms_quieted_weekend', {
      action,
      body_preview: String(body || '').slice(0, 240),
      tech_id: context.tech_id || null,
    });
    return { success: false, quieted: true, weekend: true, action, in_app: true };
  }

  // Owner-as-tech inherits the broader owner denylist (everything in
  // OWNER_SMS_QUIET_PATTERNS plus the tech-specific list below).
  if (!context.force_send && isOwnerAsTech && isQuietedForOwner(action)) {
    xano.logLocal('owner_sms_quieted', {
      action,
      body_preview: String(body || '').slice(0, 240),
      recipient_role: 'tech_owner',
    });
    return { success: false, quieted: true, action };
  }

  // Everyone else: tech-specific denylist (digests + reminders). These now go to
  // the in-app inbox instead of vanishing — the tech sees them, no text.
  if (!context.force_send && isQuietedForTech(action)) {
    await mirrorToInbox(context, body);
    xano.logLocal('tech_sms_quieted', {
      action,
      body_preview: String(body || '').slice(0, 240),
      tech_id: context.tech_id || null,
    });
    return { success: false, quieted: true, action, in_app: true };
  }
  // Sent by SMS AND mirrored into the in-app inbox (so the app has everything;
  // when techs live in the app, flip TECH_INAPP_ONLY-style suppression later).
  await mirrorToInbox(context, body);
  return dispatchSms(e164, body, {
    ...context, recipient_role: 'tech', company_id: config.companyId,
  });
}
