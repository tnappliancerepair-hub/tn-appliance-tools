// Reusable email-intake summary modal. Drop-in JS module exposing
// window.EmailIntakeModal.open() — opens overlay, fetches the same
// /get_email_intake_summary endpoint that the standalone page uses,
// renders 4 tier tiles + email-only jobs table + all-sources table
// + warranty watcher events.
//
// Drop into any office surface with: <script src="/email-intake-modal.js" defer></script>
// Then add a button: onclick="EmailIntakeModal.open()"

(function (root) {
  'use strict';

  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  let currentHours = 24;

  function el(s) { return document.createElement(s); }

  function fmtTime(ms) {
    if (!ms) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(ms));
    } catch (_) { return ''; }
  }

  function esc(s) {
    return String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function srcBadge(src) {
    const s = (src || '').toLowerCase();
    const map = {
      ahs_email:           { label: 'AHS Email',         color: '#4ca7ff', bg: 'rgba(76,167,255,0.15)' },
      servicepower_email:  { label: 'SP Email',          color: '#f5a623', bg: 'rgba(245,166,35,0.15)' },
      allstate_email:      { label: 'Allstate Email',    color: '#ff6b6b', bg: 'rgba(255,107,107,0.15)' },
      web_chat:            { label: 'Web Chat',          color: '#4cd2c0', bg: 'rgba(76,210,192,0.15)' },
      manual:              { label: 'Manual',            color: '#e8eaf0', bg: 'rgba(255,255,255,0.05)' },
    };
    const m = map[s] || { label: src || '?', color: '#8a93aa', bg: 'rgba(138,147,170,0.15)' };
    return `<span style="display:inline-block; padding:2px 7px; border-radius:8px; font-size:10px; font-weight:700; color:${m.color}; background:${m.bg};">${m.label}</span>`;
  }

  function tile(label, num, sub, color) {
    return `
      <div style="background:#0a0d12; border:1px solid #2a3040; border-radius:8px; padding:12px;">
        <div style="font-family:'IBM Plex Mono',monospace; font-size:10px; color:#9aa1ad; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">${label}</div>
        <div style="font-family:'Bebas Neue',sans-serif; font-size:34px; line-height:1; color:${color || '#e8eaf0'};">${num}</div>
        ${sub ? `<div style="font-size:11px; color:#9aa1ad; margin-top:4px; font-family:'IBM Plex Mono',monospace;">${sub}</div>` : ''}
      </div>`;
  }

  function jobsTable(jobs) {
    if (!jobs || jobs.length === 0) return '<div style="padding:18px; text-align:center; color:#9aa1ad; font-style:italic;">No jobs in this window.</div>';
    return `
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Job</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">When</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Source</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Vendor / Claim</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Problem</th>
            <th style="padding:6px 10px; text-align:right; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.map(j => `
            <tr style="cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''" onclick="if(event.target.tagName!=='A'&&event.target.tagName!=='BUTTON')window.open('/job-detail.html?job_id=${j.id}','_blank')">
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace;"><a href="/job-detail.html?job_id=${j.id}" target="_blank" style="color:#4ca7ff; text-decoration:none; font-weight:700;">#${j.id}</a></td>
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${fmtTime(j.created_at)}</td>
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530;">${srcBadge(j.intake_source)}</td>
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${esc(j.warranty_company || '')} ${j.claim_number ? '· ' + esc(j.claim_number) : ''}</td>
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530; color:#cbd2e0; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc((j.problem_summary || '').slice(0, 80))}</td>
              <td style="padding:7px 10px; border-bottom:1px solid #1f2530; text-align:right; white-space:nowrap;">
                <a href="/job-detail.html?job_id=${j.id}&edit=1" target="_blank" style="background:#ff8c61; color:#000; padding:5px 10px; border-radius:6px; font-size:12px; font-weight:700; text-decoration:none;">✏️ Fill in info</a>
                <button onclick="event.stopPropagation(); EmailIntakeModal.dismiss(${j.id}, this)" style="background:transparent; border:1px solid #ff6b6b; color:#ff6b6b; padding:5px 9px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; margin-left:4px;" title="Dismiss / remove from queue">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function watcherTable(rows) {
    if (!rows || rows.length === 0) return '<div style="padding:18px; text-align:center; color:#9aa1ad; font-style:italic;">No vendor confirmation emails parsed yet.<br><span style="font-size:11px;">Pollers fire every 10 min — patterns light up as vendor confirmations arrive.</span></div>';
    return `
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">When</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Action</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Vendor</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Status</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Claim</th>
            <th style="padding:6px 10px; text-align:left; border-bottom:1px solid #2a3040; color:#9aa1ad; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;">Subject</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const md = r.metadata || {};
            return `
              <tr>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${fmtTime(r.created_at)}</td>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${esc((r.action || '').replace('warranty_status_watcher_', ''))}</td>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${esc(md.vendor || '')}</td>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${esc(md.status || '')}</td>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; font-family:'IBM Plex Mono',monospace; color:#cbd2e0;">${esc(md.claim || '')}</td>
                <td style="padding:7px 10px; border-bottom:1px solid #1f2530; color:#cbd2e0; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc((md.subject || '').slice(0, 60))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  async function load(hours) {
    const body = document.getElementById('ei-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:40px; text-align:center; color:#9aa1ad;">Loading…</div>';
    try {
      const r = await fetch(`${XANO_BASE}/get_email_intake_summary?hours_back=${hours}`, { cache: 'no-store' });
      const d = await r.json();
      if (!d.success) {
        body.innerHTML = `<div style="padding:20px; color:#ff6b6b;">Load failed: ${esc(d.error || 'unknown')}</div>`;
        return;
      }
      const by = d.jobs_by_source || {};
      const emailTotal = Number(d.email_only_total || 0);
      const watcher = Number(d.watcher_total || 0);
      const partsGmail = Number(d.parts_orders_from_gmail || 0);
      const alertColor = emailTotal < 2 ? '#ff9d4a' : '#4cd2c0';

      const emailJobs = (d.recent_jobs || []).filter(j => {
        const s = (j.intake_source || '').toLowerCase();
        return s === 'ahs_email' || s === 'servicepower_email' || s === 'allstate_email';
      });

      body.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:18px;">
          ${tile('Email-only jobs', emailTotal, `AHS ${by.ahs_email||0} · SP ${by.servicepower_email||0}${by.allstate_email ? ' · Allstate '+by.allstate_email : ''}`, alertColor)}
          ${tile('All sources', d.jobs_total || 0, `HCP ${by.hcp_poll||0} · Web ${by.web_chat||0} · Manual ${by.manual||0}`)}
          ${tile('Parts deliveries (Gmail)', partsGmail, `total parts_orders: ${d.parts_orders_total || 0}`, partsGmail > 0 ? '#4cd2c0' : '')}
          ${tile('Warranty watcher (DRY-RUN)', watcher, 'vendor confirmations parsed')}
        </div>

        <div style="background:#0a0d12; border:1px solid #2a3040; border-radius:8px; padding:14px; margin-bottom:14px;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:17px; letter-spacing:0.04em; margin-bottom:10px; color:#e8eaf0;">Email-only jobs (AHS / SP / Allstate)</div>
          ${jobsTable(emailJobs)}
        </div>

        <div style="background:#0a0d12; border:1px solid #2a3040; border-radius:8px; padding:14px; margin-bottom:14px;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:17px; letter-spacing:0.04em; margin-bottom:10px; color:#e8eaf0;">All recent jobs (top 20)</div>
          ${jobsTable((d.recent_jobs || []).slice(0, 20))}
        </div>

        <div style="background:#0a0d12; border:1px solid #2a3040; border-radius:8px; padding:14px;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:17px; letter-spacing:0.04em; margin-bottom:10px; color:#e8eaf0;">Warranty status watcher — DRY-RUN matches</div>
          ${watcherTable((d.watcher_events || []).slice(0, 20))}
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div style="padding:20px; color:#ff6b6b;">Network error: ${esc(err.message || err)}</div>`;
    }
  }

  function open() {
    const existing = document.getElementById('email-intake-modal');
    if (existing) existing.remove();
    const overlay = el('div');
    overlay.id = 'email-intake-modal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:99999; display:flex; align-items:flex-start; justify-content:center; padding:20px; overflow-y:auto;';
    overlay.innerHTML = `
      <div style="background:#13161c; border:1px solid #2a3040; border-radius:14px; max-width:1100px; width:100%; margin-top:30px; padding:18px 22px; color:#e8edf5; font-family:'Inter',sans-serif;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
          <div style="font-size:22px;">📡</div>
          <h2 style="margin:0; font-family:'Bebas Neue',sans-serif; letter-spacing:0.06em; font-size:22px;">EMAIL INTAKE STATUS</h2>
          <div style="margin-left:auto; display:flex; gap:6px;">
            ${[
              [24,'24h'],[48,'48h'],[168,'7d'],[720,'30d']
            ].map(([h,l]) => `<button class="ei-h" data-h="${h}" style="background:${h===24?'#4cd2c0':'transparent'}; color:${h===24?'#0a0d12':'#e8eaf0'}; border:1px solid ${h===24?'#4cd2c0':'#2a3040'}; padding:6px 12px; border-radius:6px; font-family:'IBM Plex Mono',monospace; font-size:12px; cursor:pointer; ${h===24?'font-weight:700':''};">${l}</button>`).join('')}
            <button id="ei-refresh" style="background:transparent; border:1px solid #2a3040; color:#e8eaf0; padding:6px 12px; border-radius:6px; font-family:'IBM Plex Mono',monospace; font-size:12px; cursor:pointer; margin-left:10px;">↻</button>
            <button id="ei-close" style="background:transparent; border:0; color:#aaa; font-size:24px; cursor:pointer; margin-left:6px;">×</button>
          </div>
        </div>
        <div id="ei-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('ei-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('ei-refresh').addEventListener('click', () => load(currentHours));
    overlay.querySelectorAll('.ei-h').forEach((btn) => {
      btn.addEventListener('click', () => {
        const h = Number(btn.dataset.h);
        currentHours = h;
        overlay.querySelectorAll('.ei-h').forEach(b => {
          b.style.background = b.dataset.h === String(h) ? '#4cd2c0' : 'transparent';
          b.style.color = b.dataset.h === String(h) ? '#0a0d12' : '#e8eaf0';
          b.style.border = '1px solid ' + (b.dataset.h === String(h) ? '#4cd2c0' : '#2a3040');
          b.style.fontWeight = b.dataset.h === String(h) ? '700' : '400';
        });
        load(h);
      });
    });
    load(currentHours);
  }

  async function dismiss(jobId, btnEl) {
    if (!confirm('Remove job #' + jobId + ' from the queue?\n\n(It stays in the DB for audit — just gets hidden from active views.)')) return;
    let pw = '';
    try { pw = (JSON.parse(localStorage.getItem('tn_office_auth_v1') || '{}')).password || ''; } catch (_) {}
    if (!pw) pw = prompt('Office password:') || '';
    if (!pw) return;
    if (btnEl) btnEl.disabled = true;
    try {
      const r = await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/dismiss_job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, office_password: pw, reason: 'Dismissed from email intake' }),
      });
      const d = await r.json();
      if (d && d.success && btnEl) {
        const row = btnEl.closest('tr');
        if (row) {
          row.style.opacity = '0.3';
          row.style.transition = '0.3s';
          setTimeout(() => row.remove(), 350);
        }
      } else if (!d || !d.success) {
        alert('Dismiss failed: ' + ((d && d.error) || 'unknown'));
        if (btnEl) btnEl.disabled = false;
      }
    } catch (e) {
      alert('Network error');
      if (btnEl) btnEl.disabled = false;
    }
  }

  root.EmailIntakeModal = { open, dismiss };
})(window);
