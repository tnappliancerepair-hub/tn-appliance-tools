// Unified parts-supplier lookup scaffold for Marcone + Tribles Appliance Parts APIs.
// Both upstream integrations are pending delivery (per CLAUDE.md
// 'Pending external integrations'). Until APIs arrive, this function
// returns a clearly-marked placeholder so the architect's parts_lookup_*
// agents can call a stable endpoint without code changes when the APIs
// land.
//
// ENV REQUIRED (when APIs arrive):
//   MARCONE_API_KEY
//   MARCONE_API_BASE
//   TRIPLES_API_KEY
//   TRIPLES_API_BASE

const PLACEHOLDER_LOOKUP_URL = 'https://www.searspartsdirect.com';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const supplier = String(body.supplier || 'marcone').toLowerCase();
  const partNumber = String(body.part_number || '').trim();
  const brand = String(body.brand || '').trim();
  const model = String(body.model_number || '').trim();

  if (!partNumber && !model) {
    return jsonResp(400, { ok: false, error: 'part_number or model_number required' });
  }

  const marconeKey = process.env.MARCONE_API_KEY;
  const triplesKey = process.env.TRIPLES_API_KEY;

  const isPlaceholder = (supplier === 'marcone' && !marconeKey) || (supplier === 'triples' && !triplesKey);

  if (isPlaceholder) {
    const query = encodeURIComponent([brand, model, partNumber].filter(Boolean).join(' '));
    return jsonResp(200, {
      ok: true,
      placeholder: true,
      supplier,
      lookup_url: `${PLACEHOLDER_LOOKUP_URL}/search?q=${query}`,
      note: `${supplier.toUpperCase()}_API_KEY not set — returning Sears Parts Direct search URL`,
      part_number: partNumber,
      brand,
      model_number: model,
    });
  }

  // Real API call would go here. Stubbed until API specs arrive.
  return jsonResp(501, {
    ok: false,
    error: 'real_api_not_yet_implemented',
    supplier,
    note: 'Operator: when Marcone/Triples API spec lands, replace this stub with the actual fetch call. Schema in colony-loop/agents/parts_lookup_*.js.',
  });
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
