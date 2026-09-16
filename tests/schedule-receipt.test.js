// schedule-receipt.test.js — proves every office save leaves a timestamped record.
//
// Loads the REAL shipped ant-schedule.js (not a copy) into a fake global with a stubbed
// fetch, so the test can never drift from what the office actually runs.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ant-schedule.js'), 'utf8');

// Boot the real module with a stubbed fetch; returns { AntSchedule, calls }.
function boot(responder) {
  const calls = [];
  const sandbox = {
    console,
    fetch: async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url: String(url), body, keepalive: !!(opts && opts.keepalive) });
      return responder(String(url), body);
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { A: sandbox.AntSchedule, calls };
}
const okRes = (o) => ({ ok: true, json: async () => o });
const receipts = (calls) => calls.filter((c) => c.url.includes('schedule-receipt')).map((c) => c.body);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; } };
const ta = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; } };

(async () => {
console.log('\nschedule-receipt');

// 8:00 AM CT on Fri 2026-09-18 -> 13:00 UTC
const FRI_8AM_CT = Date.UTC(2026, 8, 18, 13, 0, 0);
// 7:00 PM CT on Fri 2026-09-18 -> Sat 00:00 UTC. THE off-by-one: UTC says 09-19, CT says 09-18.
const FRI_7PM_CT = Date.UTC(2026, 8, 19, 0, 0, 0);

await ta('a successful save writes a CONFIRMED receipt', async () => {
  const { A, calls } = boot(() => okRes({ success: true }));
  const r = await A.schedule({ jobId: 22128, techId: 3, startMs: FRI_8AM_CT, actor: 'Danielle' });
  assert.strictEqual(r.ok, true);
  const rec = receipts(calls);
  assert.strictEqual(rec.length, 1, 'expected exactly one receipt, got ' + rec.length);
  assert.strictEqual(rec[0].job_id, 22128);
  assert.strictEqual(rec[0].tech_id, 3);
  assert.strictEqual(rec[0].actor, 'Danielle');
  assert.strictEqual(rec[0].confirmed, true);
});

await ta('the receipt day is CENTRAL, not UTC (the documented off-by-one)', async () => {
  const { A, calls } = boot(() => okRes({ success: true }));
  await A.schedule({ jobId: 1, techId: 3, startMs: FRI_7PM_CT, actor: 'Danielle' });
  const d = receipts(calls)[0].day;
  assert.strictEqual(d, '2026-09-18', 'a 7pm CT Friday booking must read 2026-09-18, not the UTC 09-19; got ' + d);
});

await ta('a REFUSED save still writes a receipt, marked not-confirmed', async () => {
  const { A, calls } = boot(() => okRes({ success: false, error: 'terminal_locked_permanently' }));
  const r = await A.schedule({ jobId: 99, techId: 4, startMs: FRI_8AM_CT, actor: 'Danielle' });
  assert.strictEqual(r.ok, false);
  const rec = receipts(calls);
  assert.ok(rec.length >= 1, 'a failed save must leave a record — that is the whole point');
  assert.strictEqual(rec[rec.length - 1].confirmed, false);
});

await ta('receipt:false suppresses the SUCCESS write (caller does its own verified one)', async () => {
  const { A, calls } = boot(() => okRes({ success: true }));
  await A.schedule({ jobId: 5, techId: 2, startMs: FRI_8AM_CT, actor: 'Danielle', receipt: false });
  assert.strictEqual(receipts(calls).length, 0, 'opt-out must suppress the duplicate success receipt');
});

await ta('receipt:false does NOT suppress a FAILURE write', async () => {
  const { A, calls } = boot(() => okRes({ success: false, error: 'nope' }));
  await A.schedule({ jobId: 6, techId: 2, startMs: FRI_8AM_CT, actor: 'Danielle', receipt: false });
  const rec = receipts(calls);
  assert.strictEqual(rec.length, 1, 'a miss is always recorded — no caller logs one today');
  assert.strictEqual(rec[0].confirmed, false);
});

await ta('reassign writes a receipt with a BLANK day (it changes who, not when)', async () => {
  const { A, calls } = boot(() => okRes({ success: true }));
  await A.reassign({ jobId: 7, techId: 6, actor: 'Danielle' });
  const rec = receipts(calls);
  assert.strictEqual(rec.length, 1);
  assert.strictEqual(rec[0].day, '', 'a reassign must not claim a day it did not set');
  assert.strictEqual(rec[0].tech_id, 6);
});

await ta('a receipt that throws can NEVER fail a save that already landed', async () => {
  const { A } = boot((url) => {
    if (url.includes('schedule-receipt')) throw new Error('logging is down');
    return okRes({ success: true });
  });
  const r = await A.schedule({ jobId: 8, techId: 3, startMs: FRI_8AM_CT, actor: 'Danielle' });
  assert.strictEqual(r.ok, true, 'the save succeeded; a logging failure must not report it as failed');
});

await ta('the receipt is keepalive so it survives the tab navigating away', async () => {
  const { A, calls } = boot(() => okRes({ success: true }));
  await A.schedule({ jobId: 9, techId: 3, startMs: FRI_8AM_CT, actor: 'Danielle' });
  const c = calls.find((x) => x.url.includes('schedule-receipt'));
  assert.strictEqual(c.keepalive, true);
});

await ta('a locked job that RECOVERS logs one confirmed receipt, not a false miss', async () => {
  let n = 0;
  const { A, calls } = boot((url) => {
    if (url.includes('schedule-receipt')) return okRes({ ok: true });
    if (url.includes('office_set_job_status')) return okRes({ success: true });
    n++; return okRes(n === 1 ? { success: false, error: 'terminal_locked' } : { success: true });
  });
  const r = await A.schedule({ jobId: 10, techId: 3, startMs: FRI_8AM_CT, actor: 'Danielle' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.recovered, true);
  const rec = receipts(calls);
  assert.strictEqual(rec.length, 1, 'recovery must not log a miss AND a hit');
  assert.strictEqual(rec[0].confirmed, true);
});

// --- coverage: every office surface that saves must leave a record ---
const root = path.join(__dirname, '..');
t('every AntSchedule caller is covered, and the opt-out is only used where a verified receipt replaces it', () => {
  const pages = ['office-board.html', 'needs-scheduled.html', 'office-do-next.html', 'office-ready.html', 'new-scheduling.html', 'tech-job.html', 'teddy-tdr-tool.html'];
  for (const p of pages) {
    const src = fs.readFileSync(path.join(root, p), 'utf8');
    assert.ok(/AntSchedule\.(schedule|reassign)/.test(src), p + ' should route through AntSchedule');
    if (/receipt:\s*false/.test(src)) {
      assert.ok(/confirmAndReceipt\(/.test(src), p + ' opts out of the baseline receipt but writes no verified one — that is a silent save');
    }
  }
});

// Strip line-comments so a commented-out call can't satisfy a text search. (A previous
// version of this test asserted only that the STRING 'AntSchedule.receipt(' appeared,
// and a mutation that dead-guarded the call with '&& false &&' sailed straight through —
// the call was present and unreachable. Presence is not reachability.)
function liveCode(src) {
  return src.split('\n').map((ln) => ln.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}
t('the pages that BYPASS AntSchedule still write a receipt — and it is REACHABLE', () => {
  for (const p of ['office-calendar.html', 'office-dashboard.html', 'grab.html']) {
    const src = liveCode(fs.readFileSync(path.join(root, p), 'utf8'));
    assert.ok(/danielle_schedule_parallel_job|reassign_job/.test(src), p + ' no longer saves directly — re-check this test');
    assert.ok(/ant-schedule\.js/.test(src), p + ' calls AntSchedule.receipt but never loads ant-schedule.js');

    const lines = src.split('\n').filter((ln) => /AntSchedule\.receipt\(/.test(ln));
    assert.ok(lines.length > 0, p + ' saves directly but writes NO receipt');
    for (const ln of lines) {
      // the guard must be the feature-check only — anything falsy wired in front of it
      // (&& false, && 0, if (false) is a call that exists on paper and never runs
      const guard = ln.slice(0, ln.indexOf('AntSchedule.receipt('));
      assert.ok(!/\b(false|0|null|undefined)\s*&&/.test(guard),
        p + ' has a DEAD receipt call — short-circuited before it can fire:\n         ' + ln.trim().slice(0, 120));
      assert.ok(/confirmed\s*:/.test(ln), p + ' receipt call passes no confirmed flag — it cannot record a miss');
    }
  }
});

t('bypass pages were NOT converted to AntSchedule.schedule (it texts the customer)', () => {
  for (const p of ['office-calendar.html', 'office-dashboard.html', 'grab.html']) {
    const src = fs.readFileSync(path.join(root, p), 'utf8');
    assert.ok(!/AntSchedule\.schedule\(/.test(src),
      p + ' now calls AntSchedule.schedule, which fires schedule-packet — that silently adds a customer text to a path that never sent one');
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();
