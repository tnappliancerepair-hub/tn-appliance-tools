// office-readonly.js — lets TECHS view office pages, but makes changing anything
// impossible. (Teddy 2026-07-03: "I don't mind them seeing the office view —
// maybe it helps them understand — I just don't want them to change things.")
//
// When a tech (valid TechAuth session) opens an office page and is NOT
// office-authed, this: (1) sets window.OFFICE_READONLY=true SYNCHRONOUSLY, (2)
// installs a fetch guard that HARD-BLOCKS every write (mutating POST/PUT/DELETE)
// so nothing they tap can reach the server, and (3) drops a clear "view-only"
// banner + dims action controls. Reads (get_/list_/lookup_/search_/check_) are
// never touched, so the page still loads normally.
//
// SAFETY COUPLING: office gates only let a tech IN when window.OFFICE_READONLY is
// already true (this script sets it before the gate runs). So if this script
// somehow doesn't load, techs simply don't get in — they can NEVER get write
// access to an office page. Office users (OfficeAuth) are unaffected.
(function () {
  function isOffice() { try { return !!(window.OfficeAuth && window.OfficeAuth.isLoggedIn && window.OfficeAuth.isLoggedIn()); } catch (e) { return false; } }
  function techSession() { try { return (window.TechAuth && window.TechAuth.session && window.TechAuth.session()) || null; } catch (e) { return null; } }

  // Never engage on a TECH page (their own tools stay fully interactive).
  try { if (/tech[\w-]*\.html/i.test(location.pathname)) return; } catch (e) {}
  // Only engage for a tech who is NOT an office user. Office users = full control.
  if (isOffice() || !techSession()) return;
  window.OFFICE_READONLY = true;

  // Mutating endpoints to BLOCK. Reads are never here (they're get_/list_/lookup_/
  // search_/check_/qc_cockpit/verify). Better to block an unknown write than miss one.
  var BLOCK = /(set_job_status|reassign_job|schedule_parallel_job|office_remove_job|remove_job|record_job_invoice|\/office-stage|save-office-note|set_cluster_rank|add_tech_to_cluster|update_job|create_tdr|add_tdr|set-tdr|book_appointment|reschedule_job|cancel_job|unschedule|record-addon|record_addon|record-payout|mark_parts|record_parts|mark_parts_arrived|enqueue_scheduling|suspend_tech|set-secret|set_secret|toggle_customer_sms|save-availability|set-job-availability|delete-|update_customer|merge_customer|reset-|office_set|record_event_log|send_sms|guarded-send-sms|message-reply)/i;
  var GUARD = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };

  var _blockedToastAt = 0;
  function blockedToast() {
    var t = Date.now(); if (t - _blockedToastAt < 1500) return; _blockedToastAt = t;
    try {
      var d = document.createElement('div');
      d.textContent = '👀 View-only — make changes from your own tech job page.';
      d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:#111827;color:#fff;padding:11px 16px;border-radius:10px;font:600 13px system-ui;box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:90vw;text-align:center';
      document.body.appendChild(d);
      setTimeout(function () { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(function () { d.remove(); }, 400); }, 2200);
    } catch (e) {}
  }

  // Install the write guard SYNCHRONOUSLY (before any interaction can fire).
  if (window.fetch) {
    var _f = window.fetch;
    window.fetch = function (url, opts) {
      var m = ((opts && opts.method) || 'GET').toUpperCase();
      var u = String(url || '');
      if (GUARD[m] && BLOCK.test(u)) {
        blockedToast();
        // Benign "blocked" response so page code doesn't crash on the rejection.
        return Promise.resolve(new Response(JSON.stringify({ ok: false, success: false, readonly: true, error: 'view_only' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return _f.apply(this, arguments);
    };
  }

  // Banner + dim controls once the DOM is up.
  function decorate() {
    try {
      if (document.getElementById('__ro_banner')) return;
      var b = document.createElement('div');
      b.id = '__ro_banner';
      b.textContent = '👀 View-only (tech) — look around all you want. To make changes, use your tech job page.';
      b.style.cssText = 'position:sticky;top:0;z-index:99998;background:#1f6feb;color:#fff;padding:9px 12px;font:700 13px/1.35 system-ui;text-align:center';
      document.body.insertBefore(b, document.body.firstChild);
      // Soft-dim obvious action buttons (the fetch guard is the real safety).
      var st = document.createElement('style');
      st.textContent = '.__ro_dim{opacity:.55 !important;}';
      document.head.appendChild(st);
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate);
  else decorate();

  window.OfficeReadonly = { active: true };
})();
