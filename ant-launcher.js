// ant-launcher — drop-in sticky CTA that funnels EVERY page into the contextual
// Appliance AI ($50 Quick Check). One tag per page:
//   <script>window.ANT_CTX={appliance:'refrigerator',brand:'Samsung',town:'Hammond'};</script>
//   <script src="/ant-launcher.js" defer></script>
// It reads ANT_CTX (any subset), builds /appliance-ai.html?appliance=&brand=&town=,
// and shows a bright always-visible bar: "What's wrong with your Samsung refrigerator?"
(function () {
  'use strict';
  var ctx = (window.ANT_CTX || {});
  var qs = [];
  if (ctx.appliance) qs.push('appliance=' + encodeURIComponent(ctx.appliance));
  if (ctx.brand) qs.push('brand=' + encodeURIComponent(ctx.brand));
  if (ctx.town) qs.push('town=' + encodeURIComponent(ctx.town));
  var href = '/appliance-ai.html' + (qs.length ? ('?' + qs.join('&')) : '');
  var machine = ((ctx.brand ? ctx.brand + ' ' : '') + (ctx.appliance || '')).trim();
  var label = machine ? ('What’s wrong with your ' + machine + '?') : 'What’s wrong with your appliance?';

  var css = ''
    + '#ant-launcher{position:fixed;left:0;right:0;bottom:0;z-index:99995;display:flex;align-items:center;gap:12px;'
    + 'padding:12px 16px;padding-bottom:max(12px,env(safe-area-inset-bottom));text-decoration:none;'
    + 'background:#0a0a0a;border-top:1px solid #ff6200;box-shadow:0 -8px 30px rgba(0,0,0,.5);'
    + "font-family:'Geist Mono',ui-monospace,monospace;cursor:pointer;}"
    + '#ant-launcher .al-ant{font-size:26px;animation:alpulse 2.6s ease-in-out infinite;flex-shrink:0;}'
    + '@keyframes alpulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 rgba(255,98,0,0));}50%{transform:scale(1.12);filter:drop-shadow(0 0 8px rgba(255,98,0,.7));}}'
    + '#ant-launcher .al-txt{display:flex;flex-direction:column;line-height:1.25;flex:1;min-width:0;}'
    + '#ant-launcher .al-txt b{color:#f0f0f0;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '#ant-launcher .al-sub{color:#ff6200;font-size:11px;letter-spacing:.04em;}'
    + '#ant-launcher .al-go{flex-shrink:0;background:#ff6200;color:#000;font-weight:700;border-radius:9px;padding:10px 16px;font-size:14px;}'
    + 'body{padding-bottom:78px !important;}'
    + '@media(min-width:640px){#ant-launcher{justify-content:center;} #ant-launcher .al-txt{flex:0 1 auto;}}';
  var st = document.createElement('style'); st.id = 'ant-launcher-style'; st.textContent = css; document.head.appendChild(st);

  var a = document.createElement('a');
  a.id = 'ant-launcher'; a.href = href;
  a.setAttribute('aria-label', 'Talk to the Appliance AI — $50 Quick Check');
  a.innerHTML = '<span class="al-ant">🐜</span>'
    + '<span class="al-txt"><b>' + label + '</b><span class="al-sub">Talk to the Appliance AI · $50 Quick Check</span></span>'
    + '<span class="al-go">Start →</span>';
  function mount(){ if(!document.getElementById('ant-launcher')) document.body.appendChild(a); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
