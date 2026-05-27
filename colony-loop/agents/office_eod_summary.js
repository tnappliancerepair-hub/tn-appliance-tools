// Handles OFFICE_EOD_SUMMARY signals (emitted daily 8pm CT by tick.js).
// EOD digest of today's activity to Teddy + Danielle:
//
//   [ant] 📅 today's wrap:
//   ✓ 12 jobs completed · 2 canceled
//   📞 5 inbound calls · 3 new jobs created
//   🛡 4 warranty digests sent · 1 TDR-blocked attempt
//   ⚠️ 0 callback alerts
//   Pulse: …/office-pulse.html
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.getOfficeEodSummary();
  } catch (err) {
    log('office_eod_summary_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'office_eod_summary_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const completed = Number(payload.completed || 0);
  const canceled = Number(payload.canceled || 0);
  const newJobs = Number(payload.new_jobs || 0);
  const warranty = Number(payload.warranty_handled || 0);
  const tdrBlocks = Number(payload.tdr_blocks || 0);
  const callbacks = Number(payload.callbacks || 0);
  const inboundCalls = Number(payload.inbound_calls || 0);

  const lines = [`[ant] 📅 today's wrap:`];
  lines.push(`✓ ${completed} jobs completed · ${canceled} canceled`);
  lines.push(`📞 ${inboundCalls} inbound calls · ${newJobs} new jobs created`);
  if (warranty > 0 || tdrBlocks > 0) {
    lines.push(`🛡 ${warranty} warranty digests · ${tdrBlocks} TDR-blocked attempts`);
  }
  if (callbacks > 0) {
    lines.push(`⚠️ ${callbacks} callback alerts`);
  }
  lines.push(`Pulse: ${bareDomain()}/office-pulse.html`);

  const body = lines.join('\n');

  let teddyRes = null;
  let danielleRes = null;
  try {
    teddyRes = await toOwner(body, {
      action: 'office_eod_summary_sent',
      counts: { completed, canceled, newJobs, warranty, tdrBlocks, callbacks, inboundCalls },
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(body, {
      action: 'office_eod_summary_sent',
      counts: { completed, canceled, newJobs, warranty, tdrBlocks, callbacks, inboundCalls },
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: 'sent',
    completed, canceled, new_jobs: newJobs, warranty_handled: warranty,
    tdr_blocks: tdrBlocks, callbacks, inbound_calls: inboundCalls,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'office_eod_summary_handled', meta);
  log('office_eod_summary_handled', meta);

  return { success: true, action: 'sent', ...meta };
}
