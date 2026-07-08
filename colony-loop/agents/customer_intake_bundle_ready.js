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

  // 🏁 BEAT TEDDY (Teddy 2026-07-07): when a customer's media lands, the Teddy Tool
  // pre-diagnosis link goes to BOTH Teddy AND the area tech(s) as a REAL text — they
  // race to pre-diagnose it first. Teddy gets every intake (he plays against everyone);
  // each tech gets the ones in their area. The 'teddy-tdr-tool' link is whitelisted
  // through the internal-SMS cutoff, so these are the texts that DO go out.

  // To Teddy: always, as an actual text (bypass toOwner, which routes to the portal).
  const teddyBody =
    `[ant] 🏁 new intake — ${cn}, ${appl}.${mediaTag} ${desc} Beat the techs, pre-diagnose it first: ${tdrToolUrl}`;
  let teddyResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await xano.sendSms(config.ownerPhone, teddyBody, {
        recipient_role: 'owner', action: 'intake_teddy_tool_owner', job_id: jobId, signal_id: signal.id,
      });
      teddyResult = r?.success ? 'ok' : (r?.internal_suppressed ? 'suppressed' : (r?.error || 'failed'));
    } catch (e) {
      teddyResult = String(e.message || e);
    }
  }

  // Area techs: the assigned tech (if any, non-owner) PLUS every active tech whose
  // cluster covers this zip. Each gets the link for customers in their area.
  const techPool = [];
  if (assignedTech && assignedTech.id && assignedTech.id !== 1 && (assignedTech.phone || '').trim()) {
    techPool.push({ ...assignedTech, _reason: 'assigned' });
  }
  for (const t of clusterTechs) {
    if (!t || !t.id || t.id === 1 || !(t.phone || '').trim()) continue;
    if (techPool.some((x) => x.id === t.id)) continue;
    techPool.push({ ...t, _reason: 'area_cluster' });
  }
  const techResults = [];
  for (const t of techPool) {
    const techPhone = normalizeE164(t.phone);
    const techFirst = (t.first_name || 'tech').trim();
    const techBody =
      `[ant] 🏁 ${techFirst} — new intake in your area: ${cn}, ${appl}.${mediaTag} ${desc} ` +
      `Beat Teddy, pre-diagnose it first: ${tdrToolUrl}`;
    try {
      const r = await sms.toTech(techPhone, techBody, {
        action: 'intake_teddy_tool_tech', job_id: jobId, technician_id: t.id, reason: t._reason, signal_id: signal.id,
      });
      techResults.push({ id: t.id, result: r?.success ? 'ok' : (r?.error || 'failed') });
    } catch (e) {
      techResults.push({ id: t.id, result: String(e.message || e) });
    }
  }
  const techResult = techResults.length ? techResults.map((x) => `${x.id}:${x.result}`).join(',') : 'no_area_techs';
  const techReason = techPool.length ? techPool.map((t) => t._reason).join(',') : 'none';

  // Danielle gets a separate SMS pointing at warranty-review.html when
  // the job is warranty AND there's customer media she'll need for the
  // portal submission. No-op for self-pay or media-less intakes.
  const customerType = String(job.customer_type || '').toLowerCase();
  const warrantyCompany = String(job.warranty_company || '').trim();
  const isWarrantyJob = customerType === 'warranty' || warrantyCompany.length > 0;
  let danielleResult = 'skipped_not_warranty';
  if (isWarrantyJob) {
    if (attachmentCount === 0) {
      danielleResult = 'skipped_no_media';
    } else {
      const warrantyReviewUrl = `https://${bareDomain()}/warranty-review.html?job_id=${jobId}`;
      const vendorLabel = warrantyCompany || 'warranty';
      const dBody =
        `[ant] ${vendorLabel} job #${jobId} - ${cn}, ${appl}.${mediaTag} ` +
        `Customer media ready for portal submission: ${warrantyReviewUrl}`;
      try {
        const r = await sms.toDanielle(dBody, {
          action: 'customer_intake_bundle_danielle_sms',
          job_id: jobId,
          warranty_company: warrantyCompany,
          attachment_count: attachmentCount,
          signal_id: signal.id,
        });
        danielleResult = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) {
        danielleResult = String(e.message || e);
      }
    }
  }

  const meta = {
    job_id: jobId,
    outcome: 'sent',
    owner_sms: teddyResult,
    tech_sms: techResult,
    tech_routing: techReason,
    tech_ids_notified: techPool.map((t) => t.id),
    danielle_sms: danielleResult,
    is_warranty: isWarrantyJob,
    attachment_count: attachmentCount,
    cluster_id: ctxBundle.cluster_id || '',
    cluster_tech_count: clusterTechs.length,
  };

  await xano.markSignalProcessed(signal.id, 'customer_intake_bundle_handled', meta);
  log('customer_intake_bundle_handled', meta);
  return { success: true, action: 'customer_intake_bundle_handled', job_id: jobId };
}
