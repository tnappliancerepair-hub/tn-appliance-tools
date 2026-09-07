// referral-qr — the QR behind "The Ant Army". A shop's referral code is public (it rides
// signup.html?ref=<code>), so this is an OPEN endpoint that renders a QR pointing at the
// short share link tnapplianceexchange.net/r/<code>. Embed it (<img …&format=svg>), print
// the card (no param), or save the SVG — "Scan my code, you get free setup, I get $25/mo off."
//
//   GET /referral-qr?code=<code>             -> full printable "Scan to try AssistAnt" card
//   GET /referral-qr?code=<code>&format=svg  -> just the QR SVG (embed / save / drop into print)
'use strict';
const qrcode = require('qrcode-generator');

const SITE = 'https://tnapplianceexchange.net';

// The code is public but user-supplied in the URL — allow only safe slug chars so nothing
// weird lands in the QR text / rendered card (partner codes are slugs like "tk" / a shop slug).
function cleanCode(raw) {
  return String(raw || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

function qrSvg(text, cell) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: cell || 8, margin: 1 });
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const code = cleanCode(q.code);
  if (!code) return { statusCode: 400, headers: { 'content-type': 'text/plain' }, body: 'code required' };
  const link = `${SITE}/r/${code}`;

  if (q.format === 'svg') {
    return { statusCode: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' }, body: qrSvg(link, 10) };
  }

  const svg = qrSvg(link, 8);
  const shortLink = `tnapplianceexchange.net/r/${code}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Refer a Shop — AssistAnt</title>
<style>
  :root{ --orange:#ff6200; --ink:#141414; --ink2:#5b5b5b; --line:#e7e7e7; --gold:#f5a623; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ background:#f4f4f4; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card{ background:#fff; width:100%; max-width:420px; border-radius:22px; padding:34px 30px 30px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.10); border:1px solid var(--line); }
  .kicker{ font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--orange); font-weight:800; }
  h1{ font-size:29px; line-height:1.12; margin:10px 0 6px; font-weight:800; letter-spacing:-.01em; }
  .sub{ font-size:16px; color:var(--ink2); line-height:1.45; margin-bottom:20px; }
  .qrbox{ background:#fff; border:2px solid var(--ink); border-radius:16px; padding:14px; width:238px; margin:0 auto 18px; }
  .qrbox svg{ width:100%; height:auto; display:block; }
  .scan{ font-size:20px; font-weight:800; margin-bottom:4px; }
  .scan .arrow{ color:var(--orange); }
  .or{ font-size:13px; color:var(--ink2); margin:14px 0 4px; }
  .link{ font-size:15px; font-weight:800; color:var(--ink); word-break:break-all; }
  .perk{ margin-top:22px; padding-top:18px; border-top:1px solid var(--line); font-size:14px; color:var(--ink2); line-height:1.5; }
  .perk b{ color:var(--ink); }
  .brand{ margin-top:16px; font-size:13px; color:var(--ink2); }
  .brand b{ color:var(--ink); }
  .print{ display:inline-block; margin-top:18px; background:var(--orange); color:#fff; font-weight:800; font-size:15px; text-decoration:none; padding:12px 22px; border-radius:12px; border:none; cursor:pointer; }
  @media print{
    html,body{ background:#fff; }
    .wrap{ padding:0; }
    .card{ box-shadow:none; border:none; max-width:none; }
    .print{ display:none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="kicker">AssistAnt 24/7 · run your whole shop</div>
      <h1>Try the system I run my shop on</h1>
      <p class="sub">Answer every call, book every job, pay every tech — one place. Free setup. Scan it.</p>
      <div class="scan">📲 Scan to start <span class="arrow">↓</span></div>
      <div class="qrbox">${svg}</div>
      <div class="or">or go to</div>
      <div class="link">${esc(shortLink)}</div>
      <div class="perk">You get <b>free setup</b>. It's <b>$99/mo flat</b> — every tech included.</div>
      <div class="brand"><b>🐜 The Ant Army</b> — shops helping shops</div>
      <button class="print" onclick="window.print()">🖨️ Print this card</button>
    </div>
  </div>
</body>
</html>`;
  return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,max-age=3600' }, body: html };
};
