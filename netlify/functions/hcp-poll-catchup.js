// HCP poll catchup — runs every 15 min as a Netlify scheduled function.
//
// Bridges the gap until HCP_POLL_ENABLED env var is set to "true" in
// Xano. The hcp_poll_recent_jobs endpoint short-circuits when that flag
// is unset, so the in-Xano scheduled task does nothing. This function
// calls the endpoint with override_enabled=true which bypasses the gate
// + ingests any new HCP jobs into Xano.
//
// Caught 8 missing jobs on first manual run 2026-06-02 (Ray Gedert,
// Donald Thompson, Victor Brumfield, William Brent, Donna Barnes + 3
// others). Coverage went from 20% to 100% in one run.
//
// Schedule (in netlify.toml):
//   schedule = "*/15 * * * *"
//
// Disable by setting HCP_POLL_ENABLED=true in Xano env vars (the in-Xano
// scheduled task takes over and this becomes a redundant safety net),
// then optionally remove the schedule entry here.

const XANO_HCP_POLL =
  'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_poll_recent_jobs';
const TIMEOUT_MS = 25000;

exports.handler = async function () {
  const startedAt = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(XANO_HCP_POLL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override_enabled: true }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    const elapsed = Date.now() - startedAt;
    console.log('[hcp-poll-catchup] status', res.status, 'elapsed', elapsed, 'ms', JSON.stringify({
      jobs_fetched: j.jobs_fetched,
      jobs_inserted: j.jobs_inserted,
      jobs_updated: j.jobs_updated,
      errors_count: j.errors_count,
    }));
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: res.ok,
        elapsed_ms: elapsed,
        result: j,
      }),
    };
  } catch (err) {
    clearTimeout(t);
    console.warn('[hcp-poll-catchup] failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
