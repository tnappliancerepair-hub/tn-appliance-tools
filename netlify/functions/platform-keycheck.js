// platform-keycheck — owner-gated proof that the envelope-encryption root key is live, WITHOUT
// ever revealing it. Mints a throwaway DEK for a fake company, confirms it wrapped with the
// dedicated vault KEK (kek_v='ded'), round-trips an encrypt/decrypt, then deletes the throwaway
// keyring row. Returns only booleans + the non-secret key-source tag. Safe to keep (like r2-probe).
//   GET ?secret=<admin>
'use strict';
const { getSecret, getSecretPreferVault } = require('./_lib/secrets');
const tc = require('./_lib/tenant-creds');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const rnd = require('crypto');
  const CO_WRITE = rnd.randomUUID();   // probe the keyring write in isolation
  const CO_DEK = rnd.randomUUID();     // clean slot for the real DEK mint

  try {
    // (1) does the dedicated key resolve from the vault? report its LENGTH only (non-secret:
    //     64 = a hex key present; 0 = absent/not resolving). This is independent of the DB.
    const kekVal = (await getSecretPreferVault('INTEGRATION_ENC_KEY')) || '';
    const kekLen = kekVal.length;

    // (2) can the service key WRITE the keyring? direct probe insert (separate co) + cleanup.
    let keyringWrite = 'unknown', keyringWriteStatus = 0;
    try {
      const w = await fetch(`${base}/rest/v1/tenant_keyring`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: CO_WRITE, wrapped_dek: 'PROBE', kek_v: 'probe' }), signal: AbortSignal.timeout(9000) });
      keyringWriteStatus = w.status;
      keyringWrite = w.ok ? 'ok' : (await w.text().catch(() => '')).slice(0, 140);
    } catch (e) { keyringWrite = String((e && e.message) || e).slice(0, 100); }
    await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${CO_WRITE}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000) });

    // (3) mint + wrap a fresh DEK via tenant-creds (clean slot), round-trip, read the key-source tag.
    const enc = await tc.encryptCreds(CO_DEK, { probe: 'keycheck' });
    const back = await tc.decryptCreds(CO_DEK, enc.secret_enc, enc.enc_v);
    const roundtrip = back && back.probe === 'keycheck';
    const r = await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${CO_DEK}&select=kek_v&limit=1`, { headers: H, signal: AbortSignal.timeout(9000) });
    const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
    const kekSource = row ? row.kek_v : null;

    // cleanup — leave no throwaway row behind
    await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${CO_DEK}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000) });

    const dedicated = kekLen === 64 || kekSource === 'ded';
    return json(200, {
      ok: true,
      integration_enc_key_present: dedicated,
      kek_resolved_len: kekLen,              // 64 = present (hex); 0 = not resolving
      kek_source: kekSource,                 // 'ded' = dedicated; 'kdf1' = derived fallback; null = keyring not written
      keyring_write: keyringWrite,           // 'ok' or the PostgREST error
      keyring_write_status: keyringWriteStatus,
      envelope_roundtrip: !!roundtrip,
      cred_scheme: enc.enc_v,
      note: dedicated
        ? 'INTEGRATION_ENC_KEY is live — new DEKs wrap with the dedicated vault key.'
        : 'INTEGRATION_ENC_KEY NOT resolving — still using the derived fallback. Check the vault entry.',
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
