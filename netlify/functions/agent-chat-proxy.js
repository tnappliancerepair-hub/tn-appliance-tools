exports.config = {
  timeout: 30
};

exports.handler = async function (event) {

  // Allow all origins — works from any domain including tnapplianceexchange.net
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
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { message, session_id, source } = body;

    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    // Call Xano chat/reply2 endpoint #94
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 27000);

    const xanoRes = await fetch(
      "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/chat/reply2",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message,
          session_id: session_id || ("web_" + Date.now()),
          source: source || "website"
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!xanoRes.ok) {
      const errText = await xanoRes.text();
      console.error("Xano error:", xanoRes.status, errText);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          reply: "Hey — Ant is having a moment. Try again in a few seconds or call us at 615-280-2949. 🐜"
        })
      };
    }

    const data = await xanoRes.json();

    // Extract reply from Xano response
    const reply =
      data?.reply ||
      data?.message ||
      data?.response ||
      data?.content ||
      data?.result ||
      (typeof data === "string" ? data : null) ||
      "Got it — give me just a second. 🐜";

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reply: reply })
    };

  } catch (err) {
    console.error("Proxy error:", err.message);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        reply: "Ant is thinking hard on this one — try sending that again. 🐜"
      })
    };
  }
};
