# TradingView WebSocket Protocol Analysis: B-ADJ and Adjustments

This document outlines the inner workings of TradingView's WebSocket protocol regarding chart adjustments. It details how the web client communicates with the server when analyzing continuous futures contracts (like `ES1!`), handling back-adjustments (B-ADJ), and dividend/split adjustments (ADJ).

## 1. Core Concepts

TradingView's WebSocket protocol is heavily optimized, stringing massive payloads together separated by a signature delimiter `~m~[Frame Length]~m~`. 

The architecture strictly splits data delivery into two parallel stream types:
* **Chart Sessions (`cs_...`)**: Handles loading historical OHLCV candle data (`resolve_symbol`, `timescale_update`).
* **Quote Sessions (`qs_...`)**: Handles subscribing to high-speed, real-time tick updates for the Legend, Y-axis labels, and Watchlist (`quote_fast_symbols`, `qsd`).

---

## 2. Toggle Behavior: Data Requests

When you press the **B-ADJ** (Back-Adjustment) button on the bottom of a chart, the web UI completely alters the structure of the JSON payload it sends to the server.

### A. The `resolve_symbol` Request (Chart Data)
This request physically forces the server to swap out your active chart's historical candles.

* **When B-ADJ is ON:** TradingView wraps the symbol identifier in a complex JSON string prefixed by `=`. It prominently passes `"backadjustment":"default"` to ask the server to mathematically smooth out roll gaps.
  ```json
  {"m":"resolve_symbol", "p":["cs_WfJmeH9kKLeI", "sds_sym_5", "={\"adjustment\":\"splits\",\"backadjustment\":\"default\",\"settlement-as-close\":false,\"symbol\":\"CME_MINI:ES1!\"}"]}
  ```

* **When B-ADJ is OFF:** TradingView deletes the JSON wrapping entirely. It simply falls back to the naked symbol identifier strings, meaning raw continuous futures data with massive unadjusted roll gaps will stream instead.
  ```json
  {"m":"resolve_symbol", "p":["cs_mUroWzurO3m4", "ss_5", "CME_MINI:ES1!"]}
  ```

### B. The `quote_fast_symbols` Request (Live Ticks)
Because the blinking price on your chart legend must visually match the adjusted OHLCV data on your chart, the Quote Session must also be updated.

* **When B-ADJ is ON:**
  ```json
  {"m":"quote_fast_symbols", "p":["qs_multiplexer_full_KZ", "CME_MINI:ES1!", "={\"adjustment\":\"splits\",\"backadjustment\":\"default\",\"currency-id\":\"USD\",\"settlement-as-close\":false,\"symbol\":\"CME_MINI_DL:ES1!\"}"]}
  ```

* **When B-ADJ is OFF:** Unlike `resolve_symbol` which drops the JSON entirely, `quote_fast_symbols` preserves the JSON structure but actively deletes the `"backadjustment":"default"` key to un-adjust the live feed!
  ```json
  {"m":"quote_fast_symbols", "p":["qs_multiplexer_full_KZ", "CME_MINI:ES1!", "={\"adjustment\":\"splits\",\"currency-id\":\"USD\",\"settlement-as-close\":false,\"symbol\":\"CME_MINI_DL:ES1!\"}"]}
  ```

*(Note that `CME_MINI_DL:ES1!` represents the 10-minute delayed feed fallback that TradingView automatically subscribes to alongside the primary request).*

---

## 3. UI Display Logic: How the Button Appears

TradingView's web interface does not hardcode which symbols get the B-ADJ or ADJ buttons. It is entirely driven dynamically by a massive configuration packet called `symbol_resolved`.

When you request a fresh symbol, the server's response (`↓`) contains this `symbol_resolved` JSON block. The UI parses three specific keys to toggle features:

### Combination 1: Continuous Futures (`ES1!`, `NQ1!`)
Futures contracts roll over, causing gaps, but they do not pay corporate dividends.
* `"has_backadjustment": true` *(Force shows the **B-ADJ** button)*
* `"allowed_adjustment": "none"`
* `"has_adjustment": false`

### Combination 2: Standard Stocks (`AAPL`, `TSLA`)
Stocks don't roll over, but they suffer massive artificial price drops after a stock split or dividend payout.
* `"has_backadjustment": false` *(or completely missing)*
* `"has_adjustment": true`
* `"allowed_adjustment": "splits"` *(Force shows the **ADJ** button)*

### Combination 3: Forex & Crypto (`EURUSD`, `BTCUSD`)
These assets trade continuously forever and have no complex corporate actions.
* `"has_backadjustment": false` *(or missing)*
* `"has_adjustment": false`
* `"allowed_adjustment": "none"`
*(Result: TradingView forcefully hides **both** buttons to prevent invalid API requests).*

---

## 4. Packing and Delivery Architecture

If you inspect a WebSocket trace, you will rarely see `symbol_resolved` sitting cleanly on its own row. To save bandwidth and reduce latency, TradingView aggregates massive amounts of data into a single string. 

When you initially load a chart, a single DOWN (`↓`) packet might look like:
`~m~96~m~{"m":"series_loading"} ~m~3140~m~{"m":"symbol_resolved"} ~m~30718~m~{"m":"timescale_update"} ~m~800~m~{"m":"qsd"}`

*   **`symbol_resolved`**: Validates the symbol and unlocks the UI configuration (including B-ADJ).
*   **`timescale_update`**: Immediately follows it with hundreds of historical bars (OHLCV) delivered instantly as a giant matrix `[Time, Open, High, Low, Close, Volume]`.
*   **`qsd`**: Begins the real-time Quote Session live tick updates.
