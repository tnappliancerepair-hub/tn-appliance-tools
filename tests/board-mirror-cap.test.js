// The office board was showing 436 of 1,201 open jobs because get_office_kanban returns
// page 1 / per_page 800 sorted created_at desc, and 364 of those slots were COMPLETED
// jobs inside the 60-day invoice window. 309 board-eligible jobs -- 293 booked with a day
// AND a tech -- fell off the bottom. That is what Danielle reported as "the jobs I
// scheduled disappeared".
//
// A bigger cap is the same bug with a later due date: this shop creates ~300 jobs a month
// and jobs stay open for weeks. So the mirror pages the RAW jobs table with no ceiling and
// keeps the feed only for its fresher computed names.
//
// These tests load the REAL _lib/board-mirror with fetch + supabase + secrets stubbed, so
// they exercise the shipped walk and the shipped prune guard, not a copy of them.
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const SB_PATH = require.resolve('../netlify/functions/_lib/supabase.js');
const SEC_PATH = require.resolve('../netlify/functions/_lib/secrets.js');
const MOD_PATH = require.resolve('../netlify/functions/_lib/board-mirror.js');

function load(sbStub) {
  delete require.cache[MOD_PATH];
  require.cache[SB_PATH] = { id: SB_PATH, filename: SB_PATH, loaded: true, exports: sbStub };
  require.cache[SEC_PATH] = {
    id: SEC_PATH, filename: SEC_PATH, loaded: true,
    exports: { getSecret: async () => 'fake-token', getSecretFresh: async () => 'fake-token', getSecretPreferVault: async () => 'fake-token' },
  };
  const mod = require(MOD_PATH);
  delete require.cache[SB_PATH];
  delete require.cache[SEC_PATH];
  return mod;
}

const DAY = 86400000;
function job(id, status, extra = {}) {
  return { id, scheduling_status: status, appliance_type: 'Dryer', created_at: Date.now(), ...extra };
}

// Stub fetch: metadata content/search = the raw walk, get_office_kanban = the feed.
function stub({ pages = {}, feed = [], failRaw = null, failFeed = false }) {
  const calls = { raw: [], feed: 0 };
  return {
    calls,
    fn: async (url, opts) => {
      const u = String(url);
      if (u.includes('/content/search')) {
        const body = JSON.parse((opts && opts.body) || '{}');
        const status = body.search.scheduling_status;
        const page = body.page;
        calls.raw.push({ status, page, per_page: body.per_page });
        if (failRaw && failRaw.status === status && failRaw.page === page) throw new Error('meta_500');
        return { ok: true, json: async () => ({ items: (pages[status] || [])[page - 1] || [] }) };
      }
      calls.feed += 1;
      if (failFeed) throw new Error('feed_down');
      return { ok: true, json: async () => ({ items: feed }) };
    },
  };
}

function sbStub() {
  const calls = { upserted: [], deleted: [], selects: [] };
  return {
    calls,
    upsert: async (_t, rows) => { calls.upserted.push(rows); },
    del: async (_t, filter) => { calls.deleted.push(filter); },
    select: async (_t, params) => { calls.selects.push(params); return []; },
    selectAll: async (_t, params) => { calls.selects.push(params); return []; },
  };
}

test('the raw walk keeps paging past 800 -- there is no cap', async () => {
  // 3 full pages of 500 + a short page = 1,700 scheduled jobs, more than double the old ceiling.
  const full = (n, off) => Array.from({ length: n }, (_, i) => job(off + i, 'scheduled'));
  const s = stub({ pages: { scheduled: [full(500, 1), full(500, 501), full(500, 1001), full(200, 1501)] } });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items, raw_count } = await fetchKanbanFull(1000);
  assert.equal(raw_count, 1700, 'a ceiling anywhere in the walk loses booked work');
  assert.ok(items.length >= 1700);
  const sched = s.calls.raw.filter((c) => c.status === 'scheduled').map((c) => c.page);
  assert.deepEqual(sched, [1, 2, 3, 4], 'must keep asking until a short page ends it');
});

test('it walks every board status, not just scheduled', async () => {
  const s = stub({ pages: {} });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  await fetchKanbanFull(1000);
  const asked = new Set(s.calls.raw.map((c) => c.status));
  for (const st of ['not_ready', 'needs_scheduled', 'scheduled', 'in_progress', 'awaiting_parts', 'held', 'no_fix_possible', 'completed']) {
    assert.ok(asked.has(st), `status ${st} never got walked -- those jobs would be invisible`);
  }
});

test('completed rides only inside the invoice window', async () => {
  const fresh = job(1, 'completed', { job_completed_at: Date.now() - 3 * DAY, created_at: Date.now() - 400 * DAY });
  const stale = job(2, 'completed', { job_completed_at: Date.now() - 300 * DAY, created_at: Date.now() - 400 * DAY });
  // never stamped on completion -- must survive via the created_at fallback
  const unstamped = job(3, 'completed', { job_completed_at: 0, created_at: Date.now() - 5 * DAY });
  const s = stub({ pages: { completed: [[fresh, stale, unstamped]] } });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items } = await fetchKanbanFull(1000);
  const ids = items.map((j) => j.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 3], 'a year-old completed job would bloat the board; an unstamped one must not vanish');
});

test('appliance_type is normalized so the board tile is not blank', async () => {
  const s = stub({ pages: { scheduled: [[{ id: 7, scheduling_status: 'scheduled', appliance_type: 'Refrigerator' }]] } });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items } = await fetchKanbanFull(1000);
  assert.equal(items[0].appliance, 'Refrigerator', 'the raw table names it appliance_type; the board reads appliance');
});

test('the feed WINS on conflict -- it has the fresher computed name', async () => {
  const s = stub({
    pages: { scheduled: [[job(5, 'scheduled', { customer_first: '' })]] },
    feed: [{ id: 5, scheduling_status: 'scheduled', customer_first: 'Paula' }],
  });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items } = await fetchKanbanFull(1000);
  assert.equal(items.length, 1, 'a job in both sources must appear once');
  assert.equal(items[0].customer_first, 'Paula',
    'the denormalized name is blank for ~30min on a new job; the feed looks it up live');
});

test('a lost raw page returns null -- it never reads as end-of-table', async () => {
  const full = (n, off) => Array.from({ length: n }, (_, i) => job(off + i, 'scheduled'));
  const s = stub({ pages: { scheduled: [full(500, 1), full(500, 501)] }, failRaw: { status: 'scheduled', page: 2 } });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { complete, raw_count } = await fetchKanbanFull(1000);
  assert.equal(raw_count, null, 'a dropped page must not be reported as a successful partial');
  assert.equal(complete, false);
});

test('either source failing reports complete:false', async () => {
  const s = stub({ pages: { scheduled: [[job(1, 'scheduled')]] }, failFeed: true });
  global.fetch = s.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items, complete } = await fetchKanbanFull(1000);
  assert.equal(complete, false, 'a half-read must announce itself');
  assert.ok(items.length > 0, 'whatever DID come back is still worth upserting');
});

test('LOAD-BEARING: an incomplete read never prunes the mirror', async () => {
  // The raw walk dies. The feed returns only a completed job. If we pruned on that, every
  // scheduled job would be deleted out of board_mirror -- turning a failed query into real,
  // visible data loss on the office board.
  const s = stub({ pages: { scheduled: [[job(1, 'scheduled')]] }, feed: [job(9, 'completed')], failRaw: { status: 'not_ready', page: 1 } });
  global.fetch = s.fn;
  const sb = sbStub();
  // The mirror ALREADY holds the scheduled job -- this is what makes the test bite. With an
  // empty mirror there is nothing to delete and it would pass with or without the guard.
  sb.selectAll = async (_t, params) => { sb.calls.selects.push(params); return [{ id: 1 }, { id: 9 }]; };
  const { syncBoardMirror } = load(sb);
  const out = await syncBoardMirror();
  assert.equal(out.ok, true);
  assert.equal(out.complete, false);
  assert.equal(out.pruned, 0, 'pruning on a half-read deletes live jobs');
  assert.equal(sb.calls.deleted.length, 0, 'no delete may be issued at all on a half-read');
  assert.ok(sb.calls.upserted.length > 0, 'the half we did get still has to land');
});

test('a complete read DOES prune, so finished jobs stop lingering', async () => {
  const s = stub({ pages: { scheduled: [[job(1, 'scheduled')]] }, feed: [job(9, 'completed')] });
  global.fetch = s.fn;
  const sb = sbStub();
  sb.selectAll = async (_t, params) => { sb.calls.selects.push(params); return [{ id: 1 }, { id: 9 }, { id: 77 }]; };
  const { syncBoardMirror } = load(sb);
  const out = await syncBoardMirror();
  assert.equal(out.complete, true);
  assert.equal(out.pruned, 1);
  assert.ok(String(sb.calls.deleted[0].id).includes('77'));
});

test('allMirrorIds delegates to the paging reader, never a bare capped select', async () => {
  const s2 = stub({ pages: {} });
  global.fetch = s2.fn;
  const sb = sbStub();
  let usedBareSelect = false;
  sb.select = async () => { usedBareSelect = true; return []; };
  sb.selectAll = async (_t, params) => { sb.calls.selects.push(params); return [{ id: 1 }, { id: 2 }]; };
  const { allMirrorIds } = load(sb);
  const ids = await allMirrorIds();
  assert.deepEqual(ids, [1, 2]);
  assert.equal(usedBareSelect, false,
    'a bare select() truncates at 1000 server side - the prune would then leave finished jobs stuck on the board');
});
