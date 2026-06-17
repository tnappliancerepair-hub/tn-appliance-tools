'use strict';
// One-time blast: text each tech their PERMANENT app link (tnapplianceexchange.net/tech?tech_id=X).
// The link sets the device to that tech + opens straight to their day; add-to-home-screen
// turns it into the "Ant" app icon — no more hunting through old texts for the right link.
//
//   GET ?secret=...            -> DRY RUN: shows exactly what each tech would get
//   GET ?secret=...&send=yes    -> actually send
const { sendSms } = require('./_lib/sms');

const SECRET = 'tn-tech-links-2026';
const BASE = 'https://tnapplianceexchange.net/tech';

// Billy (5) left — excluded on purpose.
const TECHS = [
  { id: 2, name: 'Jimmy', phone: '+16159671304' },
  { id: 6, name: 'John',  phone: '+18133527686' },
  { id: 4, name: 'Lee',   phone: '+16158291654' },
  { id: 3, name: 'Andre', phone: '+16159693115' },
  { id: 1, name: 'Teddy', phone: '+16154855795' },
];

function message(t) {
  const link = `${BASE}?tech_id=${t.id}`;
  return (
    `Hey ${t.name}, it's Ant 🐜 — here's your permanent link to your day:\n` +
    `${link}\n\n` +
    `Tap it once, then "Add to Home Screen" so it lives as an app icon. After that just tap Ant — straight to your jobs, photos, and reports. No more digging through texts for the right link.`
  );
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const send = q.send === 'yes';

  const preview = TECHS.map((t) => ({ id: t.id, name: t.name, phone: t.phone, body: message(t) }));
  if (!send) return j(200, { ok: true, dry_run: true, count: preview.length, preview });

  const results = [];
  for (const t of TECHS) {
    const ok = await sendSms(t.phone, message(t), 'technician', 'tech_app_link');
    results.push({ id: t.id, name: t.name, phone: t.phone, sent: ok });
  }
  return j(200, { ok: true, sent: results.filter((r) => r.sent).length, total: results.length, results });
};

function j(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
