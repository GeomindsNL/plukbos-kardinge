/* Plukbos Kardinge, kaartviewer
 *
 * Leest data/bomen.geojson (de inspectie) en data/soorten.json (oogstperiodes)
 * en toont de bomen op een PDOK-ondergrond. Geen build-stap, geen server-code.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Instellingen: dit is het enige blok dat je normaal gesproken aanpast.
  // ---------------------------------------------------------------------------
  var INSTELLINGEN = {
    bomen: 'data/bomen.geojson',
    soorten: 'data/soorten.json',
    fotomap: 'data/foto/',
    geomindsUrl: 'https://www.geominds.nl/nl/',
    productNaam: 'Boomwacht',
    productUrl: 'https://www.geominds.nl/nl/products/boomwacht/',
    broncodeUrl: 'https://github.com/Gl1tchWizard/plukbos-kardinge',
    start: [53.2425, 6.5962],     // kaartmidden zolang de gegevens laden
    startZoom: 17,
    zoomBijBoom: 19
  };

  var MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
    'augustus', 'september', 'oktober', 'november', 'december'];
  var KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var GEZONDHEID = { goed: 'Goed', matig: 'Matig', slecht: 'Slecht', onbekend: 'Onbekend' };
  var GEZ_VOLGORDE = ['slecht', 'matig', 'goed', 'onbekend'];

  var nuMaand = new Date().getMonth() + 1;
  var minderBeweging = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var staat = {
    modus: 'oogst',
    maand: nuMaand,
    soort: null,
    alleenVrucht: false,
    gezondheid: { goed: true, matig: true, slecht: true, onbekend: true },
    gekozen: null
  };
  var bomen = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function meervoud(n, een, meer) { return n + ' ' + (n === 1 ? een : meer); }

  // ---------------------------------------------------------------------------
  // Kaart
  // ---------------------------------------------------------------------------
  var kaart = L.map('kaart', { zoomControl: false, maxZoom: 21 })
    .setView(INSTELLINGEN.start, INSTELLINGEN.startZoom);

  L.control.zoom({ position: 'topleft', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(kaart);
  kaart.attributionControl.setPrefix(
    '<a href="' + esc(INSTELLINGEN.geomindsUrl) + '" target="_blank" rel="noopener">Inventarisatie: Geominds</a> | ' +
    '<a href="https://leafletjs.com">Leaflet</a>'
  );

  var luchtfoto = L.tileLayer(
    'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg', {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: 'Luchtfoto: <a href="https://www.beeldmateriaal.nl">Beeldmateriaal.nl</a>, <a href="https://www.pdok.nl">PDOK</a>'
    }).addTo(kaart);
  var topokaart = L.tileLayer(
    'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png', {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: 'Kaart: <a href="https://www.kadaster.nl">Kadaster</a>, <a href="https://www.pdok.nl">PDOK</a>'
    });
  L.control.layers({ 'Luchtfoto': luchtfoto, 'Kaart': topokaart }, null, { position: 'topleft' }).addTo(kaart);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(kaart);

  var struweellaag = L.layerGroup().addTo(kaart);   // omtrekken, onder de stippen
  var boomlaag = L.layerGroup().addTo(kaart);

  // ---------------------------------------------------------------------------
  // Gegevens
  // ---------------------------------------------------------------------------
  function laad(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' gaf status ' + r.status);
      return r.json();
    });
  }

  function geldigeMaand(m) { m = Number(m); return m >= 1 && m <= 12 && Math.round(m) === m; }

  function oogstMaanden(oogst) {
    var set = {};
    if (!oogst || !geldigeMaand(oogst.van) || !geldigeMaand(oogst.tot)) return set;
    var m = Number(oogst.van);
    for (var i = 0; i < 12; i++) {           // loopt ook over de jaargrens, bv. nov t/m jan
      set[m] = true;
      if (m === Number(oogst.tot)) break;
      m = m === 12 ? 1 : m + 1;
    }
    return set;
  }

  function normaliseerGezondheid(g) {
    g = String(g || '').trim().toLowerCase();
    return GEZONDHEID[g] ? g : 'onbekend';
  }

  function maakBoom(f, i, soorten) {
    var p = f.properties || {};
    var soort = String(p.soort || 'Onbekende soort').trim();
    var ras = p.ras ? String(p.ras).trim() : '';
    var sInfo = soorten[soort] || {};
    var rInfo = (sInfo.rassen && sInfo.rassen[ras]) || {};
    var oogst = null;
    if (geldigeMaand(p.oogst_van) && geldigeMaand(p.oogst_tot)) {
      oogst = { van: Number(p.oogst_van), tot: Number(p.oogst_tot) };   // uitzondering per boom
    } else if (rInfo.oogst) {
      oogst = rInfo.oogst;
    } else if (sInfo.oogst) {
      oogst = sInfo.oogst;
    }
    var c = f.geometry.coordinates;
    // Een struweel heeft een omtrek; de stip op de kaart komt in het midden daarvan.
    var vorm = f.geometry.type === 'Polygon'
      ? c[0].map(function (punt) { return L.latLng(punt[1], punt[0]); })
      : null;
    var fotos = Array.isArray(p.fotos) ? p.fotos.map(String) : [];
    if (p.foto && fotos.indexOf(String(p.foto)) === -1) fotos.unshift(String(p.foto));
    return {
      id: String(p.id || f.id || 'boom-' + (i + 1)),
      nummer: p.nummer !== undefined && p.nummer !== null ? String(p.nummer) : '',
      soort: soort,
      ras: ras,
      latijn: p.wetenschappelijk || sInfo.wetenschappelijk || '',
      eetbaar: sInfo.eetbaar !== false,
      oogst: oogst,
      maanden: oogstMaanden(oogst),
      gezondheid: normaliseerGezondheid(p.gezondheid),
      fotos: fotos,
      opmerking: p.opmerking ? String(p.opmerking) : '',
      problemen: Array.isArray(p.problemen) ? p.problemen.map(String) : [],
      datum: p.inspectiedatum ? String(p.inspectiedatum) : '',
      geplant: p.geplant ? String(p.geplant) : '',
      latlng: vorm ? L.latLngBounds(vorm).getCenter() : L.latLng(c[1], c[0]),
      vorm: vorm,
      struweel: p.type === 'struweel' ? {
        oppervlakte: Number(p.oppervlakte) || 0,
        aantal: Number(p.aantal_planten) || 0,
        ook: Array.isArray(p.ook) ? p.ook.map(String) : [],
        planten: Array.isArray(p.planten) ? p.planten.map(String) : []
      } : null,
      inStruweel: p.struweel ? String(p.struweel) : '',
      marker: null,
      vlak: null
    };
  }

  // Zoekt op het id uit de inspectie-app en op het boomnummer, zodat #12 ook werkt.
  function vindBoom(id) {
    for (var i = 0; i < bomen.length; i++) if (bomen[i].id === id) return bomen[i];
    for (var j = 0; j < bomen.length; j++) if (bomen[j].nummer && bomen[j].nummer === id) return bomen[j];
    return null;
  }

  // ---------------------------------------------------------------------------
  // Afgeleide gegevens en teksten
  // ---------------------------------------------------------------------------
  function inOogst(b, maand) { return !!b.maanden[maand || staat.maand]; }
  function vanSoort(b) {
    return !staat.soort || b.soort === staat.soort || (!!b.struweel && b.struweel.ook.indexOf(staat.soort) !== -1);
  }
  // Gegroepeerd: de planten van het struweel staan ook elk apart op de kaart.
  function gegroepeerd(b) { return !!b.struweel && b.struweel.planten.length > 0; }

  function zichtbaar(b) {
    if (!vanSoort(b)) return false;
    if (staat.modus === 'oogst') return !staat.alleenVrucht || inOogst(b);
    return staat.gezondheid[b.gezondheid];
  }

  function status(b) {
    if (staat.modus === 'oogst') return inOogst(b) ? 'rijp' : 'leeg';
    return b.gezondheid;
  }

  function naam(b) { return b.soort + (b.ras ? ' ' + b.ras : ''); }

  function oogstTekst(b, kort) {
    if (!b.eetbaar) return 'Niet om te plukken';
    if (!b.oogst) return 'Oogstperiode onbekend';
    var lijst = kort ? KORT : MAANDEN;
    var van = lijst[b.oogst.van - 1], tot = lijst[b.oogst.tot - 1];
    if (kort) return b.oogst.van === b.oogst.tot ? van : van + ' t/m ' + tot;
    return b.oogst.van === b.oogst.tot ? 'Oogst in ' + van : 'Oogst van ' + van + ' t/m ' + tot;
  }

  function datumTekst(iso) {
    var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!d) return iso || 'onbekend';
    return Number(d[3]) + ' ' + MAANDEN[Number(d[2]) - 1] + ' ' + d[1];
  }

  function fotoUrl(naam) {
    if (!naam) return '';
    return /^(https?:)?\/\//.test(naam) ? naam : INSTELLINGEN.fotomap + naam;
  }
  // Miniatuur volgens de afspraak naam.jpg -> naam-klein.jpg; valt terug op de foto zelf.
  function kleinUrl(naam) {
    return fotoUrl(naam.replace(/(\.[a-z0-9]+)$/i, '-klein$1'));
  }

  // ---------------------------------------------------------------------------
  // Weergave
  // ---------------------------------------------------------------------------
  function render(animeer) {
    renderKalender();
    renderOogstTekst();
    renderGezondheid();
    renderSoorten();
    renderLijst();
    renderMarkers(animeer);
  }

  function renderKalender() {
    var basis = bomen.filter(vanSoort);
    var telling = [];
    for (var m = 1; m <= 12; m++) {
      telling.push(basis.filter(function (b) { return inOogst(b, m); }).length);
    }
    var max = Math.max.apply(null, telling.concat([1]));
    $('kalender').innerHTML = telling.map(function (n, i) {
      var m = i + 1, gekozen = m === staat.maand, nu = m === nuMaand;
      return '<button type="button" class="maand' + (gekozen ? ' is-gekozen' : '') + '"' +
        ' data-maand="' + m + '" aria-pressed="' + gekozen + '"' +
        ' aria-label="' + MAANDEN[i] + ': ' + meervoud(n, 'boom', 'bomen') + ' met vrucht' + (nu ? ', deze maand' : '') + '">' +
        '<span class="maand-staaf" aria-hidden="true"><span style="height:' + Math.round(n / max * 100) + '%"></span></span>' +
        '<span class="maand-naam" aria-hidden="true">' + KORT[i] + '</span>' +
        '<span class="maand-nu" aria-hidden="true">' + (nu ? 'nu' : '') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderOogstTekst() {
    var n = bomen.filter(function (b) { return vanSoort(b) && inOogst(b); }).length;
    var maand = MAANDEN[staat.maand - 1];
    var soort = staat.soort ? ' (' + staat.soort.toLowerCase() + ')' : '';
    var tekst;
    if (n === 0) {
      tekst = (staat.maand === nuMaand ? 'Nu is er' : 'In ' + maand + ' is er') + ' niets te plukken' + soort;
    } else if (staat.maand === nuMaand) {
      tekst = 'Nu te plukken: ' + meervoud(n, 'boom', 'bomen') + soort;
    } else {
      tekst = 'In ' + maand + ': ' + meervoud(n, 'boom', 'bomen') + ' met vrucht' + soort;
    }
    $('samenvatting').textContent = tekst;
    $('oogstLegenda').innerHTML =
      '<span><i class="stip stip--rijp"></i>Vrucht in ' + maand + '</span>' +
      '<span><i class="stip stip--leeg"></i>Geen vrucht</span>';
  }

  function renderGezondheid() {
    var basis = bomen.filter(vanSoort);
    var datums = basis.map(function (b) { return b.datum; }).filter(Boolean).sort();
    var laatste = datums.length ? datums[datums.length - 1] : '';
    $('gezSamenvatting').innerHTML = esc(meervoud(basis.length, 'boom', 'bomen')) + ' geïnspecteerd' +
      (laatste ? '<span class="sub">Laatste inspectie: ' + esc(datumTekst(laatste)) + '</span>' : '');
    var tel = { goed: 0, matig: 0, slecht: 0, onbekend: 0 };
    basis.forEach(function (b) { tel[b.gezondheid]++; });
    $('gezKnoppen').innerHTML = ['goed', 'matig', 'slecht', 'onbekend']
      .filter(function (g) { return g !== 'onbekend' || tel.onbekend > 0; })
      .map(function (g) {
        return '<button type="button" class="gez-knop" data-gez="' + g + '" aria-pressed="' + staat.gezondheid[g] + '">' +
          '<i class="stip stip--' + g + '"></i>' + GEZONDHEID[g] +
          '<span class="aantal">' + tel[g] + '</span></button>';
      }).join('');
  }

  function renderSoorten() {
    var tel = {};
    bomen.forEach(function (b) { tel[b.soort] = (tel[b.soort] || 0) + 1; });
    var soorten = Object.keys(tel).sort(function (a, b) { return a.localeCompare(b, 'nl'); });
    $('soortKeuze').innerHTML =
      '<option value="">Alle soorten (' + bomen.length + ')</option>' +
      soorten.map(function (s) {
        return '<option value="' + esc(s) + '"' + (staat.soort === s ? ' selected' : '') + '>' + esc(s) + ' (' + tel[s] + ')</option>';
      }).join('');
  }

  function sorteer(a, b) {
    if (staat.modus === 'oogst') {
      var va = inOogst(a) ? 0 : 1, vb = inOogst(b) ? 0 : 1;
      if (va !== vb) return va - vb;
    } else {
      var ga = GEZ_VOLGORDE.indexOf(a.gezondheid), gb = GEZ_VOLGORDE.indexOf(b.gezondheid);
      if (ga !== gb) return ga - gb;
    }
    return naam(a).localeCompare(naam(b), 'nl') || (Number(a.nummer) || 0) - (Number(b.nummer) || 0) || a.id.localeCompare(b.id, 'nl');
  }

  function renderLijst() {
    var lijst = bomen.filter(zichtbaar).sort(sorteer);
    $('lijstkop').textContent = meervoud(lijst.length, 'boom', 'bomen') + ' op de kaart';
    if (!lijst.length) {
      $('lijst').innerHTML = '<li class="leeg">Geen bomen voor deze keuze. Kies een andere maand of soort.</li>';
      return;
    }
    $('lijst').innerHTML = lijst.map(function (b) {
      var meta = staat.modus === 'oogst' ? oogstTekst(b, true) : GEZONDHEID[b.gezondheid];
      return '<li><button type="button" class="rij" data-id="' + esc(b.id) + '"' +
        (b.id === staat.gekozen ? ' aria-current="true"' : '') + '>' +
        '<i class="stip stip--' + status(b) + '"></i>' +
        '<span class="rij-naam">' + (b.nummer ? '<span class="rij-nr">' + esc(b.nummer) + '</span>' : '') + esc(b.soort) + (b.ras ? ' <span class="rij-ras">' + esc(b.ras) + '</span>' : '') + '</span>' +
        '<span class="rij-meta">' + esc(meta) + '</span>' +
        '</button></li>';
    }).join('');
  }

  var MAAT = { rijp: 24, leeg: 14, goed: 18, matig: 18, slecht: 18, onbekend: 16 };

  function icoon(b, animeer) {
    var st = status(b);
    var klassen = ['boommarker', 'boommarker--' + st];
    if (b.id === staat.gekozen) klassen.push('is-gekozen');
    if (b.struweel) klassen.push('is-struweel');
    if (b.inStruweel) klassen.push('is-in-struweel');
    if (animeer && st === 'rijp' && !minderBeweging) klassen.push('is-nieuw');
    // Planten in een struweel staan dicht op elkaar binnen de omtrek; daarom heel klein.
    var maat = (b.inStruweel ? Math.max(7, Math.round(MAAT[st] * 0.4)) : MAAT[st]) + (b.id === staat.gekozen ? 4 : 0);
    return L.divIcon({ className: klassen.join(' '), html: '<span></span>', iconSize: [maat, maat] });
  }

  function renderMarkers(animeer) {
    bomen.forEach(function (b) {
      if (b.vlak) {
        if (!zichtbaar(b)) struweellaag.removeLayer(b.vlak);
        else if (!struweellaag.hasLayer(b.vlak)) struweellaag.addLayer(b.vlak);
        var el = b.vlak.getElement();
        if (el) el.classList.toggle('is-gekozen', b.id === staat.gekozen);
      }
      // Een struweel met omtrek krijgt geen stip; alleen zijn gegroepeerde planten staan erin.
      if (!zichtbaar(b) || b.vlak) { boomlaag.removeLayer(b.marker); return; }
      b.marker.setIcon(icoon(b, animeer));
      var bovenop = status(b) === 'rijp' || status(b) === 'slecht';
      b.marker.setZIndexOffset(b.id === staat.gekozen ? 1000 : bovenop ? 500 : 0);
      if (!boomlaag.hasLayer(b.marker)) boomlaag.addLayer(b.marker);
    });
  }

  // ---------------------------------------------------------------------------
  // Boomkaartje
  // ---------------------------------------------------------------------------
  function renderKaartje(b) {
    var nr = b.nummer || b.id;
    var foto = b.fotos.length
      ? '<a id="boomFotoLink" href="' + esc(fotoUrl(b.fotos[0])) + '" target="_blank" rel="noopener">' +
          '<img id="boomFoto" src="' + esc(fotoUrl(b.fotos[0])) + '" alt="Foto van ' + esc(naam(b)) + ', boom ' + esc(nr) + '"></a>'
      : '<div class="geen-foto">Nog geen foto</div>';
    var strook = '';
    if (b.fotos.length > 1) {
      strook = '<div class="fotostrook" role="group" aria-label="Meer foto\'s van deze boom">' +
        b.fotos.map(function (f, i) {
          return '<button type="button" data-foto="' + esc(f) + '" aria-pressed="' + (i === 0) + '" aria-label="Foto ' + (i + 1) + ' van ' + b.fotos.length + '">' +
            '<img src="' + esc(kleinUrl(f)) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + esc(fotoUrl(f)) + '\'"></button>';
        }).join('') + '</div>';
    }
    var latijn = (b.latijn ? '<i>' + esc(b.latijn) + '</i>' : '') + (b.ras ? (b.latijn ? ' ' : '') + '\u2018' + esc(b.ras) + '\u2019' : '');
    var cellen = '', namen = '';
    for (var m = 1; m <= 12; m++) {
      cellen += '<span class="' + (b.maanden[m] ? 'aan' : '') + (m === nuMaand ? ' nu' : '') + '"></span>';
      namen += '<span>' + KORT[m - 1] + '</span>';
    }
    var struweel = '', planten = '';
    if (b.struweel) {
      var s = b.struweel;
      struweel =
        '<div><dt>Struweel</dt><dd><i class="vlakje vlakje--' + (gegroepeerd(b) ? 'gegroepeerd' : 'los') + '"></i>' +
          (s.oppervlakte ? esc(s.oppervlakte) + ' m²' : 'Oppervlakte onbekend') +
          (s.aantal ? ', ' + esc(meervoud(s.aantal, 'plant', 'planten')) : '') + '</dd></div>' +
        (s.ook.length ? '<div><dt>Ook in dit struweel</dt><dd>' + esc(s.ook.join(', ')) + '</dd></div>' : '');
      var leden = s.planten.map(vindBoom).filter(Boolean);
      if (leden.length) {
        planten = '<div class="struweel-planten"><p>Planten in dit struweel</p><ul>' +
          leden.map(function (p) {
            return '<li><button type="button" class="naar-boom" data-id="' + esc(p.id) + '">' +
              '<i class="stip stip--' + status(p) + '"></i>' + esc(naam(p)) + '</button></li>';
          }).join('') + '</ul></div>';
      }
    }
    var ouder = b.inStruweel ? vindBoom(b.inStruweel) : null;
    if (ouder) {
      struweel = '<div><dt>In struweel</dt><dd><button type="button" class="naar-boom" data-id="' + esc(ouder.id) + '">' +
        esc(naam(ouder)) + (ouder.nummer ? ' (' + esc(ouder.nummer) + ')' : '') + '</button></dd></div>';
    }
    $('boom').innerHTML =
      '<button type="button" class="sluit" aria-label="Sluiten">&times;</button>' +
      '<figure class="boom-foto">' + foto + strook + '</figure>' +
      '<div class="boom-tekst">' +
        '<h2 id="boomTitel" tabindex="-1">' + esc(b.soort) + '</h2>' +
        (latijn ? '<p class="latijn">' + latijn + '</p>' : '') +
        (inOogst(b, nuMaand) ? '<span class="nu-rijp">Nu te plukken</span>' : '') +
        '<div class="oogstbalk" aria-hidden="true">' +
          '<div class="oogstbalk-cellen">' + cellen + '</div>' +
          '<div class="oogstbalk-namen">' + namen + '</div>' +
        '</div>' +
        '<p class="oogsttekst">' + oogstTekst(b) + '</p>' +
        '<dl class="feiten">' +
          struweel +
          '<div><dt>Gezondheid</dt><dd><i class="stip stip--' + b.gezondheid + '"></i>' + GEZONDHEID[b.gezondheid] + '</dd></div>' +
          '<div><dt>Geïnspecteerd</dt><dd>' + esc(datumTekst(b.datum)) + '</dd></div>' +
          (b.geplant ? '<div><dt>Geplant</dt><dd>' + esc(datumTekst(b.geplant)) + '</dd></div>' : '') +
          '<div><dt>Boomnummer</dt><dd>' + esc(nr) + '</dd></div>' +
        '</dl>' +
        planten +
        (b.problemen.length
          ? '<div class="problemen"><p>Aandachtspunten</p><ul>' + b.problemen.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>'
          : '') +
        (b.opmerking ? '<p class="opmerking">' + esc(b.opmerking) + '</p>' : '') +
        '<a class="boom-bron" href="' + esc(INSTELLINGEN.productUrl) + '" target="_blank" rel="noopener">' +
          '<img src="img/geominds-teken.svg" alt="" width="16" height="16">' +
          '<span>Geïnspecteerd met ' + esc(INSTELLINGEN.productNaam) + ' van Geominds</span>' +
        '</a>' +
      '</div>';
  }

  // Het deel van de kaart dat niet onder het kaartje ligt.
  function vrijVlak() {
    var k = kaart.getContainer().getBoundingClientRect();
    var vlak = { x: 0, y: 0, w: k.width, h: k.height };
    var el = $('boom');
    if (el.hidden) return vlak;
    var c = el.getBoundingClientRect();
    if (c.width > k.width * 0.6) {            // mobiel: kaartje onderaan
      vlak.h = Math.max(120, Math.min(k.height, c.top - k.top));
    } else {                                   // desktop: kaartje rechts
      vlak.w = Math.max(160, Math.min(k.width, c.left - k.left));
    }
    return vlak;
  }

  function brengInBeeld(latlng) {
    var z = Math.max(kaart.getZoom(), INSTELLINGEN.zoomBijBoom);
    var v = vrijVlak();
    var doel = L.point(v.x + v.w / 2, v.y + v.h / 2);
    var midden = kaart.project(latlng, z).subtract(doel).add(kaart.getSize().divideBy(2));
    kaart.setView(kaart.unproject(midden, z), z, { animate: !minderBeweging });
  }

  function kies(id, focus) {
    var b = vindBoom(id);
    if (!b) return;
    staat.gekozen = id;
    renderKaartje(b);
    $('boom').hidden = false;
    $('paneel').classList.remove('is-open');
    zetGreep(false);
    renderMarkers(false);
    renderLijst();
    if (location.hash.slice(1) !== encodeURIComponent(id)) {
      history.replaceState(null, '', '#' + encodeURIComponent(id));
    }
    requestAnimationFrame(function () { brengInBeeld(b.latlng); });
    if (focus) $('boomTitel').focus({ preventScroll: true });
  }

  function sluitKaartje() {
    if (!staat.gekozen) return;
    var id = staat.gekozen;
    staat.gekozen = null;
    $('boom').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    renderMarkers(false);
    renderLijst();
    var rij = document.querySelector('.rij[data-id="' + CSS.escape(id) + '"]');
    if (rij && document.activeElement === document.body) rij.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Bediening
  // ---------------------------------------------------------------------------
  function zetGreep(open) {
    $('greep').setAttribute('aria-expanded', String(open));
    $('greepTekst').textContent = open ? 'Paneel verkleinen' : 'Paneel vergroten';
  }

  function koppelBediening() {
    Array.prototype.forEach.call(document.querySelectorAll('.weergave button'), function (knop) {
      knop.addEventListener('click', function () {
        staat.modus = knop.getAttribute('data-modus');
        Array.prototype.forEach.call(document.querySelectorAll('.weergave button'), function (k) {
          k.setAttribute('aria-pressed', String(k === knop));
        });
        $('oogstdeel').hidden = staat.modus !== 'oogst';
        $('gezondheiddeel').hidden = staat.modus !== 'gezondheid';
        render(true);
        if (staat.gekozen) renderKaartje(vindBoom(staat.gekozen));
      });
    });

    $('kalender').addEventListener('click', function (e) {
      var knop = e.target.closest('.maand');
      if (!knop) return;
      staat.maand = Number(knop.getAttribute('data-maand'));
      render(true);
      var nieuw = $('kalender').querySelector('[data-maand="' + staat.maand + '"]');
      if (nieuw) nieuw.focus({ preventScroll: true });
    });

    $('alleenVrucht').addEventListener('change', function (e) {
      staat.alleenVrucht = e.target.checked;
      render(false);
    });

    $('gezKnoppen').addEventListener('click', function (e) {
      var knop = e.target.closest('.gez-knop');
      if (!knop) return;
      var g = knop.getAttribute('data-gez');
      staat.gezondheid[g] = !staat.gezondheid[g];
      render(false);
      var nieuw = $('gezKnoppen').querySelector('[data-gez="' + g + '"]');
      if (nieuw) nieuw.focus({ preventScroll: true });
    });

    $('soortKeuze').addEventListener('change', function (e) {
      staat.soort = e.target.value || null;
      render(true);
    });

    $('lijst').addEventListener('click', function (e) {
      var rij = e.target.closest('.rij');
      if (rij) kies(rij.getAttribute('data-id'), true);
    });

    $('boom').addEventListener('click', function (e) {
      if (e.target.closest('.sluit')) { sluitKaartje(); return; }
      var naar = e.target.closest('.naar-boom');
      if (naar) { kies(naar.getAttribute('data-id'), true); return; }
      var knop = e.target.closest('.fotostrook button');
      if (!knop) return;
      var f = knop.getAttribute('data-foto');
      $('boomFoto').src = fotoUrl(f);
      $('boomFotoLink').href = fotoUrl(f);
      Array.prototype.forEach.call(knop.parentNode.children, function (k) {
        k.setAttribute('aria-pressed', String(k === knop));
      });
    });

    kaart.on('click', sluitKaartje);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('over').open) sluitKaartje();
    });

    $('greep').addEventListener('click', function () {
      var open = $('paneel').classList.toggle('is-open');
      zetGreep(open);
    });

    $('overKnop').addEventListener('click', function () {
      if (typeof $('over').showModal === 'function') $('over').showModal();
    });

    window.addEventListener('hashchange', function () {
      var id = decodeURIComponent(location.hash.slice(1));
      if (id && vindBoom(id)) kies(id); else sluitKaartje();
    });
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  function toonFout(fout) {
    var los = location.protocol === 'file:';
    var el = $('melding');
    el.hidden = false;
    el.innerHTML = los
      ? 'De boomgegevens zijn niet geladen, omdat de kaart als los bestand is geopend. ' +
        'Start een webserver in deze map, bijvoorbeeld met <code>python3 -m http.server</code>, ' +
        'en open <code>http://localhost:8000</code>.'
      : 'De boomgegevens zijn niet geladen. Controleer of <code>' + esc(INSTELLINGEN.bomen) + '</code> en <code>' +
        esc(INSTELLINGEN.soorten) + '</code> op de server staan en geldige JSON bevatten.' +
        '<br><code>' + esc(fout && fout.message || fout) + '</code>';
    ['oogstdeel', 'gezondheiddeel', 'lijstkop'].forEach(function (id) { $(id).hidden = true; });
    document.querySelector('.soorten').hidden = true;
    document.querySelector('.weergave').hidden = true;
  }

  function start(geo, soorten) {
    if (geo && geo.metadata && geo.metadata.voorbeeld) $('voorbeeld').hidden = false;

    bomen = (geo.features || [])
      .filter(function (f) { return f.geometry && (f.geometry.type === 'Point' || f.geometry.type === 'Polygon'); })
      .map(function (f, i) { return maakBoom(f, i, soorten || {}); });
    if (!bomen.length) throw new Error('Het bestand bevat geen bomen met een locatie.');

    bomen.forEach(function (b) {
      if (!b.vorm) return;
      b.vlak = L.polygon(b.vorm, {
        className: 'struweel struweel--' + (gegroepeerd(b) ? 'gegroepeerd' : 'los'),
        bubblingMouseEvents: false     // anders sluit de klik op de kaart het kaartje meteen weer
      });
      b.vlak.on('click', function () { kies(b.id); });
    });

    var soortenStruweel = { los: false, gegroepeerd: false };
    bomen.forEach(function (b) { if (b.struweel) soortenStruweel[gegroepeerd(b) ? 'gegroepeerd' : 'los'] = true; });
    $('struweelLegenda').innerHTML =
      (soortenStruweel.los ? '<span><i class="vlakje vlakje--los"></i>Struweel</span>' : '') +
      (soortenStruweel.gegroepeerd ? '<span><i class="vlakje vlakje--gegroepeerd"></i>Struweel, planten apart op de kaart</span>' : '');
    $('struweelLegenda').hidden = !soortenStruweel.los && !soortenStruweel.gegroepeerd;

    bomen.forEach(function (b) {
      b.marker = L.marker(b.latlng, { title: (b.nummer ? b.nummer + '. ' : '') + naam(b), keyboard: true, riseOnHover: true });
      b.marker.on('click', function () { kies(b.id); });
      // Markers hebben role="button" en tabindex; Enter en spatie openen de boom.
      b.marker.on('keypress', function (e) {
        var k = e.originalEvent;
        if (k.key === 'Enter' || k.key === ' ' || k.keyCode === 13 || k.keyCode === 32) {
          k.preventDefault();
          kies(b.id, true);
        }
      });
    });

    koppelBediening();
    render(true);
    kaart.fitBounds(L.latLngBounds(bomen.map(function (b) { return b.latlng; })), {
      padding: [48, 48], maxZoom: INSTELLINGEN.zoomBijBoom
    });

    var id = decodeURIComponent(location.hash.slice(1));
    if (id && vindBoom(id)) kies(id);
  }

  // Links en productnaam komen uit INSTELLINGEN, zodat ze op één plek staan.
  Array.prototype.forEach.call(document.querySelectorAll('[data-link]'), function (a) {
    a.href = a.getAttribute('data-link') === 'product' ? INSTELLINGEN.productUrl : INSTELLINGEN.geomindsUrl;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tekst="product"]'), function (el) {
    el.textContent = INSTELLINGEN.productNaam;
  });
  if (INSTELLINGEN.broncodeUrl) {
    $('broncodeLink').innerHTML = ', zie <a href="' + esc(INSTELLINGEN.broncodeUrl) + '">de broncode</a>';
  }

  Promise.all([laad(INSTELLINGEN.bomen), laad(INSTELLINGEN.soorten)])
    .then(function (res) { start(res[0], res[1]); })
    .catch(toonFout);
})();
