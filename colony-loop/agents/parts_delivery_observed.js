// PARTS DELIVERY OBSERVATION HANDLER
//
// Fires on PARTS_DELIVERY_OBSERVED signal (any source: Gmail parser,
// Marcone API, manual entry). Tries to fuzzy-match against open
// awaiting_parts jobs:
//
//   1. EXACT match on order_number → known job mapping → auto-fire
//      mark_parts_arrived
//   2. UNIQUE customer-name match against awaiting_parts queue →
//      auto-fire mark_parts_arrived
//   3. UNIQUE zip + (model or part number) match → auto-fire
//      mark_parts_arrived
//   4. AMBIGUOUS or NO match → SMS Teddy with extracted details +
//      candidate list so he can pick the right job manually
//
// Architecture note: this agent never modifies jobs directly. It
// always calls the canonical mark_parts_arrived endpoint so the
// audit trail is consistent regardless of source.

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';
const FUZZY_NAME_MATCH_THRESHOLD = 0.85;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};

  // Resolve the observation from event_log so we have full hints
  let observation = null;
  if (payload.event_log_id) {
    try {
      // No direct getEventLog helper, so look up via list with action filter
      const rows = await xano.listRecentEventLog({ action: 'parts_delivery_observed', days_back: 7, limit: 100 });
      observation = (rows || []).find((r) => Number(r.id) === Number(payload.event_log_id));
    } catch (_) {}
  }
  if (!observation) {
    await xano.markSignalProcessed(signal.id, 'parts_delivery_observation_skipped', { reason: 'observation_not_found' });
    return { success: false, action: 'skipped_no_obs' };
  }

  let obs;
  try { obs = typeof observation.metadata === 'string' ? JSON.parse(observation.metadata) : observation.metadata; }
  catch (_) { obs = null; }
  if (!obs) {
    await xano.markSignalProcessed(signal.id, 'parts_delivery_observation_skipped', { reason: 'metadata_parse_failed' });
    return { success: false, action: 'skipped_parse' };
  }

  // Pull open awaiting_parts jobs (scoped — keeps the match space small)
  const openJobs = await xano.listAwaitingPartsJobs({ limit: 100 });

  if (!openJobs || openJobs.length === 0) {
    // Empty queue — nothing to match. Still escalate so Teddy sees the
    // delivery happened (might mean a job was already moved out of
    // awaiting_parts but the customer wasn't notified).
    const escSms = composeEscalationSms(obs, []);
    let smsResult;
    try { smsResult = await sms.toOwner(escSms, { call_site: 'parts_delivery_observation_handler' }); }
    catch (e) { smsResult = { ok: false, error: String(e) }; }

    await xano.markSignalProcessed(signal.id, 'parts_delivery_observation_handled', {
      action: 'empty_queue_escalated',
      sms_ok: !!(smsResult && smsResult.ok),
    });
    log('parts_delivery_observation_escalated', { reason: 'empty_queue' });
    return { success: true, action: 'empty_queue_escalated' };
  }

  // Run the match tiers
  const tiers = matchTiers(obs, openJobs);

  if (tiers.confident.length === 1) {
    // Single confident match → auto-fire mark_parts_arrived
    const matched = tiers.confident[0];
    let markRes;
    try {
      markRes = await xano.markPartsArrived({ job_id: matched.id, source: obs.source, notes: `Auto-matched from ${obs.source}` });
    } catch (e) { markRes = { ok: false, error: String(e) }; }

    await xano.markSignalProcessed(signal.id, 'parts_delivery_observation_handled', {
      action: 'auto_marked',
      job_id: matched.id,
      mark_res: markRes,
    });
    log('parts_delivery_observation_auto_matched', { job_id: matched.id, source: obs.source });
    return { success: true, action: 'auto_marked', job_id: matched.id };
  }

  // Ambiguous (zero or 2+ confident) → escalate to Teddy with candidates
  const escSms = composeEscalationSms(obs, tiers.candidates.slice(0, 5));
  let smsResult;
  try { smsResult = await sms.toOwner(escSms, { call_site: 'parts_delivery_observation_handler' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'parts_delivery_observation_handled', {
    action: tiers.confident.length === 0 ? 'no_match' : 'ambiguous_match',
    candidates: tiers.candidates.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });
  log('parts_delivery_observation_escalated', {
    reason: tiers.confident.length === 0 ? 'no_match' : 'ambiguous',
    candidates: tiers.candidates.length,
  });
  return { success: true, action: tiers.confident.length === 0 ? 'no_match' : 'ambiguous' };
}

// ── Matching ──────────────────────────────────────────────────────
function matchTiers(obs, openJobs) {
  const confident = [];
  const candidates = [];

  for (const job of openJobs) {
    let score = 0;
    const reasons = [];

    // Tier 1: order_number exact match (if jobs have order_number on file)
    if (obs.order_number && job.order_number && String(job.order_number).toLowerCase() === String(obs.order_number).toLowerCase()) {
      score += 100; reasons.push('order#');
    }

    // Tier 2: customer name fuzzy match
    if (obs.customer_name_hint && job.customer_name) {
      const sim = nameSim(obs.customer_name_hint, job.customer_name);
      if (sim >= 0.95) { score += 80; reasons.push('name(exact)'); }
      else if (sim >= FUZZY_NAME_MATCH_THRESHOLD) { score += 50; reasons.push('name(fuzzy)'); }
    }

    // Tier 3: zip match
    if (obs.customer_zip_hint && job.service_zip && String(job.service_zip).startsWith(String(obs.customer_zip_hint).trim().slice(0, 5))) {
      score += 25; reasons.push('zip');
    }

    // Tier 4: part / model number match
    if (obs.part_number_hint && job.part_number && String(job.part_number).toLowerCase() === String(obs.part_number_hint).toLowerCase()) {
      score += 40; reasons.push('part#');
    }
    if (obs.model_number_hint && job.model_number && String(job.model_number).toLowerCase() === String(obs.model_number_hint).toLowerCase()) {
      score += 30; reasons.push('model#');
    }

    if (score >= 80) confident.push({ ...job, _score: score, _reasons: reasons.join('+') });
    else if (score >= 40) candidates.push({ ...job, _score: score, _reasons: reasons.join('+') });
  }

  confident.sort((a, b) => b._score - a._score);
  candidates.sort((a, b) => b._score - a._score);
  return { confident, candidates: [...confident, ...candidates] };
}

// Simple name similarity: lowercase tokens, count shared / total
function nameSim(a, b) {
  const t = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const aT = new Set(t(a)), bT = new Set(t(b));
  if (aT.size === 0 || bT.size === 0) return 0;
  let shared = 0;
  for (const x of aT) if (bT.has(x)) shared += 1;
  return shared / Math.max(aT.size, bT.size);
}

function composeEscalationSms(obs, candidates) {
  const lines = [];
  lines.push(`[ant] parts delivery seen — couldn't auto-match.`);
  lines.push(`Source: ${obs.source}${obs.vendor ? ' (' + obs.vendor + ')' : ''}`);
  if (obs.customer_name_hint) lines.push(`Customer: ${obs.customer_name_hint}`);
  if (obs.customer_zip_hint) lines.push(`Zip: ${obs.customer_zip_hint}`);
  if (obs.tracking_number) lines.push(`Tracking: ${obs.tracking_number}`);
  if (obs.order_number) lines.push(`Order: ${obs.order_number}`);
  if (candidates.length > 0) {
    lines.push('');
    lines.push(`Possible jobs:`);
    for (const c of candidates.slice(0, 5)) {
      lines.push(`• #${c.id} ${c.customer_name || ''} (${c.service_city || c.service_zip || '?'}) [${c._reasons}]`);
    }
    lines.push(`Open one in office calendar + tap "Parts Arrived" on the right one.`);
  } else {
    lines.push(`No candidate jobs in awaiting_parts. Verify delivery + match manually in /warranty-review.`);
  }
  return lines.join('\n');
}
