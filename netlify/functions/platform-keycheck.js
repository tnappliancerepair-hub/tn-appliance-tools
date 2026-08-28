// platform-keycheck — owner-gated proof that the envelope-encryption root key is live, WITHOUT
// ever revealing it. Mints a throwaway DEK for a fake company, confirms it wrapped with the
// dedicated vault KEK (kek_v='ded'), round-trips an encrypt/decrypt, then deletes the throwaway
// keyring row. Returns only booleans + the non-secret key-source tag. Safe to keep (like r2-probe).
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const tc = require('./_lib/tenant-creds');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const FAKE_CO = 'deadbeef-0000-4000-8000-000000000001'; // not a real tenant
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    // clean any prior throwaway row so we mint fresh (proves the CURRENT KEK is used)
    await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${FAKE_CO}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000) });

    // mint + wrap a fresh DEK, and round-trip a sample through it
    const enc = await tc.encryptCreds(FAKE_CO, { probe: 'keycheck' });
    const back = await tc.decryptCreds(FAKE_CO, enc.secret_enc, enc.enc_v);
    const roundtrip = back && back.probe === 'keycheck';

    // read the non-secret key-source tag off the wrapped DEK
    const r = await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${FAKE_CO}&select=kek_v&limit=1`, { headers: H, signal: AbortSignal.timeout(9000) });
    const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
    const kekSource = row ? row.kek_v : null;

    // cleanup — leave no throwaway row behind
    await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${FAKE_CO}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000) });

    return json(200, {
      ok: true,
      integration_enc_key_present: kekSource === 'ded',
      kek_source: kekSource,                 // 'ded' = dedicated vault key (what we want); 'kdf1' = derived fallback
      envelope_roundtrip: !!roundtrip,
      cred_scheme: enc.enc_v,                // should be 'dek1' (per-tenant DEK)
      note: kekSource === 'ded'
        ? 'INTEGRATION_ENC_KEY is live — new DEKs wrap with the dedicated vault key.'
        : 'INTEGRATION_ENC_KEY NOT resolving — still using the derived fallback (kdf1). Check the vault entry.',
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
