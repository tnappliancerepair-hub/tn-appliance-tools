// Given a job_id, returns top-N semantically similar prior jobs based on
// TDR embeddings. Used by tech-ant-live "Similar jobs" panel.
//
// Flow: pull the current job's TDR text → embed → cosine sim against
// all TDR embeddings → return top matches with job context.

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const jobId = Number(body.job_id || 0);
  const topK = Math.min(Number(body.top_k || 5), 10);
  if (!jobId) return jsonResp(400, { ok: false, error: 'job_id required' });

  // Pull job + appliance context as the seed text
  let job = null;
  try {
    const r = await fetch(`${XANO_INTAKE}/get_job?job_id=${jobId}`);
    job = await r.json();
  } catch (err) {
    return jsonResp(500, { ok: false, error: 'job fetch failed' });
  }
  if (!job || !job.id) return jsonResp(404, { ok: false, error: 'job not found' });

  const seedText = [
    job.brand, job.appliance_type, job.model_number, job.problem_summary,
  ].filter(Boolean).join(' ');
  if (!seedText.trim()) return jsonResp(200, { ok: true, results: [], note: 'no seed text on job' });

  // Run semantic search
  try {
    const r = await fetch('https://tnapplianceexchange.net/.netlify/functions/ask-ant-semantic', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: seedText, namespace: 'tdr', top_k: topK + 1 }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'semantic failed');
    // Drop the current job from results (it may match itself if indexed)
    const filtered = (d.results || []).filter(x => Number(x.source_row_id) !== jobId).slice(0, topK);
    return jsonResp(200, { ok: true, seed_text: seedText, results: filtered });
  } catch (err) {
    return jsonResp(500, { ok: false, error: err.message });
  }
};

function jsonResp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
