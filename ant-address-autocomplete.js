/* ant-address-autocomplete — drops Google Places address autocomplete onto any
 * booking form that has an address field. Self-activating, zero-config, and SAFE:
 *  - fetches the browser key from /.netlify/functions/maps-key
 *  - if no key is vaulted yet, it does nothing → the form stays plain manual entry
 *  - uses the NEW PlaceAutocompleteElement (the legacy widget is blocked on new keys)
 *  - on select, fills street / city / state(2-letter) / zip from the structured place
 *
 * Field detection (first match wins, so it works on multiple page layouts):
 *   address: #address | #streetInput | #street
 *   city:    #city    | #cityInput
 *   state:   #state   | #stateInput
 *   zip:     #zip      | #zipInput | #postal
 */
(function () {
  function pick(ids) { for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el) return el; } return null; }

  function start() {
    var addr = pick(['address', 'streetInput', 'street']);
    if (!addr) return; // no address field on this page → nothing to do
    var fCity = pick(['city', 'cityInput']);
    var fState = pick(['state', 'stateInput']);
    var fZip = pick(['zip', 'zipInput', 'postal']);

    fetch('/.netlify/functions/maps-key').then(function (r) { return r.json(); }).then(function (d) {
      var key = d && d.key;
      if (!key) return; // key not vaulted yet → leave the plain input as-is
      loadMaps(key, function () { init(addr, fCity, fState, fZip); });
    }).catch(function () {});
  }

  function loadMaps(key, cb) {
    if (window.google && window.google.maps && window.google.maps.importLibrary) { cb(); return; }
    // Google's official inline bootstrap loader (sets up google.maps.importLibrary).
    (function (g) { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(), u = function () { return h || (h = new Promise(function (f, n) { a = m.createElement("script"); e.set("libraries", [].concat([], Array.from(r)).join("")); for (k in g) e.set(k.replace(/[A-Z]/g, function (t) { return "_" + t[0].toLowerCase(); }), g[k]); e.set("callback", c + ".maps." + q); a.src = "https://maps." + c + "apis.com/maps/api/js?" + e; d[q] = f; a.onerror = function () { h = n(Error(p + " could not load.")); }; m.head.append(a); })); }; d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = function (f) { var n = []; for (var i = 1; i < arguments.length; i++) n.push(arguments[i]); return r.add(f) && u().then(function () { return d[l].apply(d, [f].concat(n)); }); }; })({ key: key, v: "weekly" });
    cb();
  }

  function compGetter(comps) {
    return function (type, useShort) {
      for (var i = 0; i < comps.length; i++) { if (comps[i].types && comps[i].types.indexOf(type) !== -1) { return (useShort ? comps[i].shortText : comps[i].longText) || ''; } }
      return '';
    };
  }

  function init(addr, fCity, fState, fZip) {
    google.maps.importLibrary('places').then(function (lib) {
      var PAC = lib.PlaceAutocompleteElement;
      if (!PAC) return;
      var pac;
      try { pac = new PAC({ includedRegionCodes: ['us'] }); } catch (_) { return; }
      pac.style.width = '100%';
      pac.style.display = 'block';
      // place the autocomplete right where the address input is, hide the plain input
      addr.parentNode.insertBefore(pac, addr);
      addr.style.display = 'none';
      // mirror a placeholder if the element supports it
      try { pac.placeholder = addr.getAttribute('placeholder') || 'Start typing your address…'; } catch (_) {}

      pac.addEventListener('gmp-select', function (ev) {
        var prediction = ev && ev.placePrediction; if (!prediction) return;
        var place = prediction.toPlace();
        place.fetchFields({ fields: ['formattedAddress', 'addressComponents'] }).then(function () {
          var comps = place.addressComponents || [];
          var get = compGetter(comps);
          var num = get('street_number'), route = get('route');
          var street = (num + ' ' + route).trim();
          if (street) addr.value = street;
          if (fCity) { var city = get('locality') || get('sublocality') || get('postal_town') || get('administrative_area_level_3'); if (city) fCity.value = city; }
          if (fState) { var st = get('administrative_area_level_1', true); if (st) fState.value = st; } // 2-letter
          if (fZip) { var z = get('postal_code'); if (z) fZip.value = z; }
          try { addr.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }).catch(function () {});
      });
    }).catch(function () { /* leave the plain input visible on any failure */ if (addr) addr.style.display = ''; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
