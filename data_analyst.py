#!/usr/bin/env python3
"""
CSIORS Watchtower — AI Data Analyst Agent

Layer 1: Rule-based data quality checks + anomaly detection (free, no API)
Layer 2: Claude API situation brief generation (~$2/month)

Runs after kobo_sync.py in the GitHub Action pipeline.
Outputs:
  - public/data/analysis.json   (machine-readable, consumed by dashboard)
  - public/data/brief.md        (human-readable situation brief)

Usage:
    # Layer 1 only (no API key needed)
    python data_analyst.py

    # Layer 1 + Layer 2 (needs ANTHROPIC_API_KEY)
    python data_analyst.py --with-brief

    # Dry run (print analysis, don't save)
    python data_analyst.py --dry-run

Environment variables:
    ANTHROPIC_API_KEY  - Claude API key (only for --with-brief)
"""

import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

# ==============================================================
# CONFIG
# ==============================================================

DATA_PATH = Path("public/data/syria_field_data.json")
ANALYSIS_OUTPUT = Path("public/data/analysis.json")
BRIEF_OUTPUT = Path("public/data/brief.md")

# WFP Thresholds
TOT_EMERGENCY = 3
TOT_CRISIS = 5
TOT_STRESSED = 8
TOT_ACCEPTABLE = 12

# Validation thresholds
MIN_FLOUR_SYP = 500       # Below this → likely wrong currency
MAX_FLOUR_SYP = 50000     # Above this → likely data entry error
MIN_WAGE_SYP = 5000       # Below this → suspicious
MAX_WAGE_SYP = 500000     # Above this → suspicious
MAX_TOT = 50              # Above this → almost certainly data error
MIN_BASKET_SYP = 10000    # Below this → likely wrong currency

# Scoring
MOOD_SCORE = {"Mostly calm": 1, "Worried": 2, "Fearful": 3, "Trying to leave": 4}
JOB_SCORE = {"High": 1, "Medium": 2, "Low": 3, "Very low": 4}
MOVE_SCORE = {"Unrestricted": 1, "Slightly restricted": 2, "Significantly restricted": 3, "Very restricted": 4}
MIGR_SCORE = {"None": 0, "Mostly individuals": 1, "Several families": 2}

# City → country mapping (mirrors src/data.js COUNTRY_FOR_CITY)
COUNTRY_FOR_CITY_PY = {
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
}


# ==============================================================
# LAYER 1 — RULE-BASED ANALYSIS
# ==============================================================

def load_data():
    """Load the field data JSON."""
    if not DATA_PATH.exists():
        print(f"ERROR: {DATA_PATH} not found")
        sys.exit(1)
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, list):
        return [_normalize(r) for r in raw], {}
    entries = raw.get("entries", [])
    return [_normalize(r) for r in entries], raw.get("metadata", {})


def _normalize(r):
    """Map flat JSON schema to the nested schema expected by the analyst."""
    out = dict(r)
    # city
    out.setdefault("city_normalized", r.get("city", ""))
    # employment sub-object
    if "employment" not in out:
        out["employment"] = {
            "wage_unskilled_daily": r.get("wage_unskilled"),
            "wage_skilled_daily":   r.get("wage_skilled"),
            "job_availability":     r.get("job_availability"),
        }
    # calculated sub-object
    if "calculated" not in out:
        flour  = r.get("flour")
        wage   = r.get("wage_unskilled")
        tot    = r.get("tot_flour_kg")
        basket = r.get("food_basket")
        out["calculated"] = {
            "food_basket_total": basket,
            "tot_flour_kg":      tot,
            "tot_index":         tot,
        }
    # prices sub-object (validate_entries reads e["prices"]["flour_1kg"]["price"])
    if "prices" not in out:
        out["prices"] = {
            "flour_1kg": {"price": r.get("flour")},
            "rice_1kg":  {"price": r.get("rice")},
            "oil_1l":    {"price": r.get("oil")},
            "eggs_30":   {"price": r.get("eggs")},
            "water_1_5l":{"price": r.get("water")},
        }
    # security sub-object (validate reads e["security"]["public_mood"])
    if "security" not in out:
        out["security"] = {"public_mood": r.get("mood", "")}
    # flatten mood string (script checks e.get("mood") directly in some places)
    # flatten migration: script expects e["migration"].get("observed_departures")
    migr_val = r.get("migration", "")
    if isinstance(migr_val, str):
        out["migration"] = {"observed_departures": migr_val}
    # flatten movement similarly
    move_val = r.get("movement", "")
    if isinstance(move_val, str):
        out["movement_restriction"] = move_val  # keep original key too
    # country derivation (flat JSON has no country; derive from city or explicit field)
    if "country_normalized" not in out:
        city_name = r.get("city", "")
        out["country_normalized"] = COUNTRY_FOR_CITY_PY.get(city_name, "Syria")
    # currency / validity flag
    flour = r.get("flour")
    explicit_currency = (r.get("currency") or "").lower()
    if explicit_currency and explicit_currency not in ("syp", "ل.س", ""):
        # Explicit non-SYP currency from v2 form
        out.setdefault("currency_flag", explicit_currency)
    else:
        out.setdefault("currency_flag", "likely_usd" if flour and flour < 500 else None)
    out.setdefault("valid_prices",  not bool(out["currency_flag"]))
    return out


def parse_date(date_str):
    """Parse D.M.YYYY to datetime."""
    try:
        parts = date_str.split(" ")[0].split(".")
        if len(parts) == 3:
            return datetime(int(parts[2]), int(parts[1]), int(parts[0]))
    except (ValueError, IndexError):
        pass
    return None


def get_entries(entries, country=None):
    """
    Filter entries: exclude suspect quality, optionally filter by country.
    country=None returns all valid entries (multi-country).
    """
    result = [e for e in entries if e.get("quality", "") != "suspect"]
    if country:
        result = [e for e in result if e.get("country_normalized", "Syria") == country]
    return result


# Backward-compatible alias
def get_syria_entries(entries):
    return get_entries(entries, country="Syria")


def validate_entries(entries):
    """
    Layer 1 core: validate each entry, return issues list.
    Each issue: {entry_id, city, date, severity, category, message}
    """
    issues = []

    for e in entries:
        eid = e.get("id", "?")
        city = e.get("city_normalized", "?")
        date = e.get("date", "?")
        base = {"entry_id": eid, "city": city, "date": date}

        # --- Currency mismatch ---
        flour_price = None
        prices = e.get("prices", {})
        flour = prices.get("flour_1kg", {})
        if isinstance(flour, dict):
            flour_price = flour.get("price")

        # Only apply SYP-specific thresholds when no explicit non-SYP currency
        explicit_currency = (e.get("currency") or "").lower()
        is_syp = not explicit_currency or explicit_currency in ("syp", "ل.س")

        if is_syp and flour_price and 0 < flour_price < MIN_FLOUR_SYP:
            issues.append({**base,
                "severity": "high",
                "category": "currency",
                "message": f"Flour price {flour_price} is too low for SYP — likely USD or TRY. Excluded from averages.",
                "auto_action": "excluded_from_averages"
            })
        elif is_syp and flour_price and flour_price > MAX_FLOUR_SYP:
            issues.append({**base,
                "severity": "medium",
                "category": "data_entry",
                "message": f"Flour price {flour_price} SYP seems unusually high. Verify with field researcher.",
            })

        # --- Wage validation ---
        wage = e.get("employment", {}).get("wage_unskilled_daily")
        if is_syp and wage and wage < MIN_WAGE_SYP:
            issues.append({**base,
                "severity": "medium",
                "category": "currency",
                "message": f"Daily wage {wage} too low for SYP — possible currency mismatch.",
            })
        elif is_syp and wage and wage > MAX_WAGE_SYP:
            issues.append({**base,
                "severity": "low",
                "category": "data_entry",
                "message": f"Daily wage {wage} SYP seems unusually high. Verify.",
            })

        # --- ToT sanity ---
        tot = e.get("calculated", {}).get("tot_index")
        if tot and tot > MAX_TOT:
            issues.append({**base,
                "severity": "medium",
                "category": "outlier",
                "message": f"ToT index {tot} is extremely high — check if flour price or wage is misreported.",
            })

        # --- Missing critical fields ---
        if not flour_price:
            issues.append({**base,
                "severity": "low",
                "category": "completeness",
                "message": "Missing flour price — cannot calculate ToT.",
            })
        if not wage:
            issues.append({**base,
                "severity": "low",
                "category": "completeness",
                "message": "Missing daily unskilled wage — cannot calculate ToT.",
            })

        mood = e.get("security", {}).get("public_mood", "")
        if not mood or mood not in MOOD_SCORE:
            issues.append({**base,
                "severity": "low",
                "category": "completeness",
                "message": f"Missing or unrecognized public mood: '{mood}'",
            })

        # --- Basket validation ---
        basket = e.get("calculated", {}).get("food_basket_total")
        if basket and 0 < basket < MIN_BASKET_SYP:
            issues.append({**base,
                "severity": "medium",
                "category": "currency",
                "message": f"Food basket {basket} too low for SYP — possible currency issue.",
            })

    return issues


def detect_anomalies(entries):
    """
    Detect significant changes between observation periods.
    Returns list of anomaly alerts.
    """
    anomalies = []

    # Group by city and sort by date
    by_city = defaultdict(list)
    for e in entries:
        city = e.get("city_normalized", "")
        if city:
            by_city[city].append(e)

    for city, city_entries in by_city.items():
        # Sort by date
        city_entries.sort(key=lambda x: parse_date(x.get("date", "")) or datetime.min)

        if len(city_entries) < 2:
            continue

        # Compare consecutive entries
        for i in range(1, len(city_entries)):
            prev = city_entries[i - 1]
            curr = city_entries[i]
            prev_date = prev.get("date", "?")
            curr_date = curr.get("date", "?")

            # ToT change
            prev_tot = prev.get("calculated", {}).get("tot_index")
            curr_tot = curr.get("calculated", {}).get("tot_index")
            if prev_tot and curr_tot and prev_tot > 0:
                pct_change = (curr_tot - prev_tot) / prev_tot * 100
                if abs(pct_change) > 50:
                    direction = "improved" if pct_change > 0 else "deteriorated"
                    anomalies.append({
                        "city": city,
                        "type": "tot_shift",
                        "severity": "high" if pct_change < -50 else "medium",
                        "message": f"{city} ToT {direction} by {abs(pct_change):.0f}% ({prev_tot:.1f} → {curr_tot:.1f}) between {prev_date} and {curr_date}.",
                    })

            # Mood shift
            prev_mood = MOOD_SCORE.get(prev.get("security", {}).get("public_mood", ""), 0)
            curr_mood = MOOD_SCORE.get(curr.get("security", {}).get("public_mood", ""), 0)
            if curr_mood > prev_mood and curr_mood >= 3:
                anomalies.append({
                    "city": city,
                    "type": "mood_shift",
                    "severity": "high",
                    "message": f"{city} public mood worsened to '{curr.get('security', {}).get('public_mood', '?')}' (from '{prev.get('security', {}).get('public_mood', '?')}') on {curr_date}.",
                })

            # Migration escalation
            prev_migr = MIGR_SCORE.get(prev.get("migration", {}).get("observed_departures", ""), 0)
            curr_migr = MIGR_SCORE.get(curr.get("migration", {}).get("observed_departures", ""), 0)
            if curr_migr > prev_migr and curr_migr >= 2:
                anomalies.append({
                    "city": city,
                    "type": "migration_escalation",
                    "severity": "high",
                    "message": f"{city} migration escalated to family-level departures on {curr_date} — was '{prev.get('migration', {}).get('observed_departures', 'N/A')}' previously.",
                })

            # Flour price spike (>30% increase)
            prev_flour = prev.get("prices", {}).get("flour_1kg", {})
            curr_flour = curr.get("prices", {}).get("flour_1kg", {})
            if isinstance(prev_flour, dict) and isinstance(curr_flour, dict):
                pf = prev_flour.get("price")
                cf = curr_flour.get("price")
                if pf and cf and pf > MIN_FLOUR_SYP and cf > MIN_FLOUR_SYP:
                    change = (cf - pf) / pf * 100
                    if change > 30:
                        anomalies.append({
                            "city": city,
                            "type": "price_spike",
                            "severity": "high" if change > 50 else "medium",
                            "message": f"{city} flour price spiked {change:.0f}% ({pf:.0f} → {cf:.0f} SYP) between {prev_date} and {curr_date}.",
                        })

    return anomalies


def compute_summary_stats(entries, country=None):
    """Compute aggregate statistics for the situation brief."""
    syria = get_entries(entries, country)
    valid = [e for e in syria if not e.get("currency_flag")]

    # ToT stats
    tots = [e["calculated"]["tot_index"] for e in valid
            if e.get("calculated", {}).get("tot_index") is not None]
    avg_tot = sum(tots) / len(tots) if tots else None
    min_tot = min(tots) if tots else None
    max_tot = max(tots) if tots else None
    crisis_count = sum(1 for t in tots if t < TOT_CRISIS)
    emergency_count = sum(1 for t in tots if t < TOT_EMERGENCY)

    # Mood stats
    moods = [MOOD_SCORE.get(e.get("security", {}).get("public_mood", ""), 0) for e in syria]
    fearful_count = sum(1 for m in moods if m >= 3)
    fearful_pct = round(fearful_count / len(syria) * 100) if syria else 0

    # Migration
    family_migr = [e for e in syria if e.get("migration", {}).get("observed_departures") == "Several families"]
    family_cities = list(set(e.get("city_normalized", "") for e in family_migr))

    # Baskets
    baskets = [e["calculated"]["food_basket_total"] for e in valid
               if e.get("calculated", {}).get("food_basket_total")]
    avg_basket = round(sum(baskets) / len(baskets)) if baskets else None

    # Wages
    wages = [e["employment"]["wage_unskilled_daily"] for e in valid
             if e.get("employment", {}).get("wage_unskilled_daily")]
    avg_wage = round(sum(wages) / len(wages)) if wages else None

    # Cities
    cities = list(set(e.get("city_normalized", "") for e in syria if e.get("city_normalized")))

    # Date range
    dates = [parse_date(e.get("date", "")) for e in syria]
    dates = [d for d in dates if d]
    date_from = min(dates).strftime("%-d %b %Y") if dates else "?"
    date_to = max(dates).strftime("%-d %b %Y") if dates else "?"

    # EWS
    if syria:
        mood_avg = sum(moods) / len(moods) if moods else 0
        job_vals = [JOB_SCORE.get(e.get("employment", {}).get("job_availability", ""), 0) for e in syria]
        job_avg = sum(job_vals) / len(job_vals) if job_vals else 0
        move_vals = [MOVE_SCORE.get(e.get("security", {}).get("freedom_of_movement", ""), 0) for e in syria]
        move_avg = sum(move_vals) / len(move_vals) if move_vals else 0
        migr_vals = [MIGR_SCORE.get(e.get("migration", {}).get("observed_departures", ""), 0) for e in syria]
        migr_avg = sum(migr_vals) / len(migr_vals) if migr_vals else 0

        if avg_tot is None:
            pp_val = 0.5
        elif avg_tot < 3:
            pp_val = 1.0
        elif avg_tot < 5:
            pp_val = 0.75
        elif avg_tot < 8:
            pp_val = 0.40
        elif avg_tot < 12:
            pp_val = 0.15
        else:
            pp_val = 0.0

        ews = round(
            (mood_avg / 4 * 25) + (job_avg / 4 * 20) +
            (move_avg / 4 * 20) + (migr_avg / 2 * 15) + (pp_val * 20)
        )
    else:
        ews = None

    if ews is None:
        ews_level = "UNKNOWN"
    elif ews < 30:
        ews_level = "STABLE"
    elif ews < 50:
        ews_level = "WATCH"
    elif ews < 70:
        ews_level = "WARNING"
    else:
        ews_level = "ALERT"

    return {
        "total_reports": len(syria),
        "valid_price_reports": len(valid),
        "cities": sorted(cities),
        "city_count": len(cities),
        "date_range": {"from": date_from, "to": date_to},
        "tot": {
            "avg": round(avg_tot, 1) if avg_tot else None,
            "min": round(min_tot, 1) if min_tot else None,
            "max": round(max_tot, 1) if max_tot else None,
            "crisis_count": crisis_count,
            "emergency_count": emergency_count,
        },
        "mood": {
            "fearful_count": fearful_count,
            "fearful_pct": fearful_pct,
        },
        "migration": {
            "family_departure_cities": family_cities,
        },
        "food_basket_avg_syp": avg_basket,
        "wage_avg_syp": avg_wage,
        "days_wage_for_basket": round(avg_basket / avg_wage, 1) if avg_basket and avg_wage else None,
        "ews_score": ews,
        "ews_level": ews_level,
    }


def city_breakdown(entries, country=None):
    """Per-city latest status for the analysis JSON."""
    syria = get_entries(entries, country)
    by_city = defaultdict(list)
    for e in syria:
        city = e.get("city_normalized", "")
        if city:
            by_city[city].append(e)

    breakdown = []
    for city, records in sorted(by_city.items()):
        records.sort(key=lambda x: parse_date(x.get("date", "")) or datetime.min)
        latest = records[-1]
        valid = not latest.get("currency_flag")

        tot = latest.get("calculated", {}).get("tot_index") if valid else None
        basket = latest.get("calculated", {}).get("food_basket_total") if valid else None

        if tot is None:
            tot_level = "N/A"
        elif tot < TOT_EMERGENCY:
            tot_level = "EMERGENCY"
        elif tot < TOT_CRISIS:
            tot_level = "CRISIS"
        elif tot < TOT_STRESSED:
            tot_level = "STRESSED"
        elif tot < TOT_ACCEPTABLE:
            tot_level = "ACCEPTABLE"
        else:
            tot_level = "GOOD"

        breakdown.append({
            "city": city,
            "latest_date": latest.get("date", ""),
            "total_reports": len(records),
            "tot_index": tot,
            "tot_level": tot_level,
            "food_basket_syp": basket,
            "mood": latest.get("security", {}).get("public_mood", ""),
            "job_availability": latest.get("employment", {}).get("job_availability", ""),
            "movement": latest.get("security", {}).get("freedom_of_movement", ""),
            "migration": latest.get("migration", {}).get("observed_departures", ""),
            "currency_flag": latest.get("currency_flag"),
        })

    # Sort worst first (by a composite score)
    def severity_key(c):
        score = 0
        score += (4 - {"GOOD": 0, "ACCEPTABLE": 1, "STRESSED": 2, "CRISIS": 3, "EMERGENCY": 4, "N/A": 2}.get(c["tot_level"], 2))
        score += MOOD_SCORE.get(c["mood"], 0)
        score += MIGR_SCORE.get(c["migration"], 0)
        return -score
    breakdown.sort(key=severity_key)

    return breakdown


# ==============================================================
# LAYER 2 — CLAUDE API SITUATION BRIEF
# ==============================================================

def generate_brief_with_claude(summary, issues, anomalies, city_data):
    """
    Use Claude API to generate a professional situation brief.
    Returns markdown string.
    """
    try:
        import anthropic
    except ImportError:
        print("  WARNING: anthropic package not installed. Run: pip install anthropic")
        print("  Falling back to rule-based brief.")
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("  WARNING: ANTHROPIC_API_KEY not set. Falling back to rule-based brief.")
        return None

    client = anthropic.Anthropic(api_key=api_key)

    # Build the analysis context
    context = f"""You are a humanitarian data analyst for CSIORS (Czech-Slovak Institute of Oriental Studies),
producing a situation brief for NE Syria food security and migration monitoring.

DATA SUMMARY:
{json.dumps(summary, indent=2)}

CITY BREAKDOWN (latest per city, sorted worst-first):
{json.dumps(city_data, indent=2)}

DATA QUALITY ISSUES ({len(issues)} found):
{json.dumps(issues[:10], indent=2)}

ANOMALIES DETECTED ({len(anomalies)} found):
{json.dumps(anomalies, indent=2)}

Write a professional situation brief in markdown format. Structure:

# CSIORS Syria Situation Brief — [date range]

## Executive Summary
2-3 sentences. EWS level, key concern, recommendation.

## Food Security
- ToT analysis by city. Which cities are in crisis/emergency?
- Food basket affordability (days of wages needed)
- Price changes and drivers if detectable

## Security & Mobility
- Public mood assessment
- Movement restrictions
- Key security concerns from field observations

## Migration
- Observed displacement patterns
- Cities with family-level departures
- Likely drivers

## Data Quality Notes
- Sample size caveats
- Currency issues
- Any entries that need field verification

## Recommendations
- 3-5 concrete, actionable recommendations

IMPORTANT RULES:
- This is TACTICAL FIELD INTELLIGENCE, not statistical research
- Always state sample sizes
- Never say "trend" with n < 30 — say "observed change" or "shift"
- Be specific: name cities, give numbers
- Frame uncertainty honestly
- Keep it under 500 words
- Date format: "4 Nov 2025" not "4.11.2025"
"""

    try:
        print("  Calling Claude API...")
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            messages=[{"role": "user", "content": context}],
        )
        return response.content[0].text
    except Exception as e:
        print(f"  WARNING: Claude API call failed: {e}")
        return None


def generate_rule_based_brief(summary, issues, anomalies, city_data, country_label=None):
    """
    Fallback: generate a structured brief without AI.
    Less eloquent but always works and costs nothing.
    """
    s = summary
    now = datetime.now(timezone.utc).strftime("%-d %b %Y")
    region = country_label or "Multi-Country"

    lines = [
        f"# CSIORS {region} Situation Brief",
        f"",
        f"**Generated:** {now} | **Period:** {s['date_range']['from']} – {s['date_range']['to']} | "
        f"**Reports:** {s['total_reports']} across {s['city_count']} locations",
        f"",
        f"## Executive Summary",
        f"",
    ]

    # EWS summary
    ews_text = f"Overall Early Warning Score: **{s['ews_score']}/100 ({s['ews_level']})**."
    lines.append(ews_text)

    if s["tot"]["avg"]:
        tot_text = f"Average Terms of Trade index: **{s['tot']['avg']}** "
        if s["tot"]["avg"] < TOT_CRISIS:
            tot_text += "(CRISIS level — below WFP threshold of 5)."
        elif s["tot"]["avg"] < TOT_STRESSED:
            tot_text += "(STRESSED — approaching crisis threshold)."
        else:
            tot_text += "(acceptable range)."
        lines.append(tot_text)

    if s["mood"]["fearful_pct"] > 0:
        lines.append(f"**{s['mood']['fearful_pct']}%** of respondents report fearful or worse mood.")

    lines.extend(["", "## Food Security", ""])

    # ToT by city
    if s["tot"]["crisis_count"] > 0:
        crisis_cities = [c["city"] for c in city_data if c["tot_level"] in ("CRISIS", "EMERGENCY")]
        lines.append(f"**{s['tot']['crisis_count']} report(s)** below WFP crisis threshold (ToT < 5): {', '.join(crisis_cities) if crisis_cities else 'various locations'}.")

    if s["days_wage_for_basket"]:
        lines.append(f"Average worker needs **{s['days_wage_for_basket']} days' wages** for a basic food basket "
                      f"({s['food_basket_avg_syp']:,} SYP, avg daily wage {s['wage_avg_syp']:,} SYP).")

    # Price anomalies
    price_anomalies = [a for a in anomalies if a["type"] == "price_spike"]
    for pa in price_anomalies:
        lines.append(f"- {pa['message']}")

    lines.extend(["", "## Security & Mobility", ""])

    mood_anomalies = [a for a in anomalies if a["type"] == "mood_shift"]
    if mood_anomalies:
        for ma in mood_anomalies:
            lines.append(f"- {ma['message']}")
    else:
        lines.append("No significant mood shifts detected between observation periods.")

    lines.extend(["", "## Migration", ""])

    if s["migration"]["family_departure_cities"]:
        lines.append(f"Family-level departures observed in: **{', '.join(s['migration']['family_departure_cities'])}**.")
    else:
        lines.append("No family-level displacement observed.")

    migr_anomalies = [a for a in anomalies if a["type"] == "migration_escalation"]
    for ma in migr_anomalies:
        lines.append(f"- ⚠ {ma['message']}")

    lines.extend(["", "## Data Quality", ""])

    high_issues = [i for i in issues if i["severity"] == "high"]
    med_issues = [i for i in issues if i["severity"] == "medium"]
    lines.append(f"- {len(high_issues)} high-severity issues, {len(med_issues)} medium, {len(issues) - len(high_issues) - len(med_issues)} low")
    lines.append(f"- {s['valid_price_reports']}/{s['total_reports']} reports with valid SYP prices")

    if s["total_reports"] < 10:
        lines.append(f"- ⚠ Small sample (n={s['total_reports']}). Interpret as field intelligence, not statistical analysis.")

    currency_issues = [i for i in issues if i["category"] == "currency"]
    if currency_issues:
        lines.append(f"- {len(currency_issues)} entries flagged for possible currency mismatch (excluded from price calculations)")

    lines.extend(["", "---", f"*CSIORS.org — Tactical Situational Awareness | Auto-generated {now}*", ""])

    return "\n".join(lines)


# ==============================================================
# MAIN
# ==============================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description="CSIORS Data Analyst Agent")
    parser.add_argument("--with-brief", action="store_true", help="Generate AI situation brief (needs ANTHROPIC_API_KEY)")
    parser.add_argument("--dry-run", action="store_true", help="Print analysis, don't save files")
    parser.add_argument("--commit", action="store_true", help="Git commit analysis files after saving")
    args = parser.parse_args()

    print("CSIORS Watchtower — Data Analyst Agent")
    print("=" * 45)

    # Load
    print("\n1. Loading data...")
    entries, metadata = load_data()
    valid_entries = get_entries(entries)
    countries_present = sorted(set(e.get("country_normalized", "Syria") for e in valid_entries))
    country_label = countries_present[0] if len(countries_present) == 1 else "Multi-Country"
    print(f"   {len(entries)} total entries, {len(valid_entries)} valid ({', '.join(countries_present)})")

    # Layer 1: Validation
    print("\n2. Running validation checks...")
    issues = validate_entries(valid_entries)
    high = sum(1 for i in issues if i["severity"] == "high")
    med = sum(1 for i in issues if i["severity"] == "medium")
    low = sum(1 for i in issues if i["severity"] == "low")
    print(f"   {len(issues)} issues found: {high} high, {med} medium, {low} low")
    for iss in issues:
        icon = "🔴" if iss["severity"] == "high" else "🟡" if iss["severity"] == "medium" else "⚪"
        print(f"   {icon} [{iss['city']}] {iss['message']}")

    # Layer 1: Anomaly detection
    print("\n3. Detecting anomalies...")
    anomalies = detect_anomalies(valid_entries)
    print(f"   {len(anomalies)} anomalies detected")
    for a in anomalies:
        icon = "🚨" if a["severity"] == "high" else "⚠️"
        print(f"   {icon} {a['message']}")

    # Summary stats
    print("\n4. Computing summary statistics...")
    summary = compute_summary_stats(entries)
    print(f"   EWS: {summary['ews_score']}/100 ({summary['ews_level']})")
    print(f"   Avg ToT: {summary['tot']['avg']}")
    print(f"   Fearful: {summary['mood']['fearful_pct']}%")

    # City breakdown
    city_data = city_breakdown(entries)
    print(f"\n5. City status (worst first):")
    for c in city_data:
        flag = " ⚠CURRENCY" if c["currency_flag"] else ""
        print(f"   {c['city']:15s} ToT={str(c['tot_index'] or 'N/A'):6s} {c['tot_level']:10s} Mood={c['mood']:15s}{flag}")

    # Build analysis JSON
    analysis = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "countries": countries_present,
        "summary": summary,
        "city_breakdown": city_data,
        "issues": issues,
        "anomalies": anomalies,
        "issue_counts": {"high": high, "medium": med, "low": low},
    }

    # Layer 2: Situation brief
    print("\n6. Generating situation brief...")
    brief = None
    if args.with_brief:
        brief = generate_brief_with_claude(summary, issues, anomalies, city_data)

    if not brief:
        brief = generate_rule_based_brief(summary, issues, anomalies, city_data, country_label=country_label)
        print("   (rule-based brief generated)")
    else:
        print("   (AI brief generated)")

    if args.dry_run:
        print("\n" + "=" * 45)
        print("DRY RUN — would save:")
        print(f"  {ANALYSIS_OUTPUT}")
        print(f"  {BRIEF_OUTPUT}")
        print("\n--- BRIEF ---")
        print(brief)
        print("\n--- ANALYSIS JSON (summary) ---")
        print(json.dumps(analysis["summary"], indent=2))
        return

    # Save
    print(f"\n7. Saving outputs...")
    ANALYSIS_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(ANALYSIS_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"   ✓ {ANALYSIS_OUTPUT} ({ANALYSIS_OUTPUT.stat().st_size / 1024:.1f} KB)")

    with open(BRIEF_OUTPUT, "w", encoding="utf-8") as f:
        f.write(brief)
    print(f"   ✓ {BRIEF_OUTPUT} ({BRIEF_OUTPUT.stat().st_size / 1024:.1f} KB)")

    # Git
    if args.commit:
        import subprocess
        try:
            subprocess.run(["git", "add", str(ANALYSIS_OUTPUT), str(BRIEF_OUTPUT)], check=True)
            result = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
            if result.returncode == 0:
                print("   No changes to commit.")
            else:
                now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
                subprocess.run(["git", "commit", "-m", f"analysis: situation brief ({now_str})"], check=True)
                subprocess.run(["git", "push"], check=True)
                print("   ✓ Committed and pushed.")
        except subprocess.CalledProcessError as e:
            print(f"   ERROR: Git failed: {e}")

    print("\n✓ Analysis complete!")


if __name__ == "__main__":
    main()
