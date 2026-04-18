from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from python_backend.core import (
    DownloadRequest,
    contract_options_from_item,
    download_history,
    format_result,
    resolve_download_symbol,
    search_symbols,
)
from python_backend.settings import load_settings, save_settings


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/health":
                _json_response(self, 200, {"ok": True})
                return
            if path == "/api/settings":
                _json_response(self, 200, load_settings())
                return
            _json_response(self, 404, {"error": "not found"})
        except Exception as exc:
            _json_response(self, 500, _error_payload(exc))

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")

            if path == "/api/search":
                query = payload.get("query", "").strip()
                exchange = payload.get("exchange", "").strip()
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
                result = download_history(request)
                _json_response(self, 200, result)
                return

            if path == "/api/settings":
                save_settings(payload)
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
    server = ReusableThreadingHTTPServer((host, port), ApiHandler)
    print(f"Python backend listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
