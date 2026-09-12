// Thin scheduled wrapper. The core stays HTTP-callable (?secret=&dry=1) because a
// function carrying its own schedule block returns an edge 403 on any manual call.
const core = require('./platform-migration-watch');
exports.handler = async () => {
  try { const r = await core.run({}); return { statusCode: 200, body: JSON.stringify(r) }; }
  catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 200) }) }; }
};
