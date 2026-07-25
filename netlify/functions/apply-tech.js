// apply-tech — receives a tech-career application from careers.html (any language),
// logs it to event_log, and texts the owner + Danielle internally (role=technician,
// so it bypasses the customer intake-only gate — this is an internal alert).
//   POST { name, phone, area, experience, note, language }
'use strict';
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
function s(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 400); }

const OWNER = '+16154855795';     // Teddy
const DANIELLE = '+16154850713';  // Danielle
const LANG_NAME = { es: 'Spanish', vi: 'Vietnamese', ar: 'Arabic', hi: 'Hindi', fr: 'French', en: 'English' };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const name = s(b.name, 80);
  const phone = s(b.phone, 24);
  const area = s(b.area, 80);
  const experience = s(b.experience, 60);
  const note = s(b.note, 500);
  const language = (s(b.language, 8) || 'en').toLowerCase();
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2) return json(400, { ok: false, error: 'name required' });
  if (digits.length < 10) return json(400, { ok: false, error: 'valid phone required' });

  const langLabel = LANG_NAME[language] || language;
  try { await crud.logEvent('tech_application', { name, phone, area, experience, note, language, lang_label: langLabel, at_ms: Date.now() }); } catch (_) {}

  const langLine = language && language !== 'en' ? `\n🌐 Prefers: ${langLabel}` : '';
  const msg = `🔧 NEW TECH APPLICATION\n${name} · ${phone}\n📍 ${area || '—'}\n💼 ${experience || '—'}${langLine}${note ? `\n📝 ${note}` : ''}\nCall them back today.`;

  const results = {};
  try { results.owner = await sendSms(OWNER, msg, 'technician', 'tech_application'); } catch (e) { results.owner = String((e && e.message) || e); }
  try { results.danielle = await sendSms(DANIELLE, msg, 'technician', 'tech_application'); } catch (e) { results.danielle = String((e && e.message) || e); }

  return json(200, { ok: true, logged: true, language: langLabel });
};
