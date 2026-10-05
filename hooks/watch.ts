// SSI iBoard quotes for the watchlist strip (public REST, see docs/ssi-iboard-api.md).
// ponytail: 3s REST polling; the real push feed is MQTT+protobuf at
// wss://price-streaming.ssi.com.vn/mqtt, needs a spawned helper since mods have no WebSocket.
import type { Lists, Quote, WRow } from './types'

export const SSI = 'https://iboard-query.ssi.com.vn'
export const MAX = 200 // CONFIG_LIMIT_STOCK_MULTIPLE_QUERY in the iBoard bundle
export const HEADERS = { 'user-agent': 'Mozilla/5.0', referer: 'https://iboard.ssi.com.vn/', accept: 'application/json' }

// matchedPrice is 0 before the first match; during ATO/ATC the board shows the expected price.
export const toRow = (x: any): WRow => {
  const live = x.matchedPrice > 0
  const p = live ? x.matchedPrice : x.expectedMatchedPrice > 0 ? x.expectedMatchedPrice : x.refPrice
  const ch = live ? x.priceChange : x.expectedMatchedPrice > 0 ? x.expectedPriceChange : 0
  const pct = live ? x.priceChangePercent : x.expectedMatchedPrice > 0 ? x.expectedPriceChangePercent : 0
  return {
    s: x.stockSymbol, ex: String(x.exchange ?? '').toUpperCase(), p, ref: x.refPrice, ch: ch ?? 0, pct: pct ?? 0,
    vol: x.nmTotalTradedQty ?? 0, hi: x.highest ?? 0, lo: x.lowest ?? 0,
    bu: x.stockBUVol ?? 0, sd: x.stockSDVol ?? 0, fb: x.buyForeignQtty ?? 0, fs: x.sellForeignQtty ?? 0, fr: x.remainForeignQtty ?? 0, fl: 0, // active buy/sell volume; fb/fs/fr = foreign buy/sell qty and remaining room; fl = price flash vs last poll (set by caller)
    k: p > 0 && p >= x.ceiling ? 'c' : p > 0 && p <= x.floor ? 'f' : '',
  }
}

export const STATS = 'https://iboard-api.ssi.com.vn/statistics'
export const EXCHANGE = ['', 'HOSE', 'HNX', 'UPCOM']

// Heatmap tile from an SSI quote: size = listed shares x price (market cap). No shares yet = no tile.
export const toQuote = (x: any, sector: Map<string, string>, shares: Record<string, number>): Quote | undefined => {
  const r = toRow(x)
  const n = shares[r.s]
  if (!n || !(r.p > 0)) return
  return { s: r.s, p: r.pct, m: n * r.p, g: sector.get(r.s) ?? 'Other', x: EXCHANGE.indexOf(r.ex), k: r.k }
}

// /company/sectors-data -> symbol => ICB sector (English)
export const sectorsOf = (data: any[]) =>
  new Map<string, string>(data.flatMap(i => (i.listCompany ?? []).map((c: any) => [c.symbol, i.industryName?.en ?? 'Other'])))

export type Ticker = { code: string; name: string; ex: string }
export const toTicker = (x: any): Ticker => ({ code: x.code, name: x.clientNameEn || x.clientName || '', ex: x.exchange })

// Unwraps SSI's { code, message, data } envelope.
export const rowsOf = (status: number, ok: boolean, text: string) => {
  if (!ok) throw new Error(`SSI ${status}`)
  const d = JSON.parse(text)
  if (!Array.isArray(d.data)) throw new Error(`SSI ${d.message ?? 'bad shape'}`)
  return d.data as any[]
}

export const suggest = (all: Ticker[], q: string, n = 6) => {
  const t = q.trim().toUpperCase().split(/\s+/)[0] ?? ''
  if (!t) return []
  const pre = all.filter(x => x.code.startsWith(t))
  return pre.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code)).slice(0, n)
}

// Input grammar: "FPT" adds, "-FPT" removes; on the portfolio tab "FPT 1000 62.4" sets qty and
// cost (cost in thousand VND, as the board shows prices).
export type Cmd = { op: 'add'; s: string; q?: number; c?: number } | { op: 'del'; s: string } | { op: 'bad'; why: string }
export const parse = (text: string, known: (s: string) => boolean, port: boolean): Cmd => {
  const [a = '', q, c] = text.trim().toUpperCase().split(/\s+/)
  if (a.startsWith('-')) return { op: 'del', s: a.slice(1) }
  if (!known(a)) return { op: 'bad', why: `unknown ticker ${a || '(empty)'}` }
  if (!port) return { op: 'add', s: a }
  const qty = Number(q), cost = Number(c)
  if (!(qty > 0) || !(cost > 0)) return { op: 'bad', why: 'portfolio: SYM QTY COST, e.g. FPT 1000 62.4' }
  return { op: 'add', s: a, q: qty, c: cost }
}

export const apply = (l: Lists, cmd: Cmd, port: boolean): Lists => {
  if (cmd.op === 'bad') return l
  if (port) {
    const p = { ...l.port }
    if (cmd.op === 'del') delete p[cmd.s]
    else p[cmd.s] = { q: cmd.q!, c: cmd.c! }
    return { ...l, port: p }
  }
  const w = l.watch.filter(s => s !== cmd.s)
  return { ...l, watch: cmd.op === 'add' ? [...w, cmd.s].slice(-MAX) : w }
}
