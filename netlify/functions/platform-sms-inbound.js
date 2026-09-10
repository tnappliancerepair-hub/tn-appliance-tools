// platform-sms-inbound — the inbound text webhook for TENANT numbers.
//
// Until now the only inbound handlers were TN's own (customer-sms-inbound,
// tech-sms-inbound), and both assume TN. Point a tenant's number at either one and
// that shop's customer texts land in TN's threads: their customer, our board. This
// resolves the shop from the number that was DIALED, so the message goes where it
// belongs.
//
// Deliberately narrow. It writes the text into the shop's shared thread and honors
// STOP/START. It does not reply on the shop's behalf, does not touch jobs, and
// cannot throw — a webhook that 500s gets retried, and a retried inbound is a
// duplicate in someone's conversation.
//
// Wire it as the inbound webhook on a Telnyx messaging profile used ONLY by tenant
// numbers. Never point TN's profiles here, and never point tenant numbers at TN's.
'use strict';

const { getSecret } = require('./_lib/secrets');
const thread = require('./_lib/platform-thread');
const smsGuard = require('./_lib/sms-guard');

const TELNYX = 'https://api.telnyx.com/v2';
const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' };

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

function parseTelnyx(event) {
  let p; try { p = JSON.parse(event.body || '{}'); } catch (_) { return null; }
  const data = (p && p.data) || {};
  if ((data.event_type || '') !== 'message.received') return null;
  const pay = data.payload || {};
  const to = Array.isArray(pay.to) ? pay.to : [];
  return {
    from: (pay.from && pay.from.phone_number) || '',
    to: (to[0] && to[0].phone_number) || '',
    body: pay.text || '',
    sid: pay.id || data.id || '',
  };
}

// Which shop owns the number that was dialed? Platform phone numbers are stored in
// mixed formats, so match on the last ten digits rather than the raw string — the
// same rule platform_call_lookup uses for customers. There are a handful of shops,
// so a scan is honest and cheap; revisit if the tenant list ever gets long.
async function companyForDialed(dialed) {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key || !dialed) return null;
  const base = String(url).replace(/\/+$/, '');
  const H = { apikey: key, Authorization: 'Bearer ' + key };
  const r = await fetch(`${base}/rest/v1/company?select=id,name,slug,settings&limit=500`, { headers: H, signal: AbortSignal.timeout(7000) });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  const want = last10(dialed);
  if (!want) return null;
  for (const c of rows || []) {
    const n = c && c.settings && c.settings.phone && c.settings.phone.number;
    if (n && last10(n) === want) return c;
  }
  return null;
}

// Carriers require one confirmation when someone opts out. Send it from the number
// they texted, so the reply comes from the shop they were talking to and not from us.
async function confirmOptOut(fromNumber, toNumber, text) {
  try {
    const key = process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'));
    if (!key) return false;
    const r = await fetch(TELNYX + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromNumber, to: toNumber, text }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  try {
    const m = parseTelnyx(event);
    if (!m || !m.from) return OK;

    const company = await companyForDialed(m.to);
    if (!company) {
      // A number nobody claims. Log loudly and stop — guessing a company here is how
      // one shop's customer ends up in another shop's conversation.
      console.warn('[platform-sms-inbound] no company owns dialed number', { to: m.to, from_last4: last10(m.from).slice(-4) });
      return OK;
    }

    const word = String(m.body || '').trim().toUpperCase();
    const shopName = company.name || 'this business';

    if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|REMOVE)$/.test(word)) {
      // Suppress globally rather than per shop. Over-suppressing costs a message;
      // under-suppressing texts someone who told us to stop.
      try { await smsGuard.recordOptOut(m.from, 'platform_sms_stop'); } catch (_) {}
      await confirmOptOut(m.to, m.from, `You are unsubscribed from ${shopName} texts and will get no more. Reply START to resume.`);
      try { await thread.teeInbound({ phone: m.from, body: m.body, channel: 'sms', companyId: company.id }); } catch (_) {}
      return OK;
    }

    if (/^(START|UNSTOP|RESUBSCRIBE|OPTIN)$/.test(word)) {
      try { await smsGuard.clearOptOut(m.from, 'platform_sms_start'); } catch (_) {}
      await confirmOptOut(m.to, m.from, `You are re-subscribed to ${shopName} texts. Reply STOP anytime to opt out.`);
      try { await thread.teeInbound({ phone: m.from, body: m.body, channel: 'sms', companyId: company.id }); } catch (_) {}
      return OK;
    }

    if (/^HELP$/.test(word)) {
      await confirmOptOut(m.to, m.from, `${shopName}: reply STOP to stop receiving texts. Msg&data rates may apply.`);
    }

    const res = await thread.teeInbound({ phone: m.from, body: m.body, channel: 'sms', companyId: company.id });
    console.log('[platform-sms-inbound]', { company: company.slug || company.id, teed: !!(res && res.ok), reason: (res && res.reason) || null });
    return OK;
  } catch (e) {
    // Never surface an error to Telnyx: a non-200 gets redelivered, and a redelivered
    // inbound is the same message twice in a customer's thread.
    console.error('[platform-sms-inbound] swallowed', (e && e.message) || e);
    return OK;
  }
};
