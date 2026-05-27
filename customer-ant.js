// Customer-facing Ant widget. Lives on customer-portal.html only.
// Reads job_id + phone_last4 from URL params (already validated by the
// portal page itself before this script runs).
//
// Warmer styling than office-ant (white theme, friendlier colors,
// rounded edges). Conversational — answers customer questions about
// their repair using customer-ant-brain (read-only, customer-scoped).
(function () {
  'use strict';
  if (window.__customerAntInjected) return;
  window.__customerAntInjected = true;

  const BRAIN_URL = '/.netlify/functions/customer-ant-brain';
  const SS_KEY = 'customer_ant_history';
  const MAX_HISTORY_TURNS = 12;

  const params = new URLSearchParams(window.location.search);
  const JOB_ID = parseInt(params.get('job_id') || '0', 10);

  // Resolve LAST4 from URL OR from sessionStorage (set by customer-portal.html
  // after gate-passes). Widget waits for auth if not present yet.
  function getLast4() {
    const fromUrl = (params.get('last4') || params.get('phone_last4') || '').replace(/\D/g, '').slice(-4);
    if (fromUrl) return fromUrl;
    try {
      const raw = sessionStorage.getItem('customer_portal_auth');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.last4 && (!p.job_id || p.job_id === JOB_ID)) return String(p.last4).replace(/\D/g, '').slice(-4);
      }
    } catch (_) {}
    return '';
  }

  let LAST4 = getLast4();

  if (!JOB_ID) {
    // No job context at all — never inject (this isn't a portal page with a job).
    return;
  }

  // If not authed yet, poll every 1s for up to 5 min — auth typically happens
  // within seconds of page load when the user enters their last4.
  let authPollTries = 0;
  if (!LAST4) {
    const poll = setInterval(() => {
      LAST4 = getLast4();
      authPollTries++;
      if (LAST4) {
        clearInterval(poll);
        injectUI();
      } else if (authPollTries > 300) {
        clearInterval(poll);
      }
    }, 1000);
    return;
  }

  let history = [];
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) history = JSON.parse(raw) || [];
  } catch (_) {}
  function saveHistory() {
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS))); } catch (_) {}
  }

  function injectUI() {
    if (document.getElementById('ca-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'ca-fab';
    fab.title = 'Chat with Ant';
    fab.innerHTML = '<span style="font-size:24px;">💬</span>';
    fab.style.cssText = `
      position: fixed; bottom: 24px; right: 24px;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, #ff9f43, #e67e22);
      color: white; border: 0;
      box-shadow: 0 8px 24px rgba(230,126,34,0.4);
      cursor: pointer; z-index: 9500;
      transition: transform 0.15s ease;
      display: flex; align-items: center; justify-content: center;
    `;
    fab.onmouseenter = () => { fab.style.transform = 'scale(1.08)'; };
    fab.onmouseleave = () => { fab.style.transform = 'scale(1)'; };
    fab.onclick = togglePanel;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'ca-panel';
    panel.style.cssText = `
      position: fixed; bottom: 96px; right: 22px;
      width: 380px; max-width: calc(100vw - 30px);
      max-height: 70vh;
      background: #fff; border: 1px solid #f0d8b8;
      border-radius: 16px;
      box-shadow: 0 14px 44px rgba(60,40,20,0.22);
      display: none; flex-direction: column;
      z-index: 9500;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    `;
    panel.innerHTML = `
      <div style="background:linear-gradient(135deg,#ff9f43,#e67e22);color:white;padding:14px 18px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">🐜</span>
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:700;">Ask Ant</div>
          <div style="font-size:11px;opacity:0.92;">TN Appliance Exchange · your repair assistant</div>
        </div>
        <button id="ca-close" style="background:transparent;color:white;border:0;font-size:22px;cursor:pointer;padding:0 4px;">×</button>
      </div>
      <div id="ca-msgs" style="flex:1;overflow-y:auto;padding:14px;background:#fff8ef;font-size:14px;line-height:1.55;color:#3c2a18;"></div>
      <div style="padding:10px 12px;border-top:1px solid #f0d8b8;background:white;">
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <textarea id="ca-input" placeholder="Ask about your appointment..." rows="1" style="flex:1;border:1px solid #e8d4b0;border-radius:12px;padding:11px 14px;font-size:14px;font-family:inherit;resize:none;max-height:120px;outline:none;color:#3c2a18;"></textarea>
          <button id="ca-send" style="background:#e67e22;color:white;border:0;border-radius:12px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;">Send</button>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="ca-quick" data-q="When is my appointment?">📅 When is it?</button>
          <button class="ca-quick" data-q="Who is my technician?">🛠 Who's coming?</button>
          <button class="ca-quick" data-q="What's wrong with my appliance?">🔍 What's wrong?</button>
          <button class="ca-quick" data-q="Have you been here for this before?">📋 Past visits</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('ca-close').onclick = togglePanel;
    document.getElementById('ca-send').onclick = sendMessage;
    document.getElementById('ca-input').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    document.getElementById('ca-input').oninput = (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
    };
    document.querySelectorAll('.ca-quick').forEach((btn) => {
      btn.style.cssText = 'background:#fff;color:#b04a0a;border:1px solid #f0c896;padding:6px 11px;border-radius:14px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600;';
      btn.onclick = () => {
        document.getElementById('ca-input').value = btn.dataset.q;
        sendMessage();
      };
    });

    renderMessages();
  }

  function togglePanel() {
    const p = document.getElementById('ca-panel');
    if (!p) return;
    if (p.style.display === 'none' || !p.style.display) {
      p.style.display = 'flex';
      setTimeout(() => document.getElementById('ca-input').focus(), 50);
    } else {
      p.style.display = 'none';
    }
  }

  function renderMessages() {
    const wrap = document.getElementById('ca-msgs');
    if (!wrap) return;
    if (history.length === 0) {
      wrap.innerHTML = `
        <div style="text-align:center;color:#8a6a4a;padding:24px 12px;">
          <div style="font-size:34px;margin-bottom:8px;">🐜</div>
          <div style="font-weight:600;color:#5a3a1a;font-size:15px;">Hi! I'm Ant, your repair assistant.</div>
          <div style="font-size:13px;margin-top:8px;line-height:1.5;">Ask me anything about your appointment, your tech, or what we're fixing. Tap a question below or type your own.</div>
        </div>
      `;
      return;
    }
    wrap.innerHTML = history.map((turn) => {
      if (turn.role === 'user') {
        return `<div style="margin-bottom:12px;display:flex;justify-content:flex-end;"><div style="background:#e67e22;color:white;padding:9px 14px;border-radius:16px 16px 4px 16px;max-width:82%;white-space:pre-wrap;">${escapeHtml(turn.content)}</div></div>`;
      }
      return `<div style="margin-bottom:12px;"><div style="background:white;border:1px solid #f0d8b8;color:#3c2a18;padding:11px 14px;border-radius:16px 16px 16px 4px;max-width:92%;white-space:pre-wrap;line-height:1.5;">${escapeHtml(turn.content)}</div></div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById('ca-input');
    const sendBtn = document.getElementById('ca-send');
    if (!input || !sendBtn) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    history.push({ role: 'user', content: text });
    renderMessages();
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    const wrap = document.getElementById('ca-msgs');
    const thinking = document.createElement('div');
    thinking.style.cssText = 'margin-bottom:12px;color:#8a6a4a;font-size:13px;font-style:italic;padding:0 8px;';
    thinking.textContent = '🐜 looking that up...';
    wrap.appendChild(thinking);
    wrap.scrollTop = wrap.scrollHeight;

    try {
      const res = await fetch(BRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: JOB_ID,
          phone_last4: LAST4,
          message: text,
          history: history.slice(0, -1).filter((t) => t.role === 'user' || t.role === 'assistant').map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json();
      thinking.remove();
      if (!data.ok || !data.reply) {
        history.push({ role: 'assistant', content: data.error ? "Sorry — having trouble right now. Please call our office at 615-280-2949 and we'll help right away." : "I didn't get an answer back. Please try again or call 615-280-2949." });
      } else {
        history.push({ role: 'assistant', content: data.reply });
      }
      saveHistory();
      renderMessages();
    } catch (err) {
      thinking.remove();
      history.push({ role: 'assistant', content: "Sorry — couldn't reach our system. Please call 615-280-2949 and we'll take care of you." });
      saveHistory();
      renderMessages();
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      input.focus();
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  if (document.body) injectUI();
  else document.addEventListener('DOMContentLoaded', injectUI);
})();
