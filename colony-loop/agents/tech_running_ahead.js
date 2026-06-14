// Signal in: TECH_RUNNING_AHEAD (from tech_pace_watcher)
//
// The "ultimate tech partner" — pull-work-forward half. When a tech is
// running ahead of his day, scan for nearby UNSCHEDULED jobs he could pick
// up now (via find_extra_work_for_tech: same-cluster + pre-diagnosed first),
// and surface a real, actionable offer.
//
//   - Shadow mode (default): SMS Teddy the real candidate list so he can
//     validate signal + candidate quality before techs get pinged.
//   - Live mode (ROUTE_FILL_LIVE=true): SMS the TECH directly with up to 2
//     nearby jobs — "reply 1/2/no" — and stash a pending offer the SMS
//     reply handler books. Customer gets a live window on accept.
//
// Dedup: one ahead-offer per tech per hour.

import { config } from '../config.js';

function pickCandidates(extra, max = 2) {
  const local = Array.isArray(extra?.prediag_and_local) ? extra.prediag_and_local : [];
  const other = Array.isArray(extra?.other_candidates) ? extra.other_candidates : [];
  // Pre-diagnosed + in-cluster first (best routing + ready to work), then rest.
  return local.concat(other).slice(0, max);
}

function describe(c) {
  const who = (c.customer_first || 'customer').trim();
  const appl = (c.appliance || 'appliance').trim();
  const where = (c.city || c.zip || '').trim();
  const pd = c.has_prediag ? ' (pre-diag ✓)' : '';
  return `#${c.id} ${who} ${appl}${where ? ' ' + where : ''}${pd}`;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const techId = p.tech_id;
  const techName = (p.tech_name || ('tech ' + techId)).trim();
  const minutesAhead = p.minutes_ahead || 0;

  if (!techId) {
    await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', { outcome: 'no_tech_id' });
    return { success: false, action: 'no_tech_id' };
  }

  // Dedup — one ahead-offer per tech per hour
  const dedupKey = `tech_ahead_offered_${techId}`;
  try {
    const prev = await xano.getEventLogByAction(dedupKey);
    if (prev && prev.exists && prev.last_at) {
      const lastMs = new Date(prev.last_at).getTime();
      if (!isNaN(lastMs) && (Date.now() - lastMs) < 60 * 60 * 1000) {
        await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', { outcome: 'recent_offer_skipped' });
        return { success: true, action: 'recent_offer_skipped' };
      }
    }
  } catch (_) { /* dedup is best-effort; proceed on lookup failure */ }

  // Scan for real nearby open work
  let extra = null;
  try {
    extra = xano.findExtraWorkForTech ? await xano.findExtraWorkForTech(techId, 3) : null;
  } catch (err) {
    extra = null;
  }
  const candidates = pickCandidates(extra, 2);
  const firstName = (extra && extra.tech_first_name) ? extra.tech_first_name : (techName.split(' ')[0] || techName);

  // No nearby work — tell Teddy (shadow) so he knows the gap, skip in live mode.
  if (!candidates.length) {
    let smsResult = 'no_owner_phone';
    if (config.ownerPhone) {
      const body = `[ant] ${firstName} is ${minutesAhead}min ahead (${p.completed}/${p.total_today} done) but no nearby open jobs to offer right now.`;
      try {
        const r = await sms.toOwner(body, { action: 'tech_ahead_no_candidates', tech_id: techId });
        smsResult = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { smsResult = String(e.message || e); }
    }
    const meta = { outcome: 'no_candidates', tech_id: techId, minutes_ahead: minutesAhead, sms_result: smsResult };
    await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', meta);
    try { await xano.recordEventLog(dedupKey, { tech_id: techId, candidates: 0 }); } catch (_) {}
    log('tech_ahead_handled', meta);
    return { success: true, action: 'no_candidates' };
  }

  const lines = candidates.map((c, i) => `${i + 1}. ${describe(c)}`).join('\n');

  let mode, smsResult = 'skipped';
  if (config.routeFillLive) {
    // LIVE: offer the tech directly. Look up his phone.
    let techPhone = '';
    try {
      const techsResp = await xano.getTechnicians();
      const techs = Array.isArray(techsResp) ? techsResp : (techsResp.technicians || techsResp.items || []);
      const t = techs.find(x => x && Number(x.id) === Number(techId));
      techPhone = (t && t.phone) ? t.phone : '';
    } catch (_) {}

    if (techPhone) {
      mode = 'offered_tech';
      const body =
        `[ant] You're ${minutesAhead}min ahead, ${firstName} 🐜 — open jobs close by:\n${lines}\n` +
        `Want one today? Reply 1${candidates.length > 1 ? ' or 2' : ''}, or NO.`;
      try {
        const r = await sms.toTech(techPhone, body, { action: 'route_fill_offer', tech_id: techId });
        smsResult = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { smsResult = String(e.message || e); }
      // Stash the pending offer so the SMS reply handler can book a pick.
      try {
        await xano.recordEventLog(`route_fill_pending_${techId}`, {
          tech_id: techId,
          offered_at_ms: Date.now(),
          candidates: candidates.map(c => ({ job_id: c.id, customer_id: c.customer_id, appliance: c.appliance })),
        });
      } catch (_) {}
    } else {
      mode = 'offered_tech_no_phone';
      smsResult = 'no_tech_phone';
    }
  } else {
    // SHADOW: validate with Teddy before pinging techs.
    mode = 'shadow_to_owner';
    if (config.ownerPhone) {
      const body =
        `[ant] ${firstName} ${minutesAhead}min ahead (${p.completed}/${p.total_today} done). ${candidates.length} nearby open:\n${lines}\n` +
        `Set ROUTE_FILL_LIVE=true to let Ant offer these to him directly.`;
      try {
        const r = await sms.toOwner(body, { action: 'tech_ahead_proposal', tech_id: techId, candidate_count: candidates.length });
        smsResult = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { smsResult = String(e.message || e); }
    } else {
      smsResult = 'no_owner_phone';
    }
  }

  const meta = {
    outcome: mode,
    tech_id: techId,
    tech_name: firstName,
    minutes_ahead: minutesAhead,
    candidate_count: candidates.length,
    candidate_job_ids: candidates.map(c => c.id),
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', meta);
  try { await xano.recordEventLog(dedupKey, { tech_id: techId, minutes_ahead: minutesAhead, candidates: candidates.length }); } catch (_) {}
  log('tech_ahead_handled', meta);
  return { success: true, action: 'tech_ahead_handled', mode, candidates: candidates.length };
}
