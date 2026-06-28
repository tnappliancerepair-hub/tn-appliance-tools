/* ant-model-finder.js — "Where's my model number?" helper.
 * Mounts into <div id="ant-model-finder" data-appliance="dryer"></div>.
 * Shows where the model/serial tag hides on that appliance + a Quick Check CTA
 * (the Quick Check needs a photo of exactly this sticker). Useful + on-funnel. */
(function () {
  'use strict';
  var LOC = {
    dryer: ['Open the door — look on the inside rim or the frame around the opening', 'Inside the lint-trap slot — pull the screen out and look down into the housing', 'On the back panel, usually near the top'],
    washer: ['Top-load: lift the lid and look under it or around the rim', 'Front-load: open the door and check the inner frame around the opening', 'On the back panel, or low on the front near the bottom'],
    refrigerator: ['Inside the fridge — on the side wall near the top', 'Behind or above the crisper drawers', 'On the ceiling of the fresh-food section'],
    dishwasher: ['Open the door — look along the top or side edge of the inner door', 'On the side of the tub (visible with the door open)', 'Around the inner door frame'],
    oven: ['Open the door — check the frame around the opening', 'Behind or under the bottom storage / broiler drawer', 'On the side of the unit or behind the control panel'],
    microwave: ['Open the door — look on the inner frame', 'Over-the-range models: behind the lower vent grille, or inside the door', 'On the back of a countertop unit'],
    disposal: ['On the body of the disposal under the sink — bring a flashlight', 'Look for a stamped or printed plate on the side', 'Brand + model are usually near the bottom']
  };
  var PARAM = { dryer: 'dryer', washer: 'washer', refrigerator: 'refrigerator', dishwasher: 'dishwasher', oven: 'oven', microwave: 'microwave', disposal: 'disposal' };
  var NAME = { dryer: 'dryer', washer: 'washer', refrigerator: 'refrigerator', dishwasher: 'dishwasher', oven: 'oven or range', microwave: 'microwave', disposal: 'garbage disposal' };

  function css() {
    if (document.getElementById('amf-css')) return;
    var s = document.createElement('style'); s.id = 'amf-css';
    s.textContent = [
      '.amf-card{margin-top:18px;border:1px solid var(--bord2,#252525);border-radius:14px;background:var(--surface,#0c0c0c);padding:22px}',
      '.amf-card ul{list-style:none;padding:0;margin:6px 0 0}',
      '.amf-card li{position:relative;padding:9px 0 9px 26px;border-top:1px solid var(--border,#1a1a1a);font-size:13.5px;color:var(--white,#f0f0f0);line-height:1.6}',
      '.amf-card li:first-child{border-top:0}',
      '.amf-card li::before{content:"📍";position:absolute;left:0;top:8px;font-size:13px}',
      '.amf-look{font-size:12.5px;color:var(--gray,#888);margin-top:12px;line-height:1.7}',
      '.amf-look b{color:var(--white,#f0f0f0)}',
      '.amf-cta{display:inline-flex;align-items:center;gap:8px;margin-top:16px;background:var(--orange,#ff6200);color:#000;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:13px 20px;border-radius:10px;text-decoration:none}',
      '.amf-cta:hover{filter:brightness(1.08)}'
    ].join('');
    document.head.appendChild(s);
  }

  function block(appl) {
    var locs = LOC[appl] || [];
    var items = locs.map(function (l) { return '<li>' + l + '</li>'; }).join('');
    return '<ul>' + items + '</ul>';
  }

  function mount(el) {
    css();
    var appl = (el.getAttribute('data-appliance') || 'all').toLowerCase();
    var body, cta;
    if (appl === 'all' || !LOC[appl]) {
      // brand hubs / generic: show the big three
      body = ['dryer', 'washer', 'refrigerator', 'dishwasher', 'oven'].map(function (a) {
        return '<div style="margin-top:14px"><div style="font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--orange,#ff6200);margin-bottom:2px">' + NAME[a] + '</div>' + block(a) + '</div>';
      }).join('');
      cta = '/appliance-ai.html';
    } else {
      body = block(appl);
      cta = '/appliance-ai.html?appliance=' + (PARAM[appl] || appl);
    }
    el.innerHTML =
      '<div class="amf-card">' + body +
        '<div class="amf-look">It\'s a sticker or metal plate marked <b>Model</b> / <b>MOD</b> / <b>M/N</b> — a mix of letters and numbers (e.g. <b>WTW5000DW1</b>). The serial (S/N) sits right next to it.</div>' +
        '<a class="amf-cta" href="' + cta + '">Found it? Start the $50 Quick Check → snap a photo</a>' +
      '</div>';
  }

  function init() {
    var els = document.querySelectorAll('#ant-model-finder, .ant-model-finder');
    Array.prototype.forEach.call(els, mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
