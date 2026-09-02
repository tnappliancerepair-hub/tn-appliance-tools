// setup-bypass — TEMPORARY, flag-gated auto-login for the demo seats (office + tech).
//
// WHY: while we're building/polishing the demo (bouncing in and out of every surface for hours),
// a login screen on each page is pure friction. Naively removing the auth gate would BREAK the
// pages — the data is RLS-scoped to the authenticated user, so an anonymous client returns an
// EMPTY board. So instead of removing the gate, this silently establishes the right demo session
// (RLS then resolves + data loads) with no login screen.
//
// ROLE-AWARE: the tech surfaces (tech.html / tech-job.html) sign in as the demo TECHNICIAN so the
// day view + pay are properly tech-scoped; every other seat signs in as the demo OWNER. Because a
// Supabase session is per-origin, crossing office<->tech switches the session (a quick reload);
// bouncing within a role is seamless.
//
// TOGGLE (one place): NO-OP unless window.ANT_SETUP_BYPASS is true (set in config.js). Flip that
// flag to false / delete the line = "put the logins back" across every page in one edit.
//
// SAFETY: force-targets the synthetic DEMO tenant only (can never surface a real customer's data);
// a circuit-breaker guard means a failed sign-in falls back to the page's own login instead of
// reload-looping; entirely try/caught so it can never break a page. Remove this file + the flag
// before real customers exist (folds into the self-serve-signup go-live sequence).
//
// Loads in the head AFTER config.js (window.ANT_SUPABASE + the flag) and vendor/supabase-js.js
// (window.supabase). Its own throwaway client shares localStorage with the page's client, so a
// successful sign-in + one reload lets the page's own gate find the session (no login form).
(function () {
  'use strict';
  try {
    if (!window.ANT_SETUP_BYPASS) return;                        // flag off => inert
    var cfg = window.ANT_SUPABASE;
    if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) return;

    // pick the demo login for THIS page: tech surfaces -> demo tech, everything else -> demo owner
    var path = (location.pathname || '').toLowerCase();
    var isTech = /\/tech\.html$|\/tech-job\.html$/.test(path);
    var target = isTech
      ? { email: 'demo-tech@assistant247.net', password: 'Ant-v77hr393' }
      : { email: 'demo@assistant247.net', password: 'Ant-lp1xvv89' };
    var want = target.email.toLowerCase();
    var GUARD = 'ant_bypass_fail';                               // circuit-breaker (only trips on a failed sign-in)

    var sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    sb.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      var cur = sess && sess.user && (sess.user.email || '').toLowerCase();
      if (sess && cur === want) {                                // already the right login for this page
        try { sessionStorage.removeItem(GUARD); } catch (_) {}   // clear the breaker so a later switch can run
        return;                                                  // let the page's own gate boot
      }
      try { if (sessionStorage.getItem(GUARD)) return; } catch (_) {}   // a prior sign-in failed — fall back to the page login
      try { sessionStorage.setItem(GUARD, '1'); } catch (_) {}

      var signIn = function () {
        return sb.auth.signInWithPassword(target).then(function (res) {
          if (res && !res.error) { try { sessionStorage.removeItem(GUARD); } catch (_) {} try { location.reload(); } catch (_) {} }
        });
      };
      if (sess && cur && cur !== want) {                         // signed in as the WRONG demo role for this page — switch
        sb.auth.signOut().then(signIn).catch(signIn);
      } else {
        signIn();
      }
    }).catch(function () {});
  } catch (_) { /* never let the setup shim break a page */ }
})();
