# CSIORS Watchtower — Early Warning Platform

## What is this?

A real-time monitoring dashboard for the Czech-Slovak Institute of Oriental Studies (CSIORS.org). It visualizes field-collected data from Syria: food prices, wages, Terms of Trade index, security conditions, and early warning signals for migration pressure.

## Quick Start

### Option A: Just open the HTML file
Open `../csiors-watchtower.html` in any browser. No install needed.

### Option B: Run as a dev project
```bash
npm install
npm run dev
```

## For AI Coding Assistants (Antigravity, Cursor, Windsurf, etc.)

This project is designed to be extended by AI. Here's what to build next:

### Priority 1: Backend API
- Create a Node.js/Express or Python/FastAPI backend
- Connect to a PostgreSQL or Supabase database
- Build REST endpoints: GET /api/reports, POST /api/reports, GET /api/stats
- Add authentication (JWT) for data submission

### Priority 2: KoboToolbox Integration
- KoboToolbox webhook receiver: when a form is submitted, auto-import to our DB
- Endpoint: POST /api/webhook/kobo
- Data cleaning pipeline: normalize prices, detect outliers, flag suspect data

### Priority 3: Enhanced Dashboard
- Replace static data with API calls
- Add date range picker
- Add comparison mode (month-over-month)
- Add exportable PDF reports
- Mobile-responsive improvements
- Leaflet.js or Mapbox map with real coordinates

### Priority 4: Grok/X Monitoring
- Integrate Grok API for social media sentiment
- Daily cron job to fetch Syria-related posts
- NLP sentiment scoring
- Merge social media signals into EWS composite score

### Priority 5: User Management
- Login for field researchers (submit data)
- Admin panel for data review
- Email notification system for monthly reminders

## Data Structure

Each field report contains:
- **Prices**: flour, rice, oil, eggs, water (per standard unit, in SYP)
- **Fuel**: gasoline, diesel, LPG
- **Wages**: unskilled daily, skilled daily, monthly rent
- **Qualitative**: job availability, public mood, movement restrictions
- **Migration**: observed departures, reasons, destinations

## Terms of Trade (ToT) Index
`ToT = daily_unskilled_wage / price_flour_1kg`
- WFP benchmark: ToT < 5 = crisis, ToT < 3 = emergency

## Early Warning Score (EWS)
Composite 0-100 index:
- Public mood (25%)
- Job scarcity (20%)
- Movement restrictions (20%)
- Migration pressure (15%)
- Purchasing power deterioration (20%)

## Tech Stack
- Frontend: Vanilla JS + Chart.js (current) → React + Recharts (upgrade path)
- Backend: TBD (recommended: FastAPI or Express)
- Database: TBD (recommended: Supabase or PostgreSQL)
- Hosting: WordPress.com embed or Vercel/Netlify

## Contact
- info@csiors.org
- https://csiors.org
