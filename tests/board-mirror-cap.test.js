// The office board was showing 800 of 1,201 open jobs because get_office_kanban
// returns page 1 / per_page 800 sorted created_at desc, and 364 of those slots were
// COMPLETED jobs inside the 60-day invoice window. 309 board-eligible jobs -- 293 of
// them booked with a day AND a tech -- fell off the bottom. That is what Danielle
// reported as "the jobs I scheduled disappeared".
//
// These tests load the REAL _lib/board-mirror with a stubbed fetch + stubbed supabase,
// so they exercise the shipped merge and the shipped prune guard, not a copy of them.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SB_PATH = require.resolve('../netlify/functions/_lib/supabase.js');
const MOD_PATH = require.resolve('../netlify/functions/_lib/board-mirror.js');

// Load board-mirror with supabase replaced by a recorder we control.
function load(sbStub) {
  delete require.cache[MOD_PATH];
  require.cache[SB_PATH] = { id: SB_PATH, filename: SB_PATH, loaded: true, exports: sbStub };
  const mod = require(MOD_PATH);
  delete require.cache[SB_PATH];
  return mod;
}

function job(id, status) { return { id, scheduling_status: status }; }

// A fetch stub that answers each get_office_kanban pass differently and records the URLs.
function fetchStub({ open, windowed, failOpen = false, failWindowed = false }) {
  const urls = [];
  return {
    urls,
    fn: async (url) => {
      urls.push(String(url));
      const isOpenPass = String(url).includes('days_back=0');
      if (isOpenPass && failOpen) throw new Error('boom_open');
      if (!isOpenPass && failWindowed) throw new Error('boom_windowed');
      return { ok: true, json: async () => ({ items: isOpenPass ? open : windowed }) };
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
  };
}

test('it takes TWO passes and one of them collapses the completed window', async () => {
  const f = fetchStub({ open: [job(1, 'scheduled')], windowed: [job(9, 'completed')] });
  global.fetch = f.fn;
  const { fetchKanbanFull } = load(sbStub());
  await fetchKanbanFull(1000);
  assert.equal(f.urls.length, 2, 'one query can never clear the 800 cap');
  assert.equal(f.urls.filter((u) => u.includes('days_back=0')).length, 1,
    'the open-only pass is the whole point -- without days_back=0 completed jobs keep eating the cap');
  assert.equal(f.urls.filter((u) => !u.includes('days_back=')).length, 1,
    'the normal window still has to run or each tech loses his Invoice column');
});

test('the union carries open work that the windowed pass alone would have dropped', async () => {
  // windowed = the 800 newest (completed crowding it); open = every live job.
  const f = fetchStub({
    open: [job(1, 'scheduled'), job(2, 'awaiting_parts'), job(3, 'in_progress')],
    windowed: [job(3, 'in_progress'), job(9, 'completed')],
  });
  global.fetch = f.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items, complete } = await fetchKanbanFull(1000);
  const ids = items.map((j) => j.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 9], 'union must keep both the live work and the invoice window');
  assert.equal(complete, true);
});

test('a job present in both passes appears ONCE', async () => {
  const f = fetchStub({ open: [job(5, 'scheduled')], windowed: [job(5, 'scheduled')] });
  global.fetch = f.fn;
  const { fetchKanbanFull } = load(sbStub());
  const { items } = await fetchKanbanFull(1000);
  assert.equal(items.length, 1, 'a duplicated job would double-count every tech column');
});

test('either pass failing reports complete:false -- a failed read is not an empty result', async () => {
  for (const fail of [{ failOpen: true }, { failWindowed: true }]) {
    const f = fetchStub({ open: [job(1, 'scheduled')], windowed: [job(9, 'completed')], ...fail });
    global.fetch = f.fn;
    const { fetchKanbanFull } = load(sbStub());
    const { items, complete } = await fetchKanbanFull(1000);
    assert.equal(complete, false, 'a half-read must announce itself');
    assert.ok(items.length > 0, 'whatever DID come back is still worth upserting');
  }
});

test('LOAD-BEARING: an incomplete read never prunes the mirror', async () => {
  // The open pass dies. The windowed pass returns only completed work. If we pruned on
  // that, every scheduled job would be deleted out of board_mirror -- turning a failed
  // query into real, visible data loss on the office board.
  const f = fetchStub({ open: [job(1, 'scheduled')], windowed: [job(9, 'completed')], failOpen: true });
  global.fetch = f.fn;
  const sb = sbStub();
  // The mirror ALREADY holds the scheduled job. This is what makes the test bite: with an
  // empty mirror there is nothing to delete and the assertion passes whether the guard
  // exists or not. Job 1 is only in the pass that died, so an unguarded prune deletes it.
  sb.select = async (_t, params) => { sb.calls.selects.push(params); return [{ id: 1 }, { id: 9 }]; };
  const { syncBoardMirror } = load(sb);
  const out = await syncBoardMirror();
  assert.equal(out.ok, true);
  assert.equal(out.complete, false);
  assert.equal(out.pruned, 0, 'pruning on a half-read deletes live jobs');
  assert.equal(sb.calls.deleted.length, 0, 'no delete may be issued at all on a half-read');
  assert.ok(sb.calls.upserted.length > 0, 'the half we did get still has to land');
});

test('a complete read DOES prune, so finished jobs stop lingering', async () => {
  const f = fetchStub({ open: [job(1, 'scheduled')], windowed: [job(9, 'completed')] });
  global.fetch = f.fn;
  const sb = sbStub();
  sb.select = async (_t, params) => { sb.calls.selects.push(params); return [{ id: 1 }, { id: 9 }, { id: 77 }]; };
  const { syncBoardMirror } = load(sb);
  const out = await syncBoardMirror();
  assert.equal(out.complete, true);
  assert.equal(out.pruned, 1, 'the job that fell off the feed should be pruned');
  assert.ok(String(sb.calls.deleted[0].id).includes('77'));
});

test('the prune reads EVERY mirror id, not PostgREST first page', async () => {
  const f = fetchStub({ open: [job(1, 'scheduled')], windowed: [] });
  global.fetch = f.fn;
  const sb = sbStub();
  let pages = 0;
  sb.select = async (_t, params) => {
    sb.calls.selects.push(params);
    pages += 1;
    // two full pages then a short one - a single un-paged read would stop at 1000.
    if (pages <= 2) return Array.from({ length: 1000 }, (_, i) => ({ id: (pages - 1) * 1000 + i + 1 }));
    return [];
  };
  const { allMirrorIds } = load(sb);
  const ids = await allMirrorIds();
  assert.equal(ids.length, 2000, 'a truncated id read leaves finished jobs stuck on the board');
  assert.ok(sb.calls.selects.some((p) => p.offset === '1000'), 'must actually page with offset');
});
