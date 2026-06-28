// meistertask-repair-menu — mines the archived diagnosis blocks (the "DIAGNOSIS /
// PARTS THAT FAILED / CAUSE / LABOR HOURS" + "Diagnosis: / Parts: / Time:" TDR
// comments) into a COMMON-REPAIR list: canonical repair, appliance, how often it
// shows up, typical labor time, and the parts seen. That's the seed for the
// FLAT-RATE job menu (priced by the job at ~$100/hr-equiv, not hourly).
//   GET ?secret=<admin>[&min=2]   (min = min occurrences to include)
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 500;

// canonical repair -> [appliance, regex]. Order = specific first; first hit wins.
const REPAIRS = [
  ['Dryer heating element', 'Dryer', /heating element|heat element/i],
  ['Dryer belt', 'Dryer', /\bbelt\b/i],
  ['Dryer thermal fuse / thermostat', 'Dryer', /thermal fuse|cycling thermostat|hi[- ]?limit/i],
  ['Bake / broil element', 'Range/Oven', /bake element|broil element|oven element/i],
  ['Surface burner / element / switch', 'Range/Oven', /surface (element|burner)|burner element|infinite switch|surface .*switch/i],
  ['Oven igniter', 'Range/Oven', /igniter|ignitor/i],
  ['Ice maker', 'Refrigerator', /ice ?maker/i],
  ['Fridge water inlet valve', 'Refrigerator', /water (inlet )?valve|inlet valve|water valve/i],
  ['Fridge water line / dispenser', 'Refrigerator', /water (line|tube)|dispenser/i],
  ['Evaporator fan', 'Refrigerator', /evap(orator)? ?fan/i],
  ['Condenser fan', 'Refrigerator', /condenser fan/i],
  ['Defrost system (heater/thermostat)', 'Refrigerator', /defrost/i],
  ['Compressor / sealed system', 'Refrigerator', /compressor|sealed system|start relay|overload/i],
  ['Fridge thermostat / temp control', 'Refrigerator', /temp(erature)? control|cold control|fridge thermostat/i],
  ['Door gasket / seal', 'Refrigerator', /gasket|door seal/i],
  ['Washer drain pump', 'Washer', /drain pump/i],
  ['Washer door lock / lid switch', 'Washer', /door (lock|latch)|lid (lock|switch)/i],
  ['Washer water inlet valve', 'Washer', /water (inlet )?valve|fill valve/i],
  ['Washer drive motor / clutch', 'Washer', /drive motor|wash motor|clutch|motor coupler/i],
  ['Washer bearing / spider / tub', 'Washer', /tub bearing|\bspider\b|\bbearing\b/i],
  ['Washer shocks / suspension', 'Washer', /shock|suspension|strut/i],
  ['Dishwasher drain pump', 'Dishwasher', /drain pump/i],
  ['Dishwasher wash pump / motor', 'Dishwasher', /wash (pump|motor)|circulation pump/i],
  ['Dishwasher water inlet valve', 'Dishwasher', /water (inlet )?valve|fill valve/i],
  ['Dishwasher supply line / leak', 'Dishwasher', /supply line|water line|leak/i],
  ['Control / main board', 'Multi', /control board|main board|\bpcb\b|power board|main control/i],
  ['User interface / display / panel', 'Multi', /user interface|display (board|assembly)|control panel|interface/i],
  ['Thermostat', 'Multi', /thermostat/i],
  ['Door latch / lock', 'Multi', /door (latch|lock)|door switch/i],
  ['Full door replacement', 'Multi', /\bdoor\b/i],
  ['Pump (general)', 'Multi', /\bpump\b/i],
  ['Motor (general)', 'Multi', /\bmotor\b/i],
  ['Valve (general)', 'Multi', /\bvalve\b/i],
];

function med(arr) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function bump(o, k) { o[k] = (o[k] || 0) + 1; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
  const minN = Math.max(1, Number(q.min) || 2);

  const partRe = /\b([A-Z]{1,4}\d{2,}[A-Z0-9]{2,})\b/g;
  const agg = {}; // canonical -> {appliance, count, hours:[], parts:{}}
  const seen = new Set();
  let diagBlocks = 0, offset = 0;

  for (;;) {
    let rows;
    try { rows = await sb.select(TABLE, { board: 'eq._comment', select: 'card,card_id', order: 'id.asc', limit: String(PAGE), offset: String(offset) }); }
    catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const card = r.card || {};
      const cid = String(card.card_id || r.card_id || '');
      if (cid && seen.has(cid)) continue; if (cid) seen.add(cid);
      for (const cm of (card.comments || [])) {
        const text = String((cm && (cm.text || cm.body || cm.content)) || '');
        if (!/diagnosis|parts that failed|cause of failure|parts\s*:/i.test(text)) continue;
        // pull the parts/diagnosis region + labor hours
        const hoursM = text.match(/labor\s*hours[^\d]{0,8}([\d.]+)/i) || text.match(/\btime\s*[:=]?\s*([\d.]+)\b/i);
        const hrs = hoursM ? parseFloat(hoursM[1]) : null;
        // canonical repair: first matching keyword across the whole TDR text
        let canon = null, appl = null;
        for (const [name, a, re] of REPAIRS) { if (re.test(text)) { canon = name; appl = a; break; } }
        if (!canon) continue;
        diagBlocks++;
        if (!agg[canon]) agg[canon] = { repair: canon, appliance: appl, count: 0, hours: [], parts: {} };
        agg[canon].count++;
        if (hrs != null && hrs > 0 && hrs <= 12) agg[canon].hours.push(hrs);
        let pm; const prx = new RegExp(partRe.source, 'g');
        while ((pm = prx.exec(text)) !== null) { const pn = pm[1]; if (pn.length >= 5 && pn.length <= 16 && /[A-Z]/.test(pn) && /\d/.test(pn) && !/^NSA|^SCC|^SO\d|^SJ\d/i.test(pn)) bump(agg[canon].parts, pn); }
      }
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  const RATE = 100; // $/hr-equivalent target
  const round25 = (v) => Math.max(100, Math.round(v / 25) * 25);
  const menu = Object.values(agg)
    .filter((x) => x.count >= minN)
    .sort((a, b) => b.count - a.count)
    .map((x) => {
      const m = med(x.hours);
      const typicalHrs = m != null ? m : 1.0; // default to 1h when no logged time
      const flatLabor = round25(typicalHrs * RATE);
      const topParts = Object.entries(x.parts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
      return { repair: x.repair, appliance: x.appliance, seen: x.count, typical_hours: typicalHrs, flat_labor_usd: flatLabor, note: 'parts billed separately at cost ÷ .75', common_parts: topParts };
    });

  const out = { ok: true, rate_per_hr_equiv: RATE, diagnosis_blocks_parsed: diagBlocks, repairs: menu.length, menu };
  try { await sb.insert(TABLE, { board: '_repair_menu', card_id: 'ALL', title: 'flat_rate_repair_menu', notes: '', card: out }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify(out, null, 2) };
};
