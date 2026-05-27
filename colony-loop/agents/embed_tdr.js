// Handles EMBED_TDR signals (emitted by job_completed.js for every
// completed job). Pulls the latest tech-authored TDR, builds searchable
// text, calls embed-text Netlify fn which persists to the embeddings
// table under namespace='tdr'.
//
// Skipped when TDR is empty or only has Teddy pre-diagnosis (no
// tech-authored content yet).
import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const technicianId = Number(payload.technician_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', { outcome: 'skipped_missing_job_id' });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  // Fetch TDR via the existing dashboard endpoint
  let job = null;
  try {
    const res = await fetch(`${config.xanoIntakeBase}/get_job_for_dashboard`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ job_id: jobId }),
    });
    const data = await res.json();
    job = data && data.tdr;
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', { outcome: 'fetch_failed', error: String(err.message || err) });
    return { success: false, action: 'fetch_failed' };
  }

  if (!job) {
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', { outcome: 'no_tdr' });
    return { success: true, action: 'no_tdr' };
  }

  // Build searchable text from TDR fields
  const parts = [
    job.diagnosis, job.failure_cause, job.failed_component,
    job.repair_completed, job.verified_part_number, job.technician_notes,
  ].filter(p => p && String(p).trim().length > 0);

  if (parts.length === 0) {
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', { outcome: 'tdr_empty' });
    return { success: true, action: 'tdr_empty' };
  }

  const text = parts.join(' | ');

  // POST to embed-text Netlify function
  try {
    const res = await fetch(`${config.netlifyFunctionsBase}/embed-text`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        text,
        source_table: 'technician_decision_report',
        source_row_id: job.id || jobId,
        company_id: config.companyId || 1,
        namespace: 'tdr',
      }),
    });
    const d = await res.json();
    const meta = {
      job_id: jobId,
      tdr_id: job.id || null,
      outcome: d.ok ? 'embedded' : 'embed_failed',
      placeholder: d.placeholder || false,
      char_count: text.length,
    };
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', meta);
    log('embed_tdr_handled', meta);
    return { success: true, action: meta.outcome };
  } catch (err) {
    log('embed_tdr_fn_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'embed_tdr_handled', { outcome: 'fn_call_failed' });
    return { success: false, action: 'fn_call_failed' };
  }
}
