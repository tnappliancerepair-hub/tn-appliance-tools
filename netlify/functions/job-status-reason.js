// job-status-reason — composes a clear, honest "here's where it stands and WHY
// it's waiting" sentence for any job, from claim #, phone, or job_id. Built so Ant
// can RELAY a specific status to a warranty-company rep (or a customer) instead of
// just taking a message (Teddy, 2026-06-22). Also reusable by office/portal.
//
//   GET /job-status-reason?claim=55129879
//   GET /job-status-reason?phone=6155551212
//   GET /job-status-reason?job_id=19705
//     -> { ok, found, reason, headline, customer, appliance, status, tech, part_eta, scheduled_day }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function dayCT(v) {
  if (!v) return '';
  let ms = v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  if (typeof v === 'string') ms = Date.parse(v);
  if (!ms || isNaN(ms)) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}
async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }

// Build the status reason. you=true → 2nd-person ("your dishwasher… you'll get a
// day") for the customer's own portal; you=false → 3rd-person for relaying to a
// warranty-company rep or the office.
function compose(j, tech, cust, you) {
  // Never let a STALE 'canceled' flag override an active scheduling_status. When
  // a job is un-canceled, the legacy current_status column can stay 'canceled'
  // even though scheduling_status is active again — we must NOT tell a live
  // customer their job is canceled (Teddy 2026-07-01: that kills the business).
  const rawCur = String(j.current_status || '').toLowerCase();
  const rawSched = String(j.scheduling_status || '').toLowerCase();
  let status = rawCur || rawSched;
  if (rawCur === 'canceled' && rawSched && rawSched !== 'canceled') status = rawSched;
  const appl = [j.brand, j.appliance_type].filter(Boolean).join(' ') || 'appliance';
  const first = (cust && cust.first_name) ? cust.first_name : 'the customer';
  const techName = (tech && tech.first_name) ? tech.first_name : (TECHS[j.technician_id] || '');
  const partEta = dayCT(j.part_eta || j.parts_eta_date);
  const day = dayCT(j.scheduled_start);
  const ap = you ? ('your ' + appl) : ('the ' + appl);              // appliance phrase
  const tech1 = techName || (you ? 'your tech' : 'a tech');

  if (/complete|done/.test(status)) {
    // Already-completed WARRANTY job → any further trouble must go back through
    // the warranty company as a RECALL. We can't reschedule until they open it.
    const ct = String(j.customer_type || '').toLowerCase();
    const isWarranty = !!(j.warranty_company || (ct && !/self|cash|customer_pay/.test(ct)));
    const wc = (j.warranty_company || '').trim();
    if (isWarranty) {
      return { headline: 'Completed — recall via warranty co', reason: you
        ? `Our records show this repair was completed and the job is closed. If ${ap} is having trouble again, it has to go back through your warranty company as a recall — please contact ${wc || 'your warranty company (e.g. AHS, SquareTrade, or Frontdoor)'} and open a recall on this claim. As soon as they open it they'll dispatch us back out. We're not able to schedule a return visit until that recall is opened on their side.`
        : `This repair is completed and closed. If ${ap} is acting up again, ${first} must open a RECALL with ${wc || 'their warranty company'} — we cannot reschedule or send a tech until the warranty company dispatches it back as a recall.` };
    }
    return { headline: 'Completed', reason: you ? `Your repair is complete — thank you!` : `That repair is complete${j.repair_completed ? ' — ' + j.repair_completed : '.'}` };
  }
  // Even for a genuinely-canceled job, NEVER flatly tell a caller "your job is
  // canceled" — that kills the sale. Route to a human to confirm/recover instead.
  if (/cancel/.test(status)) return { headline: 'Office to confirm', reason: you
    ? `Let me get you taken care of — I'll have our office confirm your appointment and reach right back out to you.`
    : `This one needs the office to confirm before we tell the customer anything — take their name + number and have someone follow up right away. Do NOT tell them it's canceled.` };
  if (/await|part|order/.test(status)) {
    return { headline: 'Waiting on a part', reason: partEta
      ? (you
          ? `We've diagnosed ${ap} and we're waiting on the part — expected ${partEta}. The moment it's in, we'll schedule the install and text you a day.`
          : `We've diagnosed ${ap} and we're waiting on the part — expected ${partEta}. The moment it's in, we schedule the install and ${first} gets a day.`)
      : `We've diagnosed ${ap} and the part is on order. As soon as it arrives we schedule the install${you ? ' and text you a day' : ''}.` };
  }
  if (/in_progress|started/.test(status)) return { headline: 'In progress', reason: you ? `${tech1} is working on ${ap} right now.` : `${tech1} is on ${ap} right now.` };
  if (/scheduled/.test(status) || day) {
    return { headline: 'Scheduled', reason: day
      ? (you
          ? `You're scheduled with ${tech1} for ${day}. We run day-of routing, so you'll get a live arrival window that morning.`
          : `${first} is scheduled with ${tech1} for ${day}. We run day-of routing, so ${first} gets a live arrival window that morning.`)
      : (you ? `You're scheduled with ${tech1} — you'll get a live window the morning of.` : `Scheduled with ${tech1} — ${first} gets a live window the morning of.`) };
  }
  if (/not_ready|needs|broadcast|intake|new/.test(status)) return { headline: 'In scheduling', reason: you
    ? `We've got ${ap} and it's in our scheduling queue — we'll set a day shortly and text you to confirm.`
    : `We've received ${ap} job and it's in our scheduling queue — a day gets set shortly and ${first} is texted to confirm.` };
  const fs = (j.friendly_status || '').trim();
  return { headline: fs || 'In progress', reason: fs ? `Current status: ${fs}.` : (you ? `Your ${appl} job is in progress — we'll update you on the next step.` : `The ${appl} job is in progress.`) };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const claim = (q.claim || q.claim_or_dispatch_number || '').trim();
  const phone = (q.phone || '').replace(/\D/g, '');
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;

  let job = null, tech = null, cust = null;
  if (claim) {
    const d = await jfetch(`${XANO}/lookup_by_claim_number`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim_or_dispatch_number: claim }) });
    if (d && d.success && (d.matches || []).length) { job = d.matches[0]; tech = d.tech; cust = d.customer; }
  } else if (phone) {
    const d = await jfetch(`${XANO}/lookup_customer_by_phone?phone=${phone}`);
    if (d && d.found) { cust = d.customer; job = (d.jobs && d.jobs[0]) || d.job || null; tech = d.tech; }
  } else if (jobId) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard?job_id=${jobId}`);
    job = (d && (d.job || d)) || null; cust = d && d.customer; tech = d && d.tech;
  }

  if (!job) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: false, reason: "I don't see that one in our system yet — it may be a brand-new dispatch we haven't received. I can take the details and have someone confirm." }) };

  const youVoice = String(q.voice || '').toLowerCase() === 'customer';
  const { headline, reason } = compose(job, tech, cust, youVoice);

  // Latest OFFICE NOTE (Danielle's manual update — part ETAs, warranty-co news).
  // It's the freshest human truth, so append it so Ant relays it to the caller:
  // "…the part's expected 5-7 days, per the office note from Jul 1."
  let officeNote = null;
  const jid = Number(job.id || jobId) || 0;
  if (jid) {
    const el = await jfetch(`${XANO}/get_event_log_by_action?action=office_note`);
    const rows = (el && (el.items || el)) || [];
    const mine = (Array.isArray(rows) ? rows : []).map((r) => {
      let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      return { text: (m && m.text) || '', jid: Number((m && m.job_id) || 0), at: Number((m && m.at_ms) || r.created_at || 0) };
    }).filter((x) => x.jid === jid && x.text).sort((a, b) => b.at - a.at);
    if (mine.length) officeNote = mine[0];
  }
  let fullReason = reason;
  if (officeNote) {
    const when = dayCT(officeNote.at);
    fullReason = `${reason} Latest office update${when ? ' (' + when + ')' : ''}: ${officeNote.text}`;
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({
    ok: true, found: true,
    headline, reason: fullReason,
    office_note: officeNote ? officeNote.text : '',
    office_note_at: officeNote ? officeNote.at : 0,
    customer: cust ? `${(cust.first_name || '').trim()} ${(cust.last_name || '').trim()}`.trim() : '',
    appliance: [job.brand, job.appliance_type].filter(Boolean).join(' '),
    status: job.current_status || job.scheduling_status || '',
    tech: (tech && tech.first_name) || TECHS[job.technician_id] || '',
    part_eta: job.part_eta || job.parts_eta_date || '',
    scheduled_day: dayCT(job.scheduled_start),
    claim_number: job.claim_number || claim,
    job_id: job.id || jobId,
  }) };
};
