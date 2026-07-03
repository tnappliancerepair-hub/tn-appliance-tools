// Docked jobs map — a collapsible map panel on the right edge of the schedule
// pages. Shows every active job as a numbered pin (green = scheduled, orange =
// needs scheduling). Hovering ANY job tile on the page — a calendar block, a
// needs-scheduled card, a board card, anything with data-id — flashes + pans to
// that job's pin. Gives the office a bird's-eye view of WHERE in the city each
// stop is. (Danielle 2026-07-03: "Nashville / New Orleans are huge — it's hard
// to tell what part of town a stop is in; hover a job, see the pin.")
//
// Self-contained + non-invasive: a fixed overlay panel, so it never reflows the
// existing page. Toggle open/closed with the edge tab (state remembered).
(function () {
  'use strict';
  if (window.__antJobsMapLoaded) return;
  window.__antJobsMapLoaded = true;

  const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  const GEO_PREFIX = 'tn_geo_v1:';
  const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const OPEN_KEY = 'tn_jobsmap_open_v1';
  const region = (location.pathname || '').toLowerCase().includes('-la') ? 'la' : 'tn';

  let map = null, leafletReady = false, pinsByJob = {}, jobsLoaded = false;
  let markerLayer = null;
  // Two separate maps — Middle TN and Louisiana — so each region can be
  // clustered on its own. Default to whatever the page implies. (Teddy 2026-07-03)
  let currentRegion = region;
  const CENTER = { tn: [36.0, -86.7], la: [30.1, -90.5] };

  // ── DOM: edge tab + sliding panel ──────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #antmap-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:9400;
      background:#1e6fdb;color:#fff;border:0;border-radius:10px 0 0 10px;padding:14px 8px;
      font-size:13px;font-weight:800;cursor:pointer;writing-mode:vertical-rl;letter-spacing:.06em;
      box-shadow:-3px 0 12px rgba(0,0,0,.28);font-family:-apple-system,system-ui,sans-serif}
    #antmap-panel{position:fixed;top:0;right:0;height:100vh;width:min(400px,86vw);z-index:9401;
      background:#0e1118;border-left:1px solid #2a3040;box-shadow:-10px 0 34px rgba(0,0,0,.45);
      transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column}
    #antmap-panel.open{transform:translateX(0)}
    #antmap-head{display:flex;align-items:center;gap:10px;padding:11px 13px;background:#1e6fdb;color:#fff}
    #antmap-head b{font-size:15px;flex:1}
    #antmap-status{font-size:11px;font-family:ui-monospace,Menlo,monospace;opacity:.85}
    #antmap-close{background:rgba(255,255,255,.2);color:#fff;border:0;border-radius:7px;padding:6px 12px;font-weight:700;cursor:pointer}
    #antmap-el{flex:1;background:#e8ecf2}
    #antmap-legend{padding:8px 12px;font-size:12px;color:#9fb0c3;background:#0e1118;border-top:1px solid #2a3040;display:flex;gap:14px;align-items:center}
    #antmap-legend .d{width:11px;height:11px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:-1px}
    #antmap-regions{display:flex;gap:8px;padding:9px 12px;background:#0e1118;border-bottom:1px solid #2a3040}
    .antmap-reg{flex:1;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid #2a3040;color:#9fb0c3;
      padding:9px 10px;border-radius:9px;font-size:13px;font-weight:700;font-family:inherit}
    .antmap-reg.active{background:#1e6fdb;border-color:#1e6fdb;color:#fff}
    .antmap-pin{background:#e67e22;color:#fff;font-weight:700;font-size:11px;width:26px;height:26px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
    .antmap-pin.sched{background:#1aa05c}
    .antmap-pin.flash{animation:antmapPulse .9s ease}
    @keyframes antmapPulse{0%{transform:scale(1)}35%{transform:scale(1.7)}100%{transform:scale(1)}}
  `;
  document.head.appendChild(style);

  const tab = document.createElement('button');
  tab.id = 'antmap-tab';
  tab.type = 'button';
  tab.textContent = '🗺 Map';

  const panel = document.createElement('div');
  panel.id = 'antmap-panel';
  panel.innerHTML = `
    <div id="antmap-head">
      <b>🗺 Needs scheduling</b>
      <span id="antmap-status">…</span>
      <button id="antmap-close" type="button">Hide</button>
    </div>
    <div id="antmap-regions">
      <button type="button" class="antmap-reg" data-region="tn">Middle TN</button>
      <button type="button" class="antmap-reg" data-region="la">Louisiana</button>
    </div>
    <div id="antmap-el"></div>
    <div id="antmap-legend">
      <span><span class="d" style="background:#e67e22"></span>needs scheduling — cluster these</span>
      <span style="margin-left:auto;opacity:.7">hover a job → its pin</span>
    </div>
  `;

  function mount() {
    if (!document.body) return setTimeout(mount, 30);
    document.body.appendChild(tab);
    document.body.appendChild(panel);
    document.getElementById('antmap-close').onclick = () => setOpen(false);
    tab.onclick = () => setOpen(true);
    panel.querySelectorAll('.antmap-reg').forEach(b => { b.onclick = () => switchRegion(b.getAttribute('data-region')); });
    markActiveRegion();
    // Restore last state (default closed so it never surprises anyone).
    if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true);
    wireHover();
    // On these schedule pages the docked hover map beats the fullscreen modal,
    // so repoint the nav's 🗺 Map pill (office-map.js) at the docked panel too —
    // one consistent Map whether they tap the pill or the edge tab.
    let t = 0;
    (function grabNavPill() {
      const btn = document.querySelector('.ofc-map-btn');
      if (btn) { btn.onclick = (e) => { e && e.preventDefault(); setOpen(true); }; return; }
      if (t++ < 60) setTimeout(grabNavPill, 60);
    })();
  }

  function setOpen(open) {
    panel.classList.toggle('open', open);
    tab.style.display = open ? 'none' : 'block';
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) {}
    if (open) ensureMap();
  }

  // ── Leaflet + data ─────────────────────────────────────────────
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const sc = document.createElement('script');
      sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      sc.onload = resolve; sc.onerror = () => reject(new Error('leaflet load failed'));
      document.head.appendChild(sc);
    });
  }

  async function ensureMap() {
    if (leafletReady) { setTimeout(() => map && map.invalidateSize(), 60); if (!jobsLoaded) loadJobs(); return; }
    const status = document.getElementById('antmap-status');
    status.textContent = 'loading map…';
    try { await loadLeaflet(); } catch (e) { status.textContent = 'map failed'; return; }
    map = L.map('antmap-el', { zoomControl: true, attributionControl: false }).setView(CENTER[currentRegion] || CENTER.tn, 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    leafletReady = true;
    setTimeout(() => map.invalidateSize(), 60);
    loadJobs();
  }

  function markActiveRegion() {
    panel.querySelectorAll('.antmap-reg').forEach(b => b.classList.toggle('active', b.getAttribute('data-region') === currentRegion));
  }

  function switchRegion(r) {
    if (!r || r === currentRegion) return;
    currentRegion = r;
    markActiveRegion();
    if (map) map.setView(CENTER[r] || CENTER.tn, 9);
    loadJobs();
  }

  async function loadJobs() {
    jobsLoaded = true;
    if (markerLayer) markerLayer.clearLayers();
    pinsByJob = {};
    const status = document.getElementById('antmap-status');
    status.textContent = 'fetching jobs…';
    let items = [];
    try {
      const r = await fetch(`${XANO}/list_jobs_for_office_map?region=${currentRegion}&limit=200`);
      const d = await r.json();
      items = (d && d.items) || [];
    } catch (_) { status.textContent = 'fetch failed'; return; }
    // ONLY the unscheduled jobs — the ones we still need to place. A scheduled
    // job is already handled; showing it just clutters the cluster view. (Teddy)
    items = items.filter(it => !it.scheduled_start);
    status.textContent = `${items.length} to schedule — locating…`;
    const reqRegion = currentRegion;            // guard against a region switch mid-load
    let plotted = 0; const coords = [];
    for (let i = 0; i < items.length; i++) {
      if (reqRegion !== currentRegion) return;  // user switched — abandon this pass
      const it = items[i];
      const addr = [it.address, it.city, it.state, it.zip].filter(Boolean).join(', ');
      if (!addr || it.job_id == null) continue;
      const ll = await geocode(addr);
      if (!ll || reqRegion !== currentRegion) { if (reqRegion !== currentRegion) return; continue; }
      plotted++;
      const icon = L.divIcon({ className: '', html: `<div class="antmap-pin" data-pinjob="${it.job_id}">${plotted}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      const m = L.marker([ll.lat, ll.lng], { icon }).addTo(markerLayer);
      const cname = ((it.customer_first || '') + ' ' + (it.customer_last || '')).trim() || '(no name)';
      m.bindPopup(`<div style="font-size:13px;line-height:1.4"><b>${esc(cname)}</b><br>${esc(it.appliance || 'appliance')}<br>${esc(addr)}<br>needs scheduling<br><a href="/office-board.html?job=${it.job_id}" style="color:#1e6fdb;font-weight:600;text-decoration:none">Open job tile →</a></div>`);
      pinsByJob[String(it.job_id)] = { marker: m, ll };
      coords.push([ll.lat, ll.lng]);
      if (plotted % 5 === 0) status.textContent = `${plotted}/${items.length} located…`;
    }
    if (coords.length > 1) map.fitBounds(coords, { padding: [30, 30] });
    else if (coords.length === 1) map.setView(coords[0], 12);
    status.textContent = plotted ? `${plotted} to schedule` : 'nothing to schedule here 🎉';
  }

  // ── Hover linkage: any job tile with data-id → flash its pin ────
  let lastHover = 0, lastId = '';
  function wireHover() {
    document.addEventListener('mouseover', (e) => {
      if (!leafletReady || !panel.classList.contains('open')) return;
      // Board + needs-scheduled tiles use data-id; the calendar blocks use
      // data-job-id. Match either so hover works on every schedule surface.
      const el = e.target && e.target.closest && e.target.closest('[data-id],[data-job-id]');
      if (!el) return;
      const id = String(el.getAttribute('data-id') || el.getAttribute('data-job-id') || '');
      if (!id || id === lastId) return;
      const now = Date.now(); if (now - lastHover < 120) return; lastHover = now; lastId = id;
      focusJob(id);
    }, { passive: true });
  }

  function focusJob(jobId) {
    const p = pinsByJob[String(jobId)];
    if (!p || !map) return;
    map.panTo(p.ll, { animate: true, duration: 0.25 });
    p.marker.openPopup();
    const el = p.marker.getElement && p.marker.getElement();
    const dot = el && el.querySelector && el.querySelector('.antmap-pin');
    if (dot) { dot.classList.remove('flash'); void dot.offsetWidth; dot.classList.add('flash'); }
  }
  // Public: let pages focus a pin directly if they want.
  window.AntJobsMap = { focus: focusJob, open: () => setOpen(true) };

  // ── geocode (Nominatim, 30-day localStorage cache, rate-limited) ─
  let _lastGeo = 0;
  async function geocode(address) {
    const key = GEO_PREFIX + hash(address);
    try { const raw = localStorage.getItem(key); if (raw) { const p = JSON.parse(raw); if (p && (Date.now() - p.ts) < GEO_TTL_MS) return { lat: p.lat, lng: p.lng }; } } catch (_) {}
    const wait = Math.max(0, (_lastGeo + 1100) - Date.now()); _lastGeo = Date.now() + wait;
    await sleep(wait);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`);
      const d = await res.json();
      if (!Array.isArray(d) || !d.length) return null;
      const lat = parseFloat(d[0].lat), lng = parseFloat(d[0].lon);
      if (!isFinite(lat) || !isFinite(lng)) return null;
      try { localStorage.setItem(key, JSON.stringify({ lat, lng, ts: Date.now() })); } catch (_) {}
      return { lat, lng };
    } catch (_) { return null; }
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return String(Math.abs(h)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  mount();
})();
