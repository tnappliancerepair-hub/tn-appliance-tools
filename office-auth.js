// office-auth.js — ONE office login for every page. (Teddy 2026-07-01: "there
// should be one login. Once you're in, you're in.")
//
// The problem: office pages historically used 4 different localStorage keys for
// the same login — timestamp keys (tn_office_auth_v1, office_auth_v1) and
// password keys (tn_office_auth, ant_office_pw). A login on one family didn't
// satisfy a page checking another, so you re-entered the password constantly.
//
// The fix: load this FIRST in <head> on every office page. It (1) mirrors a
// successful login to ALL known keys, (2) captures the password whenever any
// login happens (via the verify fetch OR a direct setItem), and (3) on every
// page load, if you're already logged in, refreshes + mirrors so THIS page's
// gate finds its key and never prompts. One login, 30-day rolling session,
// cleared only on logout.
(function () {
  var TTL = 30 * 24 * 3600 * 1000;                      // 30-day rolling session
  var TS_KEYS = ['tn_office_auth_v1', 'office_auth_v1']; // store a timestamp
  var PW_KEYS = ['tn_office_auth', 'ant_office_pw'];     // store the password
  var ALL = TS_KEYS.concat(PW_KEYS);
  var SESSION = 'tn_office_session_v1';

  // Grab the REAL localStorage methods before we patch them (avoid recursion).
  var _set, _remove;
  try {
    _set = Storage.prototype.setItem.bind(localStorage);
    _remove = Storage.prototype.removeItem.bind(localStorage);
  } catch (e) { return; } // no localStorage → nothing to do

  function now() { return Date.now(); }

  function readSession() {
    try { var s = JSON.parse(localStorage.getItem(SESSION) || 'null'); if (s && s.ts && (now() - s.ts < TTL)) return s; } catch (e) {}
    return null;
  }
  function findPw() {
    for (var i = 0; i < PW_KEYS.length; i++) {
      var v = localStorage.getItem(PW_KEYS[i]);
      if (v && v !== 'null' && v.length >= 3) return v;
    }
    var s = readSession();
    return (s && s.pw) || null;
  }
  function isLoggedIn() {
    if (readSession()) return true;
    if (findPw()) return true;
    for (var i = 0; i < TS_KEYS.length; i++) {
      var t = parseInt(localStorage.getItem(TS_KEYS[i]), 10);
      if (t && (now() - t < TTL)) return true;
    }
    return false;
  }
  var _establishing = false;
  function establish(pw) {
    if (_establishing) return;               // guard against setItem-hook recursion
    _establishing = true;
    try {
      pw = pw || findPw() || '';
      var ts = now();
      try { _set(SESSION, JSON.stringify({ pw: pw, ts: ts })); } catch (e) {}
      // Pages use these keys as their GATE FLAG and check `=== '1'` — so write
      // '1', not a timestamp. Writing a timestamp here is exactly what made every
      // page re-prompt (a page's `getItem(key) === '1'` never matched a
      // timestamp). The 30-day TTL lives in SESSION (above), not in these keys.
      TS_KEYS.forEach(function (k) { try { _set(k, '1'); } catch (e) {} });
      if (pw) PW_KEYS.forEach(function (k) { try { _set(k, pw); } catch (e) {} });
    } finally { _establishing = false; }
  }
  function clearAll() {
    try { _remove(SESSION); } catch (e) {}
    ALL.forEach(function (k) { try { _remove(k); } catch (e) {} });
  }

  // Hook setItem: any page setting an auth key (a login) propagates to all keys.
  try {
    localStorage.setItem = function (k, v) {
      _set(k, v);
      if (!_establishing && ALL.indexOf(k) !== -1) {
        var pw = (PW_KEYS.indexOf(k) !== -1 && v && v !== 'null') ? v : findPw();
        establish(pw);
      }
    };
    // Hook removeItem: a logout button clearing one auth key logs out everywhere.
    localStorage.removeItem = function (k) {
      _remove(k);
      if (ALL.indexOf(k) !== -1) clearAll();
    };
  } catch (e) {}

  // Hook fetch: capture the password from a successful office-password verify,
  // so even a timestamp-only login flow populates the password keys.
  if (window.fetch) {
    var _fetch = window.fetch;
    window.fetch = function (url, opts) {
      var pw = null;
      try {
        if (opts && opts.body && typeof opts.body === 'string' && /verify_office_password/.test(String(url))) {
          var b = JSON.parse(opts.body); pw = b && b.password;
        }
      } catch (e) {}
      var p = _fetch.apply(this, arguments);
      if (pw) {
        try {
          p.then(function (r) {
            try { r.clone().json().then(function (d) { if (d && (d.success === true || d.ok === true || d.valid === true)) establish(pw); }).catch(function () {}); } catch (e) {}
          }).catch(function () {});
        } catch (e) {}
      }
      return p;
    };
  }

  // On load: already logged in? refresh + mirror so this page's gate is satisfied.
  if (isLoggedIn()) establish(findPw());

  window.OfficeAuth = { logout: clearAll, establish: establish, isLoggedIn: isLoggedIn, password: findPw };
})();
