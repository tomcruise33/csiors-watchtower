// ============================================================
// main.js — App entry point
// ============================================================
import { fetchData, filterData, getMonths, compareMonths, fmtMonth, MOOD_COLOR } from './data.js';
import { initFilters, getFilterState } from './filters.js';
import { initMap, updateMap } from './map.js';
import { renderEWS } from './ews.js';
import { renderToTChart, renderPriceChart } from './charts.js';
import { initTable, renderTable } from './table.js';

let allData      = [];
let selectedCity = 'all';
let compareMode  = false;

async function init() {
  try {
    allData = await fetchData();
  } catch (e) {
    console.error('Failed to load field data:', e);
    const row = document.getElementById('statsRow');
    if (row) row.innerHTML = '<p style="color:var(--red);padding:16px;grid-column:1/-1">Failed to load field data. Check console.</p>';
    return;
  }

  // Init components (once)
  initFilters(allData, onFilterChange);
  initMap(onCityClick);
  initTable(onCityClick);

  // Table search
  document.getElementById('tableSearch')?.addEventListener('input', () => {
    renderTable(getFiltered(), selectedCity);
  });

  // Table sort (dispatched by table.js header clicks)
  document.addEventListener('table:sort', () => {
    renderTable(getFiltered(), selectedCity);
  });

  // Compare mode toggle
  document.getElementById('compareMode')?.addEventListener('change', e => {
    compareMode = e.target.checked;
    renderCompare();
  });

  // PDF export
  document.getElementById('pdfBtn')?.addEventListener('click', exportPDF);

  render();
}

function getFiltered() {
  const { fromMonth, toMonth, city } = getFilterState();
  return filterData(allData, { fromMonth, toMonth, city });
}

function onFilterChange(state) {
  selectedCity = state.city;
  render();
}

function onCityClick(city) {
  selectedCity = selectedCity === city ? 'all' : city;
  const el = document.getElementById('cityFilter');
  if (el) el.value = selectedCity;
  render();
}

function render() {
  const { fromMonth, toMonth, city } = getFilterState();
  selectedCity = city;

  const filtered = filterData(allData, { fromMonth, toMonth, city });
  const months   = getMonths(allData);

  renderStats(filtered);
  updateMap(filtered, selectedCity);
  renderEWS(filtered);
  renderCityDetail(filtered);
  renderCompare();
  renderToTChart(allData, months, selectedCity);
  renderPriceChart(allData, months, selectedCity);
  renderTable(filtered, selectedCity);
}

function renderStats(data) {
  const validToT = data.filter(r => r.tot && r.tot < 25);
  const avgToT   = validToT.length > 0
    ? (validToT.reduce((s, r) => s + r.tot, 0) / validToT.length).toFixed(1)
    : '—';
  const validB = data.filter(r => r.basket);
  const avgB   = validB.length > 0
    ? Math.round(validB.reduce((s, r) => s + r.basket, 0) / validB.length)
    : null;
  const cities  = new Set(data.map(r => r.city)).size;
  const fearful = data.filter(r => r.mood === 'Fearful' || r.mood === 'Trying to leave').length;
  const pct     = data.length > 0 ? Math.round(fearful / data.length * 100) : 0;

  const statsEl = document.getElementById('statsRow');
  if (!statsEl) return;
  statsEl.innerHTML = [
    { icon: '📊', val: data.length,                               label: 'Reports',       sub: `${cities} locations` },
    { icon: '⚖️',  val: avgToT,                                    label: 'Avg ToT Index', sub: 'kg flour / day wage' },
    { icon: '🛒',  val: avgB != null ? avgB.toLocaleString() : '—', label: 'Avg Food Basket', sub: 'SYP (5 items)' },
    { icon: '⚠️',  val: `${fearful}/${data.length}`,               label: 'Fearful / Alert', sub: `${pct}% of reports` },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.val}</div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>`
  ).join('');
}

function renderCityDetail(filtered) {
  const panel = document.getElementById('cityDetail');
  if (!panel) return;
  if (selectedCity === 'all') { panel.style.display = 'none'; return; }

  const cityData = allData.filter(r => r.city === selectedCity);
  if (!cityData.length) { panel.style.display = 'none'; return; }

  const latest = cityData[cityData.length - 1];
  const mc = MOOD_COLOR[latest.mood] || '#64748b';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="city-detail-header">
      <div>
        <div class="city-name">${selectedCity}</div>
        <div class="city-date">Latest: ${latest.date} | ${cityData.length} total reports</div>
      </div>
      <div style="display:flex;gap:6px">
        <span class="badge" style="background:${mc}20;color:${mc}">${latest.mood}</span>
        <span class="badge" style="background:#3b82f620;color:#3b82f6">${latest.job} jobs</span>
      </div>
    </div>
    <div class="detail-grid">
      ${[
        { l: 'Flour 1kg',             v: latest.flour       ? `${latest.flour.toLocaleString()} SYP` : 'N/A' },
        { l: 'Rice 1kg',              v: latest.rice        ? `${latest.rice.toLocaleString()} SYP`  : 'N/A' },
        { l: 'Cooking Oil 1L',        v: latest.oil         ? `${latest.oil.toLocaleString()} SYP`   : 'N/A' },
        { l: 'Daily Wage (unskilled)',v: latest.wage        ? `${latest.wage.toLocaleString()} SYP`  : 'N/A' },
        { l: 'Daily Wage (skilled)',  v: latest.wageSkilled ? `${latest.wageSkilled.toLocaleString()} SYP` : 'N/A' },
        { l: 'Terms of Trade',        v: latest.tot && latest.tot < 25 ? `${latest.tot} kg flour` : 'N/A' },
        { l: 'Food Basket (5 items)', v: latest.basket      ? `${latest.basket.toLocaleString()} SYP` : 'N/A' },
        { l: 'Monthly Rent',          v: latest.rent && latest.rent > 100 ? `${latest.rent.toLocaleString()} SYP` : 'N/A' },
        { l: 'Movement',              v: latest.movement    || 'N/A' },
      ].map(i => `<div class="detail-item"><div class="detail-item-label">${i.l}</div><div class="detail-item-value">${i.v}</div></div>`).join('')}
    </div>`;
}

function renderCompare() {
  const banner = document.getElementById('compareBanner');
  if (!banner) return;
  if (!compareMode) { banner.style.display = 'none'; return; }

  const months = getMonths(allData);
  if (months.length < 2) { banner.style.display = 'none'; return; }

  const prev = months[months.length - 2];
  const curr = months[months.length - 1];
  const comps = compareMonths(allData, prev, curr);

  const subtitle = document.getElementById('compareSubtitle');
  if (subtitle) subtitle.textContent = `${fmtMonth(prev)} → ${fmtMonth(curr)}`;

  const grid = document.getElementById('compareGrid');
  if (grid) {
    grid.innerHTML = comps.map(c => {
      const arrow = c.delta === null ? '—' : c.delta > 0 ? `▲ +${c.delta}` : `▼ ${c.delta}`;
      const cls   = c.delta === null ? 'delta-same'
        : (c.lowerBetter
            ? (c.delta < 0 ? 'delta-down' : 'delta-up')
            : (c.delta > 0 ? 'delta-down' : 'delta-up'));
      return `<div class="compare-item">
        <div class="compare-item-label">${c.label}</div>
        <div class="compare-item-val">${c.curr ?? '—'} ${c.unit}</div>
        <div class="compare-item-delta ${cls}">${arrow} ${c.unit}</div>
      </div>`;
    }).join('');
  }

  banner.style.display = 'block';
}

async function exportPDF() {
  const btn = document.getElementById('pdfBtn');
  if (!btn) return;
  btn.textContent = 'Exporting...';
  btn.disabled = true;
  try {
    const { default: html2pdf } = await import('html2pdf.js');
    await html2pdf()
      .from(document.getElementById('dashboardRoot'))
      .set({
        margin: [10, 10],
        filename: `csiors-watchtower-${new Date().toISOString().slice(0, 10)}.pdf`,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
      })
      .save();
  } catch (e) {
    console.error('PDF export failed:', e);
    alert('PDF export failed. See console for details.');
  }
  btn.textContent = 'PDF';
  btn.disabled = false;
}

init();
