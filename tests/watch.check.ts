// Self-check for watch.ts pure logic + a live hit on SSI: `bun tests/watch.check.ts`
import { buildGrid } from '../hooks/treemap'
import { apply, HEADERS, parse, rowsOf, sectorsOf, SSI, suggest, toQuote, toRow } from '../hooks/watch'
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m) }

const known = (s: string) => ['FPT', 'FPTS', 'HPG'].includes(s)
// treemap grid: every tile drawn (half-block raster), labels only on whole rows of their own tile colour
{
  const tiles = Array.from({ length: 40 }, (_, i) => ({ label: `T${i}`, sub: '+1.0', bg: `#0000${(i + 16).toString(16)}`, v: 100 / (i + 1) }))
  const g = buildGrid([{ heads: ['Grp'], tone: '#fff', v: 1, tiles }], 60, 20, 3)
  const cs = g.flat()
  assert(g.length === 20 && g.every(r => r.length === 60), 'grid size')
  assert(tiles.every(t => cs.some(c => c.bg === t.bg || c.fg === t.bg)), 'every tile drawn')
  assert(cs.every(c => !/[A-Z0-9]/.test(c.ch) || c.bg !== '#1e1e1e'), 'no text on gap')
}
assert(parse('fpt', known, false).op === 'add', 'add')
assert(parse('-FPT', known, false).op === 'del', 'del')
assert(parse('XYZ', known, false).op === 'bad', 'unknown')
assert(parse('FPT 100', known, true).op === 'bad', 'port needs cost')
const c = parse('FPT 1000 62.4', known, true)
assert(c.op === 'add' && c.q === 1000 && c.c === 62.4, 'port add')
let l = apply({ watch: ['HPG'], port: {} }, { op: 'add', s: 'FPT' }, false)
l = apply(l, { op: 'add', s: 'HPG' }, false)
assert(l.watch.join() === 'FPT,HPG', 'dedupe moves to end')
l = apply(l, c, true)
assert(l.port.FPT.q === 1000, 'port set')
assert(Object.keys(apply(l, { op: 'del', s: 'FPT' }, true).port).length === 0, 'port del')
assert(suggest([{ code: 'FPTS', name: '', ex: '' }, { code: 'FPT', name: '', ex: '' }], 'fp')[0].code === 'FPT', 'shortest first')
const pre = toRow({ stockSymbol: 'A', matchedPrice: 0, expectedMatchedPrice: 0, refPrice: 100, ceiling: 107, floor: 93 })
assert(pre.p === 100 && pre.ch === 0, 'pre-open falls back to ref')
assert(toRow({ stockSymbol: 'A', matchedPrice: 107, priceChange: 7, priceChangePercent: 7, refPrice: 100, ceiling: 107, floor: 93 }).k === 'c', 'ceiling')
const sec = sectorsOf([{ industryName: { en: 'Banks' }, listCompany: [{ symbol: 'ACB' }] }])
const tq = toQuote({ stockSymbol: 'ACB', exchange: 'hnx', matchedPrice: 93, priceChange: -7, priceChangePercent: -7, refPrice: 100, ceiling: 107, floor: 93 }, sec, { ACB: 10 })
assert(tq?.x === 2 && tq.p === -7 && tq.k === 'f' && tq.g === 'Banks' && tq.m === 930, `toQuote ${JSON.stringify(tq)}`)
assert(!toQuote({ stockSymbol: 'ZZZ', exchange: 'hose', matchedPrice: 1 }, sec, { ZZZ: 0 }), 'no shares, no tile')
assert(toQuote({ stockSymbol: 'X', exchange: 'upcom', matchedPrice: 5, refPrice: 5 }, sec, { X: 1 })?.g === 'Other', 'unmapped sector')

const get = async (path: string, init?: any) => {
  const r = await fetch(`${SSI}${path}`, { ...init, headers: { ...HEADERS, ...init?.headers } })
  return rowsOf(r.status, r.ok, await r.text()).map(toRow)
}
const vn30 = await get('/stock/group/VN30')
assert(vn30.length === 30 && vn30.every(r => r.p > 0), `VN30 rows ${vn30.length}`)
const m = await get('/stock/multiple', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stocks: ['FPT', 'SHS'] }) })
assert(m.length === 2, 'multiple')
console.log('ok', vn30.slice(0, 3).map(r => `${r.s} ${r.p} ${r.pct}%`).join(' | '), '|', m.map(r => `${r.s}/${r.ex}`).join(' '))
