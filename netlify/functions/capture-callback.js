// Vapi tool — capture a caller when Ant can't find/answer them, so NO call is
// lost during the HCP->Ant transition (data's still partly in HCP/MeisterTask).
// Logs a callback_request + texts the office immediately so a human follows up.
// The assistant calls this as its graceful fallback instead of a blind transfer.
//
// POST { name, phone, summary, caller_type, ref }  ->  { ok, say }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  // Vapi sends tool args either at the top level or under message.toolCalls; accept both.
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const args = b.arguments || b.args || b;

  const name = String(args.name || '').slice(0, 80);
  const phone = String(args.phone || '').slice(0, 40);
  const summary = String(args.summary || args.need || '').slice(0, 600);
  const callerType = String(args.caller_type || 'customer').slice(0, 30); // customer | warranty | other
  const ref = String(args.ref || args.claim || '').slice(0, 60);

  // A captured caller must NOT be lost. Try the durable event_log write (it
  // feeds the office Callbacks queue) with retries, then the two SMS alerts
  // with one retry each. Track whether ANY path landed.
  async function retry(fn, attempts) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
    }
    throw lastErr || new Error('failed');
  }

  let logged = false, ownerSent = false, danielleSent = false;
  const h = headers();
  if (h) {
    try {
      await retry(async () => {
        const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'callback_request', metadata: { name, phone, summary, caller_type: callerType, ref, source: 'vapi', at_ms: Date.now() } }),
        });
        if (!r.ok) throw new Error('event_log ' + r.status);
        return true;
      }, 3);
      logged = true;
    } catch (_) { logged = false; }
  }

  const tag = callerType === 'warranty' ? 'WARRANTY' : 'customer';
  const alert = '[ant] 📞 callback needed (' + tag + '): ' + (name || '(no name)') + ' ' + (phone || '') +
    (ref ? (' · claim/WO ' + ref) : '') + ' — ' + (summary || 'see call') + '. Please follow up.';
  try { await retry(() => sendSms(OWNER, alert, 'owner', 'vapi_callback'), 2); ownerSent = true; } catch (_) {}
  try { await retry(() => sendSms(DANIELLE, alert, 'warranty_handler', 'vapi_callback'), 2); danielleSent = true; } catch (_) {}

  const captured = logged || ownerSent || danielleSent;
  // Last-ditch visibility if EVERYTHING failed — at least surface it in the
  // function logs with a clear marker so it can be recovered manually.
  if (!captured) {
    console.error('CALLBACK_NOT_CAPTURED', JSON.stringify({ name, phone, summary, caller_type: callerType, ref, at: new Date().toISOString() }));
  }

  // Always reassure the caller (never alarm them mid-call); we've done our best
  // to capture across three paths.
  return jsonResp(200, {
    ok: true,
    captured,
    logged,
    say: "Got it — I've passed your info to our office and someone will reach out to you very shortly. Anything else I can help with in the meantime?",
  });
};
