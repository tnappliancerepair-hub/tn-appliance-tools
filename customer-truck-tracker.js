// Customer-portal live truck tracker. Polls get_tech_position_for_customer
// every 20s; when the tech is en-route, renders a Leaflet/OSM map with a
// pulsing truck marker heading toward the customer's pin, with ETA + last-
// update info. Hidden when the job isn't in active "tech on the way" state.
//
// Designed to be cool but not flashy — clean dark map theme, smooth marker
// transitions, distance + ETA prominent. Reads job_id + last4 from the
// portal's sessionStorage (same auth as customer-ant.js).
(function () {
  'use strict';
  if (window.__truckTrackerInjected) return;
  window.__truckTrackerInjected = true;

  const params = new URLSearchParams(window.location.search);
  const JOB_ID = parseInt(params.get('job_id') || '0', 10);
  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  const GEO_PREFIX = 'tn_geo_v1:';

  if (!JOB_ID) return;

  function getLast4() {
    const fromUrl = (params.get('last4') || params.get('phone_last4') || '').replace(/\D/g, '').slice(-4);
    if (fromUrl) return fromUrl;
    try {
      const raw = sessionStorage.getItem('customer_portal_auth');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.last4 && (!p.job_id || p.job_id === JOB_ID)) return String(p.last4).replace(/\D/g, '').slice(-4);
      }
    } catch (_) {}
    return '';
  }

  let LAST4 = getLast4();
  let mapEl = null;
  let map = null;
  let truckMarker = null;
  let customerMarker = null;
  let routeLine = null;
  let customerLatLng = null;     // geocoded once
  let pollTimer = null;
  let lastPosition = null;
  let scriptLoadingLeaflet = false;

  // Wait for auth + portal app to render before injecting
  function waitForAuthAndInject() {
    LAST4 = getLast4();
    if (!LAST4) {
      setTimeout(waitForAuthAndInject, 1500);
      return;
    }
    // Wait one second after auth so the portal app has time to render
    setTimeout(injectContainer, 1000);
  }

  function injectContainer() {
    if (document.getElementById('truck-tracker')) return;
    const target = document.querySelector('main') || document.querySelector('.container') || document.body;
    const sec = document.createElement('section');
    sec.id = 'truck-tracker';
    sec.style.cssText = `
      display:none; margin:16px auto; max-width:560px;
      background:#0e1118; color:#e8edf5; border-radius:14px;
      box-shadow:0 8px 28px rgba(0,0,0,0.35); overflow:hidden;
      font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    sec.innerHTML = `
      <div style="padding:14px 18px;background:linear-gradient(135deg,#1e6fdb,#103a73);display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;animation:tt-pulse 1.4s ease-in-out infinite;">🚚</div>
        <div style="flex:1;">
          <div id="tt-title" style="font-weight:700;font-size:15px;">Your tech is on the way</div>
          <div id="tt-sub" style="font-size:12px;opacity:0.85;margin-top:2px;">connecting...</div>
        </div>
        <div id="tt-eta" style="text-align:right;font-weight:700;font-size:18px;line-height:1;color:#fff;"></div>
      </div>
      <div id="tt-map" style="height:280px;background:#0a0d14;"></div>
      <div id="tt-status" style="padding:10px 16px;font-size:11px;opacity:0.7;border-top:1px solid #2a3040;font-family:ui-monospace,Menlo,monospace;"></div>
    `;
    // Inject keyframes for pulsing
    const css = document.createElement('style');
    css.textContent = `
      @keyframes tt-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
      @keyframes tt-ping { 0%{box-shadow:0 0 0 0 rgba(30,111,219,0.7)} 70%{box-shadow:0 0 0 18px rgba(30,111,219,0)} 100%{box-shadow:0 0 0 0 rgba(30,111,219,0)} }
      .tt-truck-icon{ background:#1e6fdb; color:white; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; font-size:22px; border:3px solid white; box-shadow:0 4px 12px rgba(0,0,0,0.4); animation:tt-ping 1.8s infinite; }
      .tt-cust-icon{ background:#ff9f43; color:white; border-radius:50% 50% 50% 0; transform:rotate(-45deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-size:18px; border:3px solid white; box-shadow:0 4px 12px rgba(0,0,0,0.4); }
      .tt-cust-icon > span{ transform:rotate(45deg); }
    `;
    document.head.appendChild(css);
    target.insertBefore(sec, target.firstChild);
    mapEl = document.getElementById('tt-map');

    // Start polling immediately
    poll();
    pollTimer = setInterval(poll, 20_000);
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (scriptLoadingLeaflet) return new Promise((resolve) => {
      const check = setInterval(() => { if (window.L) { clearInterval(check); resolve(); } }, 100);
    });
    scriptLoadingLeaflet = true;
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const sc = document.createElement('script');
      sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('leaflet failed'));
      document.head.appendChild(sc);
    });
  }

  async function poll() {
    if (!LAST4) return;
    let data;
    try {
      const res = await fetch(`${XANO_BASE}/get_tech_position_for_customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: JOB_ID, phone_last4: LAST4 }),
      });
      if (!res.ok) return;
      data = await res.json();
    } catch (_) { return; }

    const sec = document.getElementById('truck-tracker');
    if (!sec) return;
    const sub = document.getElementById('tt-sub');
    const status = document.getElementById('tt-status');
    const eta = document.getElementById('tt-eta');

    if (!data.eligible || !data.position) {
      // Either job hasn't started OR completed — hide the tracker
      sec.style.display = 'none';
      return;
    }
    sec.style.display = 'block';

    const lat = parseFloat(data.position.lat);
    const lng = parseFloat(data.position.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;

    const techFirst = data.tech_first_name || 'Your tech';
    sub.textContent = `${techFirst} · live position ${data.age_seconds}s ago`;
    if (data.eta_minutes != null) {
      eta.textContent = `~${data.eta_minutes}min`;
    } else {
      eta.textContent = '';
    }

    await loadLeaflet();
    if (!map) {
      map = window.L.map('tt-map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 13);
      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
      // Get customer pin location — geocode their job's service address
      geocodeCustomer().then((ll) => {
        if (ll) {
          customerLatLng = ll;
          const cIcon = window.L.divIcon({ className:'', html:'<div class="tt-cust-icon"><span>🏠</span></div>', iconSize:[32,32], iconAnchor:[16,32] });
          customerMarker = window.L.marker([ll.lat, ll.lng], { icon: cIcon }).addTo(map);
          fitBoundsIfBoth();
        }
      });
    }

    const tIcon = window.L.divIcon({ className:'', html:'<div class="tt-truck-icon">🚚</div>', iconSize:[36,36], iconAnchor:[18,18] });
    if (!truckMarker) {
      truckMarker = window.L.marker([lat, lng], { icon: tIcon }).addTo(map);
    } else {
      truckMarker.setLatLng([lat, lng]);
    }

    // Distance line from truck to customer
    if (customerLatLng) {
      if (routeLine) routeLine.remove();
      routeLine = window.L.polyline([[lat,lng],[customerLatLng.lat,customerLatLng.lng]], { color:'#1e6fdb', weight:3, opacity:0.5, dashArray:'8,8' }).addTo(map);
      const distM = window.L.latLng(lat, lng).distanceTo(window.L.latLng(customerLatLng.lat, customerLatLng.lng));
      const miles = (distM / 1609.34).toFixed(1);
      status.textContent = `${miles} mi away · accuracy ±${data.position.accuracy_m || '?'}m`;
    } else {
      status.textContent = `live · ${data.age_seconds}s old`;
    }
    fitBoundsIfBoth();
    lastPosition = { lat, lng, ts: Date.now() };
  }

  function fitBoundsIfBoth() {
    if (!map || !truckMarker || !customerMarker) return;
    map.fitBounds(window.L.latLngBounds(truckMarker.getLatLng(), customerMarker.getLatLng()), { padding:[36,36] });
  }

  async function geocodeCustomer() {
    // Customer's service address is on the job. Use the customer-portal's
    // job-view endpoint (already auth'd) to fetch it.
    try {
      const res = await fetch(`${XANO_BASE}/get_customer_job_view`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ job_id: JOB_ID, phone_last4: LAST4 }),
      });
      const data = await res.json();
      const addr = [data.service_address, data.service_city, data.service_state, data.service_zip].filter(Boolean).join(', ');
      if (!addr) return null;
      // Cache geocoded result
      const key = GEO_PREFIX + simpleHash(addr);
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && (Date.now() - p.ts) < 30 * 24 * 3600 * 1000) return { lat: p.lat, lng: p.lng };
        }
      } catch(_){}
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=us`);
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const lat = parseFloat(arr[0].lat), lng = parseFloat(arr[0].lon);
      try { localStorage.setItem(key, JSON.stringify({ lat, lng, ts: Date.now() })); } catch(_){}
      return { lat, lng };
    } catch (_) { return null; }
  }

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return String(Math.abs(h));
  }

  if (document.body) waitForAuthAndInject();
  else document.addEventListener('DOMContentLoaded', waitForAuthAndInject);
})();
