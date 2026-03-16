// ============================================================
// map.js — Leaflet.js interactive map
// ============================================================
import L from 'leaflet';
import { MOOD_COLOR, aggregateByCity, CITY_COORDS } from './data.js';

let mapInstance = null;
let markersLayer = null;
let _onCityClick = null;

export function initMap(onCityClick) {
  const el = document.getElementById('syriaMap');
  if (!el || mapInstance) return;

  _onCityClick = onCityClick;

  mapInstance = L.map('syriaMap', {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
  }).setView([35.8, 39.5], 7);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(mapInstance);

  markersLayer = L.layerGroup().addTo(mapInstance);
}

export function updateMap(data, selectedCity, selectedCountry = 'all') {
  if (!mapInstance || !markersLayer) return;

  // Show placeholder for non-Syria countries (map is Syria-optimised)
  let placeholder = document.getElementById('mapPlaceholder');
  const showSyria = selectedCountry === 'all' || selectedCountry === 'Syria';
  if (placeholder) placeholder.style.display = showSyria ? 'none' : 'flex';
  if (!showSyria) {
    if (placeholder) placeholder.textContent =
      `Map view is optimised for Syria. ${selectedCountry} data is available in the City Comparison table and charts below.`;
    return;
  }

  markersLayer.clearLayers();

  const agg = aggregateByCity(data);

  Object.entries(CITY_COORDS).forEach(([city, [lat, lng]]) => {
    const a = agg[city];
    const mood  = a ? a.worstMood : null;
    const color = mood ? (MOOD_COLOR[mood] || '#475569') : '#475569';
    const n     = a ? a.n : 0;

    const isSelected = selectedCity === city;
    const radius = isSelected ? 18 : 10 + Math.min(n, 3) * 2;

    const marker = L.circleMarker([lat, lng], {
      radius,
      fillColor:   color,
      color:       isSelected ? '#fff' : color,
      weight:      isSelected ? 2.5 : 1,
      opacity:     1,
      fillOpacity: a ? 0.85 : 0.3,
    }).addTo(markersLayer);

    const avgToT = a && a.avgToT ? `<div class="pp-row"><span class="pp-label">Avg ToT:</span><span class="pp-val">${a.avgToT} kg</span></div>` : '';
    const popupHtml = `
      <div class="city-popup">
        <h4>${city}</h4>
        <div class="pp-row"><span class="pp-label">Mood:</span><span class="pp-val" style="color:${color}">${mood || 'No data'}</span></div>
        ${avgToT}
        <div class="pp-row"><span class="pp-label">Reports:</span><span class="pp-val">${n}</span></div>
      </div>`;

    marker.bindPopup(popupHtml, { className: 'dark-leaflet-popup' });
    marker.bindTooltip(city, { direction: 'top', permanent: false });

    marker.on('click', () => {
      if (_onCityClick) _onCityClick(city);
    });
  });
}
