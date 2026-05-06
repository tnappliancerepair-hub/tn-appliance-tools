exports.handler = async function (event, context) {
if (event.httpMethod === "OPTIONS") {
return {
statusCode: 200,
headers: {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "Content-Type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
},
body: "",
};
}

if (event.httpMethod !== "POST") {
return { statusCode: 405, body: "Method Not Allowed" };
}

try {
const { endpoint, payload, api_group } = JSON.parse(event.body);

// Route to the right api_group canonical. Default to "intake" for back-compat
// with existing callers. cash_tdr added 2026-05-06 for Phase 1c step 3b.
const API_GROUP_CANONICALS = {
  intake: "3e_TffpA",
  cash_tdr: "VGkW9mcV",
};
const groupKey = api_group || "intake";
const canonical = API_GROUP_CANONICALS[groupKey];
if (!canonical) {
  return {
    statusCode: 400,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    body: JSON.stringify({ error: "unknown api_group: " + groupKey }),
  };
}
const XANO_BASE = `https://xbtp-g9bh-ditq.n7e.xano.io/api:${canonical}`;

const response = await fetch(`${XANO_BASE}/${endpoint}`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
});

const data = await response.json();

return {
statusCode: response.status,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*",
},
body: JSON.stringify(data),
};
} catch (err) {
return {
statusCode: 500,
headers: { "Access-Control-Allow-Origin": "*" },
body: JSON.stringify({ error: err.message }),
};
}
};
