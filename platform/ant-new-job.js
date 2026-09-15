// ant-new-job.js — THE door a phone lead walks through. One definition, every office
// surface. Drop <script src="/platform/ant-new-job.js"></script> on any page where
// somebody might be on the phone with a customer, then call AntNewJob.mount(sb, el).
//
// Danielle, 2026-09-15, three times, correcting herself twice to be precise:
//   "there is no place to add ppl in the new system. Until that is added i cant put any
//    new job in"
//   "I have no way to add this in new [system]... cant add to old without [a] date...
//    Working on 3 systems."
// And Sofia, per Danielle: "She don't know how to add ppl."
//
// She was right when she said it. The board had NO add affordance at all -- every card
// arrived from the Xano mirror, a warranty email, or a web form -- so a CASH job that came
// in on the PHONE had nowhere to land and sat on a notepad until somebody re-typed it.
// That is how a paid lead gets lost.
//
// WHY THIS IS A MODULE AND NOT A COPY. The first cut lived inline on office-board.html.
// But Danielle does not work one page -- she works the board, dispatch, needs-scheduled and
// messages, and the call comes in wherever she happens to be standing. A second copy of
// this drifts (the route picker earned that lesson: three copies, three vocabularies). One
// file, every surface, self-contained: it brings its own CSS, resolves the shop and the
// person from app_user itself, and needs nothing from the host page but a signed-in client.
//
// THE SHAPE -- the SAME shape createLeadJob() writes server-side, so a lead typed here is
// indistinguishable from one Ann captured on a call:
//   customer -> unit -> job(status 'new') -> thread line -> portal token
// Browser-side on the office user's OWN session, because RLS scopes all five of those
// tables to their shop. No service key in the page.
//
// 🔴 source IS ALWAYS 'manual', AND THAT IS LOAD-BEARING. That exact string is on
// platform-lead-watch's LEAD_SOURCES allowlist -- the watcher that pages the owner when a
// lead sits with nobody replying. A prettier source here ('office_google', say) makes every
// typed lead invisible to that watcher, silently. That is the trap cash_ready_notify fell
// into for three weeks. WHERE they came from rides the thread line + an audit event instead.
//
// Nothing in here can text a customer.
(function (w, d) {
  'use strict';

  // ── THE TWO RULES WORTH PINNING ────────────────────────────────────────────
  // gate: what makes a typed lead worth a card at all. A card with no machine and nobody
  // to call is the junk-shell shape the board already drowns in (406 intake artifacts on
  // TN's own board). It does not get to add one more. Name-only and phone-only BOTH pass:
  // an LSA chat lead has no phone, and a caller may never give a name.
  function gate(f) {
    f = f || {};
    if (!String(f.what || '').trim()) return 'Say what the appliance is — a card with no machine helps nobody.';
    if (!String(f.phone || '').trim() && !String(f.name || '').trim()) return 'Need at least a name or a phone number.';
    return '';
  }

  // phoneKey: platform phones are stored in MIXED formats (+1XXXXXXXXXX and bare
  // XXXXXXXXXX), so a returning customer is matched on the trailing 10 digits, never the
  // raw string -- an exact match makes one human two cards. Anything short of a full 10
  // digits returns '' : a partial suffix would match the WRONG person, and a new row is
  // safer than the wrong human's card.
  function phoneKey(phone) {
    var dg = String(phone || '').replace(/\D/g, '');
    return dg.length >= 10 ? dg.slice(-10) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── SELF-CONTAINED CSS ─────────────────────────────────────────────────────
  // Every class is anj-*, so this can land on a page with its own .ov/.sheet and collide
  // with nothing. Colours fall back to plain values when the host page has no tokens.
  var CSS_ID = 'anj-css';
  function ensureCss() {
    if (d.getElementById(CSS_ID)) return;
    var st = d.createElement('style'); st.id = CSS_ID;
    st.textContent =
      '.anj-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px 12px}' +
      '.anj-sheet{background:var(--card,#fff);color:var(--ink,#111827);border-radius:14px;padding:18px;width:100%;max-width:440px;box-shadow:0 18px 50px rgba(0,0,0,.3);font:inherit}' +
      '.anj-sheet h2{margin:0 0 4px;font-size:19px}' +
      '.anj-hint{font-size:12.5px;color:var(--dim,#6b7280);line-height:1.45}' +
      '.anj-sheet label{display:block;margin:11px 0 4px;font-size:13px;font-weight:650}' +
      '.anj-sheet input,.anj-sheet textarea,.anj-sheet select{width:100%;padding:11px 12px;border:1px solid var(--line,#d1d5db);border-radius:10px;' +
        'background:var(--bg,#fff);color:var(--ink,#111827);font:inherit;box-sizing:border-box}' +
      '.anj-sheet textarea{min-height:58px;resize:vertical}' +
      '.anj-row{display:flex;gap:8px;margin-top:15px}' +
      '.anj-row button{flex:1;padding:12px;border-radius:10px;border:1px solid var(--line,#d1d5db);background:var(--bg,#fff);color:var(--ink,#111827);font:inherit;font-weight:650;cursor:pointer}' +
      '.anj-row button.anj-go{background:#2563eb;border-color:#2563eb;color:#fff}' +
      '.anj-row button[disabled]{opacity:.6;cursor:default}' +
      '.anj-err{color:#b91c1c;font-size:13px;margin-top:9px;min-height:1px;line-height:1.45}' +
      '.anj-ok{color:#047857;font-size:13px;margin-top:9px;line-height:1.45}';
    d.head.appendChild(st);
  }

  // ── WHO + WHERE ────────────────────────────────────────────────────────────
  // The host page is not asked for company_id or a name. Resolve both from app_user on the
  // signed-in session, and default the name to 'Office' so a slow lookup can NEVER block a
  // write -- the same rule the part-note attribution earned.
  var _me = null;
  function resolveMe(sb) {
    if (_me) return Promise.resolve(_me);
    return sb.auth.getUser().then(function (u) {
      var uid = u && u.data && u.data.user && u.data.user.id;
      if (!uid) return { company_id: null, name: 'Office' };
      return sb.from('app_user').select('company_id,name').eq('auth_user_id', uid).limit(1).then(function (r) {
        var row = (!r.error && r.data && r.data[0]) || {};
        return { company_id: row.company_id || null, name: row.name || 'Office' };
      });
    }).then(function (me) { _me = me; return me; })
      .catch(function () { return { company_id: null, name: 'Office' }; });
  }

  // ── THE SHEET ──────────────────────────────────────────────────────────────
  // opts: { sb, trade, onDone }  — trade is optional; 'automotive' makes the unit a vehicle.
  function open(opts) {
    opts = opts || {};
    var sb = opts.sb || w.sb;
    if (!sb) { alert('Not signed in.'); return; }
    ensureCss();

    var ov = d.createElement('div'); ov.className = 'anj-ov';
    var opt = function (v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; };
    ov.innerHTML =
      '<div class="anj-sheet" role="dialog" aria-label="New customer and job">' +
        '<h2>＋ New customer &amp; job</h2>' +
        '<div class="anj-hint" style="margin:0 0 2px">Somebody called. Type what they told you — it lands in <b>New</b> the moment you save, and you never have to re-enter it.</div>' +
        '<label>Their name</label><input id="anj_name" autocomplete="off" placeholder="Sarah Miller">' +
        '<label>Phone <span class="anj-hint">so somebody can call them back</span></label>' +
        '<input id="anj_phone" type="tel" inputmode="tel" autocomplete="off" placeholder="(615) 555-0142">' +
        '<label>What is it <span class="anj-hint">brand + appliance</span></label>' +
        '<input id="anj_what" autocomplete="off" placeholder="LG refrigerator">' +
        '<label>What is it doing</label><textarea id="anj_problem" placeholder="Not cooling. About 7 years old."></textarea>' +
        '<label>City</label><input id="anj_city" autocomplete="off" placeholder="Ashland City">' +
        '<label>Where did they come from</label>' +
        '<select id="anj_chan">' +
          opt('Google', 'Google — search or maps') +
          opt('Google Ads', 'Google — paid ad') +
          opt('Google LSA', 'Google — Local Services (LSA)') +
          opt('Website', 'Our website') +
          opt('Referral', 'Referral / word of mouth') +
          opt('Repeat customer', 'Repeat customer') +
          opt('Other', 'Other') +
        '</select>' +
        // Danielle 2026-09-15: "no place to add warranty number." She works warranty all day,
        // so a job she types by hand has to be able to carry its claim from the start —
        // otherwise she saves, reopens the drawer, and types it a second time. Optional:
        // a cash lead just leaves it blank.
        '<label>Warranty <span class="anj-hint">leave blank for a cash job</span></label>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="anj_warco" autocomplete="off" placeholder="AHS / SquareTrade" style="flex:1">' +
          '<input id="anj_claim" autocomplete="off" placeholder="Claim / WO #" style="flex:1">' +
        '</div>' +
        '<div class="anj-row"><button id="anj_cancel">Cancel</button><button class="anj-go" id="anj_save">Create job</button></div>' +
        '<div class="anj-err" id="anj_err"></div>' +
      '</div>';
    d.body.appendChild(ov);

    var close = function () { try { d.body.removeChild(ov); } catch (e) {} };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    d.getElementById('anj_cancel').onclick = close;
    var nm = d.getElementById('anj_name'); if (nm) nm.focus();

    d.getElementById('anj_save').onclick = function () {
      var gv = function (id) { var e = d.getElementById(id); return e ? String(e.value || '').trim() : ''; };
      var err = d.getElementById('anj_err');
      var name = gv('anj_name'), phone = gv('anj_phone'), what = gv('anj_what');
      var problem = gv('anj_problem'), city = gv('anj_city'), chan = gv('anj_chan') || 'Other';
      var warco = gv('anj_warco'), claim = gv('anj_claim');

      var bad = gate({ what: what, phone: phone, name: name });
      if (bad) { err.textContent = bad; return; }

      var btn = d.getElementById('anj_save');
      btn.disabled = true; btn.textContent = 'Creating…'; err.textContent = '';
      var fail = function (m) {
        btn.disabled = false; btn.textContent = 'Create job';
        err.textContent = m || 'Could not create that — try again.';
      };

      var parts = name ? name.split(/\s+/) : [];
      var first = parts[0] || null, last = parts.slice(1).join(' ') || null;
      var digits = phoneKey(phone);

      resolveMe(sb).then(function (me) {
        var cid = me.company_id;
        if (!cid) return fail('Could not tell which shop you are signed in to. Refresh and try again.');
        var who = me.name || 'Office';

        var withCustomer = function (cust) {
          if (!cust || !cust.id) return fail('Could not save the customer.');
          var kind = (opts.trade === 'automotive') ? 'vehicle' : 'appliance';
          // Every insert that MATTERS proves a row came back: an RLS-blocked write returns
          // zero rows and NO error, so `if (r.error)` alone reads a refusal as success.
          sb.from('unit').insert({ company_id: cid, customer_id: cust.id, kind: kind, label: what, attributes: {} })
            .select('id').then(function (u) {
            if (u.error || !u.data || !u.data.length) return fail('Could not save the appliance.');
            sb.from('job').insert({
              company_id: cid, customer_id: cust.id, unit_id: u.data[0].id,
              // ⚠️ source stays 'manual' AND THAT IS LOAD-BEARING even on a warranty job:
              // 'manual' is on platform-lead-watch's LEAD_SOURCES allowlist, and a prettier
              // source makes every typed lead invisible to the watcher that pages the owner
              // when nobody replies. Who it's for rides warranty_company, not source.
              status: 'new', problem: (problem || what), source: 'manual',
              warranty_company: warco || null, claim_number: claim || null
            }).select('id').then(function (j) {
              if (j.error || !j.data || !j.data.length) return fail('Could not create the job.');
              var jobId = j.data[0].id;
              // Trailers are best-effort ON PURPOSE: the JOB is already real and on the
              // board. None of these may be allowed to fail the thing that matters.
              var line = '📞 Lead from ' + chan + ' — ' + what + (problem ? ' — ' + problem : '') +
                         (city ? ' (' + city + ')' : '') +
                         (warco ? ' · ' + warco + (claim ? ' #' + claim : '') : '') + ' · taken by ' + who;
              try { sb.from('thread_message').insert({ company_id: cid, customer_id: cust.id, job_id: jobId, direction: 'in', channel: 'call', sender: 'office', kind: 'note', body: line }); } catch (_) {}
              try { sb.from('event').insert({ company_id: cid, type: 'office_lead_created', entity: 'job', payload: { job_id: jobId, channel: chan, by: who, had_phone: !!digits } }); } catch (_) {}
              try { sb.from('portal_grant').insert({ company_id: cid, customer_id: cust.id, job_id: jobId }); } catch (_) {}
              close();
              if (typeof opts.onDone === 'function') { try { opts.onDone(jobId); } catch (_) {} }
              else { try { w.location.reload(); } catch (_) {} }
            });
          });
        };

        var mk = function () {
          sb.from('customer').insert({ company_id: cid, first_name: first, last_name: last, phone: phone || null, city: city || null })
            .select('id').then(function (c) {
            if (c.error || !c.data || !c.data.length) return fail('Could not save the customer.');
            withCustomer(c.data[0]);
          });
        };

        // Reuse the existing customer on this phone. A second row for the same person is
        // how one human becomes two cards.
        if (digits) {
          sb.from('customer').select('id').eq('company_id', cid).ilike('phone', '%' + digits).limit(1).then(function (f) {
            if (!f.error && f.data && f.data.length) withCustomer(f.data[0]); else mk();
          });
        } else mk();
      });
    };
  }

  // ── ONE-LINE MOUNT ─────────────────────────────────────────────────────────
  // mount(sb, container, opts) drops the button into a container and wires it. Pages that
  // already have their own button just call open() directly.
  function mount(sb, container, opts) {
    if (!container) return null;
    opts = opts || {};
    var b = d.createElement('button');
    b.id = opts.id || 'anj-btn';
    b.type = 'button';
    b.textContent = opts.label || '＋ New job';
    if (opts.className) b.className = opts.className;
    b.onclick = function () { open({ sb: sb, trade: opts.trade, onDone: opts.onDone }); };
    container.appendChild(b);
    return b;
  }

  w.AntNewJob = { open: open, mount: mount, gate: gate, phoneKey: phoneKey };
})(window, document);
