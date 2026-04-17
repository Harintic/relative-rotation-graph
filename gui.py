from __future__ import annotations

import json
import re
import threading
import sys
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parent
TVDATAFEED_DIR = ROOT / "tvdatafeed"

if TVDATAFEED_DIR.exists():
    sys.path.insert(0, str(TVDATAFEED_DIR))

from tvDatafeed import Interval, TvDatafeed  # noqa: E402


INTERVALS = {
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


class DownloaderApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("TradingView Data Downloader")
        self.geometry("900x620")
        self.minsize(840, 560)

        self.settings_path = ROOT / ".gui_settings.json"
        self.search_after_id = None
        self.save_after_id = None
        self.search_token = 0
        self.latest_results: list[dict] = []
        self.selected_row_id: str | None = None
        self.selected_base_symbol = ""
        self.selected_source_exchange = ""
        self.selected_contract_symbol = ""
        self.tooltip = None
        self.tooltip_after_id = None
        self.hover_item_id = None

        self._build_ui()
        self._wire_persistence()
        self._load_settings()
        self.after(300, self._restore_previous_search)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=12)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="Search").grid(row=0, column=0, sticky="w")
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(top, textvariable=self.search_var)
        search_entry.grid(row=0, column=1, sticky="ew", padx=(8, 8))
        search_entry.bind("<KeyRelease>", self._on_search_key)

        ttk.Label(top, text="Exchange").grid(row=0, column=2, sticky="w")
        self.exchange_var = tk.StringVar()
        ttk.Entry(top, textvariable=self.exchange_var, width=16).grid(row=0, column=3, sticky="w", padx=(8, 0))

        mid = ttk.Frame(self, padding=(12, 0, 12, 12))
        mid.grid(row=1, column=0, sticky="nsew")
        mid.columnconfigure(0, weight=1)
        mid.rowconfigure(1, weight=1)

        ttk.Label(mid, text="Suggestions").grid(row=0, column=0, sticky="w")
        list_frame = ttk.Frame(mid)
        list_frame.grid(row=1, column=0, sticky="nsew")
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)

        self.results = ttk.Treeview(list_frame, columns=("symbol", "name", "exchange"), show="headings", height=12)
        self.results.heading("symbol", text="Symbol")
        self.results.heading("name", text="Name")
        self.results.heading("exchange", text="Exchange")
        self.results.column("symbol", width=120, anchor="w", stretch=False)
        self.results.column("name", width=540, anchor="w", stretch=True)
        self.results.column("exchange", width=140, anchor="w", stretch=False)
        self.results.grid(row=0, column=0, sticky="nsew")
        self.results.bind("<<TreeviewSelect>>", self._on_result_select)
        self.results.bind("<Motion>", self._on_result_motion)
        self.results.bind("<Leave>", self._hide_tooltip)

        scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.results.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.results.configure(yscrollcommand=scroll.set)

        form = ttk.LabelFrame(mid, text="Download Settings", padding=12)
        form.grid(row=2, column=0, sticky="ew", pady=(12, 0))
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="Symbol").grid(row=0, column=0, sticky="w")
        self.symbol_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.symbol_var).grid(row=0, column=1, sticky="ew", padx=(8, 0))

        ttk.Label(form, text="Interval").grid(row=0, column=2, sticky="w", padx=(16, 0))
        self.interval_var = tk.StringVar()
        self.interval_box = ttk.Combobox(form, textvariable=self.interval_var, values=list(INTERVALS.keys()), state="readonly", width=14)
        self.interval_box.grid(row=0, column=3, sticky="w", padx=(8, 0))

        ttk.Label(form, text="Bars").grid(row=1, column=0, sticky="w", pady=(10, 0))
        self.n_bars_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.n_bars_var).grid(row=1, column=1, sticky="ew", padx=(8, 0), pady=(10, 0))

        ttk.Label(form, text="Fut contract").grid(row=1, column=2, sticky="w", padx=(16, 0), pady=(10, 0))
        self.contract_var = tk.StringVar()
        self.contract_box = ttk.Combobox(form, textvariable=self.contract_var, state="readonly", width=14)
        self.contract_box.grid(row=1, column=3, sticky="w", padx=(8, 0), pady=(10, 0))
        self.contract_box.bind("<<ComboboxSelected>>", lambda _e: self._schedule_save())

        ttk.Label(form, text="Output CSV").grid(row=2, column=0, sticky="w", pady=(10, 0))
        self.output_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.output_var).grid(row=2, column=1, sticky="ew", padx=(8, 0), pady=(10, 0))
        ttk.Button(form, text="Browse", command=self._browse_output).grid(row=2, column=3, sticky="w", padx=(8, 0), pady=(10, 0))

        ttk.Label(form, text="Username").grid(row=3, column=0, sticky="w", pady=(10, 0))
        self.username_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.username_var).grid(row=3, column=1, sticky="ew", padx=(8, 0), pady=(10, 0))

        ttk.Label(form, text="Password").grid(row=3, column=2, sticky="w", padx=(16, 0), pady=(10, 0))
        self.password_var = tk.StringVar()
        ttk.Entry(form, textvariable=self.password_var, show="*").grid(row=3, column=3, sticky="w", padx=(8, 0), pady=(10, 0))

        actions = ttk.Frame(mid)
        actions.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        ttk.Button(actions, text="Download", command=self._start_download).pack(side="left")

        self.resolved_var = tk.StringVar(value="Select a row to resolve the download symbol.")
        ttk.Label(mid, textvariable=self.resolved_var).grid(row=4, column=0, sticky="w", pady=(8, 0))

        self.status_var = tk.StringVar(value="Type a query and wait 1 second for suggestions.")
        ttk.Label(mid, textvariable=self.status_var).grid(row=5, column=0, sticky="w", pady=(12, 0))

    def _wire_persistence(self) -> None:
        for var in (
            self.search_var,
            self.exchange_var,
            self.symbol_var,
            self.interval_var,
            self.n_bars_var,
            self.contract_var,
            self.output_var,
            self.username_var,
            self.password_var,
        ):
            var.trace_add("write", self._schedule_save)

    def _schedule_save(self, *_args) -> None:
        if self.save_after_id is not None:
            self.after_cancel(self.save_after_id)

        self.save_after_id = self.after(300, self._save_settings)

    def _load_settings(self) -> None:
        defaults = {
            "search": "",
            "exchange": "",
            "symbol": "",
            "interval": "Daily",
            "bars": "5000",
            "output": str(ROOT / "Output.csv"),
            "username": "",
            "password": "",
            "selected_source_exchange": "",
            "selected_base_symbol": "",
            "selected_contract_symbol": "",
        }

        if self.settings_path.exists():
            try:
                with self.settings_path.open("r", encoding="utf-8") as fh:
                    data = json.load(fh)
                defaults.update({k: data.get(k, v) for k, v in defaults.items()})
            except Exception:
                pass

        self.search_var.set(defaults["search"])
        self.exchange_var.set(defaults["exchange"])
        self.symbol_var.set(defaults["symbol"])
        self.interval_var.set(defaults["interval"])
        self.n_bars_var.set(defaults["bars"])
        self.output_var.set(defaults["output"])
        self.username_var.set(defaults["username"])
        self.password_var.set(defaults["password"])
        self.selected_base_symbol = defaults["selected_base_symbol"]
        self.selected_source_exchange = defaults["selected_source_exchange"]
        self.selected_contract_symbol = defaults["selected_contract_symbol"]
        if self.selected_contract_symbol:
            self.contract_var.set(self.selected_contract_symbol)

        if self.interval_var.get() not in INTERVALS:
            self.interval_var.set("Daily")

    def _restore_previous_search(self) -> None:
        query = self.search_var.get().strip()
        if query:
            self._run_search()

    def _save_settings(self) -> None:
        self.save_after_id = None

        payload = {
            "search": self.search_var.get().strip(),
            "exchange": self.exchange_var.get().strip(),
            "symbol": self.symbol_var.get().strip(),
            "interval": self.interval_var.get().strip() or "Daily",
            "bars": self.n_bars_var.get().strip() or "5000",
            "output": self.output_var.get().strip(),
            "username": self.username_var.get().strip(),
            "password": self.password_var.get().strip(),
            "selected_base_symbol": self.selected_base_symbol,
            "selected_source_exchange": self.selected_source_exchange,
            "selected_contract_symbol": self.selected_contract_symbol,
        }

        try:
            with self.settings_path.open("w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
        except Exception:
            pass

    def _on_close(self) -> None:
        self._save_settings()
        self.destroy()

    def _browse_output(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Save CSV",
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
        )
        if path:
            self.output_var.set(path)

    def _on_search_key(self, _event=None) -> None:
        if self.search_after_id is not None:
            self.after_cancel(self.search_after_id)

        self.search_after_id = self.after(1000, self._run_search)

    def _run_search(self) -> None:
        query = self.search_var.get().strip()
        exchange = self.exchange_var.get().strip()

        if not query:
            self.results.delete(0, tk.END)
            self.latest_results = []
            self.status_var.set("Type a query to search TradingView symbols.")
            return

        self.search_token += 1
        token = self.search_token
        self.status_var.set(f"Searching for '{query}'...")

        def worker() -> None:
            try:
                tv = TvDatafeed()
                results = tv.search_symbol(query, exchange)
            except Exception as exc:
                self.after(0, lambda exc=exc: self._show_search_error(token, exc))
                return

            self.after(0, lambda results=results: self._show_search_results(token, query, results))

        threading.Thread(target=worker, daemon=True).start()

    def _show_search_error(self, token: int, exc: Exception) -> None:
        if token != self.search_token:
            return
        self.status_var.set(f"Search failed: {exc}")

    def _format_result(self, item: dict) -> str:
        symbol = item.get("symbol", "")
        exchange = item.get("exchange", "")
        description = item.get("description") or item.get("name") or item.get("shortname") or ""
        parts = [part for part in [symbol, exchange, description] if part]
        return " | ".join(parts) if parts else str(item)

    def _display_name(self, item: dict) -> str:
        return item.get("shortname") or item.get("description") or item.get("name") or ""

    def _tooltip_text(self, item: dict) -> str:
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

    def _normalize_contract_symbol(self, symbol: str) -> str:
        return symbol.strip()

    def _contract_options_from_item(self, item: dict) -> list[str]:
        contracts = item.get("contracts") or []
        options: list[str] = []
        for contract in contracts:
            symbol = contract.get("symbol")
            if symbol:
                options.append(self._normalize_contract_symbol(symbol))

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

    def _refresh_contract_dropdown(self, item: dict) -> None:
        options = self._contract_options_from_item(item)
        self.contract_box["values"] = options

        if not options:
            self.contract_var.set("")
            self.selected_contract_symbol = ""
            return

        preferred = self.selected_contract_symbol if self.selected_contract_symbol in options else None
        if preferred is None:
            preferred = next((opt for opt in options if opt.endswith("1!")), options[0])

        self.contract_var.set(preferred)
        self.selected_contract_symbol = preferred
        try:
            download_symbol, download_exchange, fut_contract = self._resolve_download_symbol()
            resolved = f"Resolved: {download_exchange}:{download_symbol}"
            if fut_contract is not None:
                resolved += f" (fut_contract={fut_contract})"
            self.resolved_var.set(resolved)
        except Exception:
            self.resolved_var.set("Select a valid contract to resolve the download symbol.")

    def _resolve_download_symbol(self) -> tuple[str, str, int | None]:
        base_symbol = self.selected_base_symbol.strip() or self.symbol_var.get().strip()
        contract_symbol = self.contract_var.get().strip()
        exchange = self.selected_source_exchange.strip()

        if not contract_symbol:
            raise ValueError("Select a futures contract first")

        if base_symbol and contract_symbol.startswith(base_symbol) and contract_symbol.endswith("!"):
            match = re.fullmatch(rf"{re.escape(base_symbol)}(\d+)!", contract_symbol)
            if match:
                return base_symbol, exchange, int(match.group(1))

        return contract_symbol, exchange, None

    def _show_search_results(self, token: int, query: str, results: list[dict]) -> None:
        if token != self.search_token:
            return

        self.latest_results = results or []
        self.selected_row_id = None
        self.selected_base_symbol = ""
        self.selected_source_exchange = ""
        self.selected_contract_symbol = ""
        self.exchange_var.set("")
        self.contract_box["values"] = []
        self.contract_var.set("")
        self.results.selection_remove(self.results.selection())
        for item in self.results.get_children():
            self.results.delete(item)

        for index, item in enumerate(self.latest_results[:100]):
            self.results.insert(
                "",
                tk.END,
                iid=str(index),
                values=(
                    item.get("symbol", ""),
                    self._display_name(item),
                    item.get("exchange", ""),
                ),
            )

        count = len(self.latest_results)
        self.status_var.set(f"Found {count} suggestions for '{query}'.")

        self._restore_previous_selection()

    def _restore_previous_selection(self) -> None:
        if not self.selected_base_symbol:
            return

        target_exchange = self.selected_source_exchange.strip()
        target_contract = self.selected_contract_symbol.strip()

        for index, item in enumerate(self.latest_results):
            if item.get("symbol", "") != self.selected_base_symbol:
                continue

            item_exchange = item.get("source_id") or item.get("source2", {}).get("id") or item.get("exchange", "")
            if target_exchange and item_exchange != target_exchange:
                continue

            self.results.selection_set(str(index))
            self.results.see(str(index))
            self.selected_row_id = str(index)
            self.selected_base_symbol = item.get("symbol", "")
            self.selected_source_exchange = item_exchange
            self.exchange_var.set(item_exchange)
            self._refresh_contract_dropdown(item)

            if target_contract and target_contract in self.contract_box["values"]:
                self.contract_var.set(target_contract)
                self.selected_contract_symbol = target_contract
                self._save_settings()
            return

    def _on_result_select(self, _event=None) -> None:
        selection = self.results.selection()
        if not selection:
            return

        self.selected_row_id = selection[0]
        item = self.latest_results[int(selection[0])]
        self.selected_base_symbol = item.get("symbol", "")
        self.symbol_var.set(self.selected_base_symbol)
        self.selected_source_exchange = item.get("source_id") or item.get("source2", {}).get("id") or item.get("exchange", "")
        self.exchange_var.set(self.selected_source_exchange)
        self._refresh_contract_dropdown(item)
        self.status_var.set(f"Selected {self._format_result(item)}")

    def _get_hover_item(self, event) -> tuple[str | None, dict | None]:
        item_id = self.results.identify_row(event.y)
        if not item_id:
            return None, None

        try:
            item = self.latest_results[int(item_id)]
        except (ValueError, IndexError):
            return None, None

        return item_id, item

    def _on_result_motion(self, event) -> None:
        item_id, item = self._get_hover_item(event)
        column = self.results.identify_column(event.x)

        if item_id is None or item is None:
            self._hide_tooltip()
            return

        if column != "#2":
            self._hide_tooltip()
            return

        description = self._tooltip_text(item)
        if not description:
            self._hide_tooltip()
            return

        if self.hover_item_id == item_id and self.tooltip is not None:
            return

        self.hover_item_id = item_id

        if self.tooltip_after_id is not None:
            self.after_cancel(self.tooltip_after_id)

        self.tooltip_after_id = self.after(250, lambda: self._show_tooltip(event.x_root, event.y_root, description))

    def _show_tooltip(self, x: int, y: int, text: str) -> None:
        self._hide_tooltip()

        self.tooltip = tk.Toplevel(self)
        self.tooltip.wm_overrideredirect(True)
        self.tooltip.wm_geometry(f"+{x + 16}+{y + 16}")

        label = tk.Label(
            self.tooltip,
            text=text,
            background="#ffffe0",
            relief="solid",
            borderwidth=1,
            padx=8,
            pady=4,
            justify="left",
            wraplength=420,
        )
        label.pack()

    def _hide_tooltip(self, _event=None) -> None:
        if self.tooltip_after_id is not None:
            try:
                self.after_cancel(self.tooltip_after_id)
            except Exception:
                pass
            self.tooltip_after_id = None

        self.hover_item_id = None

        if self.tooltip is not None:
            self.tooltip.destroy()
            self.tooltip = None

    def _start_download(self) -> None:
        symbol = self.symbol_var.get().strip()
        output = self.output_var.get().strip()
        interval_label = self.interval_var.get().strip()

        if not symbol:
            messagebox.showerror("Missing symbol", "Select a symbol before downloading.")
            return
        if not interval_label:
            messagebox.showerror("Missing interval", "Select an interval before downloading.")
            return
        if not output:
            messagebox.showerror("Missing output", "Choose an output CSV path.")
            return
        if not self.selected_row_id:
            messagebox.showerror("Missing selection", "Click a suggestion row before downloading.")
            return
        if not self.selected_source_exchange.strip():
            messagebox.showerror("Missing exchange", "Selected row did not provide a TradingView exchange.")
            return

        try:
            n_bars = int(self.n_bars_var.get().strip()) if self.n_bars_var.get().strip() else 5000
        except ValueError:
            messagebox.showerror("Invalid bars", "Bars must be an integer.")
            return

        interval = INTERVALS[interval_label]
        username = self.username_var.get().strip() or None
        password = self.password_var.get().strip() or None
        self.selected_contract_symbol = self.contract_var.get().strip()

        try:
            download_symbol, download_exchange, fut_contract = self._resolve_download_symbol()
            resolved = f"Resolved: {download_exchange}:{download_symbol}"
            if fut_contract is not None:
                resolved += f" (fut_contract={fut_contract})"
            self.resolved_var.set(resolved)
        except Exception as exc:
            messagebox.showerror("Invalid contract", str(exc))
            return

        output_path = self._build_output_path(Path(output), symbol, self.selected_contract_symbol or self.contract_var.get().strip())

        self.status_var.set("Downloading data...")

        def worker() -> None:
            try:
                tv = TvDatafeed(username, password)
                data = tv.get_hist(
                    symbol=download_symbol,
                    exchange=download_exchange,
                    interval=interval,
                    n_bars=n_bars,
                    fut_contract=fut_contract,
                )
                if data is None or data.empty:
                    raise RuntimeError(f"No data returned for {download_exchange}:{download_symbol}")

                out_path = output_path
                out_path.parent.mkdir(parents=True, exist_ok=True)
                frame = data.reset_index().rename(columns={"index": "datetime"})
                if frame.columns[0] != "datetime":
                    frame = frame.rename(columns={frame.columns[0]: "datetime"})
                frame.to_csv(out_path, index=False)

                self.after(0, lambda out_path=out_path, rows=len(frame): self._download_done(out_path, rows))
            except Exception as exc:
                self.after(0, lambda exc=exc: self._download_failed(exc))

        threading.Thread(target=worker, daemon=True).start()

    def _download_done(self, path: Path, rows: int) -> None:
        self.status_var.set(f"Saved {rows} rows to {path}")
        messagebox.showinfo("Download complete", f"Saved {rows} rows to:\n{path}")

    def _download_failed(self, exc: Exception) -> None:
        self.status_var.set(f"Download failed: {exc}")
        messagebox.showerror("Download failed", str(exc))

    def _build_output_path(self, base_path: Path, symbol: str, contract_symbol: str = "") -> Path:
        if base_path.suffix.lower() == ".csv":
            folder = base_path.parent
        else:
            folder = base_path

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        name = contract_symbol or symbol
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or symbol
        filename = f"{safe_name}_{timestamp}.csv"
        return folder / filename


def main() -> None:
    app = DownloaderApp()
    app.mainloop()


if __name__ == "__main__":
    main()
