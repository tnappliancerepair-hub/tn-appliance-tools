// platform-media — serves a private intake-photos object to a CUSTOMER holding a valid
// portal token (they have no Supabase session, so they can't sign client-side). Validates
// the token -> its company, confirms the object's folder is that company (tenant check),
// mints a short-lived signed URL with the service key, and 302-redirects. Works from a
// plain <img src>. Staff apps sign client-side via RLS; this covers the token/anon path.
//
//   GET ?t=<portal_token>&ref=<company_id/.../file.jpg>   -> 302 to a 10-min signed URL
'use strict';
const { getSecret } = require('./_lib/secrets');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const token = String(q.t || '').trim();
  const ref = String(q.ref || '').trim();
  if (!token || !ref) return { statusCode: 400, body: 'bad request' };

  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!key) return { statusCode: 500, body: 'not configured' };
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    // 1) token -> company (and validity)
    const gr = await fetch(`${base}/rest/v1/portal_grant?token=eq.${encodeURIComponent(token)}&select=company_id,revoked,expires_at&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const g = ((await gr.json().catch(() => [])) || [])[0];
    if (!g || g.revoked) return { statusCode: 403, body: 'forbidden' };
    if (g.expires_at && Date.parse(g.expires_at) < Date.now()) return { statusCode: 403, body: 'expired' };
    // 2) tenant check — the object's first folder must be this token's company
    if (String(ref).split('/')[0] !== g.company_id) return { statusCode: 403, body: 'forbidden' };
    // 3) mint a short-lived signed URL
    const path = ref.split('/').map(encodeURIComponent).join('/');
    const sg = await fetch(`${base}/storage/v1/object/sign/intake-photos/${path}`, { method: 'POST', headers: H, body: JSON.stringify({ expiresIn: 600 }), signal: AbortSignal.timeout(8000) });
    const sd = await sg.json().catch(() => ({}));
    const signed = sd.signedURL || sd.signedUrl || '';
    if (!signed) return { statusCode: 502, body: 'sign failed' };
    const full = signed.startsWith('http') ? signed : `${base}/storage/v1${signed}`;
    return { statusCode: 302, headers: { Location: full, 'Cache-Control': 'private, max-age=300' }, body: '' };
  } catch (e) {
    return { statusCode: 502, body: 'error' };
  }
};
