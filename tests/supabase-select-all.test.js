// PostgREST caps a response at 1000 rows SERVER SIDE regardless of what `limit` asks for,
// and it does not error -- it quietly hands back less. So `limit: '2000'` reads like a
// generous ceiling and is actually a 1000-row wall.
//
// That is not theoretical. On 2026-09-16 board_mirror held 1,129 jobs and the office board
// was served exactly 1,000: 129 real jobs invisible, no error anywhere. sb.selectAll is the
// ONE definition every read that could exceed 1000 rows goes through, so this has to hold.
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const sb = require('../netlify/functions/_lib/supabase.js');

// Stand in for PostgREST: honours limit/offset and hard-caps any page at 1000, the way
// the real server does.
function server(totalRows) {
  const calls = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    calls.push({ limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset'), order: u.searchParams.get('order') });
    const limit = Math.min(Number(u.searchParams.get('limit') || 1000), 1000); // the server cap
    const offset = Number(u.searchParams.get('offset') || 0);
    const rows = [];
    for (let i = offset; i < Math.min(offset + limit, totalRows); i++) rows.push({ id: i + 1 });
    return { ok: true, json: async () => rows };
  };
  return calls;
}

// _lib/supabase reads its config from env; point it at a dummy so cfg() resolves.
process.env.PLATFORM_SUPABASE_URL = process.env.PLATFORM_SUPABASE_URL || 'https://example.test';
process.env.PLATFORM_SUPABASE_SERVICE_KEY = process.env.PLATFORM_SUPABASE_SERVICE_KEY || 'k';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.test';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'k';

test('it returns EVERY row past the 1000 server cap', async () => {
  server(1129); // the real number the day the board lost 129 jobs
  const rows = await sb.selectAll('board_mirror', { select: 'id' });
  assert.equal(rows.length, 1129, 'this is the exact truncation that hid 129 jobs from the office');
});

test('a table that fits in one page costs exactly one request', async () => {
  const calls = server(42);
  const rows = await sb.selectAll('board_mirror', { select: 'id' });
  assert.equal(rows.length, 42);
  assert.equal(calls.length, 1, 'do not pay for a second round trip when the first page was short');
});

test('an exactly-1000-row table still gets a second look', async () => {
  // A full page is indistinguishable from "there is more" -- stopping here would be the bug.
  const calls = server(1000);
  const rows = await sb.selectAll('board_mirror', { select: 'id' });
  assert.equal(rows.length, 1000);
  assert.equal(calls.length, 2, 'a full page must be followed up or the 1001st row is lost forever');
});

test('it pages with a stable order, or rows get skipped and repeated', async () => {
  const calls = server(1500);
  await sb.selectAll('board_mirror', { select: 'id' });
  // NOT just "truthy": an absent order serializes to the literal string "undefined",
  // which reads as present. Demand a real column sort.
  assert.ok(calls.every((c) => /^[a-z_]+\.(asc|desc)$/.test(String(c.order || ''))),
    'paging an unordered result can skip or duplicate rows between pages');
  assert.equal(calls[0].offset, '0');
  assert.equal(calls[1].offset, '1000');
});

test('rows come back whole and in order, no gaps', async () => {
  server(2500);
  const rows = await sb.selectAll('board_mirror', { select: 'id' });
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[2499].id, 2500);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2500, 'a duplicated row means the paging is unstable');
});

test('a caller-supplied order is respected', async () => {
  const calls = server(10);
  await sb.selectAll('board_mirror', { select: 'id', order: 'id.desc' });
  assert.equal(calls[0].order, 'id.desc');
});
