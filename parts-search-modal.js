// Self-contained parts search modal. Drop the script tag onto any per-job
// page; call window.PartsSearch.open({brand, model_number, failed_component})
// to launch with pre-filled values. Calls /.netlify/functions/find-part-number
// → renders ranked candidates with confidence tiers + click-to-copy.
//
// Multi-source ready: when more sources are added to the backend, the UI
// shows N-of-M agreement automatically. Today: Claude solo (all LOW tier).

(function (root) {
  'use strict';

  const FN_BASE = '/.netlify/functions/find-part-number';
  const APPLY_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/apply_part_to_tdr';

  // Track the currently-launched modal's job_id so the Apply button
  // can write to that job's TDR. Set by open() when prefill.job_id given.
  let currentJobId = 0;
  let currentRole = 'office';

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) Object.entries(props).forEach(([k, v]) => {
      if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e[k.toLowerCase()] = v;
      else e.setAttribute(k, v);
    });
    (children || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  function tierColor(tier) {
    return {
      HIGH:   { border: 'rgba(76,210,192,0.5)',   bg: 'rgba(76,210,192,0.10)',  text: '#4cd2c0' },
      MEDIUM: { border: 'rgba(255,193,7,0.5)',    bg: 'rgba(255,193,7,0.10)',   text: '#ffc107' },
      LOW:    { border: 'rgba(76,167,255,0.4)',   bg: 'rgba(76,167,255,0.08)',  text: '#4ca7ff' },
      GUESS:  { border: 'rgba(255,107,107,0.4)',  bg: 'rgba(255,107,107,0.08)', text: '#ff6b6b' },
    }[tier] || { border: '#444', bg: '#222', text: '#aaa' };
  }

  function tierBadge(tier, agreeing) {
    const c = tierColor(tier);
    const label = tier === 'HIGH' ? `${agreeing}/${agreeing} sources agree`
      : tier === 'MEDIUM' ? `${agreeing}/N sources agree`
      : tier === 'GUESS' ? 'GUESS — low confidence'
      : '1 source (Claude solo)';
    return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; font-size:10px; font-weight:700; letter-spacing:0.5px; margin-left:6px;">${tier} · ${label}</span>`;
  }

  function moneyRange(lo, hi) {
    if (!lo && !hi) return '';
    if (lo && hi) return `$${Math.round(lo)}–$${Math.round(hi)}`;
    return '$' + Math.round(lo || hi);
  }

  function copyButton(value) {
    return `<button class="ps-copy" data-copy="${(value || '').replace(/"/g, '&quot;')}" style="background:transparent; border:1px solid #444; color:#aaa; padding:3px 8px; border-radius:5px; font-size:11px; cursor:pointer; margin-left:6px; font-family:monospace;">📋 copy</button>`;
  }

  function renderCandidate(c, isPrimary) {
    const tier = c.confidence_tier || 'LOW';
    const tColor = tierColor(tier);
    const supersedes = (c.supersedes || []).length ? `<div style="font-size:11px; color:#9aa1ad; margin-top:4px;">Supersedes: ${(c.supersedes || []).join(', ')}</div>` : '';
    const aftermarket = (c.aftermarket_equivalents || []).length ? `<div style="font-size:11px; color:#9aa1ad; margin-top:2px;">Aftermarket: ${(c.aftermarket_equivalents || []).join(', ')}</div>` : '';
    return `
      <div style="background:${tColor.bg}; border:1px solid ${tColor.border}; border-radius:10px; padding:12px 14px; margin-bottom:10px; ${isPrimary ? '' : 'opacity:0.85;'}">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div style="font-family:monospace; font-size:18px; font-weight:700; color:#fff;">${c.part_number || '(no part #)'}</div>
          ${tierBadge(tier, c.sources_agreeing || 1)}
        </div>
        <div style="font-size:13px; color:#e8eaf0; margin-top:4px;">${c.name || ''}</div>
        ${supersedes}${aftermarket}
        <div style="font-size:12px; color:#cbd2e0; margin-top:8px; line-height:1.4;">${c.reasoning || ''}</div>
        <div style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <span style="font-size:12px; color:#74e3c4;">${moneyRange(c.estimated_price_usd_low, c.estimated_price_usd_high)}</span>
          ${copyButton(c.part_number)}
          ${c.part_number ? `<a href="https://www.searspartsdirect.com/search?q=${encodeURIComponent(c.part_number)}" target="_blank" rel="noopener" style="font-size:11px; color:#4ca7ff;">verify on Sears ↗</a>` : ''}
          ${c.part_number ? `<a href="https://www.repairclinic.com/Shop-For-Parts?search=${encodeURIComponent(c.part_number)}" target="_blank" rel="noopener" style="font-size:11px; color:#4ca7ff;">RepairClinic ↗</a>` : ''}
          ${c.part_number ? `<a href="https://www.appliancepartspros.com/search.aspx?searchterm=${encodeURIComponent(c.part_number)}" target="_blank" rel="noopener" style="font-size:11px; color:#4ca7ff;">PartsPros ↗</a>` : ''}
          ${currentJobId && c.part_number ? `<button class="ps-apply" data-part="${(c.part_number || '').replace(/"/g, '&quot;')}" data-tier="${tier}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" style="background:rgba(76,210,192,0.15); border:1px solid rgba(76,210,192,0.5); color:#4cd2c0; padding:4px 10px; border-radius:5px; font-size:11px; font-weight:700; cursor:pointer; margin-left:auto;">✓ Apply to TDR</button>` : ''}
        </div>
      </div>
    `;
  }

  function open(prefill) {
    const existing = document.getElementById('ps-modal');
    if (existing) existing.remove();

    // Capture job_id + role so the Apply button knows where to write.
    currentJobId = Number(prefill && prefill.job_id) || (window.Ant && window.Ant.jobId ? window.Ant.jobId() : 0) || 0;
    currentRole = (window.Ant && window.Ant.role) ? window.Ant.role() : 'office';

    const overlay = el('div', {
      id: 'ps-modal',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
        zIndex: '99999', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '20px', overflowY: 'auto',
      },
    });

    overlay.innerHTML = `
      <div style="background:#13161c; border:1px solid #2a3040; border-radius:14px; max-width:640px; width:100%; margin-top:40px; padding:18px 22px; color:#e8edf5; font-family:'IBM Plex Mono', monospace;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h2 style="margin:0; font-size:18px; font-family:'Bebas Neue', sans-serif; letter-spacing:0.06em; color:#74e3c4;">🔧 PART NUMBER FINDER</h2>
          <button id="ps-close" style="background:transparent; border:0; color:#aaa; font-size:22px; cursor:pointer;">×</button>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div>
            <label style="font-size:11px; color:#9aa1ad; text-transform:uppercase;">Brand</label>
            <input id="ps-brand" type="text" placeholder="Whirlpool" style="width:100%; padding:9px 11px; background:#0a0d12; color:#fff; border:1px solid #2a3040; border-radius:7px; font-size:14px; font-family:inherit;">
          </div>
          <div>
            <label style="font-size:11px; color:#9aa1ad; text-transform:uppercase;">Appliance</label>
            <input id="ps-appliance" type="text" placeholder="washer / dryer / refrigerator" style="width:100%; padding:9px 11px; background:#0a0d12; color:#fff; border:1px solid #2a3040; border-radius:7px; font-size:14px; font-family:inherit;">
          </div>
          <div>
            <label style="font-size:11px; color:#9aa1ad; text-transform:uppercase;">Model #</label>
            <input id="ps-model" type="text" placeholder="WTW5000DW1" style="width:100%; padding:9px 11px; background:#0a0d12; color:#fff; border:1px solid #2a3040; border-radius:7px; font-size:14px; font-family:inherit;">
          </div>
          <div>
            <label style="font-size:11px; color:#9aa1ad; text-transform:uppercase;">Failed component</label>
            <input id="ps-component" type="text" placeholder="drain pump" style="width:100%; padding:9px 11px; background:#0a0d12; color:#fff; border:1px solid #2a3040; border-radius:7px; font-size:14px; font-family:inherit;">
          </div>
        </div>
        <label style="font-size:11px; color:#9aa1ad; text-transform:uppercase;">Symptoms (optional)</label>
        <textarea id="ps-symptoms" placeholder="leaking water, not draining, etc." style="width:100%; padding:9px 11px; background:#0a0d12; color:#fff; border:1px solid #2a3040; border-radius:7px; font-size:14px; font-family:inherit; min-height:50px; resize:vertical;"></textarea>

        <button id="ps-search" style="width:100%; padding:12px; background:#74e3c4; color:#0a0d12; border:0; border-radius:7px; font-size:15px; font-weight:700; font-family:'Bebas Neue',sans-serif; letter-spacing:0.05em; cursor:pointer; margin-top:14px;">SEARCH</button>

        <div id="ps-results" style="margin-top:16px;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Pre-fill
    if (prefill) {
      const m = { brand: 'ps-brand', appliance_type: 'ps-appliance', model_number: 'ps-model', failed_component: 'ps-component', symptoms: 'ps-symptoms' };
      Object.entries(m).forEach(([k, id]) => {
        const v = prefill[k];
        const elx = document.getElementById(id);
        if (elx && v) elx.value = v;
      });
    }

    document.getElementById('ps-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('ps-search').addEventListener('click', async () => {
      const btn = document.getElementById('ps-search');
      const results = document.getElementById('ps-results');
      btn.disabled = true;
      btn.textContent = 'SEARCHING…';
      results.innerHTML = '<div style="text-align:center; padding:20px; color:#9aa1ad;">Querying sources…</div>';
      const payload = {
        brand: document.getElementById('ps-brand').value.trim(),
        appliance_type: document.getElementById('ps-appliance').value.trim(),
        model_number: document.getElementById('ps-model').value.trim(),
        failed_component: document.getElementById('ps-component').value.trim(),
        symptoms: document.getElementById('ps-symptoms').value.trim(),
      };
      try {
        const r = await fetch(FN_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!data.success) {
          results.innerHTML = `<div style="background:rgba(255,107,107,0.12); border:1px solid #ff6b6b; padding:12px; border-radius:8px; color:#ff6b6b;">Search failed: ${data.error || 'unknown'}${data.detail ? ' — ' + data.detail : ''}</div>`;
          return;
        }
        const candidates = data.candidates || [];
        if (candidates.length === 0) {
          results.innerHTML = `<div style="background:#222; padding:16px; border-radius:8px; color:#aaa; text-align:center;">No candidates returned. Try more specific inputs.</div>`;
          return;
        }
        let html = '';
        html += `<div style="font-size:11px; color:#9aa1ad; margin-bottom:10px; padding:8px 10px; background:#0a0d12; border-radius:6px; border:1px solid #1f2530;">📡 Sources queried: ${data.sources_queried.join(', ')}<br>${data.note}</div>`;
        if (data.confidence_notes) html += `<div style="font-size:12px; color:#cbd2e0; margin-bottom:12px; padding:8px; background:rgba(255,193,7,0.06); border:1px solid rgba(255,193,7,0.25); border-radius:6px;">💡 ${data.confidence_notes}</div>`;
        candidates.forEach((c, i) => { html += renderCandidate(c, i === 0); });
        results.innerHTML = html;
        results.querySelectorAll('.ps-copy').forEach((b) => {
          b.addEventListener('click', () => {
            const v = b.dataset.copy || '';
            navigator.clipboard.writeText(v).then(() => {
              b.textContent = '✓ copied';
              setTimeout(() => { b.textContent = '📋 copy'; }, 1500);
            });
          });
        });
        // Apply-to-TDR wiring — writes part_number + confidence_tier to
        // the job's latest TDR (creates one if missing). Visible only
        // when modal was opened with a job_id.
        results.querySelectorAll('.ps-apply').forEach((b) => {
          b.addEventListener('click', async () => {
            if (!currentJobId) return;
            const part = b.dataset.part || '';
            const tier = b.dataset.tier || 'LOW';
            const name = b.dataset.name || '';
            b.disabled = true;
            b.textContent = 'Applying…';
            try {
              const r = await fetch(APPLY_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  job_id: currentJobId,
                  part_number: part,
                  confidence_tier: tier,
                  part_name: name,
                  source_summary: 'parts_search_modal',
                  applied_by: currentRole,
                }),
              });
              const d = await r.json();
              if (d.success) {
                b.textContent = `✓ Applied (${tier})`;
                b.style.background = 'rgba(76,210,192,0.30)';
                // Tell any subscribers (e.g. the spine) so they re-render
                window.dispatchEvent(new CustomEvent('ant:state-changed', { detail: { source: 'parts_apply', job_id: currentJobId, part_number: part, confidence_tier: tier } }));
              } else {
                b.textContent = '⚠ ' + (d.error || 'failed');
                b.disabled = false;
              }
            } catch (err) {
              b.textContent = '⚠ ' + (err.message || 'network');
              b.disabled = false;
            }
          });
        });
      } catch (err) {
        results.innerHTML = `<div style="background:rgba(255,107,107,0.12); border:1px solid #ff6b6b; padding:12px; border-radius:8px; color:#ff6b6b;">Network error: ${err.message || err}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'SEARCH';
      }
    });
  }

  // Render a confidence badge next to a part number. Clickable —
  // tapping a LOW/GUESS badge reopens the search modal pre-filled so
  // Danielle (or whoever) can re-verify before warranty submission.
  // Use anywhere: PartsSearch.renderBadge('LOW') → returns HTML string.
  function renderBadge(tier, opts) {
    const t = (tier || 'UNVERIFIED').toUpperCase();
    const c = tierColor(t);
    const reopen = opts && opts.reopenPrefill;
    const label =
      t === 'HIGH'        ? 'verified · HIGH' :
      t === 'MEDIUM'      ? 'verified · MED' :
      t === 'LOW'         ? '⚠ LOW · re-verify' :
      t === 'GUESS'       ? '🔴 GUESS · verify' :
                            '⚪ unverified';
    const reopenAttr = reopen ? `data-reopen='${JSON.stringify(reopen).replace(/'/g, '&#39;')}'` : '';
    const cursor = reopen && (t === 'LOW' || t === 'GUESS' || t === 'UNVERIFIED') ? 'cursor:pointer;' : '';
    return `<span class="ps-tier-badge" ${reopenAttr} title="${reopen ? 'Tap to re-search' : ''}" style="display:inline-block; padding:2px 9px; border-radius:11px; background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; font-size:10px; font-weight:700; font-family:monospace; ${cursor}">${label}</span>`;
  }

  // Wire delegated click handler so any rendered badge can re-open the
  // search modal with the same prefill — useful on warranty-review or
  // teddy-tdr-tool where Danielle needs to re-verify a LOW part.
  document.addEventListener('click', (e) => {
    const badge = e.target && e.target.closest && e.target.closest('.ps-tier-badge[data-reopen]');
    if (!badge) return;
    try {
      const prefill = JSON.parse(badge.dataset.reopen);
      open(prefill);
    } catch (_) {}
  });

  root.PartsSearch = { open, renderBadge };
})(window);
