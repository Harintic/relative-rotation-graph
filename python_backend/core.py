from __future__ import annotations

import csv
import io
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from python_backend.log_bus import emit_terminal_line


BASE_DIR = Path(__file__).resolve().parent.parent
TVDATAFEED_DIR = BASE_DIR / "tvdatafeed"

if TVDATAFEED_DIR.exists():
    sys.path.insert(0, str(TVDATAFEED_DIR))

try:
    from tvDatafeed import Interval, TvDatafeed  # noqa: E402
except Exception as exc:  # pragma: no cover - dependency may not be installed locally yet
    Interval = None  # type: ignore[assignment]
    TvDatafeed = None  # type: ignore[assignment]
    _tvdatafeed_import_error = exc
else:
    _tvdatafeed_import_error = None


def get_intervals() -> dict[str, object]:
    if Interval is None:
        raise RuntimeError(f"tvDatafeed is unavailable: {_tvdatafeed_import_error}")

    return {
        "1 min": Interval.in_1_minute,
        "3 min": Interval.in_3_minute,
        "5 min": Interval.in_5_minute,
        "15 min": Interval.in_15_minute,
        "30 min": Interval.in_30_minute,
        "45 min": Interval.in_45_minute,
        "1 hour": Interval.in_1_hour,
        "2 hour": Interval.in_2_hour,
        "3 hour": Interval.in_3_hour,
        "4 hour": Interval.in_4_hour,
        "Daily": Interval.in_daily,
        "Weekly": Interval.in_weekly,
        "Monthly": Interval.in_monthly,
    }


@dataclass(frozen=True)
class DownloadRequest:
    symbol: str
    exchange: str
    interval: str
    bars: int = 5000
    username: str | None = None
    password: str | None = None
    contract_symbol: str = ""
    base_symbol: str = ""
    save_folder: str = ""
    save_file: str = ""
    output_mode: str = "browser"


def search_symbols(query: str, exchange: str = "") -> list[dict]:
    if TvDatafeed is None:
        raise RuntimeError(f"tvDatafeed is unavailable: {_tvdatafeed_import_error}")
    emit_terminal_line("DEBUG", "search", f"query={query!r} exchange={exchange!r}")
    tv = TvDatafeed()
    return tv.search_symbol(query, exchange) or []


def display_name(item: dict) -> str:
    return item.get("shortname") or item.get("description") or item.get("name") or ""


def format_result(item: dict) -> str:
    symbol = item.get("symbol", "")
    exchange = item.get("exchange", "")
    description = item.get("description") or item.get("name") or item.get("shortname") or ""
    parts = [part for part in [symbol, exchange, description] if part]
    return " | ".join(parts) if parts else str(item)


def tooltip_text(item: dict) -> str:
    description = item.get("description") or ""
    extra = []
    if item.get("type"):
        extra.append(f"Type: {item['type']}")
    if item.get("source_id"):
        extra.append(f"Source: {item['source_id']}")
    if item.get("country"):
        extra.append(f"Country: {item['country']}")
    if extra:
        return description + "\n" + "\n".join(extra) if description else "\n".join(extra)
    return description


def normalize_contract_symbol(symbol: str) -> str:
    return symbol.strip()


def contract_options_from_item(item: dict) -> list[str]:
    contracts = item.get("contracts") or []
    options: list[str] = []
    for contract in contracts:
        symbol = contract.get("symbol")
        if symbol:
            options.append(normalize_contract_symbol(symbol))

    seen = set()
    deduped = []
    for option in options:
        if option not in seen:
            seen.add(option)
            deduped.append(option)

    def sort_key(value: str) -> tuple[int, str]:
        if value.endswith("!"):
            m = re.search(r"(\d+)!$", value)
            if m:
                return (0, f"{int(m.group(1)):04d}")
            return (0, value)
        return (1, value)

    return sorted(deduped, key=sort_key)


def resolve_download_symbol(
    base_symbol: str,
    source_exchange: str,
    contract_symbol: str,
) -> tuple[str, str, int | None]:
    base_symbol = base_symbol.strip()
    contract_symbol = contract_symbol.strip()
    source_exchange = source_exchange.strip()

    if not contract_symbol:
        raise ValueError("Select a futures contract first")

    if base_symbol and contract_symbol.startswith(base_symbol) and contract_symbol.endswith("!"):
        match = re.fullmatch(rf"{re.escape(base_symbol)}(\d+)!", contract_symbol)
        if match:
            return base_symbol, source_exchange, int(match.group(1))

    return contract_symbol, source_exchange, None


def build_output_path(base_path: str | Path, symbol: str, contract_symbol: str = "") -> Path:
    base_path = Path(base_path)
    folder = base_path.parent if base_path.suffix.lower() == ".csv" else base_path
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    name = contract_symbol or symbol
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or symbol
    return folder / f"{safe_name}_{timestamp}.csv"


def download_history(request: DownloadRequest) -> dict:
    if TvDatafeed is None or Interval is None:
        raise RuntimeError(f"tvDatafeed is unavailable: {_tvdatafeed_import_error}")

    intervals = get_intervals()
    if request.interval not in intervals:
        raise ValueError(f"Unsupported interval: {request.interval}")

    emit_terminal_line(
        "INFO",
        "download",
        f"start symbol={request.symbol!r} exchange={request.exchange!r} interval={request.interval!r} bars={request.bars}",
    )

    symbol, exchange, fut_contract = resolve_download_symbol(
        request.base_symbol or request.symbol,
        request.exchange,
        request.contract_symbol,
    )

    emit_terminal_line(
        "DEBUG",
        "download",
        f"resolved symbol={symbol!r} exchange={exchange!r} fut_contract={fut_contract}",
    )

    interval = intervals[request.interval]
    tv = TvDatafeed(request.username, request.password)
    data = tv.get_hist(
        symbol=symbol,
        exchange=exchange,
        interval=interval,
        n_bars=request.bars,
        fut_contract=fut_contract,
    )
    if data is None or data.empty:
        emit_terminal_line("WARN", "download", f"no data for {exchange}:{symbol}")
        raise RuntimeError(f"No data returned for {exchange}:{symbol}")

    frame = data.reset_index().rename(columns={"index": "datetime"})
    if frame.columns[0] != "datetime":
        frame = frame.rename(columns={frame.columns[0]: "datetime"})

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(frame.columns.tolist())
    for row in frame.itertuples(index=False, name=None):
        writer.writerow(row)

    csv_text = buffer.getvalue()
    saved_path = ""
    if request.output_mode in {"folder", "both"}:
        if request.save_file:
            output_path = Path(request.save_file)
        else:
            output_path = build_output_path(request.save_folder or BASE_DIR / "Output", request.symbol, request.contract_symbol)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(csv_text, encoding="utf-8")
        saved_path = str(output_path)
        emit_terminal_line("INFO", "download", f"saved rows={len(frame)} path={saved_path}")
    else:
        emit_terminal_line("INFO", "download", f"completed rows={len(frame)} browser_output=True")

    return {
        "symbol": request.symbol,
        "resolved_symbol": symbol,
        "resolved_exchange": exchange,
        "fut_contract": fut_contract,
        "rows": len(frame),
        "csv": csv_text,
        "saved_path": saved_path,
    }
