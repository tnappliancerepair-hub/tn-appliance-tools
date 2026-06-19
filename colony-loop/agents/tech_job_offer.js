// tech_job_offer.js — the self-scheduling autopilot's OFFER step.
//
// Receives a computed offer (job + the route-smart, availability-honoring tech
// + day picked upstream) and makes the tech a ONE-TAP offer:
//   "[ant] New job, Jimmy 🐜 — Maytag washer, Antioch, fits Thursday. Tap YES."
// Tech taps the grab link → grab.html books THAT day via danielle_schedule_
// parallel_job → APPOINTMENT_SCHEDULED → customer confirmed. The tech is the
// decision-maker; the owner is only pulled in if nobody takes it.
//
//   Shadow (default, TECH_OFFER_LIVE=off): texts TEDDY what it WOULD offer, so
//     we validate the picks (right tech? right day? honors availability?)
//     before any tech is pinged.
//   Live (TECH_OFFER_LIVE=true): texts the tech directly.
//
// Signal in: TECH_JOB_OFFER {
//   job_id, technician_id, scheduled_start_ms,   (required — computed upstream)
//   label?, why?, customer_first?, appliance?, city?, attempt?
// }
// Dedup: one offer per (job, tech) — re-offer to the NEXT tech uses a new key.
//
// Pure-ish: the SMS composition is unit-tested via composeOffer() below.

import { config } from '../config.js';

const SITE = (config.publicSiteBase || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

// Day label only (operating model = DAY + AREA, no clock time).
export function dayLabel(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric',
    }).format(new Date(Number(ms)));
  } catch (_) { return 'soon'; }
}

export function grabLink({ jobId, techId, label, startMs }) {
  const l = encodeURIComponent(String(label || 'job').slice(0, 80));
  return `${SITE}/grab.html?job=${jobId}&tech=${techId}&label=${l}&start_ms=${Number(startMs)}`;
}

// The tech-facing offer text. Pure → testable.
export function composeOffer({ techFirst, label, day, why, link }) {
  const ctx = why ? ` (${why})` : '';
  return `[ant] New job for you, ${techFirst} 🐜 — ${label}, fits ${day}${ctx}. ` +
    `Tap YES to add it to your day:\n${link}`;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const jobId = Number(p.job_id || 0);
  const techId = Number(p.technician_id || 0);
  const startMs = Number(p.scheduled_start_ms || 0);

  if (!jobId || !techId || !startMs) {
    const meta = { outcome: 'missing_fields', job_id: jobId, tech_id: techId, has_start: !!startMs };
    await xano.markSignalProcessed(signal.id, 'tech_job_offer_handled', meta);
    log('tech_job_offer_handled', meta);
    return { success: false, action: 'missing_fields' };
  }

  // Don't offer the owner the working slot (he's the fallback router, not a stop).
  if (techId === 1) {
    const meta = { outcome: 'skip_owner_as_tech', job_id: jobId };
    await xano.markSignalProcessed(signal.id, 'tech_job_offer_handled', meta);
    return { success: true, action: 'skip_owner_as_tech' };
  }

  // Dedup — one offer per (job, tech). A re-offer to the next-ranked tech is a
  // different key, so the escalation walk isn't blocked.
  const dedupKey = `tech_offer_sent_${jobId}_${techId}`;
  try {
    const prev = await xano.getEventLogByAction(dedupKey);
    if (prev && prev.exists) {
      const meta = { outcome: 'already_offered', job_id: jobId, tech_id: techId };
      await xano.markSignalProcessed(signal.id, 'tech_job_offer_handled', meta);
      return { success: true, action: 'already_offered' };
    }
  } catch (_) { /* best-effort */ }

  // Resolve tech phone + first name from the roster (same as route-fill).
  let techPhone = '', techFirst = 'there';
  try {
    const techsResp = await xano.getTechnicians();
    const techs = Array.isArray(techsResp) ? techsResp : (techsResp.technicians || techsResp.items || []);
    const t = techs.find((x) => x && Number(x.id) === techId);
    if (t) {
      techPhone = (t.phone || '').trim();
      techFirst = (t.first_name || (t.name || '').split(' ')[0] || 'there').trim();
    }
  } catch (_) {}

  const label = String(p.label
    || [p.customer_first, p.appliance, p.city].filter(Boolean).join(' ')
    || `job #${jobId}`).trim();
  const day = dayLabel(startMs);
  const link = grabLink({ jobId, techId, label, startMs });
  const why = p.why || '';

  let mode, techSms = 'skipped', ownerSms = 'skipped';

  if (config.techOfferLive) {
    // LIVE — offer the tech directly.
    if (techPhone) {
      mode = 'offered_tech';
      const body = composeOffer({ techFirst, label, day, why, link });
      try {
        const r = await sms.toTech(techPhone, body, { action: 'tech_job_offer', tech_id: techId, force_send: true });
        techSms = r?.success ? 'ok' : (r?.error || r?.quieted ? 'quieted' : 'failed');
      } catch (e) { techSms = String(e.message || e); }
    } else {
      mode = 'no_tech_phone';
      techSms = 'no_tech_phone';
    }
  } else {
    // SHADOW — show Teddy exactly what it WOULD send the tech.
    mode = 'shadow_preview_owner';
    if (config.ownerPhone) {
      const body =
        `[ant] 🧪 self-schedule preview — would offer ${techFirst} (tech ${techId}): ${label}, ${day}` +
        `${why ? ' (' + why + ')' : ''}. Set TECH_OFFER_LIVE=true to send it to him.`;
      try {
        const r = await sms.toOwner(body, { action: 'tech_job_offer_shadow', tech_id: techId, job_id: jobId, force_send: true });
        ownerSms = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { ownerSms = String(e.message || e); }
    } else {
      ownerSms = 'no_owner_phone';
    }
  }

  // Stamp the offer (dedup + the escalation sweep reads this for expiry).
  try {
    await xano.recordEventLog(dedupKey, {
      job_id: jobId, tech_id: techId, scheduled_start_ms: startMs,
      offered_at_ms: Date.now(), mode, label, day,
    });
  } catch (_) {}

  const meta = { outcome: mode, job_id: jobId, tech_id: techId, day, tech_sms: techSms, owner_sms: ownerSms };
  await xano.markSignalProcessed(signal.id, 'tech_job_offer_handled', meta);
  log('tech_job_offer_handled', meta);
  return { success: true, action: mode, job_id: jobId, tech_id: techId };
}

// ── self-test:  node tech_job_offer.js --test ───────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('tech_job_offer.js') && process.argv.includes('--test')) {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
  const thu = Date.parse('2026-06-25T14:00:00Z'); // a Thursday
  ok(/Thursday/.test(dayLabel(thu)), 'dayLabel shows weekday: ' + dayLabel(thu));
  const link = grabLink({ jobId: 18537, techId: 2, label: 'Jane Maytag Antioch', startMs: thu });
  ok(link.includes('job=18537') && link.includes('tech=2') && link.includes('start_ms=' + thu), 'grab link carries job/tech/start_ms');
  ok(link.includes('label=Jane'), 'grab link encodes label');
  const body = composeOffer({ techFirst: 'Jimmy', label: 'Jane Maytag Antioch', day: 'Thursday, Jun 25', why: 'fits your cluster', link });
  ok(body.includes('Jimmy') && body.includes('Thursday') && body.includes('YES') && body.includes(link), 'offer text well-formed');
  console.log(`tech_job_offer.js self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
