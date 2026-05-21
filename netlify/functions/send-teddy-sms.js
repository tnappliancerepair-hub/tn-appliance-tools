exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { job_id, customer_name, appliance, brand, problem } = JSON.parse(event.body);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = "+16292840444";
    const teddyNumber = "+16154855795";

    const teddyToolUrl = `https://tnapplianceexchange.net/teddy-tdr-tool.html?job_id=${job_id}`;

    const message = `New job #${job_id} - ${customer_name}\n${appliance} | ${brand}\nIssue: ${problem}\n\nTeddy Tool: ${teddyToolUrl}`;

    // ── SMS_ENABLED gate (call_site: send-teddy-sms.js:19) ──
    // Recipient is hardcoded owner; gate is for consistency + future-proofing.
    // See docs/sms-enabled-gate-pattern.md.
    const recipientE164 = (teddyNumber || "").trim();
    const recipientBare = recipientE164.replace("+1", "");
    const isOwner = (recipientE164 === "+16154855795") || (recipientBare === "6154855795");
    const smsEnabled = (process.env.SMS_ENABLED === "true");
    const shouldSend = smsEnabled || isOwner;
    const callSite = "send-teddy-sms.js:19";

    if (!shouldSend) {
      console.log(JSON.stringify({
        action: "sms_gated",
        recipient: recipientE164,
        body_preview: message.slice(0, 200),
        gated_reason: "SMS_ENABLED=false, non-owner recipient",
        call_site: callSite,
        job_id: job_id
      }));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, gated: true, gated_reason: "SMS_ENABLED=false, non-owner recipient", call_site: callSite })
      };
    }

    if (isOwner && !smsEnabled) {
      console.log(JSON.stringify({
        action: "sms_owner_bypass",
        recipient: recipientE164,
        body_preview: message.slice(0, 200),
        call_site: callSite,
        job_id: job_id
      }));
    }

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64")
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: teddyNumber,
          Body: message
        }).toString()
      }
    );

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
