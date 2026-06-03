// Office-side "Ask Ant" floating chat widget. Self-injects on every
// office page (paired with office-nav.js + office-search.js as the
// universal office toolbelt). One tap on the floating button opens a
// chat panel pre-loaded with the current page's context (job_id /
// customer_id / tech_id from URL params) so Danielle/Teddy don't have
// to re-explain what they're looking at.
//
// Quick-action buttons in the chat panel are PAGE-AWARE — different
// pages get different one-tap entry points (strengthen this TDR, draft
// a reply, find a reschedule slot, etc.). Drives adoption by removing
// the "what do I even ask?" friction.
//
// Single <script src="/office-ask.js"></script> per page (or loaded via
// office-nav.js sentinel for zero-config injection).
(function () {
  'use strict';
  if (window.__officeAskInjected) return;
  window.__officeAskInjected = true;

  const BRAIN_URL = '/.netlify/functions/office-ant-brain';
  const SS_KEY = 'office_ant_history';
  const MAX_HISTORY_TURNS = 16;

  // ──────────────────────────────────────────────────────────
  // Page context — pull job_id / customer_id / tech_id from URL
  // so Ant knows what we're looking at without us spelling it out.
  // ──────────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const JOB_ID = parseInt(params.get('job_id') || '0', 10);
  const CUSTOMER_ID = parseInt(params.get('customer_id') || params.get('cust_id') || '0', 10);
  const TECH_ID = parseInt(params.get('tech_id') || '0', 10);
  const PATH = (window.location.pathname || '').toLowerCase();

  // Page-aware quick actions. Each button pre-fills a message and sends.
  function quickActionsForPage() {
    if (PATH.includes('warranty-review')) {
      return [
        { label: '📦 Strengthen this TDR', q: JOB_ID ? `Help me strengthen the TDR on job ${JOB_ID} for warranty submission — identify what's weak or missing.` : 'Walk me through the warranty queue today — what needs the most attention?' },
        { label: '✍️ Draft AHS submission', q: JOB_ID ? `Draft the AHS warranty submission package for job ${JOB_ID} — paste-ready format.` : 'Draft a warranty submission template.' },
        { label: '🚫 Last AHS denials pattern', q: 'Show me the last 5-10 AHS denials and what the rejected fields were — what pattern do you see?' },
        { label: '⬆️ Appeal a denial', q: JOB_ID ? `Help me build an appeal for the denied claim on job ${JOB_ID}.` : 'Walk me through writing a warranty denial appeal.' },
      ];
    }
    if (PATH.includes('job-detail')) {
      return [
        { label: '✍️ Draft customer reply', q: JOB_ID ? `On job ${JOB_ID}, draft a warm reply to the customer's most recent message.` : 'Draft a reply template.' },
        { label: '🗓 Find a reschedule slot', q: JOB_ID ? `On job ${JOB_ID}, find the soonest reschedule slot that fits the assigned tech's day and the customer's likely availability.` : 'Find a reschedule slot.' },
        { label: '🛠 Strengthen this TDR', q: JOB_ID ? `On job ${JOB_ID}, the TDR is thin — help me strengthen it based on what we have.` : 'Help me strengthen a thin TDR.' },
        { label: '📋 Pull customer history', q: JOB_ID ? `Show me this customer's full history — past visits, recurring issues, anything I should know before contacting them.` : 'Pull a customer history.' },
      ];
    }
    if (PATH.includes('teddy-tdr-tool')) {
      return [
        { label: '✍️ Draft the diagnosis paragraph', q: JOB_ID ? `Help me write the diagnosis field on job ${JOB_ID} based on what's been captured. Make it warranty-submission ready.` : 'Draft a diagnosis paragraph.' },
        { label: '🔍 Identify the failure', q: JOB_ID ? `Looking at job ${JOB_ID} — pull common failures for this brand+model+symptom and tell me what we're likely looking at.` : 'Pull common failures for a model.' },
        { label: '📋 Pull TDR history on this model', q: JOB_ID ? `Show me all prior TDRs on this exact model from our shop — what did we replace, how long did it take?` : 'Pull TDR history on a model.' },
      ];
    }
    if (PATH.includes('office-today') || PATH.includes('office-todo')) {
      return [
        { label: '🎯 What needs me first?', q: 'Walk me through what needs human action today, in priority order. Lead with the most urgent.' },
        { label: '⏱ Stuck jobs summary', q: 'Summarize the jobs that haven\'t moved in the last 3 days — for each, what\'s blocking it?' },
        { label: '📊 How was yesterday?', q: 'Yesterday\'s recap — completions, cancellations, callbacks, anything unusual.' },
      ];
    }
    if (PATH.includes('needs-scheduled') || PATH.includes('office-calendar')) {
      return [
        { label: '🗓 Best tech for next stuck job', q: 'For the next job in the unscheduled queue, recommend the best tech + slot based on geography, parts readiness, and tech availability.' },
        { label: '⚖️ Who\'s overloaded?', q: 'Tell me which techs are overloaded this week and which have room — by day and total.' },
        { label: '🔍 Find ASAP slot', q: 'Find the soonest possible slot across the whole fleet that fits a flexible customer.' },
      ];
    }
    if (PATH.includes('customer-search') || PATH.includes('customer-feedback')) {
      return [
        { label: '🧠 Pattern across recent feedback', q: 'Look at the last 20 customer feedback entries — what patterns emerge? Anything we should address?' },
        { label: '📞 Pull a customer', q: 'Help me find a customer by phone or name — give me their full history when I tell you who.' },
      ];
    }
    // Default fallback set
    return [
      { label: '🎯 What needs me?', q: 'Walk me through what needs human action right now, priority order.' },
      { label: '📊 Today\'s pulse', q: 'How are we doing today? Completions, cancellations, anything stuck.' },
      { label: '🔍 Help me find', q: 'Help me find a job or customer.' },
    ];
  }

  // ──────────────────────────────────────────────────────────
  // History (sessionStorage)
  // ──────────────────────────────────────────────────────────
  let history = [];
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) history = JSON.parse(raw) || [];
  } catch (_) {}
  function saveHistory() {
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS))); } catch (_) {}
  }

  function injectUI() {
    if (document.getElementById('oa-fab')) return;

    // Floating action button
    const fab = document.createElement('button');
    fab.id = 'oa-fab';
    fab.title = 'Ask Ant';
    fab.innerHTML = '<span style="font-size:22px;">💬</span><span style="margin-left:6px;font-size:13px;font-weight:700;">Ask Ant</span>';
    fab.style.cssText = `
      position: fixed; bottom: 18px; right: 18px;
      background: linear-gradient(135deg,#5aa9ff,#1d6fff);
      color: #fff; border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 8px 24px rgba(29,111,255,0.4);
      cursor: pointer;
      display: flex; align-items: center;
      z-index: 9400;
      transition: transform 0.12s;
    `;
    fab.onmouseenter = () => { fab.style.transform = 'translateY(-2px)'; };
    fab.onmouseleave = () => { fab.style.transform = ''; };
    fab.onclick = togglePanel;
    document.body.appendChild(fab);

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'oa-panel';
    panel.style.cssText = `
      position: fixed; bottom: 80px; right: 18px;
      width: 420px; max-width: calc(100vw - 30px);
      max-height: 72vh;
      background: #131720; color: #e6edf5;
      border: 1px solid #2a3040;
      border-radius: 16px;
      box-shadow: 0 14px 44px rgba(0,0,0,0.6);
      display: none; flex-direction: column;
      z-index: 9500;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    `;
    const ctxLine = JOB_ID ? `Job #${JOB_ID}` : (CUSTOMER_ID ? `Customer #${CUSTOMER_ID}` : (TECH_ID ? `Tech #${TECH_ID}` : 'No specific context'));
    panel.innerHTML = `
      <div style="background:linear-gradient(135deg,#1d6fff,#5aa9ff);color:white;padding:14px 18px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">💬</span>
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:700;">Ask Ant — Office</div>
          <div style="font-size:11px;opacity:0.92;">${ctxLine}</div>
        </div>
        <button id="oa-close" style="background:transparent;color:white;border:0;font-size:22px;cursor:pointer;padding:0 4px;">×</button>
      </div>
      <div id="oa-msgs" style="flex:1;overflow-y:auto;padding:14px;background:#0f131c;font-size:14px;line-height:1.55;color:#e6edf5;"></div>
      <div style="padding:10px 12px;border-top:1px solid #2a3040;background:#131720;">
        <div id="oa-quick" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <textarea id="oa-input" placeholder="Ask anything — about a job, a customer, a TDR, or just think through a problem..." rows="1" style="flex:1;background:#1a1f2c;border:1px solid #2a3040;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;resize:none;max-height:120px;outline:none;color:#e6edf5;"></textarea>
          <button id="oa-send" style="background:#1d6fff;color:white;border:0;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('oa-close').onclick = togglePanel;
    document.getElementById('oa-send').onclick = sendMessage;
    document.getElementById('oa-input').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    document.getElementById('oa-input').oninput = (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
    };

    // Render page-aware quick actions
    const quickEl = document.getElementById('oa-quick');
    const actions = quickActionsForPage();
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.style.cssText = 'background:#1a1f2c;color:#cbd5e0;border:1px solid #2a3040;padding:6px 11px;border-radius:14px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600;white-space:nowrap;';
      btn.onmouseenter = () => { btn.style.background = '#1d3a6b'; btn.style.color = '#fff'; };
      btn.onmouseleave = () => { btn.style.background = '#1a1f2c'; btn.style.color = '#cbd5e0'; };
      btn.onclick = () => {
        document.getElementById('oa-input').value = a.q;
        sendMessage();
      };
      quickEl.appendChild(btn);
    }

    renderMessages();
  }

  function togglePanel() {
    const p = document.getElementById('oa-panel');
    if (!p) return;
    if (p.style.display === 'none' || !p.style.display) {
      p.style.display = 'flex';
      setTimeout(() => document.getElementById('oa-input').focus(), 50);
    } else {
      p.style.display = 'none';
    }
  }

  function renderMessages() {
    const wrap = document.getElementById('oa-msgs');
    if (!wrap) return;
    if (history.length === 0) {
      wrap.innerHTML = `<div style="text-align:center;color:#6a7589;padding:30px 12px;font-size:13px;line-height:1.6;">Ask anything about jobs, customers, TDRs, scheduling — or just think through a problem.<br><br>The buttons below are page-aware shortcuts. Tap one to start fast.</div>`;
      return;
    }
    wrap.innerHTML = history.map(t => {
      if (t.role === 'user') {
        return `<div style="margin:8px 0;text-align:right;"><div style="display:inline-block;background:#1d6fff;color:#fff;padding:8px 12px;border-radius:14px 14px 4px 14px;max-width:84%;font-size:13px;white-space:pre-wrap;text-align:left;">${escapeHtml(t.content)}</div></div>`;
      }
      return `<div style="margin:8px 0;"><div style="display:inline-block;background:#1a1f2c;color:#e6edf5;padding:8px 12px;border-radius:14px 14px 14px 4px;max-width:88%;font-size:13px;white-space:pre-wrap;border:1px solid #2a3040;">${escapeHtml(t.content)}</div></div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendMessage() {
    const inp = document.getElementById('oa-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    inp.style.height = 'auto';

    history.push({ role: 'user', content: text });
    saveHistory();
    renderMessages();

    const sendBtn = document.getElementById('oa-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    // Pre-pend page context so Ant knows the surface we're on without
    // re-asking. Ant's tools will fetch live data; this just orients.
    const ctxBits = [];
    if (JOB_ID) ctxBits.push(`current_job_id=${JOB_ID}`);
    if (CUSTOMER_ID) ctxBits.push(`current_customer_id=${CUSTOMER_ID}`);
    if (TECH_ID) ctxBits.push(`current_tech_id=${TECH_ID}`);
    ctxBits.push(`current_page=${PATH}`);
    const ctxNote = ctxBits.length > 0 ? `[page context: ${ctxBits.join(', ')}]\n` : '';

    const wrap = document.getElementById('oa-msgs');
    const thinking = document.createElement('div');
    thinking.style.cssText = 'margin:8px 0;color:#6a7589;font-size:12px;font-style:italic;padding:0 8px;';
    thinking.textContent = 'thinking...';
    wrap.appendChild(thinking);
    wrap.scrollTop = wrap.scrollHeight;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(BRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: ctxNote + text,
          history: history.slice(0, -1).filter((t) => t.role === 'user' || t.role === 'assistant').map((t) => ({ role: t.role, content: t.content })),
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      thinking.remove();
      if (data.ok && data.reply) {
        history.push({ role: 'assistant', content: data.reply });
      } else {
        history.push({ role: 'assistant', content: data.error ? `Brain error: ${data.error}` : "I didn't get a response — please try again." });
      }
      saveHistory();
      renderMessages();
    } catch (err) {
      clearTimeout(timer);
      thinking.remove();
      const msg = err && err.name === 'AbortError'
        ? "That took too long. Try a shorter question or break it into parts."
        : "Couldn't reach the brain. Check connection and try again.";
      history.push({ role: 'assistant', content: msg });
      saveHistory();
      renderMessages();
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Public API for programmatic open + prefill (used by per-page CTAs
  // like "Help me strengthen this TDR" embedded directly in card UIs).
  window.OfficeAsk = {
    open: function (prefill) {
      const p = document.getElementById('oa-panel');
      if (!p) return;
      if (p.style.display !== 'flex') p.style.display = 'flex';
      const inp = document.getElementById('oa-input');
      if (inp && prefill && !inp.value) inp.value = String(prefill);
      if (inp) setTimeout(() => inp.focus(), 50);
    },
    openAndSend: function (msg) {
      const p = document.getElementById('oa-panel');
      if (!p) return;
      if (p.style.display !== 'flex') p.style.display = 'flex';
      const inp = document.getElementById('oa-input');
      if (inp && msg) {
        inp.value = String(msg);
        setTimeout(() => document.getElementById('oa-send').click(), 100);
      }
    },
  };

  function inject() {
    if (!document.body) { return setTimeout(inject, 20); }
    injectUI();
  }
  inject();
})();
