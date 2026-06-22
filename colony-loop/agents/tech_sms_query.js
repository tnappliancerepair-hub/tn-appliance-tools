// Signal in: TECH_SMS_QUERY (emitted by netlify/functions/tech-sms-inbound.js
// when a tech texts a short lookup question to the tech line 615-857-8800).
//
// THE BAD-SIGNAL LIFELINE: when a tech is standing in a basement on one bar,
// the dashboard/app won't load — but a text always goes through. So they can
// TEXT Ant a question and get a DB-grounded answer back. v1 handles two
// intents: "next job" and "my day". Pure database lookup, NO Claude — so it's
// reliable and fast (the AI tech path is the flaky one; this is not that).
//
// Resolves the tech by their phone number, pulls their daily dashboard, and
// texts back a concise answer via xano.sendSms directly (guaranteed delivery —
// the tech explicitly asked, so we bypass the toTech allow-list / weekend mute).

import { normalizeE164 } from '../sms.js';

function digits10(p) {
  return String(p || '').replace(/\D/g, '').replace(/^1/, '').slice(-10);
}

function custName(c) {
  const n = `${(c.first_name || '').trim()} ${(c.last_name || '').trim()}`.trim();
  return n || 'customer';
}

// First non-terminal stop (what the tech should head to next), falling back to
// the first stop if everything is somehow terminal.
function nextOpen(jobs) {
  const open = jobs.filter((it) => {
    const s = String((it.job || {}).scheduling_status || '').toLowerCase();
    return s !== 'completed' && s !== 'canceled' && s !== 'no_fix_possible';
  });
  return open[0] || jobs[0] || null;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const phone = normalizeE164(p.phone || p.from);
  const body = String(p.body || p.message || '').toLowerCase();

  if (!phone) {
    await xano.markSignalProcessed(signal.id, 'tech_sms_query_handled', { outcome: 'no_phone' });
    return { success: false, action: 'no_phone' };
  }

  // Resolve the tech by phone.
  let techId = Number(p.tech_id || 0);
  let techFirst = '';
  try {
    const resp = await xano.getTechnicians();
    const techs = Array.isArray(resp) ? resp : (resp.technicians || resp.items || []);
    const d = digits10(phone);
    const t = techs.find((x) => x && digits10(x.phone) === d);
    if (t) {
      techId = Number(t.id);
      techFirst = String(t.first_name || t.name || '').trim().split(' ')[0] || '';
    }
  } catch (_) { /* fall through — handled below */ }

  if (!techId) {
    await xano.sendSms(
      phone,
      "I couldn't match your number to a tech profile yet. Text Teddy at 615-485-5795 and he'll get you squared away. 🐜",
      { action: 'tech_sms_query_reply', recipient_role: 'tech' }
    );
    await xano.markSignalProcessed(signal.id, 'tech_sms_query_handled', { outcome: 'tech_not_found' });
    return { success: true, action: 'tech_not_found' };
  }

  // Pull today's schedule.
  let jobs = [];
  try {
    const dash = await xano.getTechDailyDashboard(techId);
    jobs = Array.isArray(dash && dash.jobs) ? dash.jobs : [];
  } catch (e) {
    await xano.sendSms(
      phone,
      "Couldn't pull your schedule just now — give it a sec and text me again. 🐜",
      { action: 'tech_sms_query_reply', recipient_role: 'tech', tech_id: techId }
    );
    await xano.markSignalProcessed(signal.id, 'tech_sms_query_handled', { outcome: 'dashboard_error', tech_id: techId });
    return { success: true, action: 'dashboard_error' };
  }

  const isMyDay = /\b(my day|today|schedule|my jobs|my stops|all jobs|whole day)\b/.test(body);
  let reply;

  if (!jobs.length) {
    reply = "You've got no jobs on the board for today. 🐜";
  } else if (isMyDay) {
    const lines = jobs.slice(0, 8).map((it, idx) => {
      const j = it.job || {};
      const c = it.customer || {};
      const appl = String(j.appliance_type || 'appliance').toLowerCase();
      const city = String(j.service_city || '').trim();
      return `${idx + 1}. ${custName(c)} - ${appl}${city ? ' (' + city + ')' : ''}`;
    });
    reply = `🐜 Your day - ${jobs.length} stop${jobs.length > 1 ? 's' : ''}:\n` + lines.join('\n');
    if (jobs.length > 8) reply += `\n...+${jobs.length - 8} more`;
  } else {
    // next job
    const it = nextOpen(jobs);
    const j = (it && it.job) || {};
    const c = (it && it.customer) || {};
    const appl = String(j.appliance_type || 'appliance').toLowerCase();
    const addr = [j.service_address, j.service_city, j.service_state].filter(Boolean).join(', ') || 'no address on file';
    const ph = String(c.phone || '').replace(/[^\d]/g, '');
    const problem = String(j.problem_summary || '').trim();
    reply = `🐜 Next: ${custName(c)} - ${appl}\n📍 ${addr}` +
      (ph ? `\n📞 ${ph}` : '') +
      (problem ? `\n"${problem.slice(0, 90)}"` : '');
  }

  await xano.sendSms(phone, reply, { action: 'tech_sms_query_reply', recipient_role: 'tech', tech_id: techId });

  const meta = { outcome: 'replied', tech_id: techId, intent: isMyDay ? 'my_day' : 'next_job', jobs: jobs.length };
  await xano.markSignalProcessed(signal.id, 'tech_sms_query_handled', meta);
  log('tech_sms_query_handled', meta);
  return { success: true, action: 'replied', intent: meta.intent };
}
