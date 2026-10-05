// Pixel treemap as an SVG string for the desktop surface (terminal uses the cell grid in treemap.ts).
import { squarify } from './treemap'
import type { Group } from './treemap'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const HEAD_H = 16

const r = (n: number) => Math.round(n * 10) / 10

const build = (groups: Group[], W: number, H: number, minTile: number): string => {
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif"><rect width="${W}" height="${H}" fill="#1e1e1e"/>`]
  const gr = squarify(groups.map(g => g.v), 0, 0, W, H)
  groups.forEach((g, i) => {
    const [gx, gy, gw, gh] = gr[i]!
    if (gw < 4 || gh < 4) return
    const head = gh > 40 && gw > 40
    out.push(`<rect x="${gx + 1}" y="${gy + 1}" width="${gw - 2}" height="${gh - 2}" fill="#2b2b2b"/>`)
    if (head) {
      const label = g.heads.find(s => s.length * 6.5 < gw - 8)
      if (label) out.push(`<text x="${gx + 5}" y="${gy + 12}" font-size="11" font-weight="700" fill="${g.tone}">${esc(label)}</text>`)
    }
    const ty = gy + (head ? HEAD_H : 1)
    const th = gh - (head ? HEAD_H : 1) - 1
    if (th < 4) return
    const tr = squarify(g.tiles.map(t => t.v), gx + 1, ty, gw - 2, th)
    g.tiles.forEach((t, j) => {
      const [x, y, w, h] = tr[j]!
      if (w < minTile || h < minTile) return
      out.push(`<rect x="${r(x + 0.5)}" y="${r(y + 0.5)}" width="${r(Math.max(0, w - 1))}" height="${r(Math.max(0, h - 1))}" fill="${t.bg}"/>`)
      const fs = Math.max(8, Math.min(18, w / (t.label.length * 0.75), h / 2.4))
      if (w < t.label.length * fs * 0.62 || h < fs + 2) return // can't name it: colour only
      const cx = x + w / 2
      const two = h >= fs * 2.2
      out.push(`<text x="${r(cx)}" y="${r(y + h / 2 + (two ? -1 : fs * 0.35))}" font-size="${fs.toFixed(1)}" font-weight="700" fill="#fff" text-anchor="middle">${esc(t.label)}</text>`)
      if (two) out.push(`<text x="${r(cx)}" y="${r(y + h / 2 + fs * 0.95)}" font-size="${(fs * 0.75).toFixed(1)}" fill="#fff" text-anchor="middle">${esc(t.sub)}</text>`)
    })
  })
  out.push('</svg>')
  return out.join('')
}

// Svg source is capped at 131072 chars: raise the smallest drawn tile until it fits.
export const buildSvg = (groups: Group[], W: number, H: number): string => {
  let out = ''
  for (const min of [3, 5, 8, 12, 20, 40]) {
    out = build(groups, W, H, min)
    if (out.length < 120_000) break
  }
  return out
}
