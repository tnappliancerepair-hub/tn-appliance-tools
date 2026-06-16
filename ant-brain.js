/* ant-brain.js — shared grounded-troubleshooting widget. One component, dropped
 * into Tech Ant + Teddy Tool (lens-filtered by role). Calls ant-troubleshoot and
 * renders a CITED diagnostic brief: fault-code card + grounded answer + similar
 * jobs. Self-contained (no deps); injects its own scoped styles.
 *
 *   <div id="ant-brain"></div>
 *   <script src="/ant-brain.js"></script>
 *   AntBrain.mount(document.getElementById('ant-brain'), {
 *     brand, model, appliance, symptom, job_id, role  // role: tech|office|owner|customer
 *   });
 */
(function () {
  'use strict';
  var FN = '/.netlify/functions/ant-troubleshoot';
  var injected = false;

  function injectStyles() {
    if (injected) return; injected = true;
    var css = ''
      + '.antb{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border:1px solid rgba(127,127,127,.28);border-radius:12px;padding:14px;margin:10px 0;background:rgba(127,127,127,.04);}'
      + '.antb-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:10px;}'
      + '.antb-row{display:flex;gap:8px;flex-wrap:wrap;}'
      + '.antb-in{flex:1;min-width:160px;font-size:15px;padding:9px 11px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:transparent;color:inherit;font-family:inherit;}'
      + '.antb-btn{padding:9px 14px;border:0;border-radius:8px;background:#1a8f4c;color:#fff;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;}'
      + '.antb-btn[disabled]{opacity:.55;cursor:default;}'
      + '.antb-out{margin-top:12px;font-size:14px;line-height:1.5;}'
      + '.antb-fc{border-left:3px solid #d98a00;background:rgba(217,138,0,.08);padding:9px 11px;border-radius:6px;margin-bottom:10px;font-size:13.5px;}'
      + '.antb-fc b{color:#d98a00;}'
      + '.antb-ans{white-space:normal;}'
      + '.antb-ans ul{margin:6px 0 6px 18px;padding:0;} .antb-ans li{margin:3px 0;}'
      + '.antb-cites{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}'
      + '.antb-chip{font-size:11.5px;padding:3px 8px;border-radius:99px;border:1px solid rgba(127,127,127,.35);text-decoration:none;color:inherit;opacity:.85;}'
      + '.antb-chip.fc{border-color:#d98a00;color:#d98a00;}'
      + '.antb-muted{opacity:.7;font-size:12.5px;}'
      + '.antb-err{color:#d33;font-size:13px;}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // tiny markdown → html: **bold**, lists, line breaks, headlines
  function mdToHtml(md) {
    var lines = String(md || '').split('\n'); var out = []; var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var b = esc(ln).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
      if (/^\s*[-*]\s+/.test(ln)) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + b.replace(/^\s*[-*]\s+/, '') + '</li>'); continue; }
      if (/^\s*\d+\.\s+/.test(ln)) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + b.replace(/^\s*\d+\.\s+/, '') + '</li>'); continue; }
      if (inList) { out.push('</ul>'); inList = false; }
      if (ln.trim() === '') out.push('<br/>'); else out.push('<div>' + b + '</div>');
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function render(host, opts) {
    injectStyles();
    var role = opts.role || 'tech';
    host.className = 'antb';
    host.innerHTML =
      '<div class="antb-h">🧠 Ant Diagnose <span class="antb-muted">grounded in fault codes + your past jobs</span></div>'
      + '<div class="antb-row">'
      + '  <input class="antb-in" type="text" placeholder="Symptom or error code (e.g. \'4C, won’t fill\')" />'
      + '  <button class="antb-btn" type="button">Diagnose</button>'
      + '</div>'
      + '<div class="antb-out"></div>';
    var input = host.querySelector('.antb-in');
    var btn = host.querySelector('.antb-btn');
    var out = host.querySelector('.antb-out');
    if (opts.symptom) input.value = opts.symptom;

    function go() {
      var symptom = (input.value || '').trim();
      if (!symptom && !opts.code) { out.innerHTML = '<span class="antb-muted">Type a symptom or error code first.</span>'; return; }
      btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Thinking…';
      out.innerHTML = '<span class="antb-muted">Checking fault codes + your past jobs…</span>';
      fetch(FN, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: opts.brand || '', model: opts.model || '', appliance: opts.appliance || '', symptom: symptom, code: opts.code || '', job_id: opts.job_id || 0, role: role }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        btn.disabled = false; btn.textContent = orig;
        if (!j || !j.ok) { out.innerHTML = '<span class="antb-err">' + esc((j && j.error) || 'Diagnose failed') + '</span>'; return; }
        var html = '';
        if (j.fault_code) {
          html += '<div class="antb-fc"><b>' + esc((opts.brand || '') + ' ' + j.fault_code.code) + '</b> — ' + esc(j.fault_code.meaning)
            + (j.fault_code.test ? '<br/><span class="antb-muted">Test: ' + esc(j.fault_code.test) + '</span>' : '') + '</div>';
        }
        if (j.answer_md) html += '<div class="antb-ans">' + mdToHtml(j.answer_md) + '</div>';
        else if (!j.grounded) html += '<div class="antb-muted">No grounding found for this model/symptom yet — as more jobs are logged this gets smarter. Start with the fault-code test above or the model’s tech sheet.</div>';
        else html += '<div class="antb-muted">(no answer generated)</div>';
        // citation chips (dedup)
        var cites = (j.citations || []); var seen = {}; var chips = [];
        for (var i = 0; i < cites.length; i++) {
          var c = cites[i]; var key = c.type + ':' + c.label; if (seen[key]) continue; seen[key] = 1;
          if (c.type === 'job' && c.job_id) chips.push('<a class="antb-chip" href="/job-detail.html?job_id=' + encodeURIComponent(c.job_id) + '" target="_blank">' + esc(c.label) + '</a>');
          else chips.push('<span class="antb-chip ' + (c.type === 'fault-code' ? 'fc' : '') + '">' + esc(c.label) + '</span>');
        }
        if (chips.length) html += '<div class="antb-cites">' + chips.join('') + '</div>';
        out.innerHTML = html;
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = orig;
        out.innerHTML = '<span class="antb-err">' + esc(e.message || String(e)) + '</span>';
      });
    }
    btn.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  window.AntBrain = {
    mount: function (el, opts) { if (!el) return; render(el, opts || {}); },
  };
})();
