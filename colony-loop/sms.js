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
  const action = context.action || context.outcome || '';
  if (!context.force_send && isQuietedForOwner(action)) {
    // Log it so the dashboard can surface what was suppressed.
    try {
      await xano.recordEventLog('owner_sms_quieted', {
        action,
        body_preview: String(body || '').slice(0, 240),
        recipient_role: 'owner',
      });
    } catch (_) {}
    return { success: false, quieted: true, action };
  }
  return xano.sendSms(config.ownerPhone, body, {
    ...context, recipient_role: 'owner', company_id: config.companyId,
  });
}

export async function toDanielle(body, context = {}) {
  return xano.sendSms(config.daniellePhone, body, {
    ...context, recipient_role: 'warranty_handler', company_id: config.companyId,
  });
}

export async function toCustomer(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  return xano.sendSms(e164, body, {
    ...context, recipient_role: 'customer', company_id: config.companyId,
  });
}

// 2026-06-02: per Teddy — "the guys have been complaining about it too,
// if it's too much they just ignore them." Volume-driven signal collapse
// is worse than not sending anything. So texts to techs become INTERRUPT
// channel only (customer messaging them, urgent gap-filler offers, new
// work assigned, job canceled). Daily/digest/reminder/status content
// belongs in tech-daily-dashboard.html where they pull it on their cadence,
// not push that interrupts their job.
const TECH_SMS_QUIET_PATTERNS = [
  'daily_tech_briefing',
  'tdr_reminder',
  'waiver_due',                // customer-side action, not tech
  'pre_appointment_check',     // moved to dashboard pill
  'appointment_reminder_due',  // already on dashboard
  'google_review_request',     // customer-only
  'parts_arrival_check',       // dashboard
  'tech_late_check',
  'tech_pace_watcher',         // observation, not interrupt
  'capacity_check',
  'schedule_gap_check',
  'tdr_completeness_report',
  'office_eod',
  'office_morning_briefing',
  'colony_architect',
  'operator_status',
];

function isQuietedForTech(action) {
  if (!action) return false;
  const a = String(action).toLowerCase();
  return TECH_SMS_QUIET_PATTERNS.some((p) => a.includes(p));
}

export async function toTech(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  const action = context.action || context.outcome || '';
  const isOwnerAsTech = (e164 === config.ownerPhone) || (Number(context.tech_id) === 1);

  // Owner-as-tech inherits the broader owner denylist (everything in
  // OWNER_SMS_QUIET_PATTERNS plus the tech-specific list below).
  if (!context.force_send && isOwnerAsTech && isQuietedForOwner(action)) {
    try {
      await xano.recordEventLog('owner_sms_quieted', {
        action,
        body_preview: String(body || '').slice(0, 240),
        recipient_role: 'tech_owner',
      });
    } catch (_) {}
    return { success: false, quieted: true, action };
  }

  // Everyone else: tech-specific denylist (digests + reminders go to
  // dashboard, not phone).
  if (!context.force_send && isQuietedForTech(action)) {
    try {
      await xano.recordEventLog('tech_sms_quieted', {
        action,
        body_preview: String(body || '').slice(0, 240),
        tech_id: context.tech_id || null,
      });
    } catch (_) {}
    return { success: false, quieted: true, action };
  }
  return xano.sendSms(e164, body, {
    ...context, recipient_role: 'tech', company_id: config.companyId,
  });
}
