// ============================================================
// APPLIANCE ANT — MOCK SCHEDULER ENGINE
// Pure logic. No DOM. Ports directly into netlify/functions/mock-scheduler.js
// ============================================================

const DAY_START = 8 * 60;   // 08:00
const DAY_END   = 17 * 60;  // 17:00
const SERVICE_MIN = 30;     // 30 min per job
const CAP = 6;              // max jobs/tech/day
const AVG_MPH = 35;
const MIN_HOP_MIN = 8;      // realistic minimum drive between two distinct stops

// --- Town centroids (mock geocode). In Netlify port, real lat/lng or geocode. ---
const TOWNS = {
  // TN
  "Antioch":          [36.060, -86.672],
  "South Nashville":  [36.130, -86.770],
  "Nashville":        [36.162, -86.781],
  "West Nashville":   [36.150, -86.860],
  "Murfreesboro":     [35.846, -86.390],
  "Hermitage":        [36.187, -86.603],
  "Mt Juliet":        [36.200, -86.519],
  "Clarksville":      [36.530, -87.359],
  "Bellevue":         [36.075, -86.945],
  "Pegram":           [36.100, -87.050],
  "Ashland City":     [36.274, -87.064],
  "Kingston Springs": [36.100, -87.114],
  "Joelton":          [36.310, -86.890],
  // LA
  "New Orleans":      [29.951, -90.071],
  "Metairie":         [29.984, -90.153],
  "Kenner":           [29.994, -90.241],
  "Hammond":          [30.504, -90.461],
  "Ponchatoula":      [30.438, -90.441],
  "Slidell":          [30.275, -89.781],
  "Covington":        [30.475, -90.101],
  "Mandeville":       [30.358, -90.066],
  "Walker":           [30.485, -90.861],
  "Baton Rouge":      [30.451, -91.187],
  "Denham Springs":   [30.486, -90.957],
  "Gonzales":         [30.238, -90.920],
};

// --- Cluster routing (mirrors get_tech_for_zip). town -> techId ---
const TOWN_TECH = {
  "Antioch": 2, "South Nashville": 2, "Nashville": 2, "Murfreesboro": 2,
  "Hermitage": 2, "Mt Juliet": 2,
  "Clarksville": 4, "Bellevue": 4, "Pegram": 4, "Ashland City": 4,
  "Kingston Springs": 4, "Joelton": 4, "West Nashville": 4,
  "New Orleans": 3, "Metairie": 3, "Kenner": 3,
  "Hammond": 5, "Ponchatoula": 5, "Slidell": 5, "Covington": 5, "Mandeville": 5,
  "Walker": 6, "Baton Rouge": 6, "Denham Springs": 6, "Gonzales": 6,
};

const TECHS = {
  2: { name: "Jimmy", region: "TN", home: "Antioch" },
  4: { name: "Lee",   region: "TN", home: "Bellevue" },
  3: { name: "Andre", region: "LA", home: "New Orleans" },
  5: { name: "Billy", region: "LA", home: "Hammond" },
  6: { name: "John",  region: "LA", home: "Walker" },
};

// --- helpers ---
function haversineMiles(a, b) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat/2)**2 +
            Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function driveMin(townA, townB) {
  if (townA === townB) return 0;
  const a = TOWNS[townA], b = TOWNS[townB];
  if (!a || !b) return MIN_HOP_MIN;
  const mins = (haversineMiles(a, b) / AVG_MPH) * 60;
  return Math.max(MIN_HOP_MIN, Math.round(mins));
}
function driveMiles(townA, townB) {
  if (townA === townB || !TOWNS[townA] || !TOWNS[townB]) return 0;
  return haversineMiles(TOWNS[townA], TOWNS[townB]);
}

// Forward pass: compute times for an ordered route from home.
// Returns {feasible, stops:[{job,arrive,start,end}], totalDrive, dayEnd} or feasible:false
function evaluateRoute(home, route) {
  let curTown = home, curTime = DAY_START, totalDrive = 0;
  const stops = [];
  for (const job of route) {
    const d = driveMin(curTown, job.town);
    totalDrive += d;
    const arrive = curTime + d;
    let start;
    if (job.window) {
      start = Math.max(arrive, job.window[0]);
      if (start > job.window[1]) return { feasible: false };       // missed the band
      if (start + SERVICE_MIN > DAY_END) return { feasible: false };
    } else {
      start = Math.max(arrive, DAY_START);
      if (start + SERVICE_MIN > DAY_END) return { feasible: false };
    }
    const end = start + SERVICE_MIN;
    stops.push({ job, arrive, start, end, driveIn: d });
    curTown = job.town; curTime = end;
  }
  return { feasible: true, stops, totalDrive, dayEnd: curTime };
}

// Build one tech's day. anchors placed by band-start; flexibles cheapest-insertion.
function buildDay(home, jobs) {
  const anchored = jobs.filter(j => j.window)
    .sort((a, b) => a.window[0] - b.window[0] || a.window[1] - b.window[1]);
  const flexible = jobs.filter(j => !j.window);

  let route = [];
  const overflow = [];

  // 1) seat anchors in band order; drop any that can't fit (conflict) to overflow
  for (const a of anchored) {
    if (route.length >= CAP) { overflow.push({ job: a, reason: "cap" }); continue; }
    const test = evaluateRoute(home, [...route, a]);
    if (test.feasible) route.push(a);
    else overflow.push({ job: a, reason: "window-conflict" });
  }

  // 2) cheapest-insertion for flexibles
  let pending = [...flexible];
  while (pending.length && route.length < CAP) {
    let best = null;
    for (let pi = 0; pi < pending.length; pi++) {
      const job = pending[pi];
      const baseEval = evaluateRoute(home, route);
      const baseDrive = baseEval.feasible ? baseEval.totalDrive : Infinity;
      for (let pos = 0; pos <= route.length; pos++) {
        const trial = [...route.slice(0, pos), job, ...route.slice(pos)];
        const ev = evaluateRoute(home, trial);
        if (!ev.feasible) continue;
        const added = ev.totalDrive - baseDrive;
        if (!best || added < best.added) best = { pi, pos, added };
      }
    }
    if (!best) break; // nothing else fits
    const job = pending.splice(best.pi, 1)[0];
    route = [...route.slice(0, best.pos), job, ...route.slice(best.pos)];
  }
  // remaining flexibles overflow
  for (const j of pending) overflow.push({ job: j, reason: route.length >= CAP ? "cap" : "no-fit" });

  const finalEval = evaluateRoute(home, route);
  return { eval: finalEval, overflow };
}

function scheduleAll(jobs) {
  // route every job to a tech via cluster map
  const byTech = {};
  const unrouted = [];
  for (const j of jobs) {
    const tid = TOWN_TECH[j.town];
    if (!tid) { unrouted.push(j); continue; }
    (byTech[tid] = byTech[tid] || []).push(j);
  }
  const result = {};
  for (const tid of Object.keys(byTech)) {
    const t = TECHS[tid];
    result[tid] = { tech: t, ...buildDay(t.home, byTech[tid]) };
  }
  return { result, unrouted };
}

module.exports = { scheduleAll, TECHS, TOWN_TECH, TOWNS, DAY_START, DAY_END };

// ---- quick self-test when run directly ----
if (require.main === module) {
  const fmt = m => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const SAMPLE = [
    { id: 101, customer: "R. Mathis",   town: "Murfreesboro", type: "squaretrade", window: [8*60, 12*60] },
    { id: 102, customer: "T. Cole",     town: "Hermitage",    type: "squaretrade", window: [10*60, 11*60] },
    { id: 103, customer: "D. Pham",     town: "Mt Juliet",    type: "squaretrade", window: [12*60, 16*60] },
    { id: 104, customer: "G. Ruiz",     town: "Antioch",      type: "selfpay" },
    { id: 105, customer: "S. Bell",     town: "South Nashville", type: "ahs" },
    { id: 106, customer: "K. Long",     town: "Murfreesboro", type: "selfpay" },
    { id: 107, customer: "A. Webb",     town: "Hermitage",    type: "ahs" },
    { id: 108, customer: "M. Frost",    town: "Antioch",      type: "selfpay" },   // 8th -> overflow
    { id: 201, customer: "L. Boudreaux", town: "Hammond",     type: "squaretrade", window: [8*60, 12*60] },
    { id: 202, customer: "P. Hebert",   town: "Slidell",      type: "selfpay" },
    { id: 203, customer: "C. Landry",   town: "Covington",    type: "ahs" },
    { id: 301, customer: "B. Trahan",   town: "Metairie",     type: "squaretrade", window: [13*60, 15*60] },
    { id: 302, customer: "J. Comeaux",  town: "Kenner",       type: "selfpay" },
  ];
  const { result, unrouted } = scheduleAll(SAMPLE);
  for (const tid of Object.keys(result)) {
    const r = result[tid];
    if (!r.eval.feasible) { console.log(`\n${r.tech.name}: INFEASIBLE`); continue; }
    console.log(`\n=== ${r.tech.name} (${r.tech.region}) — home ${r.tech.home} ===`);
    let miles = 0, prev = r.tech.home;
    for (const s of r.eval.stops) {
      miles += driveMiles(prev, s.job.town); prev = s.job.town;
      console.log(`  ${fmt(s.start)}-${fmt(s.end)}  ${s.job.type.padEnd(11)} ${s.job.customer} (${s.job.town})` +
        (s.job.window ? `  [win ${fmt(s.job.window[0])}-${fmt(s.job.window[1])}]` : ""));
    }
    console.log(`  jobs:${r.eval.stops.length}  drive:${r.eval.totalDrive}min ~${miles.toFixed(1)}mi  ends:${fmt(r.eval.dayEnd)}`);
    r.overflow.forEach(o => console.log(`  OVERFLOW (${o.reason}): ${o.job.customer} ${o.job.town}`));
  }
  if (unrouted.length) console.log("\nUNROUTED:", unrouted.map(j=>j.town));
}
