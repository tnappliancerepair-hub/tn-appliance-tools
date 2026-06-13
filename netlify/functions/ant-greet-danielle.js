// One-shot: Ant introduces itself to Danielle from the Ant text line, so she
// starts texting/talking to Ant (not Teddy). Self-limited — only ever sends one
// fixed message to one fixed number, and dedupes, so it's safe to trigger.
//
// GET/POST /.netlify/functions/ant-greet-danielle   (?force=1 to resend)

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const DANIELLE = '+16154850713';
const ANT_LINE = '+16158578800'; // tech/office Telnyx line (already wired for inbound)

const MESSAGE =
  "Hi Danielle! It's Ant 🐜 — your new helper at TN Appliance. From now on, just text me whatever you need and I'll take care of it. " +
  "Try things like: \"schedule the Carson job with Jimmy Thursday\", \"assign Andre to 18537\", or \"the Davis job parts came in\". " +
  "Text me back anything to give it a try — I've got you. (You can also tap the blue \"Talk to Ant\" button on the schedule screen.)";

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const force = (event.queryStringParameters || {}).force === '1';
  try {
    // dedupe unless forced
    if (!force) {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ search: { action: 'ant_greeted_danielle' }, per_page: 1, page: 1 }),
      });
      if (r.ok) { const d = await r.json(); if (((d && d.items) || []).length) return jsonResp(200, { ok: true, already_sent: true }); }
    }
    const key = process.env.TELNYX_API_KEY;
    if (!key) return jsonResp(200, { ok: false, error: 'TELNYX_API_KEY not set' });
    const sr = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ANT_LINE, to: DANIELLE, text: MESSAGE }),
    });
    const sent = sr.ok;
    await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ action: 'ant_greeted_danielle', metadata: { to: DANIELLE, sent, at_ms: Date.now() } }),
    });
    return jsonResp(200, { ok: sent, sent });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
