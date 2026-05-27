// Semantic retrieval over the embeddings table. POST {query, company_id?,
// namespace?, top_k?}.
// Flow:
//   1. Embed the query via OpenAI (or dummy)
//   2. Pull ALL embeddings for company_id+namespace from Xano (capped)
//   3. Compute cosine similarity client-side here, sort, return top_k
//
// Trade-off: pulling all embeddings is fine up to ~10k rows. Beyond that,
// move to a real vector DB (Pinecone/Qdrant).
const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const query = String(body.query || '').trim();
  if (!query) return jsonResp(400, { ok: false, error: 'query required' });

  const companyId = Number(body.company_id || 1);
  const namespace = String(body.namespace || 'general').trim();
  const topK = Math.min(Number(body.top_k || 5), 20);

  // 1. Embed the query
  let queryEmbedding = null;
  try {
    const embResp = await fetch(`https://tnapplianceexchange.net/.netlify/functions/embed-text`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ text: query }),
    });
    const embData = await embResp.json();
    if (!embData.ok) throw new Error(embData.error || 'embed failed');
    // The embed-text function doesn't return the actual vector in the response (only length).
    // So we need to either: (a) modify embed-text to return the vector when no persist target, or
    // (b) call OpenAI directly here. Doing (b) for clarity.
  } catch (err) {
    // fall through to direct call
  }

  // Direct OpenAI call for query (or dummy)
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: query.slice(0, 4000), model: 'text-embedding-3-small' }),
      });
      const data = await resp.json();
      queryEmbedding = (data && data.data && data.data[0] && data.data[0].embedding) || null;
    } catch (err) {
      return jsonResp(500, { ok: false, error: 'embed_failed: ' + err.message });
    }
  } else {
    queryEmbedding = dummyEmbedding(query);
  }

  if (!queryEmbedding || queryEmbedding.length === 0) {
    return jsonResp(500, { ok: false, error: 'no query embedding' });
  }

  // 2. Pull stored embeddings
  let rows = [];
  try {
    const xresp = await fetch(`${XANO_INTAKE}/list_embeddings?company_id=${companyId}&namespace=${encodeURIComponent(namespace)}`);
    const xdata = await xresp.json();
    rows = (xdata && xdata.embeddings) || [];
  } catch (err) {
    return jsonResp(500, { ok: false, error: 'xano fetch failed: ' + err.message });
  }

  if (rows.length === 0) {
    return jsonResp(200, { ok: true, query, results: [], note: 'no embeddings indexed yet' });
  }

  // 3. Compute cosine similarity + sort + slice
  const scored = rows.map(r => {
    let vec;
    try { vec = JSON.parse(r.embedding_json || '[]'); } catch { vec = []; }
    return { ...r, score: cosineSim(queryEmbedding, vec) };
  }).sort((a, b) => b.score - a.score).slice(0, topK);

  return jsonResp(200, {
    ok: true,
    query,
    results: scored.map(r => ({
      score: r.score,
      preview: r.content_preview,
      source_table: r.source_table,
      source_row_id: r.source_row_id,
      created_at: r.created_at,
    })),
  });
};

function cosineSim(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function dummyEmbedding(text) {
  const dim = 1536;
  const out = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    for (let j = 0; j < dim; j++) out[j] += Math.sin((c + j) * 0.0137) * 0.001;
  }
  const norm = Math.sqrt(out.reduce((a, x) => a + x * x, 0)) || 1;
  return out.map(x => x / norm);
}

function jsonResp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
