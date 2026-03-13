// ============================================================
// filters.js — Dropdown filter init and state
// ============================================================
import { getMonths, getCities, fmtMonth } from './data.js';

export function initFilters(data, onChange) {
  const months = getMonths(data);
  const cities = getCities(data);

  // Month range selects
  const fromEl = document.getElementById('monthFrom');
  const toEl   = document.getElementById('monthTo');

  if (fromEl && toEl) {
    months.forEach(m => {
      [fromEl, toEl].forEach(el => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = fmtMonth(m);
        el.appendChild(o);
      });
    });
    if (months.length) {
      fromEl.value = months[0];
      toEl.value   = months[months.length - 1];
    }
    fromEl.addEventListener('change', () => onChange(getFilterState()));
    toEl.addEventListener('change',   () => onChange(getFilterState()));
  }

  // City select
  const cityEl = document.getElementById('cityFilter');
  if (cityEl) {
    cities.forEach(c => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      cityEl.appendChild(o);
    });
    cityEl.addEventListener('change', () => onChange(getFilterState()));
  }
}

export function getFilterState() {
  return {
    fromMonth: document.getElementById('monthFrom')?.value || null,
    toMonth:   document.getElementById('monthTo')?.value   || null,
    city:      document.getElementById('cityFilter')?.value || 'all',
  };
}
