// hcp-embed — embed HCP job history into Supabase pgvector (hcp_vectors) so the
// pre-diagnosis layer can semantically recall "this model failed like X, here's
// what we did" across 24k real jobs.
//
// Why pgvector (not Xano): 24k embeddings = 24k bulk writes; bulk Xano writes have
// repeatedly melted it. Vectors live next to the archive, similarity is native+fast.
//
// Resumable grind (cursor in hcp_archive _cursor.data.embed). Batches text to the
// OpenAI embeddings API (text-embedding-3-small, 1536-dim) and inserts the vectors.
// Run docs/hcp-vectors-schema.sql first.
//
//   GET ?secret=<admin>&grind=4    embed N pages (96 jobs/page) from the cursor
//   GET ?secret=<admin>&status=1   embed cursor + count
//   GET ?secret=<admin>&reset=1    reset the embed cursor to page 0 (does NOT wipe vectors)
'use strict';
const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const PAGE = 96; // jobs per page = one OpenAI batch + one Supabase insert
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bodyText(r) {
  const parts = [r.title, r.d, r.n].map((x) => String(x || '').trim()).filter(Boolean);
  return parts.join(' — ').replace(/\s+/g, ' ').slice(0, 2000);
}

async function readCursor() {
  try { const rows = await sb.select('hcp_archive', { kind: 'eq._cursor', limit: 1 }); const c = rows && rows[0]; return { id: c && c.id, data: (c && c.data) || {} }; } catch (_) { return { id: null, data: {} }; }
}
async function writeCursor(cur) {
  if (cur.id) { await sb.update('hcp_archive', { id: 'eq.' + cur.id }, { data: cur.data }); return cur.id; }
  const ins = await sb.insert('hcp_archive', [{ kind: '_cursor', title: 'hcp pull cursor', data: cur.data }], { quiet: false });
  cur.id = ins && ins[0] && ins[0].id; return cur.id;
}

async function embedBatch(apiKey, inputs) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('openai ' + r.status + ': ' + t.slice(0, 160)); }
  const d = await r.json();
  return (d.data || []).map((x) => x.embedding);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const apiKey = await getSecret('OPENAI_API_KEY');
  if (!apiKey) return json(200, { ok: false, error: 'OPENAI_API_KEY not readable (check Functions scope)' });
  if (!(await sb.isConnected())) return json(200, { ok: false, error: 'supabase not configured' });

  const DEFAULT = { last_id: 0, done: false, embedded: 0 };
  if (q.status === '1') {
    const cur = await readCursor();
    return json(200, { ok: true, embed: cur.data.embed || DEFAULT });
  }
  if (q.reset === '1') {
    const cur = await readCursor(); cur.data.embed = { ...DEFAULT }; await writeCursor(cur);
    return json(200, { ok: true, note: 'embed cursor reset (vectors not wiped)' });
  }
  if (q.wipe === '1') {
    try { await sb.del('hcp_vectors', { id: 'gt.0' }); } catch (e) { return json(200, { ok: false, error: 'wipe failed: ' + String(e.message || e) }); }
    const cur = await readCursor(); cur.data.embed = { ...DEFAULT }; await writeCursor(cur);
    return json(200, { ok: true, note: 'hcp_vectors wiped + cursor reset — ready for a clean grind' });
  }

  const cur = await readCursor();
  const st = cur.data.embed || { ...DEFAULT };
  if (st.last_id == null) st.last_id = 0; // migrate from old page-based cursor
  if (st.done && q.force !== '1') return json(200, { ok: true, done: true, embedded: st.embedded, note: 'already done — &force=1 to continue' });

  const grind = Math.max(1, Math.min(8, parseInt(q.grind, 10) || 4));
  let pagesRun = 0, added = 0;
  try {
    for (let i = 0; i < grind; i++) {
      // KEYSET pagination (walk by id) — constant-time, no offset-scan timeout.
      const rows = await sb.select('hcp_archive', { kind: 'eq.job', id: 'gt.' + st.last_id, order: 'id.asc', limit: PAGE, select: 'id,hcp_id,title,d:data->>description,n:data->>notes' });
      if (!rows || !rows.length) { st.done = true; break; }

      const usable = rows.map((r) => ({ hcp_id: r.hcp_id, body: bodyText(r) })).filter((x) => x.body.length >= 4);
      if (usable.length) {
        const vecs = await embedBatch(apiKey, usable.map((u) => u.body));
        const out = usable.map((u, idx) => ({ hcp_id: u.hcp_id, kind: 'job', body: u.body.slice(0, 1000), embedding: '[' + (vecs[idx] || []).join(',') + ']' }));
        await sb.insert('hcp_vectors', out);
        st.embedded = (st.embedded || 0) + out.length; added += out.length;
      }
      st.last_id = rows[rows.length - 1].id; // advance past the whole page (incl. skipped blanks)
      pagesRun++;
      if (rows.length < PAGE) { st.done = true; break; }
      await sleep(120);
    }
  } catch (e) {
    cur.data.embed = st; await writeCursor(cur);
    return json(200, { ok: false, error: String(e.message || e), embedded_total: st.embedded, at_id: st.last_id, note: 'cursor saved — safe to re-run' });
  }
  cur.data.embed = st; await writeCursor(cur);
  return json(200, { ok: true, pages_run: pagesRun, added_this_run: added, embedded_total: st.embedded, at_id: st.last_id, done: !!st.done, next: st.done ? 'complete' : 'repeat &grind=' + grind });
};
