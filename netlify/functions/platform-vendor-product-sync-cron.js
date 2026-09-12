// Thin scheduled wrapper. The core stays a plain HTTP function on purpose: a Netlify function
// that carries its own `schedule` block edge-403s on every external call, which would kill the
// ?secret= shadow run — the only way to eyeball this before it writes.
'use strict';
const { runVendorProduct } = require('./platform-vendor-product-sync');

exports.handler = async function () {
  try {
    const r = await runVendorProduct({ apply: true });
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
