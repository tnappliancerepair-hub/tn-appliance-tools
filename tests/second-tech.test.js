// second-tech.test.js — THE SECOND MAN ON A JOB (migration 077).
//
// Danielle, 2026-09-15: "Need a way to add and schedule a 2nd man to a job."
//
// The platform already had needs_two_techs since migration 014 — but it is a FLAG and nothing
// more. A tech could raise his hand from the field and the office saw a chip on the card, and
// that was the whole feature: no way to say WHO the second man is, no way to get the stop onto
// his day. The flag announced a problem and left the answer to a phone call.
//
// So the bar this file holds is not "a column exists." It is the four things that make naming
// somebody REAL, each of which has failed silently in this repo before:
//   1. the office can pick him AND the picker shows who is already saved
//   2. the stop lands on HIS day (either seat)
//   3. he gets the same job text the primary tech gets
//   4. a refused write is never reported as saved
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const SQL    = read('docs/sql/077_second_tech.sql');
const OFFICE = read('platform/office-board.html');
const TECH   = read('platform/tech.html');
const NOTIFY = read('netlify/functions/platform-tech-notify.js');

console.log('\n— the column itself —');
t('adds job.technician2_id', /add column if not exists technician2_id/.test(SQL));
t('points at a real technician', /references public\.technician\(id\)/.test(SQL));
// A tech leaving must never delete the job he was helping on. Billy left in July and his jobs
// are still on the board under "Tech 5" — cascade would have taken them with him.
t('a departing tech never deletes the job (SET NULL, not CASCADE)',
  /on delete set null/.test(SQL) && !/technician2_id[\s\S]{0,120}on delete cascade/.test(SQL));
t('the same person cannot hold both seats', /technician2_id <> technician_id/.test(SQL));
t("the day query is indexed on the helper's seat too", /job_tech2_day_idx[\s\S]{0,140}technician2_id/.test(SQL));

console.log('\n— 1. the office can name him, and sees who is already named —');
t('the drawer has a second-man picker', /id="jtech2"/.test(OFFICE));
t('"No second man" is a real choice — she can take him back off',
  /jtech2[\s\S]{0,160}No second man/.test(OFFICE));
// THE ONE THAT WAS BROKEN. techOptions(job.technician2_id) preselects the saved helper, and a
// refused write resets the select back to it — both read `job.technician2_id`, which the board
// select never fetched. The picker rendered blank after a real save: a feature that looks
// built and quietly does nothing.
t('the picker preselects whoever is already saved', /techOptions\(job\.technician2_id\)/.test(OFFICE));
t('ANCHOR: the board actually FETCHES technician2_id', /SEL_BASE_MIN\s*=\s*'[^']*technician2_id/.test(OFFICE));
t('every board tier inherits it (rich builds on min)', /SEL_BASE_RICH\s*=\s*SEL_BASE_MIN/.test(OFFICE));
t('the tile can name him', /SEL_TAIL_RICH\s*=\s*'[^']*helper:technician2_id\(name\)/.test(OFFICE));
t('the 2-man chip says WHO, not just that a second man exists',
  /needs_two_techs\)\s*f\.push\([^;]*j\.helper&&j\.helper\.name/.test(OFFICE));

console.log('\n— naming him IS the flag —');
// Danielle should never have to do the same thing twice. Picking a person turns the flag on.
t('picking a person switches needs_two_techs on', /if\(val && !job\.needs_two_techs\) upd\.needs_two_techs=true/.test(OFFICE));
t('the flag button repaints so the board agrees with what she just did',
  /jflags button\[data-flag="two"\][\s\S]{0,80}classList\.add\('on'\)/.test(OFFICE));
t('she cannot name the primary tech as his own helper',
  /val===String\(job\.technician_id\|\|''\)/.test(OFFICE));

console.log('\n— 4. a refused write is never called saved —');
// Standing rule: an RLS-blocked update returns ZERO rows and NO error, so `if(r.error)` is
// false and it reads as success.
const seg = OFFICE.match(/var jt2=document\.getElementById\('jtech2'\);[\s\S]{0,1600}/);
t('ANCHOR: the second-man handler still lifts out of the board', !!seg);
t('the update asks for the row back', !!seg && /update\(upd\)\.eq\('id',job\.id\)\.select\('id'\)/.test(seg[0]));
t('zero rows back says "Did NOT save"',
  !!seg && /!r\.data\|\|!r\.data\.length[\s\S]{0,120}Did NOT save/.test(seg[0]));
t('a refused write puts the picker back where it was',
  !!seg && /jt2\.value=job\.technician2_id\|\|''; if\(m2\) m2\.textContent='Did NOT save/.test(seg[0]));

console.log('\n— 2. the stop lands on HIS day —');
// The whole point. Before this, a helper had no way to see the job at all.
t("the tech's day matches EITHER seat",
  /\.or\('technician_id\.eq\.'\s*\+\s*myTech\.id\s*\+\s*',technician2_id\.eq\.'\s*\+\s*myTech\.id\)/.test(TECH));
t('the day query reads both seats', /technician_id,technician2_id,/.test(TECH));
t('and both names, so the card can say who the other guy is',
  /technician:technician_id\(name\),helper:technician2_id\(name\)/.test(TECH));

console.log('\n— the card tells him WHICH SEAT he is in —');
// Two names on a job makes "who is the lead?" the very next question. Answer it before he
// calls anybody.
t('a helper is told he is the second man', /You\\'re the 2nd man/.test(TECH));
t('and who leads it', /leads this one/.test(TECH));
t('the lead is told somebody is riding with him', /is riding with you/.test(TECH));
t('an unlinked login still sees both names', /Two-man: /.test(TECH));
t('the chip only renders when a second man is actually named',
  /if \(j\.technician2_id\) \{/.test(TECH));
t('the chip is on the card', /mateChip \+ crewChip/.test(TECH));

console.log('\n— 3. he gets the same job text the primary tech gets —');
t('notify_assigned reads both seats', /select=technician_id,technician2_id/.test(NOTIFY));
t('the caller can name which seat to text', /const wantTech = String\(p\.tech \|\| ''\)/.test(NOTIFY));
// A caller passing a tech who is on neither seat must not be texted about this job.
t('an id on neither seat falls back to the primary tech — never texts a stranger',
  /wantTech === String\(jrow\.technician2_id[\s\S]{0,90}wantTech === String\(jrow\.technician_id[\s\S]{0,60}: jrow\.technician_id/.test(NOTIFY));
t('every existing caller is unchanged (no tech passed = primary)',
  /const wantTech[\s\S]{0,200}\? wantTech : jrow\.technician_id/.test(NOTIFY));
t('his text says he is the second man', /Second man on this one/.test(NOTIFY));
t('the office picker asks for HIM specifically', /notifyAssigned\(job\.id, val\)/.test(OFFICE));
t('notifyAssigned passes the seat through', /function notifyAssigned\([^)]*techId[\s\S]{0,400}tech:\s*techId/.test(OFFICE));

console.log('\n— the dedup cannot swallow his text —');
// THE TRAP: assigning the primary tech and then naming a helper twenty seconds later are two
// different people who each need the job. A job-wide 10-minute dedup would have silently eaten
// the helper's text — built, shipped, and doing nothing.
const dedup = NOTIFY.match(/const recent = await db\.get\(`thread_message\?job_id=eq\.\$\{jobId\}[^`]*`\)/);
t('ANCHOR: the dedup query still lifts out', !!dedup);
t('dedup is per-PERSON, not per-job', !!dedup && /body=ilike[^`]*trow\.name/.test(dedup[0]), dedup && dedup[0]);
t('the thread line names who was added', /added as the second man/.test(NOTIFY));
t('and is a note, not a message the customer replied to',
  /added as the second man/.test(NOTIFY) &&
  /kind: 'note'[\s\S]{0,260}added as the second man/.test(NOTIFY));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
