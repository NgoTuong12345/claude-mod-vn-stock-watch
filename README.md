# VN Stock Heatmap — Claude Code mod

Live Vietnam stock-market heatmap (SSI iBoard data) in a Claude Code pane, with watchlist and portfolio.

## Layout

```
.claude-plugin/plugin.json   plugin manifest
hooks/                       mod source (index.tsx, treemap.ts, watch.ts, types.d.ts, hooks.json)
tests/                       self-checks (watch.check.ts, watch.test.tsx)
docs/api/                    data-source API notes (ssi-iboard.md = used by mod, vietstock.md = research)
tools/                       heatmap_poll.py (standalone Vietstock polling script, research)
```

## Install

```bash
git clone https://github.com/NgoTuong12345/vn-stock-heatmap-claude-mod.git ~/.claude/mods/vn-stockmarket-heatmap
```

Restart Claude Code (or hot-reload) to load the mod.

## Test

```bash
bun tests/watch.check.ts
```

## License

MIT
