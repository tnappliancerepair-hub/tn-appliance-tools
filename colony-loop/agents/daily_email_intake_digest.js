// Signal in: DAILY_EMAIL_INTAKE_DIGEST
// Fires daily at 6pm CT (tick.js 6-9pm grace window). Pulls the 24h
// email intake summary and SMSes Teddy a one-liner. Catches stuck
// pollers / OAuth expiry / Gmail filter regressions same-day instead
// of in the next morning's silence.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(INTAKE('/get_email_intake_summary?hours_back=24'));
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'daily_email_intake_handled', meta);
    log('daily_email_intake_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  if (!summary || !summary.success) {
    const meta = { outcome: 'summary_unsuccessful', payload: summary };
    await xano.markSignalProcessed(signal.id, 'daily_email_intake_handled', meta);
    return { success: false, action: 'summary_unsuccessful' };
  }

  const src = summary.jobs_by_source || {};
  const ahs = Number(src.ahs_email || 0);
  const sp  = Number(src.servicepower_email || 0);
  const alls = Number(src.allstate_email || 0);
  const webChat = Number(src.web_chat || 0);
  const emailTotal = Number(summary.email_only_total || 0);
  const watcher = Number(summary.watcher_total || 0);
  const partsGmail = Number(summary.parts_orders_from_gmail || 0);

  // Alert if email volume seems unusually low. Threshold of 2 emails
  // total in 24h business window is suspicious — likely poller issue.
  const isSuspiciouslyQuiet = emailTotal < 2;
  const tag = isSuspiciouslyQuiet ? '⚠️ quiet day' : 'daily';

  const body =
    `[ant] ${tag} email intake (24h): ` +
    `AHS:${ahs} · SP:${sp}` +
    (alls > 0 ? ` · Allstate:${alls}` : '') +
    (webChat > 0 ? ` · WebChat:${webChat}` : '') +
    `. ` +
    `Parts deliveries: ${partsGmail}. ` +
    `Warranty watcher: ${watcher} (DRY-RUN). ` +
    (isSuspiciouslyQuiet
      ? `Low email volume — check pollers + Gmail labels.`
      : `Pollers healthy.`) +
    ` Details: tnapplianceexchange.net/email-intake-status.html`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'daily_email_intake_summary',
        ahs_count: ahs,
        sp_count: sp,
        parts_gmail_count: partsGmail,
        watcher_count: watcher,
        suspiciously_quiet: isSuspiciouslyQuiet,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    ahs_count: ahs,
    sp_count: sp,
    email_total: emailTotal,
    parts_gmail_count: partsGmail,
    watcher_count: watcher,
    suspiciously_quiet: isSuspiciouslyQuiet,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'daily_email_intake_handled', meta);
  log('daily_email_intake_handled', meta);
  return { success: true, action: 'daily_email_intake_handled', email_total: emailTotal };
}
