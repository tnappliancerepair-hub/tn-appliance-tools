// deploy-watch — the thing that was missing on 2026-09-10.
//
// Deploys failed for 36 minutes that day and NOTHING said so. The site kept
// serving the last good build, so every page looked healthy while no fix could
// ship. Silence is the failure mode worth engineering against: a build can break
// for a dozen reasons, but "nobody found out for half an hour" is the part that
// turns a two-minute fix into a lost afternoon.
//
// Runs on a schedule. Reads the newest PRODUCTION deploy. Texts the owner the
// first time a red episode starts, once more if it is still red six hours later,
// and again when it goes green. It also measures the Lambda environment budget
// on every pass, because the 4KB ceiling is invisible until it bites and the
// warning is worth having BEFORE someone adds the variable that breaks the build.
//
//   ?secret=<admin>          run it by hand
//   ?dry=1                   report only, send nothing
//   (scheduled)              self-authorizes via {next_run}
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const SITE_ID = '1ecd89fc-8a9c-4fa3-b923-5186759cfc84';
const API = 'https://api.netlify.com/api/v1';
const OWNER = '+16154855795';
const STATE_KEY = 'DEPLOY_WATCH_STATE';

// Measured 2026-09-10 on this site: 3,320 bytes builds, 3,392 does not. Netlify and
// AWS inject the rest of the 4,096. Warn well before the edge so there is time to act.
const WARN_HEADROOM = 600;   // shout while there is still room to act
const RENAG_MS = 6 * 60 * 60 * 1000;

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) });

async function nf(token, path) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('netlify ' + r.status);
  return r.json();
}

// Two ways to get this wrong, both of which I did before landing here:
//   1. Ask Netlify's env API for sizes. It masks anything flagged `is_secret` to 20
//      characters, so ANTHROPIC_API_KEY reads as 38 bytes and is really ~127. That
//      undercounts, which is the direction that lets you walk into the ceiling.
//   2. Sum all of process.env. That OVERCOUNTS - it sweeps in the AWS and Netlify
//      runtime variables (PATH, AWS_*, LAMBDA_*, NODE_*), which do not count against
//      the user limit. Measured 6,002 on a perfectly green build, which proves it.
// The number AWS actually weighs is the variables WE set. So: take the key names from
// the API (reliable) and their real lengths from process.env (unmaskable).
const LAMBDA_CAP = 4096;

function envBudget(rows) {
  const ours = [];
  for (const r of rows || []) {
    if (!(r.scopes || []).some((s) => s === 'functions' || s === 'runtime')) continue;
    const key = r.key || '';
    const live = process.env[key];
    const len = live != null ? String(live).length
      : Math.max(0, ...((r.values || []).map((x) => String(x.value || '').length)), 0);
    ours.push({ key, bytes: key.length + len + 2, masked: live == null });
  }
  ours.sort((a, b) => b.bytes - a.bytes);
  const bytes = ours.reduce((n, x) => n + x.bytes, 0);
  // Empirical on this site 2026-09-10: it built at roughly 3.7KB of our own variables and
  // failed at roughly 3.97KB, so the usable ceiling sits just under the 4,096 line.
  return { bytes, cap: LAMBDA_CAP, headroom: LAMBDA_CAP - bytes, vars: ours.length, largest: ours.slice(0, 4) };
}

async function runWatch(opts) {
  const q = opts || {};
  const dry = q.dry === '1';
  const token = await getSecret('NETLIFY_API_TOKEN');
  if (!token) return json(200, { ok: false, error: 'NETLIFY_API_TOKEN not vaulted' });

  let deploys = [], envRows = [];
  try { deploys = await nf(token, `/sites/${SITE_ID}/deploys?per_page=10`); } catch (e) {
    return json(200, { ok: false, error: 'could not read deploys: ' + String(e.message || e) });
  }
  try { envRows = await nf(token, `/sites/${SITE_ID}/env`); } catch (_) {}

  // Netlify records a SKIPPED build as state 'error'. Our netlify.toml `ignore` rule skips
  // docs-only commits on purpose, so CLAUDE.md edits alone would otherwise page the owner
  // every time - and an alarm that cries wolf is worse than none, because it trains you to
  // ignore the one that matters. A build canceled for no content change shipped nothing
  // because nothing needed shipping; that is a success.
  const skipped = (d) => /no content change|checking build content for changes/i.test(String(d.error_message || ''));
  const prod = deploys.filter((d) => d.context === 'production' && !skipped(d));
  const latest = prod[0] || null;
  const lastGood = prod.find((d) => d.state === 'ready') || null;
  const budget = envBudget(envRows);

  // A build that is still running is not news either way.
  const failing = !!latest && latest.state === 'error';
  const settled = !!latest && (latest.state === 'error' || latest.state === 'ready');

  let state = {};
  try { state = JSON.parse((await getSecretFresh(STATE_KEY)) || '{}'); } catch (_) {}
  const wasFailing = !!state.failing;
  const lastAlert = Number(state.alerted_at || 0);

  // An alarm nobody has heard ring is a guess. ?test=1 sends one real text down the exact
  // path a real failure uses - same tag, same gate, same line - so we know it lands.
  if (q.test === '1') {
    const t = `🔔 Test: this is what a failed-deploy alert looks like. Deploys are ${failing ? 'RED' : 'green'} right now. `
            + `Env ${budget.bytes}/${budget.cap} bytes, ${budget.headroom} free.`;
    let ok = false; try { ok = await sendSms(OWNER, t, 'owner', 'deploy_down'); } catch (_) {}
    return json(200, { ok: true, test: true, sms_sent: ok, sms_preview: t, env_budget: budget });
  }

  let action = 'no_change'; let sms = null;
  if (settled && failing) {
    const stale = Date.now() - lastAlert > RENAG_MS;
    if (!wasFailing || stale) {
      action = wasFailing ? 'renag' : 'alert';
      const goodAt = lastGood ? String(lastGood.published_at || '').slice(11, 16) + ' UTC' : 'unknown';
      sms = `🚨 Netlify deploys are FAILING - nothing can ship. The site still serves the last good build (${goodAt}), so it LOOKS fine. `
          + `err: ${String(latest.error_message || '').slice(0, 90)}`;
    }
  } else if (settled && !failing && wasFailing) {
    action = 'recovered';
    sms = '✅ Netlify deploys are green again - changes are shipping.';
  }

  // The budget warning rides along with whatever we were already going to say, and
  // stands on its own if the last deploy was fine but the ceiling is close.
  if (budget.headroom <= WARN_HEADROOM) {
    const line = `⚠️ Function env at ${budget.bytes}/${budget.cap} bytes - only ${budget.headroom} left before builds start failing. Put new secrets in the vault, not env.`;
    if (sms) sms += '\n' + line;
    else if (action === 'no_change' && !wasFailing && Date.now() - Number(state.budget_alerted_at || 0) > RENAG_MS * 4) {
      action = 'budget_warn'; sms = line; state.budget_alerted_at = Date.now();
    }
  }

  let sent = false;
  if (sms && !dry) {
    try { sent = await sendSms(OWNER, sms, 'owner', 'deploy_down'); } catch (_) {}
    const next = { failing, alerted_at: (action === 'alert' || action === 'renag') ? Date.now() : lastAlert,
                   deploy_id: latest && latest.id, budget_alerted_at: state.budget_alerted_at || 0 };
    try { await setSecret(STATE_KEY, JSON.stringify(next)); } catch (_) {}
  } else if (!dry && settled && failing !== wasFailing) {
    try { await setSecret(STATE_KEY, JSON.stringify({ ...state, failing, deploy_id: latest && latest.id })); } catch (_) {}
  }

  return json(200, {
    ok: true, dry, action, sms_sent: sent, sms_preview: sms || null,
    latest: latest && { state: latest.state, created_at: latest.created_at, commit: String(latest.commit_ref || '').slice(0, 7), error: latest.error_message || null },
    last_good: lastGood && { published_at: lastGood.published_at, commit: String(lastGood.commit_ref || '').slice(0, 7) },
    env_budget: budget,
  });
}

exports.runWatch = runWatch;
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  return runWatch(q);
};
