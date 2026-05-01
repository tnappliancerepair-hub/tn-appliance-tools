// TODO: q21_state is hardcoded to "TN" — Louisiana customers will be misclassified.
// Need to derive state from zip (lookup table or geo API) before this proxy
// can serve LA jobs correctly.
//
// TODO: the send-teddy-sms fetch below uses a relative URL ("/.netlify/functions/...").
// In Netlify Functions, server-side fetch requires an absolute URL — relative
// paths have no base and the call silently fails. This means owner SMS alerts
// for warranty jobs have likely been failing since this code was written.
// Fix: use `${process.env.URL}/.netlify/functions/send-teddy-sms` (or DEPLOY_URL).

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
      slug: "warranty_chat_" + Date.now(),
      customer_type:      job.customer_type      || "warranty",
      warranty_company:   job.warranty_company   || "",
      claim_number:       job.claim_number       || "",
      dispatch_source_id: job.dispatch_source_id || "",
      serial_number:      job.serial_number      || ""
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

    if (data && data.id) {
      await fetch("/.netlify/functions/send-teddy-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: data.id,
          customer_name: job.first_name + " " + job.last_name,
          appliance: job.appliance_type,
          brand: job.brand,
          problem: job.problem_summary
        })
      });
    }

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
