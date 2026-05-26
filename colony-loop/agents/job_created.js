import { config } from '../config.js';
import { isQuietHourCT, next8amCTMs, fmtCT } from '../time.js';
import { normalizeE164, toOwner, toTech } from '../sms.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator',
  fridge: 'refrigerator',
  washer: 'washer',
  dryer: 'dryer',
  dishwasher: 'dishwasher',
  range: 'range',
  oven: 'oven',
  stove: 'stove',
  microwave: 'microwave',
};

const CASH_SOURCES = new Set(['cash_tdr', 'self_pay', 'cash', 'customer_pay', 'cash_customer']);
const CASH_CUSTOMER_TYPES = new Set(['self_pay', 'cash']);

function shouldIncludeWarrantyNote({ source, customer_type }) {
  const ct = String(customer_type || '').toLowerCase();
  if (CASH_CUSTOMER_TYPES.has(ct)) return false;
  const s = String(source || '').toLowerCase();
  return !CASH_SOURCES.has(s);
}

function composeGreeting({ first_name, appliance_type, source, customer_type, job_id }) {
  const name = (first_name || '').trim() || 'there';
  const applianceRaw = (appliance_type || '').trim().toLowerCase();
  const appliance = APPLIANCE_NICE[applianceRaw] || applianceRaw;
  const applianceClause = appliance ? `your ${appliance} repair` : 'your repair';
  const baseLink = config.publicSiteBase.replace(/^https?:\/\//, '');
  const isWebChat = String(source || '').toLowerCase() === 'web_chat';
  const link = isWebChat || !job_id
    ? baseLink
    : `${baseLink}/?job_id=${job_id}&mode=resume`;
  let body = `Hi ${name}, this is TN Appliance Exchange! To get ${applianceClause} started please tap here: ${link}`;
  if (shouldIncludeWarrantyNote({ source, customer_type })) {
    body += `\n\nYour repair is covered under your home warranty - no payment needed. Just mention warranty if asked.`;
  }
  return body;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};

  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  if (payload.scheduled_for_ms && Date.now() < Number(payload.scheduled_for_ms)) {
    await xano.emitSignal({
      signal_type: 'JOB_CREATED',
      signal_strength: 70,
      payload,
    });
    return {
      success: true,
      action: 'held_still_quiet',
      job_id: jobId,
      wake_at_ms: payload.scheduled_for_ms,
    };
  }

  const phone = normalizeE164(payload.customer_phone);
  if (!phone) {
    return { success: false, action: 'skipped', reason: 'invalid_phone', job_id: jobId };
  }

  const greetingCheck = await xano.getGreetingSentForJob(jobId);
  if (greetingCheck && greetingCheck.sent) {
    return { success: true, action: 'skipped_duplicate', job_id: jobId, last_sent_at: greetingCheck.last_sent_at };
  }

  if (isQuietHourCT(Date.now(), config.quietStartHourCT, config.quietEndHourCT)) {
    const wakeAt = next8amCTMs();
    await xano.emitSignal({
      signal_type: 'JOB_CREATED',
      signal_strength: 70,
      payload: {
        ...payload,
        held_at: Date.now(),
        scheduled_for_ms: wakeAt,
        held_reason: 'quiet_hours',
      },
    });
    log('greeting_held_quiet_hours', { job_id: jobId, wake_at: fmtCT(wakeAt) });
    return {
      success: true,
      action: 'held_for_quiet_hours',
      job_id: jobId,
      wake_at_ms: wakeAt,
    };
  }

  const body = composeGreeting({
    first_name: payload.customer_first_name,
    appliance_type: payload.appliance_type,
    source: payload.source,
    customer_type: payload.customer_type,
    job_id: jobId,
  });

  const smsRes = await sms.toCustomer(phone, body, {
    action: 'new_job_greeting',
    job_id: jobId,
    source_signal_id: signal.id,
    source: payload.source || 'unknown',
  });

  await xano.markSignalProcessed(signal.id, 'new_job_greeting_sent', {
    job_id: jobId,
    phone,
    source: payload.source,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  });

  // ── Pre-diagnosis-request SMS to Teddy + (optional) assigned tech ──
  // Goal: parts ordered before the first visit, eliminating -2/-3/-4/-5
  // repeat-visit cycles. Dedup on a 48h window per get_prediag_sent_for_job.
  try {
    const dedup = await xano.getPrediagSentForJob(jobId);
    if (dedup && dedup.sent) {
      // Already requested in the last 48h — skip silently.
    } else {
      const custFirst = (payload.customer_first_name || '').trim() || 'Customer';
      const brand = (payload.brand || '').trim();
      const appliance = (payload.appliance_type || '').trim() || 'appliance';
      const problem = (payload.problem_summary || '').trim() || 'no complaint on file';
      const brandAppl = brand ? `${brand} ${appliance}` : appliance;
      const link = `${config.publicSiteBase.replace(/^https?:\/\//, '')}/teddy-tdr-tool.html?job_id=${jobId}`;
      const prediagBody =
        `[ant] new job #${jobId} needs pre-diagnosis: ${custFirst} - ${brandAppl} - ${problem}. Diagnose now so parts can be ordered: ${link}`;

      // Dashboard footer for the assigned tech: gives them one-tap access
      // to their full day-view from any pre-diag SMS. Owner SMS keeps the
      // prediag link only (owner uses dashboard.html, not the tech view).
      const baseSite = config.publicSiteBase.replace(/^https?:\/\//, '');

      let teddyRes;
      try {
        teddyRes = await toOwner(prediagBody, {
          action: 'prediag_request_sent',
          job_id: jobId,
          recipient_role: 'owner',
          source_signal_id: signal.id,
        });
      } catch (err) {
        teddyRes = { success: false, error: String(err.message || err) };
      }

      let techRes = null;
      const assignedTechId = Number(payload.technician_id || 0);
      const assignedTechPhone = normalizeE164(payload.technician_phone);
      if (assignedTechId > 0 && assignedTechId !== 1 && assignedTechPhone) {
        const techPrediagBody = `${prediagBody}\n\nYour dashboard: ${baseSite}/tech-daily-dashboard.html?tech_id=${assignedTechId}`;
        try {
          techRes = await toTech(assignedTechPhone, techPrediagBody, {
            action: 'prediag_request_sent',
            job_id: jobId,
            technician_id: assignedTechId,
            recipient_role: 'tech',
            source_signal_id: signal.id,
          });
        } catch (err) {
          techRes = { success: false, error: String(err.message || err) };
        }
      }

      // Persist the prediag-request audit to event_log so the dedup query
      // in get_prediag_sent_for_job can find it. send_sms's own event_log
      // row uses action="sms_sent" without metadata.job_id, so we write
      // our own structured row.
      try {
        await xano.recordEventLog('prediag_request_sent', {
          job_id: jobId,
          tech_id: assignedTechId || null,
          teddy_sms_ok: teddyRes && teddyRes.success ? true : false,
          tech_sms_ok: techRes && techRes.success ? true : (techRes === null ? null : false),
          source_signal_id: signal.id,
        });
      } catch (err) {
        // Best effort — if the event_log write fails, the dedup will allow
        // a retry on the next JOB_CREATED for this job (acceptable noise).
      }

      log('prediag_request_sent', {
        job_id: jobId,
        teddy_sms_ok: teddyRes && teddyRes.success ? true : false,
        tech_id: assignedTechId || null,
        tech_sms_ok: techRes && techRes.success ? true : (techRes === null ? null : false),
      });
    }
  } catch (err) {
    log('prediag_request_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: REPEAT_VISIT_CHECK ──
  // Hand off to repeat_visit_check.js which queries prior jobs for the
  // same customer + appliance_type within 12 months and alerts Teddy if
  // ≥2 prior visits exist. Independent of the prediag chain so failures
  // don't compound.
  try {
    const customerId = Number(payload.customer_id || 0);
    const applianceType = String(payload.appliance_type || '').trim();
    if (customerId > 0 && applianceType) {
      await xano.emitSignal({
        signal_type: 'REPEAT_VISIT_CHECK',
        signal_strength: 55,
        payload: {
          job_id: jobId,
          customer_id: customerId,
          appliance_type: applianceType,
          customer_first_name: payload.customer_first_name || '',
          customer_last_name: payload.customer_last_name || '',
          source: 'job_created_chain',
          source_signal_id: signal.id,
        },
      });
    }
  } catch (err) {
    log('repeat_visit_check_chain_failed', { job_id: jobId, error: String(err.message || err) });
  }

  return {
    success: true,
    action: 'greeting_sent',
    job_id: jobId,
    phone,
  };
}
