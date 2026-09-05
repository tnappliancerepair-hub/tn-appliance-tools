// Meta (Facebook/Instagram) Marketing API connector — the PAID arm for reaching
// SHOP OWNERS with the AssistAnt pitch (Meta is where you can target by AUDIENCE:
// small-business owners + the trades, which Google can't). Mirrors _lib/openai-ads.js
// + _lib/google-ads.js. Reuses the same Graph base + our vaulted FB app creds; the
// ad calls just need an ads-capable token + an ad-account id.
//
// Vault keys (set via admin-secrets.html once Teddy has an ad account + ads token):
//   META_AD_ACCOUNT_ID   the ad account, digits only or act_<digits> (Ads Manager → Settings)
//   META_ADS_TOKEN       a token with ads_management (falls back to SOCIAL_FB_USER_TOKEN)
//   META_PAGE_ID         the Page the ad runs under (falls back to SOCIAL_FB_PAGE_ID)
//
// Built DARK: every reader returns { configured:false } cleanly until the account +
// token are vaulted, so nothing throws and nothing spends before Teddy launches.
'use strict';
const { getSecretPreferVault, getSecret } = require('./secrets');
const { graphGet, graphPost, GRAPH } = require('./social-fb');

async function creds() {
  const [acct, token, pageId] = await Promise.all([
    getSecretPreferVault('META_AD_ACCOUNT_ID'),
    getSecretPreferVault('META_ADS_TOKEN'),
    getSecretPreferVault('META_PAGE_ID'),
  ]);
  const tok = (token || (await getSecret('SOCIAL_FB_USER_TOKEN')) || (await getSecret('SOCIAL_FB_PAGE_TOKEN')) || '').trim();
  const pg = (pageId || (await getSecret('SOCIAL_FB_PAGE_ID')) || '').trim();
  const raw = String(acct || '').trim().replace(/^act_/, '');
  return { acct: raw, act: raw ? 'act_' + raw : '', token: tok, pageId: pg };
}

// Bounded Marketing API call. graphGet/graphPost already never throw; we add the token.
async function api(method, path, params, token) {
  if (String(method).toUpperCase() === 'GET') return graphGet(path, Object.assign({ access_token: token }, params || {}));
  return graphPost(path, Object.assign({ access_token: token }, params || {}));
}

// The simplest authorized call — proves the token + account work (mirrors
// openai-ads.configured / google-ads.listAccessibleCustomers).
async function configured() {
  const c = await creds();
  const missing = [];
  if (!c.acct) missing.push('META_AD_ACCOUNT_ID');
  if (!c.token) missing.push('META_ADS_TOKEN (or SOCIAL_FB_USER_TOKEN)');
  if (missing.length) return { ok: false, configured: false, missing };
  const res = await api('GET', `/${c.act}`, { fields: 'name,account_status,currency,amount_spent,disable_reason' }, c.token);
  return {
    ok: res.ok, configured: !!res.ok, status: res.status,
    account: res.ok ? res.data : null,
    has_page: !!c.pageId,
    error: res.ok ? null : ((res.data && res.data.error && (res.data.error.message || res.data.error)) || res.data),
  };
}

// Targeting Search — resolve interest/behavior IDs by name (used to tune the audience
// on the first real apply, same first-real-tuning discipline as the other adapters).
//   type: 'adinterest' | 'adTargetingCategory'(behaviors via class=behaviors)
async function searchTargeting(q, token, type) {
  const path = '/search';
  const params = { type: type || 'adinterest', q, limit: 15 };
  const res = await api('GET', path, params, token);
  return res.ok ? (res.data && res.data.data) || [] : [];
}

module.exports = { creds, api, configured, searchTargeting, GRAPH };
