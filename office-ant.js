// Floating "Ask Ant" widget for every office page. Self-injecting.
// Sits as a circular button in the bottom-right corner; tap to open
// a chat panel that talks to the office-ant-brain Netlify function
// (Claude with read tools across the whole business).
//
// Conversation history is kept in memory per page session — refresh
// clears it. The brain handles all the smart stuff; this is just the
// surface.
(function () {
  'use strict';
  if (window.__officeAntInjected) return;
  window.__officeAntInjected = true;

  const BRAIN_URL = '/.netlify/functions/office-ant-brain';
  const STORAGE_KEY = 'office_ant_chat_history';
  const MAX_HISTORY_TURNS = 12;

  let history = [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) history = JSON.parse(raw) || [];
  } catch (_) {}

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS))); } catch (_) {}
  }

  // ── Inject the floating button + panel ───────────────────────────
  function injectUI() {
    if (document.getElementById('oa-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'oa-fab';
    fab.title = 'Ask Ant';
    fab.innerHTML = '🐜';
    fab.style.cssText = `
      position: fixed; bottom: 22px; right: 22px;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #4a9eff, #2470c8);
      color: white; border: 0; font-size: 28px;
      box-shadow: 0 6px 20px rgba(36,112,200,0.5);
      cursor: pointer; z-index: 9500;
      transition: transform 0.15s ease;
    `;
    fab.onmouseenter = () => { fab.style.transform = 'scale(1.08)'; };
    fab.onmouseleave = () => { fab.style.transform = 'scale(1)'; };
    fab.onclick = togglePanel;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'oa-panel';
    panel.style.cssText = `
      position: fixed; bottom: 90px; right: 22px;
      width: 420px; max-width: calc(100vw - 30px);
      max-height: 70vh;
      background: #fff; border: 1px solid #d8e0ee;
      border-radius: 14px; box-shadow: 0 12px 40px rgba(36,40,60,0.25);
      display: none; flex-direction: column;
      z-index: 9500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    `;
    panel.innerHTML = `
      <div style="background:linear-gradient(135deg,#4a9eff,#2470c8);color:white;padding:12px 16px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">🐜</span>
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:700;">Ask Ant</div>
          <div style="font-size:11px;opacity:0.85;">office assistant · live data access</div>
        </div>
        <button id="oa-clear" title="Clear conversation" style="background:rgba(255,255,255,0.2);color:white;border:0;padding:4px 9px;border-radius:6px;font-size:11px;cursor:pointer;">Clear</button>
        <button id="oa-close" style="background:transparent;color:white;border:0;font-size:20px;cursor:pointer;padding:0 4px;">×</button>
      </div>
      <div id="oa-msgs" style="flex:1;overflow-y:auto;padding:14px;background:#f6f8fc;font-size:14px;line-height:1.5;"></div>
      <div style="padding:10px 12px;border-top:1px solid #d8e0ee;background:white;">
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <textarea id="oa-input" placeholder="What needs attention? Who's overloaded? Look up customer..." rows="1" style="flex:1;border:1px solid #c8d0e0;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;resize:none;max-height:120px;outline:none;"></textarea>
          <button id="oa-send" style="background:#4a9eff;color:white;border:0;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;">Send</button>
        </div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="oa-quick" data-q="What needs my attention right now?">📋 Needs attention</button>
          <button class="oa-quick" data-q="Who has capacity this week?">📅 Tech capacity</button>
          <button class="oa-quick" data-q="What's in the Needs Scheduled queue?">⏳ Queue</button>
          <button class="oa-quick" data-q="What just happened in the system?">🔄 Pulse</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('oa-close').onclick = togglePanel;
    document.getElementById('oa-clear').onclick = () => { history = []; saveHistory(); renderMessages(); };
    document.getElementById('oa-send').onclick = sendMessage;
    document.getElementById('oa-input').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };
    document.getElementById('oa-input').oninput = (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
    };
    document.querySelectorAll('.oa-quick').forEach((btn) => {
      btn.style.cssText = 'background:#eef3fb;color:#2470c8;border:1px solid #c8d8ef;padding:5px 9px;border-radius:14px;font-size:11px;cursor:pointer;font-family:inherit;';
      btn.onclick = () => {
        document.getElementById('oa-input').value = btn.dataset.q;
        sendMessage();
      };
    });
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
      wrap.innerHTML = `
        <div style="text-align:center;color:#6b7385;padding:20px 0;">
          <div style="font-size:32px;margin-bottom:6px;">🐜</div>
          <div style="font-weight:600;color:#2c3140;">Ask anything about the business.</div>
          <div style="font-size:12px;margin-top:6px;line-height:1.5;">Tap a chip below or type a question. I can pull jobs, customer history, calendar, tech metrics, common failures, pulse events.</div>
        </div>
      `;
      return;
    }
    wrap.innerHTML = history.map((turn) => {
      if (turn.role === 'user') {
        return `<div style="margin-bottom:12px;display:flex;justify-content:flex-end;"><div style="background:#4a9eff;color:white;padding:9px 13px;border-radius:14px 14px 4px 14px;max-width:80%;white-space:pre-wrap;">${escapeHtml(turn.content)}</div></div>`;
      }
      const toolLine = turn.tool_calls && turn.tool_calls.length
        ? `<div style="font-size:10px;color:#8a93aa;margin-top:6px;font-family:ui-monospace,Menlo,monospace;">↳ ${turn.tool_calls.map((t) => t.name).join(' · ')}</div>`
        : '';
      return `<div style="margin-bottom:12px;"><div style="background:white;border:1px solid #d8e0ee;color:#1f2533;padding:10px 13px;border-radius:14px 14px 14px 4px;max-width:90%;white-space:pre-wrap;">${escapeHtml(turn.content)}</div>${toolLine}</div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById('oa-input');
    const sendBtn = document.getElementById('oa-send');
    if (!input || !sendBtn) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    history.push({ role: 'user', content: text });
    renderMessages();
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    // Show thinking indicator
    const wrap = document.getElementById('oa-msgs');
    const thinking = document.createElement('div');
    thinking.id = 'oa-thinking';
    thinking.style.cssText = 'margin-bottom:12px;color:#8a93aa;font-size:13px;font-style:italic;';
    thinking.textContent = '🐜 thinking...';
    wrap.appendChild(thinking);
    wrap.scrollTop = wrap.scrollHeight;

    try {
      const res = await fetch(BRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_role: 'owner',
          message: text,
          // Send only the user/assistant content turns (not tool stuff)
          history: history.slice(0, -1).filter((t) => t.role === 'user' || t.role === 'assistant').map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json();
      thinking.remove();
      if (!data.ok || !data.reply) {
        history.push({
          role: 'assistant',
          content: data.error ? `Error: ${data.error}` : 'No reply — something went wrong upstream.',
          tool_calls: data.tool_calls || [],
        });
      } else {
        history.push({
          role: 'assistant',
          content: data.reply,
          tool_calls: data.tool_calls || [],
        });
      }
      saveHistory();
      renderMessages();
    } catch (err) {
      thinking.remove();
      history.push({ role: 'assistant', content: `Network error: ${err.message || err}` });
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
