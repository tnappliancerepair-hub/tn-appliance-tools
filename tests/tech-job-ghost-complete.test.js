// Jimmy, 2026-09-16: "This job shows Complete, only thing I did was sit on the way.
// Haven't even been to the job." He was right. Xano keeps job state in TWO columns
// (scheduling_status + current_status) and a fresh intake had been stamped completed on
// one of them alone, with no completion timestamp anywhere. The mirror reads the stamped
// column, so the phantom landed on his job page -- which then offered him a "How'd we
// do?" review ask for a customer nobody had visited yet.
//
// These assertions lift ghostDone() OUT of the shipped page and EXECUTE it, so the test
// cannot drift from what the tech actually gets.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const HTML = fs.readFileSync(__dirname + '/../platform/tech-job.html', 'utf8');

// Lift the real function. `job` is a closure var on the page, so it becomes the parameter.
const src = (HTML.match(/function ghostDone\(\)\{[\s\S]*?\n  \}/) || [])[0];
assert.ok(src, 'ghostDone() must exist in platform/tech-job.html');
const ghost = new Function('job', src + '\nreturn ghostDone();');

const d = (offsetDays) => {
  const n = new Date(); n.setDate(n.getDate() + offsetDays);
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
};

test('a job scheduled today that reads completed with no stamp is a phantom', () => {
  assert.strictEqual(ghost({ status: 'completed', completed_at: null, scheduled_day: d(0) }), true);
});

test('a future-scheduled completed job with no stamp is a phantom', () => {
  assert.strictEqual(ghost({ status: 'completed', completed_at: null, scheduled_day: d(2) }), true);
});

// THE LOAD-BEARING ONE. 334 jobs legitimately read completed with no platform stamp because
// they were finished in the office system before/outside the platform. Flagging those would
// be far worse than the bug -- it would call every historical job a phantom.
test('an old completion with no stamp is NOT a phantom', () => {
  assert.strictEqual(ghost({ status: 'completed', completed_at: null, scheduled_day: d(-30) }), false);
  assert.strictEqual(ghost({ status: 'completed', completed_at: null, scheduled_day: d(-1) }), false);
});

test('a real completion today is NOT a phantom -- the stamp is what proves it', () => {
  assert.strictEqual(ghost({ status: 'completed', completed_at: '2026-09-16T14:44:00Z', scheduled_day: d(0) }), false);
});

test('non-completed statuses are never phantoms', () => {
  for (const s of ['new', 'scheduled', 'in_progress', 'awaiting_parts', 'canceled']) {
    assert.strictEqual(ghost({ status: s, completed_at: null, scheduled_day: d(0) }), false, s);
  }
});

test('a job with no scheduled_day is never a phantom', () => {
  assert.strictEqual(ghost({ status: 'completed', completed_at: null, scheduled_day: null }), false);
});

test('missing job object does not throw', () => {
  assert.strictEqual(ghost(null), false);
});

// ── the wiring, so the gates cannot silently drift back ──────────────────────────────
test('the review ask REQUIRES a real completion stamp', () => {
  assert.ok(
    /job\.status==='completed'&&job\.completed_at\?reviewAskHtml\(\)/.test(HTML),
    'review ask must be gated on completed_at, not on status alone -- otherwise a tech can text ' +
    '"how did we do?" to a customer whose job has not happened'
  );
  assert.ok(
    !/\(job\.status==='completed'\?reviewAskHtml\(\)/.test(HTML),
    'the status-only review gate must not come back'
  );
});

test('a phantom shows the honest banner and hides reopen', () => {
  assert.ok(/ghostDone\(\)\?'<div class="ghostdone">/.test(HTML), 'banner renders for a phantom');
  assert.ok(/!ghostDone\(\)&&\(job\.status==='completed'\|\|job\.status==='canceled'\)/.test(HTML),
    'reopen is hidden on a phantom -- it writes the platform row and the mirror overwrites it');
});

test('the banner does not promise reopening will work', () => {
  const banner = (HTML.match(/<div class="ghostdone">([\s\S]*?)<\/div>/) || [])[1] || '';
  assert.ok(banner.length > 40, 'banner has real copy');
  assert.ok(/overwritten/i.test(banner), 'banner must say reopening here gets overwritten');
});
