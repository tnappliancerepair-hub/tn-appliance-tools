/* ant-part-finder.js — customer "find my part" funnel. NO SKU EVER SHOWN.
 * Mounts into <div id="ant-part-finder" data-appliance="dryer" [data-problem="Not heating"]></div>.
 * Enter model + what's broken -> "we identify + ship the exact part (OEM or budget),
 * install or DIY" -> Quick Check CTA carrying the context. Preserves the no-share-SKU moat. */
(function () {
  'use strict';
  var PROB = {
    dryer: ['Not heating', "Won't start", 'Not spinning', 'Takes too long', 'Making noise', 'Other'],
    washer: ['Not draining', 'Not spinning', 'Leaking', "Won't start", 'Making noise', 'Other'],
    refrigerator: ['Not cooling', 'Ice maker out', 'Leaking water', 'Freezing food', 'Making noise', 'Other'],
    dishwasher: ['Not draining', 'Not cleaning', 'Leaking', "Won't start", 'Other'],
    oven: ['Not heating', "Won't reach temp", 'Burner out', "Won't light (gas)", 'Other'],
    microwave: ['Not heating', 'Other'],
    disposal: ['Jammed / not working', 'Leaking', 'Other']
  };
  var NAME = { dryer: 'dryer', washer: 'washer', refrigerator: 'refrigerator', dishwasher: 'dishwasher', oven: 'oven or range', microwave: 'microwave', disposal: 'garbage disposal' };
  var APPLS = ['dryer', 'washer', 'refrigerator', 'dishwasher', 'oven', 'microwave', 'disposal'];

  function css() {
    if (document.getElementById('apf-css')) return;
    var s = document.createElement('style'); s.id = 'apf-css';
    s.textContent = [
      '.apf-card{margin-top:18px;border:1px solid var(--bord2,#252525);border-radius:14px;background:var(--surface,#0c0c0c);padding:22px}',
      '.apf-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.apf-in,.apf-sel{flex:1;min-width:170px;background:var(--surf2,#111);color:var(--white,#f0f0f0);border:1px solid var(--bord2,#252525);border-radius:9px;padding:13px 14px;font-family:inherit;font-size:15px;-webkit-appearance:none;appearance:none}',
      '.apf-go{background:var(--orange,#ff6200);color:#000;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;border:none;border-radius:9px;padding:13px 18px;cursor:pointer}',
      '.apf-go:hover{filter:brightness(1.08)}',
      '.apf-out{margin-top:6px}',
      '.apf-res{border:1px solid rgba(57,255,20,.25);background:rgba(57,255,20,.05);border-radius:11px;padding:16px;font-size:13.5px;color:var(--white,#f0f0f0);line-height:1.7}',
      '.apf-res b{color:var(--green,#39ff14)}',
      '.apf-opts{font-size:12.5px;color:var(--gray,#888);margin-top:10px;line-height:1.7}',
      '.apf-cta{display:inline-flex;align-items:center;gap:8px;margin-top:14px;background:var(--orange,#ff6200);color:#000;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:13px 20px;border-radius:10px;text-decoration:none}',
      '.apf-cta:hover{filter:brightness(1.08)}',
      '.apf-fine{font-size:11.5px;color:var(--gray,#666);margin-top:10px;line-height:1.6}'
    ].join('');
    document.head.appendChild(s);
  }

  function mount(el) {
    css();
    var appl = (el.getAttribute('data-appliance') || 'all').toLowerCase();
    var preProb = el.getAttribute('data-problem') || '';
    var applSel = '';
    if (appl === 'all' || !PROB[appl]) {
      applSel = '<select class="apf-sel apf-appl">' + APPLS.map(function (a) { return '<option value="' + a + '">' + (NAME[a].charAt(0).toUpperCase() + NAME[a].slice(1)) + '</option>'; }).join('') + '</select>';
      appl = 'dryer';
    }
    function probOpts(a) { return (PROB[a] || PROB.dryer).map(function (p) { return '<option' + (p === preProb ? ' selected' : '') + '>' + p + '</option>'; }).join(''); }

    el.innerHTML =
      '<div class="apf-card">' +
        '<div class="apf-row">' +
          '<input class="apf-in apf-model" placeholder="Model number (e.g. WTW5000DW1)" />' +
          applSel +
          '<select class="apf-sel apf-prob">' + probOpts(appl) + '</select>' +
        '</div>' +
        '<div class="apf-row" style="margin-bottom:0"><button class="apf-go" type="button">Find my part</button></div>' +
        '<div class="apf-out"></div>' +
      '</div>';

    var out = el.querySelector('.apf-out');
    var applEl = el.querySelector('.apf-appl');
    var probEl = el.querySelector('.apf-prob');
    if (applEl) applEl.addEventListener('change', function () { probEl.innerHTML = probOpts(applEl.value); out.innerHTML = ''; });

    el.querySelector('.apf-go').addEventListener('click', function () {
      var a = applEl ? applEl.value : appl;
      var model = (el.querySelector('.apf-model').value || '').trim();
      var prob = probEl.value;
      var forModel = model ? (' for your <b style="color:var(--white,#f0f0f0)">' + model.replace(/[<>&"]/g, '') + '</b>') : '';
      var href = '/appliance-ai.html?appliance=' + encodeURIComponent(a) +
        (model ? '&model=' + encodeURIComponent(model) : '') +
        (prob ? '&problem=' + encodeURIComponent(prob) : '');
      out.innerHTML =
        '<div class="apf-res"><b>✅ We\'ve got it from here.</b> For a ' + NAME[a] + ' that\'s <b style="color:var(--white,#f0f0f0)">' + prob.toLowerCase() + '</b>' + forModel + ', our techs identify the <b style="color:var(--white,#f0f0f0)">exact part</b>, confirm it fits, and get it to you. You never hunt for a part number — that\'s our job.' +
          '<div class="apf-opts"><b style="color:var(--orange,#ff6200)">Four honest options, your call:</b> OEM or quality budget part &middot; shipped to your door (you install) or our tech installs it.</div>' +
          '<a class="apf-cta" href="' + href + '">Find &amp; ship my part → $50 Quick Check</a>' +
          '<div class="apf-fine">Snap a 10-sec video + a photo of the model sticker in the Quick Check and a real technician confirms the exact part before anything ships. $50 credits to your repair.</div>' +
        '</div>';
    });
  }

  function init() {
    var els = document.querySelectorAll('#ant-part-finder, .ant-part-finder');
    Array.prototype.forEach.call(els, mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
