export type Quote = { s: string; p: number; m: number; g: string; x: number; k: 'c' | 'f' | '' }
export type Meta = { at: number; status: string; n: number }
export type Idx = { name: string; price: number; change: number; pct: number }
export type View = 'sector' | 'exchange'
export type WRow = { s: string; ex: string; p: number; ref: number; ch: number; pct: number; vol: number; hi: number; lo: number; bu: number; sd: number; fl: number; rt?: { m1: number | null; m3: number | null; y: number | null }; k: 'c' | 'f' | '' }
export type Tab = 'vn30' | 'watch' | 'port'
export type Lists = { watch: string[]; port: Record<string, { q: number; c: number }> }

declare module 'claude-code' {
  interface PluginState {
    'vn-stockmarket-heatmap': {
      quotes: Quote[]; meta: Meta; view: View; only: string; idx: Idx[]
      tab: Tab; lists: Lists; wrows: WRow[]; wlrows: WRow[]; wmeta: Meta; wq: string; wmsg: string; zoom: number
    }
  }
}
