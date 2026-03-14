// ============================================================
// main.js — App entry point
// ============================================================
import {
  fetchData, filterData, getMonths, getValidPriceData,
  compareMonths, fmtMonth, formatDate,
  MOOD_COLOR, MOOD_SCORE, JOB_SCORE, MOVE_SCORE,
  totColor,
} from './data.js';
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

  // Footer meta (static — latest date in dataset)
  renderFooterMeta();

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
  renderFindings(filtered);
  updateMap(filtered, selectedCity);
  renderEWS(filtered);
  renderCityDetail(filtered);
  renderCompare();
  renderToTChart(allData, months, selectedCity);
  renderPriceChart(allData, months, selectedCity);
  renderTable(filtered, selectedCity);
}

// ---- Stats row ----

function renderStats(data) {
  const valid  = getValidPriceData(data);
  const validToT = valid.filter(r => r.tot != null);
  const avgToT   = validToT.length > 0
    ? (validToT.reduce((s, r) => s + r.tot, 0) / validToT.length).toFixed(1)
    : null;

  // Median ToT
  let medianToT = null;
  if (validToT.length > 0) {
    const sorted = [...validToT.map(r => r.tot)].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianToT = sorted.length % 2
      ? sorted[mid].toFixed(1)
      : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1);
  }

  const validB = valid.filter(r => r.basket);
  const avgB   = validB.length > 0
    ? Math.round(validB.reduce((s, r) => s + r.basket, 0) / validB.length)
    : null;

  const cities  = new Set(data.map(r => r.city)).size;
  const fearful = data.filter(r => r.mood === 'Fearful' || r.mood === 'Trying to leave').length;
  const pct     = data.length > 0 ? Math.round(fearful / data.length * 100) : 0;

  const tc = totColor(avgToT != null ? parseFloat(avgToT) : null);
  const totBadge = avgToT != null
    ? `<div class="stat-badge" style="background:${tc.bg};color:${tc.text}">${tc.label}</div>`
    : '';

  const statsEl = document.getElementById('statsRow');
  if (!statsEl) return;
  statsEl.innerHTML = [
    { icon: '📊', val: data.length,   label: 'Field Reports',  sub: `${cities} locations · n=${data.length}`,             extra: '' },
    { icon: '⚖️',  val: avgToT ?? '—', label: 'Avg ToT Index',  sub: `median ${medianToT ?? '—'} · n=${validToT.length}`,  extra: totBadge },
    { icon: '🛒',  val: avgB != null ? avgB.toLocaleString() + ' SYP' : '—', label: 'Avg Food Basket', sub: `5 items · n=${validB.length}`, extra: '' },
    { icon: '⚠️',  val: `${fearful}/${data.length}`, label: 'Fearful / Alert', sub: `${pct}% of respondents`, extra: '' },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.val}</div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-sub">${s.sub}</div>
      ${s.extra}
    </div>`
  ).join('');
}

// ---- Key Findings ----

function renderFindings(data) {
  const panel = document.getElementById('findings');
  if (!panel) return;

  const valid = getValidPriceData(data);
  const findings = [];

  // ToT crisis entries
  const crisisEntries = valid.filter(r => r.tot != null && r.tot < 5);
  if (crisisEntries.length > 0) {
    const cities = [...new Set(crisisEntries.map(r => r.city))];
    findings.push(`<strong>${crisisEntries.length} report${crisisEntries.length > 1 ? 's' : ''}</strong> below WFP crisis threshold (ToT&nbsp;&lt;&nbsp;5) in: ${cities.join(', ')}. Severe purchasing power constraints.`);
  }

  // Fearful mood
  const fearful = data.filter(r => r.mood === 'Fearful' || r.mood === 'Trying to leave');
  if (fearful.length > 0 && data.length > 0) {
    const pct = Math.round(fearful.length / data.length * 100);
    findings.push(`<strong>${pct}%</strong> of respondents report fearful or worse mood. Primary concerns: economic insecurity and movement restrictions.`);
  }

  // Family-level migration
  const migrating = data.filter(r => r.migration === 'Several families');
  if (migrating.length > 0) {
    const cities = [...new Set(migrating.map(r => r.city))];
    findings.push(`Family-level departures observed in <strong>${cities.join(', ')}</strong> — indicates systematic displacement beyond individual economic migration.`);
  }

  // Days of wages for food basket
  const withWage = valid.filter(r => r.wage && r.basket);
  if (withWage.length > 0) {
    const avgWage   = withWage.reduce((s, r) => s + r.wage, 0) / withWage.length;
    const avgBasket = withWage.reduce((s, r) => s + r.basket, 0) / withWage.length;
    const days = (avgBasket / avgWage).toFixed(1);
    findings.push(`Average unskilled worker needs <strong>${days} days' wages</strong> to afford a basic 5-item food basket. WFP considers &gt;&nbsp;2.0&nbsp;days as stressed.`);
  }

  // Currency mismatch warnings
  const flagged = data.filter(r => r.currency_flag);
  if (flagged.length > 0) {
    findings.push(`<span style="color:var(--orange)">⚠ ${flagged.length} report${flagged.length > 1 ? 's' : ''} flagged for possible currency mismatch</span> (prices too low for SYP — likely USD or TRY). Excluded from price averages.`);
  }

  // Small sample warning
  const { fromMonth, toMonth } = getFilterState();
  const isSingleMonth = fromMonth && toMonth && fromMonth === toMonth;
  if (isSingleMonth && data.length < 5) {
    findings.push(`<span style="color:var(--orange)">⚠ Only ${data.length} report${data.length !== 1 ? 's' : ''} for this period.</span> Small sample — interpret with caution.`);
  }

  if (!findings.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = `<h3>💡 Key Findings</h3>` +
    findings.map(f => `<div class="finding-item"><span class="finding-bullet">▸</span><span>${f}</span></div>`).join('');
}

// ---- City detail ----

function renderCityDetail() {
  const panel = document.getElementById('cityDetail');
  if (!panel) return;
  if (selectedCity === 'all') { panel.style.display = 'none'; return; }

  const cityData = allData.filter(r => r.city === selectedCity);
  if (!cityData.length) { panel.style.display = 'none'; return; }

  const latest = cityData[cityData.length - 1];
  const mc = MOOD_COLOR[latest.mood] || '#64748b';
  const tc = totColor(latest.tot);

  const currencyWarn = latest.currency_flag
    ? `<div class="currency-warn">⚠ Prices possibly in ${latest.currency_flag === 'likely_usd' ? 'USD' : 'TRY'}, not SYP — excluded from averages.</div>`
    : '';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="city-detail-header">
      <div>
        <div class="city-name">${selectedCity}</div>
        <div class="city-date">Latest: ${formatDate(latest.date)} | ${cityData.length} total reports</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="badge" style="background:${mc}20;color:${mc}">${latest.mood}</span>
        <span class="badge" style="background:#3b82f620;color:#3b82f6">${latest.job} jobs</span>
        ${latest.tot != null ? `<span class="badge" style="background:${tc.bg};color:${tc.text}">ToT ${latest.tot} — ${tc.label}</span>` : ''}
      </div>
    </div>
    ${currencyWarn}
    <div class="detail-grid">
      ${[
        { l: 'Flour 1kg',             v: latest.flour && latest.validPrices ? `${latest.flour.toLocaleString()} SYP` : 'N/A' },
        { l: 'Rice 1kg',              v: latest.rice  && latest.validPrices ? `${latest.rice.toLocaleString()} SYP`  : 'N/A' },
        { l: 'Cooking Oil 1L',        v: latest.oil   && latest.validPrices ? `${latest.oil.toLocaleString()} SYP`   : 'N/A' },
        { l: 'Daily Wage (unskilled)',v: latest.wage        ? `${latest.wage.toLocaleString()} SYP`  : 'N/A' },
        { l: 'Daily Wage (skilled)',  v: latest.wageSkilled ? `${latest.wageSkilled.toLocaleString()} SYP` : 'N/A' },
        { l: 'Terms of Trade',        v: latest.tot != null ? `${latest.tot} kg flour` : 'N/A', sub: latest.tot != null ? tc.label : '' },
        { l: 'Food Basket (5 items)', v: latest.basket && latest.validPrices ? `${latest.basket.toLocaleString()} SYP` : 'N/A' },
        { l: 'Monthly Rent',          v: latest.rent && latest.rent > 100 ? `${latest.rent.toLocaleString()} SYP` : 'N/A' },
        { l: 'Movement',              v: latest.movement || 'N/A' },
      ].map(i => `<div class="detail-item">
        <div class="detail-item-label">${i.l}</div>
        <div class="detail-item-value">${i.v}</div>
        ${i.sub ? `<div class="detail-item-sub">${i.sub}</div>` : ''}
      </div>`).join('')}
    </div>`;
}

// ---- Compare ----

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

// ---- Footer meta ----

function renderFooterMeta() {
  const el = document.getElementById('footerMeta');
  if (!el || !allData.length) return;
  const dates = allData
    .map(r => { const [d, m, y] = r.date.split('.'); return new Date(+y, +m - 1, +d); })
    .sort((a, b) => b - a);
  const latest = dates[0];
  const days   = Math.floor((new Date() - latest) / (1000 * 60 * 60 * 24));
  const latestEntry = allData.find(r => {
    const [d, m, y] = r.date.split('.');
    return new Date(+y, +m - 1, +d).getTime() === latest.getTime();
  });
  el.textContent = `Latest data: ${formatDate(latestEntry?.date || '')} (${days}d ago) | WFP JMMI-compatible | contact@csiors.org`;
}

// ---- PDF export ----

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
