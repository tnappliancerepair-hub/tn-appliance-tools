// ant-add-machine.js — ADD A MACHINE TO A CLAIM. One definition, tech and office.
// Drop <script src="/platform/ant-add-machine.js?v=20260916-machine"></script> on any page
// where somebody is looking at a job, then call AntAddMachine.open({sb, companyId, job}).
//
// Teddy, 2026-09-16:
//   "when a guy gets out to a customer's house they'll have multiple machines and they need
//    to add a machine, which in turn they need a whole nother TDR for that machine... if
//    they have a fridge on there and then the customer says hey we also have a dishwasher
//    that needs fixed, they've gotta fill out that TDR for the dishwasher. They've gotta be
//    able to add a machine on there."  -- and the OFFICE needs the same button.
//
// WHAT WAS ALREADY THERE, AND WHY IT HAD NEVER BEEN USED ONCE. The tech page had a
// ＋ Add machine form, and the platform has carried the whole spine since migration 020
// (job.stop_id, one job per machine, so each machine already gets its own job_tdr for free).
// Measured 2026-09-16: source='tech_add_machine' returns ZERO rows in the entire history.
// Two reasons, and both are fixed here:
//   1. IT DID NOT ADD THE MACHINE TO THE CLAIM. The insert copied customer, tech, day and
//      stop -- and NOT warranty_company, claim_number or dispatch_id. So the dishwasher on
//      an AHS fridge claim landed looking like an unrelated cash job with no claim on it,
//      which is the one thing the office needs to file it.
//   2. It sat in card 9 of a long page, under the parts tracker. A tech standing in a
//      kitchen never scrolled to it.
//
// WHY A MODULE AND NOT A COPY: the office board needs the identical write. Two copies of an
// insert chain drift -- the route picker earned that lesson with three vocabularies, and
// ant-new-job.js exists for exactly this reason. Self-contained: its own aam-* CSS, nothing
// needed from the host page but a signed-in client and the parent job.
//
// Nothing in here can text a customer.
(function (w, d) {
  'use strict';

  // ── THE THREE RULES WORTH PINNING ───────────────────────────────────────────
  //
  // 1. THE CLAIM COMES WITH IT. warranty_company + claim_number + dispatch_id ride onto
  //    the sibling, because "add a machine to a claim" is the whole ask. The tech can
  //    untick it on the spot when the customer's second machine is NOT on that claim --
  //    filing a covered claim for an uncovered machine is the one expensive mistake here,
  //    so it is a visible choice, never a silent assumption.
  var CLAIM_KEYS = ['warranty_company', 'claim_number', 'dispatch_id'];
  //
  // 2. THE VISIT COMES WITH IT. Same truck, same day, same window, same door.
  var VISIT_KEYS = ['technician_id', 'scheduled_day', 'scheduled_start',
                    'service_window', 'time_window', 'availability', 'access_notes'];
  //
  // 3. THE PARENT'S PROGRESS DOES NOT. A machine nobody has looked at yet is never
  //    'awaiting_parts' and never 'completed' -- inheriting either would put a brand new
  //    appliance straight into a parts queue or a closed job. It is in_progress only when
  //    the tech is standing there right now, otherwise it is simply scheduled.
  function liveStatus(s) { return s === 'in_progress' ? 'in_progress' : 'scheduled'; }

  function fieldsFor(parent, o) {
    parent = parent || {}; o = o || {};
    var row = {
      company_id: o.companyId,
      customer_id: parent.customer_id,
      unit_id: o.unitId,
      stop_id: parent.stop_id || parent.id,
      status: liveStatus(parent.status),
      problem: o.problem || '',
      source: o.source || 'tech_add_machine'
    };
    VISIT_KEYS.forEach(function (k) {
      var v = parent[k];
      if (v !== undefined && v !== null && v !== '') row[k] = v;
    });
    if (o.sameClaim !== false) {
      CLAIM_KEYS.forEach(function (k) { if (parent[k]) row[k] = parent[k]; });
    }
    return row;
  }

  function claimOf(job) {
    if (!job) return '';
    var co = job.warranty_company || '';
    var no = job.claim_number || job.dispatch_id || '';
    if (!co && !no) return '';
    return (co + (no ? ' #' + no : '')).trim();
  }

  // ── the write ───────────────────────────────────────────────────────────────
  // unit first, then the job that points at it. A unit with no job is harmless clutter;
  // a job with no unit is a card nobody can read, so the order matters.
  function create(o, cb) {
    var sb = o.sb, parent = o.job;
    var label = String(o.label || '').trim();
    if (!label) { cb({ ok: false, error: 'What machine is it?' }); return; }
    var kind = (parent.unit && parent.unit.kind) || 'appliance';

    var bad = function (e) {
      var m = (e && e.message) || '';
      cb({ ok: false, error: /stop_id|does not exist|column|schema cache/i.test(m)
        ? 'Multi-machine is not switched on for this shop yet — tell the office.'
        : (m || 'Could not add that machine — try again.') });
    };
    var mkJob = function () {
      sb.from('unit').insert({ company_id: o.companyId, customer_id: parent.customer_id,
                               kind: kind, label: label }).select('id').then(function (ru) {
        if (ru.error || !ru.data || !ru.data[0]) { bad(ru.error); return; }
        var row = fieldsFor(parent, { companyId: o.companyId, unitId: ru.data[0].id,
                                      problem: o.problem, sameClaim: o.sameClaim, source: o.source });
        sb.from('job').insert(row).select('id').then(function (rj) {
          // A write is only saved when a ROW COMES BACK -- an RLS refusal returns zero rows
          // and no error, and reporting that as success is how a machine goes missing.
          if (rj.error || !rj.data || !rj.data[0]) { bad(rj.error); return; }
          cb({ ok: true, id: rj.data[0].id, claim: o.sameClaim !== false ? claimOf(parent) : '' });
        });
      });
    };
    // Make THIS job the anchor of the stop if it is not part of one yet, so both machines
    // hang off the same stop_id and every surface can group them.
    if (!parent.stop_id) {
      sb.from('job').update({ stop_id: parent.id }).eq('id', parent.id).then(function (r) {
        if (r.error) { bad(r.error); return; }
        parent.stop_id = parent.id;
        mkJob();
      });
    } else mkJob();
  }

  // ── HYDRATE ─────────────────────────────────────────────────────────────────
  // The office board has a LEAN fallback select that does not carry claim_number /
  // dispatch_id / stop_id. A card loaded from that tier looks exactly like a job with no
  // claim on it -- and adding a machine off it would land the sibling claimless, which is
  // the precise failure this module exists to end. So before the sheet opens we top the
  // parent up from the database whenever a field we copy was never LOADED (undefined).
  // A field that was loaded and is genuinely empty (null) is left alone -- that is an
  // answer, not a gap.
  var HYDRATE_KEYS = ['customer_id', 'status', 'stop_id'].concat(CLAIM_KEYS, VISIT_KEYS);
  function hydrate(sb, job, cb) {
    var missing = HYDRATE_KEYS.filter(function (k) { return job[k] === undefined; });
    if (!missing.length || !job.id) { cb(job); return; }
    sb.from('job').select(HYDRATE_KEYS.join(',') + ',id').eq('id', job.id).limit(1)
      .then(function (r) {
        var row = (!r.error && r.data && r.data[0]) || null;
        // A failed read must not invent values -- we carry on with what we already had.
        if (row) missing.forEach(function (k) { job[k] = row[k]; });
        cb(job);
      });
  }

  function siblings(sb, job, cb) {
    var sid = job.stop_id || job.id;
    sb.from('job').select('id,status,unit:unit_id(label),tdr:job_tdr(id)')
      .or('stop_id.eq.' + sid + ',id.eq.' + sid).then(function (r) {
        cb(r.error ? [] : (r.data || []));
      });
  }

  // ── the sheet ───────────────────────────────────────────────────────────────
  var CSS_ID = 'aam-css';
  function css() {
    if (d.getElementById(CSS_ID)) return;
    var s = d.createElement('style'); s.id = CSS_ID;
    s.textContent =
      '.aam-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9100;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px 12px}' +
      '.aam-sheet{background:var(--panel,var(--card,#fff));color:var(--ink,#111827);border-radius:14px;padding:18px;width:100%;max-width:420px;box-shadow:0 18px 50px rgba(0,0,0,.3);font:inherit}' +
      '.aam-sheet h2{margin:0 0 4px;font-size:19px}' +
      '.aam-hint{font-size:12.5px;color:var(--muted,var(--dim,#6b7280));line-height:1.45}' +
      '.aam-sheet label{display:block;margin:12px 0 4px;font-size:13px;font-weight:650}' +
      '.aam-sheet input{width:100%;padding:11px 12px;border:1px solid var(--line,#d1d5db);border-radius:10px;background:var(--bg,#fff);color:var(--ink,#111827);font:inherit;box-sizing:border-box}' +
      '.aam-claim{display:flex;gap:9px;align-items:flex-start;margin-top:13px;padding:11px;border-radius:10px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.25)}' +
      '.aam-claim input{width:auto;margin:2px 0 0;flex:none}' +
      '.aam-claim span{font-size:13px;line-height:1.45}' +
      '.aam-row{display:flex;gap:8px;margin-top:16px}' +
      '.aam-row button{flex:1;padding:12px;border-radius:10px;border:1px solid var(--line,#d1d5db);background:var(--bg,#fff);color:var(--ink,#111827);font:inherit;font-weight:700;cursor:pointer}' +
      '.aam-row button.aam-go{background:#2563eb;border-color:#2563eb;color:#fff}' +
      '.aam-row button[disabled]{opacity:.6;cursor:default}' +
      '.aam-err{color:#b91c1c;font-size:13px;margin-top:10px;min-height:1px;line-height:1.45}';
    d.head.appendChild(s);
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function open(o) {
    var parent = o.job || {};
    if (o.sb && parent.id) { hydrate(o.sb, parent, function () { draw(o, parent); }); return; }
    draw(o, parent);
  }

  function draw(o, parent) {
    css();
    var claim = claimOf(parent);
    var ov = d.createElement('div'); ov.className = 'aam-ov';
    ov.innerHTML =
      '<div class="aam-sheet" role="dialog" aria-modal="true">' +
        '<h2>🧩 Add a machine to this stop</h2>' +
        '<div class="aam-hint">Same customer, same visit — but its own report, so the claim for this machine stands on its own.</div>' +
        '<label for="aamLabel">What machine is it?</label>' +
        '<input id="aamLabel" placeholder="e.g. Kenmore dishwasher" autocomplete="off" value="' + esc(o.label || '') + '">' +
        '<label for="aamProb">What’s it doing? <span style="font-weight:400;color:var(--muted,#6b7280)">(optional)</span></label>' +
        '<input id="aamProb" placeholder="e.g. won’t drain" autocomplete="off" value="' + esc(o.problem || '') + '">' +
        (claim
          ? '<div class="aam-claim"><input type="checkbox" id="aamClaim" checked>' +
            '<span><b>Put it on the same claim</b> — ' + esc(claim) + '.<br>' +
            '<span class="aam-hint">Untick it if this machine is <b>not</b> on that claim and needs its own.</span></span></div>'
          : '<div class="aam-hint" style="margin-top:12px">No claim on this job, so the new machine starts without one too.</div>') +
        '<div class="aam-row"><button type="button" id="aamX">Cancel</button>' +
        '<button type="button" class="aam-go" id="aamGo">Add machine</button></div>' +
        '<div class="aam-err" id="aamErr"></div>' +
      '</div>';
    d.body.appendChild(ov);
    var close = function () { try { d.body.removeChild(ov); } catch (_) {} };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#aamX').onclick = close;
    setTimeout(function () {
      try { ov.querySelector(o.label ? '#aamProb' : '#aamLabel').focus(); } catch (_) {}
    }, 60);

    var go = ov.querySelector('#aamGo');
    go.onclick = function () {
      var errEl = ov.querySelector('#aamErr'); errEl.textContent = '';
      var cb = ov.querySelector('#aamClaim');
      go.disabled = true; go.textContent = 'Adding…';
      create({
        sb: o.sb, companyId: o.companyId, job: parent,
        label: ov.querySelector('#aamLabel').value,
        problem: ov.querySelector('#aamProb').value,
        sameClaim: cb ? cb.checked : false,
        source: o.source
      }, function (r) {
        if (!r.ok) { go.disabled = false; go.textContent = 'Add machine'; errEl.textContent = r.error; return; }
        close();
        if (o.onDone) o.onDone(r);
      });
    };
  }

  w.AntAddMachine = { open: open, create: create, siblings: siblings, hydrate: hydrate,
                      fieldsFor: fieldsFor, liveStatus: liveStatus, claimOf: claimOf,
                      CLAIM_KEYS: CLAIM_KEYS, VISIT_KEYS: VISIT_KEYS, HYDRATE_KEYS: HYDRATE_KEYS };
})(window, document);
