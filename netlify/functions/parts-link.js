// parts-link — build a MODEL-PREFILLED parts-search link and (optionally) TEXT
// it to the tech so he can open the exploded diagram and confirm the exact part
// number. Brand-aware: LG's own parts site for LG, Sears PartsDirect for most
// others (both pre-fill the model). Internal/tech-facing.
//
// Works two ways:
//   • As a Vapi tool — the field/callback assistant calls it mid-report when the
//     tech says "I'm not sure on this part # — send me the link." It texts the
//     link (model queued up) and returns a spoken confirmation.
//   • As a plain HTTP call from a tech-tool button.
//
//   POST { model, brand?, phone?|tech_phone?, send? }
//     -> { ok, model, brand, primary:{label,url}, alternates:[...], sent, say }
//   (Vapi args may arrive under arguments/args — accepted.)
'use strict';
const { sendSms } = require('./_lib/sms');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
const enc = (s) => encodeURIComponent(String(s || '').trim());

// PRIMARY parts source by brand — each URL pre-fills the model so the diagram
// opens ready to search. Edit here (or set PARTS_LINK_LG_URL, a template with
// {model}) to change where a brand routes.
function primaryFor(brand, model) {
  const b = String(brand || '').toLowerCase();
  if (/\blg\b|lg electronics|zenith|goldstar/.test(b)) {
    const tpl = process.env.PARTS_LINK_LG_URL; // exact LG template, {model} placeholder
    return { label: 'LG Parts (official)', url: tpl ? tpl.replace('{model}', enc(model)) : `https://www.lg.com/us/support/product/lg-${enc(model)}` };
  }
  // Default best-for-most-brands: Sears PartsDirect (exploded diagram + part #s).
  return { label: 'Sears PartsDirect', url: `https://www.searspartsdirect.com/search?q=${enc(model)}` };
}
function alternatesFor(model) {
  return [
    { label: 'Sears PartsDirect', url: `https://www.searspartsdirect.com/search?q=${enc(model)}` },
    { label: 'PartSelect (exploded diagram)', url: `https://www.partselect.com/search/?q=${enc(model)}` },
    { label: 'AppliancePartsPros', url: `https://www.appliancepartspros.com/search.aspx?q=${enc(model)}` },
    { label: 'Encompass (OEM distributor)', url: `https://encompass.com/search/?searchTerm=${enc(model)}` },
  ].filter((a) => a.url);
}

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let raw = {}; try { raw = JSON.parse(event.body || '{}'); } catch (_) {}
  const a = raw.arguments || raw.args || raw;

  const model = String(a.model || a.model_number || '').trim();
  const brand = String(a.brand || a.make || '').trim();
  if (!model) return json(200, { ok: false, say: "What's the model number? I'll text you the parts link with it already loaded." });

  const primary = primaryFor(brand, model);
  const alts = alternatesFor(model).filter((x) => x.url !== primary.url).slice(0, 1); // 1 backup keeps the SMS short
  const phone = String(a.phone || a.tech_phone || a.to || a.number || '').trim();

  let sent = false, say = '';
  if (phone) {
    const body = `🔧 Parts for ${model}${brand ? ' (' + brand + ')' : ''}:\n${primary.label} → ${primary.url}` +
      (alts[0] ? `\nBackup: ${alts[0].url}` : '') +
      `\n\nOpen it, tap into the exploded diagram, and confirm the exact part #.`;
    try { sent = await sendSms(phone, body, 'technician', 'parts_link'); } catch (_) { sent = false; }
    say = sent
      ? `Sent — check your texts. I pulled up ${primary.label} with model ${model} already loaded. Open the diagram and confirm the part number.`
      : `I couldn't get that text out — but here it is: search model ${model} on ${primary.label}.`;
  } else {
    say = `Here's the parts link for model ${model} on ${primary.label}.`;
  }

  return json(200, { ok: true, model, brand, primary, alternates: alternatesFor(model), sent, say });
};
