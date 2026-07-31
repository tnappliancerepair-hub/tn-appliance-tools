// hcp-distill — turn the 49k-job HCP archive into compact, structured MODEL
// knowledge (the breadth layer of the Knowledge Engine). NOT a vector store:
// distill, don't embed. For each real job we mine the model number + brand +
// appliance + the complaint + any part number, and roll it up by platform family
// into "on this exact model we've been out N times; common complaints X/Y; parts
// seen Z." That's what a tech wants and it's reliable to store + instant to read.
//
// Why this dodges the hiccups:
//   • READ-ONLY against hcp_archive (Supabase). The write wobble that stalled the
//     embed loop is on the vectors table; distillation never writes there.
//   • Resumable, keyset by id, state in the Xano vault (reliable) — survives any
//     single page failing.
//   • OFFLINE tool: its compiled output is REVIEWED, then committed into the
//     bundled model-knowledge.json. Noisy extraction never reaches the live brain
//     unreviewed; the brain's read path stays bundled + rock-solid.
//   • HIGH-PRECISION extraction (labeled "model:" first) — fewer, correct models
//     beat many garbage keys.
//
//   GET ?secret=<admin>&grind=8    scan N pages (96 jobs/page), accumulate
//   GET ?secret=<admin>&status=1   cursor + models-so-far
//   GET ?secret=<admin>&compile=1[&min=2]  emit the model-knowledge.json `models` map
//   GET ?secret=<admin>&reset=1    reset the distill cursor + accumulator
'use strict';
const { getSecret, setSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');
const mk = require('./_lib/ant/model-knowledge');

const PAGE = 96;
const STATE_KEY = 'HCP_DISTILL_STATE';
const MAX_MODELS = 4000; // bound the vault blob; prune lowest-seen beyond this
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.config = { timeout: 26 };

const BRANDS = ['whirlpool', 'maytag', 'kitchenaid', 'amana', 'jenn-air', 'jennair', 'ge', 'hotpoint', 'cafe', 'monogram', 'profile', 'lg', 'samsung', 'frigidaire', 'electrolux', 'bosch', 'kenmore', 'ge profile', 'speed queen', 'fisher', 'haier', 'sub-zero', 'subzero', 'wolf', 'thermador', 'viking', 'dacor', 'miele'];
const APPLS = [['dishwasher', /\bdish\s?washer|\bdishwasher\b/i], ['dryer', /\bdryer\b/i], ['washer', /\bwash(er|ing machine)\b/i], ['refrigerator', /\brefrigerat|\bfridge\b|\bfreezer\b|\bice\s?maker\b/i], ['range', /\brange\b|\bstove\b|\bcook\s?top\b|\bcooktop\b/i], ['oven', /\boven\b|\bwall oven\b/i], ['microwave', /\bmicrowave\b/i], ['disposal', /\bdisposal\b/i], ['vent hood', /\bvent hood\b|\brange hood\b/i]];
const SYMPTOMS = [
  ['not cooling', /not cool|won'?t cool|no(t)? cold|warm (fridge|freezer)|isn'?t cooling/i],
  ["won't drain", /won'?t drain|not drain|no drain|water (left )?standing|full of water/i],
  ['no heat', /no heat|not heat|won'?t heat|not getting hot|not drying/i],
  ['leaking', /leak(ing|s|ed)?|water on (the )?floor/i],
  ["won't start", /won'?t start|not start|no power|dead|won'?t turn on|won'?t power/i],
  ['not spinning', /won'?t spin|not spin|no spin/i],
  ['ice maker', /ice\s?maker|not making ice|no ice/i],
  ['noisy', /loud|noisy|grinding|squeal|banging|knocking/i],
  ['not agitating', /won'?t agitate|not agitat/i],
  ['door', /door (won'?t|not) (close|latch|seal)|latch broke|hinge/i],
  ['not dispensing', /not dispens|won'?t dispense/i],
  ['overheating', /overheat|too hot|burning smell/i],
  ['error code', /error code|fault code|\bcode\s?[a-z]?\d/i],
];

// Explicit-label model first (highest precision), then a strong standalone pattern
// (≥2 letters AND ≥3 digits, 7-16 chars). Returns normalized unique model tokens.
function extractModels(text) {
  const t = String(text || '');
  const out = new Set();
  let m;
  const labeled = /\bmodel\s*(?:#|number|no\.?|:)?\s*([A-Z][A-Z0-9][A-Z0-9\-\/]{4,15})/gi;
  while ((m = labeled.exec(t))) { const n = mk.normModel(m[1]); if (n.length >= 6 && /[A-Z]/.test(n) && /\d/.test(n)) out.add(n); }
  if (!out.size) {
    const bare = /\b([A-Z]{2,5}\d{3,7}[A-Z0-9]{0,6})\b/g;
    const up = t.toUpperCase();
    while ((m = bare.exec(up))) { const n = mk.normModel(m[1]); if (n.length >= 7 && n.length <= 16 && /\d{3,}/.test(n)) out.add(n); }
  }
  return [...out].slice(0, 3); // a job is usually one machine
}
function detectBrand(text) { const t = String(text || '').toLowerCase(); for (const b of BRANDS) if (t.includes(b)) return b === 'jennair' ? 'jenn-air' : (b === 'subzero' ? 'sub-zero' : b); return ''; }
function detectAppliance(text) { for (const [name, re] of APPLS) if (re.test(text)) return name; return ''; }
function extractSymptoms(text) { const hit = []; for (const [name, re] of SYMPTOMS) if (re.test(text)) hit.push(name); return hit; }
function extractParts(text) {
  const out = new Set(); let m;
  const re = /\b(W\d{7,10}|WP[A-Z0-9]{6,10}|WR\d{2}X\d{4,6}|DA\d{2}-\d{4,6}[A-Z]?|DC\d{2}-\d{4,6}[A-Z]?|EBR\d{6,8}|AP\d{6,8}|PS\d{6,8}|\d{6,9})\b/gi;
  const up = String(text || '').toUpperCase();
  while ((m = re.exec(up))) { const p = m[1]; if (/[A-Z]/.test(p) || p.length >= 6) out.add(p); }
  return [...out].filter((p) => /[A-Z]/.test(p)).slice(0, 3); // require a letter -> real appliance part, not a phone/zip
}

async function readState() {
  try { const raw = await getSecret(STATE_KEY); const s = raw ? JSON.parse(raw) : null; if (s && s.models) return s; } catch (_) {}
  return { last_id: 0, jobs_scanned: 0, models_hit: 0, done: false, models: {} };
}
function pruneIfHuge(models) {
  const keys = Object.keys(models);
  if (keys.length <= MAX_MODELS) return models;
  const sorted = keys.sort((a, b) => (models[b].n || 0) - (models[a].n || 0)).slice(0, MAX_MODELS);
  const out = {}; for (const k of sorted) out[k] = models[k]; return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await sb.isConnected())) return json(200, { ok: false, error: 'supabase not configured' });

  if (q.reset === '1') { await setSecret(STATE_KEY, JSON.stringify({ last_id: 0, jobs_scanned: 0, models_hit: 0, done: false, models: {} })); return json(200, { ok: true, note: 'distill state reset' }); }

  const st = await readState();
  if (q.status === '1') return json(200, { ok: true, last_id: st.last_id, jobs_scanned: st.jobs_scanned, models_known: Object.keys(st.models).length, done: st.done });

  if (q.compile === '1') {
    const min = Math.max(1, parseInt(q.min, 10) || 2);
    const models = {};
    for (const [fam, v] of Object.entries(st.models)) {
      if ((v.n || 0) < min) continue;
      const syms = Object.entries(v.syms || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
      const parts = Object.entries(v.parts || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const failures = parts.map(([pn, n]) => ({ component: syms[0] || 'reported failure', part: pn, cause: syms.join(', '), count: n }));
      models[fam] = { brand: v.brand || '', appliance: v.appliance || '', seen_n: v.n, symptoms: syms, failures };
    }
    return json(200, { ok: true, min, count: Object.keys(models).length, models });
  }

  // grind
  const grind = Math.max(1, Math.min(20, parseInt(q.grind, 10) || 8));
  let pages = 0, scanned = 0, hits = 0;
  try {
    for (let i = 0; i < grind; i++) {
      const rows = await sb.select('hcp_archive', { kind: 'eq.job', id: 'gt.' + st.last_id, order: 'id.asc', limit: PAGE, select: 'id,title,d:data->>description,n:data->>notes' });
      if (!rows || !rows.length) { st.done = true; break; }
      for (const r of rows) {
        const text = [r.title, r.d, r.n].filter(Boolean).join(' ');
        st.jobs_scanned++; scanned++;
        const models = extractModels(text);
        if (!models.length) continue;
        const brand = detectBrand(text), appliance = detectAppliance(text);
        const syms = extractSymptoms(text), parts = extractParts(text);
        for (const model of models) {
          const fam = mk.familyOf(model);
          if (fam.length < 5) continue;
          const g = st.models[fam] || (st.models[fam] = { brand, appliance, n: 0, syms: {}, parts: {} });
          g.n++; hits++;
          if (!g.brand && brand) g.brand = brand;
          if (!g.appliance && appliance) g.appliance = appliance;
          for (const s of syms) g.syms[s] = (g.syms[s] || 0) + 1;
          for (const p of parts) g.parts[p] = (g.parts[p] || 0) + 1;
        }
      }
      st.last_id = rows[rows.length - 1].id;
      pages++;
      if (rows.length < PAGE) { st.done = true; break; }
      await sleep(80);
    }
  } catch (e) {
    st.models = pruneIfHuge(st.models);
    await setSecret(STATE_KEY, JSON.stringify(st));
    return json(200, { ok: false, error: String(e.message || e), jobs_scanned: st.jobs_scanned, at_id: st.last_id, note: 'state saved — safe to re-run' });
  }
  st.models = pruneIfHuge(st.models);
  st.models_hit = (st.models_hit || 0) + hits;
  await setSecret(STATE_KEY, JSON.stringify(st));
  return json(200, { ok: true, pages_run: pages, jobs_this_run: scanned, model_hits_this_run: hits, jobs_scanned: st.jobs_scanned, models_known: Object.keys(st.models).length, at_id: st.last_id, done: !!st.done, next: st.done ? 'complete — &compile=1 to emit' : 'repeat &grind=' + grind });
};
