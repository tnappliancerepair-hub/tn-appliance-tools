// contact-widget — a self-contained "Questions?" launcher for the AssistAnt marketing pages
// (home / signup / system). Floating bottom-right button opens a small panel with BOTH ways to
// reach us: a "Message us" form (name + phone/email + note → POSTs to /platform-contact, which
// captures it + texts/emails Teddy) AND a one-tap "Text us" button to the office human line.
// No dependencies, CSP-safe (same-origin script, injected <style>), works on any page ground.
(function () {
  'use strict';
  if (window.__antContactMounted) return; window.__antContactMounted = true;

  // The office HUMAN line — a real person reads it, no AI auto-reply. NEVER Teddy's cell.
  var TEXT_NUMBER = '+16158578800';
  var TEXT_BODY = 'AssistAnt question: ';

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }

  function mount() {
    try {
      var style = el('style', null,
        '.antc-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#f6b73c;color:#14100b;' +
        'border:none;border-radius:999px;padding:12px 18px;font:600 15px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
        'box-shadow:0 6px 22px rgba(0,0,0,.35);cursor:pointer}' +
        '.antc-btn:hover{filter:brightness(1.05)}' +
        '.antc-panel{position:fixed;right:16px;bottom:74px;z-index:2147483000;width:min(360px,calc(100vw - 32px));' +
        'background:#14100b;color:#f3ede0;border:1px solid #3a3324;border-radius:16px;padding:18px 18px 16px;' +
        'box-shadow:0 18px 60px rgba(0,0,0,.5);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:none}' +
        '.antc-panel.open{display:block}' +
        '.antc-h{font-weight:700;font-size:16px;margin:0 0 2px}' +
        '.antc-sub{color:#b8ad97;font-size:12.5px;margin:0 0 12px}' +
        '.antc-panel input,.antc-panel textarea{width:100%;box-sizing:border-box;background:#221c12;color:#f3ede0;' +
        'border:1px solid #3a3324;border-radius:10px;padding:10px 11px;font-size:15px;margin:0 0 8px;font-family:inherit}' +
        '.antc-panel textarea{min-height:74px;resize:vertical}' +
        '.antc-panel input:focus,.antc-panel textarea:focus{outline:2px solid #f6b73c;border-color:#f6b73c}' +
        '.antc-send{width:100%;background:#f6b73c;color:#14100b;border:none;border-radius:10px;padding:11px;' +
        'font-weight:700;font-size:15px;cursor:pointer}.antc-send:hover{filter:brightness(1.05)}.antc-send:disabled{opacity:.6;cursor:default}' +
        '.antc-or{display:flex;align-items:center;gap:10px;color:#8f866f;font-size:12px;margin:12px 0}' +
        '.antc-or::before,.antc-or::after{content:"";flex:1;height:1px;background:#3a3324}' +
        '.antc-text{display:block;text-align:center;background:transparent;color:#f6b73c;border:1px solid #4a4230;' +
        'border-radius:10px;padding:10px;font-weight:600;text-decoration:none;font-size:14.5px}' +
        '.antc-text:hover{background:#221c12}' +
        '.antc-x{position:absolute;top:10px;right:12px;background:transparent;border:none;color:#8f866f;font-size:20px;cursor:pointer;line-height:1}' +
        '.antc-msg{font-size:13px;margin:6px 0 0;min-height:16px}.antc-msg.ok{color:#7bd88f}.antc-msg.err{color:#f0a5a5}' +
        '.antc-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}');
      document.head.appendChild(style);

      var btn = el('button', { class: 'antc-btn', type: 'button', 'aria-label': 'Questions about AssistAnt' }, '💬 Questions?');
      var panel = el('div', { class: 'antc-panel', role: 'dialog', 'aria-label': 'Message us about AssistAnt' });
      panel.appendChild(el('button', { class: 'antc-x', type: 'button', 'aria-label': 'Close' }, '×'));
      panel.appendChild(el('p', { class: 'antc-h' }, 'Ask us anything'));
      panel.appendChild(el('p', { class: 'antc-sub' }, 'Questions about pricing, setup, or bringing your data over? We’ll get right back to you.'));

      var form = el('form', { class: 'antc-form', novalidate: 'novalidate' });
      form.innerHTML =
        '<input class="antc-hp" type="text" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<input name="name" type="text" placeholder="Your name" autocomplete="name">' +
        '<input name="phone" type="tel" placeholder="Phone" autocomplete="tel">' +
        '<input name="email" type="email" placeholder="Email (optional)" autocomplete="email">' +
        '<textarea name="message" placeholder="What can we help with?"></textarea>' +
        '<button class="antc-send" type="submit">Send</button>' +
        '<p class="antc-msg" role="status"></p>';
      panel.appendChild(form);

      panel.appendChild(el('div', { class: 'antc-or' }, 'or'));
      panel.appendChild(el('a', { class: 'antc-text', href: 'sms:' + TEXT_NUMBER + '?&body=' + encodeURIComponent(TEXT_BODY) }, '📱 Text us instead'));

      document.body.appendChild(btn);
      document.body.appendChild(panel);

      function toggle(open) { panel.classList.toggle('open', open == null ? !panel.classList.contains('open') : open); }
      btn.addEventListener('click', function () { toggle(); });
      panel.querySelector('.antc-x').addEventListener('click', function () { toggle(false); });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var msgEl = form.querySelector('.antc-msg');
        var send = form.querySelector('.antc-send');
        var data = {
          company_website: form.company_website.value,
          name: form.name.value.trim(),
          phone: form.phone.value.trim(),
          email: form.email.value.trim(),
          message: form.message.value.trim(),
          source: (location.pathname || 'site').replace(/^\/+|\.html$/g, '') || 'home',
        };
        msgEl.className = 'antc-msg';
        if (!data.message) { msgEl.className = 'antc-msg err'; msgEl.textContent = 'Add a quick note so we know how to help.'; return; }
        if (!data.phone && !data.email) { msgEl.className = 'antc-msg err'; msgEl.textContent = 'Add a phone or email so we can reach you.'; return; }
        send.disabled = true; send.textContent = 'Sending…';
        fetch('/.netlify/functions/platform-contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) {
              form.innerHTML = '<p class="antc-msg ok" style="font-size:15px">✅ ' + (d.message || 'Got it — we’ll be in touch shortly.') + '</p>';
            } else {
              msgEl.className = 'antc-msg err'; msgEl.textContent = (d && d.message) || 'Something went wrong — please text us instead.';
              send.disabled = false; send.textContent = 'Send';
            }
          })
          .catch(function () {
            msgEl.className = 'antc-msg err'; msgEl.textContent = 'Couldn’t send — please text us instead.';
            send.disabled = false; send.textContent = 'Send';
          });
      });
    } catch (_) { /* a widget failure must never break the page */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
