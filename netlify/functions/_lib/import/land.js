// _lib/import/land — land a normalized page onto a tenant's board, idempotently.
// Source-agnostic (HCP today, Jobber/Workiz next): every landed record is written to
// import_map (company, source, kind, external_id -> board id), so a re-run skips what's
// already there and FKs (job->customer, job->tech) resolve through the same ledger.
// Uses the platform SERVICE key directly (bypasses RLS) — server-side only.
'use strict';

const { cfg } = require('../platform-rest');

async function conn() {
  const { url, key } = await cfg();
  if (!url || !key) throw new Error('platform not configured');
  const base = url.replace(/\/+$/, '');
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const t = () => AbortSignal.timeout(12000);
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: t() }); return r.ok ? r.json() : []; },
    async insert(table, rows) {
      if (!rows.length) return [];
      const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows), signal: t() });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && (d.message || d.hint)) || (table + ' insert ' + r.status));
      return Array.isArray(d) ? d : [d];
    },
  };
}

const qId = (s) => '"' + String(s).replace(/"/g, '') + '"';
// first-wins dedup by external_id (a source can repeat a record within a page — e.g. Workiz
// derives a customer per job, so one client appears on several jobs in the same batch).
function dedup(records) {
  const seen = new Set(), out = [];
  for (const r of records) { const k = String(r.external_id); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

// external_id -> internal_id for a (source, kind), for the given ids.
async function loadMap(c, companyId, source, kind, ids) {
  const m = new Map();
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  for (let i = 0; i < uniq.length; i += 120) {
    const chunk = uniq.slice(i, i + 120).map(qId).join(',');
    const rows = await c.get(`import_map?company_id=eq.${companyId}&source=eq.${source}&kind=eq.${kind}&external_id=in.(${chunk})&select=external_id,internal_id`);
    for (const r of rows || []) m.set(String(r.external_id), r.internal_id);
  }
  return m;
}

async function recordMap(c, companyId, source, kind, runId, pairs) {
  const rows = pairs.map((p) => ({ company_id: companyId, source, kind, external_id: String(p.ext), internal_id: p.id, run_id: runId }));
  if (rows.length) await c.insert('import_map', rows);
}

// Land technicians or customers (no foreign keys). records: [{external_id,row}]
async function landSimple(kind, table, { companyId, source, runId, records }) {
  const c = await conn();
  records = dedup(records);
  const existing = await loadMap(c, companyId, source, kind, records.map((r) => r.external_id));
  const fresh = records.filter((r) => !existing.has(String(r.external_id)));
  let landed = 0;
  if (fresh.length) {
    const inserted = await c.insert(table, fresh.map((r) => ({ company_id: companyId, ...r.row })));
    await recordMap(c, companyId, source, kind, runId, inserted.map((row, i) => ({ ext: fresh[i].external_id, id: row.id })));
    landed = inserted.length;
  }
  return { landed, skipped: records.length - fresh.length };
}

// Land jobs — resolve customer + technician via the map, then invoices (+ one summary line)
// inline for jobs that carry a total. records: [{external_id,_customer_ext,_tech_ext,row,invoice}]
async function landJobs({ companyId, source, runId, records }) {
  const c = await conn();
  records = dedup(records);
  const existing = await loadMap(c, companyId, source, 'job', records.map((r) => r.external_id));
  const fresh = records.filter((r) => !existing.has(String(r.external_id)));
  const out = { landed: 0, skipped: records.length - fresh.length, invoices: 0, invoice_lines: 0 };
  if (!fresh.length) return out;

  const custMap = await loadMap(c, companyId, source, 'customer', fresh.map((r) => r._customer_ext));
  const techMap = await loadMap(c, companyId, source, 'technician', fresh.map((r) => r._tech_ext));

  const jobRows = fresh.map((r) => ({
    company_id: companyId,
    customer_id: custMap.get(String(r._customer_ext)) || null,
    technician_id: techMap.get(String(r._tech_ext)) || null,
    ...r.row,
  }));
  const insertedJobs = await c.insert('job', jobRows);
  await recordMap(c, companyId, source, 'job', runId, insertedJobs.map((row, i) => ({ ext: fresh[i].external_id, id: row.id })));
  out.landed = insertedJobs.length;

  // invoices inline (job-derived: total + paid status). One summary line each.
  const invSpecs = [];
  fresh.forEach((r, i) => { if (r.invoice) invSpecs.push({ jobId: insertedJobs[i].id, custId: jobRows[i].customer_id, spec: r.invoice, jobExt: r.external_id }); });
  if (invSpecs.length) {
    const invRows = invSpecs.map((s) => ({
      company_id: companyId, job_id: s.jobId, customer_id: s.custId,
      status: s.spec.paid ? 'paid' : 'sent',
      subtotal_cents: s.spec.total_cents, tax_cents: 0, total_cents: s.spec.total_cents,
      collected_cents: s.spec.paid ? s.spec.total_cents : 0,
      paid_at: s.spec.paid ? new Date().toISOString() : null,
      number: s.spec.number,
    }));
    const insertedInv = await c.insert('invoice', invRows);
    out.invoices = insertedInv.length;
    await recordMap(c, companyId, source, 'invoice', runId, insertedInv.map((row, i) => ({ ext: invSpecs[i].spec.external_id, id: row.id })));
    const lineRows = insertedInv.map((row, i) => ({ company_id: companyId, invoice_id: row.id, kind: 'labor', description: invSpecs[i].spec.line_desc, qty: 1, unit_cents: invSpecs[i].spec.total_cents }));
    const insertedLines = await c.insert('invoice_line', lineRows);
    out.invoice_lines = insertedLines.length;
  }
  return out;
}

module.exports = { landSimple, landJobs };
