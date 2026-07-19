// Step 2: Facebook redirects here with ?code=... after you approve. We exchange
// the code for a short-lived user token, upgrade it to a long-lived user token,
// pull the Page + its (non-expiring) Page access token, and auto-vault:
//   SOCIAL_FB_PAGE_TOKEN / SOCIAL_FB_PAGE_ID / SOCIAL_FB_PAGE_NAME
//   SOCIAL_IG_USER_ID (if an Instagram Business account is linked)
//   SOCIAL_FB_USER_TOKEN (long-lived, kept for future re-derivation)
// Nothing to paste — the social engine is wired the moment this returns.
//
// Optional override: ?page_id=<id> forces which of your pages to connect (else
// it auto-picks the TN Appliance page).
'use strict';

const { defaultRedirect, graphGet } = require('./_lib/social-fb');
const { getSecretPreferVault, setSecret } = require('./_lib/secrets');

function page(title, inner) {
  return '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530;line-height:1.6">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.error) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' },
      body: page('Facebook returned an error', '<pre>' + JSON.stringify(q, null, 2) + '</pre><p>Start over at <code>/.netlify/functions/social-fb-oauth-start</code>.</p>') };
  }
  const code = q.code;
  if (!code) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' },
      body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/social-fb-oauth-start</code>.</p>') };
  }

  const appId = await getSecretPreferVault('SOCIAL_FB_APP_ID');
  const secret = await getSecretPreferVault('SOCIAL_FB_APP_SECRET');
  if (!appId || !secret) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: page('Not configured', '<p>Add SOCIAL_FB_APP_ID and SOCIAL_FB_APP_SECRET to the vault via admin-secrets.html first.</p>') };
  }

  // 1) code -> short-lived user token
  const t1 = await graphGet('/oauth/access_token', { client_id: appId, redirect_uri: defaultRedirect(), client_secret: secret, code });
  if (!t1.ok || !t1.data.access_token) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
      body: page('Token exchange failed', '<pre>' + JSON.stringify(t1.data, null, 2) + '</pre>') };
  }

  // 2) short-lived -> long-lived user token (~60 days; Page tokens derived from it don't expire)
  const t2 = await graphGet('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: t1.data.access_token });
  const userTok = (t2.ok && t2.data.access_token) ? t2.data.access_token : t1.data.access_token;

  // 3) list pages + their page tokens
  const pg = await graphGet('/me/accounts', { access_token: userTok, fields: 'id,name,access_token,instagram_business_account', limit: 100 });
  const pages = (pg.data && pg.data.data) || [];
  if (!pages.length) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
      body: page('No pages returned', '<p>Facebook granted the login but returned no manageable pages. Make sure you approved the <b>pages</b> permissions and that your account is an admin of the TN Appliance page.</p><pre>' + JSON.stringify(pg.data, null, 2) + '</pre>') };
  }

  // 4) pick the page: explicit ?page_id override, else the TN Appliance one, else first
  const wanted = q.page_id;
  const chosen = (wanted && pages.find((p) => String(p.id) === String(wanted)))
    || pages.find((p) => /tn\s*appliance\s*exchange/i.test(p.name || ''))
    || pages.find((p) => /tn\s*appliance/i.test(p.name || ''))
    || pages[0];

  const pageId = chosen.id;
  const pageTok = chosen.access_token;
  const pageName = chosen.name || '';
  const igId = chosen.instagram_business_account && chosen.instagram_business_account.id;

  // 5) vault everything (the exact keys social-post-generator.js reads)
  const results = {};
  results.token = await setSecret('SOCIAL_FB_PAGE_TOKEN', pageTok || '');
  results.pageId = await setSecret('SOCIAL_FB_PAGE_ID', String(pageId));
  results.pageName = await setSecret('SOCIAL_FB_PAGE_NAME', pageName);
  results.userTok = await setSecret('SOCIAL_FB_USER_TOKEN', userTok);
  if (igId) results.ig = await setSecret('SOCIAL_IG_USER_ID', String(igId));

  const others = pages.filter((p) => String(p.id) !== String(pageId));
  const otherList = others.length
    ? '<p style="color:#5b6573;font-size:14px">Other pages on your account (not connected): '
      + others.map((p) => escapeHtml(p.name) + ' <span style="color:#9aa">(' + p.id + ')</span>').join(' · ')
      + '.<br>Wrong page? Re-run <code>/.netlify/functions/social-fb-oauth-start</code> then add <code>?page_id=THE_ID</code> to the callback.</p>'
    : '';

  const okAll = results.token && results.pageId;
  return {
    statusCode: 200, headers: { 'Content-Type': 'text/html' },
    body: page(okAll ? '✅ Facebook connected' : '⚠️ Connected, but a vault write failed',
      '<p><b>Connected page:</b> ' + escapeHtml(pageName) + ' <span style="color:#9aa">(' + pageId + ')</span></p>'
      + '<p><b>Instagram:</b> ' + (igId ? 'linked ✅ (' + igId + ')' : 'not linked (fine — Facebook posting still works)') + '</p>'
      + '<p><b>Page access token:</b> ' + (results.token ? 'vaulted ✅ (long-lived)' : 'FAILED to vault ❌') + '</p>'
      + (okAll
          ? '<p style="margin-top:18px">That\'s it — the social engine is wired. Nothing else to do here. Tell Claude "connected" and he\'ll pull your video catalog and stage the campaign.</p>'
          : '<p style="color:#b23">One or more values didn\'t persist. Re-run the start link, or tell Claude which failed.</p>')
      + otherList),
  };
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
