exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const job = JSON.parse(event.body);

    const rawRequest = JSON.stringify({
      q3_customerName: { first: job.first_name, last: job.last_name },
      q4_phoneNumber: { full: job.phone },
      q5_email: "",
      q6_applianceType: job.appliance_type,
      q7_applianceBrand: job.brand,
      q8_modelNumber: job.model_number,
      q9_whatIssue: job.problem_summary,
      q20_zipCode: job.zip,
      q21_state: "TN",
      q23_streetAddress: "",
      q24_city: "",
      q28_jobid: "",
      slug: "web_chat_" + Date.now()
    });

    const res = await fetch(
      "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_job",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawRequest })
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
