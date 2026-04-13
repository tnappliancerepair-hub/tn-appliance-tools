exports.handler = async function (event, context) {
if (event.httpMethod === "OPTIONS") {
return {
statusCode: 200,
headers: {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "Content-Type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
},
body: "",
};
}

if (event.httpMethod !== "POST") {
return { statusCode: 405, body: "Method Not Allowed" };
}

try {
const body = JSON.parse(event.body);
const response = await fetch("https://api.anthropic.com/v1/messages", {
method: "POST",
headers: {
"Content-Type": "application/json",
"x-api-key": process.env.ANTHROPIC_API_KEY,
"anthropic-version": "2023-06-01",
},
body: JSON.stringify(body),
});
const text = await response.text();
return {
statusCode: response.status,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*",
},
body: text,
};
} catch (err) {
return {
statusCode: 500,
headers: { "Access-Control-Allow-Origin": "*" },
body: JSON.stringify({ error: err.message }),
};
}
};
