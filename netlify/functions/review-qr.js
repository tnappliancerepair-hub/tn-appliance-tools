// review-qr — a branded, printable "Scan to review us" card + QR pointing straight
// at our Google review page. The map pack (the thing eating our organic clicks) is
// won with reviews, and the text-ask has an engagement leak — so a physical QR the
// tech shows at the door (or leaves on the invoice / truck) is the highest-converting
// ask we have. Open it, print it, screenshot it — it just works.
//
//   GET /review-qr            -> full printable HTML card with the QR
//   GET /review-qr?format=svg -> just the QR SVG (to drop into other print material)
'use strict';
const qrcode = require('qrcode-generator');

// The authoritative Google review deep-link (opens straight to the write-a-review box).
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';

function qrSvg(text, cell) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: cell || 8, margin: 1 });
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};

  if (q.format === 'svg') {
    return { statusCode: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' }, body: qrSvg(REVIEW_URL, 10) };
  }

  const svg = qrSvg(REVIEW_URL, 8);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Leave TN Appliance a Review</title>
<style>
  :root{ --orange:#ff6200; --ink:#141414; --ink2:#5b5b5b; --line:#e7e7e7; --star:#f5a623; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ background:#f4f4f4; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card{ background:#fff; width:100%; max-width:420px; border-radius:22px; padding:34px 30px 30px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.10); border:1px solid var(--line); }
  .kicker{ font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--orange); font-weight:800; }
  h1{ font-size:30px; line-height:1.12; margin:10px 0 6px; font-weight:800; letter-spacing:-.01em; }
  .sub{ font-size:16px; color:var(--ink2); line-height:1.45; margin-bottom:20px; }
  .qrbox{ background:#fff; border:2px solid var(--ink); border-radius:16px; padding:14px; width:238px; margin:0 auto 18px; }
  .qrbox svg{ width:100%; height:auto; display:block; }
  .scan{ font-size:20px; font-weight:800; margin-bottom:4px; }
  .scan .arrow{ color:var(--orange); }
  .or{ font-size:13px; color:var(--ink2); margin:14px 0 4px; }
  .link{ font-size:14px; font-weight:700; color:var(--ink); word-break:break-all; }
  .trust{ margin-top:22px; padding-top:18px; border-top:1px solid var(--line); }
  .stars{ color:var(--star); font-size:22px; letter-spacing:2px; }
  .trust .n{ font-size:14px; color:var(--ink2); margin-top:4px; }
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
      <div class="kicker">TN Appliance Exchange</div>
      <h1>Happy with the repair?</h1>
      <p class="sub">Your review helps your neighbors find honest techs — and it means the world to our family business. It takes 15 seconds.</p>
      <div class="scan">📲 Scan to review us <span class="arrow">↓</span></div>
      <div class="qrbox">${svg}</div>
      <div class="or">or go to</div>
      <div class="link">g.page/r/CRt-vo--eAJ3EBM/review</div>
      <div class="trust">
        <div class="stars">★★★★★</div>
        <div class="n">Rated 4.5 by 1,000+ neighbors</div>
      </div>
      <div class="brand"><b>Thank you!</b> — the TN Appliance crew 🐜</div>
      <button class="print" onclick="window.print()">🖨️ Print this card</button>
    </div>
  </div>
</body>
</html>`;
  return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,max-age=3600' }, body: html };
};
