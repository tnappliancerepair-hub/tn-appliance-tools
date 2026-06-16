const { getSecret } = require('./_lib/secrets');
// Embedding endpoint scaffold. POST {text, source_table?, source_row_id?,
// company_id?, namespace?}. Returns 1536-dim float[] (text-embedding-3-small).
//
// ENV: OPENAI_API_KEY required. Falls back to dummy-embedding when unset
// so the pipeline doesn't crash during scaffold-only mode.
const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const text = String(body.text || '').trim();
  if (!text) return jsonResp(400, { ok: false, error: 'text required' });

  const key = await getSecret('OPENAI_API_KEY');
  let embedding, model;

  if (!key) {
    // Dummy 1536-dim deterministic embedding from text hash — keeps the pipeline
    // testable without OpenAI billing. Replace once OPENAI_API_KEY is set.
    embedding = dummyEmbedding(text);
    model = 'dummy-1536';
  } else {
    try {
      const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text.slice(0, 8000),
          model: 'text-embedding-3-small',
        }),
      });
      const data = await resp.json();
      embedding = (data && data.data && data.data[0] && data.data[0].embedding) || [];
      model = 'text-embedding-3-small';
      if (!embedding.length) return jsonResp(500, { ok: false, error: 'no_embedding_returned', raw: data });
    } catch (err) {
      return jsonResp(500, { ok: false, error: err.message });
    }
  }

  // Persist to embeddings table if source supplied
  const sourceTable = String(body.source_table || '').trim();
  const sourceRowId = Number(body.source_row_id || 0);
  const companyId = Number(body.company_id || 1);
  const namespace = String(body.namespace || 'general').trim();
  let persisted = null;

  if (sourceTable && sourceRowId) {
    try {
      const persistResp = await fetch(`${XANO_INTAKE}/save_embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          namespace,
          source_table: sourceTable,
          source_row_id: sourceRowId,
          content_preview: text.slice(0, 500),
          embedding_json: JSON.stringify(embedding),
          embedding_model: model,
        }),
      });
      persisted = await persistResp.json();
    } catch (err) {
      console.warn('[embed-text] save failed:', err.message);
    }
  }

  return jsonResp(200, {
    ok: true,
    embedding_length: embedding.length,
    model,
    persisted: persisted && persisted.success ? persisted.row_id : null,
    placeholder: !key,
  });
};

// Deterministic dummy embedding — sum of char codes mapped to sine waves.
// Lets retrieval work for testing even without OpenAI key.
function dummyEmbedding(text) {
  const dim = 1536;
  const out = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    for (let j = 0; j < dim; j++) {
      out[j] += Math.sin((c + j) * 0.0137) * 0.001;
    }
  }
  // Normalize
  let norm = Math.sqrt(out.reduce((a, x) => a + x * x, 0)) || 1;
  return out.map(x => x / norm);
}

function jsonResp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
