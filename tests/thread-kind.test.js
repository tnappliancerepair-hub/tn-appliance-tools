// thread-kind.test.js — MESSAGE vs NOTE in the shared conversation (migration 075).
//
// Teddy, 2026-09-15: "Danielle also mentioned something about the text messages... We want
// the text messages to be readable by the technicians and by the office, and we want them to
// be scrollable. And we want to be able to see if the customers opened it or if the techs
// have opened it."
//
// MEASURED ON THE LIVE BOARD BEFORE WRITING A LINE — every inbound row, by channel:
//     in · portal  1004   "✍️ Release of liability signed by X", "✅ Finished intake"
//     in · sms      239   the ONLY real inbound texts
//     in · email     39   Frontdoor/AHS dispatch emails
//     in · call      10   "📅 Requested Friday, Sep 4 (by phone)"
//     in · lsa        2   a pasted Google LSA lead transcript
// So 81% of her inbound side is a line one of our own functions composed, every one of them
// wearing a blue CUSTOMER bubble. And the inbox decided "← they replied" purely on the last
// row being inbound, so 39 of the 85 conversations it flagged were a dispatch email. Nobody
// is waiting on a reply to a dispatch email. Backfill dropped that queue 85 → 56.
//
// The rule is REGEX-LIFTED OUT OF THE SHIPPED FILES — the module the browsers load and the
// copy the server computes needs_reply from — so the two can never drift apart. A drifted
// rule here means the office and the tech disagree about who is waiting.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// The browser module, loaded exactly as a page loads it.
const root = { document: { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild() {} } } };
new Function('window', 'document', read('platform/ant-thread.js') + '\n//# sourceURL=ant-thread.js')(root, root.document);
const T = root.AntThread;

// The SERVER's copy of the same rule, lifted out of the shipped function.
const SRV = read('netlify/functions/platform-messages.js');
const srvSrc = (SRV.match(/function isNote\(m\)\s*\{[\s\S]*?\n\}/) || [])[0];
const serverIsNote = srvSrc ? new Function('return (' + srvSrc + ')')() : null;

const MSGS   = read('platform/messages.html');
const OFFICE = read('platform/office-board.html');
const TECHJOB = read('platform/tech-job.html');
const SQL    = read('docs/sql/075_thread_kind.sql');

// The exact shapes the live board actually holds.
const waiver   = { direction: 'in',  channel: 'portal', sender: 'customer', kind: 'note', body: '✍️ Release of liability signed by Adam Alexander — declined hoses' };
const intake   = { direction: 'in',  channel: 'portal', sender: 'customer', kind: 'note', body: '✅ Finished intake — ready to schedule' };
const dispatch = { direction: 'in',  channel: 'email',  sender: 'warranty', kind: 'note', body: '📥 Ahs/Frontdoor dispatch #83860169: Other refrigerator' };
const byPhone  = { direction: 'in',  channel: 'call',   sender: 'ann',      kind: 'note', body: '📅 Requested Friday, Sep 4 (by phone)' };
const realText = { direction: 'in',  channel: 'sms',    sender: 'customer', kind: 'message', body: 'Yes that time works' };
const photo    = { direction: 'in',  channel: 'sms',    sender: 'customer', kind: 'message', body: '[photo/video]' };
const danielle = { direction: 'out', channel: 'sms',    sender: 'office:Danielle', kind: 'message', body: '11-2 on Friday' };
const techTxt  = { direction: 'out', channel: 'sms',    sender: 'tech:Joey Grover', kind: 'message', body: 'Good news parts are in' };
const otwLog   = { direction: 'out', channel: 'otw',    sender: 'tech',     kind: 'message', body: '🚚 On my way' };

console.log('\n— a note is a fact about the job, never the customer speaking —');
t('the waiver signature is a note',        T.isNote(waiver));
t('the finished-intake marker is a note',  T.isNote(intake));
t('a warranty dispatch email is a note',   T.isNote(dispatch));
t('a day asked for by phone is a note',    T.isNote(byPhone));

console.log('\n— a message is somebody actually talking —');
t('a real inbound text is a message',      !T.isNote(realText));
t('a texted photo is a message',           !T.isNote(photo));
t("Danielle's text is a message",          !T.isNote(danielle));
t("a tech's text is a message",            !T.isNote(techTxt));

console.log('\n— the safety net for a writer we have not taught yet —');
// The column is the truth, but a caller that hasn't been updated must not be able to
// reintroduce a fake customer reply. Every inbound non-SMS row on the live board is
// machine-composed, so falling back to that is safe.
t('an un-stamped waiver still reads as a note',
  T.isNote({ direction: 'in', channel: 'portal', sender: 'customer', body: '✍️ Release of liability signed by Someone' }));
t('an un-stamped dispatch email still reads as a note',
  T.isNote({ direction: 'in', channel: 'email', sender: 'warranty', body: '📥 dispatch #1' }));
t('an un-stamped inbound SMS is still a real message',
  !T.isNote({ direction: 'in', channel: 'sms', sender: 'customer', body: 'hello' }));

console.log('\n— outbound is NEVER inferred —');
// Some of our own rows are the real text and some are a log line about having sent one, and
// they are not separable from the channel. Wrongly HIDING something we told a customer is
// the expensive direction, so an un-stamped outbound row always shows.
t('an un-stamped outbound log line still shows',
  !T.isNote({ direction: 'out', channel: 'otw', sender: 'tech', body: '🚚 On my way' }));
t('an un-stamped outbound reminder still shows',
  !T.isNote({ direction: 'out', channel: 'reminder', sender: 'system', body: '🔔 Day-before reminder sent' }));
t('only an explicit stamp can hide an outbound row',
  T.isNote({ direction: 'out', channel: 'assign', sender: 'system', kind: 'note', body: '🧰 Assigned to Andre' }));

console.log('\n— the server and the browser answer identically —');
t('the server carries its own copy of the rule', !!serverIsNote);
if (serverIsNote) {
  const cases = [waiver, intake, dispatch, byPhone, realText, photo, danielle, techTxt, otwLog,
    { direction: 'in', channel: 'portal', sender: 'customer', body: 'unstamped' },
    { direction: 'out', channel: 'reminder', sender: 'system', body: 'unstamped out' }];
  const agree = cases.every((c) => serverIsNote(c) === T.isNote(c));
  t('server isNote === browser isNote on every real shape', agree,
    cases.map((c) => [c.channel, serverIsNote(c), T.isNote(c)]));
}

console.log('\n— who spoke, as a person reads it —');
t('the customer is named, not "Customer"', /Paula/.test(T.speaker(realText, { customerName: 'Paula Dufour' })));
t('Danielle is named',       /Danielle/.test(T.speaker(danielle)));
t('the tech is named',       /Joey Grover/.test(T.speaker(techTxt)));
t('Ann is Ann',              /Ann/.test(T.speaker({ direction: 'out', sender: 'ann' })));
// Rows teed over from the old system carry a bare first name. Showing it beats swallowing
// a real person into a generic "Us" — Lee and John both appear that way on the live board.
t('a bare first name is shown, not swallowed',
  /Lee/.test(T.speaker({ direction: 'out', sender: 'Lee', body: 'x' })));

console.log('\n— the office queue only counts people —');
// This is the whole complaint: 39 of 85 flagged conversations were a dispatch email.
t('needs_reply is computed from the last thing a HUMAN said',
  /lastSaid/.test(SRV) && /needs_reply:\s*!!\(c\.lastSaid && c\.lastSaid\.direction === 'in'\)/.test(SRV));
t('the unread dot follows the same rule',
  /unread:\s*!!\(c\.lastSaid && c\.lastSaid\.direction === 'in'\)/.test(SRV));
t('a note can never become lastSaid', /if \(!isNote\(m\) && !c\.lastSaid\)/.test(SRV));
t('the list still asks the database for kind', /select=customer_id,job_id,direction,channel,sender,body,kind,created_at/.test(SRV));
t('the thread still asks the database for kind', /select=id,job_id,direction,channel,sender,body,kind,delivery_status,created_at/.test(SRV));

console.log('\n— ONE definition, three surfaces —');
// ant-part-route.js and ant-part-note.js exist because copies drifted. Same rule here: the
// office inbox, the board drawer and the tech's job page must render one conversation the
// same way, or the two seats argue about what a customer said.
[['the Messages page', MSGS], ['the board drawer', OFFICE], ["the tech's job page", TECHJOB]].forEach(([name, S]) => {
  t(name + ' loads the shared module', /src="\/platform\/ant-thread\.js"/.test(S));
  t(name + ' renders through it', /AntThread\.mount\(/.test(S));
});
t('the board drawer kept no private bubble renderer', !/function threadBubble\(/.test(OFFICE));
t("the tech page kept no private bubble renderer", !/function whoOf\(m\)\{/.test(TECHJOB.replace(/\s/g, '')) || !/whoOf/.test(TECHJOB));

console.log('\n— the scroll —');
// Teddy asked for scrollable. Every host sizes its own box; the module must not fight it.
t('the module scrolls and never sets its own height', /overflow-y:auto/.test(read('platform/ant-thread.js')) && !/\.anth\{[^}]*max-height/.test(read('platform/ant-thread.js')));
t('it jumps to the newest message', /el\.scrollTop = el\.scrollHeight/.test(read('platform/ant-thread.js')));
t('the board drawer still caps its own box',  /id="jthread"[^>]*max-height:260px/.test(OFFICE));
t('the tech card still caps its own box',     /\.thr\{[^}]*max-height:340px/.test(TECHJOB));

console.log('\n— the tech reads the whole person, not one job —');
// A tech walking into a return visit needs what was said last time, not a thread that
// starts today.
t('the tech page loads the customer, not just the job', /\.eq\('customer_id',job\.customer_id\)/.test(TECHJOB));
t('it falls back to the job when there is no customer', /\.eq\('job_id',jobId\)/.test(TECHJOB));

console.log('\n— who has opened it —');
// The office has marked conversations read since 09-14 (152 of them on the day this shipped);
// nothing ever recorded the other direction.
t('the tech app records that he opened it', /type:'thread_seen'/.test(TECHJOB));
t('it records WHO', /by:'tech:'\+who/.test(TECHJOB));
t('it only fires on something a person actually said', /!\(window\.AntThread&&window\.AntThread\.isNote\(m\)\)/.test(TECHJOB));
t('it does not re-stamp on every poll', /_seenKey/.test(TECHJOB));
// THE ONE THAT MATTERS: the office's unread queue runs on 'thread_read'. If a tech's mark
// landed in that bucket, him opening a job would silently clear HER dot and she'd lose a
// customer who was waiting.
t("a tech's mark can never clear the office's unread queue",
  !/type:'thread_read'/.test(TECHJOB) && /eq\('type','thread_seen'\)/.test(OFFICE));
t('the office shows who opened it', /Opened by/.test(OFFICE));

console.log('\n— the migration —');
t('kind defaults to message so an un-updated writer is unchanged', /default 'message'/.test(SQL));
t('only two values are allowed', /check \(kind in \('message','note'\)\)/.test(SQL));
t('the backfill is inbound-only', /direction = 'in'\s*\n?\s*and channel in \('portal','email','call','lsa'\)/.test(SQL.replace(/\r/g, '')));
t('the backfill never touches outbound', !/direction = 'out'\s+and channel in/.test(SQL));
t('it is re-runnable', /add column if not exists/.test(SQL) && /where kind <> 'note'/.test(SQL));

console.log('\n— the writers stamp it, so the fallback stays a net —');
[['the waiver + intake notes', 'netlify/functions/platform-intake.js'],
 ['the portal verify note',    'netlify/functions/platform-portal-update.js'],
 ['the mirrored waiver note',  'netlify/functions/platform-tn-intake-tee.js'],
 ['the phone day + callback',  'netlify/functions/platform-call-act.js'],
 ['the warranty dispatch email', 'netlify/functions/_lib/platform-warranty-db.js'],
 ['the typed-lead line',       'platform/ant-new-job.js']].forEach(([name, p]) => {
  t(name + " stamps kind:'note'", /kind: 'note'/.test(read(p)));
});

console.log('\n— the delivery receipt (076) —');
const DLR    = read('netlify/functions/_lib/sms-dlr.js');
const GUARD  = read('netlify/functions/_lib/sms-guard.js');
const SMSLIB = read('netlify/functions/_lib/sms.js');
const NOTIFY = read('netlify/functions/platform-tech-notify.js');
const SQL76  = read('docs/sql/076_thread_delivery.sql');
const THREADJS = read('platform/ant-thread.js');

// ⚠️ THE ONE THAT MATTERS MOST. Teddy asked to see "if the customer opened it" — SMS has no
// read receipt and never will. Telling a tech a customer READ something we only know was
// DELIVERED is how he stops trusting the tool. Nothing on this path may claim it.
t('a delivered text says Delivered, not read',
  /✓ Delivered/.test(THREADJS) && !/anth-rcpt[^]*?\b(read|opened|seen)\b/i.test(THREADJS.match(/function receipt\(m\)[\s\S]*?\n  \}/)[0]));
t("the receipt renderer never emits 'read'/'opened'",
  !/'read'|"read"|Opened|Read receipt/i.test(THREADJS.match(/function receipt\(m\)[\s\S]*?\n  \}/)[0]));
t('the migration says so out loud', /does not exist for SMS/i.test(SQL76));
t('the receipt module says so out loud', /does not exist for SMS/i.test(DLR));

t('nothing is shown until the carrier tells us',
  T.receipt({ direction: 'out', delivery_status: null }) === '' &&
  T.receipt({ direction: 'out', delivery_status: 'sent' }) === '');
t('a delivered text gets a tick', /Delivered/.test(T.receipt({ direction: 'out', delivery_status: 'delivered' })));
t('a bounced text says so plainly', /NOT reach/.test(T.receipt({ direction: 'out', delivery_status: 'failed' })));
t('an inbound message never carries a receipt', T.receipt({ direction: 'in', delivery_status: 'delivered' }) === '');

console.log('\n— the carrier id survives the whole send path —');
// Without the id, a receipt arrives knowing only a carrier reference and has nowhere to land.
t('telnyxDirect hands back the id', /return \{ ok: true, id \}/.test(GUARD));
t('deliver carries it out',        /return \{ ok: true, id: dr\.id \}/.test(GUARD));
t('guardedSend returns it',        /provider_id: dres\.id \|\| null/.test(GUARD));
t('sendSmsDetailed returns it',    /provider_id: res\.provider_id \|\| null/.test(SMSLIB));
t('the office send stamps it on the row', /provider_id: providerId/.test(SRV));
t('the tech + office free-form sends stamp it', (NOTIFY.match(/provider_id: pid/g) || []).length === 2);

// ⚠️ An object is ALWAYS truthy. telnyxDirect and deliver both used to return a bare
// boolean; if any call site still read the return value directly, every FAILED send would
// now look successful and we would tell Danielle a text went out that never did.
t('every telnyxDirect call site reads .ok, never the object',
  !/if \(await telnyxDirect\(/.test(GUARD) && /const dr = await telnyxDirect\([\s\S]{0,80}?if \(dr\.ok\)/.test(GUARD));
t('every deliver call site reads .ok, never the object',
  !/if \(await deliver\(/.test(GUARD) && /const dres = await deliver\([\s\S]{0,60}?const ok = dres\.ok/.test(GUARD));
t('the xano path claims no id it does not have', /return \{ ok: true, id: null \}/.test(GUARD));

console.log('\n— the receipt finds its bubble —');
t('success is recorded now, not just failure', /anyDelivered/.test(DLR));
t('failure recording is unchanged',            /sms_delivery_failed/.test(DLR));
t('it matches on the carrier id',              /provider_id=eq\./.test(DLR));
t('it is time-boxed so it can never stall a live inbound text', /AbortSignal\.timeout\(4000\)/.test(DLR));
t('it never throws',                           /catch \(_\) \{ return \{ isDlr: false, failed: false \}; \}/.test(DLR));
t('delivered stamps a time',                   /patch\.delivered_at/.test(DLR));

console.log('\n— every reader asks for it —');
t('the Messages page asks the server for delivery_status', /body,kind,delivery_status,created_at/.test(SRV));
t('the board drawer asks for it',  /body,kind,delivery_status,created_at,channel/.test(OFFICE));
t('the tech page asks for it',     (TECHJOB.match(/kind,channel,delivery_status,created_at/g) || []).length === 2);
t('the migration indexes the lookup the receipt runs', /thread_provider_id_idx/.test(SQL76));

console.log('\n' + (fail ? '✖ ' : '✓ ') + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
