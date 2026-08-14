// phone-test-blast — ONE-TIME (Teddy 2026-08-14): at 9am CT, fire a clearly-labeled 🧪 test
// text to EVERYONE on Ann's REAL tool path (telnyx-ai-tool) so each person can confirm they
// received it, then text Teddy a pass/fail summary. Tests the exact texting Ann uses:
//   message_tech  → Jimmy, Andre, Lee, John, Teddy   ("From the office (via Ann): …🐜")
//   message_office→ Danielle + Sofia                 ("From Ann: …🐜")
//   message_customer → Teddy's cell (customer path)  ("…- Tennessee Appliance Exchange 🐜")
//
// SAFE: date-gated to the target day so the daily cron only fires once; a done-flag guards a
// double-fire; dry-run (secret only) previews without sending. Remove the cron after the test.
//
//   (scheduled)              fires at 9am CT on the target date only
//   GET ?secret=<admin>      DRY-RUN (no send) — lists who it would text
//   GET ?secret=<admin>&send=1  fire now (manual)
'use strict';
const { getSecret, setSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const TARGET_DATE = '2026-08-14';   // fire only on this CT date (Teddy scheduled it for today 9am)
const TECHS = ['Jimmy', 'Andre', 'Lee', 'John', 'Teddy'];
const TEST_MSG = '🧪 TEST from Teddy — new phone system (Ann texting). If you got this, reply GOT IT. Nothing else needed.';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const live = scheduled || q.send === '1';
  // scheduled fires daily; only actually send on the target CT date (self-terminating)
  if (scheduled && ctDate() !== TARGET_DATE) return json(200, { ok: true, skipped: 'not target date', today: ctDate(), target: TARGET_DATE });
  if (live && String(await getSecret('PHONE_TEST_BLAST_DONE') || '') === '1' && q.again !== '1') return json(200, { ok: true, already_done: true, note: 'already fired — &again=1 to force' });

  const K = (await getSecret('TELNYX_TOOL_SECRET')) || '';
  const recipients = [
    ...TECHS.map((name) => ({ label: name, action: 'message_tech', body: { tech_name: name, message: TEST_MSG } })),
    { label: 'Office (Danielle + Sofia)', action: 'message_office', body: { message: '🧪 TEST from Teddy — new phone system (Ann texting the office). If you got this, reply GOT IT.' } },
    { label: 'Customer-path (Teddy cell)', action: 'message_customer', body: { phone: '6154855795', first_name: 'Teddy', message: '🧪 TEST of the customer-text path. If you got this, reply GOT IT.' } },
  ];

  if (!live) return json(200, { ok: true, mode: 'dry-run', tool_secret_present: !!K, would_text: recipients.map((r) => ({ who: r.label, via: r.action })), note: 'DRY — sends nothing. Scheduled run fires 9am CT ' + TARGET_DATE + '.' });

  const tool = async (action, body) => {
    try { return await fetch(`${SITE}/.netlify/functions/telnyx-ai-tool?do=${action}&k=${encodeURIComponent(K)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).then((x) => x.json()); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  };

  const results = [];
  for (const r of recipients) {
    const res = await tool(r.action, r.body);
    const ok = !!(res && (res.sent === true || (res.count && res.count > 0)));
    results.push({ who: r.label, sent: ok, count: res && res.count });
    await sleep(400);   // pace under the SMS breaker
  }

  try { await setSecret('PHONE_TEST_BLAST_DONE', '1'); } catch (_) {}
  try { await crud.logEvent('phone_test_blast', { results, at_ms: Date.now() }); } catch (_) {}
  // summary to Teddy
  const summary = '📞 Phone-system TEXT test (9am):\n' + results.map((r) => `${r.sent ? '✅' : '❌'} ${r.who}`).join('\n') + '\n\nWatch for GOT IT replies. Transfers are yours to test by calling Ann.';
  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: summary, force_send: true, context_tag: 'phone_test_summary' }), signal: AbortSignal.timeout(9000) }); } catch (_) {}

  return json(200, { ok: true, mode: scheduled ? 'scheduled' : 'manual', results });
};
