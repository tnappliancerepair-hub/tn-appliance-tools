// web-push-keys — returns the public VAPID key the browser subscribes with.
// On first call it AUTO-GENERATES the keypair and stores it in the vault, so
// nobody ever has to paste a key. Public key is safe to expose by design.
'use strict';
const webpush = require('web-push');
const { getSecret, setSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async function () {
  try {
    let pub = await getSecret('VAPID_PUBLIC_KEY');
    let priv = await getSecret('VAPID_PRIVATE_KEY');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey; priv = keys.privateKey;
      await setSecret('VAPID_PUBLIC_KEY', pub);
      await setSecret('VAPID_PRIVATE_KEY', priv);
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, publicKey: pub }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
