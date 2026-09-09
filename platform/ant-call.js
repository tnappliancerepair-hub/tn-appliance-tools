/* ant-call.js — one-tap "call this customer" for the Ant platform (Supabase).
 *
 * Drop <script src="/platform/ant-call.js"></script> on any page that shows a customer's
 * phone number and call AntCall.call({to, name, job_id}).
 *
 * What actually happens: we ring the SEAT'S OWN CELL first, and once they pick up we bridge
 * them to the customer with the SHOP'S number as caller ID. So the tech/office person uses
 * whatever phone is already in their pocket, the customer sees the business (not a stranger's
 * cell), and nobody has to install anything or grant microphone permission.
 *
 * Deliberately NOT a browser softphone: that needs a hand-made SIP credential per person and
 * drops its registration the second a phone backgrounds the tab. This works on any phone.
 */
(function () {
  if (window.AntCall) return;
  var cfg = window.ANT_SUPABASE || {};
  var sb = null;

  function client() {
    if (sb) return sb;
    if (!window.supabase || !cfg.url || !cfg.anonKey) return null;
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    return sb;
  }
  function token() {
    return new Promise(function (res) {
      var c = client();
      if (!c) return res('');
      c.auth.getSession().then(function (s) {
        res((s && s.data && s.data.session && s.data.session.access_token) || '');
      }).catch(function () { res(''); });
    });
  }

  function toast(msg, kind) {
    var el = document.getElementById('antcall-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'antcall-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;' +
        'max-width:min(440px,92vw);padding:13px 16px;border-radius:12px;font:600 14px/1.45 -apple-system,' +
        'BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.28);' +
        'text-align:center;opacity:0;transition:opacity .18s ease';
      document.body.appendChild(el);
    }
    var ok = kind !== 'err';
    el.style.background = ok ? '#0f2f1c' : '#3a1414';
    el.style.color = ok ? '#a9f0c6' : '#ffc9c9';
    el.style.border = '1px solid ' + (ok ? 'rgba(80,220,140,.35)' : 'rgba(255,120,120,.35)');
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, kind === 'err' ? 7000 : 4800);
  }

  function post(doo, payload) {
    return token().then(function (tok) {
      if (!tok) return { ok: false, error: 'signed_out', message: 'Sign in again to place calls.' };
      return fetch('/.netlify/functions/platform-voice?do=' + doo, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ access_token: tok }, payload || {})),
      }).then(function (r) { return r.json(); })
        .catch(function () { return { ok: false, error: 'network', message: 'Could not reach the phone system.' }; });
    });
  }

  var AntCall = {
    status: function () { return post('status', {}); },

    // { to, name?, job_id? }
    call: function (opts) {
      var o = opts || {};
      var to = String(o.to || '').trim();
      if (!to) { toast('No phone number on file for this customer.', 'err'); return Promise.resolve({ ok: false }); }
      var who = o.name ? String(o.name).trim().split(/\s+/)[0] : 'them';
      toast('Calling your phone…');
      return post('call', { to: to, name: o.name || '', job_id: o.job_id || null }).then(function (d) {
        if (d && d.ok && d.shadow) {
          toast('Calling is not switched on for this shop yet.', 'err');
        } else if (d && d.ok) {
          toast('📞 Answer your phone — connecting you to ' + who + '.');
        } else {
          toast((d && d.message) || 'Could not start the call.', 'err');
        }
        return d;
      });
    },

    // Renders a button you can append anywhere. Same behavior as .call().
    button: function (opts) {
      var o = opts || {};
      var b = document.createElement('button');
      b.type = 'button';
      b.className = o.className || 'antcall-btn';
      b.textContent = o.label || '📞 Call';
      if (!o.className) {
        b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:10px;' +
          'border:1px solid rgba(120,200,160,.4);background:rgba(60,170,110,.16);color:#8fe6b8;' +
          'font:600 13px/1 inherit;cursor:pointer';
      }
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        b.disabled = true;
        AntCall.call(o).then(function () { setTimeout(function () { b.disabled = false; }, 2500); });
      });
      return b;
    },
  };

  // Upgrade existing "tel:" links in place. Mark one <a class="antcall" href="tel:...">
  // and it routes through the shop line instead of the seat's own phone — but if calling
  // isn't switched on for this shop yet, it just falls through to the plain tel: link, so
  // the button never gets WORSE than it was before.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a.antcall[href^="tel:"]');
    if (!a) return;
    e.preventDefault();
    var to = decodeURIComponent(a.getAttribute('href').slice(4));
    var name = a.getAttribute('data-name') || '';
    var job = a.getAttribute('data-job') || null;
    AntCall.call({ to: to, name: name, job_id: job }).then(function (d) {
      var usable = d && d.ok && !d.shadow;
      if (!usable) window.location.href = a.getAttribute('href');   // fall back to their own phone
    });
  }, true);

  window.AntCall = AntCall;
})();
