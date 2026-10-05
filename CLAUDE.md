# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **mod** (hot-reloaded plugin, not an app): a `/vn-stock-watch` pane showing a live Vietnam stock-market treemap, a watchlist and a portfolio. Must live at `~/.claude/mods/vn-stockmarket-heatmap`: state is written to `../../state/` relative to the mod root. There is no build step; `hooks/hooks.json` loads `./index.tsx` directly. Runs on the terminal and the desktop Code tab (one pane, two renderers). Load the `plugin-authoring` skill before changing mod APIs. A running session does not hot-reload `~/.claude/mods/`: after an edit the user runs `/reload-plugins`, then `/vn-stock-watch`. Install and usage steps for people and coding agents are in `README.md`; keep it in step with behaviour changes.

## Commands

```bash
bun tests/watch.check.ts            # self-check for hooks/watch.ts (parse/apply/suggest/rowsOf); also hits live SSI
claude plugin validate .            # parses the module, checks hooks/state/types; run before telling the user to reload
```

`tests/watch.test.tsx` uses `claude-code/testing` (`$.ui.mount`) and runs inside Claude Code's mod test harness, not plain bun. No linter is configured. Type-check config extends `.claude-plugin/types/tsconfig.json`; the `claude-code` host types live in `.claude-plugin/types/` (hand-maintained stubs).

## Architecture

- `hooks/index.tsx` (the bulk): `register` hook, host `$` API (`$.http.fetch`, `$.fs`, `$.command`), module-level `atom`s for state (`tab`, `view`, `lists`, `wrows`, `zoom`, ...), polling loops, and the Pane UI.
- `hooks/watch.ts`: pure, testable logic with no host dependency. Maps SSI records to rows (`toRow`), unwraps the `{code,message,data}` envelope (`rowsOf`), ticker suggest, and the input grammar (`parse`/`apply`: `FPT` add, `-FPT` remove, `FPT 1000 62.4` sets qty and cost on the portfolio tab). Put new non-UI logic here so `tests/watch.check.ts` can cover it.
- `hooks/svgmap.ts`: pixel treemap + zoomable table as SVG strings. `index.tsx` render branches on `e.surface === 'desktop'` (Svg treemap/tables, map-size slider of Buttons, text-size slider (`tzoom`, 1px steps); no pointer drag: Client pointer events never reach the plugin on desktop) vs the terminal cell grid. Keep shared features (watchlist remove buttons, titles) in both branches.
- `hooks/treemap.ts`: squarified layout (`squarify`) and terminal cell rendering for the heatmap grid.
- `hooks/types.d.ts`: shared types (`Tab = vn30 | watch | port`, `View = sector | exchange`) and the `PluginState` contract: add every new `atom` key here or validate fails.

Data source is **SSI iBoard** public REST (`iboard-query.ssi.com.vn` for quotes by group or multi-symbol, `iboard-api.ssi.com.vn/statistics` for sector map and history). Contract and traps are in `docs/ssi-iboard-api.md`. Polling: the treemap every 15 s (`OPEN_MS`, ~2 MB per poll; 8x slower while the market is closed), the VN30/watchlist table every 3 s (`WATCH_MS`). A push feed exists (MQTT+protobuf) but mods cannot open WebSockets.

## Gotchas

- Watchlist/portfolio persist to `~/.claude/state/vn-heatmap.json`, deliberately **outside** the mod dir: writing inside it triggers a hot reload. Errors log to `state/vn-heatmap.err.log`. Market-cap shares cache in a separate file under the same state dir.
- `matchedPrice` is 0 before the first match; `toRow` falls back to expected (ATO/ATC) then reference price. Prices are raw VND; portfolio cost is entered in thousand VND.
- `/stock/multiple` is capped at 200 symbols (`MAX`).
- Desktop limits (verified): Text has no font size, so zoomable tables are SVG (`tableSvg`); `Svg` source is capped at 131072 chars, `buildSvg` raises the smallest drawn tile until it fits (exceeding it makes the pane draw "Nothing to show yet"); `Client` modules never receive pointer events on desktop, so there is no drag (map size is a slider of `Button`s). Buttons cannot sit inside an SVG row, hence the separate Remove row.
- `ui.render` runs for both surfaces: do not branch on terminal-only props (`bodyColumns`, `scroll`) without a desktop fallback. The desktop branch returns early from the render hook; the terminal tree follows it.
- Atom keys are namespaced `{ plugin: 'vn-stockmarket-heatmap', key }`; keep the plugin id identical to `.claude-plugin/plugin.json`.
