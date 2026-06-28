// meistertask-volume — the WIDE view. Classifies every archived card (all 8,115,
// not just the 164 structured diagnosis blocks) by appliance + symptom, reading
// the dispatch notes ("Item: Washer / Issue: Not draining / Symptom Details: ...")
// plus free text. Gives the real volume picture per appliance to set the flat-rate
// menu on thousands of jobs, not a sample. Dedupes by card_id.
//   GET ?secret=<admin>
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 800;
const REAL_BOARDS = new Set(['TN Jobs', 'NOLA JOBS', 'Florida Jobs', 'SCHEDULING']);

const APPLIANCES = [
  ['Dishwasher', /\bdish ?washer\b/i],
  ['Dryer', /\bdryer\b/i],
  ['Washer', /\b(washer|washing machine)\b/i],
  ['Refrigerator', /\b(refrigerator|fridge|freezer|ice ?maker|icemaker)\b/i],
  ['Range/Oven', /\b(range|oven|cooktop|stove|wall oven)\b/i],
  ['Microwave', /\bmicrowave\b/i],
  ['Disposal', /\b(garbage )?disposal\b/i],
];

// symptom canonical -> regex. Checked in order; first hit wins per card.
const SYMPTOMS = [
  ['No ice / ice maker', /ice ?maker|no ice|not making ice|ice bin|nugget ice/i],
  ['Not cooling / warm', /not cool|won'?t cool|not cold|warm (fridge|refrigerator|inside)|temp(erature)? (too )?(high|warm)|not getting cold/i],
  ['Freezing food / too cold', /freezing (food|up)|too cold|over ?freez|frost build/i],
  ['Not draining', /not drain|won'?t drain|standing water|water (left )?in (the )?(tub|bottom)|drain(age)? issue/i],
  ['Not spinning', /not spin|won'?t spin|no spin|spin (cycle )?(issue|problem)/i],
  ['No heat / not drying', /no heat|not heat(ing)?|won'?t heat|not dry|takes (forever|long|hours) to dry|clothes (still )?wet|not getting hot/i],
  ['Oven not heating / temp', /oven (not|won'?t) heat|not bak(e|ing)|won'?t reach temp|oven temp|not heating to/i],
  ['Burner / element not working', /burner (not|won'?t)|element (not|out|burned)|surface unit|one burner/i],
  ['Igniter / won\'t light', /igniter|ignitor|won'?t (light|ignite)|clicking but no/i],
  ['Not cleaning', /not clean|dishes (still )?dirty|not washing|poor clean|leaving (residue|film)/i],
  ['Not filling / no water', /not fill|won'?t fill|no water (com|to)|not getting water/i],
  ['Leaking', /leak|water (on (the )?floor|everywhere)|dripping/i],
  ['Won\'t start / no power', /won'?t (start|turn on|power)|no power|not turning on|dead|won'?t come on|no display/i],
  ['Door / lock / latch', /door (won'?t|not|seal|lock|latch)|won'?t lock|lid (lock|switch)|won'?t close/i],
  ['Noisy / vibrating', /nois|loud|grinding|banging|squeal|rattl|vibrat|shaking/i],
  ['Error code', /\b[ef]\d{1,2}\b|error code|fault code|\bcode\b/i],
  ['Smell / burning', /burning smell|smell|odor/i],
];

// component-level (the actual repair) — reuse a compact version for cross-ref
const COMPONENTS = [
  ['Ice maker', /ice ?maker/i], ['Compressor / sealed system', /compressor|sealed system/i],
  ['Control / main board', /control board|main board|\bpcb\b|control panel|user interface|display board/i],
  ['Water inlet valve', /water (inlet )?valve|fill valve/i], ['Drain pump', /drain pump/i],
  ['Heating element', /heating element|bake element|broil element/i], ['Door gasket / seal', /gasket|door seal/i],
  ['Evaporator/condenser fan', /evap(orator)? ?fan|condenser fan/i], ['Thermostat', /thermostat/i],
  ['Igniter', /igniter|ignitor/i], ['Drive motor', /drive motor|wash motor|\bmotor\b/i],
  ['Door lock / latch', /door (lock|latch)|lid (lock|switch)/i], ['Bearing / spider / tub', /tub bearing|\bspider\b|\bbearing\b/i],
];

function classify(text, list) { for (const [name, re] of list) if (re.test(text)) return name; return null; }
function bump(o, k) { if (!k) return; o[k] = (o[k] || 0) + 1; }
function sortObj(o) { return Object.entries(o).sort((a, b) => b[1] - a[1]).reduce((m, [k, v]) => (m[k] = v, m), {}); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };

  const seen = new Set();
  const res = { total: 0, classified_appliance: 0, classified_symptom: 0, appliance_totals: {}, by_appliance: {}, components: {} };
  let offset = 0;
  for (;;) {
    let rows;
    try { rows = await sb.select(TABLE, { board: 'not.in.(_manifest,_analysis,_comment,_comment_state,_comment_analysis,_repair_menu,_volume)', select: 'card_id,board,title,notes', order: 'id.asc', limit: String(PAGE), offset: String(offset) }); }
    catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e), at_offset: offset }) }; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      if (!REAL_BOARDS.has(r.board)) continue;
      const cid = String(r.card_id || '');
      if (cid && seen.has(cid)) continue; if (cid) seen.add(cid);
      res.total++;
      const text = ((r.title || '') + '\n' + (r.notes || ''));
      const appl = classify(text, APPLIANCES);
      const sym = classify(text, SYMPTOMS);
      const comp = classify(text, COMPONENTS);
      if (appl) { res.classified_appliance++; bump(res.appliance_totals, appl); if (!res.by_appliance[appl]) res.by_appliance[appl] = {}; bump(res.by_appliance[appl], sym || '(unclassified symptom)'); }
      if (sym) res.classified_symptom++;
      if (comp) bump(res.components, comp);
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  res.appliance_totals = sortObj(res.appliance_totals);
  for (const a of Object.keys(res.by_appliance)) res.by_appliance[a] = sortObj(res.by_appliance[a]);
  res.components = sortObj(res.components);
  const out = { ok: true, ...res };
  try { await sb.insert(TABLE, { board: '_volume', card_id: 'ALL', title: 'volume_view', notes: '', card: out }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify(out, null, 2) };
};
