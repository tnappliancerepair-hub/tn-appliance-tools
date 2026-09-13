/* ads-phone.js — dynamic number insertion for paid traffic.
 *
 * WHY THIS EXISTS
 * The Google Ads call extension uses the dedicated ads line (615-845-8500), so a
 * tap-to-call straight off the AD is attributable. But every ad's final URL lands
 * on a page that publishes the main line (629-272-1234) — so a visitor who clicks
 * the ad, reads the page, and then calls off the page is INVISIBLE to
 * google-ads-truth. That is ~225 clicks a month landing on a number nobody can
 * tie back to the spend, which is why cost-per-job reads null.
 *
 * WHAT IT DOES
 * If (and only if) this visit came from a Google Ad, swap the VISIBLE phone
 * number + tel: link to the ads line. Every call to that number is then a paid
 * lead by construction, and google-ads-truth can join it to the job it became.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  - It never touches the JSON-LD / schema.org phone. That is the business's
 *    canonical NAP and swapping it per-visitor would break the name-address-phone
 *    consistency that local ranking leans on.
 *  - It never credits the ad on a guess. A stored ad-click only counts inside the
 *    same visit (90 min). Someone who clicked an ad last week and comes back
 *    organically gets the normal number — crediting them to paid is exactly how a
 *    channel gets scaled on numbers that were never real.
 *  - It cannot break the page. Everything is wrapped; on any failure the original
 *    number stands.
 *
 * USAGE: add data-ads-phone to any <a href="tel:..."> that should swap, then
 *   <script src="/ads-phone.js" defer></script>
 * Also exposes window.TN_PHONE / window.TN_PHONE_TEL for copy built in JS.
 */
(function () {
  var ADS_DISPLAY = '615-845-8500';
  var ADS_TEL     = '+16158458500';
  var SESSION_MS  = 90 * 60 * 1000;   // same-visit only

  function cameFromAd() {
    try {
      var u = new URLSearchParams(location.search);
      if (u.get('gclid') || u.get('gbraid') || u.get('wbraid')) return true;
      if ((u.get('utm_source') || '') === 'google_ads') return true;
      // Carries the paid flag across an internal hop (always-open -> appliance-ai),
      // where the gclid is gone from the URL but the visit is the same visit.
      var saved = JSON.parse(localStorage.getItem('tn_ad_click') || 'null');
      if (saved && (Date.now() - (saved.t || 0)) < SESSION_MS) return true;
    } catch (_) {}
    return false;
  }

  // Swap the digits wherever they appear in the label, leave the rest of the
  // wording (emoji, "Talk to Ann —", parentheses) exactly as written.
  function swapDigits(s) {
    return String(s || '').replace(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g, ADS_DISPLAY);
  }

  function apply() {
    try {
      var nodes = document.querySelectorAll('[data-ads-phone]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        try {
          if (el.tagName === 'A') el.setAttribute('href', 'tel:' + ADS_TEL);
          el.textContent = swapDigits(el.textContent);
        } catch (_) {}
      }
    } catch (_) {}
  }

  try {
    window.TN_PHONE = '629-272-1234';
    window.TN_PHONE_TEL = '+16292721234';
    if (!cameFromAd()) return;
    window.TN_PHONE = ADS_DISPLAY;
    window.TN_PHONE_TEL = ADS_TEL;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
  } catch (_) {}
})();
