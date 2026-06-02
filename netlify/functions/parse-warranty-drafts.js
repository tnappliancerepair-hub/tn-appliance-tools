// parse-warranty-drafts — scheduled Netlify function that picks up
// email_generic_warranty drafts with placeholder customers, asks Claude
// (Haiku for speed) to extract structured fields from the raw email
// body in notes_internal, and POSTs back via update_warranty_draft_parsed.
//
// Schedule: every 5 min, max 4 drafts per run (keeps under 10s timeout
// with ~2s per Claude call).
//
// Effect: Danielle opens needs-scheduled.html and sees fully-populated
// cards (customer name, address, phone, claim #, appliance, problem)
// instead of a placeholder + a wall of raw email text.

const XANO_LIST = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/list_unparsed_warranty_drafts';
const XANO_UPDATE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/update_warranty_draft_parsed';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const PER_RUN = 4;

const SYSTEM_PROMPT =
  'You are a parsing tool. Given a warranty service dispatch email, ' +
  'extract structured customer + job fields. Return ONLY a JSON object ' +
  'matching the requested schema. Use empty string "" when a field is ' +
  'not present. Do not invent details. Do not include any prose, only JSON.';

const SCHEMA = {
  customer_first_name: 'string',
  customer_last_name: 'string',
  customer_phone: 'string (digits only)',
  service_address: 'string (street address)',
  service_city: 'string',
  service_state: 'string (2-letter)',
  service_zip: 'string (5 digits)',
  appliance_type: 'string (fridge|washer|dryer|dishwasher|range|microwave|oven|hvac|other)',
  brand: 'string',
  model_number: 'string',
  problem_description: 'string (1-2 sentences)',
  claim_number: 'string',
  dispatch_number: 'string',
};

async function callClaudeForExtraction(notes, warrantyCompany, subject) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const userMsg =
    'Warranty company: ' + warrantyCompany + '\n' +
    'Email subject: ' + subject + '\n\n' +
    'Schema:\n' + JSON.stringify(SCHEMA, null, 2) + '\n\n' +
    'Email body:\n' + notes;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('claude_http_' + res.status);
  const text = ((data.content || [])[0] || {}).text || '';
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('claude_json_parse: ' + cleaned.slice(0, 200));
  }
}

exports.handler = async () => {
  const startedAt = Date.now();
  const results = { processed: [], errors: [] };

  let listData;
  try {
    const r = await fetch(XANO_LIST + '?limit=' + PER_RUN);
    listData = await r.json();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'list_failed', message: e.message }) };
  }

  const items = (listData && listData.items) || [];
  if (!items.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, processed_count: 0, elapsed_ms: Date.now() - startedAt }) };
  }

  for (const item of items) {
    try {
      const parsed = await callClaudeForExtraction(
        (item.notes_internal || '').slice(0, 6000),
        item.warranty_company || '',
        item.problem_summary || '',
      );

      const payload = {
        job_id: item.job_id,
        customer_id: item.customer_id,
        first_name: parsed.customer_first_name || '',
        last_name: parsed.customer_last_name || '',
        phone: (parsed.customer_phone || '').replace(/[^0-9]/g, ''),
        address: parsed.service_address || '',
        city: parsed.service_city || '',
        state: (parsed.service_state || '').toUpperCase().slice(0, 2),
        zip: (parsed.service_zip || '').replace(/[^0-9]/g, '').slice(0, 5),
        appliance_type: (parsed.appliance_type || '').toLowerCase(),
        brand: parsed.brand || '',
        model_number: parsed.model_number || '',
        problem_description: parsed.problem_description || '',
        claim_number: parsed.claim_number || '',
        dispatch_number: parsed.dispatch_number || '',
      };

      const ur = await fetch(XANO_UPDATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const ud = await ur.json().catch(() => ({}));
      if (ur.ok && ud && ud.success) {
        results.processed.push({ job_id: item.job_id, customer: payload.first_name + ' ' + payload.last_name });
      } else {
        results.errors.push({ job_id: item.job_id, xano_status: ur.status });
      }
    } catch (err) {
      results.errors.push({ job_id: item.job_id, error: err.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      processed_count: results.processed.length,
      error_count: results.errors.length,
      elapsed_ms: Date.now() - startedAt,
      results,
    }),
  };
};
