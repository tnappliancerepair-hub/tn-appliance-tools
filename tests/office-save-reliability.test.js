// office-save-reliability.test.js — Sofia 2026-09-16: "I'm not able to update phone numbers
// and it saves."  She was right twice over, and the second reason is the one nobody could see.
//
// PROVEN ON THE LIVE BOARD BEFORE WRITING A LINE. Wrote a sentinel first_name onto a real
// mirrored customer (xano_id 4292, a job in_progress) at 18:17:42Z and watched it:
//
//     18:20:05  ZZSENTINEL      18:21:09  ZZSENTINEL
//     18:20:37  ZZSENTINEL      18:21:41  Cailin      <- platform-tn-mirror put it back
//
// Three and a half minutes. Not a permissions problem, not a dropped write — the OFFICE EDIT
// LANDS AND THE MIRROR UNDOES IT, because keepTyped() only blocks a BLANK incoming Xano value
// and a DIFFERENT non-empty one still wins. 3,823 of TN's 3,862 customers are mirrored, so
// this was every customer she could reasonably be editing.
//
// The fix is NOT to flip which system is authoritative (that is an owner decision and it is
// recorded as one). It is to tell Xano what she typed, through the office editor that already
// exists — update-customer-name writes the customer row AND the denormalized customer_phone
// onto that customer's jobs, which is the EXACT field the mirror reads back (`j.customer_phone`).
// So on the next run the mirror writes HER value, not the old one.
//
// Everything below is lifted out of the SHIPPED page and executed. Pattern-matching the source
// would pass against a dead-guarded call; presence is not reachability.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BOARD = fs.readFileSync(path.join(__dirname, '..', 'platform', 'office-board.html'), 'utf8');

// Brace-balanced extraction of one named function out of the page, so an assertion about
// fldSave can never accidentally pass against an identical line inside saveTdr.
function fnBody(name, src) {
  const S = src || BOARD;
  const a = S.indexOf('function ' + name + '(');
  assert.ok(a > -1, 'function ' + name + ' not found');
  const o = S.indexOf('{', a);
  let d = 0;
  for (let i = o; i < S.length; i++) {
    if (S[i] === '{') d++;
    else if (S[i] === '}') { d--; if (!d) return S.slice(a, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

// ── the Xano push, executed ──────────────────────────────────────────────────
function runSync(job, hasCust, cust, fetchImpl) {
  const ctx = {
    fetch: fetchImpl,
    Number: Number,
    JSON: JSON,
    msg: { textContent: '' },
    out: null,
    Promise: Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(fnBody('syncCustomerToXano') + '\n;this.out = syncCustomerToXano(job, hasCust, cust, msg);', Object.assign(ctx, { job, hasCust, cust }));
  return ctx;
}

const okFetch = (calls) => (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
};

test('a mirrored job pushes the edit to Xano — otherwise the mirror puts the old number back', () => {
  const calls = [];
  runSync({ id: 'uuid-1', xano_id: 20058 }, true, { phone: '6155550142', first_name: 'Cailin', last_name: 'Temple', address: null, city: 'Antioch', state: 'TN' }, okFetch(calls));
  assert.equal(calls.length, 1, 'exactly one push');
  assert.match(calls[0].url, /update-customer-name/);
  assert.equal(calls[0].body.job_id, 20058, 'pushes the XANO job id, not the platform uuid');
  assert.equal(calls[0].body.phone, '6155550142');
  assert.equal(calls[0].body.city, 'Antioch');
  assert.equal(calls[0].body.actor, 'office');
});

test('a blank field is pushed as empty, never dropped — clearing a wrong number has to stick too', () => {
  const calls = [];
  runSync({ xano_id: 20058 }, true, { phone: null, first_name: 'Cailin', last_name: 'Temple', address: null, city: null, state: null }, okFetch(calls));
  assert.equal(calls[0].body.phone, '', 'null becomes an explicit empty, so Xano is told to clear it');
  assert.ok('address' in calls[0].body, 'every edited field is sent');
});

test('a job born on the platform is never pushed — the mirror does not touch it', () => {
  const calls = [];
  runSync({ id: 'uuid-1', xano_id: null }, true, { phone: '6155550142' }, okFetch(calls));
  assert.equal(calls.length, 0, 'no xano_id -> nothing can revert it -> no push');
});

test('a job with no customer row is never pushed', () => {
  const calls = [];
  runSync({ xano_id: 20058 }, false, { phone: '6155550142' }, okFetch(calls));
  assert.equal(calls.length, 0);
});

test('when Xano refuses, she is TOLD it may come back — not left thinking it saved', async () => {
  const ctx = runSync({ xano_id: 20058 }, true, { phone: '6155550142' },
    () => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'customer PUT 500' }) }));
  await new Promise((r) => setImmediate(r));
  assert.match(ctx.msg.textContent, /may come back/i);
  assert.match(ctx.msg.textContent, /old system/i);
});

test('when Xano is unreachable, she is TOLD it may come back', async () => {
  const ctx = runSync({ xano_id: 20058 }, true, { phone: '6155550142' }, () => Promise.reject(new Error('offline')));
  await new Promise((r) => setImmediate(r));
  assert.match(ctx.msg.textContent, /may come back/i);
});

test('a clean push says nothing extra — no scary message on the happy path', async () => {
  const ctx = runSync({ xano_id: 20058 }, true, { phone: '6155550142' }, okFetch([]));
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.msg.textContent, '');
});

// ── the silent-RLS half ──────────────────────────────────────────────────────
// A Supabase write that fails its RLS gate returns ZERO ROWS AND NO ERROR, so `if(err)` is
// false and the old code printed "Saved" over a write that saved nothing.
test('every drawer write proves a row came back', () => {
  const save = BOARD.slice(BOARD.indexOf("document.getElementById('d_save').onclick"), BOARD.indexOf('syncCustomerToXano(job, hasCust, cust, msg);'));
  const updates = save.match(/sb\.from\('(customer|unit|job)'\)\.update\(/g) || [];
  assert.equal(updates.length, 3, 'customer + unit + job');
  const selects = save.match(/\.select\('id'\)/g) || [];
  assert.equal(selects.length, 3, 'all three ask for the row back');
});

test('zero rows back reads as REFUSED, not as saved', () => {
  const save = BOARD.slice(BOARD.indexOf("document.getElementById('d_save').onclick"), BOARD.indexOf('syncCustomerToXano(job, hasCust, cust, msg);'));
  assert.match(save, /x\.data\s*&&\s*x\.data\.length\s*===\s*0/, 'counts zero-row results');
  assert.match(save, /if\(blocked\)\{[^}]*Did NOT save/, 'and says so before it can say Saved');
  const blockedAt = save.indexOf('if(blocked)');
  const savedAt = save.indexOf("msg.textContent='Saved");
  assert.ok(blockedAt > -1 && savedAt > blockedAt, 'the refusal check runs BEFORE the success line');
});

test('the honest warning is not wiped by the 2.5s clear', () => {
  const a = BOARD.indexOf("document.getElementById('d_save').onclick");
  const save = BOARD.slice(a, BOARD.indexOf('};', BOARD.indexOf('setTimeout(', a)));
  assert.match(save, /indexOf\('Saved \\u2713'\)===0/, 'only the plain Saved line auto-clears');
});

test('the board asks for xano_id in the LEAN tier too — the drawer opens from it', () => {
  const min = (BOARD.match(/var SEL_BASE_MIN\s*=\s*'([^']+)'/) || [])[1] || '';
  assert.ok(min.split(',').includes('xano_id'), 'xano_id in SEL_BASE_MIN');
});

// ── the mirror rule this fix exists because of ───────────────────────────────
const MIRROR = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'platform-tn-mirror.js'), 'utf8');

test('the mirror still reads the job\'s denormalized customer_phone — the field the push writes', () => {
  assert.match(MIRROR, /phone:\s*String\(j\.customer_phone/, 'if this ever stops being the source, the push stops working');
});

test('keepTyped still guards phone, and still only guards a BLANK incoming value', () => {
  assert.match(MIRROR, /keepTyped\('customer', custRows, \[[^\]]*'phone'[^\]]*\]\)/);
  const kt = fnBody('keepTyped', MIRROR);
  assert.match(kt, /if \(blankIn && String\(existing/, 'substitutes only when Xano is blank');
  assert.ok(!/inStr !== existing/.test(kt), 'a different non-empty Xano value still wins — that is why we push');
});

// MUT3 SURVIVED THE FIRST RUN and that is what hardened this file. Executing the lifted
// function proves the function works; it proves NOTHING about the save handler still calling
// it. Commenting the one call out left the suite green — and Sofia's edits would silently
// start reverting again. Presence is not reachability: strip comments, and refuse a falsy
// short-circuit in front of the call.
test('the save handler actually REACHES the Xano push — not commented out, not dead-guarded', () => {
  const a = BOARD.indexOf("document.getElementById('d_save').onclick");
  const raw = BOARD.slice(a, BOARD.indexOf('};', BOARD.indexOf('setTimeout(', a)));
  const live = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = live.match(/(\S[^\n;]*)?syncCustomerToXano\s*\(/);
  assert.ok(m, 'syncCustomerToXano is called on a live line of d_save');
  assert.ok(!/(false|0|null|undefined)\s*&&\s*$/.test(m[1] || ''), 'and is not short-circuited off');
});

test('the push runs only after the write is known good — never over a refused save', () => {
  const a = BOARD.indexOf("document.getElementById('d_save').onclick");
  const raw = BOARD.slice(a, BOARD.indexOf('};', BOARD.indexOf('setTimeout(', a)));
  assert.ok(raw.indexOf('if(blocked)') < raw.indexOf('syncCustomerToXano('), 'the refused-write return comes first');
  assert.ok(raw.indexOf('if(err)') < raw.indexOf('syncCustomerToXano('), 'so does the error return');
});
