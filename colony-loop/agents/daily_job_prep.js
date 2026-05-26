// DAILY_JOB_PREP — fires once daily at 6:30am CT (via tick.js 6-9am window
// gated by get_daily_job_prep_fired_today). Pulls every job scheduled in
// the next 3 days that has NO pre-diagnosis TDR from Teddy and fans out
// SMS:
//   - To Teddy: a consolidated list of every undiagnosed job (across techs)
//     as Teddy Tool links, so he can blast through pre-diagnosis at his
//     desk before the trucks roll.
//   - To each individual tech: only their own undiagnosed jobs as Teddy
//     Tool links, so they can add their on-site diagnosis from the truck.
//
// Goal: every job gets a pre-diagnosis before first visit so parts can be
// ordered. Eliminates the -2/-3/-4/-5 repeat-visit cycle.
import { config } from '../config.js';
import { toOwner, toTech, normalizeE164 } from '../sms.js';

const TEDDY_TOOL_PATH = '/teddy-tdr-tool.html?job_id=';

function fmtTimeCT(ms) {
  if (!ms) return '?';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Chicago',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function linkFor(jobId) {
  const base = config.publicSiteBase.replace(/^https?:\/\//, '');
  return `${base}${TEDDY_TOOL_PATH}${jobId}`;
}

function customerLabel(row) {
  const f = (row.customer_first || '').trim();
  const l = (row.customer_last || '').trim();
  return [f, l].filter(Boolean).join(' ') || '(no name)';
}

function jobLine(idx, row) {
  const time = fmtTimeCT(row.scheduled_start);
  const name = customerLabel(row);
  const appl = (row.appliance_type || '').trim() || 'appl';
  const city = (row.service_city || '').trim();
  const where = city ? `, ${city}` : '';
  return `${idx}. ${time} ${name}${where} - ${appl} - ${linkFor(row.job_id)}`;
}

function chunkLines(headerLine, lines, maxChars = 1400) {
  // SMS providers (Telnyx) accept concatenated SMS up to ~1530 chars;
  // 1400 leaves headroom for emoji + the header.
  const out = [];
  let current = [headerLine];
  let len = headerLine.length;
  for (const line of lines) {
    if (len + line.length + 1 > maxChars && current.length > 1) {
      out.push(current.join('\n'));
      current = [headerLine];
      len = headerLine.length;
    }
    current.push(line);
    len += line.length + 1;
  }
  if (current.length > 1) out.push(current.join('\n'));
  return out;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const daysAhead = Number(payload.days_ahead || 3);

  // Dedup — only run once per day. Marker written below at the end.
  // (tick.js also gates with get_daily_job_prep_fired_today but this is a
  // second layer for manual injects on the same day.)

  let result;
  try {
    result = await xano.getUndiagnosedJobsNext3Days(daysAhead);
  } catch (err) {
    const meta = { outcome: 'context_load_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'daily_job_prep_handled', meta);
    log('daily_job_prep_handled', meta);
    return { success: false, action: 'context_load_failed' };
  }

  const items = (result && result.undiagnosed) || [];

  if (items.length === 0) {
    await xano.recordEventLog('daily_job_prep_fired', {
      undiagnosed_count: 0,
      days_ahead: daysAhead,
      source_signal_id: signal.id,
    });
    const meta = { outcome: 'nothing_undiagnosed', undiagnosed_count: 0 };
    await xano.markSignalProcessed(signal.id, 'daily_job_prep_handled', meta);
    log('daily_job_prep_handled', meta);
    return { success: true, action: 'nothing_undiagnosed' };
  }

  // ── 1. Teddy roll-up: every undiagnosed job, ordered by scheduled_start ──
  const teddyLines = items.map((r, i) => jobLine(i + 1, r));
  const teddyHeader = `🐜 ${items.length} undiagnosed job${items.length === 1 ? '' : 's'} in next ${daysAhead} days. Pre-diagnose so parts can be ordered:`;
  const teddyChunks = chunkLines(teddyHeader, teddyLines, 1400);
  let teddyOk = 0;
  for (const body of teddyChunks) {
    try {
      const r = await toOwner(body, {
        action: 'daily_job_prep_owner_sms',
        source_signal_id: signal.id,
      });
      if (r && r.success) teddyOk += 1;
    } catch (err) {
      log('daily_job_prep_owner_sms_failed', { error: String(err.message || err) });
    }
  }

  // ── 2. Per-tech fan-out: only their own undiagnosed jobs ──
  // Group by technician_id; skip jobs with no tech assigned.
  const byTech = {};
  for (const r of items) {
    const tid = Number(r.technician_id || 0);
    if (!tid || tid === 1) continue; // skip unassigned + owner (Teddy already got the roll-up)
    if (!byTech[tid]) byTech[tid] = [];
    byTech[tid].push(r);
  }

  let techRecipients = [];
  let techs = [];
  try {
    techs = await xano.getTechnicians();
  } catch (err) {
    log('daily_job_prep_techs_load_failed', { error: String(err.message || err) });
  }
  const techMap = {};
  for (const t of (techs && techs.items) || techs || []) {
    if (t && t.id) techMap[t.id] = t;
  }

  let techSmsOk = 0;
  for (const tidStr of Object.keys(byTech)) {
    const tid = Number(tidStr);
    const techRows = byTech[tid];
    const tech = techMap[tid];
    if (!tech) {
      log('daily_job_prep_tech_missing', { tech_id: tid, jobs: techRows.length });
      continue;
    }
    const techPhone = normalizeE164(tech.phone);
    if (!techPhone) {
      log('daily_job_prep_tech_no_phone', { tech_id: tid });
      continue;
    }
    const first = (tech.first_name || '').trim() || 'tech';
    const lines = techRows.map((r, i) => jobLine(i + 1, r));
    const header = `🐜 ${first} - ${techRows.length} undiagnosed job${techRows.length === 1 ? '' : 's'} in next ${daysAhead} days. Add your pre-diagnosis before arrival:`;
    const chunks = chunkLines(header, lines, 1400);
    for (const body of chunks) {
      try {
        const r = await toTech(techPhone, body, {
          action: 'daily_job_prep_tech_sms',
          technician_id: tid,
          source_signal_id: signal.id,
        });
        if (r && r.success) techSmsOk += 1;
      } catch (err) {
        log('daily_job_prep_tech_sms_failed', { tech_id: tid, error: String(err.message || err) });
      }
    }
    techRecipients.push({ tech_id: tid, jobs: techRows.length });
  }

  // ── 3. Daily-fired marker so the tick.js dedup can suppress same-day reruns ──
  try {
    await xano.recordEventLog('daily_job_prep_fired', {
      undiagnosed_count: items.length,
      days_ahead: daysAhead,
      teddy_sms_chunks: teddyChunks.length,
      tech_recipients: techRecipients,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('daily_job_prep_marker_failed', { error: String(err.message || err) });
  }

  const meta = {
    outcome: 'fanout_complete',
    undiagnosed_count: items.length,
    days_ahead: daysAhead,
    teddy_sms_chunks_ok: teddyOk,
    tech_sms_ok: techSmsOk,
    tech_recipients: techRecipients,
  };
  await xano.markSignalProcessed(signal.id, 'daily_job_prep_handled', meta);
  log('daily_job_prep_handled', meta);

  return { success: true, action: 'fanout_complete', undiagnosed_count: items.length };
}
