// ant-push.js — registers the device for push when running inside the native
// (Capacitor) app, and sends the token to register-push-token. In a normal
// browser this is a NO-OP, so it's safe to include on every tech page.
(function () {
  var Cap = window.Capacitor;
  if (!Cap || (Cap.isNativePlatform && !Cap.isNativePlatform())) return; // browser → nothing to do
  var PN = Cap.Plugins && Cap.Plugins.PushNotifications;
  if (!PN) return;
  var FN = 'https://tnapplianceexchange.net/.netlify/functions/register-push-token';
  function techId() { try { return parseInt(localStorage.getItem('tn_tech_id'), 10) || 0; } catch (_) { return 0; } }
  function platform() { try { return (Cap.getPlatform && Cap.getPlatform()) || 'android'; } catch (_) { return 'android'; } }

  try {
    PN.addListener('registration', function (t) {
      var id = techId(); if (!id || !t || !t.value) return;
      fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech_id: id, token: t.value, platform: platform() }) }).catch(function () {});
    });
    // Tapping a push opens the app to the tech's day (the dashboard handles routing).
    PN.addListener('pushNotificationActionPerformed', function () {
      try { location.href = '/tech.html'; } catch (_) {}
    });
    PN.requestPermissions().then(function (r) { if (r && r.receive === 'granted') PN.register(); }).catch(function () {});
  } catch (_) {}
})();
