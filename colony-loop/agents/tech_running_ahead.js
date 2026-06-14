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
  const pool = local.concat(other);
  // Rank: nearby (in the tech's cluster) first — that's the whole point of a
  // route-fill offer — then pre-diagnosed (ready to work) within that.
  const score = (c) => (c && c.in_tech_cluster ? 2 : 0) + (c && c.has_prediag ? 1 : 0);
  return pool
    .map((c, i) => ({ c, i }))
    .sort((a, b) => score(b.c) - score(a.c) || a.i - b.i)
    .map(x => x.c)
    .slice(0, max);
}

function describe(c) {
  const who = (c.customer_first || 'customer').trim();
  const appl = (c.appliance || 'appliance').trim();
  const where = (c.city || c.zip || '').trim();
  const pd = c.has_prediag ? ' (pre-diag ✓)' : '';
  return `#${c.id} ${who} ${appl}${where ? ' ' + where : ''}${pd}`;
}

// One-tap grab link for a candidate (books it onto the tech's day today).
function grabLink(c, techId) {
  const who = (c.customer_first || 'customer').trim();
  const appl = (c.appliance || 'appliance').trim();
  const where = (c.city || c.zip || '').trim();
  const label = `${who} ${appl}${where ? ' ' + where : ''}`.trim();
  const base = (config.publicSiteBase || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
  return `${base}/grab.html?job=${c.id}&tech=${techId}&label=${encodeURIComponent(label)}`;
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

  // Always resolve the tech's phone — in BOTH modes we loop the tech in.
  // The tech on the ground is the real judge of whether a nearby pickup
  // routes well, so even in shadow we preview it to him and ask for a
  // thumbs-up to Teddy (no booking) before route-fill goes fully live.
  let techPhone = '';
  try {
    const techsResp = await xano.getTechnicians();
    const techs = Array.isArray(techsResp) ? techsResp : (techsResp.technicians || techsResp.items || []);
    const t = techs.find(x => x && Number(x.id) === Number(techId));
    techPhone = (t && t.phone) ? t.phone : '';
  } catch (_) {}

  let mode, techSms = 'skipped', ownerSms = 'skipped';
  if (config.routeFillLive) {
    // LIVE: offer the tech directly with one-tap grab links.
    if (techPhone) {
      mode = 'offered_tech';
      const grabLines = candidates.map((c, i) => `${i + 1}. ${describe(c)}\n   grab: ${grabLink(c, techId)}`).join('\n');
      const body =
        `[ant] You're ${minutesAhead}min ahead, ${firstName} 🐜 — open jobs close by. Tap to add one to your day:\n${grabLines}`;
      try {
        const r = await sms.toTech(techPhone, body, { action: 'route_fill_offer', tech_id: techId });
        techSms = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { techSms = String(e.message || e); }
      // Stash the pending offer (audit / future reply paths).
      try {
        await xano.recordEventLog(`route_fill_pending_${techId}`, {
          tech_id: techId,
          offered_at_ms: Date.now(),
          candidates: candidates.map(c => ({ job_id: c.id, customer_id: c.customer_id, appliance: c.appliance })),
        });
      } catch (_) {}
    } else {
      mode = 'offered_tech_no_phone';
      techSms = 'no_tech_phone';
    }
  } else {
    // SHADOW: preview to the TECH (he tells Teddy if it's a good pickup),
    // and CC Teddy so he sees what went out and can correlate the reply.
    mode = 'preview_tech_and_owner';
    if (techPhone) {
      const body =
        `[ant] You're ${minutesAhead}min ahead, ${firstName} 🐜 — open jobs near you:\n${lines}\n` +
        `We're testing auto route-fill. If one's a good pickup, text Teddy and he'll send it your way. (No booking yet.)`;
      try {
        const r = await sms.toTech(techPhone, body, { action: 'route_fill_preview', tech_id: techId });
        techSms = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { techSms = String(e.message || e); }
    } else {
      techSms = 'no_tech_phone';
    }
    if (config.ownerPhone) {
      const body =
        `[ant] ${firstName} ${minutesAhead}min ahead (${p.completed}/${p.total_today} done). Previewed ${candidates.length} nearby open to him:\n${lines}\n` +
        `He'll text you if one's good. Set ROUTE_FILL_LIVE=true to let him grab them himself.`;
      try {
        const r = await sms.toOwner(body, { action: 'tech_ahead_proposal', tech_id: techId, candidate_count: candidates.length });
        ownerSms = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { ownerSms = String(e.message || e); }
    } else {
      ownerSms = 'no_owner_phone';
    }
  }

  const meta = {
    outcome: mode,
    tech_id: techId,
    tech_name: firstName,
    minutes_ahead: minutesAhead,
    candidate_count: candidates.length,
    candidate_job_ids: candidates.map(c => c.id),
    tech_sms: techSms,
    owner_sms: ownerSms,
  };
  await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', meta);
  try { await xano.recordEventLog(dedupKey, { tech_id: techId, minutes_ahead: minutesAhead, candidates: candidates.length }); } catch (_) {}
  log('tech_ahead_handled', meta);
  return { success: true, action: 'tech_ahead_handled', mode, candidates: candidates.length };
}
