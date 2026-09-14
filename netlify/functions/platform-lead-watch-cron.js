// Thin scheduled wrapper. The core stays HTTP-callable (?secret=&dry=1) because a
// function carrying its own schedule block edge-403s on every manual call -- and a
// lead alert you cannot dry-run before it texts the owner is one you cannot trust.
const core = require('./platform-lead-watch');
exports.handler = async () => {
  try { const r = await core.run({}); return { statusCode: 200, body: JSON.stringify(r) }; }
  catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 200) }) }; }
};
