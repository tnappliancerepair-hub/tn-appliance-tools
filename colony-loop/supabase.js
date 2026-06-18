// supabase.js (colony-loop ESM mirror of netlify/functions/_lib/supabase.js)
//
// The loop is the single biggest event_log writer. Pointing its audit writes at
// Supabase is where the real Xano relief comes from. ESM (the loop is
// type:module), dependency-free PostgREST over fetch.
//
// Creds come from process.env (config.js loads colony-loop/.env into process.env),
// so the loop reads them WITHOUT touching Xano's metadata API — the whole point.
// Add to colony-loop/.env:
//   SUPABASE_URL=https://<ref>.supabase.co
//   SUPABASE_SERVICE_KEY=sb_secret_...
//
// Activation is gated by SUPABASE_DUAL_WRITE in the loop (see xano.js recordEvent).

function cfg() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: String(process.env.SUPABASE_SERVICE_KEY || ''),
  };
}

export function isConfigured() {
  const c = cfg();
  return !!(c.url && c.key);
}

function headers(c, extra) {
  return {
    apikey: c.key,
    Authorization: 'Bearer ' + c.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(extra || {}),
  };
}

export async function insert(table, rows, { quiet = true } = {}) {
  const c = cfg();
  if (!c.url || !c.key) throw new Error('supabase_not_configured');
  const body = Array.isArray(rows) ? rows : [rows];
  const r = await fetch(`${c.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(c, { Prefer: quiet ? 'return=minimal' : 'return=representation' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`supabase insert ${table} -> ${r.status}: ${String(t).slice(0, 200)}`);
  }
  return quiet ? { ok: true, count: body.length } : r.json();
}

// recordEvent — event_log writer mirroring the Xano row shape. Best-effort:
// never throws into the loop's hot path (an audit write must not break a tick).
export async function recordEvent(row) {
  try {
    if (!isConfigured()) return { ok: false, skipped: 'not_configured' };
    await insert('event_log', {
      action: String(row.action || ''),
      job_id: row.job_id != null ? Number(row.job_id) : null,
      customer_id: row.customer_id != null ? Number(row.customer_id) : null,
      technician_id: row.technician_id != null ? Number(row.technician_id) : null,
      company_id: row.company_id != null ? Number(row.company_id) : 1,
      metadata: row.metadata != null ? row.metadata : {},
      source: row.source || 'loop',
    });
    return { ok: true };
  } catch (err) {
    // swallow — the loop must keep ticking even if Supabase hiccups
    return { ok: false, error: String(err.message || err) };
  }
}

export default { isConfigured, insert, recordEvent };
