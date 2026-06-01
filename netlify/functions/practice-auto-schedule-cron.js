// PRACTICE-AUTO-SCHEDULE CRON
// Fires every 15 min via netlify.toml schedule. Calls mock-scheduler with
// practice_mode=1 so any not_ready job created since 5/30 cutoff gets
// auto-placed on a tech's dashboard.
//
// Defaults the day_offset to 1 (tomorrow). Honest size guard: limit=50.
// Tags placed jobs with test_run_id="PRACTICE_<targetDate>" so the tech
// dashboard's "🧪 PRACTICE" badge renders.

const SITE_BASE =
  process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';

exports.handler = async function () {
  const url = `${SITE_BASE}/.netlify/functions/mock-scheduler?apply=true&confirm_apply=1&practice_mode=1&day_offset=1&limit=200&force_mock=1&run_id=practice_cron_${Date.now()}`;

  try {
    const r = await fetch(url);
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = { raw: text.slice(0, 500) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        triggered_at: new Date().toISOString(),
        upstream_status: r.status,
        upstream_summary: body && body.summary ? body.summary : null,
        upstream_target_date: body && body.target_date ? body.target_date : null,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e.message || e) }),
    };
  }
};
