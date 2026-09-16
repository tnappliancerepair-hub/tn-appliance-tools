// Danielle, 2026-09-16: "every time that they put a report in, she can see the information.
// It's just not visible to them, and they're unable to close out the ticket ... because it's
// not showing that the TDR is completed ... having to redo it because it didn't save."
//
// She was right, and it was not a save failure. job_tdr carries a UNIQUE index on job_id
// (job_tdr_job_id_key), so PostgREST embeds it as a TO-ONE and returns an OBJECT -- measured
// live 2026-09-16: `"tdr": {...}` on a job with a report, `"tdr": null` on one without, while
// every other reverse embed on job (job_media / job_part / job_tag / thread_message) correctly
// returns []. Both tech surfaces read `j.tdr[0]`, which on an object is undefined -- so the
// readback line never rendered, every report field re-rendered blank, the button kept saying
// "Complete + report" instead of "Edit report", and the machine-switcher check never appeared.
//
// These assertions EXECUTE the real oneTdr() lifted out of each shipped page rather than
// pattern-matching it, and pin that the two copies can never drift apart.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'platform');
const PAGES = ['tech.html', 'tech-job.html'];
const src = {};
for (const p of PAGES) src[p] = fs.readFileSync(path.join(DIR, p), 'utf8');

// Strip // line comments so a rule can never be satisfied by the comment explaining it.
function stripComments(s) {
  return s.split('\n').map((l) => l.replace(/(^|[^:"'])\/\/.*$/, '$1')).join('\n');
}

// Lift the real one-liner out of the shipped page and run it.
function liftOneTdr(page) {
  const m = src[page].match(/function oneTdr\(v\)\{[^\n]*\}/);
  assert.ok(m, page + ' no longer defines oneTdr');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[0] + '; this.oneTdr = oneTdr;', sandbox);
  return { fn: sandbox.oneTdr, text: m[0] };
}

test('the real oneTdr reads the OBJECT shape PostgREST actually returns', () => {
  for (const p of PAGES) {
    const { fn } = liftOneTdr(p);
    const row = { id: 'x', failed_component: 'Heating element', outcome: 'fixed' };
    assert.deepStrictEqual(fn(row), row, p + ': an embedded object must come back as the report');
    assert.strictEqual(fn(null), null, p + ': no report is null');
  }
});

test('it still reads the ARRAY shape, so dropping the unique index cannot break the tech app', () => {
  for (const p of PAGES) {
    const { fn } = liftOneTdr(p);
    const row = { id: 'x', failed_component: 'Drain pump' };
    assert.deepStrictEqual(fn([row]), row, p + ': an array must yield its first row');
    assert.strictEqual(fn([]), null, p + ': an empty array is no report');
  }
});

test('nothing falsy blows up the render', () => {
  for (const p of PAGES) {
    const { fn } = liftOneTdr(p);
    assert.strictEqual(fn(undefined), null, p);
    assert.strictEqual(fn(0), null, p);
    assert.strictEqual(fn(''), null, p);
  }
});

test('both copies of oneTdr are identical, so they can never drift', () => {
  const [a, b] = PAGES.map((p) => liftOneTdr(p).text);
  assert.strictEqual(a, b, 'tech.html and tech-job.html define oneTdr differently');
});

test('no surface reads a report as an array any more', () => {
  for (const p of PAGES) {
    const live = stripComments(src[p]);
    assert.ok(!/\.tdr\s*\[\s*0\s*\]/.test(live), p + ' still reads .tdr[0] -- a filed report renders blank');
    assert.ok(!/\.tdr\s*&&\s*[a-z]*\.?tdr\.length/.test(live), p + ' still reads .tdr.length');
  }
});

test('the day list drives the readback AND the button label off oneTdr', () => {
  const live = stripComments(src['tech.html']);
  assert.ok(/var tdr = oneTdr\(j\.tdr\);/.test(live), 'tech.html no longer resolves the report via oneTdr');
  // one resolve feeds both the "Edit report" label and the readback line
  assert.ok(/data-tdr="'\+j\.id\+'">'\+\(tdr\?'Edit report':/.test(live), 'the Edit-report label no longer follows the resolved report');
  assert.ok(/var tdrDone = tdr \?/.test(live), 'the readback line no longer follows the resolved report');
});

test('the job page and the machine switcher both resolve through oneTdr', () => {
  const live = stripComments(src['tech-job.html']);
  assert.ok(/function tdr\(\)\{ return oneTdr\(job\.tdr\); \}/.test(live), 'tech-job.html no longer resolves the report via oneTdr');
  assert.ok(/var done=oneTdr\(m\.tdr\)\?/.test(live), 'the machine-switcher check mark no longer follows the resolved report');
});

test('the report fields on the job page are prefilled from the resolved report', () => {
  const live = stripComments(src['tech-job.html']);
  assert.ok(/var s = st\(job\.status\), cust = job\.customer \|\| \{\}, a = attrs\(\), t = tdr\(\);/.test(live),
    'the job page render no longer resolves t = tdr()');
  for (const f of ['failed_component', 'root_cause', 'labor_hours']) {
    assert.ok(new RegExp('t\\??\\s*&?&?\\s*t\\.' + f).test(live) || live.includes('t.' + f),
      'the job page no longer prefills ' + f + ' from the filed report');
  }
});
