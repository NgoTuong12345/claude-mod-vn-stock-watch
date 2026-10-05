# finance.vietstock.vn API contract (market heatmap)
- verified: 2026-10-05 (clean-shell replay, `heatmap_poll.py`, pre-market 08:49 VN)
- archetype: single-call (+ SignalR push alternative)
- tier: session-carried (load-bearing: `__RequestVerificationToken` form field + matching anti-forgery cookie, both from one GET of `/ban-do-thi-truong`; no login). Also needs `X-Requested-With: XMLHttpRequest`.
- endpoint: POST https://finance.vietstock.vn/data/GetStockByGICS  (form-urlencoded)
- request: full `filter[...]` set (see `FORM` in heatmap_poll.py; omitting range filters => 302 /Error), `catID=0&industryCode=0&level=1&capitalID=0&languageID=1`. Narrow via `filter[exchangeId]` (HOSE/HNX/UPCOM ids), `filter[sectorId]`, `filter[capitalId]`.
- response: `{"data":[...]}`, UTF-8 **BOM** (decode `utf-8-sig`). Key `_sc_` (ticker). Fields: `_cp_` close, `_bp_` ref, `_clp_` ceiling, `_fp_` floor, `_pc_` % change, `_tvol_`/`_tval_` volume/value, `_vhtt_` mkt cap, `_in_` sector, `catID` exchange, foreign/prop-desk buy/sell fields.
- count: 1546 — cross-check: len(rows)==len(unique `_sc_`); no declared total in payload.
- real-time options:
  1. Poll every 15s (what the site does as fallback). Implemented: `python heatmap_poll.py 15 N`.
  2. Push: SignalR msgpack WS `wss://st-api.vietstock.vn/FinanceHomeHUB` (skipNegotiation, `withCredentials`; `POST /Account/GetAuthToken` first sets auth cookie). Invoke `BroadcastStockHeatmap(languageId)`, listen `StockHeatmapRealtime`; payload zstd-compressed JSON (fzstd) — decode then `JSON.parse`. NOT replay-verified here (hub name for heatmap page + handshake unconfirmed; `FinanceHomeHUB` is from home bundle).
- unverified: live-change detection (market was closed at test: 0 diffs). Re-run during 09:00-15:00 VN.
- traps: json-bom, range-filters-required (302 /Error on missing fields)
