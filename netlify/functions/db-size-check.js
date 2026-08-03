// db-size-check.js — owner-gated DB introspection so we can watch the ANT OPS
// Supabase project's table sizes + row counts + autovacuum health WITHOUT SQL-editor
// screenshots. Powers cleanup decisions + the pre-Phase-2 "is this project lean
// enough for the queue?" check.  GET ?secret=<admin>
//
// Requires the read-only SECURITY DEFINER function from docs/sql/002_db_sizes.sql.
'use strict';
const sb = require('./_lib/supabase');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function humanBytes(n) {
  n = Number(n) || 0; const u = ['B', 'kB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (!(await sb.isConnected())) {
    return json(200, { ok: false, error: 'supabase_not_configured', next: 'vault SUPABASE_URL + SUPABASE_SERVICE_KEY' });
  }

  try {
    const rows = await sb.rpc('ant_db_sizes');
    const list = Array.isArray(rows) ? rows : [];
    const total = list.reduce((s, r) => s + Number(r.total_bytes || 0), 0);
    const tables = list.map((r) => ({
      table: r.table_name,
      size: r.size,
      total_bytes: Number(r.total_bytes || 0),
      live_rows: Number(r.live_rows || 0),
      dead_rows: Number(r.dead_rows || 0),
      last_autovacuum: r.last_autovacuum || null,
    }));
    // Flag any table carrying heavy dead-tuple bloat (autovacuum falling behind).
    const bloated = tables.filter((t) => t.dead_rows > 0 && t.dead_rows > t.live_rows).map((t) => t.table);
    return json(200, {
      ok: true,
      table_count: tables.length,
      total_size: humanBytes(total),
      total_bytes: total,
      bloat_watch: bloated,     // tables where dead>live — autovacuum behind
      tables,
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const missing = /ant_db_sizes|does not exist|PGRST202|404/.test(msg);
    return json(200, {
      ok: false,
      error: msg,
      next: missing ? 'run docs/sql/002_db_sizes.sql in the ANT OPS SQL editor (creates the ant_db_sizes function)' : undefined,
    });
  }
};
