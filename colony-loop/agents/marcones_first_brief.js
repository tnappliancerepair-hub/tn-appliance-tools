// Daily 6:30am CT — SMSes each tech a morning brief that aggregates
// today's jobs + likely parts to grab from Marcones on the way out.
// Saves them a midday detour when they realize they need a part they
// could've grabbed at the supply house first.
//
// Signal in: MARCONES_FIRST_BRIEF (cron-emitted from tick.js)
// Signal out: none — terminal agent

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  const techsRes = await xano.getTechnicians();
  const techs = (techsRes && techsRes.technicians) ? techsRes.technicians : (Array.isArray(techsRes) ? techsRes : []);
  const active = techs.filter((t) => t && t.active && t.id && t.phone && Number(t.id) !== 8);

  let sent = 0;
  let skipped = 0;

  for (const t of active) {
    try {
      const data = await xano.getJSON(`${xano.INTAKE()}/get_tech_predicted_parts_for_today?tech_id=${t.id}`);
      if (!data || !data.success || (data.job_count || 0) === 0) {
        skipped++;
        continue;
      }

      // Build appliance summary from today's jobs
      const applLines = Array.from(new Set(
        (data.jobs || [])
          .map((j) => `${j.appliance_brand || ''} ${j.appliance_type || 'appliance'}`.trim())
          .filter(Boolean)
      ));
      const applSummary = applLines.join(', ');

      // Build parts hints from TDRs across today's tech's recent work,
      // restricted to TDRs that match a today-job by id
      const todayJobIds = new Set((data.jobs || []).map((j) => Number(j.id)));
      const rawHints = (data.recent_tdrs || [])
        .filter((t) => todayJobIds.has(Number(t.job_id)))
        .flatMap((t) => [t.parts_needed || '', t.failed_component || ''])
        .flatMap((s) => String(s).split(/[,;\n]/g).map((x) => x.trim()).filter(Boolean));
      const hints = Array.from(new Set(rawHints)).slice(0, 8);

      const firstName = data.tech_first_name || 'brother';
      let body;
      if (hints.length === 0) {
        body = `[ant] morning ${firstName} — ${data.job_count} stops today (${applSummary}). Worth hitting Marcones first to grab obvious parts. Let's get it.`;
      } else {
        const list = hints.length > 5 ? hints.slice(0, 5).join(', ') + `, +${hints.length - 5} more` : hints.join(', ');
        body = `[ant] morning ${firstName} — ${data.job_count} stops today. Marcones grab-list: ${list}. Saves a midday run. Let's get it.`;
      }

      await xano.sendSms({
        to: t.phone,
        body,
        recipient_role: 'tech',
        context: { source: 'marcones_first_brief', tech_id: t.id, job_count: data.job_count, hint_count: hints.length },
      });
      sent++;
    } catch (e) {
      log('marcones_first_brief_tech_error', { tech_id: t.id, error: e.message });
    }
  }

  const meta = { sent, skipped, total_active: active.length, outcome: 'marcones_first_brief_sent' };
  await xano.markSignalProcessed(signal.id, 'marcones_first_brief_sent', meta);
  log('marcones_first_brief_sent', meta);

  return { success: true, action: 'marcones_first_brief_sent', sent };
}
