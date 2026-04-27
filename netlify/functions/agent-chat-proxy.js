exports.config = {
  timeout: 26
};

exports.handler = async function (event) {

  // CORS headers — allow all origins so website can call this
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Validate message exists
    if (!body.message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "message is required" })
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    // Call the LIVE Ant brain — chat/reply2 endpoint #94
    const xanoRes = await fetch(
      "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/chat/reply2",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:        body.message,
          session_id:     body.session_id     || null,
          channel:        body.channel        || "web",
          customer_phone: body.customer_phone || null,
          customer_id:    body.customer_id    || null,
          source:         body.source         || "website"
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!xanoRes.ok) {
      const errText = await xanoRes.text();
      return {
        statusCode: xanoRes.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: errText })
      };
    }

    const data = await xanoRes.json();

    // Normalize response — return reply field the website expects
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        reply:   data.reply || data.message || data.response || data.text || "Hey — something went wrong on our end. Text us at 629-284-0444 and we'll get you sorted. 🐜",
        session_id: data.session_id || body.session_id || null
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: err.message,
        reply: "Hey — something went wrong on our end. Text us at 629-284-0444 and we'll get you sorted. 🐜"
      })
    };
  }
};
