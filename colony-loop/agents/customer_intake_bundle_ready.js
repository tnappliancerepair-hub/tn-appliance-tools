// Signal in: CUSTOMER_INTAKE_BUNDLE_READY
// Fires when a customer attachment lands (save_attachment_POST emits).
// Sends Teddy + tech an SMS with the Teddy Tool link the moment the
// customer has given us intake material (video / photo / description).
//
// Recipients (per Teddy 2026-06-01):
//   - Teddy always
//   - Assigned tech if one is on the job
//   - If no assigned tech BUT exactly one active tech in the zip's
//     cluster, that tech (they're implicitly the one going)
//
// Dedup: per-job-per-24h via get_customer_intake_bundle_handled.

import { config } from '../config.js';
import { normalizeE164 } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || 'tnapplianceexchange.net').replace(/^https?:\/\//, '');
}

function custName(c) {
  if (!c) return '(no customer)';
  const f = (c.first_name || '').trim();
  const l = (c.last_name || '').trim();
  return [f, l].filter(Boolean).join(' ') || '(no customer name)';
}

function applianceLabel(job) {
  const t = (job.appliance_type || '').trim();
  const b = (job.brand || '').trim();
  return [b, t].filter(Boolean).join(' ').toLowerCase() || 'appliance';
}

function shortProblem(job) {
  const p = (job.problem_summary || '').trim();
  if (!p) return '(no description)';
  return p.length > 120 ? p.slice(0, 117) + '...' : p;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  // dispatch.js parses the raw JSON payload and replaces signal.payload
  // with the parsed object before calling run(). Some older agents read
  // signal.payload_obj — that's a no-op here; the parsed shape lives on
  // signal.payload.
  const payload = (signal && typeof signal.payload === 'object' && signal.payload) || {};
  const jobId = Number(payload.job_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'customer_intake_bundle_handled', { outcome: 'skipped_missing_job_id' });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const dedup = await xano.getCustomerIntakeBundleHandled(jobId).catch(() => ({ handled: false }));
  if (dedup && dedup.handled) {
    const meta = { job_id: jobId, outcome: 'skipped_already_handled', last_handled_at: dedup.last_handled_at };
    await xano.markSignalProcessed(signal.id, 'customer_intake_bundle_handled', meta);
    log('customer_intake_bundle_skipped_dedup', meta);
    return { success: true, action: 'skipped_already_handled' };
  }

  const ctxBundle = await xano.getCustomerIntakeBundleContext(jobId).catch((e) => ({ error: String(e) }));
  if (!ctxBundle || ctxBundle.error || !ctxBundle.job) {
    const meta = { job_id: jobId, outcome: 'context_fetch_failed', error: ctxBundle?.error || 'no_job' };
    await xano.markSignalProcessed(signal.id, 'customer_intake_bundle_handled', meta);
    log('customer_intake_bundle_context_failed', meta);
    return { success: false, action: 'context_fetch_failed' };
  }

  const job = ctxBundle.job || {};
  const customer = ctxBundle.customer || null;
  const assignedTech = ctxBundle.assigned_tech || null;
  const clusterTechs = ctxBundle.cluster_techs || [];
  const attachmentCount = Number(ctxBundle.attachment_count || 0);

  const tdrToolUrl = `https://${bareDomain()}/teddy-tdr-tool.html?job_id=${jobId}`;
  const cn = custName(customer);
  const appl = applianceLabel(job);
  const desc = shortProblem(job);
  const mediaTag = attachmentCount > 0 ? ` ${attachmentCount}x media.` : '';

  // To Teddy: always.
  const teddyBody =
    `[ant] new intake from ${cn} - ${appl}.${mediaTag} ${desc} ` +
    `Pre-diagnose: ${tdrToolUrl}`;

  let teddyResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(teddyBody, {
        action: 'customer_intake_bundle_owner_sms',
        job_id: jobId,
        signal_id: signal.id,
      });
      teddyResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      teddyResult = String(e.message || e);
    }
  }

  // Tech routing
  let techTarget = null;
  let techReason = '';
  if (assignedTech && assignedTech.id && assignedTech.id !== 1) {
    techTarget = assignedTech;
    techReason = 'assigned';
  } else if (!assignedTech || !assignedTech.id) {
    // No assignment yet — is there exactly one tech in the cluster?
    const eligible = clusterTechs.filter((t) => t.id !== 1 && (t.phone || '').trim());
    if (eligible.length === 1) {
      techTarget = eligible[0];
      techReason = 'sole_cluster_tech';
    } else {
      techReason = eligible.length === 0 ? 'no_cluster_techs' : 'multiple_cluster_techs';
    }
  } else {
    techReason = 'assigned_is_owner';
  }

  let techResult = `skipped_${techReason}`;
  if (techTarget && (techTarget.phone || '').trim()) {
    const techPhone = normalizeE164(techTarget.phone);
    const techFirst = (techTarget.first_name || 'tech').trim();
    const techBody =
      `[ant] ${techFirst} - new intake for job #${jobId}, ${cn}, ${appl}.${mediaTag} ` +
      `${desc} Full intake + Teddy's pre-diag: ${tdrToolUrl}`;
    try {
      const r = await sms.toTech(techPhone, techBody, {
        action: 'customer_intake_bundle_tech_sms',
        job_id: jobId,
        technician_id: techTarget.id,
        reason: techReason,
        signal_id: signal.id,
      });
      techResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      techResult = String(e.message || e);
    }
  }

  const meta = {
    job_id: jobId,
    outcome: 'sent',
    owner_sms: teddyResult,
    tech_sms: techResult,
    tech_routing: techReason,
    tech_id_notified: techTarget?.id || 0,
    attachment_count: attachmentCount,
    cluster_id: ctxBundle.cluster_id || '',
    cluster_tech_count: clusterTechs.length,
  };

  await xano.markSignalProcessed(signal.id, 'customer_intake_bundle_handled', meta);
  log('customer_intake_bundle_handled', meta);
  return { success: true, action: 'customer_intake_bundle_handled', job_id: jobId };
}
