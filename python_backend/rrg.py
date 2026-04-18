from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from python_backend.log_bus import emit_terminal_line
from python_backend.sets import OUTPUT_ROOT, get_set


@dataclass(frozen=True)
class RrgPoint:
    date: str
    x: float
    y: float


def _resolve_csv_path(folder: Path, asset: dict) -> Path:
    file_name = str(asset.get("file_name") or "").strip()
    if not file_name:
        raise ValueError(f"Asset {asset.get('id')} has no file name")

    path = folder / file_name
    if not path.exists():
        raise FileNotFoundError(f"Missing CSV: {path.name}")
    return path


def _load_asset_frame(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    if frame.empty:
        raise ValueError(f"Empty CSV: {path.name}")

    columns = {str(column).lower(): column for column in frame.columns}
    datetime_column = columns.get("datetime") or frame.columns[0]
    close_column = columns.get("close")
    if close_column is None:
        raise ValueError(f"CSV missing close column: {path.name}")

    frame = frame[[datetime_column, close_column]].rename(columns={datetime_column: "datetime", close_column: "close"})
    frame["datetime"] = pd.to_datetime(frame["datetime"], utc=True, errors="coerce")
    frame = frame.dropna(subset=["datetime", "close"]).sort_values("datetime")
    frame["date_key"] = frame["datetime"].dt.normalize()
    return frame


def _benchmark_window(frame: pd.DataFrame, lookback_days: int) -> pd.DataFrame:
    window = frame.tail(max(1, lookback_days)).copy()
    window = window[["date_key", "close"]].drop_duplicates(subset=["date_key"], keep="last")
    window = window.rename(columns={"close": "benchmark_close"}).sort_values("date_key").reset_index(drop=True)
    return window


def _align_skip(benchmark_frame: pd.DataFrame, asset_frame: pd.DataFrame) -> pd.DataFrame:
    benchmark_window = benchmark_frame[["date_key", "close"]].drop_duplicates(subset=["date_key"], keep="last")
    benchmark_window = benchmark_window.rename(columns={"close": "benchmark_close"})
    asset_window = asset_frame[["date_key", "close"]].drop_duplicates(subset=["date_key"], keep="last")
    asset_window = asset_window.rename(columns={"close": "asset_close"})
    return pd.merge(benchmark_window, asset_window, on="date_key", how="inner").sort_values("date_key")


def _align_ffill(benchmark_frame: pd.DataFrame, asset_frame: pd.DataFrame) -> pd.DataFrame:
    benchmark_window = benchmark_frame[["date_key", "close"]].drop_duplicates(subset=["date_key"], keep="last")
    benchmark_window = benchmark_window.rename(columns={"close": "benchmark_close"})
    aligned = benchmark_window.set_index("date_key").copy()
    asset_series = asset_frame[["date_key", "close"]].drop_duplicates(subset=["date_key"], keep="last").set_index("date_key")["close"].sort_index()
    aligned["asset_close"] = asset_series.reindex(aligned.index).ffill()
    return aligned.dropna(subset=["asset_close"]).reset_index()


def create_rrg(
    set_id: str,
    benchmark_asset_id: str | None = None,
    lookback_days: int = 10,
    included_asset_ids: list[str] | None = None,
    missing_mode: str = "skip",
) -> dict:
    record = get_set(set_id)
    assets = record.get("assets", [])
    if len(assets) < 2:
        raise ValueError("RRG needs at least two assets in the set")

    folder = OUTPUT_ROOT / str(record.get("folder_name") or "set")
    if not folder.exists():
        raise FileNotFoundError(f"Set output folder not found: {folder}")

    benchmark_id = str(benchmark_asset_id or record.get("benchmark_asset_id") or "").strip()
    benchmark = next((asset for asset in assets if str(asset.get("id")) == benchmark_id), None)
    if benchmark is None:
        benchmark = assets[0]
        benchmark_id = str(benchmark.get("id") or "")

    benchmark_path = _resolve_csv_path(folder, benchmark)
    benchmark_frame = _load_asset_frame(benchmark_path)
    benchmark_window = _benchmark_window(benchmark_frame, int(lookback_days or 10))
    benchmark_dates = [timestamp.isoformat() for timestamp in benchmark_frame["date_key"].drop_duplicates().tolist()]

    if included_asset_ids is None:
        included_ids = {str(asset.get("id") or "") for asset in assets}
    else:
        included_ids = {str(asset_id) for asset_id in included_asset_ids if str(asset_id).strip()}
    included_ids.discard("")

    missing_mode = "ffill" if str(missing_mode).strip().lower() == "ffill" else "skip"
    smooth_window = min(10, max(1, len(benchmark_frame)))
    benchmark_label = str(benchmark.get("symbol") or benchmark.get("selectedBaseSymbol") or benchmark.get("selectedContractSymbol") or "")
    series: list[dict] = []

    for asset in assets:
        asset_id = str(asset.get("id") or "")
        if asset_id == benchmark_id or asset_id not in included_ids:
            continue

        try:
            asset_path = _resolve_csv_path(folder, asset)
            asset_frame = _load_asset_frame(asset_path)
        except Exception as exc:
            emit_terminal_line("WARN", "rrg", f"skip {asset.get('symbol') or asset_id}: {exc}")
            continue

        aligned = _align_skip(benchmark_frame, asset_frame) if missing_mode == "skip" else _align_ffill(benchmark_frame, asset_frame)
        if aligned.empty:
            emit_terminal_line("WARN", "rrg", f"skip {asset.get('symbol') or asset_id}: no overlap with benchmark")
            continue

        ratio = aligned["asset_close"] / aligned["benchmark_close"]
        rs_ratio = (ratio / ratio.rolling(window=smooth_window, min_periods=1).mean()) * 100
        rs_momentum = (rs_ratio / rs_ratio.rolling(window=smooth_window, min_periods=1).mean()) * 100
        aligned = aligned.assign(rs_ratio=rs_ratio, rs_momentum=rs_momentum).dropna(subset=["rs_ratio", "rs_momentum"])
        if aligned.empty:
            continue

        points = [
            RrgPoint(date=row.date_key.isoformat(), x=float(row.rs_ratio), y=float(row.rs_momentum))
            for row in aligned.itertuples(index=False)
        ]

        series.append(
            {
                "asset_id": asset_id,
                "symbol": str(asset.get("symbol") or asset.get("selectedBaseSymbol") or asset.get("selectedContractSymbol") or ""),
                "exchange": str(asset.get("selectedSourceExchange") or asset.get("exchange") or ""),
                "latest": points[-1].__dict__ if points else None,
                "tail": [point.__dict__ for point in points],
            }
        )

    if not series:
        raise RuntimeError("No chart data could be generated for this set")

    emit_terminal_line(
        "INFO",
        "rrg",
        f"created rr chart set={record.get('name')!r} series={len(series)} benchmark={benchmark_label!r} lookback={lookback_days} missing={missing_mode}",
    )
    return {
        "set": record,
        "benchmark_asset_id": benchmark_id,
        "benchmark_label": benchmark_label,
        "lookback_days": int(lookback_days or 10),
        "interval": str(record.get("interval") or "Daily"),
        "missing_mode": missing_mode,
        "benchmark_dates": benchmark_dates,
        "included_asset_ids": sorted(included_ids),
        "series": series,
    }
