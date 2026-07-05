// claim-clock — the office game for Danielle (Teddy 7/5). Her "reports = pay":
// the TDR IS the claim, and nothing gets paid until she files it. The clock
// starts the moment a job is completed and stops when she submits the warranty
// claim. Score = claims filed + speed + same-day streak. Points only (no bonus $
// yet, Teddy's call). Opponent = the clock + last week + her own record.
//
// Single source of truth: list_warranty_pipeline already carries per warranty job
//   job_completed_at (clock start) + warranty_submitted_at (clock stop).
//
//   GET [?days=30]  -> { ok, today, week, on_clock[], best, generated_ct }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PTS_FILED = 10;    // every claim out the door
const PTS_SAMEDAY = 5;   // filed the same day the job finished
const PTS_FAST = 3;      // filed within 2 hours

// Forward-only line: MeisterTask is the accurate record for pre-Ant work, so the
// game only counts jobs completed on/after go-live — a clean slate, no stale
// backlog polluting the board. Change this one date if go-live shifts (?since= to override).
const GO_LIVE = '2026-07-05';

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function ms(x) { if (x == null || x === '') return 0; if (typeof x === 'number') return x < 1e12 ? x * 1000 : x; const t = Date.parse(x); return isNaN(t) ? 0 : t; }
function ctDay(t) { if (!t) return ''; try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); } catch (_) { return ''; } }
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }
function ctMondayMs() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => +(p.find((x) => x.type === t) || {}).value;
  const y = g('year'), mo = g('month'), d = g('day');
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const back = probe.getUTCDay() === 0 ? 6 : probe.getUTCDay() - 1;
  return Date.UTC(y, mo - 1, d - back, 5, 0, 0); // ~CT Monday 00:00
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const days = Math.max(7, Math.min(120, parseInt(q.days, 10) || 45));
  const sinceMs = ms((q.since || GO_LIVE) + 'T00:00:00-05:00'); // CT go-live line

  let jobs = [];
  try {
    const d = await fetch(`${XANO}/list_warranty_pipeline?days_back=${days}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    jobs = (d && d.jobs) || [];
  } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  const now = Date.now();
  const todayCT = ctDay(now);
  const monday = ctMondayMs();

  const filed = [];     // { job_id, hours, completed, submitted, sameDay, fast, day }
  const onClock = [];   // completed warranty jobs still awaiting a claim
  for (const jb of jobs) {
    const vendor = String(jb.warranty_company || '').trim();
    if (!vendor) continue; // warranty jobs only
    const completed = ms(jb.job_completed_at);
    const submitted = ms(jb.warranty_submitted_at);
    if (completed && completed < sinceMs) continue; // pre-Ant work lives in MeisterTask — skip
    if (completed && submitted) {
      const hours = Math.max(0, (submitted - completed) / 3600000);
      filed.push({ job_id: jb.id, hours, completed, submitted, day: ctDay(submitted), sameDay: ctDay(submitted) === ctDay(completed), fast: hours <= 2 });
    } else if (completed && !submitted) {
      onClock.push({ job_id: jb.id, customer: `${(jb.customer_first || '').trim()} ${(jb.customer_last || '').trim()}`.trim() || 'customer', claim: String(jb.claim_number || ''), vendor, age_hours: round1((now - completed) / 3600000) });
    }
  }

  const pts = (f) => PTS_FILED + (f.sameDay ? PTS_SAMEDAY : 0) + (f.fast ? PTS_FAST : 0);

  // today
  const filedToday = filed.filter((f) => f.day === todayCT);
  const today = {
    filed: filedToday.length,
    points: filedToday.reduce((s, f) => s + pts(f), 0),
    median_hours: round1(median(filedToday.map((f) => f.hours))),
    same_day: filedToday.filter((f) => f.sameDay).length,
    on_clock: onClock.length,
  };

  // week (CT Monday →)
  const filedWeek = filed.filter((f) => f.submitted >= monday);
  const daysWithFills = new Set(filed.map((f) => f.day));
  // streak = consecutive CT days ending today (or yesterday) with ≥1 filed
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(now - i * 86400000);
    const key = ctDay(d.getTime());
    if (daysWithFills.has(key)) streak++;
    else if (i === 0) continue; // today not filed yet — don't break the run
    else break;
  }
  const week = {
    filed: filedWeek.length,
    points: filedWeek.reduce((s, f) => s + pts(f), 0),
    median_hours: round1(median(filedWeek.map((f) => f.hours))),
    same_day_pct: filedWeek.length ? Math.round((filedWeek.filter((f) => f.sameDay).length / filedWeek.length) * 100) : null,
    streak,
  };

  // personal best (fastest single claim in the window)
  let best = null;
  for (const f of filed) if (best == null || f.hours < best.hours) best = { job_id: f.job_id, hours: round1(f.hours) };

  onClock.sort((a, b) => (b.age_hours || 0) - (a.age_hours || 0)); // oldest on the clock first

  return j(200, {
    ok: true, generated_ct: todayCT, window_days: days,
    today, week, best,
    on_clock: onClock.slice(0, 25),
    scoring: { filed: PTS_FILED, same_day: PTS_SAMEDAY, fast_under_2h: PTS_FAST },
  });
};
