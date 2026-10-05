# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **mod** (hot-reloaded plugin, not an app): a `/vn-heatmap` pane showing a live Vietnam stock-market treemap, a watchlist and a portfolio. Must live at `~/.claude/mods/vn-stockmarket-heatmap`: state is written to `../../state/` relative to the mod root. There is no build step; `hooks/hooks.json` loads `./index.tsx` directly. Load the `plugin-authoring` skill before changing mod APIs.

## Commands

```bash
bun tests/watch.check.ts   # self-check for hooks/watch.ts (parse/apply/suggest/rowsOf); also hits live SSI
```

`tests/watch.test.tsx` uses `claude-code/testing` (`$.ui.mount`) and runs inside Claude Code's mod test harness, not plain bun. No linter is configured. Type-check config extends `.claude-plugin/types/tsconfig.json`; the `claude-code` host types live in `.claude-plugin/types/` (hand-maintained stubs).

## Architecture

- `hooks/index.tsx` (the bulk): `register` hook, host `$` API (`$.http.fetch`, `$.fs`, `$.command`), module-level `atom`s for state (`tab`, `view`, `lists`, `wrows`, `zoom`, ...), polling loops, and the Pane UI.
- `hooks/watch.ts`: pure, testable logic with no host dependency. Maps SSI records to rows (`toRow`), unwraps the `{code,message,data}` envelope (`rowsOf`), ticker suggest, and the input grammar (`parse`/`apply`: `FPT` add, `-FPT` remove, `FPT 1000 62.4` sets qty and cost on the portfolio tab). Put new non-UI logic here so `tests/watch.check.ts` can cover it.
- `hooks/svgmap.ts`: pixel treemap as an SVG string; `index.tsx` render branches on `e.surface === 'desktop'` (Svg treemap + width-boxed tables) vs the terminal cell grid.
- `hooks/treemap.ts`: squarified layout (`squarify`) and terminal cell rendering for the heatmap grid.
- `hooks/types.d.ts`: shared types (`Tab = vn30 | watch | port`, `View = sector | exchange`).

Data source is **SSI iBoard** public REST (`iboard-query.ssi.com.vn` for quotes by group or multi-symbol, `iboard-api.ssi.com.vn/statistics` for sector map and history). Contract and traps are in `docs/ssi-iboard-api.md`. Polling is 3 s; a push feed exists (MQTT+protobuf) but mods cannot open WebSockets.

## Gotchas

- Watchlist/portfolio persist to `~/.claude/state/vn-heatmap.json`, deliberately **outside** the mod dir: writing inside it triggers a hot reload. Errors log to `state/vn-heatmap.err.log`. Market-cap shares cache in a separate file under the same state dir.
- `matchedPrice` is 0 before the first match; `toRow` falls back to expected (ATO/ATC) then reference price. Prices are raw VND; portfolio cost is entered in thousand VND.
- `/stock/multiple` is capped at 200 symbols (`MAX`).
- Atom keys are namespaced `{ plugin: 'vn-stockmarket-heatmap', key }`; keep the plugin id identical to `.claude-plugin/plugin.json`.
