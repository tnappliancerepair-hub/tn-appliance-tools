// Handles OFFICE_MORNING_BRIEFING signals (emitted daily 8am CT by
// tick.js). Sends Danielle (and Teddy) a single-paragraph summary of
// today's office picture:
//
//   [ant] today (Tue May 27): 23 jobs scheduled across 6 techs.
//   12 AHS not_ready aging (>3d). 1 callback alert from yesterday.
//   2 jobs awaiting_parts ready to re-schedule.
//   Todo: tnapplianceexchange.net/office-todo.html
//
// Uses get_office_todo (already built) for the bulk of the data.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function todayLabel() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short', month: 'short', day: 'numeric',
    }).format(new Date());
  } catch { return ''; }
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let todo;
  try {
    todo = await xano.getOfficeTodo();
  } catch (err) {
    log('office_morning_briefing_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'office_morning_briefing_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const counts = (todo && todo.counts) || {};
  const stale = counts.stale_intake || 0;
  const held = counts.held || 0;
  const partsArrived = counts.parts_arrived || 0;
  const tdrBlocked = counts.tdr_blocked || 0;
  const callbacks = counts.callbacks || 0;

  const domain = bareDomain();
  const dateStr = todayLabel();

  const lines = [`[ant] today (${dateStr}):`];
  if (stale > 0) lines.push(`${stale} stale intake (>3d).`);
  if (held > 0) lines.push(`${held} held (warranty auth).`);
  if (partsArrived > 0) lines.push(`${partsArrived} parts arrived, ready to re-schedule.`);
  if (tdrBlocked > 0) lines.push(`${tdrBlocked} TDR-blocked completion attempts yesterday.`);
  if (callbacks > 0) lines.push(`${callbacks} callback alerts.`);

  if (stale + held + partsArrived + tdrBlocked + callbacks === 0) {
    lines.push('Office todo is clear. ✓');
  } else {
    lines.push(`Todo: ${domain}/office-todo.html`);
  }

  const body = lines.join(' ');

  let teddyRes = null;
  let danielleRes = null;
  try {
    teddyRes = await toOwner(body, {
      action: 'office_morning_briefing_sent',
      counts,
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(body, {
      action: 'office_morning_briefing_sent',
      counts,
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: 'sent',
    counts,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'office_morning_briefing_handled', meta);
  log('office_morning_briefing_handled', meta);

  return { success: true, action: 'sent', ...meta };
}
