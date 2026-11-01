# Wind Desk

A React and FastAPI pilot dashboard for a UK utility buying team's January 2026 day-ahead wind forecast. It compares Elexon WINDFOR forecasts with FUELHH actual wind generation.

## Run with Docker

Run docker compose up --build, then open http://localhost:8000.

## Data and method

The app selects the latest WINDFOR publication available by 10:00 Europe/London on the day before delivery. This is an explicit pilot assumption because the brief does not specify a decision cutoff. WINDFOR is hourly; each hourly forecast is compared with the two half-hour FUELHH actuals in that hour. Error is forecast minus actual, so positive bias means wind was over-forecast. MAE, RMSE, bias, and WAPE summarize accuracy. The brief provides no demand series, so the app does not calculate a complete procurement requirement.

## Included

Monthly metrics, daily forecast-versus-actual chart, daily MAE, settlement-period table, and CSV export. API routes: /api/health, /api/wind/summary?month=2026-01, /api/wind/series?date=2026-01-15, and /api/wind/export.csv.

## AI assistance

OpenAI Codex assisted with API research, implementation, and documentation.

Public source repo: https://github.com/patilkaivalya/m9q4t2vw. A hosted app and demo video are not published yet.
