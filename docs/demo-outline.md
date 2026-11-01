# Demo outline

Keep the whole recording under 10 minutes. Each section should be under five minutes.

## Customer walkthrough (3-4 minutes)

1. Frame the product: one desk view makes the day-ahead wind forecast and its historic error visible before the buying decision.
2. Explain the monthly scorecard: MAE is a typical miss, RMSE weighs large misses more, bias shows direction, and WAPE compares absolute error with actual wind output.
3. Select a delivery day and compare actual generation with the forecast used before the 10:00 UK cutoff on the previous day.
4. Select a different day in the daily MAE strip, inspect settlement-period details, and export the CSV.
5. Explain how forecast error informs procurement confidence. Demand is not in scope, so the pilot does not calculate a full procurement quantity.

## Technical walkthrough (3-4 minutes)

1. Architecture: React/Vite dashboard; FastAPI fetches Elexon WINDFOR and FUELHH, aligns observations, calculates metrics, and serves JSON and CSV. Docker packages the app.
2. Data matching: choose the latest forecast published by 10:00 Europe/London the day before delivery. Pair the hourly forecast with its two half-hour actuals.
3. Metrics: show MAE, RMSE, bias, WAPE, and matched-period coverage. Missing pairs are excluded.
4. Practices: public API without a key, request timeout, 15-minute in-process cache, health route, responsive UI, and CSV export.
5. Limitations: the 10:00 cutoff is a pilot assumption; confirm the trading desk's actual rule before operational use. Wind alone is not a complete net-demand procurement model.
