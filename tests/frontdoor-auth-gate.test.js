// Proves frontdoor-auth-watch can never again call a 404 "authorized".
//
// The decision is LIFTED VERBATIM out of the shipped file (regex-extracted at test time),
// so this test cannot drift from the code the way a hand-copied assertion would. If someone
// widens the gate back to "anything that isn't 403", these fail.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'frontdoor-auth-watch.js'), 'utf8');

const mReach = src.match(/const REACHABLE = (\[[^\]]*\]);/);
const mState = src.match(/const state = ([^;]+);/);
if (!mReach) throw new Error('could not find REACHABLE in frontdoor-auth-watch.js');
if (!mState) throw new Error('could not find the state ternary in frontdoor-auth-watch.js');

const REACHABLE = eval(mReach[1]);                                  // eslint-disable-line no-eval
const cleared = (status) => REACHABLE.includes(status);
// The shipped ternary closes over `cleared` (the boolean, not the fn), so feed it both.
const stateOf = (status) => eval(`(function(status, cleared){return ${mState[1]};})`)(status, cleared(status)); // eslint-disable-line no-eval

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', label); } }

// The bug that shipped: a 404 read as success and texted a false all-clear twice.
ok(cleared(404) === false, '404 is NOT cleared — this is the whole bug');
ok(stateOf(404) === 'path_not_found', '404 reports path_not_found (OUR fix, not theirs)');

// The genuine wait.
ok(cleared(403) === false, '403 is NOT cleared');
ok(stateOf(403) === 'not_authorized', '403 reports not_authorized (THEIRS to clear)');
ok(stateOf(403) !== stateOf(404), '403 and 404 are distinct states — they need opposite fixes');

// What actually proves the endpoint took our token.
ok(cleared(200) === true, '200 is cleared');
ok(cleared(201) === true, '201 is cleared');
ok(cleared(202) === true, '202 is cleared');
ok(cleared(400) === true, '400 is cleared — auth accepted, body rejected is a PASS');
ok(cleared(422) === true, '422 is cleared — same reason');
ok(cleared(405) === true, '405 is cleared — wrong method still proves the path is real');
ok(stateOf(200) === 'reachable', '200 reports reachable');
ok(stateOf(400) === 'reachable', '400 reports reachable');

// Bad token must never read as success.
ok(cleared(401) === false, '401 is NOT cleared');
ok(stateOf(401) === 'token_rejected', '401 reports token_rejected');

// A dead network (status 0) must not alert.
ok(cleared(0) === false, 'network failure (0) is NOT cleared');
ok(stateOf(0) === 'unknown', 'status 0 reports unknown');

// Server-side errors are not authorization either.
ok(cleared(500) === false, '500 is NOT cleared');
ok(cleared(502) === false, '502 is NOT cleared');
ok(cleared(503) === false, '503 is NOT cleared');

// The shape of the gate itself: it must be an allowlist, not a denylist.
ok(REACHABLE.length > 0 && REACHABLE.every((n) => typeof n === 'number'), 'REACHABLE is a numeric allowlist');
ok(!REACHABLE.includes(404) && !REACHABLE.includes(403), 'neither 403 nor 404 is in the allowlist');

console.log(`frontdoor-auth-gate: ${pass}/${pass + fail} pass`);
if (fail) process.exit(1);
