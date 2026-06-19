// availability.js — the keystone of the self-scheduling autopilot.
//
// Turns a customer's stated availability (the `AVAIL: …\nUNAVAIL: …` text the
// availability cascade / portal / office manual-entry write into
// jobs.customer_preference_text) into a constraint set the scheduler can
// HONOR when picking a day to offer the tech.
//
// Before this, the auto-booker only checked TECH availability and ignored what
// the customer said. This module is what makes the tech offer respect "Mondays
// after 2, not Fridays."  Day-of-week is the 80% case and is what we parse;
// specific calendar dates ("the 24th") are a future add (noted below).
//
// Pure + dependency-free so it's trivially testable:  node availability.js --test

const DOW = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

// Day-of-week (0=Sun) for a date, computed in America/Chicago so it matches the
// scheduler's frame regardless of where the loop process runs.
function ctDow(date) {
  const d = date instanceof Date ? date : new Date(date);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' })
    .format(d).toLowerCase();
  return DOW[wd] != null ? DOW[wd] : d.getDay();
}

// Pull day-of-week tokens out of a free-text fragment.
function dayTokens(s) {
  const out = new Set();
  const t = String(s || '').toLowerCase();
  for (const [k, v] of Object.entries(DOW)) {
    // optional trailing "s" so plurals match ("fridays", "mondays")
    if (new RegExp(`\\b${k}s?\\b`).test(t)) out.add(v);
  }
  if (/\bweekends?\b/.test(t)) { out.add(0); out.add(6); }
  if (/\bweekdays?\b/.test(t)) { [1, 2, 3, 4, 5].forEach((d) => out.add(d)); }
  // "anytime / any day / whenever / flexible / open / every day" = no restriction
  if (/\b(any ?time|any ?day|when ?ever|flexible|every ?day)\b/.test(t)) {
    [0, 1, 2, 3, 4, 5, 6].forEach((d) => out.add(d));
  }
  return out;
}

// Split "AVAIL: …  UNAVAIL: …" into its two halves. If there are no markers,
// the whole string is treated as availability text.
function splitSections(text) {
  const t = String(text || '');
  // \b before AVAIL so it does NOT match the "AVAIL" inside "UNAVAIL".
  const am = t.match(/\bAVAIL[:\-]\s*([\s\S]*?)(?:\bUNAVAIL[:\-]|$)/i);
  const um = t.match(/\bUNAVAIL[:\-]\s*([\s\S]*)/i);
  let avail = am ? am[1] : '';
  let unavail = um ? um[1] : '';
  if (!am && !um && t.trim()) avail = t;
  return { avail: avail.trim(), unavail: unavail.trim() };
}

/**
 * Parse a customer's availability into a constraint set.
 * @param {string} prefText  jobs.customer_preference_text (AVAIL/UNAVAIL packed)
 * @param {object} [grid]    optional structured customer_availability_grid (future)
 * @returns {{
 *   hasConstraints: boolean,
 *   allowedDays: Set<number>|null,   // days they named as good (null = none specified)
 *   blockedDays: Set<number>,        // days they said they can't
 *   wantsMorning: boolean,           // soft time-of-day hint
 *   wantsAfternoon: boolean,
 *   raw: {avail:string, unavail:string},
 *   dayOk: (date:Date|number|string)=>boolean,   // MAIN API: does this date satisfy them?
 *   describe: ()=>string
 * }}
 */
export function parseAvailability(prefText, grid) {
  // A structured grid, if present, wins — but we accept loose shapes.
  let gridAllowed = null;
  if (grid && typeof grid === 'object') {
    try {
      const g = typeof grid === 'string' ? JSON.parse(grid) : grid;
      if (Array.isArray(g.allowedDays)) gridAllowed = new Set(g.allowedDays.map(Number));
    } catch (_) {}
  }

  const { avail, unavail } = splitSections(prefText);
  const allowed = gridAllowed || dayTokens(avail);
  const blocked = dayTokens(unavail);
  const wantsMorning = /\bmorning/i.test(avail);
  const wantsAfternoon = /\bafternoon|\bafter\s*\d|\bpm\b/i.test(avail);

  const hasConstraints = (allowed && allowed.size > 0) || blocked.size > 0;

  return {
    hasConstraints,
    allowedDays: allowed && allowed.size ? allowed : null,
    blockedDays: blocked,
    wantsMorning,
    wantsAfternoon,
    raw: { avail, unavail },

    // The one method the scheduler calls: would this date satisfy what the
    // customer told us? Hard constraints only (blocked days, named days).
    // Returns true when we have nothing to go on (don't over-restrict).
    dayOk(date) {
      const dow = ctDow(date);
      if (blocked.has(dow)) return false;                       // they said they can't
      if (allowed && allowed.size && !allowed.has(dow)) return false; // named days, this isn't one
      return true;
    },

    describe() {
      const names = (set) => [...set].sort().map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(',');
      const parts = [];
      if (allowed && allowed.size) parts.push('ok:' + names(allowed));
      if (blocked.size) parts.push('no:' + names(blocked));
      if (wantsMorning) parts.push('AM');
      if (wantsAfternoon) parts.push('PM');
      return parts.join(' ') || 'no stated availability';
    },
  };
}

export default { parseAvailability };

// ── self-test:  node availability.js --test ─────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('availability.js') && process.argv.includes('--test')) {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };
  // a known Thursday and Friday in CT
  const thu = new Date('2026-06-18T15:00:00Z'); // Thu
  const fri = new Date('2026-06-19T15:00:00Z'); // Fri
  const sat = new Date('2026-06-20T15:00:00Z'); // Sat

  let a = parseAvailability('AVAIL: Mon, Wed, Thu after 2\nUNAVAIL: Fri, weekends');
  ok(a.hasConstraints, 'has constraints');
  ok(a.dayOk(thu) === true, 'Thu allowed (named)');
  ok(a.dayOk(fri) === false, 'Fri blocked');
  ok(a.dayOk(sat) === false, 'Sat blocked (weekends)');
  ok(a.wantsAfternoon === true, 'afternoon hint from "after 2"');

  let b = parseAvailability('UNAVAIL: Fridays');
  ok(b.dayOk(thu) === true, 'Thu ok when only Fri blocked');
  ok(b.dayOk(fri) === false, 'Fri blocked (only-block case)');

  let c = parseAvailability('AVAIL: anytime');
  ok(c.dayOk(thu) && c.dayOk(fri) && c.dayOk(sat), 'anytime = all days ok');

  let d = parseAvailability('');
  ok(d.hasConstraints === false, 'empty = no constraints');
  ok(d.dayOk(fri) === true, 'no constraints = every day ok (do not over-restrict)');

  let e = parseAvailability(null, { allowedDays: [1, 3] }); // grid Mon/Wed
  ok(e.dayOk(new Date('2026-06-15T15:00:00Z')) === true, 'grid: Mon ok');   // Mon
  ok(e.dayOk(thu) === false, 'grid: Thu not in [Mon,Wed]');

  console.log(`availability.js self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
