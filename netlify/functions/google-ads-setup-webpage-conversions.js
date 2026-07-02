// google-ads-setup-webpage-conversions — create CLIENT-SIDE (gtag) conversion
// actions and pull their tag snippets, so the intake page can fire a conversion
// the moment a job books / a Quick Check is paid — WITHOUT the deprecated offline
// UploadClickConversions API (which Google now blocks for new accounts).
//
// Creates two WEBPAGE conversion actions in the Ads account:
//   • "Ant — Booked (web)"  SUBMIT_LEAD_FORM  -> fired on self-pay job creation
//   • "Ant — Cash Paid (web)" PURCHASE (value) -> fired on the Stripe thank-you page
// Then reads each action's tag_snippets to extract the gtag id (AW-XXXX) + label
// and vaults them so the page (and a config endpoint) can serve the send_to values.
//
//   GET ?secret=<admin>[&cid=9267688121]        preview (writes nothing)
//   GET ?secret=<admin>&apply=1[&cid=...]        create them, read snippets, vault
//   GET ?secret=<admin>&link=1[&cid=...]         re-read snippets for existing actions + vault
'use strict';
const { getSecret, setSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const ACTIONS = [
  { key: 'BOOKED', name: 'Ant — Booked (web)', category: 'SUBMIT_LEAD_FORM', vault: 'GOOGLE_ADS_WEB_BOOKED_SENDTO' },
  { key: 'PAID', name: 'Ant — Cash Paid (web)', category: 'PURCHASE', vault: 'GOOGLE_ADS_WEB_PAID_SENDTO' },
];

// pull "AW-123456789/AbC-dEf" out of an event snippet's send_to
function parseSendTo(snippetText) {
  const m = String(snippetText || '').match(/AW-\d+\/[\w-]+/);
  return m ? m[0] : null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const ver = c.version;
  const cid = String(q.cid || '9267688121').replace(/\D/g, '');
  const apply = q.apply === '1';
  const linkOnly = q.link === '1';

  const search = `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`;
  const mutate = `https://googleads.googleapis.com/${ver}/customers/${cid}/conversionActions:mutate`;

  // helper that retries via the manager on a 403 (cross-account)
  async function call(url, body) {
    let r, d;
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    return { ok: r.ok, http: r.status, d };
  }

  // read every conversion action's snippets (used by both apply + link paths)
  async function readSnippets() {
    const gaql = 'SELECT conversion_action.resource_name, conversion_action.name, conversion_action.id, conversion_action.type, conversion_action.tag_snippets FROM conversion_action';
    const res = await call(search, { query: gaql });
    if (!res.ok) return { ok: false, http: res.http, error: (res.d && res.d.error && (res.d.error.message || res.d.error.status)) || res.error || res.d };
    return { ok: true, rows: res.d.results || [] };
  }

  // map our two actions -> their send_to (AW-id/label), given account rows
  function extractSendTos(rows) {
    const found = {};
    for (const a of ACTIONS) {
      const hit = rows.find((x) => x.conversionAction && x.conversionAction.name === a.name);
      if (!hit) continue;
      const snips = (hit.conversionAction.tagSnippets || []);
      let sendTo = null;
      for (const s of snips) { sendTo = parseSendTo(s.eventSnippet) || parseSendTo(s.globalSiteTag); if (sendTo) break; }
      found[a.key] = { name: a.name, resource: hit.conversionAction.resourceName, id: hit.conversionAction.id, send_to: sendTo };
    }
    return found;
  }

  async function vaultFound(found) {
    let gtagId = null;
    for (const a of ACTIONS) {
      const f = found[a.key];
      if (f && f.send_to) { await setSecret(a.vault, f.send_to); if (!gtagId) gtagId = f.send_to.split('/')[0]; }
    }
    if (gtagId) await setSecret('GOOGLE_ADS_GTAG_ID', gtagId);
    await setSecret('GOOGLE_ADS_CONV_CID', cid);
    return gtagId;
  }

  // ── link: actions already exist, just (re)read snippets + vault ──────────────
  if (linkOnly) {
    const snap = await readSnippets();
    if (!snap.ok) return json(200, { ok: false, mode: 'link', ...snap });
    const found = extractSendTos(snap.rows);
    const gtagId = await vaultFound(found);
    const complete = ACTIONS.every((a) => found[a.key] && found[a.key].send_to);
    return json(200, { ok: complete, mode: 'link', cid, gtag_id: gtagId, found });
  }

  // ── preview ─────────────────────────────────────────────────────────────────
  if (!apply) return json(200, { ok: true, mode: 'preview', cid, would_create: ACTIONS.map((a) => a.name), note: 'add &apply=1 to create + vault' });

  // ── apply: create both WEBPAGE actions, then read snippets + vault ──────────
  // (skip creating one that already exists by name so re-runs are safe)
  const snapBefore = await readSnippets();
  const existing = snapBefore.ok ? (snapBefore.rows || []).map((x) => x.conversionAction && x.conversionAction.name) : [];
  const toCreate = ACTIONS.filter((a) => !existing.includes(a.name));
  let created = [];
  if (toCreate.length) {
    const ops = toCreate.map((a) => ({ create: {
      name: a.name, type: 'WEBPAGE', category: a.category, status: 'ENABLED',
      countingType: a.key === 'PAID' ? 'ONE_PER_CLICK' : 'ONE_PER_CLICK',
      valueSettings: { defaultValue: a.key === 'PAID' ? 50 : 0, alwaysUseDefaultValue: false },
    } }));
    const res = await call(mutate, { operations: ops });
    if (!res.ok) return json(200, { ok: false, mode: 'apply', http: res.http, error: (res.d && res.d.error && (res.d.error.message || res.d.error.status)) || res.d, detail: (res.d && res.d.error && res.d.error.details && res.d.error.details[0] && res.d.error.details[0].errors) || null });
    created = (res.d.results || []).map((x) => x.resourceName);
  }

  // snippets are generated by Google — read them back now
  const snap = await readSnippets();
  if (!snap.ok) return json(200, { ok: false, mode: 'apply', created, note: 'created but could not read snippets; retry ?link=1', ...snap });
  const found = extractSendTos(snap.rows);
  const gtagId = await vaultFound(found);
  const complete = ACTIONS.every((a) => found[a.key] && found[a.key].send_to);
  return json(200, { ok: complete, mode: 'apply', cid, created_now: created, gtag_id: gtagId, found, note: complete ? 'vaulted — now wire the page' : 'snippets not ready yet; run ?link=1 in a minute' });
};
