// Squarified treemap rasterised onto a character grid (cells are ~2x taller than wide).
export type Tile = { label: string; sub: string; bg: string; v: number }
export type Group = { heads: string[]; tone: string; v: number; tiles: Tile[] } // heads: longest first, first that fits wins
export type Cell = { ch: string; bg: string; fg: string; b: boolean }

const GAP = '#1e1e1e'
const HEAD = '#2b2b2b'
const MIN = 12 // subcells (cols x half-rows) a tile needs to be drawn on its own
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

// Half-block raster: each cell is two square "subrows" drawn as ▀ (fg = top half, bg = bottom half), so tile
// edges land on half rows and thin tiles still show. Text needs a whole cell, so labels sit on full rows only.
// Terminal text can't shrink, so a zoom level is "how much room a label needs": pad = blank cols around the
// ticker, minH = text rows a tile must have before it is labelled. Every tile is drawn; small ones stay colour only.
export const ZOOMS = [
  { pad: 2, minH: 2 }, // big: only roomy tiles labelled, ticker over change
  { pad: 0, minH: 2 },
  { pad: 1, minH: 1 },
  { pad: 0, minH: 1 }, // small: every tile that fits a bare ticker
]
export const buildGrid = (groups: Group[], W: number, H: number, zoom = 0): Cell[][] => {
  const { pad, minH } = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, zoom))]!
  const S = H * 2
  const px: string[][] = Array.from({ length: S }, () => Array.from({ length: W }, () => GAP))
  const tx: (Cell | undefined)[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => undefined))
  const fill = (x0: number, y0: number, x1: number, y1: number, bg: string) => {
    for (let r = Math.max(0, y0); r < Math.min(S, y1); r++) for (let c = Math.max(0, x0); c < Math.min(W, x1); c++) px[r][c] = bg
  }
  const text = (r: number, c: number, s: string, fg: string, bg: string, b: boolean) => {
    for (let i = 0; i < s.length; i++) if (r >= 0 && r < H && c + i >= 0 && c + i < W) tx[r][c + i] = { ch: s[i], bg, fg, b }
  }
  const box = (q: number[]) => {
    const x0 = Math.round(q[0]), y0 = Math.round(q[1])
    return [x0, y0, Math.round(q[0] + q[2]), Math.round(q[1] + q[3])]
  }

  // a cell is ~2x taller than wide, so a subrow is roughly square: lay out directly in (col, subrow) units
  const gr = squarify(groups.map(x => x.v), 0, 0, W, S)
  groups.forEach((grp, i) => {
    const [x0, y0, x1, y1] = box(gr[i])
    const w = x1 - x0, h = y1 - y0
    if (w < 3 || h < 2) return
    let ty0 = y0
    const head = h >= 6
    if (head) ty0 = Math.ceil(y0 / 2) * 2 + 2
    // drop the small-cap tail (tiles under ~3x2 cells read as confetti) and let the rest fill the group;
    // then drop trailing slivers (thinner than 2 cols or 2 subrows) until the layout is clean
    const area = w * (y1 - ty0), tot = grp.tiles.reduce((s, t) => s + t.v, 0)
    let tiles = [...grp.tiles].sort((p, q) => q.v - p.v).filter((t, n) => n === 0 || (t.v / tot) * area >= MIN)
    let tr = squarify(tiles.map(t => t.v), x0, ty0, w, y1 - ty0)
    const thin = (q: number[]) => { const [a0, b0, a1, b1] = box(q); return a1 - a0 < 3 || b1 - b0 < 3 }
    while (tiles.length > 1 && tr.some(thin)) {
      tiles = tiles.slice(0, -1)
      tr = squarify(tiles.map(t => t.v), x0, ty0, w, y1 - ty0)
    }
    if (head) {
      const hr = ty0 / 2 - 1 // first whole row inside the group carries the header text
      fill(x0, y0, x1 - 1, ty0, HEAD) // last col stays GAP so adjacent headers don't merge
      const hid = grp.tiles.length - tiles.length
      const heads = hid ? [...grp.heads.map(x => `${x} · +${hid}`), ...grp.heads] : grp.heads
      const label = heads.find(x => x.length <= w - 2) // never cut mid-word: shorter form or nothing
      if (label) text(hr, x0 + 1, label, grp.tone, HEAD, true)
    }
    tiles.forEach((t, j) => {
      const [a0, b0, a1, b1] = box(tr[j])
      const tw = a1 - a0, th = b1 - b0
      if (tw < 1 || th < 1) return
      // gutters: 1 col right, 1 subrow (half a row) bottom, so gaps look equal in both axes
      const iw = tw >= 2 ? tw - 1 : tw
      const ib1 = th >= 2 ? b1 - 1 : b1
      fill(a0, b0, a0 + iw, ib1, t.bg)
      const r0 = Math.ceil(b0 / 2), r1 = Math.floor(ib1 / 2) // whole rows [r0, r1) fully inside the tile
      const nr = r1 - r0
      const ok = (s: string) => s.length <= iw - pad
      const label = t.label // never truncated: "T1" for T11 would name the wrong ticker
      if (nr < minH || !ok(label)) return // too small to name: colour only
      const mid = (s: string) => a0 + Math.floor((iw - s.length) / 2)
      const sub = t.sub && ok(t.sub) ? t.sub : undefined
      if (nr >= 2) {
        const top = r0 + Math.floor((nr - (sub ? 2 : 1)) / 2)
        text(top, mid(label), label, '#FFFFFF', t.bg, true)
        if (sub) text(top + 1, mid(sub), sub, '#FFFFFF', t.bg, false)
      } else {
        const s = sub && ok(`${label} ${sub}`) ? `${label} ${sub}` : label
        text(r0, mid(s), s, '#FFFFFF', t.bg, true)
      }
    })
  })
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => {
      const t = tx[r][c]
      if (t) return t
      const top = px[r * 2][c], bot = px[r * 2 + 1][c]
      return top === bot ? { ...BLANK, bg: top } : { ch: '▀', bg: bot, fg: top, b: false }
    }))
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
