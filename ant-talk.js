// Reusable "Talk to Ant" office widget — drop <script src="/ant-talk.js"></script>
// on any office page and it injects a 💬 Talk to Ant button + chat panel.
// Danielle (or anyone) just says/types what they need; it calls /office-assist
// to parse intent and runs it against the same Xano endpoints the board uses.
//
// After an action it calls window.AntTalkReload() if the page defines it, so the
// page can refresh its list. Voice (Web Speech) + text both work.
(function () {
  'use strict';
  var XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  var TECH_ID_BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, john: 6 };
  var FOLDER = { follow_up: 'Follow Up', needs_invoice: 'Needs Invoice', waiting_parts: 'Waiting Parts', completed: 'Completion', needs_scheduled: 'Needs Scheduled' };

  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  async function postJSON(ep, body) {
    var r = await fetch(XANO + '/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json().catch(function () { return {}; });
  }
  function reload() { try { if (typeof window.AntTalkReload === 'function') window.AntTalkReload(); } catch (_) {} }

  function inject() {
    if (document.getElementById('ant-talk-fab')) return;
    var css = document.createElement('style');
    css.textContent =
      '#ant-talk-fab{position:fixed;right:14px;bottom:74px;z-index:9055;background:linear-gradient(135deg,#1f6fed,#3b86ff);color:#fff;border:0;border-radius:26px;padding:13px 18px;font-size:15px;font-weight:800;box-shadow:0 6px 20px rgba(31,111,237,.4);cursor:pointer}' +
      '#ant-talk-fab:active{transform:scale(.96)}' +
      '#ant-talk-panel{position:fixed;right:12px;bottom:130px;width:min(360px,92vw);height:min(460px,70vh);background:#fff;border:1px solid #e3e8ef;border-radius:16px;box-shadow:0 12px 40px rgba(16,36,62,.25);z-index:9056;display:none;flex-direction:column;overflow:hidden}' +
      '#ant-talk-panel.open{display:flex}' +
      '.atk-h{display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #eef1f5;font-weight:800;color:#10243e}' +
      '.atk-h .x{margin-left:auto;background:none;border:0;font-size:18px;color:#5a6b80;cursor:pointer}' +
      '.atk-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}' +
      '.atk-b{max-width:85%;padding:9px 12px;border-radius:13px;font-size:14px;line-height:1.45}' +
      '.atk-b.it{background:#f0f4f9;color:#10243e;align-self:flex-start}' +
      '.atk-b.me{background:#1f6fed;color:#fff;align-self:flex-end}' +
      '.atk-in{display:flex;gap:8px;padding:10px;border-top:1px solid #eef1f5}' +
      '.atk-in input{flex:1;font-size:16px;padding:10px;border:1px solid #e3e8ef;border-radius:10px}' +
      '.atk-in button{background:#1f6fed;color:#fff;border:0;border-radius:10px;padding:0 14px;font-weight:800;cursor:pointer}' +
      '.atk-mic.live{background:#d6432a !important}';
    document.head.appendChild(css);

    var fab = document.createElement('button');
    fab.id = 'ant-talk-fab'; fab.textContent = '💬 Talk to Ant'; fab.onclick = openPanel;
    document.body.appendChild(fab);

    var panel = document.createElement('div');
    panel.id = 'ant-talk-panel';
    panel.innerHTML =
      '<div class="atk-h">💬 Ant <button class="x" onclick="window.__antTalkClose()">✕</button></div>' +
      '<div class="atk-log" id="atk-log"></div>' +
      '<div class="atk-in"><button class="atk-mic" id="atk-mic" title="Talk">🎤</button>' +
      '<input id="atk-in" placeholder="Tell me what you need…" autocomplete="off">' +
      '<button id="atk-send">Send</button></div>';
    document.body.appendChild(panel);

    var sendEl = document.getElementById('atk-send');
    var inEl = document.getElementById('atk-in');
    var micEl = document.getElementById('atk-mic');
    if (sendEl) sendEl.onclick = send;
    if (inEl) inEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    if (micEl) micEl.onclick = voice;
  }

  window.__antTalkClose = function () { document.getElementById('ant-talk-panel').classList.remove('open'); };
  function openPanel() {
    var p = document.getElementById('ant-talk-panel'); p.classList.add('open');
    var log = document.getElementById('atk-log');
    if (!log.dataset.greeted) {
      log.dataset.greeted = '1';
      msg('it', 'Hi! Just tell me what you need. Try "schedule the Carson job with Jimmy Thursday", "assign Andre to 18537", "the Davis job parts came in", or "auto-schedule the Smith job".');
    }
    document.getElementById('atk-in').focus();
  }
  function msg(who, text) {
    var log = document.getElementById('atk-log'); var d = document.createElement('div');
    d.className = 'atk-b ' + (who === 'me' ? 'me' : 'it'); d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  async function send() {
    var inp = document.getElementById('atk-in'); var m = inp.value.trim(); if (!m) return;
    msg('me', m); inp.value = '';
    try {
      var r = await fetch('/.netlify/functions/office-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
      var p = await r.json(); await run(p);
    } catch (_) { msg('it', '⚠ that did not go through — try again.'); }
  }
  async function searchJobs(q) {
    try {
      var r = await fetch(XANO + '/office_universal_search?q=' + encodeURIComponent(q), { cache: 'no-store' });
      var d = await r.json(); var rows = (d && d.items) || [];
      return rows.map(function (x) { return { job_id: x.job_id || x.id, name: ((x.customer_first || '') + ' ' + (x.customer_last || '')).trim() || 'Customer' }; }).filter(function (x) { return x.job_id; });
    } catch (_) { return []; }
  }
  async function run(p) {
    msg('it', p.reply || '');
    if (!p.intent || p.intent === 'none') return;
    var jobId = null, label = ''; var ref = (p.job_ref || '').trim();
    if (/^\d+$/.test(ref)) { jobId = parseInt(ref, 10); label = '#' + ref; }
    else if (ref) {
      var res = await searchJobs(ref);
      if (!res.length) { msg('it', 'I could not find a job for "' + ref + '".'); return; }
      if (res.length > 1) { msg('it', 'Which one? ' + res.slice(0, 5).map(function (r) { return '#' + r.job_id + ' ' + r.name; }).join('  ·  ')); return; }
      jobId = res[0].job_id; label = res[0].name || ('#' + jobId);
    } else { msg('it', 'Which job?'); return; }

    if (p.intent === 'search') { msg('it', 'Opening ' + label + '…'); location.href = 'job-detail.html?job_id=' + jobId + '&office=1'; return; }
    if (p.intent === 'assign') {
      var tid = TECH_ID_BY_NAME[(p.target || '').toLowerCase()];
      if (!tid) { msg('it', 'Which tech?'); return; }
      var d = await postJSON('reassign_job', { job_id: jobId, technician_id: tid });
      msg('it', (d && d.success) ? ('✅ ' + label + ' assigned to ' + cap(p.target) + '.') : '⚠ that did not go through.'); reload(); return;
    }
    if (p.intent === 'schedule') {
      var d2 = await postJSON('enqueue_scheduling_queue_propose', { job_id: jobId, source: 'office_ant_voice' });
      msg('it', (d2 && d2.success) ? ('✅ ' + label + ' queued to auto-schedule — slot options are on the way.') : '⚠ that did not go through.'); reload(); return;
    }
    if (p.intent === 'parts_arrived') {
      var d3 = await postJSON('mark_parts_arrived', { job_id: jobId, source: 'office_ant', notes: 'marked in via Ant' });
      msg('it', (d3 && d3.success) ? ('✅ Parts marked in for ' + label + '.') : '⚠ that did not go through.'); reload(); return;
    }
    if (p.intent === 'delete') {
      if (!confirm('Delete ' + label + ' off the list? Use for junk / canceled-email jobs. Nobody gets texted.')) { msg('it', 'Okay, left it.'); return; }
      var dd = await postJSON('office_remove_job', { job_id: jobId, action: 'delete', actor: 'Office (Ant)' });
      msg('it', (dd && dd.success) ? ('🗑 Deleted ' + label + ' off the list.') : '⚠ that did not go through.'); reload(); return;
    }
    if (p.intent === 'move') {
      var sm = { waiting_parts: 'awaiting_parts', completed: 'completed', needs_scheduled: 'not_ready' }; var st = sm[p.target];
      if (!st) { msg('it', 'Where should it go?'); return; }
      var d4 = await postJSON('office_set_job_status', { job_id: jobId, scheduling_status: st, actor: 'Office (Ant)' });
      msg('it', (d4 && d4.success) ? ('✅ ' + label + ' → ' + (FOLDER[p.target] || p.target) + '.') : '⚠ that did not go through.'); reload(); return;
    }
    // labor/invoice etc. live on the board's worksheet — point there.
    if (p.intent === 'labor' || p.intent === 'invoice') { msg('it', 'Open ' + label + ' on the board to log the invoice — say "open ' + (label) + '".'); return; }
  }
  function voice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { msg('it', 'Voice is not supported on this browser — just type it.'); return; }
    var rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
    var mic = document.getElementById('atk-mic'); mic.classList.add('live');
    rec.onresult = function (e) { document.getElementById('atk-in').value = e.results[0][0].transcript; mic.classList.remove('live'); send(); };
    rec.onerror = function () { mic.classList.remove('live'); };
    rec.onend = function () { mic.classList.remove('live'); };
    rec.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
})();
