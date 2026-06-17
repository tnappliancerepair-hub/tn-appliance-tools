'use strict';
// Tap target from the report-nudge text (request-tech-report). Places an outbound
// "Ant Tech Report" call to the tech with the job loaded, so they finish the report
// by voice. Returns a tiny confirmation page. (2026-06-16)
const VAPI_BASE = 'https://api.vapi.ai';
const REPORT_ASSISTANT = 'ad59a704-e7d8-43a8-9de6-3926ad2aebd2'; // Ant Tech Report
// TN_PRIMARY (Twilio +16292477111) — the confirmed-working outbound number
// (the Telnyx numbers have broken voice routing per vapi-out.js).
const FROM_NUMBER_ID = 'd57d5cf2-60a7-46e6-a7f0-24ed652c1f31';

const TECH_PHONES = {
  1: '+16154855795', 2: '+16159671304', 3: '+16159693115',
  4: '+16158291654', 5: '+17315049617', 6: '+18133527686',
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = Number(q.job_id || 0);
  const techId = Number(q.tech_id || 0);
  const techPhone = TECH_PHONES[techId];
  if (!jobId || !techPhone) return page('Missing job or tech info — call the office to finish the report.');

  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) return page("Couldn't start the call — call the office to finish the report.");

  try {
    const r = await fetch(`${VAPI_BASE}/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId: REPORT_ASSISTANT,
        phoneNumberId: FROM_NUMBER_ID,
        customer: { number: techPhone },
        assistantOverrides: { variableValues: { job_id: jobId, technician_id: techId } },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return page("Couldn't start the call (" + r.status + ") — call the office to finish the report.");
    }
    return page('📞 Ant is calling you right now to finish the report. Answer and just talk him through it — he\'ll fill it out.');
  } catch (_) {
    return page("Couldn't start the call — call the office to finish the report.");
  }
};

function page(msg) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finish report</title></head><body style="font:18px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:48px 24px;background:#0e1118;color:#e8edf5;text-align:center"><div style="font-size:52px">🐜</div><p style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto">${msg}</p></body></html>`,
  };
}
