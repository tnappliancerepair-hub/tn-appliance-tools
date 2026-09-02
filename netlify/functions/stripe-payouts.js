// stripe-payouts — the PAYOUT (bank-deposit) reconciler for the office.
//
// Stripe emails "$52.99 is on the way" when a batch of customer card payments settles to the
// bank. The email doesn't say WHICH customers/jobs are inside it, so the office can't reconcile
// it or pay the techs their cut. This opens each payout up:
//   payout → its balance transactions → each charge → the job (via metadata.job_id) → the
//   customer + tech + the tech's commission (office_invoice_logged.tech_pay) minus what's
//   already been paid out (tech_payout_recorded).
//
//   GET/POST ?do=list  [&limit=25]                 -> recent payouts (id, amount, arrival, status)
//   GET/POST ?do=breakdown&payout=po_...           -> full breakdown of one payout
//
// Auth: the office password (?pw= / body.password, verified via Xano verify_office_password) OR
// the admin secret (?secret=VAPI_ADMIN_SECRET). Read-only; paying a tech is the existing
// record-payout endpoint, called from the page.
'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JSON_H = { 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: JSON_H, body: JSON.stringify(b) }; }
function cents(n) { return Math.round((Number(n) || 0)); }
function dollars(c) { return (Number(c) || 0) / 100; }

async function officeOk(pw) {
  if (!pw) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => null);
    return !!(d && d.success === true);
  } catch (_) { return false; }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const g = (k) => (body[k] != null ? body[k] : q[k]);

  // ---- auth: admin secret OR office password ----
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const isAdmin = adminSecret && String(g('secret') || '') === String(adminSecret);
  if (!isAdmin) {
    const ok = await officeOk(String(g('pw') || g('password') || ''));
    if (!ok) return json(401, { ok: false, error: 'unauthorized' });
  }

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(200, { ok: false, error: 'no STRIPE_SECRET_KEY in vault/env' });
  const stripe = new Stripe(key);
  const live = /^sk_live/.test(String(key));
  const doo = String(g('do') || 'list');

  try {
    if (doo === 'list') {
      const limit = Math.min(50, Math.max(1, parseInt(g('limit') || '25', 10)));
      const list = await stripe.payouts.list({ limit });
      const payouts = list.data.map((p) => ({
        id: p.id,
        amount: dollars(p.amount),
        currency: p.currency,
        status: p.status,                                   // paid | pending | in_transit | canceled | failed
        arrival: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
        created: p.created ? new Date(p.created * 1000).toISOString() : null,
        bank: (p.destination && typeof p.destination === 'object') ? (p.destination.bank_name || p.destination.last4) : null,
        automatic: !!p.automatic,
      }));
      return json(200, { ok: true, live, count: payouts.length, payouts });
    }

    if (doo === 'breakdown') {
      const payoutId = String(g('payout') || '').trim();
      if (!/^po_/.test(payoutId)) return json(200, { ok: false, error: 'need a payout id (po_…)' });
      const payout = await stripe.payouts.retrieve(payoutId);

      // 1) walk the payout's balance transactions (paginate, expand the source charge)
      const txns = [];
      let starting_after;
      for (let page = 0; page < 6; page++) {                // cap ~600 txns (payouts are small)
        const args = { payout: payoutId, limit: 100, expand: ['data.source'] };
        if (starting_after) args.starting_after = starting_after;
        const bt = await stripe.balanceTransactions.list(args);
        txns.push(...bt.data);
        if (!bt.has_more || !bt.data.length) break;
        starting_after = bt.data[bt.data.length - 1].id;
      }

      // 2) turn charge txns into line items; find the job via charge / PI metadata
      const charges = [];
      let feeCents = 0, refundCents = 0, otherCents = 0;
      const piCache = {};
      for (const t of txns) {
        feeCents += cents(t.fee);
        if (t.type === 'charge' || t.type === 'payment') {
          const ch = t.source && typeof t.source === 'object' ? t.source : null;
          let meta = (ch && ch.metadata) || {};
          let jobId = String(meta.job_id || '').trim();
          const piId = ch && ch.payment_intent ? (typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent.id) : '';
          // metadata lives on the PaymentIntent, not always the charge — fetch the PI if job_id is missing
          if (!jobId && piId) {
            try { const pi = piCache[piId] || (piCache[piId] = await stripe.paymentIntents.retrieve(piId)); meta = pi.metadata || meta; jobId = String((pi.metadata && pi.metadata.job_id) || '').trim(); } catch (_) {}
          }
          charges.push({
            charge_id: ch ? ch.id : t.id,
            gross: dollars(t.amount),
            fee: dollars(t.fee),
            net: dollars(t.net),
            job_id: jobId || '',
            kind: String(meta.kind || ''),
            tip: dollars(cents(meta.tip_cents)),
            name: String(meta.name || (ch && ch.billing_details && ch.billing_details.name) || ''),
            created: t.created ? new Date(t.created * 1000).toISOString() : null,
          });
        } else if (t.type === 'refund' || t.type === 'payment_refund') {
          refundCents += cents(t.amount);          // negative
        } else if (t.type !== 'payout') {
          otherCents += cents(t.amount);
        }
      }

      // 3) resolve jobs -> customer + tech + commission
      const jobMap = {}, techName = {};
      try { const techs = await crud.searchPage(crud.TABLES.technicians, {}, { id: 'asc' }, 100); (techs || []).forEach((t) => { techName[String(t.id)] = ((t.first_name || t.name || '') + ' ' + (t.last_name || '')).trim() || ('Tech ' + t.id); }); } catch (_) {}
      async function getJob(jid) { jid = String(jid || ''); if (!jid) return null; if (jobMap[jid] !== undefined) return jobMap[jid]; try { jobMap[jid] = (await crud.searchOne(crud.TABLES.jobs, { id: parseInt(jid, 10) })) || null; } catch (_) { jobMap[jid] = null; } return jobMap[jid]; }
      function custName(j, fallback) { if (!j) return fallback || 'Customer'; const f = j.customer_first || (j.customer && j.customer.first_name) || ''; const l = j.customer_last || (j.customer && j.customer.last_name) || ''; return (f + ' ' + l).trim() || fallback || 'Customer'; }
      function lastTok(s) { const p = String(s || '').trim().split(/\s+/).filter(Boolean); return p.length ? p[p.length - 1].toLowerCase().replace(/[^a-z]/g, '') : ''; }

      // pull recent invoice logs + payout records once, filter in JS (Xano single-field search)
      let invLogs = [], payoutLogs = [];
      try { invLogs = await crud.searchPage(crud.TABLES.event_log, { action: 'office_invoice_logged' }, { created_at: 'desc' }, 800); } catch (_) {}
      try { payoutLogs = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_payout_recorded' }, { created_at: 'desc' }, 800); } catch (_) {}
      const invByJob = {}, paidByJob = {}, invAll = [];
      (invLogs || []).forEach((r) => { const m = r.metadata || {}; const jid = String(m.job_id || ''); if (!jid) return; if (!invByJob[jid]) invByJob[jid] = m; invAll.push({ job_id: jid, technician_id: String(m.technician_id || ''), tech_pay: parseFloat(m.tech_pay) || 0, amount: parseFloat(m.amount_invoiced) || 0, at: parseInt(m.logged_at_ms, 10) || 0 }); });
      (payoutLogs || []).forEach((r) => { const m = r.metadata || {}; const jid = String(m.job_id || ''); if (jid) paidByJob[jid] = (paidByJob[jid] || 0) + (parseFloat(m.amount) || 0); });

      // best-guess for a charge with NO job_id: an invoice whose total ≈ what the customer paid,
      // preferring one whose customer last-name matches the card's billing name. Marked 'guess' so
      // Danielle verifies before paying — never auto-applied.
      async function guessJob(gross, billName) {
        const near = invAll.filter((i) => i.amount > 0 && Math.abs(i.amount - gross) <= 1.0);
        if (!near.length) return null;
        near.sort((a, b) => (Math.abs(a.amount - gross) - Math.abs(b.amount - gross)) || (b.at - a.at));
        const want = lastTok(billName);
        for (const cand of near.slice(0, 8)) {                 // check the closest few for a name hit
          const j = await getJob(cand.job_id);
          const nm = custName(j, '');
          if (want && lastTok(nm) === want) return { inv: cand, job: j, conf: 'name+amount' };
        }
        const top = near[0]; const j = await getJob(top.job_id);   // else the closest amount, low confidence
        return { inv: top, job: j, conf: 'amount' };
      }

      const matched = [], unmatched = [];
      for (const c of charges) {
        let inv = c.job_id ? invByJob[c.job_id] : null;
        let j = c.job_id ? await getJob(c.job_id) : null;
        let matchType = (c.job_id && (inv || j)) ? 'exact' : '';
        let jobId = c.job_id, techPay = inv ? (parseFloat(inv.tech_pay) || 0) : 0, tId = String((inv && inv.technician_id) || (j && j.technician_id) || '');
        if (!matchType && c.kind !== 'tip') {                  // no metadata job -> try a guess
          const g2 = await guessJob(c.gross, c.name);
          if (g2 && g2.inv) { matchType = 'guess'; jobId = g2.inv.job_id; j = g2.job; techPay = g2.inv.tech_pay; tId = String(g2.inv.technician_id || (g2.job && g2.job.technician_id) || ''); c.conf = g2.conf; }
        }
        if (!matchType) { unmatched.push(c); continue; }
        const cust = custName(j, c.name);
        const alreadyPaid = paidByJob[jobId] || 0;
        matched.push({
          charge_id: c.charge_id, job_id: jobId, kind: c.kind, gross: c.gross, fee: c.fee, net: c.net,
          match: matchType, confidence: c.conf || 'exact',
          customer: cust,
          appliance: (j && (j.appliance_type || (j.appliance && j.appliance.type))) || '',
          tech_id: tId ? parseInt(tId, 10) : null,
          tech_name: tId ? (techName[tId] || ('Tech ' + tId)) : '',
          tech_pay: techPay,                                  // commission owed for this job (from the invoice)
          already_paid: alreadyPaid,
          owed: Math.max(0, techPay - alreadyPaid),
          has_invoice: matchType === 'exact' ? !!inv : true,
          created: c.created,
        });
      }

      return json(200, {
        ok: true, live,
        payout: {
          id: payout.id, amount: dollars(payout.amount), status: payout.status,
          arrival: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
          currency: payout.currency,
        },
        totals: {
          gross: matched.reduce((s, m) => s + m.gross, 0) + unmatched.reduce((s, u) => s + u.gross, 0),
          fees: dollars(feeCents), refunds: dollars(refundCents), other: dollars(otherCents),
          net_deposited: dollars(payout.amount),
          tech_owed: matched.reduce((s, m) => s + m.owed, 0),
        },
        charges: matched, unmatched,
      });
    }

    return json(400, { ok: false, error: 'unknown do: ' + doo });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
