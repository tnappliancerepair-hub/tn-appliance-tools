// office-daily-recap — texts Teddy an end-of-day "who did what" recap of office
// activity, split by person (the actor stamped on each action). An objective
// record during the Danielle→Sofia handoff. Scheduled each evening; also
// on-demand: GET ?secret=<admin>[&text=1][&days=1].
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795'; // Teddy
const CT_OFFSET = 5 * 3600 * 1000; // CDT (UTC-5)
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

function ctMidnightMs() { const d = new Date(Date.now() - CT_OFFSET); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0) + CT_OFFSET; }
function ctLabel(ms) { const d = new Date(ms - CT_OFFSET); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return days[d.getUTCDay()] + ' ' + mo[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
function ctTime(ms) { const d = new Date(ms - CT_OFFSET); let h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0'), ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + m + ap; }

// each action → the label used in the recap
const ACTIONS = [
  { action: 'schedule_receipt', label: 'scheduled' },
  { action: 'office_invoice_logged', label: 'invoices' },
  { action: 'office_stage_set', label: 'moves' },
  { action: 'customer_sms_reply', label: 'texts' },
  { action: 'office_checklist_set', label: 'ticks' },
];
const actorOf = (m) => String(m.actor || m.by || m.sender || 'office').trim();

async function build(sinceMs) {
  const per = {}; // actor -> { scheduled, invoices, moves, texts, ticks, last }
  let automated = 0;
  const bump = (actor, key, at) => {
    if (/\(ant\)/i.test(actor)) { automated++; return; }
    const a = actor || 'office';
    per[a] = per[a] || { scheduled: 0, invoices: 0, moves: 0, texts: 0, ticks: 0, last: 0 };
    per[a][key]++; if (at > per[a].last) per[a].last = at;
  };
  const dbg = {};
  for (const { action, label } of ACTIONS) {
    let rows = [];
    try { rows = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 800); } catch (_) {}
    let maxAt = 0, kept = 0;
    for (const r of rows) {
      const m = metaOf(r);
      let at = Number(m.at_ms || m.logged_at_ms || r.created_at || 0);
      if (at > 0 && at < 1e12) at *= 1000; // created_at in seconds → ms
      if (at > maxAt) maxAt = at;
      if (at < sinceMs) continue;
      kept++;
      bump(actorOf(m), label, at);
    }
    dbg[action] = { fetched: rows.length, maxAt, kept, sampleActor: rows.length ? actorOf(metaOf(rows[0])) : '' };
  }
  return { per, automated, dbg };
}

function compose(per, automated, sinceMs) {
  const names = Object.keys(per).sort((a, b) => {
    const t = (x) => per[x].scheduled + per[x].invoices + per[x].moves + per[x].texts + per[x].ticks; return t(b) - t(a);
  });
  let msg = '📋 Office recap — ' + ctLabel(sinceMs) + '\n';
  if (!names.length) { msg += '(no office activity logged today)'; return msg; }
  for (const n of names) {
    const p = per[n];
    const bits = [];
    if (p.scheduled) bits.push(p.scheduled + ' sched');
    if (p.invoices) bits.push(p.invoices + ' inv');
    if (p.moves) bits.push(p.moves + ' moves');
    if (p.texts) bits.push(p.texts + ' texts');
    if (p.ticks) bits.push(p.ticks + ' ✓');
    msg += '\n' + n + ': ' + (bits.length ? bits.join(' · ') : 'quiet') + (p.last ? '  (last ' + ctTime(p.last) + ')' : '');
  }
  if (automated) msg += '\n\n(+' + automated + ' automated)';
  return msg;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // scheduled runs carry no ?secret — self-authorize + send (netlify cron footgun)
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // default = since CT midnight (today). &days=N widens back N-1 days (on-demand review).
  const days = Math.min(Math.max(parseInt(q.days, 10) || 1, 1), 14);
  const sinceMs = ctMidnightMs() - (days - 1) * 86400000;
  const { per, automated } = await build(sinceMs);
  const msg = compose(per, automated, sinceMs);

  const send = scheduled || q.text === '1';
  if (send) { try { await sendSms(OWNER, msg, 'owner', 'office_recap'); } catch (_) {} }
  return json(200, { ok: true, sent: send, since_ct: ctLabel(sinceMs), per, automated, message: msg });
};
