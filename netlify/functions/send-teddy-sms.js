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

    const teddyToolUrl = `https://superlative-naiad-233aa7.netlify.app/teddy-tdr-tool.html?job_id=${job_id}`;

    const message = `New job #${job_id} - ${customer_name}\n${appliance} | ${brand}\nIssue: ${problem}\n\nTeddy Tool: ${teddyToolUrl}`;

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
