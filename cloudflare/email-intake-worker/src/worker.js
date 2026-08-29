// AssistAnt warranty-email intake — Cloudflare Email Worker.
//
// Bound (in the Cloudflare dashboard) to a catch-all Email Routing rule on the intake domain
// (jobs.assistant247.net). Every warranty dispatch a shop forwards to  <slug>@jobs.assistant247.net
// hits this worker: we parse the MIME, pull the text/html + any XML dispatch attachment (AHS),
// and POST it to the platform-email-intake Netlify function, which resolves the shop by the
// address and lands the job on that shop's board.
//
// Env (set as Worker secrets/vars in the dashboard or `wrangler secret put`):
//   PLATFORM_EMAIL_SECRET  — shared secret; must equal the same-named platform vault key
//   INTAKE_BASE            — e.g. https://tnapplianceexchange.net  (no trailing slash)
//   FALLBACK_INBOX         — a verified Email Routing destination; a copy is forwarded here
//                            ONLY if intake fails, so a dispatch is never silently lost.
import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    let payload;
    try {
      const buf = await new Response(message.raw).arrayBuffer();
      const parsed = await new PostalMime().parse(buf);
      let xml = '';
      for (const att of parsed.attachments || []) {
        const name = String(att.filename || '').toLowerCase();
        const ct = String(att.mimeType || '').toLowerCase();
        if (name.endsWith('.xml') || ct.includes('xml')) {
          xml = typeof att.content === 'string' ? att.content : new TextDecoder().decode(att.content);
          break;
        }
      }
      payload = {
        to: message.to || '',
        from: message.from || (parsed.from && parsed.from.address) || '',
        subject: parsed.subject || message.headers.get('subject') || '',
        text: parsed.text || '',
        html: parsed.html || '',
        xml,
        message_id: parsed.messageId || message.headers.get('message-id') || '',
      };
    } catch (e) {
      // couldn't even parse — forward the raw so a human can handle it
      if (env.FALLBACK_INBOX) { try { await message.forward(env.FALLBACK_INBOX); } catch (_) {} }
      return;
    }

    let ok = false;
    try {
      const url = `${env.INTAKE_BASE}/.netlify/functions/platform-email-intake?secret=${encodeURIComponent(env.PLATFORM_EMAIL_SECRET || '')}`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      ok = r.ok && j && j.ok === true;
    } catch (_) { ok = false; }

    // safety net: never lose a dispatch — forward a copy to a human inbox if we didn't accept it
    if (!ok && env.FALLBACK_INBOX) { try { await message.forward(env.FALLBACK_INBOX); } catch (_) {} }
  },
};
