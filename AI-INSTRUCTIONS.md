# Instructions for AI Coding Assistant

You are working on the CSIORS Situational Awareness Dashboard — a data platform for a humanitarian NGO that monitors food security, economic conditions, and migration in Syria.

## Context
- CSIORS = Czech-Slovak Institute of Oriental Studies (csiors.org)
- Very small team: 1 CEO/manager, 1 Africa researcher, 1 Syria field coordinator (based in Turkey)
- Budget: ~100-150 EUR/month — use open-source and free-tier services
- Current data collection: Google Forms → migrating to KoboToolbox
- Website: migrating from Flazio to WordPress.com

## Current State
- `../csiors-dashboard.html` — working standalone dashboard (open in browser)
- `data/syria_field_data.json` — processed field data (Nov 2025 - Jan 2026)
- Dashboard uses Chart.js, vanilla JS, no framework yet

## Design Requirements
- Dark theme (navy/slate palette — see CSS variables in HTML)
- Professional humanitarian sector look (think OCHA, ReliefWeb, ACLED)
- Mobile responsive
- Embeddable in WordPress (iframe or standalone page)
- Bilingual-ready (English + Arabic RTL support needed eventually)

## Technical Constraints
- Must work with minimal hosting (WordPress.com or cheap VPS)
- No heavy frameworks unless necessary — keep it deployable as static files if possible
- If adding a backend, prefer Python (FastAPI) — the team knows basic Python
- For database, prefer Supabase (free tier) or SQLite

## Key Metrics to Always Display
1. Terms of Trade Index (wage/flour price) — this is the PRIMARY indicator
2. Early Warning Score (composite 0-100)
3. Food basket cost
4. Public mood distribution
5. Migration observations

## Data Format
Field reports come monthly from 5-8 Syrian cities. Each report includes:
- 5 food item prices (flour, rice, oil, eggs, water) in SYP
- 3 fuel prices (gasoline, diesel, LPG)
- 2 wage levels (unskilled daily, skilled daily)
- Monthly rent
- Categorical: job availability (4 levels), mood (4 levels), movement (4 levels), migration (3 levels)

## What NOT to Do
- Don't use expensive APIs or services
- Don't require complex DevOps (Docker is fine, Kubernetes is overkill)
- Don't build user registration — researchers submit via KoboToolbox
- Don't store PII in the dashboard database
