// ant-tdr-card.js — the unified TDR surface.
//
// Auto-injects a floating "TDR" button (bottom-right) on any page that
// has a job_id in the URL. Tap opens a modal sheet showing the current
// state of the TDR: filled fields, blocking fields, photo count,
// warranty readiness percentage, role-appropriate actions.
//
// ONE include per page:   <script src="/ant-tdr-card.js" defer></script>
// No manual placeholder needed.
//
// Role auto-detection (used to filter actions, not field visibility):
//   tech-simple / tech-ant-chat / tech-daily-dashboard → 'tech'
//   customer-portal                                     → 'customer'
//   warranty-review / job-detail / teddy-tdr-tool       → 'office'
//   anything else                                       → 'office' (default)
(function () {
  if (window.__ANT_TDR_CARD_LOADED__) return;
  window.__ANT_TDR_CARD_LOADED__ = true;

  var XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  var POLL_MS = 6000;
  var jobId = null;
  var techId = null;
  var role = 'office';
  var lastData = null;
  var pollTimer = null;

  // ── Boot ───────────────────────────────────────────────────────────
  function init() {
    var p = new URLSearchParams(location.search);
    jobId = p.get('job_id') || p.get('job') || '';
    techId = p.get('tech_id') || '';
    if (!jobId) return; // No job context → no TDR surface
    role = detectRole();
    injectStyles();
    injectButton();
    injectModal();
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
    window.addEventListener('ant:state-changed', refresh);
  }

  function detectRole() {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('customer-portal') !== -1) return 'customer';
    if (path.indexOf('tech-') !== -1) return 'tech';
    if (path.indexOf('warranty-review') !== -1) return 'office';
    if (path.indexOf('teddy-tdr') !== -1) return 'office';
    if (path.indexOf('job-detail') !== -1) return 'office';
    var p = new URLSearchParams(location.search);
    var qrole = (p.get('role') || '').toLowerCase();
    if (qrole) return qrole;
    return 'office';
  }

  // ── Styles ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ant-tdr-card-styles')) return;
    var s = document.createElement('style');
    s.id = 'ant-tdr-card-styles';
    s.textContent = [
      '#ant-tdr-fab { position: fixed; bottom: calc(90px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); z-index: 10000; background: linear-gradient(135deg, #10b981, #047857); color: white; border: 0; border-radius: 28px; padding: 14px 22px 14px 18px; font-family: -apple-system, sans-serif; font-size: 15px; font-weight: 800; box-shadow: 0 8px 24px rgba(16,185,129,0.45); cursor: pointer; display: flex; align-items: center; gap: 10px; letter-spacing: 0.02em; transition: transform 0.1s, box-shadow 0.2s; }',
      '#ant-tdr-fab:active { transform: translateX(-50%) scale(0.96); }',
      '#ant-tdr-fab .pct { background: rgba(255,255,255,0.22); border-radius: 18px; padding: 4px 10px; font-size: 13px; font-weight: 900; }',
      '#ant-tdr-fab.ready { background: linear-gradient(135deg, #4ad991, #10b981); box-shadow: 0 8px 28px rgba(74,217,145,0.55); animation: antTdrPulse 1.6s ease-in-out infinite; }',
      '@keyframes antTdrPulse { 0%,100% { box-shadow: 0 8px 24px rgba(74,217,145,0.4); } 50% { box-shadow: 0 8px 36px rgba(74,217,145,0.9); } }',
      '#ant-tdr-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10001; display: none; align-items: flex-end; justify-content: center; }',
      '#ant-tdr-backdrop.open { display: flex; }',
      '#ant-tdr-sheet { background: #131720; color: #e6e9f0; width: 100%; max-width: 540px; max-height: 88vh; border-radius: 22px 22px 0 0; padding: 22px 18px 32px; overflow-y: auto; font-family: -apple-system, sans-serif; animation: antTdrSlide 0.28s ease-out; }',
      '@keyframes antTdrSlide { from { transform: translateY(40px); opacity: 0.2; } to { transform: translateY(0); opacity: 1; } }',
      '.ant-tdr-grab { width: 44px; height: 5px; background: #4a5060; border-radius: 4px; margin: -10px auto 16px; }',
      '.ant-tdr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }',
      '.ant-tdr-title { font-size: 18px; font-weight: 800; color: #e6e9f0; line-height: 1.25; }',
      '.ant-tdr-sub { font-size: 12px; color: #8a92a6; margin-top: 4px; }',
      '.ant-tdr-x { background: rgba(255,255,255,0.06); border: 0; color: #e6e9f0; width: 36px; height: 36px; border-radius: 18px; font-size: 22px; cursor: pointer; flex-shrink: 0; }',
      '.ant-tdr-progress { background: #1c2230; border-radius: 12px; height: 12px; overflow: hidden; margin: 12px 0 6px; }',
      '.ant-tdr-progress-bar { height: 100%; background: linear-gradient(90deg, #10b981, #4ad991); transition: width 0.4s ease; }',
      '.ant-tdr-status { font-size: 13px; color: #b8bfd0; margin-bottom: 18px; font-weight: 600; }',
      '.ant-tdr-status .ready-tag { color: #4ad991; }',
      '.ant-tdr-field { background: #1a1f2c; border: 1px solid #252b3a; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; display: flex; align-items: flex-start; gap: 12px; }',
      '.ant-tdr-field.filled { border-left: 4px solid #10b981; }',
      '.ant-tdr-field.empty { border-left: 4px solid #f5a623; background: rgba(245,166,35,0.06); }',
      '.ant-tdr-field-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }',
      '.ant-tdr-field-body { flex: 1; min-width: 0; }',
      '.ant-tdr-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a92a6; font-weight: 700; }',
      '.ant-tdr-field-value { font-size: 15px; color: #e6e9f0; margin-top: 3px; word-wrap: break-word; line-height: 1.35; }',
      '.ant-tdr-field-empty-prompt { font-size: 13px; color: #f5a623; margin-top: 3px; font-weight: 600; font-style: italic; }',
      '.ant-tdr-actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }',
      '.ant-tdr-btn { flex: 1; min-width: 140px; padding: 14px 18px; border-radius: 14px; border: 0; font-size: 15px; font-weight: 800; cursor: pointer; font-family: -apple-system, sans-serif; }',
      '.ant-tdr-btn.primary { background: linear-gradient(135deg, #10b981, #047857); color: white; }',
      '.ant-tdr-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.ant-tdr-btn.ghost { background: rgba(255,255,255,0.06); color: #b8bfd0; border: 1px solid #2a3040; }',
      '.ant-tdr-btn.warning { background: linear-gradient(135deg, #f5a623, #c67a0f); color: #0e1118; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Floating button ────────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById('ant-tdr-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'ant-tdr-fab';
    btn.innerHTML = '<span>📋 TDR</span><span class="pct" id="ant-tdr-fab-pct">--%</span>';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  // ── Modal sheet ────────────────────────────────────────────────────
  function injectModal() {
    if (document.getElementById('ant-tdr-backdrop')) return;
    var back = document.createElement('div');
    back.id = 'ant-tdr-backdrop';
    back.onclick = function (e) { if (e.target === back) closeModal(); };
    var sheet = document.createElement('div');
    sheet.id = 'ant-tdr-sheet';
    sheet.innerHTML = '<div class="ant-tdr-grab"></div><div id="ant-tdr-content">Loading…</div>';
    back.appendChild(sheet);
    document.body.appendChild(back);
  }

  function openModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.add('open');
    refresh();
  }
  function closeModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.remove('open');
  }

  // ── Fetch + render ─────────────────────────────────────────────────
  async function refresh() {
    try {
      var url = XANO + '/get_unified_tdr_status?job_id=' + encodeURIComponent(jobId);
      if (techId) url += '&technician_id=' + encodeURIComponent(techId);
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.success) return;
      lastData = d;
      renderButton(d);
      renderModal(d);
    } catch (e) {}
  }

  function renderButton(d) {
    var pctEl = document.getElementById('ant-tdr-fab-pct');
    var btn = document.getElementById('ant-tdr-fab');
    if (role === 'customer') {
      // Customer doesn't care about percentages. Show status instead.
      var fields = d.fields || {};
      var repairFilled = !!(fields.repair_completed || {}).filled;
      var diagFilled = !!(fields.diagnosis || {}).filled;
      if (btn) {
        if (repairFilled) {
          btn.innerHTML = '<span>✓ Your Repair</span><span class="pct">Done</span>';
          btn.classList.add('ready');
        } else if (diagFilled) {
          btn.innerHTML = '<span>🔧 Your Repair</span><span class="pct">In Progress</span>';
          btn.classList.remove('ready');
        } else {
          btn.innerHTML = '<span>🐜 Your Repair</span><span class="pct">Live</span>';
          btn.classList.remove('ready');
        }
      }
      return;
    }
    if (pctEl) pctEl.textContent = (d.readiness_pct || 0) + '%';
    if (btn) {
      if (d.readiness_pct >= 100) btn.classList.add('ready');
      else btn.classList.remove('ready');
    }
  }

  function renderModal(d) {
    var host = document.getElementById('ant-tdr-content');
    if (!host) return;
    // Customer view is fundamentally different - it's a status update,
    // not an internal checklist. Different fields, different language,
    // no editing actions.
    if (role === 'customer') {
      renderCustomerModal(host, d);
      return;
    }
    var fields = d.fields || {};
    var pct = d.readiness_pct || 0;
    var ready = pct >= 100;
    var customerSafe = false;
    var blockingText = buildBlockingText(d);

    var fieldOrder = [
      {key: 'diagnosis',        label: 'Diagnosis',        icon: '🔍', prompt: 'Tell Ant what\'s wrong'},
      {key: 'failed_component', label: 'Failed Component', icon: '⚙️', prompt: 'Which part failed?'},
      {key: 'labor_hours',      label: 'Labor Hours',      icon: '⏱️', prompt: 'Total time on the job'},
      {key: 'repair_completed', label: 'Repair Done',      icon: '🔧', prompt: 'What did you do to fix it?'},
      {key: 'parts_needed',     label: 'Parts Used',       icon: '📦', prompt: 'Parts swapped in (or "none")'},
    ];
    var photoFilled = !!d.has_photo;

    var html = '';
    // Header
    html += '<div class="ant-tdr-head">';
    html += '<div><div class="ant-tdr-title">TDR — Job #' + d.job_id + '</div>';
    html += '<div class="ant-tdr-sub">' + escapeHtml(d.customer_first_name || 'Customer') + ' · ' + escapeHtml(d.appliance_summary || '') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrClose()">×</button>';
    html += '</div>';
    // Progress
    html += '<div class="ant-tdr-progress"><div class="ant-tdr-progress-bar" style="width:' + pct + '%"></div></div>';
    html += '<div class="ant-tdr-status">';
    if (ready) {
      html += '<span class="ready-tag">✓ Ready for warranty submission</span>';
    } else {
      html += pct + '% complete · ' + blockingText;
    }
    html += '</div>';
    // Fields
    fieldOrder.forEach(function (f) {
      var fState = fields[f.key] || {filled: false, value: ''};
      var cls = fState.filled ? 'filled' : 'empty';
      var icon = fState.filled ? '✅' : '⏳';
      html += '<div class="ant-tdr-field ' + cls + '">';
      html += '<div class="ant-tdr-field-icon">' + icon + '</div>';
      html += '<div class="ant-tdr-field-body">';
      html += '<div class="ant-tdr-field-label">' + escapeHtml(f.label) + '</div>';
      if (fState.filled) {
        html += '<div class="ant-tdr-field-value">' + escapeHtml(String(fState.value)) + '</div>';
      } else {
        html += '<div class="ant-tdr-field-empty-prompt">' + escapeHtml(f.prompt) + '</div>';
      }
      html += '</div></div>';
    });
    // Photo row
    var photoIcon = photoFilled ? '✅' : '📷';
    var photoCls = photoFilled ? 'filled' : 'empty';
    html += '<div class="ant-tdr-field ' + photoCls + '">';
    html += '<div class="ant-tdr-field-icon">' + photoIcon + '</div>';
    html += '<div class="ant-tdr-field-body">';
    html += '<div class="ant-tdr-field-label">Photos</div>';
    if (photoFilled) {
      html += '<div class="ant-tdr-field-value">' + (d.attachments_count || 0) + ' on file</div>';
    } else {
      html += '<div class="ant-tdr-field-empty-prompt">At least one photo required for warranty</div>';
    }
    html += '</div></div>';
    // Signature row
    var sigFilled = !!d.has_signature;
    var sigIcon = sigFilled ? '✅' : '✍️';
    var sigCls = sigFilled ? 'filled' : 'empty';
    html += '<div class="ant-tdr-field ' + sigCls + '">';
    html += '<div class="ant-tdr-field-icon">' + sigIcon + '</div>';
    html += '<div class="ant-tdr-field-body">';
    html += '<div class="ant-tdr-field-label">Customer Signature</div>';
    if (sigFilled) {
      html += '<div class="ant-tdr-field-value">Signed on file</div>';
    } else {
      html += '<div class="ant-tdr-field-empty-prompt">Customer needs to sign on the tech\'s phone</div>';
    }
    html += '</div></div>';
    // Actions per role
    html += '<div class="ant-tdr-actions">';
    if (role === 'tech') {
      html += '<button class="ant-tdr-btn primary" onclick="window.__antTdrTalk()">🎤 Talk to Ant</button>';
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrOpenTech()">Edit fields</button>';
    } else if (role === 'office') {
      var submitDisabled = ready ? '' : 'disabled';
      html += '<button class="ant-tdr-btn primary" ' + submitDisabled + ' onclick="window.__antTdrSubmitWarranty()">📦 Submit Warranty</button>';
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrOpenTeddy()">Open Teddy Tool</button>';
    } else if (role === 'customer') {
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrClose()">Close</button>';
    }
    html += '</div>';
    host.innerHTML = html;
  }

  // ── Customer-friendly view — sanitized, no tech jargon ───────────
  function renderCustomerModal(host, d) {
    var fields = d.fields || {};
    var diag = (fields.diagnosis || {}).value || '';
    var repair = (fields.repair_completed || {}).value || '';
    var parts = (fields.parts_needed || {}).value || '';
    var diagFilled = !!(fields.diagnosis || {}).filled;
    var repairFilled = !!(fields.repair_completed || {}).filled;
    var partsFilled = !!(fields.parts_needed || {}).filled;
    var photoCount = d.attachments_count || 0;
    // Customer status banner — derived from filled state
    var status, statusColor, statusIcon;
    if (repairFilled) {
      status = 'Repair Complete';
      statusColor = '#10b981';
      statusIcon = '✓';
    } else if (diagFilled) {
      status = 'Repair In Progress';
      statusColor = '#4ca7ff';
      statusIcon = '🔧';
    } else {
      status = 'Tech En Route';
      statusColor = '#f5a623';
      statusIcon = '🚗';
    }

    var html = '';
    // Header — no Job # for customer
    html += '<div class="ant-tdr-head">';
    html += '<div><div class="ant-tdr-title">Your Repair</div>';
    html += '<div class="ant-tdr-sub">' + escapeHtml(d.appliance_summary || 'Appliance') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrClose()">×</button>';
    html += '</div>';
    // Status banner
    html += '<div style="background:' + statusColor + '22;border:1px solid ' + statusColor + ';border-radius:14px;padding:14px 16px;margin:14px 0 16px;display:flex;align-items:center;gap:14px">';
    html += '<div style="font-size:28px">' + statusIcon + '</div>';
    html += '<div><div style="font-size:17px;font-weight:800;color:' + statusColor + '">' + status + '</div>';
    html += '<div style="font-size:12px;color:#b8bfd0;margin-top:2px">Your tech is documenting everything for you.</div></div>';
    html += '</div>';
    // What we found
    if (diagFilled) {
      html += customerCard('🔍', 'What we found', diag);
    }
    // What we fixed
    if (repairFilled) {
      html += customerCard('🔧', 'What we did', repair);
    }
    // Parts replaced (only if non-trivial)
    if (partsFilled && parts.toLowerCase() !== 'none') {
      html += customerCard('📦', 'Parts replaced', parts);
    }
    // Photos
    if (photoCount > 0) {
      html += customerCard('📷', 'Photos on file', photoCount + ' photo' + (photoCount === 1 ? '' : 's') + ' from your appointment');
    }
    // If nothing captured yet, friendly placeholder
    if (!diagFilled && !repairFilled && !partsFilled) {
      html += '<div style="background:#1a1f2c;border:1px solid #252b3a;border-radius:12px;padding:18px 16px;text-align:center;color:#b8bfd0;font-size:13px;line-height:1.5">Your tech hasn\'t added details yet. Once they start the diagnosis, you\'ll see what they found here in real time.</div>';
    }
    // Close button
    html += '<div class="ant-tdr-actions" style="margin-top:18px"><button class="ant-tdr-btn ghost" onclick="window.__antTdrClose()" style="flex:1">Close</button></div>';
    host.innerHTML = html;
  }

  function customerCard(icon, label, value) {
    return '<div style="background:#1a1f2c;border:1px solid #252b3a;border-left:4px solid #10b981;border-radius:12px;padding:14px 16px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:flex-start;gap:12px">'
      + '<div style="font-size:18px;flex-shrink:0;margin-top:1px">' + icon + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#8a92a6;font-weight:700">' + escapeHtml(label) + '</div>'
      + '<div style="font-size:15px;color:#e6e9f0;margin-top:4px;line-height:1.45;word-wrap:break-word">' + escapeHtml(String(value)) + '</div>'
      + '</div></div></div>';
  }

  function buildBlockingText(d) {
    var b = d.blocking || {};
    var labels = {
      diagnosis: 'diagnosis',
      failed_component: 'failed part',
      labor_hours: 'labor hours',
      repair_completed: 'repair description',
      parts_needed: 'parts used',
      photo: 'photo',
      signature: 'signature',
    };
    var missing = [];
    for (var k in b) {
      if (b[k] && labels[k]) missing.push(labels[k]);
    }
    if (missing.length === 0) return 'ready to submit';
    if (missing.length === 1) return 'needs ' + missing[0];
    if (missing.length === 2) return 'needs ' + missing[0] + ' + ' + missing[1];
    return 'needs ' + missing.slice(0, 2).join(', ') + ' (+' + (missing.length - 2) + ' more)';
  }

  // ── Submission package builder (office click on Submit Warranty) ──
  function buildSubmissionPackage(d) {
    var fields = d.fields || {};
    var extras = d.submission_extras || {};
    function val(f) { return ((fields[f] || {}).value || '').toString().trim(); }
    var ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
    var lines = [];
    lines.push('TN APPLIANCE EXCHANGE — WARRANTY SUBMISSION');
    lines.push('========================================');
    lines.push('Job: #' + d.job_id);
    lines.push('Customer: ' + (d.customer_first_name || '') + ' ' + (extras.customer_last_name || ''));
    lines.push('Phone: ' + (extras.customer_phone || ''));
    var addr = (extras.service_address || '');
    var locline = [extras.customer_city, extras.customer_state].filter(Boolean).join(', ');
    if (addr) lines.push('Address: ' + addr + (locline ? ' (' + locline + ')' : ''));
    lines.push('Vendor: ' + (d.warranty_company || 'unknown'));
    if (extras.claim_number) lines.push('Claim #: ' + extras.claim_number);
    lines.push('');
    lines.push('APPLIANCE');
    lines.push('  Type: ' + (d.appliance_summary || ''));
    if (extras.model_number) lines.push('  Model: ' + extras.model_number);
    if (extras.serial_number) lines.push('  Serial: ' + extras.serial_number);
    lines.push('');
    lines.push('DIAGNOSIS');
    lines.push('  ' + (val('diagnosis') || '(not captured)'));
    lines.push('');
    lines.push('FAILED COMPONENT');
    lines.push('  ' + (val('failed_component') || '(not captured)'));
    lines.push('');
    lines.push('REPAIR PERFORMED');
    lines.push('  ' + (val('repair_completed') || '(not captured)'));
    lines.push('');
    lines.push('PARTS USED');
    lines.push('  ' + (val('parts_needed') || '(none)'));
    lines.push('');
    lines.push('LABOR');
    lines.push('  ' + (val('labor_hours') || '?') + ' hours');
    if (val('customer_notes')) {
      lines.push('');
      lines.push('CUSTOMER NOTES');
      lines.push('  ' + val('customer_notes'));
    }
    if (extras.problem_summary) {
      lines.push('');
      lines.push('ORIGINAL COMPLAINT');
      lines.push('  ' + extras.problem_summary);
    }
    lines.push('');
    lines.push('DOCUMENTATION');
    lines.push('  Photos on file: ' + (d.attachments_count || 0));
    lines.push('  Customer signature: ' + (d.has_signature ? 'Yes' : 'No'));
    lines.push('');
    lines.push('PARTS POLICY');
    lines.push('  TN Appliance Exchange installs only parts supplied by our');
    lines.push('  company. Customer-purchased parts are not installed. This');
    lines.push('  ensures the correct part is used and allows us to stand');
    lines.push('  behind the repair.');
    lines.push('');
    lines.push('Submitted via Ant · ' + ts);
    return lines.join('\n');
  }

  function tdrCopyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(function () { tdrFallbackCopy(text); });
    } else {
      tdrFallbackCopy(text);
    }
  }
  function tdrFallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }
  function tdrPortalUrlForVendor(v) {
    var n = (v || '').toLowerCase().replace(/\s+/g, '');
    if (n.indexOf('square') !== -1) return 'https://provider.squaretrade.com/';
    if (n === 'ahs' || n.indexOf('americanhome') !== -1) return 'https://contractor.ahs.com/';
    if (n.indexOf('frontdoor') !== -1) return 'https://www.frontdoor.com/pro/';
    if (n.indexOf('allstate') !== -1) return 'https://allstateprotectionplans.com/';
    if (n.indexOf('nsa') !== -1) return 'https://contractors.nsai.com/';
    return '';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ── Action handlers ────────────────────────────────────────────────
  window.__antTdrClose = closeModal;
  window.__antTdrTalk = async function () {
    if (!jobId || !techId) { alert('Tech context missing'); return; }
    try {
      var r = await fetch(XANO + '/dispatch_ant_field_assist', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({job_id: Number(jobId), tech_id: Number(techId), mode: 'wrap_up'}),
      });
      var d = await r.json();
      if (d && d.success) alert('Calling you now. Ant will pick up where you left off.');
      else alert('Dispatch failed: ' + (d && d.error || 'unknown'));
    } catch (e) { alert('Could not place call: ' + e.message); }
  };
  window.__antTdrOpenTech = function () {
    location.href = '/tech-simple.html?job_id=' + jobId + (techId ? '&tech_id=' + techId : '');
  };
  window.__antTdrOpenTeddy = function () {
    location.href = '/teddy-tdr-tool.html?job_id=' + jobId;
  };
  window.__antTdrSubmitWarranty = function () {
    if (!lastData) { alert('No data loaded yet'); return; }
    var pkg = buildSubmissionPackage(lastData);
    tdrCopyToClipboard(pkg);
    var vendor = lastData.warranty_company || '';
    var portal = tdrPortalUrlForVendor(vendor);
    // Show a confirmation banner inside the modal sheet so the user
    // sees what just happened before any redirect.
    var content = document.getElementById('ant-tdr-content');
    if (content) {
      var banner = document.createElement('div');
      banner.style.cssText = 'position:sticky;top:0;background:linear-gradient(135deg,#10b981,#047857);color:#fff;padding:14px 16px;border-radius:12px;margin-bottom:14px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 14px rgba(16,185,129,0.35);z-index:10';
      banner.innerHTML = '<span style="font-size:20px">📋</span><span>Submission package copied to clipboard. ' + (portal ? 'Opening ' + vendor + ' portal in new tab — paste it in.' : 'Paste it into the vendor portal.') + '</span>';
      content.insertBefore(banner, content.firstChild);
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 6000);
    }
    if (portal) {
      setTimeout(function () { window.open(portal, '_blank', 'noopener'); }, 350);
    }
  };

  // ── Boot timing ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
