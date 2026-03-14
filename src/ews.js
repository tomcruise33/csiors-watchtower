// ============================================================
// ews.js — Early Warning System panel renderer
// ============================================================
import { MOOD_SCORE, JOB_SCORE, MOVE_SCORE, MIGR_SCORE, getValidPriceData } from './data.js';

export function renderEWS(data) {
  const panel = document.getElementById('ewsPanel');
  if (!panel) return;

  if (!data.length) {
    panel.style.background = '';
    panel.style.border = '';
    panel.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px 0">No data for selected filters</div>';
    return;
  }

  const valid = getValidPriceData(data);

  const avg = (arr, fn) => {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };

  const moodAvg = avg(data, r => MOOD_SCORE[r.mood] || 0);
  const jobAvg  = avg(data, r => JOB_SCORE[r.job]   || 0);
  const moveAvg = avg(data, r => MOVE_SCORE[r.movement] || 0);
  const migrAvg = avg(data, r => MIGR_SCORE[r.migration] ?? 0);

  const validToT = valid.filter(r => r.tot != null);
  const totAvg   = validToT.length > 0
    ? validToT.reduce((s, r) => s + r.tot, 0) / validToT.length
    : null;

  // Purchasing power using WFP threshold buckets (not linear)
  let ppVal;
  if      (totAvg === null) ppVal = 0.5;   // unknown → assume moderate
  else if (totAvg < 3)     ppVal = 1.0;   // emergency
  else if (totAvg < 5)     ppVal = 0.75;  // crisis
  else if (totAvg < 8)     ppVal = 0.40;  // stressed
  else if (totAvg < 12)    ppVal = 0.15;  // acceptable
  else                     ppVal = 0.0;   // good

  const score = Math.round(
    (moodAvg / 4 * 25) + (jobAvg / 4 * 20) + (moveAvg / 4 * 20) +
    (migrAvg / 2 * 15) + (ppVal * 20)
  );

  let level, color, bg;
  if      (score < 30) { level = 'STABLE';  color = '#22c55e'; bg = '#052e16'; }
  else if (score < 50) { level = 'WATCH';   color = '#f59e0b'; bg = '#422006'; }
  else if (score < 70) { level = 'WARNING'; color = '#f97316'; bg = '#431407'; }
  else                 { level = 'ALERT';   color = '#ef4444'; bg = '#450a0a'; }

  const indicators = [
    { name: 'Public Mood',        pct: Math.round(moodAvg / 4 * 100), tooltip: 'Avg respondent mood (calm=0%, fearful=75%, trying to leave=100%)' },
    { name: 'Job Scarcity',       pct: Math.round(jobAvg  / 4 * 100), tooltip: 'Job availability inverted (high=0%, very low=100%)' },
    { name: 'Movement Restr.',    pct: Math.round(moveAvg / 4 * 100), tooltip: 'Freedom of movement (unrestricted=0%, very restricted=100%)' },
    { name: 'Migration Pressure', pct: Math.round(migrAvg / 2 * 100), tooltip: 'Observed departures (none=0%, families=100%)' },
    { name: 'Purchasing Power',   pct: Math.round(ppVal * 100), tooltip: `Based on avg ToT ${totAvg != null ? totAvg.toFixed(1) : 'N/A'} (WFP: <3=emergency, <5=crisis, <8=stressed)` },
  ];

  panel.style.background = bg;
  panel.style.border = `1px solid ${color}40`;

  panel.innerHTML = `
    <div class="ews-header">
      <div>
        <div class="ews-label">Early Warning Score</div>
        <div class="ews-score" style="color:${color}">${score}</div>
      </div>
      <div class="ews-badge" style="background:${color}">${level}</div>
    </div>
    ${indicators.map(ind => {
      const barCol = ind.pct > 70 ? '#ef4444' : ind.pct > 40 ? '#f59e0b' : '#22c55e';
      return `<div class="ews-bar-row" title="${ind.tooltip}">
        <span class="ews-bar-label">${ind.name}</span>
        <div class="ews-bar-track"><div class="ews-bar-fill" style="width:${ind.pct}%;background:${barCol}"></div></div>
        <span class="ews-bar-val">${ind.pct}%</span>
      </div>`;
    }).join('')}
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid ${color}20;color:var(--text-muted);font-size:10px">
      Composite index: mood (25%) + jobs (20%) + movement (20%) + migration (15%) + purchasing power (20%). Score 0–100, higher = worse. Based on n=${data.length} reports.
    </div>`;
}
