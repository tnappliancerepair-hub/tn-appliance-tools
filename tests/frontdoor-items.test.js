'use strict';
// Frontdoor asked for `items` on our status pushes (Akshay, 2026-09-18). The ids were in
// every dispatch email the whole time -- <WorkOrderLineList Id="20242" Description="Dryer">
// -- and the AHS intake reads only Description and throws the Id away.
//
// Two ways to get this wrong, and this file pins both:
//   1. READING THE WRONG FIELD NAME. The inbound feed spells it external_id; the outbound
//      body spells it id / legacy_item_id. Reading the outbound spelling on inbound data
//      captures nothing while looking perfectly wired -- it logs description-only rows
//      forever and nobody notices.
//   2. LETTING items BECOME LOAD-BEARING. Items are additive. A job with no cached ids has
//      to push exactly as it does today; a cache miss must never cost us a status update.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const P = (f) => path.join(__dirname, '..', 'netlify', 'functions', f);
const SRC = {
  itemIds: fs.readFileSync(P('frontdoor-item-ids.js'), 'utf8'),
  pushJob: fs.readFileSync(P('frontdoor-push-job.js'), 'utf8'),
  pushStatus: fs.readFileSync(P('frontdoor-push-status.js'), 'utf8'),
  webhook: fs.readFileSync(P('frontdoor-webhook.js'), 'utf8'),
};

// Lift a function body out of the SHIPPED file and run it, so the test can never drift
// from what deploys. A miss throws rather than silently testing nothing.
function lift(src, name) {
  // `function X(` matches MID-TOKEN inside `async function X(`, which hands back a sync
  // body full of `await` that will not even parse. Anchor on the optional async.
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('lift failed, not found: ' + name);
  const i = m.index;
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; } else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('lift failed, unbalanced: ' + name);
}
function runLifted(src, names, exportName) {
  const ctx = { module: {}, console };
  vm.createContext(ctx);
  vm.runInContext(names.map((n) => lift(src, n)).join('\n') + '\nmodule.exports = { ' + names.join(', ') + ' };', ctx);
  return exportName ? ctx.module.exports[exportName] : ctx.module.exports;
}

// The real shape, verbatim from a live AHS dispatch (#23457839, pulled 2026-09-18).
const REAL_XML = `<VendorDispatch>
 <DispatchContactList><DispatchContact Name="ANDRE DONNELL"></DispatchContact></DispatchContactList>
 <DispatchList Id="23457839" dispatchPriorityValueList="NORMAL" Trade="APL" ServiceFeeAmount="136.56">
  <WorkOrderLineList Id="20242" Description="Dryer">
   <Symptom Name="Not Coming On"></Symptom>
   <Attribute Name="Brand" Value="Kenmore"></Attribute>
  </WorkOrderLineList>
  <WorkOrderLineList Id="20312" Description="Washer">
   <Symptom Name="Leaking"></Symptom>
  </WorkOrderLineList>
 </DispatchList>
</VendorDispatch>`;

// ── the parser ──────────────────────────────────────────────────────────────

test('parses the real dispatch into its line items, in order', () => {
  const parse = runLifted(SRC.itemIds, ['decode', 'parseDispatches'], 'parseDispatches');
  const out = parse(REAL_XML);
  assert.equal(out.length, 1, 'one dispatch in this mail');
  assert.equal(out[0].dispatch_number, '23457839');
  assert.deepEqual(out[0].items, [
    { id: 20242, description: 'Dryer' },
    { id: 20312, description: 'Washer' },
  ]);
});

test('ids are NUMBERS -- dispatch_id is a number in their body and items follow suit', () => {
  const parse = runLifted(SRC.itemIds, ['decode', 'parseDispatches'], 'parseDispatches');
  for (const it of parse(REAL_XML)[0].items) assert.equal(typeof it.id, 'number');
});

test('items never bleed across dispatches in one document', () => {
  const parse = runLifted(SRC.itemIds, ['decode', 'parseDispatches'], 'parseDispatches');
  const two = '<DispatchList Id="111"><WorkOrderLineList Id="1" Description="Dryer"></WorkOrderLineList></DispatchList>'
    + '<DispatchList Id="222"><WorkOrderLineList Id="2" Description="Washer"></WorkOrderLineList></DispatchList>';
  const out = parse(two);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].items.map((i) => i.id), [1], 'dispatch 111 must not inherit 222 lines');
  assert.deepEqual(out[1].items.map((i) => i.id), [2], 'dispatch 222 must not inherit 111 lines');
});

test('a repeated line collapses, and entities are decoded', () => {
  const parse = runLifted(SRC.itemIds, ['decode', 'parseDispatches'], 'parseDispatches');
  const dup = '<DispatchList Id="9">'
    + '<WorkOrderLineList Id="5" Description="Air Conditioning &amp; Heat"></WorkOrderLineList>'
    + '<WorkOrderLineList Id="5" Description="Air Conditioning &amp; Heat"></WorkOrderLineList>'
    + '</DispatchList>';
  assert.deepEqual(parse(dup)[0].items, [{ id: 5, description: 'Air Conditioning & Heat' }]);
});

test('a dispatch with no line items yields nothing rather than an empty claim', () => {
  const parse = runLifted(SRC.itemIds, ['decode', 'parseDispatches'], 'parseDispatches');
  assert.deepEqual(parse('<DispatchList Id="9"></DispatchList>'), []);
});

// ── resolution refuses to guess ─────────────────────────────────────────────

test('a dispatch matching two different jobs is refused, not guessed', async () => {
  const src = SRC.itemIds;
  const body = lift(src, 'resolveJob');
  const calls = [];
  const mk = (cands) => {
    const ctx = {
      module: {}, console,
      fetch: async (u) => { calls.push(u); return { json: async () => ({ candidates: cands }) }; },
      AbortSignal, encodeURIComponent,
      XANO: 'https://x',
    };
    vm.createContext(ctx);
    vm.runInContext(body + '\nmodule.exports = { resolveJob };', ctx);
    return ctx.module.exports.resolveJob;
  };
  // the deployed resolver returns one row per matching FIELD, so the same job repeats
  const same = await mk([{ job_id: 22218, warranty_company: 'Frontdoor' }, { job_id: 22218, warranty_company: 'Frontdoor' }])('86127329');
  assert.equal(same.job_id, 22218, 'the same job matched on two fields is ONE job');
  const two = await mk([{ job_id: 1, warranty_company: 'AHS' }, { job_id: 2, warranty_company: 'AHS' }])('99');
  assert.equal(two.job_id, null, 'two genuinely different jobs must not be picked between');
  assert.equal(two.ambiguous, true);
  const none = await mk([])('99');
  assert.equal(none.job_id, null);
});

// ── the push carries them ───────────────────────────────────────────────────

// Run the REAL frontdoor-push-job handler against a stubbed Xano + a stubbed push-status,
// and read the body it actually sends.
async function pushWith(cachedItems, job, statusKey) {
  const jobRow = Object.assign({ id: 1, warranty_company: 'AHS', dispatch_source_id: '23457839', technician_id: 2 }, job || {});
  let sent = null;
  const ctx = {
    module: { exports: {} }, console, Buffer, URL, JSON, Number, String, Array, Math, Date, Object, parseInt, isNaN, Boolean,
    AbortSignal,
    fetch: async (url, opts) => {
      if (String(url).includes('frontdoor-push-status')) { sent = JSON.parse(opts.body); return { json: async () => ({ ok: true, mode: 'shadow' }) }; }
      return { json: async () => ({ bundles: [] }) };
    },
    require: (m) => {
      if (m === './_lib/secrets') return { getSecret: async () => 'sek' };
      if (m === './_lib/frontdoor-tdr') return { composeTdrNote: () => '' };
      if (m === './_lib/xano/metadata-crud') {
        return {
          TABLES: { jobs: 7, event_log: 3 },
          searchOne: async (table, filter) => {
            if (table === 7) return jobRow;
            if (table === 3 && filter.action === 'frontdoor_items_1') {
              return cachedItems === undefined ? null : { metadata: { items: cachedItems } };
            }
            return null;
          },
        };
      }
      throw new Error('unstubbed require: ' + m);
    },
  };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(SRC.pushJob, ctx);
  const res = await ctx.module.exports.handler({ httpMethod: 'POST', body: JSON.stringify({ job_id: 1, status_key: statusKey || 'EN_ROUTE' }) });
  return { sent, out: JSON.parse(res.body) };
}

test('a cached dispatch line is echoed back as {id, legacy_item_id, description}', async () => {
  const { sent, out } = await pushWith([{ id: 20242, description: 'Dryer' }, { id: 20312, description: 'Washer' }]);
  assert.ok(sent, 'the push never reached frontdoor-push-status');
  assert.deepEqual(sent.items, [
    { id: 20242, legacy_item_id: 20242, description: 'Dryer' },
    { id: 20312, legacy_item_id: 20312, description: 'Washer' },
  ], 'id and legacy_item_id carry the SAME value, matching their own working body');
  assert.equal(out.items_sent, 2, 'the response must say how many rode along, or a silent zero is invisible');
});

test('items ride on EVERY status, not a chosen subset', async () => {
  // The status has to actually VARY here. A loop that ignores its own variable is a test
  // that cannot fail -- and "which statuses need items" is exactly the question we removed
  // by always sending them, so this is the assertion that keeps it removed.
  for (const key of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'PARTS_ON_ORDER', 'ON_HOLD', 'COMPLETE', 'INVOICED']) {
    const { sent } = await pushWith([{ id: 7, description: 'Dryer' }], null, key);
    assert.equal(sent.status_key, key, 'the harness did not actually push ' + key);
    assert.deepEqual(sent.items, [{ id: 7, legacy_item_id: 7, description: 'Dryer' }], 'no items on ' + key);
  }
});

test('a job with no cached ids pushes exactly as before -- items can never be load-bearing', async () => {
  const { sent, out } = await pushWith(undefined);
  assert.equal(sent.items, undefined, 'no items key at all when we have none');
  assert.equal(sent.dispatch_number, '23457839', 'the push still goes');
  assert.equal(sent.status_key, 'EN_ROUTE');
  assert.equal(out.items_sent, 0);
});

test('a junk cache row cannot poison the payload', async () => {
  const { sent } = await pushWith([{ id: 'abc', description: 'x' }, { description: 'no id' }, { id: 0, description: 'zero' }]);
  assert.equal(sent.items, undefined, 'every row was unusable, so send none rather than NaN ids');
  assert.equal(sent.dispatch_number, '23457839', 'and the push still goes');
});

test('a Xano read that throws does not take the push down with it', async () => {
  const ctx = {
    module: { exports: {} }, console, JSON, Number, String, Array, Object, parseInt, AbortSignal,
    fetch: async (url, opts) => {
      if (String(url).includes('frontdoor-push-status')) { ctx.__sent = JSON.parse(opts.body); return { json: async () => ({ ok: true }) }; }
      return { json: async () => ({}) };
    },
    require: (m) => {
      if (m === './_lib/secrets') return { getSecret: async () => 'sek' };
      if (m === './_lib/frontdoor-tdr') return { composeTdrNote: () => '' };
      if (m === './_lib/xano/metadata-crud') return {
        TABLES: { jobs: 7, event_log: 3 },
        searchOne: async (t) => { if (t === 7) return { id: 1, warranty_company: 'AHS', dispatch_source_id: '23457839' }; throw new Error('xano down'); },
      };
      throw new Error('unstubbed: ' + m);
    },
  };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(SRC.pushJob, ctx);
  await ctx.module.exports.handler({ httpMethod: 'POST', body: JSON.stringify({ job_id: 1, status_key: 'COMPLETE' }) });
  assert.ok(ctx.__sent, 'the status push must still fire when the items lookup fails');
  assert.equal(ctx.__sent.items, undefined);
});

// ── shadow mode has to show them ────────────────────────────────────────────

test('items appear in the SHADOW preview, or nobody can verify them before production', () => {
  const live = SRC.pushStatus.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const m = live.match(/const payloadPreview = \{[^}]*\}/);
  assert.ok(m, 'payloadPreview is no longer a single object literal -- re-check this assertion');
  assert.ok(/\bitems\b/.test(m[0]),
    'items is sent live but missing from payloadPreview, so frontdoor_push_shadow cannot prove what we would send');
});

// ── the inbound spelling ────────────────────────────────────────────────────

test('the webhook reads external_id -- the INBOUND spelling, not the outbound one', () => {
  const live = SRC.webhook.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const m = live.match(/out\.items\s*=[\s\S]{0,400}?\n\s*\}\);/);
  assert.ok(m, 'the webhook no longer builds out.items -- item capture on the live feed is gone');
  assert.ok(/external_id/.test(m[0]),
    'inbound dispatches spell it external_id; reading id/legacy_item_id here captures nothing while looking wired');
  const first = m[0].indexOf('external_id');
  const fallback = Math.min(...['o.id', 'legacy_item_id'].map((k) => { const i = m[0].indexOf(k); return i < 0 ? Infinity : i; }));
  assert.ok(first < fallback, 'external_id must be read FIRST, before the outbound spellings');
});

// ── the capture cannot quietly stop running ─────────────────────────────────

test('the capture is on a cron, and the core stays curlable', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.ok(/\[functions\."frontdoor-item-ids-cron"\]/.test(toml), 'nothing schedules the item-id capture');
  assert.ok(!/\[functions\."frontdoor-item-ids"\]/.test(toml),
    'the CORE must not carry a schedule -- a scheduled fn edge-403s and the dry-run becomes unreachable');
  const cron = fs.readFileSync(P('frontdoor-item-ids-cron.js'), 'utf8');
  assert.ok(/frontdoor-item-ids\?/.test(cron) && /apply=1/.test(cron), 'the cron wrapper must invoke the core in apply mode');
});

test('the capture writes under the job-keyed action the push reads back', () => {
  const writer = (SRC.itemIds.match(/cacheKey\s*=\s*\(jobId\)\s*=>\s*'([^']+)'/) || [])[1];
  assert.equal(writer, 'frontdoor_items_', 'the cache key changed in the writer');
  const reader = (SRC.pushJob.match(/action:\s*'([^']+)'\s*\+\s*jobId/) || [])[1];
  assert.equal(reader, writer, 'the push reads a different key than the capture writes -- items would be silently absent forever');
});
