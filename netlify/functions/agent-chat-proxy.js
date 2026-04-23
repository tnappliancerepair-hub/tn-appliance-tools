exports.config = {
  timeout: 26
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const body = JSON.parse(event.body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    
    const xanoRes = await fetch(
      "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/chat/reply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel:          body.channel          || "web",
          conversation_id:  body.conversation_id  ?? null,
          customer_phone:   body.customer_phone   ?? null,
          customer_id:      body.customer_id      ?? null,
          message:          body.message,
        }),
        signal: controller.signal
      }
    );
    
    clearTimeout(timeout);
    
    if (!xanoRes.ok) {
      const errText = await xanoRes.text();
      return {
        statusCode: xanoRes.status,
        body: JSON.stringify({ error: errText }),
      };
    }
    const data = await xanoRes.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
