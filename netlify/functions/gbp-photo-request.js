// gbp-photo-request — weekly text to the field crew asking for 2-3 job photos
// for the Google Business Profile. Photo-fresh profiles rank better in the map
// pack + get more clicks, so this keeps the pipeline fed without Teddy chasing.
// Each tech gets a personal one-tap upload link. Dedups to once per ISO week.
//
//   Scheduled weekly in netlify.toml. ?dryrun=1 to preview. Kill switch:
//   vault GBP_PHOTO_REQUEST=false.
'use strict';
const { sendSms } = require('./_lib/sms');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const EVENT_LOG = 3;
const UPLOAD_BASE = 'https://tnapplianceexchange.net/gbp-photos.html';

// Active field crew (owner #1 excluded — he's the one posting; Billy #5 left).
const CREW = [
  { id: 2, name: 'Jimmy', phone: '+16159671304' },
  { id: 3, name: 'Andre', phone: '+15049099413' },
  { id: 4, name: 'Lee', phone: '+16158291654' },
  { id: 6, name: 'John', phone: '+18133527686' },
];

function isoWeekKey(d) {
  // ISO week number, year-stable enough for a once-a-week dedup key.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return t.getUTCFullYear() + '-W' + wk;
}
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  if (String(await getSecret('GBP_PHOTO_REQUEST') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });

  const wk = isoWeekKey(new Date());

  // dedup: already asked this ISO week?
  if (!dry) {
    try {
      const last = await crud.searchOne(EVENT_LOG, { action: 'gbp_photo_request_sent' }, { id: 'desc' });
      if (last) { let m = last.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } if (m && m.iso_week === wk) return json(200, { ok: true, already_sent_this_week: wk }); }
    } catch (_) {}
  }

  const results = [];
  for (const t of CREW) {
    const link = UPLOAD_BASE + '?tech_id=' + t.id;
    const body = 'Hey ' + t.name + ' — quick one: snap 2-3 photos from a job this week for our Google page (helps us show up for "appliance repair near me" = more work). Tap, add the pics, done: ' + link;
    if (dry) { results.push({ tech: t.name, phone: t.phone, link, body }); continue; }
    const ok = await sendSms(t.phone, body, 'technician', 'gbp_photo_request');
    results.push({ tech: t.name, sent: ok });
  }

  if (dry) return json(200, { ok: true, mode: 'dryrun', iso_week: wk, crew: results });

  try { await crud.insert(EVENT_LOG, { action: 'gbp_photo_request_sent', metadata: { iso_week: wk, at_ms: Date.now(), crew: results.map((r) => r.tech) } }); } catch (_) {}
  return json(200, { ok: true, iso_week: wk, sent: results });
};
