// meistertask-mirror-background — does the SLOW live MeisterTask pull + reconcile
// (and optional apply) off the request path, so the big-board rate-limited pull
// can't time out. Stores the result for readback by meistertask-mirror?report=1.
//   GET ?secret=&mode=diff[&project=]
//   GET ?secret=&mode=apply&confirm=yes[&project=][&names=1][&allow_paid=1]
// Placement-only: writes office_stage on CLAIM-matched cards; never creates a job.
'use strict';

const { getSecret } = require('./_lib/secrets');
const mm = require('./_lib/mt-mirror');
const crud = require('./_lib/xano/metadata-crud');
const sb = require('./_lib/supabase');

const JOBS_TABLE = 7;
const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const ARCHIVE = 'meistertask_archive';

async function storeReport(report) {
  // Full report to Supabase (unbounded), compact breadcrumb to event_log.
  try { if (await sb.isConnected()) { await sb.del(ARCHIVE, { board: 'eq._mirror_report' }).catch(() => {}); await sb.insert(ARCHIVE, { board: '_mirror_report', card_id: '', title: 'mirror', notes: '', card: report }); } } catch (_) {}
  try { await crud.logEvent('meistertask_mirror_report', { at_ms: Date.now(), mode: report.mode, project: report.project, counts: report.counts, move_breakdown: report.move_breakdown, applied: report.applied || 0, skipped: report.skipped || 0 }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  const started = Date.now();
  try {
    const r = await mm.reconcile(q.boards);
    const report = {
      ok: true, mode: q.mode === 'apply' ? 'apply' : 'diff', ran_at: new Date().toISOString(),
      project: r.project, boards_pulled: r.boards_pulled, open_cards: r.open_cards, board_jobs: r.board_jobs,
      counts: r.counts, matched_via: r.matched_via, move_breakdown: r.move_breakdown,
      would_move: r.would_move.slice(0, 400), name_matches: r.name_matches.slice(0, 200),
      missing_from_board: r.missing.slice(0, 300), unknown_sections: r.unknown_section.slice(0, 60), conflicts: (r.conflicts || []).slice(0, 60),
    };

    if (q.mode === 'apply' && String(q.confirm || '') === 'yes') {
      const allowPaid = q.allow_paid === '1';
      const doNames = q.names === '1';
      const queue = r.would_move.concat(doNames ? r.name_matches : []);
      let applied = 0, skipped = 0; const appliedSample = [], skippedSample = [];
      for (const m of queue) {
        if (!allowPaid && (m.from_id === 'paid' || m.from_id === 'done' || String(m.from_id).startsWith('inv-')) && m.to_id !== 'paid') { skipped++; if (skippedSample.length < 40) skippedSample.push({ job_id: m.job_id, from: m.from_id, to: m.to_id, why: 'money-side; needs allow_paid' }); continue; }
        try {
          await crud.update(JOBS_TABLE, m.job_id, { office_stage: m.to_id });
          await crud.logEvent('office_stage_set', { job_id: m.job_id, stage: m.to_id, service_state: '', actor: 'meistertask-mirror' });
          applied++; if (appliedSample.length < 60) appliedSample.push({ job_id: m.job_id, to: m.to_id, via: m.via });
        } catch (e) { skipped++; if (skippedSample.length < 40) skippedSample.push({ job_id: m.job_id, why: String((e && e.message) || e) }); }
      }
      report.applied = applied; report.skipped = skipped; report.applied_sample = appliedSample; report.skipped_sample = skippedSample; report.applied_names = doNames; report.allow_paid = allowPaid;
    }

    report.took_ms = Date.now() - started;
    await storeReport(report);
    return { statusCode: 200, body: JSON.stringify({ ok: true, stored: true, mode: report.mode, counts: report.counts, applied: report.applied || 0 }) };
  } catch (e) {
    const err = { ok: false, mode: q.mode || 'diff', error: String((e && e.message) || e), ran_at: new Date().toISOString(), took_ms: Date.now() - started };
    await storeReport({ ...err, counts: {}, move_breakdown: {} });
    return { statusCode: 200, body: JSON.stringify(err) };
  }
};
