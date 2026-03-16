// ============================================================
// filters.js — Dropdown filter init and state
// ============================================================
import { getMonths, getCities, getCountries, fmtMonth } from './data.js';

export function initFilters(data, onChange) {
  const months    = getMonths(data);
  const countries = getCountries(data);

  // Month range selects
  const fromEl = document.getElementById('monthFrom');
  const toEl   = document.getElementById('monthTo');
  if (fromEl && toEl) {
    months.forEach(m => {
      [fromEl, toEl].forEach(el => {
        const o = document.createElement('option');
        o.value = m; o.textContent = fmtMonth(m);
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

  // Country select
  const countryEl = document.getElementById('countryFilter');
  if (countryEl) {
    countries.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      countryEl.appendChild(o);
    });
    countryEl.addEventListener('change', () => {
      // Reset city to "all" when country changes
      const cityEl = document.getElementById('cityFilter');
      if (cityEl) cityEl.value = 'all';
      // Re-populate city dropdown for selected country
      _populateCities(data, countryEl.value);
      onChange(getFilterState());
    });
  }

  // City select
  _populateCities(data, 'all');
  const cityEl = document.getElementById('cityFilter');
  if (cityEl) {
    cityEl.addEventListener('change', () => onChange(getFilterState()));
  }
}

function _populateCities(data, country) {
  const cityEl = document.getElementById('cityFilter');
  if (!cityEl) return;
  // Keep only the "All Cities" option, then repopulate
  while (cityEl.options.length > 1) cityEl.remove(1);
  getCities(data, country).forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    cityEl.appendChild(o);
  });
}

export function getFilterState() {
  return {
    fromMonth: document.getElementById('monthFrom')?.value    || null,
    toMonth:   document.getElementById('monthTo')?.value      || null,
    country:   document.getElementById('countryFilter')?.value || 'all',
    city:      document.getElementById('cityFilter')?.value    || 'all',
  };
}
