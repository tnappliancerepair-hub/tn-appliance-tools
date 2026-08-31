/* ant-suppliers.js — ONE parts-supplier catalog + resolver shared across the tech app,
   the tech job page, and the office board drawer. "Guys have different suppliers," so the
   buttons are INTERCHANGEABLE three ways, most-specific first:
     1) a per-device / per-tech choice saved in localStorage (ant_parts_suppliers),
     2) the shop's default (company.settings.parts_suppliers = ["sears","app",...]),
     3) a sensible built-in default.
   The shop's own distributor (settings.distributor_name + distributor_search_url) folds in
   as a "dist" entry automatically. window.AntSuppliers.chooser(settings, onSave) pops the
   picker so anyone can swap their own set on the spot. No build step, no deps. */
(function(){
  var enc = encodeURIComponent;
  // Master catalog. `direct` = a real parts-store search; `search` = a Google query (used for
  // account-gated distributors that have no clean public search URL).
  var CAT = {
    sears:    {label:'Sears PartsDirect',   icon:'🔩', url:function(q){ return 'https://www.searspartsdirect.com/search?q='+enc(q); }},
    app:      {label:'AppliancePartsPros',  icon:'🔧', url:function(q){ return 'https://www.appliancepartspros.com/search.aspx?model='+enc(q); }},
    rc:       {label:'RepairClinic',        icon:'🛠️', url:function(q){ return 'https://www.repairclinic.com/Shop-For-Parts?query='+enc(q); }},
    ps:       {label:'PartSelect',          icon:'🧩', url:function(q){ return 'https://www.partselect.com/Search.aspx?SearchTerm='+enc(q); }},
    enc:      {label:'Encompass',           icon:'📦', url:function(q){ return 'https://encompass.com/search?searchTerm='+enc(q); }},
    reliable: {label:'Reliable Parts',      icon:'🏭', url:function(q){ return 'https://www.reliableparts.com/search?q='+enc(q); }},
    marcone:  {label:'Marcone',             icon:'🏭', url:function(q){ return 'https://www.google.com/search?q='+enc(q+' Marcone parts'); }},
    tribles:  {label:'Tribles',             icon:'🏭', url:function(q){ return 'https://www.google.com/search?q='+enc(q+' Tribles appliance parts'); }},
    vv:       {label:'V&V Appliance Parts', icon:'🏭', url:function(q){ return 'https://www.google.com/search?q='+enc(q+' V&V appliance parts'); }},
    coast:    {label:'Coast Parts',         icon:'🏭', url:function(q){ return 'https://www.google.com/search?q='+enc(q+' Coast appliance parts'); }},
    amazon:   {label:'Amazon',              icon:'📦', url:function(q){ return 'https://www.amazon.com/s?k='+enc(q+' appliance part'); }},
    ebay:     {label:'eBay',                icon:'🛒', url:function(q){ return 'https://www.ebay.com/sch/i.html?_nkw='+enc(q+' appliance part'); }},
    google:   {label:'Google',              icon:'🔎', url:function(q){ return 'https://www.google.com/search?q='+enc(q+' appliance part'); }}
  };
  var DEFAULT_KEYS = ['sears','app','rc','ps','enc'];
  var LS = 'ant_parts_suppliers';

  // The shop's own distributor becomes a first-class "dist" button when it's configured.
  function distEntry(settings){
    settings = settings || {};
    var tpl  = String(settings.distributor_search_url||'').trim();
    var name = String(settings.distributor_name||'').trim();
    if(!tpl && !name) return null;
    var label = name || 'My distributor';
    return { label:label, icon:'🏭', url:function(q){
      var e = enc(q);
      if(tpl && tpl.indexOf('{q}')>=0) return tpl.replace('{q}', e);
      if(tpl) return tpl + e;
      return 'https://www.google.com/search?q='+enc(q+' '+label+' parts');
    }};
  }
  function catalog(settings){
    var c = {}; for(var k in CAT) if(CAT.hasOwnProperty(k)) c[k] = CAT[k];
    var d = distEntry(settings); if(d) c.dist = d;
    return c;
  }
  function techChoice(){ try{ var v = JSON.parse(localStorage.getItem(LS)||'null'); return (v && v.length) ? v : null; }catch(e){ return null; } }
  function saveTechChoice(keys){ try{ if(keys && keys.length) localStorage.setItem(LS, JSON.stringify(keys)); else localStorage.removeItem(LS); }catch(e){} }
  function keysFor(settings){
    var t = techChoice(); if(t) return t;
    var s = settings && settings.parts_suppliers; if(s && s.length) return s;
    var out = DEFAULT_KEYS.slice(); if(distEntry(settings)) out.push('dist'); return out;
  }
  // Resolved, ordered button list for a surface. Each item: {key,label,icon,build:fn(q)->url}.
  function list(settings){
    var cat = catalog(settings), keys = keysFor(settings), out = [];
    keys.forEach(function(k){ if(cat[k]) out.push({ key:k, label:cat[k].label, icon:cat[k].icon, build:cat[k].url }); });
    if(!out.length) out.push({ key:'sears', label:CAT.sears.label, icon:CAT.sears.icon, build:CAT.sears.url });
    return out;
  }
  function all(settings){
    var cat = catalog(settings), out = [];
    for(var k in cat) if(cat.hasOwnProperty(k)) out.push({ key:k, label:cat[k].label, icon:cat[k].icon });
    return out;
  }
  function open(key, q, settings){
    var cat = catalog(settings), e = cat[key]; if(!e || !q) return false;
    window.open(e.url(q), '_blank', 'noopener'); return true;
  }
  // Pop the picker (works on any surface). onSave() fires after a save/reset so the caller re-renders.
  function chooser(settings, onSave){
    var cur = {}, ck = keysFor(settings); ck.forEach(function(k){ cur[k] = true; });
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100000;';
    var items = all(settings).map(function(s){
      return '<label style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(127,127,127,.18);font-size:15px;cursor:pointer">'+
        '<input type="checkbox" data-sk="'+s.key+'"'+(cur[s.key]?' checked':'')+' style="width:18px;height:18px;flex:none">'+
        '<span style="flex:none">'+s.icon+'</span><span>'+s.label+'</span></label>';
    }).join('');
    ov.innerHTML = '<div style="background:#12161f;color:#eef2f8;border:1px solid rgba(255,255,255,.12);border-radius:16px;max-width:420px;width:100%;max-height:82vh;overflow:auto;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.5)">'+
      '<div style="font-weight:800;font-size:17px;margin-bottom:2px">🔩 Your parts suppliers</div>'+
      '<div style="color:#9fb0c3;font-size:13px;margin-bottom:12px">Pick the ones you actually use — the buttons follow. Saved on this device.</div>'+
      items+
      '<div style="display:flex;gap:10px;align-items:center;margin-top:16px">'+
        '<button data-x="reset" style="margin-right:auto;padding:10px 12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:transparent;color:#9fb0c3;font-weight:700;cursor:pointer">Shop default</button>'+
        '<button data-x="cancel" style="padding:10px 14px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:transparent;color:#eef2f8;font-weight:700;cursor:pointer">Cancel</button>'+
        '<button data-x="save" style="padding:10px 16px;border:0;border-radius:10px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#04140a;font-weight:800;cursor:pointer">Save</button>'+
      '</div></div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
    ov.querySelector('[data-x=cancel]').onclick = close;
    ov.querySelector('[data-x=reset]').onclick  = function(){ saveTechChoice(null); close(); if(onSave) onSave(); };
    ov.querySelector('[data-x=save]').onclick   = function(){
      var keys = []; Array.prototype.forEach.call(ov.querySelectorAll('input[data-sk]'), function(i){ if(i.checked) keys.push(i.getAttribute('data-sk')); });
      saveTechChoice(keys.length?keys:null); close(); if(onSave) onSave();
    };
  }
  window.AntSuppliers = { CAT:CAT, catalog:catalog, list:list, all:all, open:open, chooser:chooser,
    keysFor:keysFor, techChoice:techChoice, saveTechChoice:saveTechChoice, DEFAULT_KEYS:DEFAULT_KEYS };
})();
