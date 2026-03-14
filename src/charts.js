// ============================================================
// charts.js — Chart.js chart renderers
// ============================================================
import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { CHART_COLORS, fmtMonth, getValidPriceData } from './data.js';

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

let totChart   = null;
let priceChart = null;

export function renderToTChart(allData, months, selectedCity) {
  const ctx = document.getElementById('totChart')?.getContext('2d');
  if (!ctx) return;
  if (totChart) { totChart.destroy(); totChart = null; }

  const valid = getValidPriceData(allData);
  const cities = selectedCity === 'all'
    ? [...new Set(valid.map(r => r.city))].sort()
    : [selectedCity];

  const datasets = cities.map((c, i) => {
    const values = months.map(m => {
      const entries = valid.filter(r => r.city === c && r.month === m && r.tot != null);
      return entries.length > 0
        ? +(entries.reduce((s, r) => s + r.tot, 0) / entries.length).toFixed(1)
        : null;
    });
    const col = CHART_COLORS[i % CHART_COLORS.length];
    return {
      label: c, data: values,
      backgroundColor: col + 'bb', borderColor: col,
      borderWidth: 1, borderRadius: 4, skipNull: true,
    };
  });

  // Sample counts per month
  const samples = months.map(m => valid.filter(r => r.month === m && r.tot != null).length);
  const sampleEl = document.getElementById('totSample');
  if (sampleEl) sampleEl.textContent = 'Sample: ' + months.map((m, i) => `${fmtMonth(m)}: n=${samples[i]}`).join(' | ');

  totChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: months.map(fmtMonth), datasets },
    options: {
      ...DARK_OPTS,
      scales: {
        ...DARK_OPTS.scales,
        y: {
          ...DARK_OPTS.scales.y,
          min: 0,
          title: { display: true, text: 'kg flour / day wage', color: '#64748b', font: { size: 10 } },
        },
      },
      plugins: {
        ...DARK_OPTS.plugins,
        annotation: {
          annotations: {
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
          },
        },
      },
    },
  });
}

export function renderPriceChart(allData, months, selectedCity) {
  const ctx = document.getElementById('priceChart')?.getContext('2d');
  if (!ctx) return;
  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const valid = getValidPriceData(allData);
  const filtered = selectedCity === 'all' ? valid : valid.filter(r => r.city === selectedCity);
  const cities = selectedCity === 'all'
    ? [...new Set(filtered.map(r => r.city))].sort()
    : [selectedCity];

  const datasets = cities.map((c, i) => {
    const values = months.map(m => {
      const entries = filtered.filter(r => r.city === c && r.month === m && r.basket);
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

  // Sample counts per month
  const samples = months.map(m => filtered.filter(r => r.month === m && r.basket).length);
  const sampleEl = document.getElementById('priceSample');
  if (sampleEl) sampleEl.textContent = 'Sample: ' + months.map((m, i) => `${fmtMonth(m)}: n=${samples[i]}`).join(' | ');

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels: months.map(fmtMonth), datasets },
    options: {
      ...DARK_OPTS,
      scales: {
        ...DARK_OPTS.scales,
        y: {
          ...DARK_OPTS.scales.y,
          title: { display: true, text: 'SYP (5-item basket)', color: '#64748b', font: { size: 10 } },
          ticks: { ...DARK_OPTS.scales.y.ticks, callback: v => v.toLocaleString() },
        },
      },
      plugins: {
        ...DARK_OPTS.plugins,
        tooltip: {
          ...DARK_OPTS.plugins.tooltip,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString() || 'N/A'} SYP` },
        },
      },
    },
  });
}
