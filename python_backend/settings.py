from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
SETTINGS_PATH = BASE_DIR / ".rrg_settings.json"


def default_settings() -> dict:
    return {
        "search": "",
        "exchange": "",
        "symbol": "",
        "interval": "Daily",
        "bars": "5000",
        "theme": "dark",
        "output_mode": "browser",
        "save_folder": str(BASE_DIR / "Output"),
        "username": "",
        "password": "",
        "selected_source_exchange": "",
        "selected_base_symbol": "",
        "selected_contract_symbol": "",
        "rr_selected_set_id": "",
        "rr_benchmark_asset_id": "",
        "rr_lookback_days": "10",
        "rr_anchor_date": "",
        "rr_missing_mode": "skip",
        "rr_latest_point_size": "6",
        "rr_other_point_size": "3",
        "rr_included_asset_ids": None,
        "rr_panel_open": False,
        "rr_highlighted_asset_id": "",
        "rr_fixed_graph": False,
        "rr_fixed_bounds": "",
    }


def load_settings() -> dict:
    data = default_settings()
    if SETTINGS_PATH.exists():
        try:
            with SETTINGS_PATH.open("r", encoding="utf-8") as fh:
                data.update(json.load(fh))
        except Exception:
            pass
    return data


def save_settings(payload: dict) -> None:
    with SETTINGS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
