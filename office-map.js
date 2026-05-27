// Office map widget. Adds a "🗺 Map" button to the office-search bar.
// On click, opens a fullscreen modal with a Leaflet/OSM map showing all
// active jobs as numbered pins. Click a pin → opens job-detail.html.
//
// Geocoding via Nominatim with 30-day localStorage cache (same pattern
// as tech-daily-dashboard.html). Rate-limited ~1.1s between hits.
(function () {
  'use strict';
  if (window.__officeMapInjected) return;
  window.__officeMapInjected = true;

  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  const GEO_PREFIX = 'tn_geo_v1:';
  const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  // Inject the Map button next to the TN/LA toggle in the search bar
  function attach() {
    const widget = document.querySelector('.ofc-search-bar');
    if (!widget) { return setTimeout(attach, 200); }
    if (widget.querySelector('.ofc-map-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'ofc-map-btn';
    btn.textContent = '🗺 Map';
    btn.style.cssText = 'background:#1e6fdb;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;margin-left:6px;font-family:inherit;';
    btn.onclick = openMapModal;
    // Insert into the inner flex row (after the search input)
    const row = widget.querySelector('div[style*="display: flex"]');
    if (row) row.appendChild(btn);
    else widget.appendChild(btn);
  }
  attach();

  function openMapModal() {
    if (document.getElementById('ofcMapModal')) {
      document.getElementById('ofcMapModal').style.display = 'flex';
      return;
    }
    const modal = document.createElement('div');
    modal.id = 'ofcMapModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(14,17,24,0.9);display:flex;align-items:stretch;justify-content:stretch;padding:0;';
    modal.innerHTML = `
      <div style="background:#fff;width:100%;height:100%;display:flex;flex-direction:column;">
        <div style="background:#1e6fdb;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;">
          <span style="font-size:16px;font-weight:700;flex:1;">🗺 Job Map</span>
          <span id="ofcMapStatus" style="font-size:12px;font-family:ui-monospace,Menlo,monospace;opacity:0.85;">loading…</span>
          <button id="ofcMapClose" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Close</button>
        </div>
        <div id="ofcMapBody" style="flex:1;background:#e8ecf2;position:relative;">
          <div id="ofcMapEl" style="width:100%;height:100%;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('ofcMapClose').onclick = () => { modal.style.display = 'none'; };

    // Lazy-load Leaflet CSS + JS, then render
    loadLeaflet().then(() => renderMap()).catch(e => {
      document.getElementById('ofcMapStatus').textContent = 'leaflet failed: ' + (e && e.message || 'unknown');
    });
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const sc = document.createElement('script');
      sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('leaflet script load failed'));
      document.head.appendChild(sc);
    });
  }

  async function renderMap() {
    const status = document.getElementById('ofcMapStatus');
    const region = (location.pathname || '').toLowerCase().includes('office-la') ? 'la' : 'tn';
    status.textContent = `fetching ${region} jobs…`;
    let data;
    try {
      const r = await fetch(`${XANO_BASE}/list_jobs_for_office_map?region=${region}&limit=200`);
      data = await r.json();
    } catch (e) {
      status.textContent = 'fetch failed';
      return;
    }
    const items = (data && data.items) || [];
    status.textContent = `${items.length} jobs — geocoding…`;

    const center = region === 'la' ? [30.45, -91.15] : [36.0, -86.7]; // Baton Rouge / Nashville
    const map = L.map('ofcMapEl', { zoomControl: true, attributionControl: false }).setView(center, 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OSM' }).addTo(map);

    let plotted = 0;
    const coords = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const addr = [it.address, it.city, it.state, it.zip].filter(Boolean).join(', ');
      if (!addr) continue;
      const ll = await geocode(addr);
      if (!ll) continue;
      plotted++;
      const color = it.scheduled_start ? '#1aa05c' : '#e67e22'; // green=scheduled, orange=needs scheduling
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#fff;font-weight:700;font-size:11px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${plotted}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const m = L.marker([ll.lat, ll.lng], { icon }).addTo(map);
      const cname = (it.customer_first + ' ' + it.customer_last).trim() || '(no name)';
      const when = it.scheduled_start ? new Date(it.scheduled_start).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'needs scheduling';
      const popup = `<div style="font-size:13px;line-height:1.4;"><b>${escapeHtml(cname)}</b><br>${escapeHtml(it.appliance || 'appliance')} · ${escapeHtml(it.warranty_company || '')}<br>${escapeHtml(addr)}<br>${escapeHtml(when)}<br><a href="/job-detail.html?job_id=${it.job_id}" target="_blank" style="color:#1e6fdb;text-decoration:none;font-weight:600;">Open job →</a></div>`;
      m.bindPopup(popup);
      coords.push([ll.lat, ll.lng]);
      if (plotted % 5 === 0) status.textContent = `${plotted}/${items.length} pinned…`;
    }
    if (coords.length > 1) map.fitBounds(coords, { padding: [40, 40] });
    else if (coords.length === 1) map.setView(coords[0], 12);
    status.textContent = `${plotted} pins · green=scheduled · orange=needs scheduling`;
  }

  async function geocode(address) {
    const key = GEO_PREFIX + simpleHash(address);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (Date.now() - parsed.ts) < GEO_TTL_MS) return { lat: parsed.lat, lng: parsed.lng };
      }
    } catch (_) {}
    await sleep(geocodeCursor());
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
      const res = await fetch(url);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
      if (!isFinite(lat) || !isFinite(lng)) return null;
      localStorage.setItem(key, JSON.stringify({ lat, lng, ts: Date.now() }));
      return { lat, lng };
    } catch (_) { return null; }
  }

  let _lastGeo = 0;
  function geocodeCursor() {
    const now = Date.now();
    const next = Math.max(now, _lastGeo + 1100);
    _lastGeo = next;
    return Math.max(0, next - now);
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return String(Math.abs(h));
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
})();
