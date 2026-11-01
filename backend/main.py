from __future__ import annotations

import asyncio
import csv
import io
import math
import os
import time as clock
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

API_BASE = os.getenv("ELEXON_API_BASE", "https://data.elexon.co.uk/bmrs/api/v1")
LONDON = ZoneInfo("Europe/London")
MONTH = "2026-01"
app = FastAPI(title="Wind Desk", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


async def get_dataset(client: httpx.AsyncClient, code: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = await client.get(f"{API_BASE}/datasets/{code}/stream", params=params)
    response.raise_for_status()
    result = response.json()
    if isinstance(result, dict):
        result = result.get("data", [])
    if not isinstance(result, list):
        raise ValueError(f"Unexpected {code} response")
    return result


async def fetch_month() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    # Dataset stream windows use publication time. Include Dec 31 so Jan 1
    # delivery periods can use their day-ahead forecast, and include the final
    # January actual publication which arrives just after delivery.
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
        forecasts, actuals = await asyncio.gather(
            get_dataset(client, "WINDFOR", {
                "publishDateTimeFrom": "2025-12-31T00:00:00Z",
                "publishDateTimeTo": "2026-02-01T10:00:00Z",
            }),
            get_dataset(client, "FUELHH", {
                "publishDateTimeFrom": "2026-01-01T00:00:00Z",
                "publishDateTimeTo": "2026-02-02T00:00:00Z",
                "fuelType": "WIND",
            }),
        )
    return forecasts, actuals


_cache: dict[str, Any] = {"expires": 0.0, "rows": None}


async def get_rows() -> list[dict[str, Any]]:
    if _cache["rows"] is not None and clock.time() < _cache["expires"]:
        return _cache["rows"]
    try:
        forecasts, actuals = await fetch_month()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Elexon data could not be loaded: {exc}") from exc

    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 2, 1, tzinfo=timezone.utc)
    actual_by_start: dict[datetime, float] = {}
    for item in actuals:
        target = parse_time(item.get("startTime"))
        value = item.get("generation")
        if target is not None and start <= target < end and value is not None:
            actual_by_start[target] = float(value)

    forecasts_by_delivery_and_target: dict[tuple[str, datetime], list[tuple[datetime, float]]] = {}
    for item in forecasts:
        target = parse_time(item.get("startTime"))
        published = parse_time(item.get("publishTime"))
        value = item.get("generation")
        if target is None or published is None or value is None:
            continue
        local_target = target.astimezone(LONDON)
        if local_target.strftime("%Y-%m") != MONTH:
            continue
        delivery_day = local_target.date()
        cutoff = datetime.combine(delivery_day - timedelta(days=1), time(10, 0), LONDON).astimezone(timezone.utc)
        if published > cutoff:
            continue
        key = (delivery_day.isoformat(), target)
        forecasts_by_delivery_and_target.setdefault(key, []).append((published, float(value)))

    output = []
    for actual_start, actual_value in actual_by_start.items():
        delivery_day = actual_start.astimezone(LONDON).date()
        hour_start = actual_start.replace(minute=0, second=0, microsecond=0)
        candidates = forecasts_by_delivery_and_target.get((delivery_day.isoformat(), hour_start), [])
        if not candidates:
            continue
        forecast_publish_time, forecast_value = max(candidates, key=lambda pair: pair[0])
        local_start = actual_start.astimezone(LONDON)
        error = forecast_value - actual_value
        output.append({
            "startTime": actual_start.isoformat().replace("+00:00", "Z"),
            "localStartTime": local_start.isoformat(),
            "deliveryDate": delivery_day.isoformat(),
            "settlementPeriod": int((local_start.hour * 60 + local_start.minute) / 30) + 1,
            "forecastMw": forecast_value,
            "actualMw": actual_value,
            "errorMw": error,
            "absoluteErrorMw": abs(error),
            "forecastPublishTime": forecast_publish_time.isoformat().replace("+00:00", "Z"),
        })
    output.sort(key=lambda row: row["startTime"])
    _cache.update(rows=output, expires=clock.time() + 900)
    return output


def metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"periods": 0, "maeMw": None, "rmseMw": None, "biasMw": None, "wapePct": None}
    errors = [row["errorMw"] for row in rows]
    actual_total = sum(row["actualMw"] for row in rows)
    return {
        "periods": len(rows),
        "maeMw": sum(abs(error) for error in errors) / len(errors),
        "rmseMw": math.sqrt(sum(error * error for error in errors) / len(errors)),
        "biasMw": sum(errors) / len(errors),
        "wapePct": 100 * sum(abs(error) for error in errors) / actual_total if actual_total else None,
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "wind-desk"}


@app.get("/api/wind/summary")
async def summary(month: str = Query(MONTH, pattern=r"^2026-01$")) -> dict[str, Any]:
    rows = await get_rows()
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_day.setdefault(row["deliveryDate"], []).append(row)
    daily = [{"date": day, **metrics(day_rows)} for day, day_rows in sorted(by_day.items())]
    return {
        "month": month,
        "timezone": "Europe/London",
        "cutoffLocal": "10:00 on the day before delivery",
        "overall": metrics(rows),
        "daily": daily,
        "coverage": {
            "matchedPeriods": len(rows),
            "expectedPeriods": 31 * 48,
            "unmatchedPeriods": 31 * 48 - len(rows),
            "coveragePct": 100 * len(rows) / (31 * 48),
            "daysWithData": len(by_day),
        },
        "source": "Elexon Insights API (FUELHH + WINDFOR)",
        "refreshedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.get("/api/wind/series")
async def series(day: date = Query(..., alias="date")) -> dict[str, Any]:
    if day.strftime("%Y-%m") != MONTH:
        raise HTTPException(status_code=400, detail="Choose a delivery date in January 2026.")
    rows = await get_rows()
    selected = [row for row in rows if row["deliveryDate"] == day.isoformat()]
    return {"date": day.isoformat(), "metrics": metrics(selected), "periods": selected}


@app.get("/api/wind/export.csv")
async def export_csv() -> StreamingResponse:
    rows = await get_rows()
    buffer = io.StringIO()
    fields = ["deliveryDate", "settlementPeriod", "localStartTime", "forecastMw", "actualMw", "errorMw", "forecastPublishTime"]
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    writer.writerows({field: row[field] for field in fields} for row in rows)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=wind-forecast-accuracy-2026-01.csv"})


if os.path.isdir("static"):
    app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

    @app.get("/{path:path}")
    async def web_app(path: str) -> FileResponse:
        return FileResponse("static/index.html")


