// ============================================================
// charts.js — Chart.js chart renderers
// ============================================================
import { Chart, registerables } from 'chart.js';
import { CHART_COLORS, fmtMonth } from './data.js';

Chart.register(...registerables);

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

  const cities = selectedCity === 'all'
    ? [...new Set(allData.map(r => r.city))].sort()
    : [selectedCity];

  const datasets = cities.map((c, i) => {
    const values = months.map(m => {
      const entries = allData.filter(r => r.city === c && r.month === m && r.tot && r.tot < 25);
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

  totChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: months.map(fmtMonth), datasets },
    options: {
      ...DARK_OPTS,
      scales: {
        ...DARK_OPTS.scales,
        y: {
          ...DARK_OPTS.scales.y,
          title: { display: true, text: 'kg flour / day wage', color: '#64748b', font: { size: 10 } },
        },
      },
    },
  });
}

export function renderPriceChart(allData, months, selectedCity) {
  const ctx = document.getElementById('priceChart')?.getContext('2d');
  if (!ctx) return;
  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const filtered = selectedCity === 'all' ? allData : allData.filter(r => r.city === selectedCity);
  const items  = ['flour', 'rice', 'oil', 'eggs', 'water'];
  const labels = ['Flour 1kg', 'Rice 1kg', 'Oil 1L', 'Eggs 10pc', 'Water 1.5L'];
  const colors = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6'];

  const datasets = items.map((item, i) => {
    const values = months.map(m => {
      const entries = filtered.filter(r => r.month === m && r[item] && r[item] > 100);
      return entries.length > 0
        ? Math.round(entries.reduce((s, r) => s + r[item], 0) / entries.length)
        : null;
    });
    return {
      label: labels[i], data: values,
      borderColor: colors[i], backgroundColor: colors[i] + '20',
      borderWidth: 2, pointRadius: 4, pointBackgroundColor: colors[i],
      tension: 0.3, fill: false, spanGaps: true,
    };
  });

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels: months.map(fmtMonth), datasets },
    options: DARK_OPTS,
  });
}
