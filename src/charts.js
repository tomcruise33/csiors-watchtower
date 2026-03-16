// ============================================================
// charts.js — Chart.js chart renderers
// When selectedCity === 'all': multi-city grouped view
// When city selected: individual observations for that city
// ============================================================
import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { CHART_COLORS, fmtMonth, formatDate, getValidPriceData, totColor } from './data.js';

Chart.register(...registerables, annotationPlugin);

const DARK_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: '#334155',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#1e293b' } },
    y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#1e293b' } },
  },
};

const WFP_ANNOTATIONS = {
  emergencyLine: {
    type: 'line', yMin: 3, yMax: 3,
    borderColor: '#ef4444', borderWidth: 2, borderDash: [6, 3],
    label: { display: true, content: 'Emergency (3)', position: 'start', backgroundColor: '#ef444499', color: '#fff', font: { size: 10 } },
  },
  crisisLine: {
    type: 'line', yMin: 5, yMax: 5,
    borderColor: '#f97316', borderWidth: 1.5, borderDash: [6, 3],
    label: { display: true, content: 'Crisis (5)', position: 'start', backgroundColor: '#f9731699', color: '#fff', font: { size: 10 } },
  },
  acceptableLine: {
    type: 'line', yMin: 8, yMax: 8,
    borderColor: '#22c55e55', borderWidth: 1, borderDash: [4, 4],
  },
};

let totChart   = null;
let priceChart = null;

function sortByDate(rows) {
  return [...rows].sort((a, b) => {
    const [da, ma, ya] = a.date.split('.');
    const [db, mb, yb] = b.date.split('.');
    return new Date(+ya, +ma - 1, +da) - new Date(+yb, +mb - 1, +db);
  });
}

export function renderToTChart(allData, months, selectedCity) {
  const ctx = document.getElementById('totChart')?.getContext('2d');
  if (!ctx) return;
  if (totChart) { totChart.destroy(); totChart = null; }

  const valid    = getValidPriceData(allData);
  const titleEl  = document.getElementById('totChartTitle');
  const subEl    = document.getElementById('totChartSub');
  const sampleEl = document.getElementById('totSample');

  const yAxisOpts = {
    ...DARK_OPTS.scales.y,
    min: 0,
    title: { display: true, text: 'kg flour / day wage', color: '#64748b', font: { size: 10 } },
  };
  const baseOpts = {
    ...DARK_OPTS,
    scales: { ...DARK_OPTS.scales, y: yAxisOpts },
    plugins: { ...DARK_OPTS.plugins, annotation: { annotations: WFP_ANNOTATIONS } },
  };

  if (selectedCity !== 'all') {
    // ---- Single-city: individual observations ----
    const cityData = sortByDate(valid.filter(r => r.city === selectedCity && r.tot != null));
    const n = cityData.length;

    if (titleEl) titleEl.textContent = `${selectedCity} — Terms of Trade (Observed Values)`;
    if (subEl)   subEl.textContent   = `Individual observations — higher = better purchasing power`;
    if (sampleEl) sampleEl.textContent = `n=${n} observation${n !== 1 ? 's' : ''} for ${selectedCity}`;

    totChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: cityData.map(r => formatDate(r.date)),
        datasets: [{
          label: selectedCity,
          data: cityData.map(r => r.tot),
          backgroundColor: cityData.map(r => totColor(r.tot).text + '99'),
          borderColor:     cityData.map(r => totColor(r.tot).text),
          borderWidth: 1, borderRadius: 4,
        }],
      },
      options: baseOpts,
    });
  } else {
    // ---- All cities: grouped bars by month ----
    if (titleEl) titleEl.textContent = 'Terms of Trade Index';
    if (subEl)   subEl.textContent   = 'kg of flour purchasable with 1 day unskilled wage (higher = better)';

    const cities = [...new Set(valid.map(r => r.city))].sort();
    const datasets = cities.map((c, i) => {
      const values = months.map(m => {
        const entries = valid.filter(r => r.city === c && r.month === m && r.tot != null);
        return entries.length > 0
          ? +(entries.reduce((s, r) => s + r.tot, 0) / entries.length).toFixed(1)
          : null;
      });
      const col = CHART_COLORS[i % CHART_COLORS.length];
      return { label: c, data: values, backgroundColor: col + 'bb', borderColor: col, borderWidth: 1, borderRadius: 4, skipNull: true };
    });

    const samples = months.map(m => valid.filter(r => r.month === m && r.tot != null).length);
    if (sampleEl) sampleEl.textContent = 'Sample: ' + months.map((m, i) => `${fmtMonth(m)}: n=${samples[i]}`).join(' | ');

    totChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: months.map(fmtMonth), datasets },
      options: baseOpts,
    });
  }
}

export function renderPriceChart(allData, months, selectedCity) {
  const ctx = document.getElementById('priceChart')?.getContext('2d');
  if (!ctx) return;
  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const valid    = getValidPriceData(allData);
  const titleEl  = document.getElementById('priceChartTitle');
  const subEl    = document.getElementById('priceChartSub');
  const sampleEl = document.getElementById('priceSample');

  const yAxisOpts = {
    ...DARK_OPTS.scales.y,
    title: { display: true, text: 'SYP (5-item basket)', color: '#64748b', font: { size: 10 } },
    ticks: { ...DARK_OPTS.scales.y.ticks, callback: v => v.toLocaleString() },
  };
  const tooltipOpts = {
    ...DARK_OPTS.plugins.tooltip,
    callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y?.toLocaleString() || 'N/A'} SYP` },
  };

  if (selectedCity !== 'all') {
    // ---- Single-city: individual observations ----
    const cityData = sortByDate(valid.filter(r => r.city === selectedCity && r.basket));
    const n = cityData.length;

    if (titleEl) titleEl.textContent = `${selectedCity} — Food Basket Cost (Observed Values)`;
    if (subEl)   subEl.textContent   = `Individual observations — 5-item basket total (SYP)`;
    if (sampleEl) sampleEl.textContent = `n=${n} observation${n !== 1 ? 's' : ''} for ${selectedCity}`;

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: cityData.map(r => formatDate(r.date)),
        datasets: [{
          label: selectedCity,
          data: cityData.map(r => r.basket),
          borderColor: '#3b82f6', backgroundColor: '#3b82f620',
          borderWidth: 2, pointRadius: 6, pointBackgroundColor: '#3b82f6',
          tension: 0.3, fill: false,
        }],
      },
      options: {
        ...DARK_OPTS,
        scales: { ...DARK_OPTS.scales, y: yAxisOpts },
        plugins: { ...DARK_OPTS.plugins, tooltip: tooltipOpts },
      },
    });
  } else {
    // ---- All cities: grouped lines by month ----
    if (titleEl) titleEl.textContent = 'Food Basket Cost';
    if (subEl)   subEl.textContent   = '5-item basket — monthly average per city';

    const cities = [...new Set(valid.map(r => r.city))].sort();
    const datasets = cities.map((c, i) => {
      const values = months.map(m => {
        const entries = valid.filter(r => r.city === c && r.month === m && r.basket);
        return entries.length > 0
          ? Math.round(entries.reduce((s, r) => s + r.basket, 0) / entries.length)
          : null;
      });
      const col = CHART_COLORS[i % CHART_COLORS.length];
      return {
        label: c, data: values,
        borderColor: col, backgroundColor: col + '20',
        borderWidth: 2, pointRadius: 5, pointBackgroundColor: col,
        tension: 0.3, fill: false, spanGaps: false,
      };
    });

    const samples = months.map(m => valid.filter(r => r.month === m && r.basket).length);
    if (sampleEl) sampleEl.textContent = 'Sample: ' + months.map((m, i) => `${fmtMonth(m)}: n=${samples[i]}`).join(' | ');

    priceChart = new Chart(ctx, {
      type: 'line',
      data: { labels: months.map(fmtMonth), datasets },
      options: {
        ...DARK_OPTS,
        scales: { ...DARK_OPTS.scales, y: yAxisOpts },
        plugins: { ...DARK_OPTS.plugins, tooltip: tooltipOpts },
      },
    });
  }
}
