exports.config = {
  timeout: 30
};

exports.handler = async function (event) {

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const message = body.message;
    const ts = new Date().getTime();
    const session_id = body.session_id || ("web_" + ts);
    const source = body.source || "website";

    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, 27000);

    const xanoRes = await fetch(
      "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/chat/reply2",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message,
          session_id: session_id,
          source: source
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timer);

    if (!xanoRes.ok) {
      const errText = await xanoRes.text();
      console.error("Xano error:", xanoRes.status, errText);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          reply: "Hey — Ant is having a moment. Try again or call 615-280-2949."
        })
      };
    }

    const data = await xanoRes.json();

    let reply = "Got it — give me just a second.";

    if (data && data.reply) {
      reply = data.reply;
    } else if (data && data.message) {
      reply = data.message;
    } else if (data && data.response) {
      reply = data.response;
    } else if (typeof data === "string") {
      reply = data;
    }

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
        reply: "Ant is thinking — try sending that again."
      })
    };
  }
};
