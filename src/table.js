// ============================================================
// table.js — Sortable data table
// ============================================================
import { MOOD_COLOR } from './data.js';

let sortCol     = 'date';
let sortDir     = 'desc';
let _onRowClick = null;

export function initTable(clickHandler) {
  _onRowClick = clickHandler;

  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      document.querySelectorAll('th[data-col]').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      document.dispatchEvent(new CustomEvent('table:sort'));
    });
  });
}

export function renderTable(data, selectedCity) {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;

  const search = (document.getElementById('tableSearch')?.value || '').toLowerCase();
  let rows = data.filter(r =>
    !search ||
    r.city.toLowerCase().includes(search) ||
    (r.mood || '').toLowerCase().includes(search)
  );
  rows = sortRows(rows);

  tbody.innerHTML = rows.map(r => {
    const mc  = MOOD_COLOR[r.mood] || '#64748b';
    const tot = r.tot && r.tot < 25 ? r.tot : '—';
    const sel = selectedCity === r.city;
    return `<tr${sel ? ' class="selected"' : ''} data-city="${r.city}">
      <td>${r.date}</td>
      <td><strong>${r.city}</strong></td>
      <td>${r.flour ? r.flour.toLocaleString() : '—'}</td>
      <td>${r.wage  ? r.wage.toLocaleString()  : '—'}</td>
      <td><strong>${tot}</strong></td>
      <td><span class="mood-dot" style="background:${mc}"></span>${r.mood || '—'}</td>
      <td>${r.job || '—'}</td>
      <td>${r.movement || '—'}</td>
      <td>${r.migration || '—'}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => _onRowClick && _onRowClick(tr.dataset.city));
  });
}

function sortRows(rows) {
  const fns = {
    date:      r => r.date,
    city:      r => r.city,
    flour:     r => r.flour || 0,
    wage:      r => r.wage  || 0,
    tot:       r => (r.tot && r.tot < 25 ? r.tot : 0),
    mood:      r => r.mood      || '',
    job:       r => r.job       || '',
    movement:  r => r.movement  || '',
    migration: r => r.migration || '',
  };
  const fn = fns[sortCol] || (r => r.date);
  return [...rows].sort((a, b) => {
    const av = fn(a), bv = fn(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });
}
