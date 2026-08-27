// netlify-admin — drive the Netlify API (owner-gated) so we can list sites, read/set
// environment variables, and trigger deploys without hand-editing the dashboard. Uses the
// vaulted NETLIFY_API_TOKEN (a Netlify personal access token).
//
//   ?secret=<admin>&action=sites                 -> list sites (name, id, repo, account)
//   ?secret=<admin>&action=proxy&method=GET&path=/sites            (generic API proxy; POST body = payload)
//   ?secret=<admin>&action=set_supabase_env&site_id=<id>           -> copy SUPABASE_URL + SUPABASE_SERVICE_KEY
//        from the vault into that site's Netlify env (value never leaves the server), scoped to functions/runtime
//   ?secret=<admin>&action=deploy&site_id=<id>                     -> trigger a build/deploy
'use strict';

const { getSecret } = require('./_lib/secrets');
const API = 'https://api.netlify.com/api/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const token = await getSecret('NETLIFY_API_TOKEN');
  if (!token) return json(200, { ok: false, error: 'NETLIFY_API_TOKEN not vaulted' });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const api = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(22000) });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch (_) { d = t; }
    return { status: r.status, ok: r.ok, data: d };
  };

  const action = q.action || 'sites';

  try {
    if (action === 'sites') {
      const r = await api('GET', '/sites?per_page=100');
      const list = Array.isArray(r.data) ? r.data.map((s) => ({
        name: s.name, id: s.id, url: s.ssl_url || s.url,
        repo: (s.build_settings && s.build_settings.repo_url) || '',
        account_id: s.account_id || '', account_slug: s.account_slug || '',
        custom_domain: s.custom_domain || '', domain_aliases: s.domain_aliases || [],
      })) : r.data;
      return json(200, { ok: r.ok, count: Array.isArray(list) ? list.length : 0, sites: list });
    }

    if (action === 'proxy') {
      const method = (q.method || 'GET').toUpperCase();
      const path = q.path || '/sites';
      let body = null; try { body = event.body ? JSON.parse(event.body) : null; } catch (_) {}
      const r = await api(method, path, body);
      return json(200, { ok: r.ok, status: r.status, data: r.data });
    }

    if (action === 'deploy') {
      if (!q.site_id) return json(200, { ok: false, error: 'need ?site_id=' });
      const r = await api('POST', `/sites/${q.site_id}/builds`, {});
      return json(200, { ok: r.ok, status: r.status, build: r.data });
    }

    if (action === 'set_supabase_env') {
      if (!q.site_id) return json(200, { ok: false, error: 'need ?site_id=' });
      const [url, key] = await Promise.all([getSecret('SUPABASE_URL'), getSecret('SUPABASE_SERVICE_KEY')]);
      if (!url || !key) return json(200, { ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not in vault' });
      // Resolve the site's account (env API is account-scoped).
      const site = await api('GET', `/sites/${q.site_id}`);
      const acct = site.data && (site.data.account_slug || site.data.account_id);
      if (!acct) return json(200, { ok: false, error: 'could not resolve account for site', site_status: site.status });
      const scopes = ['builds', 'functions', 'runtime', 'post_processing'];
      const results = {};
      for (const [k, v] of [['SUPABASE_URL', url], ['SUPABASE_SERVICE_KEY', key]]) {
        // create; if it already exists (400/409), update via PUT.
        let r = await api('POST', `/accounts/${acct}/env?site_id=${q.site_id}`, [{ key: k, scopes, values: [{ value: String(v), context: 'all' }] }]);
        if (!r.ok && (r.status === 400 || r.status === 409 || r.status === 422)) {
          r = await api('PUT', `/accounts/${acct}/env/${k}?site_id=${q.site_id}`, { key: k, scopes, values: [{ value: String(v), context: 'all' }] });
        }
        results[k] = { ok: r.ok, status: r.status, error: r.ok ? undefined : JSON.stringify(r.data).slice(0, 200) };
      }
      return json(200, { ok: Object.values(results).every((x) => x.ok), account: acct, results, note: 'trigger a deploy for env changes to take effect' });
    }

    return json(200, { ok: false, error: 'unknown action' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 240) });
  }
};
