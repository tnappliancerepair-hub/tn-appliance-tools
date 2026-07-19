/* ant-tech-reviews.js — renders real Google reviews that name our techs, per page.
   Any element <div class="ant-tech-reviews" data-techs="Jimmy,Lee" data-per="2"></div>
   gets filled with 5-star reviews that mention those techs by name (from
   /data/tech-reviews.json, refreshed from the GBP API). Fails silent + hides on error,
   so it can never break a page. Trust content: proves the named tech is a real,
   well-reviewed person. (Teddy 2026-07-18.) */
(function () {
  var DATA_URL = '/data/tech-reviews.json';
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function stars(n) { n = Math.max(0, Math.min(5, n || 5)); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function pick(data, techs, per) {
    var out = [];
    techs.forEach(function (t) {
      (data[t] || []).slice(0, per).forEach(function (r) { out.push({ tech: t, reviewer: r.reviewer, stars: r.stars || 5, text: r.text }); });
    });
    return out;
  }
  function label(techs) {
    if (techs.length <= 1) return techs[0] || '';
    return techs.slice(0, -1).join(', ') + ' & ' + techs[techs.length - 1];
  }
  function render(el, data) {
    var techs = (el.getAttribute('data-techs') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var per = parseInt(el.getAttribute('data-per') || '2', 10) || 2;
    var revs = pick(data, techs, per);
    if (!revs.length) { el.style.display = 'none'; return; }
    var h = '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--orange,#ff6200);margin:0 0 12px;font-weight:700">⭐ What customers say about ' + esc(label(techs)) + '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px">';
    revs.forEach(function (r) {
      h += '<div style="background:var(--surf2,rgba(255,255,255,.05));border:1px solid var(--bord2,rgba(255,255,255,.12));border-radius:12px;padding:13px 15px">'
        + '<div style="color:#f5b301;font-size:13px;letter-spacing:2px;margin-bottom:6px">' + stars(r.stars) + '</div>'
        + '<div style="font-size:13.5px;line-height:1.5;color:var(--white,#eee)">&ldquo;' + esc(r.text) + '&rdquo;</div>'
        + '<div style="font-size:12px;color:var(--gray,#9aa);margin-top:8px">&mdash; ' + esc(r.reviewer || 'Google review') + ' <span style="color:var(--orange,#ff6200)">&middot; on ' + esc(r.tech) + '</span></div>'
        + '</div>';
    });
    h += '</div>';
    el.innerHTML = h;
  }
  function init() {
    var els = document.querySelectorAll('.ant-tech-reviews');
    if (!els.length) return;
    fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (data) {
      els.forEach(function (el) { try { render(el, data); } catch (e) { el.style.display = 'none'; } });
    }).catch(function () { els.forEach(function (el) { el.style.display = 'none'; }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
