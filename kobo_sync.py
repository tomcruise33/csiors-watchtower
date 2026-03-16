#!/usr/bin/env python3
"""
CSIORS Watchtower — KoboToolbox → Dashboard Sync Script

Pulls submissions from KoboToolbox REST API, transforms them into
syria_field_data.json format, and optionally commits to git for
Vercel auto-redeploy.

Usage:
    # Local run (outputs JSON to stdout-ish, saves to file)
    python kobo_sync.py

    # With git commit (used by GitHub Actions)
    python kobo_sync.py --commit

    # Dry run (just print what would happen)
    python kobo_sync.py --dry-run

Environment variables:
    KOBO_TOKEN    - KoboToolbox API token (required)
    KOBO_ASSET_ID - KoboToolbox form/asset UID (required)
    KOBO_SERVER   - KoboToolbox server URL (default: https://eu.kobotoolbox.org)

To get your API token:
    1. Log in to eu.kobotoolbox.org
    2. Go to Account Settings (top right) → Security
    3. Click "Get API Key" or copy existing one
"""

import os
import sys
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

# --- Try to import requests; if missing, give helpful error ---
try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not installed.")
    print("  pip install requests")
    sys.exit(1)


# ==============================================================
# CONFIGURATION
# ==============================================================

KOBO_SERVER = os.environ.get("KOBO_SERVER", "https://eu.kobotoolbox.org")
KOBO_TOKEN = os.environ.get("KOBO_TOKEN", "")
KOBO_ASSET_ID = os.environ.get("KOBO_ASSET_ID", "")

# Output path (relative to repo root)
OUTPUT_PATH = Path("public/data/syria_field_data.json")

# City coordinate lookup
CITY_COORDS = {
    # Syria
    "Raqqa":            {"lat": 35.95, "lon": 39.01},
    "Al-Hasakah":       {"lat": 36.50, "lon": 40.75},
    "Al-Busayrah":      {"lat": 35.15, "lon": 40.25},
    "Al-Suwar":         {"lat": 35.55, "lon": 40.10},
    "Deir ez-Zor":      {"lat": 35.33, "lon": 40.14},
    "Al-Tabqa":         {"lat": 35.83, "lon": 38.57},
    "Al-Mayadin":       {"lat": 35.02, "lon": 40.45},
    "Aleppo":           {"lat": 36.20, "lon": 37.17},
    # Lebanon
    "Beirut":           {"lat": 33.89, "lon": 35.50},
    "Tripoli (Lebanon)":{"lat": 34.43, "lon": 35.85},
    "Sidon":            {"lat": 33.56, "lon": 35.37},
    "Bekaa Valley":     {"lat": 33.85, "lon": 35.90},
    # Jordan
    "Amman":            {"lat": 31.95, "lon": 35.93},
    "Zaatari":          {"lat": 32.29, "lon": 37.33},
    "Irbid":            {"lat": 32.55, "lon": 35.85},
    # Turkey
    "Istanbul":         {"lat": 41.01, "lon": 28.98},
    "Gaziantep":        {"lat": 37.06, "lon": 37.38},
    "Şanlıurfa":        {"lat": 37.16, "lon": 38.79},
    "Hatay":            {"lat": 36.20, "lon": 36.16},
    # Iraq
    "Baghdad":          {"lat": 33.34, "lon": 44.40},
    "Erbil":            {"lat": 36.19, "lon": 44.01},
    "Mosul":            {"lat": 36.34, "lon": 43.13},
    # Morocco
    "Casablanca":       {"lat": 33.57, "lon": -7.59},
    "Rabat":            {"lat": 34.02, "lon": -6.84},
    "Tangier":          {"lat": 35.77, "lon": -5.80},
    "Nador":            {"lat": 35.17, "lon": -2.93},
    # Chad
    "N'Djamena":        {"lat": 12.13, "lon": 15.05},
    "Abéché":           {"lat": 13.83, "lon": 20.83},
    # Senegal
    "Dakar":            {"lat": 14.69, "lon": -17.44},
    "Saint-Louis":      {"lat": 16.02, "lon": -16.49},
    # Ethiopia
    "Addis Ababa":      {"lat": 9.02,  "lon": 38.75},
    "Dire Dawa":        {"lat": 9.60,  "lon": 41.86},
    # Sudan
    "Khartoum":         {"lat": 15.59, "lon": 32.53},
    "Port Sudan":       {"lat": 19.61, "lon": 37.22},
    # Egypt
    "Cairo":            {"lat": 30.04, "lon": 31.24},
    "Alexandria":       {"lat": 31.20, "lon": 29.92},
    # Libya
    "Tripoli (Libya)":  {"lat": 32.90, "lon": 13.18},
    "Benghazi":         {"lat": 32.11, "lon": 20.07},
    # Tunisia
    "Tunis":            {"lat": 36.81, "lon": 10.17},
}

# v2 choice values → display country names
COUNTRY_NORMALIZE = {
    "syria": "Syria",      "سوريا": "Syria",
    "lebanon": "Lebanon",  "لبنان": "Lebanon",
    "jordan": "Jordan",    "الأردن": "Jordan",
    "iraq": "Iraq",        "العراق": "Iraq",
    "turkey": "Turkey",    "تركيا": "Turkey",
    "morocco": "Morocco",  "المغرب": "Morocco",
    "chad": "Chad",        "تشاد": "Chad",
    "senegal": "Senegal",  "السنغال": "Senegal",
    "ethiopia": "Ethiopia","إثيوبيا": "Ethiopia",
    "sudan": "Sudan",      "السودان": "Sudan",
    "egypt": "Egypt",      "مصر": "Egypt",
    "libya": "Libya",      "ليبيا": "Libya",
    "tunisia": "Tunisia",  "تونس": "Tunisia",
    "niger": "Niger",      "النيجر": "Niger",
    "yemen": "Yemen",      "اليمن": "Yemen",
    "palestine": "Palestine", "فلسطين": "Palestine",
}

# v2 currency choice codes → ISO symbols
CURRENCY_CODES = {
    "syp": "SYP", "usd": "USD", "try": "TRY", "lbp": "LBP",
    "jod": "JOD", "iqd": "IQD", "egp": "EGP", "mad": "MAD",
    "xof": "XOF", "xaf": "XAF", "etb": "ETB", "sdg": "SDG",
    "lyd": "LYD", "tnd": "TND", "eur": "EUR",
}

# Arabic → English city name mapping
CITY_NORMALIZE = {
    "الرقة": "Raqqa",
    "رقة": "Raqqa",
    "الحسكة": "Al-Hasakah",
    "القامشلي": "Al-Hasakah",
    "البوكمال": "Al-Busayrah",
    "البصيرة": "Al-Busayrah",
    "الصوار": "Al-Suwar",
    "دير الزور": "Deir ez-Zor",
    "ديرالزور": "Deir ez-Zor",
    "الطبقة": "Al-Tabqa",
    "الميادين": "Al-Mayadin",
    "حلب": "Aleppo",
    # English passthrough
    "Raqqa": "Raqqa",
    "Al-Hasakah": "Al-Hasakah",
    "Al-Busayrah": "Al-Busayrah",
    "Al-Suwar": "Al-Suwar",
    "Deir ez-Zor": "Deir ez-Zor",
    "Al-Tabqa": "Al-Tabqa",
    "Al-Mayadin": "Al-Mayadin",
    "Aleppo": "Aleppo",
}

# Mood / job / movement / migration scoring for EWS
MOOD_SCORE = {"Mostly calm": 1, "Worried": 2, "Fearful": 3, "Trying to leave": 4}
JOB_SCORE = {"High": 1, "Medium": 2, "Low": 3, "Very low": 4}
MOVE_SCORE = {"Unrestricted": 1, "Slightly restricted": 2, "Significantly restricted": 3, "Very restricted": 4}
MIGR_SCORE = {"None": 0, "Mostly individuals": 1, "Several families": 2}

# Arabic → English label mappings for categorical fields
MOOD_MAP = {
    "هادئ غالبًا": "Mostly calm",
    "هادئ": "Mostly calm",
    "قلق": "Worried",
    "خائف": "Fearful",
    "يحاول المغادرة": "Trying to leave",
}
JOB_MAP = {
    "مرتفع": "High",
    "متوسط": "Medium",
    "منخفض": "Low",
    "منخفض جدًا": "Very low",
    "منخفض جداً": "Very low",
}
MOVE_MAP = {
    "غير مقيد": "Unrestricted",
    "مقيد قليلاً": "Slightly restricted",
    "مقيد بشكل كبير": "Significantly restricted",
    "مقيد جداً": "Very restricted",
    "مقيد جدًا": "Very restricted",
}
MIGR_MAP = {
    "لا شيء": "None",
    "أفراد في الغالب": "Mostly individuals",
    "عدة عائلات": "Several families",
}

# Price validation: if flour < this value, likely wrong currency
MIN_FLOUR_SYP = 500


# ==============================================================
# HELPERS
# ==============================================================

def clean_price(raw):
    """Parse a price string, handling Arabic numerals, currency text, commas."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Arabic numeral conversion
    arabic_digits = "٠١٢٣٤٥٦٧٨٩"
    for i, ad in enumerate(arabic_digits):
        s = s.replace(ad, str(i))
    # Remove currency text
    for currency_text in ["ل.س", "ليرة", "سورية", "SYP", "syp", "$", "USD", "TRY", "TL"]:
        s = s.replace(currency_text, "")
    # Remove commas, spaces
    s = s.replace(",", "").replace(" ", "")
    # Try to extract number
    match = re.search(r"[\d.]+", s)
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def normalize_city(raw_city):
    """Normalize city name from Arabic or mixed input to English standard."""
    if not raw_city:
        return None, raw_city
    raw = raw_city.strip()
    # Direct match
    if raw in CITY_NORMALIZE:
        return CITY_NORMALIZE[raw], raw
    # Partial match (city name might be embedded in longer text)
    for ar_name, en_name in CITY_NORMALIZE.items():
        if ar_name in raw:
            return en_name, raw
    # Already English?
    for en_name in CITY_COORDS:
        if en_name.lower() in raw.lower():
            return en_name, raw
    return raw, raw  # Return as-is if unknown


def normalize_categorical(raw, mapping):
    """Map Arabic categorical value to English, or pass through English values."""
    if not raw:
        return raw
    s = raw.strip()
    if s in mapping:
        return mapping[s]
    # Already in English?
    if s in mapping.values():
        return s
    return s


def calculate_tot(flour_price, daily_wage):
    """Terms of Trade = daily_wage / flour_price."""
    if flour_price and daily_wage and flour_price > 0:
        return round(daily_wage / flour_price, 2)
    return None


def calculate_food_basket(prices):
    """Sum of 5 staple items: flour, rice, oil, eggs, water."""
    items = ["flour_1kg", "rice_1kg", "cooking_oil_1l", "eggs_10pcs", "water_1_5l"]
    total = 0
    count = 0
    for item in items:
        p = prices.get(item, {})
        if isinstance(p, dict) and p.get("price"):
            total += p["price"]
            count += 1
    return total if count >= 3 else None  # Need at least 3 of 5 items


def calculate_ews(mood, job, movement, migration, tot):
    """
    Early Warning Score (0-100, higher = worse).
    Components: mood 25%, job scarcity 20%, movement 20%, migration 15%, purchasing power 20%.
    Uses WFP-aligned thresholds for purchasing power instead of linear scale.
    """
    mood_val = MOOD_SCORE.get(mood, 0) / 4
    job_val = JOB_SCORE.get(job, 0) / 4
    move_val = MOVE_SCORE.get(movement, 0) / 4
    migr_val = MIGR_SCORE.get(migration, 0) / 2

    # Purchasing power from ToT using WFP thresholds
    if tot is None:
        pp_val = 0.5  # Unknown = assume moderate
    elif tot < 3:
        pp_val = 1.0   # Emergency
    elif tot < 5:
        pp_val = 0.75  # Crisis
    elif tot < 8:
        pp_val = 0.40  # Stressed
    elif tot < 12:
        pp_val = 0.15  # Acceptable
    else:
        pp_val = 0.0   # Good

    score = round(
        mood_val * 25 +
        job_val * 20 +
        move_val * 20 +
        migr_val * 15 +
        pp_val * 20
    )
    return max(0, min(100, score))


def detect_currency_issue(prices):
    """
    Flag entries where prices are suspiciously low for SYP.
    Returns 'likely_usd' or 'likely_try' or None.
    """
    flour = prices.get("flour_1kg", {})
    if isinstance(flour, dict):
        flour_price = flour.get("price")
    else:
        flour_price = None

    if flour_price is not None and flour_price < MIN_FLOUR_SYP and flour_price > 0:
        if flour_price < 50:
            return "likely_usd"
        elif flour_price < 300:
            return "likely_try"
    return None


# ==============================================================
# KOBOTOOLBOX API
# ==============================================================

def get_kobo_headers():
    """Build auth headers for KoboToolbox API."""
    if not KOBO_TOKEN:
        print("ERROR: KOBO_TOKEN environment variable not set.")
        print("  Get your token from eu.kobotoolbox.org → Account Settings → Security")
        sys.exit(1)
    return {"Authorization": f"Token {KOBO_TOKEN}"}


def fetch_submissions():
    """
    Fetch all submissions from the KoboToolbox form.
    Handles pagination automatically.
    """
    if not KOBO_ASSET_ID:
        print("ERROR: KOBO_ASSET_ID environment variable not set.")
        print("  Find your asset UID in KoboToolbox form URL or via API:")
        print(f"  curl -H 'Authorization: Token $KOBO_TOKEN' {KOBO_SERVER}/api/v2/assets/")
        sys.exit(1)

    url = f"{KOBO_SERVER}/api/v2/assets/{KOBO_ASSET_ID}/data/"
    headers = get_kobo_headers()
    all_results = []

    params = {"format": "json", "limit": 100}
    while url:
        print(f"  Fetching: {url}")
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        all_results.extend(results)
        url = data.get("next")
        params = {}  # Next URL already has params

    print(f"  → {len(all_results)} total submissions fetched")
    return all_results


def get_form_fields():
    """Fetch form field definitions to understand the question mapping."""
    url = f"{KOBO_SERVER}/api/v2/assets/{KOBO_ASSET_ID}/"
    headers = get_kobo_headers()
    resp = requests.get(url, headers=headers, params={"format": "json"}, timeout=30)
    resp.raise_for_status()
    return resp.json().get("content", {}).get("survey", [])


# ==============================================================
# FIELD MAPPING
# ==============================================================
#
# KoboToolbox XLSForm field names → our JSON structure.
# These must match YOUR actual KoboToolbox form field names.
# Run with --show-fields to see what fields your form has.
#
# Typical CSIORS field names (adjust if your form uses different names):

FIELD_MAP = {
    # Metadata — v2 group names at front
    "timestamp": ["_submission_time", "start"],
    "city":    ["group_location/city",    "city",    "location/city",    "المدينة"],
    "country": ["group_location/country", "country", "location/country", "البلد"],
    "language": ["_language_", "language"],
    "market":  ["group_location/market_type", "market_type", "نوع_السوق", "group_market/market_type"],

    # Prices — v2 uses flour_price/rice_price/etc (not flour_1kg)
    "flour_1kg_price": ["group_prices/flour_price",    "flour_price",    "prices/flour_1kg",       "سعر_الطحين",  "group_prices/flour_1kg"],
    "flour_1kg_avail": ["group_prices/flour_avail",    "flour_availability", "prices/flour_avail", "توفر_الطحين"],
    "rice_1kg_price":  ["group_prices/rice_price",     "rice_price",     "prices/rice_1kg",        "سعر_الأرز",   "group_prices/rice_1kg"],
    "rice_1kg_avail":  ["group_prices/rice_avail",     "rice_availability",  "prices/rice_avail"],
    "oil_1l_price":    ["group_prices/oil_price",      "oil_price",      "prices/cooking_oil_1l",  "سعر_الزيت",   "group_prices/cooking_oil_1l"],
    "oil_1l_avail":    ["group_prices/oil_avail",      "oil_availability",   "prices/oil_avail"],
    "eggs_10_price":   ["group_prices/eggs_price",     "eggs_price",     "prices/eggs_10pcs",      "سعر_البيض",   "group_prices/eggs_10pcs"],
    "eggs_10_avail":   ["group_prices/eggs_avail",     "eggs_availability",  "prices/eggs_avail"],
    "water_price":     ["group_prices/water_price",    "water_price",    "prices/water_1_5l",      "سعر_الماء",   "group_prices/water_1_5l"],
    "water_avail":     ["group_prices/water_avail",    "water_availability", "prices/water_avail"],
    "gasoline_price":  ["group_prices/gasoline_price", "gasoline_price", "prices/gasoline_1l",     "سعر_البنزين"],
    "diesel_price":    ["group_prices/diesel_price",   "diesel_price",   "prices/diesel_1l",       "سعر_الديزل"],
    "lpg_price":       ["group_prices/lpg_price",      "lpg_price",      "prices/lpg_12_5kg",      "سعر_الغاز"],
    "electricity":     ["group_prices/electricity_monthly", "electricity_monthly", "prices/electricity"],
    "price_change_reason": ["group_prices/price_change_reason", "price_change_reason", "notes/price_reason"],

    # Employment — v2 uses wage_unskilled (not wage_unskilled_daily)
    "wage_unskilled":  ["group_employment/wage_unskilled",    "wage_unskilled",    "employment/wage_unskilled_daily", "أجرة_عامل"],
    "wage_skilled":    ["group_employment/wage_skilled",      "wage_skilled",      "employment/wage_skilled_daily",   "أجرة_حرفي"],
    "rent":            ["group_employment/rent_monthly",      "rent_monthly",      "employment/rent_2room",            "الإيجار"],
    "job_availability":["group_employment/job_availability",  "job_availability",  "employment/job_avail",            "توفر_العمل"],
    "work_problems":   ["group_employment/work_problems",     "work_problems",     "employment/problems",             "مشاكل_العمل"],
    "labor_note":      ["group_employment/labor_note",        "labor_market_note", "employment/note"],

    # Security — v2 uses freedom_movement (not freedom_of_movement)
    "security_incident":["group_security/security_incident", "most_common_incident", "security/incident",     "الحوادث"],
    "freedom_movement": ["group_security/freedom_movement",  "freedom_of_movement",  "security/movement",     "حرية_التنقل"],
    "closed_roads":     ["group_security/closed_roads",      "closed_roads_30d",     "security/closed_roads", "طرق_مغلقة"],
    "public_mood":      ["group_security/public_mood",       "public_mood",          "security/mood",         "المزاج_العام"],
    "security_problem": ["group_security/security_problem",  "biggest_security_problem", "security/biggest_problem"],

    # Migration — v2 uses observed_departures directly in group
    "departures":      ["group_migration/observed_departures", "observed_departures", "migration/departures", "المغادرات"],
    "departure_reason":["group_migration/departure_reason",    "departure_reason",    "migration/reason",     "سبب_المغادرة"],
    "migration_dest":  ["group_migration/migration_destination","migration_destination","migration/destination"],

    # Notes & respondent — v2 group prefixes
    "field_observation":  ["group_notes/field_observation",      "field_observation",  "notes/observation",  "ملاحظات"],
    "respondent_initials":["group_respondent/respondent_initials","respondent_initials","initials",           "الأحرف_الأولى"],
    "respondent_email":   ["group_respondent/respondent_email",  "respondent_email",   "email",              "البريد"],
    "currency":           ["group_respondent/currency",           "currency",           "العملة"],
}


def extract_field(submission, field_aliases):
    """Try multiple field name aliases to find the value in a submission."""
    for alias in field_aliases:
        # Try direct match
        if alias in submission:
            return submission[alias]
        # Try nested (group/field → check flattened kobo format)
        if "/" in alias:
            parts = alias.split("/")
            obj = submission
            for part in parts:
                if isinstance(obj, dict) and part in obj:
                    obj = obj[part]
                else:
                    obj = None
                    break
            if obj is not None:
                return obj
    return None


# ==============================================================
# TRANSFORM
# ==============================================================

def transform_submission(sub, idx):
    """Transform a single KoboToolbox submission into our JSON entry format."""

    # Timestamp
    timestamp_raw = extract_field(sub, FIELD_MAP["timestamp"]) or sub.get("_submission_time", "")
    try:
        dt = datetime.fromisoformat(timestamp_raw.replace("Z", "+00:00"))
        date_str = dt.strftime("%-d.%-m.%Y")
        timestamp_str = dt.strftime("%-d.%-m.%Y %H:%M:%S")
    except (ValueError, AttributeError):
        date_str = timestamp_raw
        timestamp_str = timestamp_raw

    # City
    city_raw = extract_field(sub, FIELD_MAP["city"]) or ""
    city_normalized, city_ar = normalize_city(city_raw)

    # Country — use COUNTRY_NORMALIZE for v2 choice values
    country_raw = extract_field(sub, FIELD_MAP["country"]) or ""
    country_key = country_raw.strip().lower()
    country_normalized = (
        COUNTRY_NORMALIZE.get(country_key) or
        COUNTRY_NORMALIZE.get(country_raw.strip()) or
        ("Syria" if not country_raw or "syria" in country_key or "سوريا" in country_raw else country_raw)
    )
    is_syria = country_normalized == "Syria"

    # Coordinates
    coords = CITY_COORDS.get(city_normalized, {"lat": None, "lon": None})

    # Also check KoboToolbox GPS field
    gps = sub.get("_geolocation", [None, None])
    if gps and gps[0] and gps[1]:
        coords = {"lat": float(gps[0]), "lon": float(gps[1])}

    # Language
    language = extract_field(sub, FIELD_MAP["language"]) or "ar"

    # Prices
    def price_obj(price_key, avail_key=None):
        raw = extract_field(sub, FIELD_MAP.get(price_key, []))
        price = clean_price(raw)
        result = {"price": price, "price_raw": str(raw) if raw else ""}
        if avail_key:
            avail = extract_field(sub, FIELD_MAP.get(avail_key, []))
            result["availability"] = avail or "Unknown"
        return result

    prices = {
        "flour_1kg": price_obj("flour_1kg_price", "flour_1kg_avail"),
        "rice_1kg": price_obj("rice_1kg_price", "rice_1kg_avail"),
        "cooking_oil_1l": price_obj("oil_1l_price", "oil_1l_avail"),
        "eggs_10pcs": price_obj("eggs_10_price", "eggs_10_avail"),
        "water_1_5l": price_obj("water_price", "water_avail"),
        "gasoline_1l": price_obj("gasoline_price"),
        "diesel_1l": price_obj("diesel_price"),
        "lpg_12_5kg": price_obj("lpg_price"),
        "electricity_monthly": extract_field(sub, FIELD_MAP.get("electricity", [])) or "",
    }

    # Currency — use explicit v2 field first, fall back to heuristic
    currency_raw = extract_field(sub, FIELD_MAP.get("currency", [])) or ""
    currency_code = CURRENCY_CODES.get(currency_raw.strip().lower(), "") if currency_raw else ""
    if currency_code and currency_code != "SYP":
        # Explicit non-SYP currency from v2 form — flag for exclusion from SYP averages
        currency_flag = currency_raw.strip().lower()
    else:
        # Fall back to heuristic price-based detection
        currency_flag = detect_currency_issue(prices)

    # Employment
    wage_raw = extract_field(sub, FIELD_MAP["wage_unskilled"])
    wage_unskilled = clean_price(wage_raw)
    wage_skilled_raw = extract_field(sub, FIELD_MAP["wage_skilled"])
    wage_skilled = clean_price(wage_skilled_raw)
    rent_raw = extract_field(sub, FIELD_MAP["rent"])
    rent = clean_price(rent_raw)

    job_raw = extract_field(sub, FIELD_MAP["job_availability"]) or ""
    job_avail = normalize_categorical(job_raw, JOB_MAP)

    # Security
    mood_raw = extract_field(sub, FIELD_MAP["public_mood"]) or ""
    mood = normalize_categorical(mood_raw, MOOD_MAP)

    movement_raw = extract_field(sub, FIELD_MAP["freedom_movement"]) or ""
    movement = normalize_categorical(movement_raw, MOVE_MAP)

    # Migration
    departures_raw = extract_field(sub, FIELD_MAP["departures"]) or ""
    departures = normalize_categorical(departures_raw, MIGR_MAP)

    # Calculations
    flour_price = prices["flour_1kg"].get("price")
    tot = calculate_tot(flour_price, wage_unskilled)
    basket = calculate_food_basket(prices)
    ews = calculate_ews(mood, job_avail, movement, departures, tot)

    entry = {
        "id": idx,
        "kobo_id": sub.get("_id"),
        "timestamp": timestamp_str,
        "date": date_str,
        "language": language,
        "city": city_raw,
        "city_normalized": city_normalized,
        "city_ar": city_ar,
        "country": country_raw,
        "country_normalized": country_normalized,
        "is_syria": is_syria,
        "coordinates": coords,
        "market": extract_field(sub, FIELD_MAP.get("market", [])) or "",
        "respondent_initials": extract_field(sub, FIELD_MAP.get("respondent_initials", [])) or "",
        "currency": currency_code or extract_field(sub, FIELD_MAP.get("currency", [])) or "SYP",
        "currency_flag": currency_flag,
        "prices": prices,
        "price_change_reason": extract_field(sub, FIELD_MAP.get("price_change_reason", [])) or "",
        "employment": {
            "wage_unskilled_daily": wage_unskilled,
            "wage_unskilled_raw": str(wage_raw) if wage_raw else "",
            "wage_skilled_daily": wage_skilled,
            "wage_skilled_raw": str(wage_skilled_raw) if wage_skilled_raw else "",
            "rent_2room_monthly": rent,
            "rent_raw": str(rent_raw) if rent_raw else "",
            "job_availability": job_avail,
            "work_problems": extract_field(sub, FIELD_MAP.get("work_problems", [])) or "",
            "labor_market_note": extract_field(sub, FIELD_MAP.get("labor_note", [])) or "",
        },
        "security": {
            "most_common_incident": extract_field(sub, FIELD_MAP.get("security_incident", [])) or "",
            "freedom_of_movement": movement,
            "closed_roads_30d": extract_field(sub, FIELD_MAP.get("closed_roads", [])) or "",
            "public_mood": mood,
            "biggest_security_problem": extract_field(sub, FIELD_MAP.get("security_problem", [])) or "",
        },
        "migration": {
            "observed_departures": departures,
            "departure_reason": extract_field(sub, FIELD_MAP.get("departure_reason", [])) or "",
            "migration_destination": extract_field(sub, FIELD_MAP.get("migration_dest", [])) or "",
        },
        "field_observation": extract_field(sub, FIELD_MAP.get("field_observation", [])) or "",
        "respondent_email": extract_field(sub, FIELD_MAP.get("respondent_email", [])) or "",
        "calculated": {
            "tot_index": tot,
            "food_basket_total": basket,
            "ews_score": ews,
        },
    }
    return entry


# ==============================================================
# MERGE WITH EXISTING DATA
# ==============================================================

def load_existing_data(path):
    """Load existing JSON data to merge with new submissions."""
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"metadata": {}, "entries": []}


def merge_data(existing, new_entries):
    """
    Merge new KoboToolbox entries with existing (CSV-sourced) data.
    Uses kobo_id to deduplicate. Entries without kobo_id (from CSV) are kept.
    """
    # Keep all non-Kobo entries (from original CSV import)
    csv_entries = [e for e in existing.get("entries", []) if not e.get("kobo_id")]

    # Deduplicate Kobo entries by kobo_id
    kobo_by_id = {}
    # Existing Kobo entries
    for e in existing.get("entries", []):
        if e.get("kobo_id"):
            kobo_by_id[e["kobo_id"]] = e
    # New entries override existing
    for e in new_entries:
        if e.get("kobo_id"):
            kobo_by_id[e["kobo_id"]] = e

    # Combine and re-number
    all_entries = csv_entries + list(kobo_by_id.values())

    # Sort by date
    def sort_key(e):
        try:
            parts = e.get("date", "").split(".")
            if len(parts) == 3:
                return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
        except:
            pass
        return e.get("date", "")

    all_entries.sort(key=sort_key)

    # Re-number IDs
    for i, entry in enumerate(all_entries, 1):
        entry["id"] = i

    syria_count = sum(1 for e in all_entries if e.get("is_syria"))

    return {
        "metadata": {
            "source": "kobotoolbox + data_csiors_jan.csv",
            "exported": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "total_entries": len(all_entries),
            "syria_entries": syria_count,
            "kobo_entries": len(kobo_by_id),
            "csv_entries": len(csv_entries),
            "last_sync": datetime.now(timezone.utc).isoformat(),
            "notes": "Auto-synced from KoboToolbox API. CSV baseline data preserved. Deduplication by kobo_id.",
        },
        "entries": all_entries,
    }


# ==============================================================
# GIT OPERATIONS
# ==============================================================

def git_commit_and_push(filepath):
    """Commit updated JSON and push to trigger Vercel redeploy."""
    try:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        subprocess.run(["git", "add", str(filepath)], check=True)

        # Check if there are actual changes
        result = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
        if result.returncode == 0:
            print("  No changes to commit — data is already up to date.")
            return False

        subprocess.run(
            ["git", "commit", "-m", f"data: sync KoboToolbox submissions ({now})"],
            check=True,
        )
        subprocess.run(["git", "push"], check=True)
        print("  ✓ Committed and pushed — Vercel will auto-redeploy.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ERROR: Git operation failed: {e}")
        return False


# ==============================================================
# MAIN
# ==============================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sync KoboToolbox → CSIORS Dashboard")
    parser.add_argument("--commit", action="store_true", help="Git commit & push after sync")
    parser.add_argument("--dry-run", action="store_true", help="Fetch & transform but don't save")
    parser.add_argument("--show-fields", action="store_true", help="Print form field names and exit")
    parser.add_argument("--output", type=str, default=str(OUTPUT_PATH), help="Output JSON path")
    args = parser.parse_args()

    print("CSIORS Watchtower — KoboToolbox Sync")
    print("=" * 45)

    if args.show_fields:
        print("\nFetching form field definitions...")
        fields = get_form_fields()
        print(f"\n{len(fields)} fields found:\n")
        for f in fields:
            ftype = f.get("type", "")
            fname = f.get("$autoname", f.get("name", ""))
            flabel = ""
            label = f.get("label", [])
            if isinstance(label, list) and label:
                flabel = label[0]
            elif isinstance(label, str):
                flabel = label
            print(f"  {ftype:20s} {fname:40s} {flabel}")
        return

    # Fetch submissions
    print("\n1. Fetching submissions from KoboToolbox...")
    submissions = fetch_submissions()

    if not submissions:
        print("   No submissions found. Make sure the form has been deployed and has responses.")
        return

    # Transform
    print("\n2. Transforming submissions...")
    new_entries = []
    errors = []
    for i, sub in enumerate(submissions, 1):
        try:
            entry = transform_submission(sub, i)
            new_entries.append(entry)
            city = entry.get("city_normalized", "?")
            flag = f" ⚠ {entry['currency_flag']}" if entry.get("currency_flag") else ""
            print(f"   [{i}] {entry['date']} — {city} (ToT: {entry['calculated']['tot_index'] or 'N/A'}){flag}")
        except Exception as e:
            errors.append((i, str(e)))
            print(f"   [{i}] ERROR: {e}")

    syria = [e for e in new_entries if e.get("is_syria")]
    print(f"\n   → {len(new_entries)} entries transformed ({len(syria)} Syria)")
    if errors:
        print(f"   → {len(errors)} errors")

    # Merge with existing
    output = Path(args.output)
    print(f"\n3. Merging with existing data at {output}...")
    existing = load_existing_data(output)
    merged = merge_data(existing, new_entries)
    print(f"   → {merged['metadata']['total_entries']} total entries "
          f"({merged['metadata'].get('csv_entries', 0)} CSV + {merged['metadata'].get('kobo_entries', 0)} Kobo)")

    if args.dry_run:
        print("\n[DRY RUN] Would save to:", output)
        print(json.dumps(merged["metadata"], indent=2))
        return

    # Save
    print(f"\n4. Saving to {output}...")
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    print(f"   → {output.stat().st_size / 1024:.1f} KB written")

    # Git
    if args.commit:
        print("\n5. Committing to git...")
        git_commit_and_push(output)

    print("\n✓ Sync complete!")


if __name__ == "__main__":
    main()
