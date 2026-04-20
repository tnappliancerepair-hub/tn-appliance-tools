// Netlify proxy for Xano get_tech_jobs endpoint
// Receives: technician_id (query param)
// Returns: Array of jobs with customer data

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const technicianId = event.queryStringParameters?.technician_id;

    if (!technicianId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing technician_id query parameter" })
      };
    }

    const XANO_URL = `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_tech_jobs?technician_id=${encodeURIComponent(technicianId)}`;

    const response = await fetch(XANO_URL, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error("get-tech-jobs-proxy error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error", details: err.message })
    };
  }
};
