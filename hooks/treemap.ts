// Squarified treemap rasterised onto a character grid (cells are ~2x taller than wide).
export type Tile = { label: string; sub: string; bg: string; v: number }
export type Group = { heads: string[]; tone: string; v: number; tiles: Tile[] } // heads: longest first, first that fits wins
export type Cell = { ch: string; bg: string; fg: string; b: boolean }

const GAP = '#1e1e1e'
const HEAD = '#2b2b2b'
const BLANK: Cell = { ch: ' ', bg: GAP, fg: '#FFFFFF', b: false }

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

export const squarify = (vals: number[], x: number, y: number, w: number, h: number): number[][] => {
  const total = sum(vals)
  if (!vals.length || total <= 0 || w <= 0 || h <= 0) return vals.map(() => [x, y, 0, 0])
  const k = (w * h) / total
  const areas = vals.map(v => v * k)
  const worst = (r: number[], s: number) => {
    const m = sum(r)
    return Math.max(...r.map(a => Math.max((s * s * a) / (m * m), (m * m) / (s * s * a))))
  }
  const out: number[][] = []
  let i = 0
  while (i < areas.length) {
    const s = Math.min(w, h)
    const row = [areas[i]]
    let j = i + 1
    while (j < areas.length && worst([...row, areas[j]], s) <= worst(row, s)) row.push(areas[j++])
    const m = sum(row)
    if (w >= h) {
      const cw = m / h
      let cy = y
      for (const a of row) { out.push([x, cy, cw, a / cw]); cy += a / cw }
      x += cw; w -= cw
    } else {
      const rh = m / w
      let cx = x
      for (const a of row) { out.push([cx, y, a / rh, rh]); cx += a / rh }
      y += rh; h -= rh
    }
    i = j
  }
  return out
}

// cells are twice as tall as wide: lay out in square units, then map y back
const sq = (vals: number[], x: number, y: number, w: number, h: number) =>
  squarify(vals, x, y * 2, w, h * 2).map(([a, b, c, d]) => [a, b / 2, c, d / 2])

// Terminal text can't shrink, so a zoom level is "how much room a label gets": pad = blank cols around the
// ticker, minH = tile rows (2 = ticker over change, 1 = one line), per = cells per tile cap. Every tile drawn is labelled.
export const ZOOMS = [
  { pad: 2, minH: 2, per: 26 }, // big: few tiles, padded two-line labels
  { pad: 0, minH: 2, per: 10 },
  { pad: 0, minH: 1, per: 4 },
  { pad: 0, minH: 1, per: 1 }, // small: as many tiles as fit a bare ticker
]
export const buildGrid = (groups: Group[], W: number, H: number, zoom = 0): Cell[][] => {
  const { pad, minH, per } = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, zoom))]!
  const g: Cell[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => BLANK))
  const put = (r: number, c: number, cell: Cell) => { if (r >= 0 && r < H && c >= 0 && c < W) g[r][c] = cell }
  const fill = (x0: number, y0: number, x1: number, y1: number, bg: string) => {
    for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) put(r, c, { ...BLANK, bg })
  }
  const text = (r: number, c: number, s: string, w: number, fg: string, bg: string, b: boolean) => {
    const t = s.slice(0, Math.max(0, w))
    for (let i = 0; i < t.length; i++) put(r, c + i, { ch: t[i], bg, fg, b })
  }

  const gr = sq(groups.map(x => x.v), 0, 0, W, H)
  groups.forEach((grp, i) => {
    const x0 = Math.round(gr[i][0]), y0 = Math.round(gr[i][1])
    const x1 = Math.round(gr[i][0] + gr[i][2]), y1 = Math.round(gr[i][1] + gr[i][3])
    const w = x1 - x0, h = y1 - y0
    if (w < 3 || h < 1) return
    const hasHead = h >= 3
    if (hasHead) {
      fill(x0, y0, x1 - 1, y0 + 1, HEAD) // last col stays GAP so adjacent headers don't merge
      const head = grp.heads.find(s => s.length <= w - 2) // never cut mid-word: shorter form or nothing
      if (head) text(y0, x0 + 1, head, w - 2, grp.tone, HEAD, true)
    }
    const ty0 = hasHead ? y0 + 1 : y0
    const th = y1 - ty0
    // largest k whose every tile can hold its ticker with 1 col padding each side plus gutter; no slivers
    let tiles = grp.tiles.slice(0, Math.max(1, Math.min(grp.tiles.length, Math.floor((w * th) / per))))
    let tr = sq(tiles.map(t => t.v), x0, ty0, w, th)
    const fits = (rs: number[][], ts: Tile[]) =>
      rs.every((r, n) => Math.round(r[0] + r[2]) - Math.round(r[0]) >= ts[n].label.length + 1 + pad && Math.round(r[1] + r[3]) - Math.round(r[1]) >= minH)
    while (tiles.length > 1 && !fits(tr, tiles)) {
      tiles = tiles.slice(0, -1)
      tr = sq(tiles.map(t => t.v), x0, ty0, w, th)
    }
    if (!fits(tr, tiles)) return // group too small to name even its biggest ticker: keep the header only
    tiles.forEach((t, j) => {
      const a0 = Math.round(tr[j][0]), b0 = Math.round(tr[j][1])
      const a1 = Math.round(tr[j][0] + tr[j][2]), b1 = Math.round(tr[j][1] + tr[j][3])
      const tw = a1 - a0, tH = b1 - b0
      if (tw < 1 || tH < 1) return
      fill(a0, b0, a1, b1, t.bg)
      // uniform gutters: 1 col right, half a row bottom (▀) so gaps look equal in both axes
      const gr = tw >= 2, gb = tH >= 2
      if (gb) for (let c = a0; c < a1; c++) put(b1 - 1, c, { ch: '▀', bg: GAP, fg: t.bg, b: false })
      if (gr) fill(a1 - 1, b0, a1, b1, GAP)
      const iw = gr ? tw - 1 : tw
      const ih = gb ? tH - 1 : tH
      const ok = (s: string) => s.length <= iw - pad // keep 1 col padding each side (none when zoomed out)
      const label = t.label // never truncated: "T1" for T11 would name the wrong ticker
      if (!ok(label)) return // too narrow to name: leave as colour only
      const mid = (s: string) => a0 + Math.floor((iw - s.length) / 2)
      const sub = [t.sub].find(ok)
      if (ih >= 2) {
        // visual tile height = ih rows + the half-row ▀ gutter; centre the 1-2 text lines in it
        const top = b0 + Math.round((ih + 0.5 - (sub ? 2 : 1)) / 2)
        text(top, mid(label), label, iw, '#FFFFFF', t.bg, true)
        if (sub) text(top + 1, mid(sub), sub, iw, '#FFFFFF', t.bg, false)
      } else {
        const s = sub && ok(`${label} ${sub}`) ? `${label} ${sub}` : label
        text(b0, mid(s), s, iw, '#FFFFFF', t.bg, true)
      }
    })
  })
  return g
}

export const runs = (row: Cell[]) => {
  const o: { t: string; bg: string; fg: string; b: boolean }[] = []
  for (const c of row) {
    const l = o[o.length - 1]
    if (l && l.bg === c.bg && l.fg === c.fg && l.b === c.b) l.t += c.ch
    else o.push({ t: c.ch, bg: c.bg, fg: c.fg, b: c.b })
  }
  return o
}
