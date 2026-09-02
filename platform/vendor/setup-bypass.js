// setup-bypass — TEMPORARY, flag-gated auto-login for the office seats.
//
// WHY: while Teddy + Danielle are lining up the office board (bouncing in and out of every
// office surface for hours), a login screen on each page is pure friction. Naively removing
// the auth gate would BREAK the pages — the data is RLS-scoped to the authenticated user, so
// an anonymous client returns an EMPTY board. So instead of removing the gate, this silently
// establishes the demo owner's session (RLS then resolves + data loads) with no login screen.
//
// TOGGLE (one place): it is a NO-OP unless window.ANT_SETUP_BYPASS is true (set in config.js).
// Flip that flag to false / delete the line = "put the logins back" across every page in one edit.
//
// SAFETY: only acts when there is NO session (never clobbers a real login); force-targets the
// DEMO owner only (can never surface a real customer's tenant); once-per-tab guard so a failed
// sign-in can't reload-loop; entirely try/caught so it can never break a page. The demo creds
// below are for the synthetic demo tenant only — remove this file + the flag before real
// customers exist (folds into the self-serve-signup go-live sequence).
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
    var sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    sb.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) return;                 // already signed in — do nothing
      try { if (sessionStorage.getItem('ant_bypass_done')) return; } catch (_) {}
      try { sessionStorage.setItem('ant_bypass_done', '1'); } catch (_) {}
      sb.auth.signInWithPassword({
        email: 'demo@assistant247.net',
        password: 'Ant-lp1xvv89'
      }).then(function (res) {
        if (!res || !res.error) { try { location.reload(); } catch (_) {} }
      }).catch(function () {});
    }).catch(function () {});
  } catch (_) { /* never let the setup shim break a page */ }
})();
