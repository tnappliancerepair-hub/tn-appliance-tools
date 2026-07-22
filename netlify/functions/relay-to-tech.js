// relay-to-tech — when a caller needs their tech and he doesn't answer (or they just
// want to leave him a message), Ann calls this: it TEXTS the message + callback number
// straight to the tech's cell, and NOTIFIES the owner that the tech missed a live call.
// Reliable (SMS), unlike depending on voicemail detection. Accepts a plain POST or the
// Vapi tool-call envelope.
'use strict';
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795'; // Teddy — owner alert
// Active field roster cells (Billy removed). Andre = his 504 (system-of-record).
const CELLS = { 1: '+16154855795', 2: '+16159671304', 3: '+15049099413', 4: '+16158291654', 6: '+18133527686' };
const NAMES = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, john: 6 };

function j(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }; }
function digits(p) { return String(p || '').replace(/\D/g, ''); }
function e164(p) { const d = digits(p); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d ? '+' + d : ''; }

function resolveTech(a) {
  let id = parseInt(a.tech_id, 10);
  if (!CELLS[id] && a.tech_name) { const n = String(a.tech_name).trim().toLowerCase().split(/\s+/)[0]; if (BY_NAME[n]) id = BY_NAME[n]; }
  if (!CELLS[id]) return null;
  return { id, name: NAMES[id], cell: CELLS[id] };
}

async function relay(a) {
  const tech = resolveTech(a);
  const msg = String(a.message || '').trim();
  const custName = String(a.customer_name || '').trim() || 'A customer';
  const custPhone = e164(a.customer_phone);
  const appl = String(a.appliance || '').trim();
  const applPart = appl ? ` about their ${appl}` : '';
  const callBack = custPhone ? ` Call them back at ${custPhone}.` : '';

  if (!tech) return { ok: false, spoken: "I couldn't tell which technician that is — let me take your name and number and get it to the office instead." };
  if (!msg && !custPhone) return { ok: false, spoken: 'What would you like me to tell them, and what number should they call you back on?' };

  const toTech = `📞 Customer callback — ${custName} (${custPhone || 'no number given'}) wanted you${applPart}.` + (msg ? `\nThey said: "${msg}"` : '') + callBack;
  const toOwner = `⚠️ ${tech.name} missed a live customer call. ${custName} (${custPhone || 'no #'})${applPart} — I texted ${tech.name} the message + callback #.` + (msg ? `\nMsg: "${msg}"` : '');

  const [techOk] = await Promise.all([
    sendSms(tech.cell, toTech, 'technician', 'tech_relay'),
    sendSms(OWNER, toOwner, 'owner', 'tech_no_answer'),
  ]);
  try { await crud.logEvent('tech_call_relayed', { tech_id: tech.id, tech: tech.name, customer_phone: custPhone, customer_name: custName, message: msg.slice(0, 400), tech_sms_ok: !!techOk, at_ms: Date.now() }); } catch (_) {}

  return { ok: true, tech: tech.name, spoken: `Done — I've texted ${tech.name} your message and your number, and let the office know he missed the call. He'll get back to you as soon as he can.` };
}

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  // Vapi tool-call envelope?
  const tc = b && b.message && Array.isArray(b.message.toolCalls) ? b.message.toolCalls : null;
  if (tc) {
    const results = [];
    for (const call of tc) {
      let args = {}; try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function.arguments || {}); } catch (_) {}
      const r = await relay(args);
      results.push({ toolCallId: call.id, result: r.spoken });
    }
    return j(200, { results });
  }

  // Plain POST (testing / other callers)
  const r = await relay(b);
  return j(r.ok ? 200 : 400, r);
};
