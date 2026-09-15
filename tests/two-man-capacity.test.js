// 🧑‍🤝‍🧑 TWO-MAN SCHEDULING — the helper seat costs a FULL slot.
//
// The decision this pins (Teddy, 2026-09-15): a two-man stop consumes a WHOLE slot on the
// helper's day. Capacity is about where a BODY can be — a man helping at a stop cannot be at
// another customer's house at the same time. Before this, dispatch never even SELECTED
// technician2_id, so a helper was invisible: his column didn't show the stop, his "N slots
// left" badge over-reported, and suggestSlot would happily book him onto a day he was already
// spoken for. Undercounting strands a real customer.
//
// Every rule below is REGEX-LIFTED OUT OF THE SHIPPED PAGE and executed, so this test cannot
// drift from what the office actually gets.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const DISPATCH = fs.readFileSync('platform/dispatch.html', 'utf8');
const BOARD    = fs.readFileSync('platform/office-board.html', 'utf8');

// Lift the real predicates + the real counter out of dispatch.html and run them.
function lift(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}|function ' + name + '\\([^)]*\\)\\{.*?\\n'));
  assert.ok(m, 'could not lift ' + name + '() out of the shipped page');
  return m[0];
}
const ONJOB   = lift(DISPATCH, 'onJob');
const ISHELP  = lift(DISPATCH, 'isHelperOn');
const BOOKED  = lift(DISPATCH, 'bookedOn');

function harness(jobs) {
  // eslint-disable-next-line no-new-func
  return new Function('jobs', ONJOB + '\n' + ISHELP + '\n' + BOOKED + '\n' +
    'return { onJob: onJob, isHelperOn: isHelperOn, bookedOn: bookedOn };')(jobs);
}

const DAY = '2026-09-17';
const LEE = 'lee-uuid', JIM = 'jim-uuid', AND = 'andre-uuid';
const j = (o) => Object.assign({ scheduled_day: DAY, status: 'scheduled', technician2_id: null }, o);

test('a helper stop counts as a FULL slot on his day — not half, not zero', () => {
  // Lee is primary on 3 of his own, and the second man on 3 of Jimmy's.
  const jobs = [
    j({ technician_id: LEE }), j({ technician_id: LEE }), j({ technician_id: LEE }),
    j({ technician_id: JIM, technician2_id: LEE }),
    j({ technician_id: JIM, technician2_id: LEE }),
    j({ technician_id: JIM, technician2_id: LEE }),
  ];
  const h = harness(jobs);
  assert.strictEqual(h.bookedOn(LEE, DAY), 6, 'Lee is spoken for on all six — he cannot be in two places');
  assert.strictEqual(h.bookedOn(JIM, DAY), 3, "the primary's own count is unchanged by naming a helper");
  assert.strictEqual(h.bookedOn(AND, DAY), 0, 'a tech on neither seat carries nothing');
});

test('completed + canceled two-man stops free the helper back up', () => {
  const jobs = [
    j({ technician_id: JIM, technician2_id: LEE, status: 'completed' }),
    j({ technician_id: JIM, technician2_id: LEE, status: 'canceled' }),
    j({ technician_id: JIM, technician2_id: LEE }),
  ];
  assert.strictEqual(harness(jobs).bookedOn(LEE, DAY), 1, 'only the live stop holds a slot');
});

test('onJob matches EITHER seat; isHelperOn only the second', () => {
  const h = harness([]);
  const two = j({ technician_id: JIM, technician2_id: LEE });
  assert.ok(h.onJob(two, JIM) && h.onJob(two, LEE), 'both men are on the stop');
  assert.ok(h.isHelperOn(two, LEE), 'Lee is there as the second man');
  assert.ok(!h.isHelperOn(two, JIM), 'the primary is never his own helper');
  const solo = j({ technician_id: JIM });
  assert.ok(!h.onJob(solo, LEE) && !h.isHelperOn(solo, LEE), 'a one-man stop puts nobody else on the hook');
});

test('dispatch actually SELECTS technician2_id — it was structurally blind before', () => {
  const sel = (DISPATCH.match(/sb\.from\('job'\)\.select\('id,status,problem,availability[^']*'\)/) || [''])[0];
  assert.ok(sel, 'found the dispatch job select');
  assert.ok(/technician2_id/.test(sel), 'the board asks for the second seat — without this every count below is a guess');
});

test('every capacity reader shares ONE predicate, so they cannot disagree', () => {
  // The grid badge, the window count, and the suggester all have to read the same thing.
  for (const fn of ['bookedOn', 'winDayJobs']) {
    const body = lift(DISPATCH, fn);
    assert.ok(/onJob\(/.test(body), fn + '() counts both seats via onJob()');
    assert.ok(!/j\.technician_id===techId/.test(body), fn + '() no longer counts the primary seat only');
  }
  // The week-grid cell that draws a tech's day.
  assert.ok(/var mine=jobs\.filter\(function\(j\)\{ return onJob\(j,t\.id\)/.test(DISPATCH),
    "the helper's own column shows the stop he is on");
  // suggestSlot's route-fit: a helper stop is a real place he already is.
  const sug = (DISPATCH.match(/function suggestSlot\([\s\S]*?\n  \}/) || [''])[0];
  assert.ok(/onJob\(j,t\.id\)/.test(sug), 'route-fit counts a helper stop as somewhere he already is');
});

test('a helper stop never reads as his own job', () => {
  assert.ok(/isHelperOn\(j,t\.id\)/.test(DISPATCH), 'the block knows which seat it is drawing');
  assert.ok(/🧑‍🤝‍🧑 with '\+esc\(/.test(DISPATCH), 'it names who he is helping instead of an ordinal stop number');
  assert.ok(/\.wblk\.helper\{/.test(DISPATCH), 'and it is visually distinct — the primary owns the report, not him');
});

test('naming a helper checks he is actually working that day', () => {
  // Strip comments so an assertion can never pass on prose explaining the fix.
  const code = BOARD.replace(/\/\/[^\n]*/g, '');
  const h = code.indexOf("var jt2=document.getElementById('jtech2')");
  assert.ok(h > 0, 'found the second-man picker');
  const block = code.slice(h, h + 2600);
  assert.ok(/from\('tech_time_off'\)[\s\S]*?\.eq\('technician_id',val\)[\s\S]*?\.eq\('day',job\.scheduled_day\)/.test(block),
    'it asks whether that man is off that exact day');
  assert.ok(/technician2_id:val/.test(block) && /doSave/.test(block),
    'the write is gated behind the check, not fired alongside it');
});
