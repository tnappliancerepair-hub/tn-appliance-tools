// squaretrade-slot-backfill — recover the arrival WINDOW onto SquareTrade jobs that
// landed BEFORE the intake fix (Danielle 2026-07-15: "we accept the jobs but don't put
// them in the correct slot" — a major issue this week). The window the customer agreed
// to with SquareTrade ("8:00 - 10:00") was captured only inside notes_internal, and
// scheduled_start was hardcoded to 8am. This reads the "Schedule Period:" out of each
// job's notes, then:
//   - writes service_eta_window (the clean window label)
//   - writes an "AVAIL: SquareTrade appointment ..." line into customer_preference_text
//     so the promised window shows on the tile (never clobbers a customer's OWN texted
//     availability — only fills blanks or refreshes a prior SquareTrade line)
//   - for jobs NOT yet accepted (needs_more_info: not on anyone's day), corrects
//     scheduled_start's TIME-OF-DAY to the window start on the same day. Jobs already
//     accepted/scheduled are Danielle's to move — we only surface the window for those.
//
//   GET ?secret=<admin>[&days=45][&max=400]   DRY  — show the plan
//   GET ?secret=<admin>&confirm=1             LIVE — apply
'use strict';
exports.config = { timeout: 26 };
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const s = (v) => String(v == null ? '' : v).trim();

// Same window parse as the live parser: "8:00 - 10:00" -> start "08:00" + clean label.
function parseWindow(period) {
  const p = s(period);
  if (!p) return { startHHMM: '', window: '' };
  const m = p.match(/(\d{1,2}):(\d{2})/);
  const startHHMM = m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : '';
  return { startHHMM, window: p.replace(/\s*-\s*/, ' - ') };
}
// CT calendar date (Y,M,D) of an instant.
function ctDate(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day };
}
// CT hour of an instant (0-23).
function ctHour(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).formatToParts(new Date(ms)).find((x) => x.type === 'hour');
  return p ? (+p.value % 24) : -1;
}
// Build a ms for a CT wall time on (y,mo,d) at HH:MM, matching the intake's convention
// (parse-as-UTC then +5h = CDT). Summer-correct, consistent with how new jobs are stamped.
function ctWallToMs(y, mo, d, hh, mm) { return Date.UTC(y, mo - 1, d, hh, mm, 0) + 5 * 3600 * 1000; }

async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const live = q.confirm === '1';
  const max = Math.min(parseInt(q.max, 10) || 400, 2400);

  let jobs = [];
  try { for (let pg = 1; pg <= 8 && jobs.length < max; pg++) { const rows = await listPage(7, 300, pg); jobs = jobs.concat(rows); if (rows.length < 300) break; } }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const ACTIVE = new Set(['needs_more_info', 'scheduled', 'not_ready', 'needs_scheduled', 'booked']);
  const plan = []; let fixed = 0; const fails = []; let surfaced = 0, reslotted = 0;
  for (const j of jobs) {
    const isSP = /servicepower/i.test(s(j.source_type) + s(j.intake_source)) || /square/i.test(s(j.warranty_company));
    if (!isSP) continue;
    const ss = s(j.scheduling_status).toLowerCase();
    if (!ACTIVE.has(ss) || /cancel/i.test(s(j.current_status))) continue;
    const m = s(j.notes_internal).match(/Schedule Period:\s*([0-9:]{1,5}\s*-\s*[0-9:]{1,5})/i);
    if (!m) continue;
    const { startHHMM, window } = parseWindow(m[1]);
    if (!window) continue;

    const patch = {};
    // 1) window label
    if (s(j.service_eta_window) !== window) patch.service_eta_window = window;
    // 2) availability line on the tile — fill blanks or refresh a prior SquareTrade line,
    //    NEVER overwrite a customer's own texted availability.
    const curPref = s(j.customer_preference_text);
    const availLine = 'AVAIL: SquareTrade window: ' + window;
    if (!curPref || /SquareTrade (window|appointment)/i.test(curPref)) {
      if (curPref !== availLine) patch.customer_preference_text = availLine;
    }
    // 3) correct the SLOT only for not-yet-accepted jobs sitting at the wrong 8am default.
    let slotNote = '';
    if (ss === 'needs_more_info' && startHHMM && startHHMM !== '08:00') {
      const cur = Number(j.scheduled_start) || 0;
      if (cur > 0 && ctHour(cur) === 8) {   // only touch the hardcoded 8am default
        const { y, mo, d } = ctDate(cur);
        const [hh, mm] = startHHMM.split(':').map((x) => parseInt(x, 10));
        const target = ctWallToMs(y, mo, d, hh, mm);
        if (target !== cur) { patch.scheduled_start = target; slotNote = `8:00 -> ${startHHMM} CT`; reslotted++; }
      }
    }

    if (!Object.keys(patch).length) continue;
    if (patch.service_eta_window || patch.customer_preference_text) surfaced++;
    plan.push({ job: j.id, status: ss, window, slot: slotNote || (ss === 'needs_more_info' ? '(already correct/na)' : 'surfaced-only (Danielle owns the slot)'), patch });
    if (live) {
      try { const r = await fetch(`${META}/table/7/content/${j.id}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }); if (r.ok) { fixed++; await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'squaretrade_slot_backfilled', metadata: { job_id: j.id, patch, window, at_ms: Date.now() } }) }).catch(() => {}); } else fails.push({ job: j.id, status: r.status }); } catch (e) { fails.push({ job: j.id, err: String(e.message || e) }); }
    }
  }
  return json(200, { ok: true, mode: live ? 'LIVE' : 'DRY', scanned: jobs.length, corrections: plan.length, surfaced, reslotted, fixed: live ? fixed : 0, failed: fails.length, plan: plan.slice(0, 120) });
};
