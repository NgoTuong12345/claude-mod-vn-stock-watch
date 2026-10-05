import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Idx, Lists, Meta, Quote, Tab, View, WRow } from './types'
import { buildGrid, runs, ZOOMS } from './treemap'
import { buildSvg, tableSvg, TABLE_FS } from './svgmap'
import type { TRow } from './svgmap'
import type { Group } from './treemap'
import { apply, EXCHANGE, HEADERS, MAX, parse, rowsOf, sectorsOf, SSI, STATS, suggest, toQuote, toRow, toTicker } from './watch'
import type { Ticker } from './watch'

const PANE = 'vn-heatmap'
const OPEN_MS = 15_000 // 3 exchange snapshots (~2 MB) per poll; don't go much lower
const CLOSED_EVERY = 8 // ticks per real fetch while the market is closed (~2 min)

const quotes = atom({ plugin: 'vn-stockmarket-heatmap', key: 'quotes' } as const, [] as Quote[])
const meta = atom({ plugin: 'vn-stockmarket-heatmap', key: 'meta' } as const, { at: 0, status: 'idle', n: 0 } as Meta)
const only = atom({ plugin: 'vn-stockmarket-heatmap', key: 'only' } as const, '')
const idx = atom({ plugin: 'vn-stockmarket-heatmap', key: 'idx' } as const, [] as Idx[])
const view = atom({ plugin: 'vn-stockmarket-heatmap', key: 'view' } as const, 'sector' as View)
const tab = atom({ plugin: 'vn-stockmarket-heatmap', key: 'tab' } as const, 'vn30' as Tab)
const lists = atom({ plugin: 'vn-stockmarket-heatmap', key: 'lists' } as const, { watch: [], port: {} } as Lists)
const wrows = atom({ plugin: 'vn-stockmarket-heatmap', key: 'wrows' } as const, [] as WRow[])
const wlrows = atom({ plugin: 'vn-stockmarket-heatmap', key: 'wlrows' } as const, [] as WRow[])
const wmeta = atom({ plugin: 'vn-stockmarket-heatmap', key: 'wmeta' } as const, { at: 0, status: 'idle', n: 0 } as Meta)
const zoom = atom({ plugin: 'vn-stockmarket-heatmap', key: 'zoom' } as const, 0)
const wq = atom({ plugin: 'vn-stockmarket-heatmap', key: 'wq' } as const, '')
const mapadj = atom({ plugin: 'vn-stockmarket-heatmap', key: 'mapadj' } as const, 0)
const tzoom = atom({ plugin: 'vn-stockmarket-heatmap', key: 'tzoom' } as const, 1)
const wmsg = atom({ plugin: 'vn-stockmarket-heatmap', key: 'wmsg' } as const, '')

const WATCH_MS = 3_000
const SL_N = 28 // map-size slider: segments, the auto-size one, px per segment
const SL_AUTO = 8
const SL_STEP = 40
// Outside the mod dir so a save never hot-reloads the module: ~/.claude/state/vn-heatmap.json
// ~/.claude/state, whether loaded from ~/.claude/mods/<name> or installed under ~/.claude/plugins/cache/...
const stateDir = ($: any) => {
  const r = String($.plugin.root).split(String.fromCharCode(92)).join('/')
  const i = r.indexOf('/plugins/')
  return i >= 0 ? `${r.slice(0, i)}/state` : `${r}/../../state`
}
const listsFile = ($: any) => `${stateDir($)}/vn-heatmap.json`
let universe: Ticker[] = [] // ~2k rows; module-level, not an atom
let wtick = 0

const ssi = async ($: any, path: string, init?: any) => {
  const r = await $.http.fetch(`${SSI}${path}`, { ...init, headers: { ...HEADERS, ...init?.headers } })
  return rowsOf(r.status, r.ok, r.text)
}
const fetchGroup = async ($: any, g: string) => (await ssi($, `/stock/group/${g}`)).map(toRow)
const fetchMany = async ($: any, syms: string[]) =>
  syms.length
    ? (await ssi($, '/stock/multiple', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stocks: syms.slice(0, MAX) }),
      })).map(toRow)
    : []
// 1M / 3M / YTD return vs daily closes (iboard-api chart history, close in thousand VND). Cached 30 min per symbol.
const retCache = new Map<string, { at: number; v: WRow['rt'] }>()
const getRets = async ($: any, sym: string, price: number): Promise<WRow['rt']> => {
  let e = retCache.get(sym)
  if (!e || Date.now() - e.at > 1_800_000) {
    const y = new Date().getUTCFullYear()
    const from = Math.floor(Date.UTC(y - 1, 11, 1) / 1000)
    const to = Math.floor(Date.now() / 1000) + 86_400
    const r = await $.http.fetch(`https://iboard-api.ssi.com.vn/statistics/charts/history?resolution=1D&symbol=${sym}&from=${from}&to=${to}`, { headers: HEADERS })
    const d = JSON.parse(r.text).data as { t: number[]; c: number[] }
    const at = (ts: number) => { let b: number | undefined; for (let i = 0; i < d.t.length; i++) if (d.t[i]! <= ts) b = d.c[i]; return b } // last close on/before ts
    const m = (n: number) => { const o = new Date(); o.setUTCMonth(o.getUTCMonth() - n); return Math.floor(o.getTime() / 1000) }
    e = { at: Date.now(), v: { m1: at(m(1)) ?? 0, m3: at(m(3)) ?? 0, y: at(Math.floor(Date.UTC(y, 0, 1) / 1000) - 1) ?? 0 } }
    retCache.set(sym, e)
  }
  const b = e.v!
  const f = (base: number) => (base ? (price / 1000 / base - 1) * 100 : null)
  return { m1: f(b.m1!), m3: f(b.m3!), y: f(b.y!) }
}
const fetchUniverse = async ($: any) => (await ssi($, '/stock/stock-info')).map(toTicker)

const refreshWatch = async ($: any) => {
  try {
    const t = await read($, tab)
    const l = await read($, lists)
    const r = t === 'vn30' ? await fetchGroup($, 'VN30') : await fetchMany($, t === 'watch' ? l.watch : Object.keys(l.port))
    if (t === 'port') await Promise.all(r.map(async x => { x.rt = await getRets($, x.s, x.p).catch(() => undefined) }))
    const order = t === 'vn30' ? [] : t === 'watch' ? l.watch : Object.keys(l.port)
    if (order.length) r.sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s))
    else r.sort((a, b) => a.s.localeCompare(b.s))
    if ((await read($, tab)) !== t) return // tab switched mid-flight
    const prev = new Map((await read($, wrows)).map(x => [x.s, x.p]))
    for (const x of r) { const o = prev.get(x.s); x.fl = o && o !== x.p ? (x.p > o ? 1 : -1) : 0 } // flash until next poll
    await update($, wrows, () => r)
    const wl = l.watch.length ? await fetchMany($, l.watch) : []
    wl.sort((a, b) => l.watch.indexOf(a.s) - l.watch.indexOf(b.s))
    await Promise.all(wl.map(async x => { x.rt = await getRets($, x.s, x.p).catch(() => undefined) }))
    const pw = new Map((await read($, wlrows)).map(x => [x.s, x.p]))
    for (const x of wl) { const o = pw.get(x.s); x.fl = o && o !== x.p ? (x.p > o ? 1 : -1) : 0 }
    await update($, wlrows, () => wl)
    await update($, wmeta, () => ({ at: Date.now(), status: 'live', n: r.length }))
  } catch (err) {
    await update($, wmeta, m => ({ ...m, status: `SSI error: ${String((err as Error).message ?? err).slice(0, 50)}` }))
  }
}

const setTab = async ($: any, t: Tab) => {
  await update($, tab, () => t)
  await update($, wrows, () => [])
  void refreshWatch($)
}

const submit = async ($: any, text: string) => {
  const t = await read($, tab)
  const port = t === 'port'
  if (!universe.length) universe = await fetchUniverse($).catch(() => [])
  const known = new Set(universe.map(x => x.code))
  const first = suggest(universe, text)[0]?.code
  const typed = text.trim().toUpperCase()
  // Enter on a partial code takes the top suggestion ("FP" -> FPT), keeping any qty/cost after it.
  const head = typed.split(/\s+/)[0] ?? ''
  const fixed = !head.startsWith('-') && !known.has(head) && first ? typed.replace(head, first) : typed
  const cmd = parse(fixed, s => known.has(s), port)
  if (cmd.op === 'bad') return update($, wmsg, () => cmd.why)
  const next = apply(await read($, lists), cmd, port)
  await update($, lists, () => next)
  const saved = await $.fs.write(listsFile($), JSON.stringify(next, null, 1)).then(() => '', (err: Error) => ` (save failed: ${String(err?.message ?? err).slice(0, 40)})`)
  await update($, wq, () => '')
  await update($, wmsg, () => `${cmd.op === 'del' ? 'removed' : 'added'} ${cmd.s}${port ? ' (portfolio)' : t === 'vn30' ? ' to watchlist' : ''}${saved}`)
  void refreshWatch($)
}

const k1 = (v: number) => (v / 1000).toFixed(2)
const sgn = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const vol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v))
const money = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(1)}M`)
const tone = (r: WRow) => (r.k === 'c' ? '#9B59D0' : r.k === 'f' ? '#17A2B8' : r.ch > 0 ? '#2FA55A' : r.ch < 0 ? '#C0392B' : '#C9A227')

const IDX: [string, string][] = [['VNINDEX', 'VN-Index'], ['HNXIndex', 'HNX-Index'], ['HNXUpcomIndex', 'UPCOM-Index']]
const DAY = 86_400_000
// Outside the mod dir (no hot reload on save): listed shares per symbol, refreshed weekly.
const capsFile = ($: any) => `${stateDir($)}/vn-heatmap-shares.json`
let sector = new Map<string, string>()
let sectorAt = 0
let shares: Record<string, number> = {}
let sharesAt = -1 // -1 = cache file not read yet
let filling = false
let capsHave = 0
let capsOf = 0
let isOpen = false
let tick = 0
let gridTop = 0 // treemap rows in the pane tree, set by the last render; the wheel zooms over them
let gridLen = 0
let scrollOff = 0
const refetchAll = () => sharesAt > 0 && Date.now() - sharesAt > 7 * DAY

const ssiGet = async ($: any, url: string) => {
  const r = await $.http.fetch(url, { headers: HEADERS })
  if (r.status === 429) throw new Error('SSI 429')
  if (!r.ok) throw new Error(`SSI ${r.status}`)
  return JSON.parse(r.text).data
}

const pullIdx = async ($: any): Promise<Idx[]> =>
  Promise.all(IDX.map(async ([id, name]) => {
    const d = await ssiGet($, `${SSI}/exchange-index/${id}`)
    return { name, price: d.indexValue, change: d.change, pct: d.changePercent }
  }))

// No bulk share-count endpoint. /stock/{sym}.listedShare is 0 for VCB/HPG/VIC/ACB, so use SSMI
// finance-indicator sharesOutstanding (per symbol; SSI 429s past ~2 req/s, so one at a time).
// ponytail: ~1.5k symbols x ~0.75s = ~20 min first fill; tiles appear as caps land (biggest traders first).
const fillShares = async ($: any, syms: string[]) => {
  if (filling) return
  filling = true
  try {
    const all = refetchAll()
    const todo = all ? syms : syms.filter(s => !(s in shares))
    for (let i = 0; i < todo.length; i++) {
      try {
        const d = await ssiGet($, `${STATS}/company/ssmi/finance-indicator?symbol=${todo[i]}`)
        if (!Array.isArray(d)) throw new Error('SSI bad body') // retry, don't cache
        const n = Number(d[0]?.sharesOutstanding) // newest report first
        shares[todo[i]!] = n > 0 ? n : 0 // 0 = no report (no tile, not retried until weekly refresh)
      } catch {
        await $.clock.sleep(30_000) // 429, throttle body or network: back off, retry same symbol
        i--
        continue
      }
      await $.clock.sleep(400)
      if (i % 50 === 49) await $.fs.write(capsFile($), JSON.stringify({ at: sharesAt, shares })).catch(() => {})
    }
    if (all || !sharesAt) sharesAt = Date.now()
    await $.fs.write(capsFile($), JSON.stringify({ at: sharesAt, shares })).catch(() => {})
  } finally {
    filling = false
  }
}

const pull = async ($: any): Promise<Quote[]> => {
  if (sharesAt < 0) {
    sharesAt = 0
    try { ({ at: sharesAt, shares } = JSON.parse(await $.fs.read(capsFile($)))) } catch {} // first run: no file yet
  }
  if (Date.now() - sectorAt > DAY) {
    sector = sectorsOf(await $.http.fetch(`${STATS}/company/sectors-data`, { headers: HEADERS }).then((r: any) => JSON.parse(r.text).data))
    sectorAt = Date.now()
  }
  const raw = (await Promise.all(['hose', 'hnx', 'upcom'].map(e => ssiGet($, `${SSI}/stock/type/s/${e}`)))).flat() as any[]
  const syms = [...raw].sort((a, b) => (b.nmTotalTradedValue ?? 0) - (a.nmTotalTradedValue ?? 0)).map(x => x.stockSymbol as string)
  if (refetchAll() || syms.some(s => !(s in shares))) void fillShares($, syms)
  capsHave = syms.filter(s => s in shares).length
  capsOf = syms.length
  return raw.map(x => toQuote(x, sector, shares)).filter((x): x is Quote => !!x).sort((a, b) => b.m - a.m)
}

// VN market hours: Mon-Fri 09:00-15:00 (UTC+7)
const isMarketOpen = () => {
  const t = new Date(Date.now() + 7 * 3600_000)
  const d = t.getUTCDay()
  const h = t.getUTCHours() + t.getUTCMinutes() / 60
  return d >= 1 && d <= 5 && h >= 9 && h < 15.1
}
// Status label from the exchange schedule (HOSE: ATO 9:00-9:15, ATC 14:30-14:45, put-through to 15:00; UPCOM trades to 15:00)
const session = (): { t: string; c: string } => {
  const x = new Date(Date.now() + 7 * 3600_000)
  const d = x.getUTCDay()
  const h = x.getUTCHours() + x.getUTCMinutes() / 60
  const G = '#2ECC71', A = '#F5B041', R = '#FF5A4D'
  if (d < 1 || d > 5) return { t: 'Closed', c: R }
  if (h >= 9 && h < 9.25) return { t: 'ATO', c: A }
  if (h >= 9.25 && h < 11.5) return { t: 'Open', c: G }
  if (h >= 11.5 && h < 13) return { t: 'Lunch break', c: R }
  if (h >= 13 && h < 14.5) return { t: 'Open', c: G }
  if (h >= 14.5 && h < 14.75) return { t: 'ATC', c: A }
  if (h >= 14.75 && h < 15) return { t: 'Post-close', c: A }
  return { t: 'Closed', c: R }
}

const refresh = async ($: any) => {
  try {
    const q = await pull($)
    await update($, quotes, () => q)
    await pullIdx($).then(ix => update($, idx, () => ix), () => {}) // indices are best-effort
    await update($, meta, () => ({ at: Date.now(), status: 'live', n: q.length }))
    const up = q.filter(x => x.p > 0).length
    const dn = q.filter(x => x.p < 0).length
    $.ui.status(`VN ▲${up} ■${q.length - up - dn} ▼${dn}`)
  } catch (err) {
    void $.fs.write(`${stateDir($)}/vn-heatmap.err.log`, `${new Date().toISOString()} ${String((err as Error)?.stack ?? err)}
`).catch(() => {})
    await update($, meta, m => ({ ...m, status: `error: ${String((err as Error).message ?? err).slice(0, 60)}` }))
  }
}

const COLOR = (x: Quote) => {
  if (x.k === 'c') return '#9B59D0'
  if (x.k === 'f') return '#17A2B8'
  if (x.p >= 3) return '#0E8A3E'
  if (x.p >= 1) return '#2FA55A'
  if (x.p > 0) return '#5BBE7F'
  if (x.p === 0) return '#C9A227'
  if (x.p > -1) return '#D9706B'
  if (x.p > -3) return '#C0392B'
  return '#8E1B12'
}
const fmt = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(1)}`
const wavg = (xs: Quote[]) => xs.reduce((a, x) => a + x.p * x.m, 0) / (xs.reduce((a, x) => a + x.m, 0) || 1)

let timersOn = false // module-level: session.start does not re-run after a hot reload, so start lazily
const startTimers = ($: any) => {
  if (timersOn) return
  timersOn = true
  $.clock.every(OPEN_MS, async () => {
    if (!isOpen) return
    tick++
    if (!isMarketOpen() && tick % CLOSED_EVERY !== 1) return
    await refresh($)
  })
  $.clock.every(WATCH_MS, async () => {
    if (!isOpen) return
    wtick++
    if (!isMarketOpen() && wtick % 40 !== 1) return // ~2 min while closed
    await refreshWatch($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'vn-heatmap', description: 'Live Vietnam stock-market heatmap pane' })
    try {
      const saved = JSON.parse(await $.fs.read(listsFile($))) as Lists
      if (Array.isArray(saved.watch) && saved.port) await update($, lists, () => saved)
    } catch {} // first run: no file yet
    return next(e)
  })

  on('command.run', { command: 'vn-heatmap' }, async $ => {
    isOpen = true
    startTimers($)
    tick = 0
    wtick = 0
    await $.ui.open({ id: PANE, title: 'VN heatmap' })
    void refresh($)
    void refreshWatch($)
    if (!universe.length) void fetchUniverse($).then(u => { universe = u }, () => {})
    return { text: 'VN heatmap opened (polls SSI iBoard every 15s while the market is open).' }
  })

  // Wheel over the treemap zooms (up = in: more tiles, tighter labels; down = out: fewer, bigger); elsewhere it scrolls as usual.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const r = e.pointer ? e.pointer.row + scrollOff - gridTop : -1
    if (e.origin.kind !== 'person' || !e.pointer || r < 0 || r >= gridLen) return next(e)
    await update($, zoom, z => Math.max(0, Math.min(ZOOMS.length - 1, z - Math.sign(e.by))))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (!isOpen) { // pane survived a /reload-plugins: module state reset, command.run not re-run
      isOpen = true
      startTimers($)
      void refresh($)
      void refreshWatch($)
    }
    try {
    const { Box, Text, Button, Input, Select, Svg } = $.ui.resolve(e) as any
    const desktop = e.surface === 'desktop'
    const q = await read($, quotes)
    const m = await read($, meta)
    const v = await read($, view)
    const sel = await read($, only)
    const z = await read($, zoom)
    const ix = await read($, idx)
    const cols = Math.max(30, (e.props as any)?.bodyColumns ?? e.viewport?.columns ?? 80)
    const rows = (e.viewport?.rows ?? 30) - 6

    const age = m.at ? Math.round((Date.now() - m.at) / 1000) : 0

    const sectors = [...new Set(q.map(x => x.g))].sort()
    const nextSector = () => update($, only, cur => sectors[(sectors.indexOf(cur) + 1) % (sectors.length + 1)] ?? '')
    const picked = sel ? sel.split('|') : []
    const pool = picked.length ? q.filter(y => picked.includes(y.g)) : q
    const by = new Map<string, Quote[]>()
    for (const x of pool) {
      const key = v === 'sector' ? x.g : EXCHANGE[x.x] || '?'
      by.set(key, [...(by.get(key) ?? []), x])
    }
    const groups: Group[] = [...by.entries()].map(([name, xs]) => {
      const avg = wavg(xs)
      const s = SHORT[name] ?? name.split(' ')[0] ?? name
      return {
        heads: [`${name} ${fmt(avg)}`, `${s} ${fmt(avg)}`, s, ...[TINY[name]].filter((x): x is string => !!x)],
        tone: avg >= 0 ? '#7CE0A0' : '#FF8A80',
        v: xs.reduce((s, x) => s + x.m, 0),
        tiles: xs.map(x => ({ label: x.s, sub: fmt(x.p), bg: COLOR(x), v: x.m })),
      }
    }).sort((a, b) => b.v - a.v)
    const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const ixs = ix.map(x => ({
      key: x.name,
      head: `${x.name} ${n2(x.price)} `,
      chg: `${x.change > 0 ? '▲' : x.change < 0 ? '▼' : '■'}${n2(x.change)} (${n2(x.pct)}%)`,
      color: x.change > 0 ? '#2FA55A' : x.change < 0 ? '#C0392B' : '#C9A227',
    }))
    const ixLen = ixs.reduce((n, x) => n + x.head.length + x.chg.length + 3, 0)
    const ixRows = ixs.length ? Math.ceil(ixLen / cols) : 0
    const W = Math.max(30, cols - 1)
    const narrow = W < 62 // short labels so no control row wraps
    const bodyRows = (e.props as any)?.scroll?.bodyRows ?? (e.viewport?.rows ?? 30) - 3
    const t = await read($, tab)
    const l = await read($, lists)
    const wr = await read($, wrows)
    const wm = await read($, wmeta)
    const wl = (await read($, wlrows)).slice(0, 8)
    const q0 = await read($, wq)
    const msg = await read($, wmsg)
    const cap = Math.max(1, Math.floor(bodyRows * 0.3) - 4)
    const kind = t === 'port' ? 'port' : 'vol'
    // Two side-by-side tables only when the list overflows one AND each half still fits (dropping at most Buy/Sell);
    // otherwise one table, dropping low-priority columns until it fits. Never wraps.
    const dualCols = t !== 'port' && wr.length > cap ? fit(kind, Math.floor((W - 2) / 2), kind === 'vol' ? 0 : 2) : undefined
    const dual = !!dualCols
    const cs = dualCols ?? fit(kind, W, kind === 'vol' ? 0 : 99) ?? (kind === 'vol' ? COLS[kind] : COLS[kind].filter(c => !DROP[kind].includes(c.h)))
    const shown = wr.slice(0, dual ? cap * 2 : cap)
    const half = dual ? Math.ceil(shown.length / 2) : shown.length
    const more = wr.length - shown.length
    // tabs + input + hint + table header + rows (+ total, + "more")
    const wRows = 4 + (wl.length ? wl.length + 3 : 0) + Math.max(1, half) + (t === 'port' && wr.length > 0 ? 1 : 0) + (more > 0 ? 1 : 0)
    const H = Math.max(4, bodyRows - 3 - ixRows - wRows) // clock + status + buttons + index row(s)
    const grid = q.length && !desktop ? buildGrid(groups, W, H, z) : []
    gridTop = 3 + ixRows // clock, status, buttons, index row(s)
    gridLen = grid.length
    scrollOff = (e.props as any)?.scroll?.offset ?? 0
    const cut = (s: string) => (s.length > W ? s.slice(0, W) : s)
    const head = cs.map(c => (c.left ? c.h.padEnd(c.w) : c.h.padStart(c.w))).join('')

    const rowCell = (r: WRow) => {
      const pos = l.port[r.s]
      const bg = r.fl > 0 ? UP_BG : r.fl < 0 ? DN_BG : undefined
      return (
        <Text>
          {cs.map(c => {
            const v = c.cell(r, pos)
            return <Text key={c.h} bold={v.b} dimColor={v.dim} color={v.c} backgroundColor={bg}>{c.left ? v.s.padEnd(c.w) : v.s.padStart(c.w)}</Text>
          })}
        </Text>
      )
    }

    if (desktop) {
      // Fill the pane: ~8px per column. Table zoom (A-/A+) scales the SVG text; once two tables fit side by side, it shows two.
      const mapW = Math.max(480, Math.round(cols * 8))
      const tz = await read($, tzoom)
      const fs = TABLE_FS[Math.max(0, Math.min(TABLE_FS.length - 1, tz))]!
      const lh = Math.round(fs * 1.65)
      const table = (rs: WRow[], k: 'vol' | 'port' | 'wl', pl = false) => {
        const pxCells = (px: number) => Math.floor(px / (fs * 0.62))
        const two = rs.length > 1 ? fit(k, pxCells((mapW - 24) / 2), k === 'vol' ? 0 : 2) : undefined // VN30 (vol): Vol/Buy/Sell never dropped
        const cs = two ?? fit(k, pxCells(mapW), k === 'vol' ? 0 : 99) ?? (k === 'vol' ? COLS[k] : COLS[k].filter(c => !DROP[k].includes(c.h)))
        const trs: TRow[] = rs.map(r => ({ cells: cs.map(c => c.cell(r, pl ? l.port[r.s] : undefined)), bg: r.fl > 0 ? '#2ECC71' : r.fl < 0 ? '#FF5A4D' : undefined }))
        const svg = tableSvg(cs, trs, mapW, fs, !!two)
        return { svg, h: ((two ? Math.ceil(rs.length / 2) : rs.length) + 1) * lh + 4 }
      }
      const mainT = wr.length ? table(wr, kind, t === 'port') : undefined
      const wlT = wl.length ? table(wl, 'wl') : undefined
      const adj = await read($, mapadj)
      const slIdx = Math.max(0, Math.min(SL_N - 1, Math.round(adj / SL_STEP) + SL_AUTO))
      const mapH = Math.max(160, Math.min(2400, Math.max(320, Math.min(1100, Math.round((e.viewport?.rows ?? 60) * 19 - (mainT?.h ?? 40) - (wlT?.h ?? 0) - 230))) + adj))
      return (
        <Box flexDirection="column" backgroundColor="#202226" flexGrow={1}>
          <Text bold>HCMC {new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 19)} <Text dimColor>{m.status === 'live' ? `${age}s ago` : m.status}<Text color={session().c}> · {session().t}</Text>{capsHave < capsOf ? ` · caps ${capsHave}/${capsOf}` : ''} · Source: SSI API</Text></Text>
          <Box flexWrap="wrap">
            <Select
              key="sel-view"
              label="Group by "
              value={v}
              options={[{ value: 'sector', label: 'Sector' }, { value: 'exchange', label: 'Exchange' }]}
              onSelect={(x: string) => { void update($, view, () => x as View) }}
            />
            <Select
              key="sel-filter"
              label="Filter "
              value="__sum"
              options={[
                { value: '__sum', label: picked.length ? picked.join(', ').slice(0, 40) : 'All sectors' },
                { value: '__all', label: 'Clear filter (all sectors)' },
                ...sectors.map(x => ({ value: x, label: `${picked.includes(x) ? '✓ ' : '   '}${x}` })),
              ]}
              onSelect={(x: string) => {
                if (x === '__sum') return
                void update($, only, cur => {
                  if (x === '__all') return ''
                  const c = cur ? cur.split('|') : []
                  return (c.includes(x) ? c.filter(y => y !== x) : [...c, x]).join('|')
                })
              }}
            />
          </Box>
          {picked.length > 0 && (
            <Box flexWrap="wrap">
              <Text dimColor>Showing </Text>
              {picked.map(x => <Button key={`chip-${x}`} label={`${x} ✕`} onPress={() => update($, only, cur => cur.split('|').filter(y => y !== x).join('|'))} />)}
            </Box>
          )}
          {ixs.length > 0 && <Box flexWrap="wrap">{ixs.map(x => <Text key={x.key}><Text bold>{x.head}</Text><Text color={x.color}>{x.chg}{'   '}</Text></Text>)}</Box>}
          {q.length === 0 ? <Text dimColor>Loading…</Text> : <Svg source={buildSvg(groups, mapW, mapH)} alt="Vietnam stock-market treemap by market cap, coloured by daily change" />}
          <Box>
            <Text dimColor>Map size </Text>
            {Array.from({ length: SL_N }, (_, k) => (
              <Button key={`ms${k}`} plain label={k <= slIdx ? '█' : '░'} onPress={() => update($, mapadj, () => (k - SL_AUTO) * SL_STEP)} />
            ))}
            <Button key="map-auto" label="⟲" onPress={() => update($, mapadj, () => 0)} />
          </Box>
          <Box>
            <Text dimColor>Text size </Text>
            {TABLE_FS.map((_, k) => (
              <Button key={`ts${k}`} plain label={k <= tz ? '█' : '░'} onPress={() => update($, tzoom, () => k)} />
            ))}
            <Button key="ts-auto" label="⟲" onPress={() => update($, tzoom, () => 1)} />
          </Box>
          <Box>
            <Button key="tab-vn30" label="VN30" variant={t === 'vn30' ? 'primary' : undefined} onPress={() => setTab($, 'vn30')} />
          </Box>
          {!mainT ? <Text dimColor>{t === 'vn30' ? 'Loading VN30…' : 'Empty. Add a ticker below.'}</Text> : <Svg source={mainT.svg} alt="Stock table" />}
          {t === 'port' && wr.length > 0 && (() => {
            const cost = wr.reduce((a, r) => a + (l.port[r.s] ? l.port[r.s].c * 1000 * l.port[r.s].q : 0), 0)
            const val = wr.reduce((a, r) => a + (l.port[r.s] ? r.p * l.port[r.s].q : 0), 0)
            const pl = val - cost
            return <Text bold>Total  Value {money(val)}  <Text color={plc(pl)}>P&L {money(pl)} ({sgn(cost ? (pl / cost) * 100 : 0)}%)</Text></Text>
          })()}
          <Input
            key="ticker"
            label="Search "
            placeholder={t === 'port' ? 'FPT 1000 62.4 (sym qty cost-in-k) · -FPT removes' : 'ticker, Enter adds · -FPT removes'}
            value={q0}
            submitLabel="add"
            onInput={(v: string) => { void update($, wq, () => v) }}
            onSubmit={(v: string) => { void submit($, v) }}
          />
          <Text dimColor>{q0.trim() ? suggest(universe, q0).map(x => `${x.code} (${x.name}.${x.ex === 'HOSE' ? 'HSX' : x.ex})`).join(' · ') || (universe.length ? 'no match' : 'loading tickers…') : msg || ' '}</Text>
          {wlT && (
            <Box flexDirection="column">
              <Text bold>My Watchlist</Text>
              <Svg source={wlT.svg} alt="Watchlist table" />
              <Box flexWrap="wrap">
                <Text dimColor>Remove </Text>
                {l.watch.map(sym => <Button key={`rm-${sym}`} label={`${sym} −`} onPress={() => { void submit($, `-${sym}`) }} />)}
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>HCMC {new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 19)}</Text>
        <Text dimColor>
          {m.status === 'live' ? `${age}s ago` : m.status}
          {` · ${session().t}`}
          {capsHave < capsOf ? ` · caps ${capsHave}/${capsOf}` : ''}
          {' · Source: SSI API'}
        </Text>
        <Box>
          <Button key="by-sector" label="Sector" hotkey="s" variant={v === 'sector' ? 'primary' : undefined} onPress={() => update($, view, () => 'sector' as View)} />
          <Button key="by-exchange" label={narrow ? 'Exch' : 'Exchange'} hotkey="e" variant={v === 'exchange' ? 'primary' : undefined} onPress={() => update($, view, () => 'exchange' as View)} />
          <Button key="sector-filter" label={sel ? `${narrow ? '' : 'Filter: '}${picked.length > 1 ? `${picked.length} sectors` : narrow ? SHORT[sel] ?? sel.split(' ')[0] : sel.slice(0, 18)}` : narrow ? 'All' : 'Filter: all'} hotkey="f" onPress={nextSector} />
          <Button key="filter-default" label={narrow ? 'Reset' : 'Default'} hotkey="d" variant={sel ? undefined : 'primary'} onPress={() => update($, only, () => '')} />
        </Box>
        {ixs.length > 0 && (
          <Box flexWrap="wrap">
            {ixs.map(x => (
              <Text key={x.key}>
                <Text bold>{x.head}</Text>
                <Text color={x.color}>{x.chg}{'   '}</Text>
              </Text>
            ))}
          </Box>
        )}
        {q.length === 0 && <Text dimColor>Loading…</Text>}
        {grid.map((row, r) => (
          <Box key={r}>
            {runs(row).map((s, i) => (
              <Text key={i} backgroundColor={s.bg} color={s.fg} bold={s.b}>{s.t}</Text>
            ))}
          </Box>
        ))}
        <Box>
          <Button key="tab-vn30" label="VN30" variant={t === 'vn30' ? 'primary' : undefined} onPress={() => setTab($, 'vn30')} />
        </Box>
        <Text bold>{head}{dual && shown.length > half ? `  ${head}` : ''}</Text>
        {shown.length === 0 && (
          <Text dimColor>{t === 'vn30' ? 'Loading VN30…' : 'Empty. Add a ticker below.'}</Text>
        )}
        {Array.from({ length: half }, (_, i) => (
          <Box key={i}>
            {rowCell(shown[i]!)}
            {dual && shown[i + half] && <Text>{'  '}</Text>}
            {dual && shown[i + half] && rowCell(shown[i + half]!)}
          </Box>
        ))}
        {more > 0 && <Text dimColor>{cut(`+${more} more (pane too short)`)}</Text>}
        {t === 'port' && wr.length > 0 && (() => {
          const cost = wr.reduce((a, r) => a + (l.port[r.s] ? l.port[r.s].c * 1000 * l.port[r.s].q : 0), 0)
          const val = wr.reduce((a, r) => a + (l.port[r.s] ? r.p * l.port[r.s].q : 0), 0)
          const pl = val - cost
          const tot: Record<string, string> = { Sym: 'Total', Value: money(val), 'P&L': money(pl), 'P&L%': `${sgn(cost ? (pl / cost) * 100 : 0)}%` }
          return (
            <Text bold>
              {cs.map(c => {
                const s = tot[c.h] ?? ''
                return <Text key={c.h} color={c.h.startsWith('P&L') ? plc(pl) : undefined}>{c.left ? s.padEnd(c.w) : s.padStart(c.w)}</Text>
              })}
            </Text>
          )
        })()}
        <Box>
          <Button key="tab-port" label="My Watchlist" variant="primary" onPress={() => setTab($, 'port')} />
        </Box>
        <Box>
          <Input
            key="ticker"
            label="Search "
            placeholder={(t === 'port' ? 'FPT 1000 62.4 (sym qty cost-in-k) · -FPT removes' : t === 'vn30' ? 'ticker, Enter adds to watchlist' : 'ticker, Enter adds · -FPT removes').slice(0, Math.max(10, W - 12))}
            value={q0}
            submitLabel="add"
            onInput={(v: string) => { void update($, wq, () => v) }}
            onSubmit={(v: string) => { void submit($, v) }}
          />
          <Text dimColor>{' '}
            {cut(q0.trim()
              ? suggest(universe, q0).map(x => `${x.code} (${x.name}.${x.ex === 'HOSE' ? 'HSX' : x.ex})`).join(' · ') || (universe.length ? 'no match' : 'loading tickers…')
              : msg || ' ').slice(0, Math.max(10, W - 24))}
          </Text>
        </Box>
        {wl.length > 0 && (() => {
          const wc = fit('wl', W, 99) ?? COLS.wl.filter(c => !DROP.wl.includes(c.h))
          return (
            <Box flexDirection="column">
              <Text bold>My Watchlist</Text>
              <Text bold>{wc.map(c => (c.left ? c.h.padEnd(c.w) : c.h.padStart(c.w))).join('')}</Text>
              {wl.map(r => (
                <Text key={r.s}>
                  {wc.map(c => {
                    const v = c.cell(r, undefined)
                    return <Text key={c.h} bold={v.b} dimColor={v.dim} color={v.c} backgroundColor={r.fl > 0 ? UP_BG : r.fl < 0 ? DN_BG : undefined}>{c.left ? v.s.padEnd(c.w) : v.s.padStart(c.w)}</Text>
                  })}
                </Text>
              ))}
              <Box flexWrap="wrap">
                <Text dimColor>Remove </Text>
                {l.watch.map(sym => <Button key={`rm-${sym}`} label={`${sym} -`} onPress={() => { void submit($, `-${sym}`) }} />)}
              </Box>
            </Box>
          )
        })()}
      </Box>
    )
    } catch (err) {
      const msg = String((err as Error)?.stack ?? err)
      void $.fs.write(`${stateDir($)}/vn-heatmap.err.log`, `${new Date().toISOString()} render ${msg}
`).catch(() => {})
      const { Box, Text } = $.ui.resolve(e) as any
      return <Box flexDirection="column"><Text color="#FF8A80">render error: {msg.slice(0, 300)}</Text></Box>
    }
  })
}

const UP_BG = '#244D38'
const DN_BG = '#583030'
const plc = (v: number) => (v > 0 ? '#2FA55A' : v < 0 ? '#C0392B' : '#C9A227')

// Sector header fallbacks (SSI ICB sectors), tried after the full name when a treemap group is narrow.
const SHORT: Record<string, string> = {
  'Oil & Gas': 'Oil&Gas', Chemicals: 'Chem', 'Basic Resources': 'Resourc', 'Construction & Materials': 'Constr',
  'Industrial Goods & Services': 'Indust', 'Automobiles & Parts': 'Auto', 'Food & Beverage': 'Food',
  'Personal & Household Goods': 'Househ', 'Health Care': 'Health', Retail: 'Retail', Media: 'Media',
  'Travel & Leisure': 'Travel', Telecommunications: 'Telecom', Utilities: 'Util', Banks: 'Banks',
  Insurance: 'Insur', 'Real Estate': 'Real Est', 'Financial Services': 'FinSvc', Technology: 'Tech',
}
const TINY: Record<string, string> = {
  'Oil & Gas': 'O&G', Chemicals: 'Chm', 'Basic Resources': 'Res', 'Construction & Materials': 'Con',
  'Industrial Goods & Services': 'Ind', 'Automobiles & Parts': 'Aut', 'Food & Beverage': 'F&B',
  'Personal & Household Goods': 'HH', 'Health Care': 'HC', Retail: 'Ret', Media: 'Med', 'Travel & Leisure': 'Trv',
  Telecommunications: 'Tel', Utilities: 'Utl', Banks: 'Bnk', Insurance: 'Ins', 'Real Estate': 'RE',
  'Financial Services': 'FS', Technology: 'IT',
}

// Watch-table columns at minimum width (each value + 1 space); `fit` stretches them to the pane.
type Cellv = { s: string; c?: string; dim?: boolean; b?: boolean }
type Col = { h: string; w: number; left?: boolean; cell: (r: WRow, pos?: { q: number; c: number }) => Cellv }
const LEAD: Col[] = [
  { h: 'Sym', w: 5, left: true, cell: r => ({ s: r.s, c: tone(r), b: true }) },
  { h: 'Price', w: 8, cell: r => ({ s: k1(r.p), c: tone(r) }) },
  { h: 'Chg', w: 7, cell: r => ({ s: sgn(r.ch / 1000), c: tone(r) }) },
  { h: '%', w: 8, cell: r => ({ s: `${sgn(r.pct)}%`, c: tone(r) }) },
]
const rc = (v?: number | null) => (v == null ? { s: '' } : { s: `${sgn(v)}%`, c: plc(v) })
const COLS: Record<'vol' | 'port' | 'wl', Col[]> = {
  vol: [
    ...LEAD,
    { h: 'Vol', w: 8, cell: r => ({ s: vol(r.vol), dim: true }) },
    { h: 'Buy', w: 8, cell: r => ({ s: vol(r.bu ?? 0), c: '#2FA55A' }) },
    { h: 'Sell', w: 8, cell: r => ({ s: vol(r.sd ?? 0), c: '#C0392B' }) },
    { h: 'F.Buy', w: 8, cell: r => ({ s: vol(r.fb ?? 0), c: '#2FA55A' }) },
    { h: 'F.Sell', w: 8, cell: r => ({ s: vol(r.fs ?? 0), c: '#C0392B' }) },
    { h: 'Room', w: 10, cell: r => { const v = r.fr ?? 0; return v < 0 ? { s: `-${vol(-v)}`, c: '#C0392B' } : { s: vol(v), dim: true } } },
  ],
  wl: [
    ...LEAD,
    { h: 'Vol', w: 8, cell: r => ({ s: vol(r.vol), dim: true }) },
    { h: 'Buy', w: 8, cell: r => ({ s: vol(r.bu ?? 0), c: '#2FA55A' }) },
    { h: 'Sell', w: 8, cell: r => ({ s: vol(r.sd ?? 0), c: '#C0392B' }) },
    { h: 'F.Buy', w: 8, cell: r => ({ s: vol(r.fb ?? 0), c: '#2FA55A' }) },
    { h: 'F.Sell', w: 8, cell: r => ({ s: vol(r.fs ?? 0), c: '#C0392B' }) },
    { h: 'Room', w: 10, cell: r => { const v = r.fr ?? 0; return v < 0 ? { s: `-${vol(-v)}`, c: '#C0392B' } : { s: vol(v), dim: true } } },
    { h: '1M', w: 8, cell: r => rc(r.rt?.m1) },
    { h: '3M', w: 8, cell: r => rc(r.rt?.m3) },
    { h: 'YTD', w: 8, cell: r => rc(r.rt?.y) },
  ],
  port: [
    ...LEAD,
    { h: 'Vol', w: 8, cell: r => ({ s: vol(r.vol), dim: true }) },
    { h: 'Buy', w: 8, cell: r => ({ s: vol(r.bu ?? 0), c: '#2FA55A' }) },
    { h: 'Sell', w: 8, cell: r => ({ s: vol(r.sd ?? 0), c: '#C0392B' }) },
    { h: 'F.Buy', w: 8, cell: r => ({ s: vol(r.fb ?? 0), c: '#2FA55A' }) },
    { h: 'F.Sell', w: 8, cell: r => ({ s: vol(r.fs ?? 0), c: '#C0392B' }) },
    { h: 'Room', w: 10, cell: r => { const v = r.fr ?? 0; return v < 0 ? { s: `-${vol(-v)}`, c: '#C0392B' } : { s: vol(v), dim: true } } },
    { h: '1M', w: 8, cell: r => rc(r.rt?.m1) },
    { h: '3M', w: 8, cell: r => rc(r.rt?.m3) },
    { h: 'YTD', w: 8, cell: r => rc(r.rt?.y) },
    { h: 'Qty', w: 8, cell: (r, p) => ({ s: p ? String(p.q) : '', c: tone(r) }) },
    { h: 'Cost', w: 8, cell: (r, p) => ({ s: p ? p.c.toFixed(2) : '', c: tone(r) }) },
    { h: 'Value', w: 9, cell: (r, p) => ({ s: p ? money(r.p * p.q) : '', c: tone(r) }) },
    { h: 'P&L', w: 9, cell: (r, p) => { const v = p ? (r.p - p.c * 1000) * p.q : 0; return { s: p ? money(v) : '', c: plc(v) } } },
    { h: 'P&L%', w: 9, cell: (r, p) => { const v = p ? (r.p / (p.c * 1000) - 1) * 100 : 0; return { s: p ? `${sgn(v)}%` : '', c: plc(v) } } },
  ],
}
// least useful first: dropped one by one until the table fits
const DROP: Record<'vol' | 'port' | 'wl', string[]> = { vol: ['Room', 'F.Sell', 'F.Buy', 'Sell', 'Buy', 'Chg', 'Vol'], wl: ['Room', 'F.Sell', 'F.Buy', 'Sell', 'Buy', 'Vol', 'Chg'], port: ['Room', 'F.Sell', 'F.Buy', 'Sell', 'Buy', 'Vol', 'Chg', 'Cost', 'Qty', '%', 'Value', 'P&L%'] }
const fit = (k: 'vol' | 'port' | 'wl', room: number, maxDrop: number): Col[] | undefined => {
  let cs = COLS[k]
  for (let i = 0; ; i++) {
    const need = cs.reduce((a, c) => a + c.w, 0)
    if (need <= room) {
      const ex = Math.floor((room - need) / cs.length)
      return cs.map(c => ({ ...c, w: c.w + ex }))
    }
    if (i >= Math.min(maxDrop, DROP[k].length)) return undefined
    cs = cs.filter(c => c.h !== DROP[k][i])
  }
}
