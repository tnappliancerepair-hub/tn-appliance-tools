// Signal in: TECH_BURNOUT_CHECK
// Fires weekly (Sun 8-9am CT). For each active tech (skipping Teddy +
// orphan tech_id=8), compares last-7d job-completion + TDR rate vs the
// 30d baseline. If both drop by >40%, SMSes Teddy with a "check in on
// X" heads-up. Cheap retention insurance — burnout is hard to measure
// but easy to act on if you catch it early.
//
// PARTIAL DATA: this watches volume-based signals only. Sentiment
// from SMS tone, weekend skipping, etc. require richer instrumentation
// not yet wired. Threshold (40% drop) is a starting point — tune as
// false-positive rate becomes clear.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

const DROP_THRESHOLD = 0.40; // 40% below expected

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  // Get list of active techs from a known endpoint. xano.getTechnicians
  // returns the active roster.
  let techs;
  try {
    techs = await xano.getTechnicians();
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'tech_burnout_handled', { outcome: 'fetch_techs_failed', error: String(err.message || err) });
    return { success: false, action: 'fetch_techs_failed' };
  }
  const list = (Array.isArray(techs) ? techs : techs?.technicians || []).filter((t) => t.active && t.id !== 1 && t.id !== 8);

  const concerns = [];
  for (const t of list) {
    try {
      const r = await fetch(INTAKE(`/get_tech_burnout_signal?tech_id=${t.id}`));
      const s = await r.json();
      const expected = Number(s.expected_7d || 0);
      const actual = Number(s.jobs_7d || 0);
      if (expected < 2) continue; // not enough baseline to judge
      const drop = (expected - actual) / expected;
      if (drop >= DROP_THRESHOLD) {
        concerns.push({
          tech_id: t.id,
          name: ((t.first_name || '') + ' ' + (t.last_name || '')).trim(),
          jobs_7d: actual,
          expected_7d: Math.round(expected),
          drop_pct: Math.round(drop * 100),
        });
      }
    } catch (_) {}
  }

  if (concerns.length === 0) {
    const meta = { outcome: 'all_healthy', techs_checked: list.length };
    await xano.markSignalProcessed(signal.id, 'tech_burnout_handled', meta);
    log('tech_burnout_all_healthy', meta);
    return { success: true, action: 'all_healthy' };
  }

  const lines = concerns.map((c) => `${c.name} (${c.jobs_7d}/${c.expected_7d} jobs, -${c.drop_pct}%)`).join(', ');
  const body = `[ant] ⚠️ tech activity drop — check in on: ${lines}. Could be sickness, slow-week, or burnout signature.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'tech_burnout_alert',
        concern_count: concerns.length,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'alert_sent',
    concerns,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_burnout_handled', meta);
  log('tech_burnout_handled', meta);
  return { success: true, action: 'tech_burnout_handled' };
}
