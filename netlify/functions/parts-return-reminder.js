// parts-return-reminder — makes a tech IMPOSSIBLE to blindside on a return.
//
// The whole point (Teddy + the crew): guys get charged back for parts they never
// knew had to go back, after the deadline passed. This pushes the deadline AT the
// tech, escalating, until it's shipped — and logs exactly what he was told + when
// (the FAIRNESS RECORD), so the shop only ever charges a tech who was clearly
// warned. When it's returned, he gets a "you're clear" so he knows he's safe.
//
// Stages per open return (dedup'd so we never spam the same stage twice):
//   new      → first notice the moment it's owed
//   due_soon → ≤3 days left
//   overdue  → past the deadline, ship TODAY
//   cleared  → returned (delivered/marked) → "you're clear, no chargeback"
//
// Kill switch: env/vault PARTS_RETURN_REMINDER=off.  ?dry=1 to preview.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { loadOpenReturns, keyOf, metaOf } = require('./_lib/returns');
const { getSecret } = require('./_lib/secrets');

const INTAKE = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const OWNER = '+16154855795';

// roster (reliable; filtering technicians by id via metadata is flaky). Andre = 504.
const TECH = { 1: { p: '+16154855795', n: 'Teddy' }, 2: { p: '+16159671304', n: 'Jimmy' }, 3: { p: '+15049099413', n: 'Andre' }, 4: { p: '+16158291654', n: 'Lee' }, 6: { p: '+18133527686', n: 'John' } };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctDate(ms) { try { return new Date(Number(ms)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }); } catch (_) { return ''; } }
async function sms(to, message, tag) { try { const r = await fetch(`${INTAKE}/send_sms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, message, context_tag: tag }), signal: AbortSignal.timeout(10000) }); return r.ok; } catch (_) { return false; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  // SAFE BY DEFAULT: texting only fires when explicitly enabled (PARTS_RETURN_REMINDER=on),
  // because the deadline window is a PLACEHOLDER until Danielle confirms it — we will NOT
  // blast techs deadlines that might be wrong. Until enabled, the cron runs in shadow:
  // computes + logs what it WOULD send, sends nothing. Flip on after RETURN_WINDOW_DAYS is real.
  const flag = String((await getSecret('PARTS_RETURN_REMINDER')) || process.env.PARTS_RETURN_REMINDER || '').toLowerCase();
  const enabled = flag === 'on' || flag === 'live' || flag === 'true';
  const dry = q.dry === '1' || !enabled;   // not enabled → shadow (no texts, no warn records)

  let data;
  try { data = await loadOpenReturns({}); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  const open = data.returns;

  // what we've already warned (dedup by key:stage) + already congratulated
  const warnedRows = await crud.searchPage(crud.TABLES.event_log, { action: 'parts_return_warned' }, { id: 'desc' }, 500).catch(() => []);
  const warnedStages = new Set(); const warnedKeys = new Set();
  for (const r of warnedRows) { const m = metaOf(r); if (m.key) { warnedKeys.add(m.key); if (m.stage) warnedStages.add(`${m.key}:${m.stage}`); } }
  const clearedRows = await crud.searchPage(crud.TABLES.event_log, { action: 'parts_return_cleared_notified' }, { id: 'desc' }, 500).catch(() => []);
  const clearedDone = new Set(clearedRows.map((r) => metaOf(r).key).filter(Boolean));

  const out = { ok: true, enabled, dry, window_days: data.window_days, open: open.length, sent: { new: 0, due_soon: 0, overdue: 0, cleared: 0 }, items: [] };

  // --- warnings on OPEN returns ---
  for (const o of open) {
    const t = TECH[o.tech_id]; if (!t) continue;                    // unknown tech → office handles
    const stage = o.overdue ? 'overdue' : (o.days_left <= 3 ? 'due_soon' : (warnedStages.has(`${o.key}:new`) ? null : 'new'));
    if (!stage) continue;
    if (warnedStages.has(`${o.key}:${stage}`)) continue;            // already sent this stage
    const due = ctDate(o.due_ms);
    const link = `${SITE}/tech-returns.html?tech_id=${o.tech_id}`;
    const who = o.customer || o.claim || `job #${o.job_id}`;
    let msg;
    if (stage === 'new') msg = `[ant] 📦 ${t.n}, a part has to go BACK for ${who}: ${o.part}. Return by ${due} or it's a chargeback. Prepaid FedEx ${o.tracking}. Drop at any FedEx (or hand the office). Your returns: ${link}`;
    else if (stage === 'due_soon') msg = `[ant] ⏰ ${t.n}, ${Math.max(0, o.days_left)} day(s) left to return ${o.part} for ${who} — by ${due} or chargeback. FedEx ${o.tracking}. ${link}`;
    else msg = `[ant] 🚨 ${t.n}, the return for ${who} (${o.part}) is PAST DUE (${due}). Ship it TODAY to avoid the chargeback. FedEx ${o.tracking}. ${link}`;
    out.items.push({ tech: t.n, stage, part: o.part, who, due, job_id: o.job_id });
    if (!dry) {
      await sms(t.p, msg, 'parts_return');
      try { await crud.logEvent('parts_return_warned', { key: o.key, stage, tech_id: o.tech_id, job_id: o.job_id, part: o.part, customer: o.customer, due_ms: o.due_ms, at_ms: Date.now() }); } catch (_) {}
    }
    out.sent[stage]++;
  }

  // --- "you're clear" on returns that got CLOSED after we'd warned ---
  const closedRows = await crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_status' }, { id: 'desc' }, 400).catch(() => []);
  const techCache = {};
  for (const r of closedRows) {
    const m = metaOf(r); if (!['returned', 'shipped'].includes(String(m.status || '').toLowerCase())) continue;
    const k = keyOf(m.job_id, m.part);
    if (!warnedKeys.has(k) || clearedDone.has(k)) continue;         // only if we warned + haven't congratulated
    // resolve tech for this closed job
    let techId = techCache[m.job_id];
    if (techId === undefined) { const w = warnedRows.find((x) => metaOf(x).key === k); techId = w ? Number(metaOf(w).tech_id) : null; techCache[m.job_id] = techId; }
    const t = TECH[techId]; if (!t) continue;
    out.items.push({ tech: t.n, stage: 'cleared', part: m.part, job_id: m.job_id });
    if (!dry) {
      await sms(t.p, `[ant] ✅ ${t.n}, the part for ${m.part ? 'job #' + m.job_id : 'that job'} shows RETURNED — you're clear, no chargeback. Thanks for getting it back! 🐜`, 'parts_return');
      try { await crud.logEvent('parts_return_cleared_notified', { key: k, tech_id: techId, job_id: m.job_id, part: m.part, at_ms: Date.now() }); } catch (_) {}
    }
    out.sent.cleared++;
  }

  out.summary = `open ${open.length} · new ${out.sent.new} · due_soon ${out.sent.due_soon} · overdue ${out.sent.overdue} · cleared ${out.sent.cleared}`;
  if (!dry) { try { await crud.logEvent('parts_return_reminder_ran', { ...out.sent, open: open.length, at_ms: Date.now() }); } catch (_) {} }
  return json(200, out);
};
