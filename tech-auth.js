// tech-auth.js — ONE tech login for every tech page. (Teddy 2026-07-03: techs
// should log in once a month, not every time they click between pages.)
//
// The problem (same shape as the office had): tech pages gate on DIFFERENT keys
// and formats — the daily dashboard caches the PIN string under
// `tn_tech_pin_v1_<techId>`, while tech-job.html stores `{ok,t}` under
// `tn_tech_auth_<techId>` with a 12-HOUR expiry. So crossing from the dashboard
// to a job re-prompts, and every page re-locks after 12h.
//
// The fix: load this FIRST in <head> on every tech page. On any successful PIN
// verify (captured from the verify-pin-proxy fetch) it opens a 30-day tech
// session and MIRRORS it into every format each page expects; on every page load
// it re-mirrors (refreshing the 12h stamp) so the current page's gate is already
// satisfied and never prompts. One login, 30-day rolling session per tech.
//
// Coexists with office-auth.js (chains the current fetch/setItem, doesn't clobber).
(function () {
  var TTL = 30 * 24 * 3600 * 1000;              // 30-day rolling session
  var SESSION = 'tn_tech_session_v1';           // {tech_id, pin, ts}

  var _set, _remove, _fetch;
  try {
    _set = localStorage.setItem.bind(localStorage);       // current (may be office-auth's) — chain it
    _remove = localStorage.removeItem.bind(localStorage);
  } catch (e) { return; }
  function now() { return Date.now(); }

  function techId() {
    try { var u = new URLSearchParams(location.search).get('tech_id'); if (u) return String(u).replace(/\D/g, ''); } catch (e) {}
    try { return (localStorage.getItem('tn_tech_id') || '').replace(/\D/g, ''); } catch (e) { return ''; }
  }
  function readSession() {
    try { var s = JSON.parse(localStorage.getItem(SESSION) || 'null'); if (s && s.ts && (now() - s.ts < TTL)) return s; } catch (e) {}
    return null;
  }

  var _establishing = false;
  function establish(tid, pin) {
    if (_establishing) return;
    _establishing = true;
    try {
      tid = (tid || techId() || '').replace(/\D/g, '');
      var s = readSession() || {};
      pin = pin || s.pin || '';
      var ts = now();
      try { _set(SESSION, JSON.stringify({ tech_id: tid, pin: pin, ts: ts })); } catch (e) {}
      if (tid) {
        try { _set('tn_tech_id', String(tid)); } catch (e) {}
        // dashboard format: the PIN string (it re-verifies against the server).
        if (pin) { try { _set('tn_tech_pin_v1_' + tid, pin); } catch (e) {} }
        // tech-job format: {ok,t} with a fresh stamp so its 12h check passes.
        try { _set('tn_tech_auth_' + tid, JSON.stringify({ ok: true, t: ts })); } catch (e) {}
      }
    } finally { _establishing = false; }
  }
  function clearAll() {
    var tid = techId();
    try { _remove(SESSION); } catch (e) {}
    if (tid) { try { _remove('tn_tech_pin_v1_' + tid); } catch (e) {} try { _remove('tn_tech_auth_' + tid); } catch (e) {} }
  }

  // Hook setItem: a page storing either tech-auth format is a login → establish.
  try {
    localStorage.setItem = function (k, v) {
      _set(k, v);
      if (_establishing) return;
      if (/^tn_tech_pin_v1_/.test(k) && v && v !== 'null') establish(k.replace('tn_tech_pin_v1_', ''), String(v));
      else if (/^tn_tech_auth_/.test(k)) establish(k.replace('tn_tech_auth_', ''), null);
    };
    localStorage.removeItem = function (k) {
      _remove(k);
      if (/^tn_tech_(pin_v1|auth)_/.test(k)) clearAll();
    };
  } catch (e) {}

  // Hook fetch: capture the PIN from a successful verify-pin-proxy so we always
  // have the real pin (the dashboard needs it to re-verify). Chains any existing
  // fetch override (office-auth), so both run regardless of load order.
  if (window.fetch) {
    _fetch = window.fetch;
    window.fetch = function (url, opts) {
      var pin = null, tid = null;
      try {
        if (opts && opts.body && typeof opts.body === 'string' && /verify-pin-proxy/.test(String(url))) {
          var b = JSON.parse(opts.body); pin = b && b.pin; tid = b && (b.technician_id || b.tech_id);
        }
      } catch (e) {}
      var p = _fetch.apply(this, arguments);
      if (pin) {
        try { p.then(function (r) { try { r.clone().json().then(function (d) { if (d && (d.success || d.ok || d.valid)) establish(String(tid || techId()), String(pin)); }).catch(function () {}); } catch (e) {} }).catch(function () {}); } catch (e) {}
      }
      return p;
    };
  }

  // On load: valid session? re-mirror so THIS page's gate is already satisfied.
  var s = readSession();
  if (s) establish(s.tech_id, s.pin);

  window.TechAuth = { logout: clearAll, establish: establish, session: readSession };
})();
