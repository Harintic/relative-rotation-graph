from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from python_backend.core import (
    DownloadRequest,
    contract_options_from_item,
    download_history,
    format_result,
    resolve_download_symbol,
    search_symbols,
)
from python_backend.log_bus import clear_logs, emit_terminal_line, get_logs_since, install_stdio_tee
from python_backend.rrg import create_rrg
from python_backend.sets import create_set, delete_set, duplicate_set, list_sets, retry_failed_set, sync_set, update_set
from python_backend.settings import load_settings, save_settings


API_VERSION = "2026-04-18-1"
API_FEATURES = {"retry_failed": True, "logs": True, "sets": True, "rrg": True}


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
  body = json.dumps(payload).encode("utf-8")
  handler.send_response(status)
  handler.send_header("Access-Control-Allow-Origin", "*")
  handler.send_header("Access-Control-Allow-Headers", "Content-Type")
  handler.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  handler.send_header("Content-Type", "application/json; charset=utf-8")
  handler.send_header("Content-Length", str(len(body)))
  handler.end_headers()
  handler.wfile.write(body)


def _error_payload(exc: Exception) -> dict:
    return {"error": str(exc), "type": exc.__class__.__name__}


class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            query = parse_qs(urlparse(self.path).query)
            parts = [part for part in path.split("/") if part]
            if path == "/health":
                _json_response(self, 200, {"ok": True})
                return
            if path == "/api/meta":
                _json_response(self, 200, {"version": API_VERSION, "features": API_FEATURES})
                return
            if path == "/api/settings":
                _json_response(self, 200, load_settings())
                return
            if path == "/api/logs":
                since = int((query.get("since") or ["0"])[0] or 0)
                limit = int((query.get("limit") or ["500"])[0] or 500)
                logs, next_id = get_logs_since(since=since, limit=limit)
                _json_response(self, 200, {"logs": logs, "next_id": next_id})
                return
            if parts == ["api", "sets"]:
                _json_response(self, 200, {"sets": list_sets()})
                return
            _json_response(self, 404, {"error": "not found"})
        except Exception as exc:
            _json_response(self, 500, _error_payload(exc))

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            parts = [part for part in path.split("/") if part]
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")

            if path == "/api/search":
                query = payload.get("query", "").strip()
                exchange = payload.get("exchange", "").strip()
                emit_terminal_line("INFO", "search", f"request query={query!r} exchange={exchange!r}")
                if not query:
                    _json_response(self, 200, {"results": []})
                    return
                results = search_symbols(query, exchange)
                _json_response(
                    self,
                    200,
                    {
                        "results": results[:100],
                        "count": len(results),
                        "formatted": [format_result(item) for item in results[:100]],
                        "contracts": [contract_options_from_item(item) for item in results[:100]],
                    },
                )
                return

            if path == "/api/resolve":
                base_symbol = payload.get("base_symbol", "").strip()
                source_exchange = payload.get("source_exchange", "").strip()
                contract_symbol = payload.get("contract_symbol", "").strip()
                emit_terminal_line("INFO", "resolve", f"request base={base_symbol!r} source={source_exchange!r} contract={contract_symbol!r}")
                download_symbol, download_exchange, fut_contract = resolve_download_symbol(
                    base_symbol,
                    source_exchange,
                    contract_symbol,
                )
                _json_response(
                    self,
                    200,
                    {
                        "download_symbol": download_symbol,
                        "download_exchange": download_exchange,
                        "fut_contract": fut_contract,
                        "resolved": f"Resolved: {download_exchange}:{download_symbol}" + (
                            f" (fut_contract={fut_contract})" if fut_contract is not None else ""
                        ),
                    },
                )
                return

            if path == "/api/download":
                request = DownloadRequest(
                    symbol=payload.get("symbol", "").strip(),
                    exchange=payload.get("exchange", "").strip(),
                    interval=payload.get("interval", "Daily").strip() or "Daily",
                    bars=int(payload.get("bars") or 5000),
                    username=(payload.get("username") or "").strip() or None,
                    password=(payload.get("password") or "").strip() or None,
                    contract_symbol=payload.get("contract_symbol", "").strip(),
                    base_symbol=payload.get("base_symbol", "").strip(),
                    save_folder=payload.get("save_folder", "").strip(),
                    output_mode=payload.get("output_mode", "browser").strip() or "browser",
                )
                emit_terminal_line("INFO", "download", f"api request symbol={request.symbol!r} exchange={request.exchange!r}")
                result = download_history(request)
                _json_response(self, 200, result)
                return

            if path == "/api/settings":
                save_settings(payload)
                emit_terminal_line("INFO", "settings", "saved settings")
                _json_response(self, 200, {"ok": True})
                return

            if parts == ["api", "sets"]:
                record = create_set(payload)
                _json_response(self, 200, {"set": record})
                return

            if len(parts) == 4 and parts[0] == "api" and parts[1] == "sets" and parts[3] == "duplicate":
                record = duplicate_set(parts[2])
                _json_response(self, 200, {"set": record})
                return

            if len(parts) == 4 and parts[0] == "api" and parts[1] == "sets" and parts[3] in {"download", "update", "retry-failed"}:
                emit_terminal_line("INFO", "sets", f"api {parts[3]} request set_id={parts[2]}")
                if parts[3] == "retry-failed":
                    retry_ids = payload.get("asset_ids") or []
                    result = retry_failed_set(parts[2], retry_ids if isinstance(retry_ids, list) else None)
                else:
                    result = sync_set(parts[2], action=parts[3])
                _json_response(self, 200, result)
                return

            if path == "/api/rrg":
                set_id = str(payload.get("set_id") or "").strip()
                if not set_id:
                    raise ValueError("set_id is required")
                benchmark_asset_id = str(payload.get("benchmark_asset_id") or "").strip() or None
                lookback_days = int(payload.get("lookback_days") or 10)
                included_asset_ids = payload.get("included_asset_ids") or []
                missing_mode = str(payload.get("missing_mode") or "skip").strip() or "skip"
                formula = str(payload.get("formula") or "Default").strip() or "Default"
                emit_terminal_line("INFO", "rrg", f"create request set_id={set_id}")
                result = create_rrg(
                    set_id,
                    benchmark_asset_id=benchmark_asset_id,
                    lookback_days=lookback_days,
                    included_asset_ids=included_asset_ids if isinstance(included_asset_ids, list) else None,
                    missing_mode=missing_mode,
                    formula=formula,
                )
                _json_response(self, 200, result)
                return

            _json_response(self, 404, {"error": "not found"})
        except ValueError as exc:
            _json_response(self, 400, _error_payload(exc))
        except Exception as exc:
            _json_response(self, 500, _error_payload(exc))

    def do_PUT(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            parts = [part for part in path.split("/") if part]
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")

            if len(parts) == 3 and parts[0] == "api" and parts[1] == "sets":
                record = update_set(parts[2], payload)
                _json_response(self, 200, {"set": record})
                return

            _json_response(self, 404, {"error": "not found"})
        except ValueError as exc:
            _json_response(self, 400, _error_payload(exc))
        except Exception as exc:
            _json_response(self, 500, _error_payload(exc))

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            parts = [part for part in path.split("/") if part]

            if path == "/api/logs":
                clear_logs()
                _json_response(self, 200, {"ok": True})
                return

            if len(parts) == 3 and parts[0] == "api" and parts[1] == "sets":
                delete_set(parts[2])
                _json_response(self, 200, {"ok": True})
                return

            _json_response(self, 404, {"error": "not found"})
        except ValueError as exc:
            _json_response(self, 400, _error_payload(exc))
        except Exception as exc:
            _json_response(self, 500, _error_payload(exc))


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    install_stdio_tee()
    emit_terminal_line("INFO", "server", f"starting on http://{host}:{port}")
    server = ReusableThreadingHTTPServer((host, port), ApiHandler)
    print(f"Python backend listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
