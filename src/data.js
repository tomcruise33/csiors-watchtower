// ============================================================
// data.js — Load & process field data
// Designed to be API-swappable: swap fetchData() to hit an
// endpoint instead of a local JSON file.
// ============================================================

export const MOOD_SCORE  = { "Mostly calm": 1, "Worried": 2, "Fearful": 3, "Trying to leave": 4 };
export const MOOD_COLOR  = { "Mostly calm": "#22c55e", "Worried": "#f59e0b", "Fearful": "#ef4444", "Trying to leave": "#7c2d12" };
export const JOB_SCORE   = { "High": 1, "Medium": 2, "Low": 3, "Very low": 4 };
export const MOVE_SCORE  = { "Unrestricted": 1, "Slightly restricted": 2, "Significantly restricted": 3, "Very restricted": 4 };
export const MIGR_SCORE  = { "None": 0, "Mostly individuals": 1, "Several families": 2 };

export const CHART_COLORS = ["#3b82f6","#f59e0b","#22c55e","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16"];

// City → country mapping (used to derive country for legacy flat JSON entries)
export const COUNTRY_FOR_CITY = {
  "Raqqa": "Syria", "Al-Hasakah": "Syria", "Deir ez-Zor": "Syria",
  "Al-Tabqa": "Syria", "Al-Busayrah": "Syria", "Al-Suwar": "Syria",
  "Al-Mayadin": "Syria", "Aleppo": "Syria",
  "Beirut": "Lebanon", "Tripoli (Lebanon)": "Lebanon", "Sidon": "Lebanon", "Bekaa Valley": "Lebanon",
  "Amman": "Jordan", "Zaatari": "Jordan", "Irbid": "Jordan",
  "Istanbul": "Turkey", "Gaziantep": "Turkey", "Şanlıurfa": "Turkey", "Hatay": "Turkey",
  "Baghdad": "Iraq", "Erbil": "Iraq", "Mosul": "Iraq",
  "Casablanca": "Morocco", "Rabat": "Morocco", "Tangier": "Morocco", "Nador": "Morocco",
  "N'Djamena": "Chad", "Abéché": "Chad",
  "Dakar": "Senegal", "Saint-Louis": "Senegal",
  "Addis Ababa": "Ethiopia", "Dire Dawa": "Ethiopia",
  "Khartoum": "Sudan", "Port Sudan": "Sudan",
  "Cairo": "Egypt", "Alexandria": "Egypt",
  "Tripoli (Libya)": "Libya", "Benghazi": "Libya",
  "Tunis": "Tunisia",
};

// City geographic coordinates [lat, lng]
export const CITY_COORDS = {
  "Raqqa":      [35.95, 39.01],
  "Al-Hasakah": [36.50, 40.75],
  "Deir ez-Zor":[35.34, 40.14],
  "Al-Tabqa":   [35.83, 38.56],
  "Al-Busayrah":[35.15, 40.23],
  "Al-Suwar":   [35.53, 40.38],
  "Al-Mayadin": [35.02, 40.45],
  "Aleppo":     [36.20, 37.16],
};

/**
 * Format "D.M.YYYY HH:MM:SS" → "4 Nov 2025"
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const datePart = dateStr.split(' ')[0];
  const parts = datePart.split('.');
  if (parts.length !== 3) return datePart;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parts[0]} ${months[parseInt(parts[1]) - 1]} ${parts[2]}`;
}

/**
 * Return background, text colour, and label for a ToT value using WFP thresholds.
 */
export function totColor(tot) {
  if (tot === null || tot === undefined) return { bg: '#47556920', text: '#475569', label: 'N/A' };
  if (tot < 3)  return { bg: '#ef444425', text: '#ef4444', label: 'EMERGENCY' };
  if (tot < 5)  return { bg: '#f9731625', text: '#f97316', label: 'CRISIS' };
  if (tot < 8)  return { bg: '#f59e0b25', text: '#f59e0b', label: 'STRESSED' };
  if (tot < 12) return { bg: '#22c55e20', text: '#22c55e', label: 'ACCEPTABLE' };
  return { bg: '#22c55e35', text: '#22c55e', label: 'GOOD' };
}

/**
 * Fetch data from the JSON file.
 * To switch to an API, change the URL to an endpoint like:
 *   const res = await fetch('/api/reports?from=...&to=...')
 */
export async function fetchData() {
  const res = await fetch('/data/syria_field_data.json');
  if (!res.ok) throw new Error('Failed to load field data');
  const raw = await res.json();
  return raw
    .filter(r => r.quality !== 'suspect')
    .map(normalizeRecord);
}

/**
 * Normalize a raw record into a consistent shape.
 * Detects currency mismatches at runtime (flour < 500 SYP → flagged).
 */
function normalizeRecord(r) {
  // Currency: explicit v2 field takes precedence over heuristic
  const explicitCurrency = (r.currency || '').toLowerCase();
  const currencyFlag = r.currency_flag ||
    (explicitCurrency && explicitCurrency !== 'syp' && explicitCurrency !== 'ل.س'
      ? explicitCurrency
      : (r.flour && r.flour > 0 && r.flour < 500 ? 'likely_usd' : null));

  const tot = (r.tot_flour_kg && r.tot_flour_kg < 25) ? r.tot_flour_kg : null;

  // Country: use explicit field (KoboToolbox v2) or derive from city
  const country = r.country_normalized || r.country || COUNTRY_FOR_CITY[r.city] || 'Unknown';

  return {
    date:          r.date.split(' ')[0],   // strip timestamp
    month:         r.month,
    city:          r.city,
    city_ar:       r.city_ar,
    country,
    lat:           r.lat,
    lon:           r.lon,
    flour:         r.flour,
    rice:          r.rice,
    oil:           r.oil,
    eggs:          r.eggs,
    water:         r.water,
    gasoline:      r.gasoline,
    diesel:        r.diesel,
    lpg:           r.lpg,
    wage:          r.wage_unskilled,
    wageSkilled:   r.wage_skilled,
    rent:          r.rent,
    job:           r.job_availability,
    tot,
    basket:        r.food_basket,
    mood:          r.mood,
    movement:      r.movement,
    migration:     r.migration,
    quality:       r.quality,
    currency:      explicitCurrency || 'syp',
    currency_flag: currencyFlag,
    validPrices:   !currencyFlag,
  };
}

/** Get sorted unique months from data array. */
export function getMonths(data) {
  return [...new Set(data.map(r => r.month))].sort();
}

/** Get sorted unique cities from data array, optionally filtered by country. */
export function getCities(data, country = 'all') {
  const filtered = country !== 'all' ? data.filter(r => r.country === country) : data;
  return [...new Set(filtered.map(r => r.city))].sort();
}

/** Get sorted unique countries from data array. */
export function getCountries(data) {
  return [...new Set(data.map(r => r.country).filter(Boolean))].sort();
}

/** Filter data by month range, city, and country. */
export function filterData(data, { fromMonth, toMonth, city, country }) {
  return data.filter(r => {
    if (fromMonth && r.month < fromMonth) return false;
    if (toMonth   && r.month > toMonth)   return false;
    if (country && country !== 'all' && r.country !== country) return false;
    if (city    && city    !== 'all' && r.city    !== city)    return false;
    return true;
  });
}

/** Return only entries with valid SYP prices. */
export function getValidPriceData(data) {
  return data.filter(r => r.validPrices);
}

/**
 * Aggregate data by city: compute average ToT, worst mood, report count.
 * Uses only validPrices entries for ToT/basket averages.
 */
export function aggregateByCity(data) {
  const agg = {};
  data.forEach(r => {
    if (!agg[r.city]) agg[r.city] = { moods: [], tots: [], baskets: [], reports: [] };
    agg[r.city].moods.push(r.mood);
    if (r.validPrices && r.tot != null) agg[r.city].tots.push(r.tot);
    if (r.validPrices && r.basket)      agg[r.city].baskets.push(r.basket);
    agg[r.city].reports.push(r);
  });

  Object.values(agg).forEach(a => {
    a.worstMood = a.moods.reduce((worst, m) =>
      (MOOD_SCORE[m] || 0) > (MOOD_SCORE[worst] || 0) ? m : worst,
      'Mostly calm'
    );
    a.avgToT = a.tots.length > 0
      ? +(a.tots.reduce((s, v) => s + v, 0) / a.tots.length).toFixed(1)
      : null;
    a.avgBasket = a.baskets.length > 0
      ? Math.round(a.baskets.reduce((s, v) => s + v, 0) / a.baskets.length)
      : null;
    a.n = a.reports.length;
  });

  return agg;
}

/**
 * Compute month-over-month comparison for two months.
 * Returns array of { metric, prev, curr, delta, unit } objects.
 */
export function compareMonths(data, prevMonth, currMonth) {
  const prev = data.filter(r => r.month === prevMonth);
  const curr = data.filter(r => r.month === currMonth);
  if (!prev.length || !curr.length) return [];

  const avg = (arr, fn) => {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  const metrics = [
    { key: 'tot',    label: 'Avg ToT',        fn: r => r.validPrices && r.tot != null ? r.tot : null, unit: 'kg', decimals: 1, lowerBetter: false },
    { key: 'basket', label: 'Food Basket',     fn: r => r.validPrices ? r.basket  : null, unit: 'SYP', decimals: 0, lowerBetter: true },
    { key: 'flour',  label: 'Flour 1kg',       fn: r => r.validPrices ? r.flour   : null, unit: 'SYP', decimals: 0, lowerBetter: true },
    { key: 'wage',   label: 'Daily Wage',      fn: r => r.wage,    unit: 'SYP', decimals: 0, lowerBetter: false },
    { key: 'mood',   label: 'Mood Score',      fn: r => MOOD_SCORE[r.mood] || 0, unit: '/4', decimals: 1, lowerBetter: true },
    { key: 'jobs',   label: 'Job Scarcity',    fn: r => JOB_SCORE[r.job]  || 0, unit: '/4', decimals: 1, lowerBetter: true },
    { key: 'move',   label: 'Movement Restr.', fn: r => MOVE_SCORE[r.movement] || 0, unit: '/4', decimals: 1, lowerBetter: true },
    { key: 'migr',   label: 'Migration Pres.', fn: r => MIGR_SCORE[r.migration] ?? 0, unit: '/2', decimals: 1, lowerBetter: true },
  ];

  return metrics.map(m => {
    const p = avg(prev, m.fn);
    const c = avg(curr, m.fn);
    const delta = (p != null && c != null) ? +(c - p).toFixed(m.decimals) : null;
    return {
      label: m.label,
      prev:  p != null ? +p.toFixed(m.decimals) : null,
      curr:  c != null ? +c.toFixed(m.decimals) : null,
      delta,
      unit: m.unit,
      lowerBetter: m.lowerBetter,
    };
  });
}

/** Format month code to human label ("2025-11" → "Nov 2025"). */
export function fmtMonth(m) {
  const [y, mo] = m.split('-');
  const d = new Date(+y, +mo - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
