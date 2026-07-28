// office-identity.js — per-person office sign-in, layered on the shared office login.
// Each staffer taps their name + PIN ONCE on their device → their work is stamped
// with THEIR name (not the hardcoded "Danielle"). Per-device (localStorage), 30-day.
// Non-disruptive: if nobody signs in, attribution falls back to today's default,
// so an existing session isn't interrupted. Sofia signs in on her device = "Sofia".
(function () {
  var KEY = 'tn_office_actor';
  var TTL = 30 * 24 * 60 * 60 * 1000;
  var F = '/.netlify/functions';

  function read() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.ts && (Date.now() - s.ts < TTL) && s.name) return s; } catch (e) {}
    return null;
  }
  function write(name, role) { try { localStorage.setItem(KEY, JSON.stringify({ name: name, role: role || 'office', ts: Date.now() })); } catch (e) {} }

  window.OfficeStaff = {
    name: function () { var s = read(); return s ? s.name : ''; },
    role: function () { var s = read(); return s ? s.role : ''; },
    isOwner: function () { var s = read(); return !!(s && s.role === 'owner'); },
    signOut: function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); },
    signIn: openPicker,
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  async function openPicker(force) {
    if (!force && read()) return;
    var box = document.createElement('div');
    box.id = 'office-id-gate';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,9,14,.86);display:flex;align-items:center;justify-content:center;padding:18px;font:16px/1.4 -apple-system,system-ui,sans-serif';
    box.innerHTML = '<div style="background:#141922;border:1px solid #232c3a;border-radius:16px;max-width:380px;width:100%;padding:20px;color:#eef2f8">'
      + '<div style="font-size:19px;font-weight:800;margin-bottom:3px">Who\'s working?</div>'
      + '<div id="oid-msg" style="color:#9fb0c8;font-size:13px;margin-bottom:14px">Tap your name, then your PIN.</div>'
      + '<div id="oid-names" style="display:flex;flex-wrap:wrap;gap:8px"></div>'
      + '<div id="oid-pin" style="display:none;margin-top:14px">'
      + '  <input id="oid-pinin" inputmode="numeric" maxlength="6" placeholder="Your PIN" style="width:100%;padding:14px;border-radius:11px;border:1px solid #232c3a;background:#0f141c;color:#eef2f8;font-size:20px;text-align:center;letter-spacing:.3em">'
      + '  <button id="oid-go" style="width:100%;margin-top:10px;padding:14px;border:0;border-radius:11px;background:#2ecc71;color:#053;font-weight:800;font-size:16px">Sign in</button>'
      + '  <div style="text-align:center;margin-top:8px"><a href="#" id="oid-back" style="color:#9fb0c8;font-size:13px;text-decoration:none">← different name</a></div>'
      + '</div></div>';
    document.body.appendChild(box);
    var msg = box.querySelector('#oid-msg'), names = box.querySelector('#oid-names'), pinWrap = box.querySelector('#oid-pin'), pinIn = box.querySelector('#oid-pinin');
    var picked = '';
    try {
      var r = await fetch(F + '/office-staff-verify?list=1'); var d = await r.json();
      (d.staff || []).forEach(function (s) {
        var b = document.createElement('button');
        b.textContent = s.name;
        b.style.cssText = 'padding:12px 16px;border:1px solid #2b3b4f;border-radius:11px;background:#0f1a12;color:#eef2f8;font-weight:700;font-size:16px;cursor:pointer';
        b.onclick = function () { picked = s.name; names.style.display = 'none'; pinWrap.style.display = 'block'; msg.textContent = 'Enter ' + s.name + '’s PIN.'; pinIn.value = ''; pinIn.focus(); };
        names.appendChild(b);
      });
      if (!(d.staff || []).length) { msg.textContent = 'No staff set up yet — ask Teddy.'; }
    } catch (e) { msg.textContent = 'Couldn’t load names — check signal.'; }
    box.querySelector('#oid-back').onclick = function (e) { e.preventDefault(); pinWrap.style.display = 'none'; names.style.display = 'flex'; msg.textContent = 'Tap your name, then your PIN.'; };
    async function submit() {
      var pin = pinIn.value.trim(); if (!pin) return;
      msg.textContent = 'Checking…';
      try {
        var r = await fetch(F + '/office-staff-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: picked, pin: pin }) });
        var d = await r.json();
        if (d && d.ok) { write(d.name, d.role); box.remove(); if (window.__onOfficeIdentity) try { window.__onOfficeIdentity(d.name); } catch (_) {} }
        else { msg.style.color = '#ff5c6c'; msg.textContent = (d && d.error) || 'Wrong PIN.'; pinIn.value = ''; pinIn.focus(); }
      } catch (e) { msg.style.color = '#ff5c6c'; msg.textContent = 'Network error — try again.'; }
    }
    box.querySelector('#oid-go').onclick = submit;
    pinIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  // Optional: pages can show a "signed in as X · switch" chip by calling OfficeStaff.name().
  // Nothing auto-prompts — attribution just defaults until someone signs in.
})();
