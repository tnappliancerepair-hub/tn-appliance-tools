// ant-webpush.js — one-tap "turn on notifications" for any Ant surface.
// Works on Android Chrome, desktop Chrome/Edge/Safari, and iOS 16.4+ home-screen
// PWAs. window.AntPush.enable(role, uid) / .status(). Safe to include anywhere.
(function () {
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function b64ToU8(s) {
    var pad = '='.repeat((4 - s.length % 4) % 4);
    var b = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b); var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function ensureSW() {
    try { return await navigator.serviceWorker.ready; }
    catch (_) {
      try { await navigator.serviceWorker.register('/sw-tech.js'); return await navigator.serviceWorker.ready; }
      catch (e) { return null; }
    }
  }
  var AntPush = {
    supported: supported,
    async status() {
      if (!supported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      try {
        var reg = await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.getSubscription();
        return sub ? 'on' : 'off';
      } catch (_) { return 'off'; }
    },
    async enable(role, uid) {
      if (!supported()) {
        // iOS Safari (not installed) can't do web push until added to home screen.
        var iOS = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
        alert(iOS
          ? "On iPhone, first add this to your Home Screen (Share button → Add to Home Screen), open it from the icon, then turn on notifications."
          : "This browser doesn't support notifications. Try Chrome.");
        return false;
      }
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Notifications were not allowed. You can re-enable them in your browser settings.'); return false; }
      var reg = await ensureSW();
      if (!reg) { alert('Could not start notifications — reload and try again.'); return false; }
      try {
        var kr = await fetch('/.netlify/functions/web-push-keys'); var kd = await kr.json();
        if (!kd || !kd.publicKey) { alert('Notifications not configured yet — try again shortly.'); return false; }
        var existing = await reg.pushManager.getSubscription();
        var sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(kd.publicKey) });
        await fetch('/.netlify/functions/web-push-register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: role || 'tech', uid: uid || 0, subscription: sub }),
        });
        return true;
      } catch (e) { alert('Could not turn on notifications: ' + (e.message || e)); return false; }
    },
  };
  window.AntPush = AntPush;
})();
