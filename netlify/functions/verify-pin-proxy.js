// Netlify proxy for Xano verify_tech_pin endpoint
// Receives: { technician_id, pin }
// Returns: { success, technician_id, first_name, last_name, active }

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { technician_id, pin } = body;

    if (!technician_id || !pin) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing technician_id or pin" })
      };
    }

    // Force types: Xano expects technician_id as integer, pin as string
    const payload = {
      technician_id: parseInt(technician_id, 10),
      pin: String(pin).trim()
    };

    console.log("verify-pin-proxy sending to Xano:", payload);

    const XANO_URL = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/verify_tech_pin";

    const response = await fetch(XANO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log("verify-pin-proxy got from Xano:", data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error("verify-pin-proxy error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error", details: err.message })
    };
  }
};
