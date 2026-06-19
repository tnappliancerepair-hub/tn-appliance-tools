// ant-constraints.js — ONE place that turns a job's customer time-window into a
// readable line, so the #1 scheduling variable shows the SAME way on every
// surface (office schedule views, job detail, tech job page). Also exposes a
// structured parse() so the Ant assistant / route-fill can reason about windows
// when suggesting nearby stops.
//
//   <script src="/ant-constraints.js"></script>
//   el.innerHTML = AntConstraints.render(job, { dark:true, style:'panel' });
//   const c = AntConstraints.parse(job);  // {avail, unavail, windows[], locked, hasAny}
(function (w) {
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  function parse(job){
    var pref = String((job && job.customer_preference_text) || '').trim();
    var locked = /squaretrade|servicepower|service power/i.test((job && job.warranty_company) || '');
    var avail = '', unavail = '';
    if (pref){
      var a = pref.match(/AVAIL:\s*([^\n]*)/i);
      var u = pref.match(/UNAVAIL:\s*([^\n]*)/i);
      if (a) avail = a[1].trim();
      if (u) unavail = u[1].trim();
      if (!a && !u) avail = pref;
    }
    var windows = [];
    try {
      var g = JSON.parse((job && job.customer_availability_grid) || '');
      if (Array.isArray(g)) for (var i=0;i<g.length;i++){
        var e = g[i], day = e.day || e.date || '', blocks = Array.isArray(e.blocks) ? e.blocks : [];
        if (day) windows.push({ day: day, blocks: blocks });
      }
    } catch(_){}
    return { avail: avail, unavail: unavail, windows: windows, locked: locked,
             hasAny: !!(avail || unavail || windows.length || locked) };
  }

  function render(job, opts){
    opts = opts || {};
    var c = parse(job), dark = !!opts.dark;
    var base = opts.style === 'panel'
      ? 'margin:8px 0;padding:9px 11px;border-radius:9px;font-size:13px;line-height:1.55'
      : 'font-size:12px;font-weight:700;margin-top:3px;padding:4px 7px;border-radius:6px;line-height:1.4';
    // Optional manual-edit affordance (office surfaces only). Lets someone type
    // the availability they got on a phone call when SMS/portal/Vapi didn't land.
    var editSuffix = (opts.edit && opts.jobId)
      ? ' <a href="javascript:void(0)" onclick="event.stopPropagation();AntConstraints.edit(' + opts.jobId + ')" style="color:inherit;opacity:.75;text-decoration:underline;font-weight:700;white-space:nowrap">✏️ edit</a>'
      : '';
    if (c.locked){
      var lc = dark ? 'background:rgba(91,155,213,0.16);color:#9db8e0'
                    : 'background:rgba(91,155,213,0.13);border:1px solid rgba(91,155,213,0.5);color:#2c5777';
      return '<div style="'+base+';'+lc+'">📌 vendor pre-scheduled — locked slot</div>';
    }
    var bits = [];
    if (c.avail)   bits.push('✅ ' + esc(c.avail));
    if (c.unavail) bits.push('⛔ ' + esc(c.unavail));
    for (var i=0;i<c.windows.length;i++){
      var win = c.windows[i];
      bits.push('📅 ' + esc(win.day) + (win.blocks.length ? ' (' + esc(win.blocks.join(', ')) + ')' : ''));
    }
    if (bits.length){
      var hc = dark ? 'background:rgba(255,180,84,0.18);color:#ffce8a'
                    : 'background:rgba(255,180,84,0.14);border:1px solid rgba(255,180,84,0.55);color:#7a5212';
      return '<div style="'+base+';'+hc+'">🕒 ' + (opts.style==='panel' ? '<b>Scheduling constraints</b> ' : '') + bits.join(' · ') + editSuffix + '</div>';
    }
    var nc = dark ? 'background:rgba(138,150,168,0.1);color:#8a96a8'
                  : 'background:rgba(138,150,168,0.08);border:1px dashed rgba(138,150,168,0.4);color:#8a96a8';
    return '<div style="'+base+';'+nc+';font-weight:600">🕒 no time info — ' + (opts.edit && opts.jobId ? 'gather at intake' + editSuffix : 'gather at intake') + '</div>';
  }

  // Manual entry — prompts for available + unavailable, writes via the Netlify
  // function (packs AVAIL:/UNAVAIL: into customer_preference_text), reloads.
  async function edit(jobId){
    if (!jobId) return;
    var a = window.prompt('When is the customer AVAILABLE? (days/times — e.g. "weekday mornings, Tue/Thu after 2")', '');
    if (a === null) return;
    var u = window.prompt("When can they NOT do? (e.g. \"not Fridays, no mornings\") — leave blank if none", '');
    if (u === null) u = '';
    try {
      await fetch('/.netlify/functions/set-job-availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, available: a, unavailable: u, actor: 'office' }),
      });
      if (typeof location !== 'undefined' && location.reload) location.reload();
    } catch (e) { try { alert('Could not save: ' + (e && e.message)); } catch (_) {} }
  }

  w.AntConstraints = { parse: parse, render: render, edit: edit };
})(window);
