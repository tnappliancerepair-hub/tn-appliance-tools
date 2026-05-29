// PARTS ARRIVED → QUICK SCHEDULE
//
// Fires when a job's parts_status flips to "arrived" (signal type
// PARTS_ARRIVED, emitted by whichever path sets the status — the
// parts-tracking integration or Danielle's manual mark).
//
// Looks up:
//   - Who the original tech was
//   - The customer's previously-stated availability (customer_preference_text)
//   - The next 2 days of that tech's schedule for gaps
// And SMSes Teddy + the tech with a scheduling proposal:
//
//   "[ant] parts in for job #18020 (Julie Chang, LG range, AHS).
//    Jimmy has a gap tomorrow 2-4pm. Want me to draft the customer
//    SMS to book it? Tap: <scheduler link>"
//
// Revenue impact: shaves days off the parts-to-completion cycle.
// Jobs typically sit in Danielle's queue 3-5 days waiting for someone
// to notice the part arrived. This fires immediately.
//
// Gates:
//   - Skip if no tech assigned (parts arrived but unassigned job —
//     Danielle's intake queue handles this)
//   - Skip if dispatch already attempted in last 24h
//   - Skip after 7pm / before 6am CT

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_quick_schedule_skipped', { reason: 'no_job_id' });
    return { success: true, action: 'skipped_no_job' };
  }

  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (hour < 6 || hour >= 19) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_quick_schedule_skipped', { reason: 'after_hours', hour });
    return { success: true, action: 'skipped_after_hours' };
  }

  // 24h dedup per job
  const dedupAction = `parts_quick_sched_${jobId}`;
  try {
    const recent = await xano.listRecentEventLog({ action: dedupAction, days_back: 1, limit: 1 });
    if (recent && recent.length > 0) {
      await xano.markSignalProcessed(signal.id, 'parts_arrived_quick_schedule_skipped', { reason: 'already_proposed' });
      return { success: true, action: 'skipped_already_proposed' };
    }
  } catch (_) {}

  // Pull the job
  let job = null;
  let customer = null;
  try {
    const r = await xano.getJobForDashboard(jobId).catch(() => null);
    if (r) {
      job = r.job || null;
      customer = r.customer || null;
    }
  } catch (_) {}

  if (!job || !job.technician_id) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_quick_schedule_skipped', { reason: 'no_tech_assigned' });
    return { success: true, action: 'skipped_no_tech' };
  }

  const techId = Number(job.technician_id);
  let tech = null;
  try {
    const all = await xano.getTechnicians();
    tech = (all || []).find((t) => Number(t.id) === techId) || null;
  } catch (_) {}

  const techFirst = tech && tech.first_name ? tech.first_name.trim() : `tech ${techId}`;
  const custName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : 'customer';
  const apl = `${job.brand || ''} ${job.appliance_type || ''}`.trim() || 'appliance';
  const vendor = job.warranty_company ? ` · ${job.warranty_company}` : '';
  const custPref = (job.customer_preference_text || '').trim();
  const prefLine = custPref ? `\nCustomer said: "${custPref.slice(0, 120)}"` : '';

  // Deep-link the scheduler with a pre-seeded prompt so the tech
  // (or Teddy via the office surface) can pick a slot fast.
  const promptText = `Parts arrived for job #${jobId} (${custName}, ${apl}${vendor}). Find ${techFirst} an open slot in the next 2 days and draft the customer scheduling SMS.`;
  const link = `${BASE_URL}/tech-scheduler.html?tech_id=${techId}&prompt=${encodeURIComponent(promptText)}`;

  // SMS to TECH (preferred — they can schedule themselves) AND Teddy
  // (so they can step in if the tech doesn't act).
  const techSmsBody = `[ant] parts in for job #${jobId} — ${custName}, ${apl}${vendor}.${prefLine}\nFind a slot in your next 2 days? Tap: ${link}`;
  const teddySmsBody = `[ant] parts in for job #${jobId} — assigned to ${techFirst}. ${custName}, ${apl}${vendor}.${prefLine}\nNotified ${techFirst}; step in via scheduler if needed.`;

  let techResult = { ok: false };
  if (tech && tech.phone) {
    try {
      techResult = await sms.toTech({
        tech_id: techId,
        phone: tech.phone,
        body: techSmsBody,
        call_site: 'parts_arrived_quick_schedule',
      });
    } catch (e) { techResult = { ok: false, error: String(e) }; }
  }
  let teddyResult = { ok: false };
  try {
    teddyResult = await sms.toOwner(teddySmsBody, { call_site: 'parts_arrived_quick_schedule' });
  } catch (e) { teddyResult = { ok: false, error: String(e) }; }

  try {
    await xano.recordEvent(dedupAction, {
      job_id: jobId,
      tech_id: techId,
      tech_sms_ok: techResult.ok,
      teddy_sms_ok: teddyResult.ok,
    });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'parts_arrived_quick_schedule_handled', {
    job_id: jobId,
    tech_id: techId,
    sms_results: { tech: techResult.ok, teddy: teddyResult.ok },
  });

  log('parts_arrived_quick_schedule_sent', { job_id: jobId, tech_id: techId });
  return { success: true, action: 'proposed' };
}
