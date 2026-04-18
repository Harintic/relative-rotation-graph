from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from python_backend.core import BASE_DIR, DownloadRequest, download_history
from python_backend.log_bus import emit_terminal_line
from python_backend.settings import load_settings


SETS_PATH = BASE_DIR / ".rrg_sets.json"
OUTPUT_ROOT = BASE_DIR / "Output"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_name(value: str, fallback: str = "set") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-")
    return cleaned or fallback


def _sanitize_file_name(value: str, fallback: str = "asset") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._! -]+", "_", value.strip()).strip(" ._")
    return cleaned or fallback


def _load_store() -> dict:
    store = {"sets": []}
    if not SETS_PATH.exists():
        return store

    try:
        with SETS_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return store

    if isinstance(data, dict) and isinstance(data.get("sets"), list):
        store["sets"] = data["sets"]
    return store


def _save_store(store: dict) -> None:
    SETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SETS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=2)


def _find_set_index(store: dict, set_id: str) -> int:
    for index, item in enumerate(store["sets"]):
        if item.get("id") == set_id:
            return index
    raise ValueError("Set not found")


def _normalize_asset(asset: dict, existing: dict | None = None) -> dict:
    existing = existing or {}
    asset_id = str(asset.get("id") or existing.get("id") or uuid.uuid4())
    symbol = str(asset.get("symbol") or existing.get("symbol") or "").strip()
    exchange = str(asset.get("exchange") or existing.get("exchange") or "").strip()
    search = str(asset.get("search") or existing.get("search") or "").strip()
    selected_source_exchange = str(
        asset.get("selectedSourceExchange")
        or asset.get("selected_source_exchange")
        or existing.get("selectedSourceExchange")
        or existing.get("selected_source_exchange")
        or exchange
    ).strip()
    selected_base_symbol = str(
        asset.get("selectedBaseSymbol")
        or asset.get("selected_base_symbol")
        or existing.get("selectedBaseSymbol")
        or existing.get("selected_base_symbol")
        or symbol
    ).strip()
    selected_contract_symbol = str(
        asset.get("selectedContractSymbol")
        or asset.get("selected_contract_symbol")
        or existing.get("selectedContractSymbol")
        or existing.get("selected_contract_symbol")
        or ""
    ).strip()
    file_name = str(asset.get("file_name") or existing.get("file_name") or "").strip()
    if not file_name:
        label = selected_contract_symbol or symbol or selected_base_symbol or asset_id[:8]
        file_name = f"{_sanitize_file_name(label)}.csv"
    elif selected_contract_symbol:
        legacy_match = re.fullmatch(rf"{re.escape(selected_contract_symbol)}_[0-9a-fA-F]{{8}}\.csv", file_name)
        if legacy_match:
            file_name = f"{_sanitize_file_name(selected_contract_symbol)}.csv"

    last_updated = str(asset.get("last_updated") or existing.get("last_updated") or "").strip()
    available_bars = asset.get("available_bars") if asset.get("available_bars") is not None else existing.get("available_bars")
    if available_bars in (None, ""):
        available_bars = ""

    return {
        "id": asset_id,
        "search": search,
        "exchange": exchange,
        "symbol": symbol,
        "selectedSourceExchange": selected_source_exchange,
        "selectedBaseSymbol": selected_base_symbol,
        "selectedContractSymbol": selected_contract_symbol,
        "file_name": file_name,
        "last_updated": last_updated,
        "available_bars": available_bars,
    }


def _normalize_set(item: dict, existing: dict | None = None) -> dict:
    existing = existing or {}
    settings = load_settings()
    set_id = str(item.get("id") or existing.get("id") or uuid.uuid4())
    name = str(item.get("name") or existing.get("name") or "").strip()
    interval = str(item.get("interval") or existing.get("interval") or "Daily").strip() or "Daily"
    bars = str(item.get("bars") or existing.get("bars") or settings.get("bars") or "5000").strip() or "5000"
    assets = item.get("assets") or existing.get("assets") or []
    existing_assets = existing.get("assets") or []
    normalized_assets = []
    for index, asset in enumerate(assets):
        existing_asset = existing_assets[index] if index < len(existing_assets) else None
        normalized_assets.append(_normalize_asset(asset, existing_asset))
    folder_name = str(item.get("folder_name") or existing.get("folder_name") or _sanitize_name(name)).strip()

    return {
        "id": set_id,
        "name": name,
        "interval": interval,
        "bars": bars,
        "folder_name": folder_name,
        "assets": normalized_assets,
        "updated_at": _now(),
        "created_at": existing.get("created_at") or _now(),
    }


def list_sets() -> list[dict]:
    return _load_store()["sets"]


def get_set(set_id: str) -> dict:
    store = _load_store()
    index = _find_set_index(store, set_id)
    return store["sets"][index]


def _save_set_record(record: dict) -> None:
    store = _load_store()
    index = _find_set_index(store, str(record.get("id")))
    store["sets"][index] = record
    _save_store(store)


def _load_manifest(folder: Path) -> dict | None:
    manifest_path = folder / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        with manifest_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _sync_assets(record: dict, action: str, asset_ids: set[str] | None = None) -> dict:
    settings = load_settings()
    bars = int(record.get("bars") or settings.get("bars") or 5000)
    username = str(settings.get("username") or "").strip() or None
    password = str(settings.get("password") or "").strip() or None

    folder = OUTPUT_ROOT / str(record.get("folder_name") or _sanitize_name(record.get("name", "set")))
    folder.mkdir(parents=True, exist_ok=True)

    assets = record.get("assets", [])
    if asset_ids is not None:
        assets = [asset for asset in assets if str(asset.get("id")) in asset_ids]

    emit_terminal_line(
        "INFO",
        "sets",
        f"{action} set name={record.get('name')!r} interval={record.get('interval')!r} assets={len(assets)}",
    )

    results: list[dict] = []
    total_assets = len(assets)
    updated_assets = [dict(asset) for asset in record.get("assets", [])]
    asset_lookup = {str(asset.get("id")): asset for asset in updated_assets}
    sync_time = _now()
    for index, asset in enumerate(assets, start=1):
        save_file = folder / str(asset.get("file_name") or f"{asset.get('id', 'asset')}.csv")
        try:
            emit_terminal_line(
                "INFO",
                "sets",
                f"[{index}/{total_assets}] downloading {asset.get('selectedSourceExchange') or asset.get('exchange') or ''}:{asset.get('selectedContractSymbol') or asset.get('symbol') or ''}",
            )
            response = download_history(
                DownloadRequest(
                    symbol=str(asset.get("symbol") or "").strip(),
                    exchange=str(asset.get("selectedSourceExchange") or asset.get("exchange") or "").strip(),
                    interval=str(record.get("interval") or "Daily").strip() or "Daily",
                    bars=bars,
                    username=username,
                    password=password,
                    contract_symbol=str(asset.get("selectedContractSymbol") or "").strip(),
                    base_symbol=str(asset.get("selectedBaseSymbol") or "").strip(),
                    save_folder=str(folder),
                    save_file=str(save_file),
                    output_mode="folder",
                )
            )
            results.append(
                {
                    "asset_id": asset.get("id"),
                    "file_name": save_file.name,
                    "ok": True,
                    "rows": response["rows"],
                    "saved_path": response["saved_path"],
                    "resolved_symbol": response["resolved_symbol"],
                    "resolved_exchange": response["resolved_exchange"],
                    "fut_contract": response["fut_contract"],
                    "last_updated": sync_time,
                    "available_bars": response["rows"],
                }
            )
            if str(asset.get("id")) in asset_lookup:
                asset_lookup[str(asset.get("id"))]["last_updated"] = sync_time
                asset_lookup[str(asset.get("id"))]["available_bars"] = response["rows"]
            emit_terminal_line("INFO", "sets", f"[{index}/{total_assets}] saved {save_file.name} rows={response['rows']}")
        except Exception as exc:
            emit_terminal_line("ERROR", "sets", f"[{index}/{total_assets}] failed {save_file.name}: {exc}")
            results.append(
                {
                    "asset_id": asset.get("id"),
                    "file_name": save_file.name,
                    "ok": False,
                    "error": str(exc),
                }
            )

    manifest = {
        "set_id": record.get("id"),
        "set_name": record.get("name"),
        "interval": record.get("interval"),
        "folder_name": folder.name,
        "action": action,
        "updated_at": _now(),
        "assets": results,
    }
    with (folder / "manifest.json").open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    updated_record = dict(record)
    updated_record["bars"] = str(record.get("bars") or settings.get("bars") or "5000").strip() or "5000"
    updated_record["assets"] = updated_assets
    updated_record["updated_at"] = sync_time
    _save_set_record(updated_record)

    return {
        "set": updated_record,
        "folder": str(folder),
        "action": action,
        "total": len(results),
        "success": sum(1 for item in results if item.get("ok")),
        "failed": sum(1 for item in results if not item.get("ok")),
        "results": results,
        "retried_asset_ids": [str(item.get("asset_id")) for item in results],
    }


def create_set(payload: dict) -> dict:
    store = _load_store()
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Set name is required")

    if any(str(item.get("name", "")).strip().lower() == name.lower() for item in store["sets"]):
        raise ValueError("A set with this name already exists")

    assets = payload.get("assets") or []
    if not assets:
        raise ValueError("Add at least one asset to the set")

    record = _normalize_set({**payload, "name": name, "assets": assets})
    store["sets"].append(record)
    _save_store(store)
    emit_terminal_line("INFO", "sets", f"created set name={record['name']!r} assets={len(record['assets'])}")
    return record


def update_set(set_id: str, payload: dict) -> dict:
    store = _load_store()
    index = _find_set_index(store, set_id)
    existing = store["sets"][index]
    name = str(payload.get("name") or existing.get("name") or "").strip()
    if not name:
        raise ValueError("Set name is required")

    if any(
        str(item.get("name", "")).strip().lower() == name.lower() and item.get("id") != set_id
        for item in store["sets"]
    ):
        raise ValueError("A set with this name already exists")

    assets = payload.get("assets") or []
    if not assets:
        raise ValueError("Add at least one asset to the set")

    updated = _normalize_set({**existing, **payload, "name": name, "assets": assets}, existing)
    old_folder = OUTPUT_ROOT / str(existing.get("folder_name") or _sanitize_name(existing.get("name", "set")))
    new_folder = OUTPUT_ROOT / updated["folder_name"]
    if old_folder.exists() and old_folder != new_folder:
        if new_folder.exists():
            raise ValueError(f"Output folder already exists: {new_folder.name}")
        old_folder.rename(new_folder)

    store["sets"][index] = updated
    _save_store(store)
    emit_terminal_line("INFO", "sets", f"updated set id={set_id} name={updated['name']!r} assets={len(updated['assets'])}")
    return updated


def delete_set(set_id: str) -> None:
    store = _load_store()
    index = _find_set_index(store, set_id)
    name = store["sets"][index].get("name", set_id)
    store["sets"].pop(index)
    _save_store(store)
    emit_terminal_line("INFO", "sets", f"deleted set id={set_id} name={name!r}")


def sync_set(set_id: str, action: str = "download") -> dict:
    record = get_set(set_id)
    return _sync_assets(record, action=action)


def retry_failed_set(set_id: str, asset_ids: list[str] | None = None) -> dict:
    record = get_set(set_id)
    folder = OUTPUT_ROOT / str(record.get("folder_name") or _sanitize_name(record.get("name", "set")))
    failed_ids = set(asset_ids or [])

    if not failed_ids:
        manifest = _load_manifest(folder)
        if manifest:
            failed_ids = {
                str(item.get("asset_id"))
                for item in manifest.get("assets", [])
                if not item.get("ok") and item.get("asset_id")
            }

    if not failed_ids:
        raise ValueError("No failed assets to retry")

    emit_terminal_line("INFO", "sets", f"retry failed set name={record.get('name')!r} assets={len(failed_ids)}")
    return _sync_assets(record, action="retry_failed", asset_ids=failed_ids)
