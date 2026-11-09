// Canvas rendering for mind maps. Pure drawing: the app passes in a `scene`.
import { BRANCH_COLORS, readableText, tones } from './colors.js'

const STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif'
// Node styles by depth: root, top-level branch, everything deeper.
export const STYLES = [
  { font: `700 22px Manrope, ${STACK}`, padX: 26, h: 54, r: 27 },
  { font: `700 16px Manrope, ${STACK}`, padX: 18, h: 40, r: 14 },
  // deeper nodes are drawn as plain text; the box is still there for hits, hover and selection
  { font: `500 15px Manrope, ${STACK}`, padX: 12, h: 32, r: 10 }
]
const LINK_W = 20 // room for the ↗ icon
// The space a node's image gets, above its text. Fixed, so a node doesn't jump when its image loads.
export const IMAGE_W = 120
export const IMAGE_H = 90
const IMAGE_PAD = 10
const ROOT_FILL = '#6d4aff'
const ROOT_HI = '#8b5cf6'
const ROOT_LO = '#5438df'

export const THEMES = {
  light: {
    bg: '#fafafc',
    grid: 'rgba(63,55,105,0.04)',
    ink: '#36314a',
    leaf: '#ffffff',
    shadow: 'rgba(43,32,85,0.10)',
    leafHover: 'rgba(109,74,255,0.07)',
    accent: '#6d4aff',
    accentRgb: '109,74,255',
    accentSoft: 'rgba(109,74,255,0.22)',
    badgeBg: '#ffffff',
    muted: '#687080',
    aura: 'rgba(124,93,250,0.07)',
    auraMid: 'rgba(124,93,250,0.02)',
    auraClear: 'rgba(124,93,250,0)'
  },
  dark: {
    bg: '#11131b',
    grid: 'rgba(255,255,255,0.035)',
    ink: '#dcd9e8',
    leaf: '#20242e',
    shadow: 'rgba(0,0,0,0.32)',
    leafHover: 'rgba(162,139,255,0.10)',
    accent: '#a28bff',
    accentRgb: '162,139,255',
    accentSoft: 'rgba(162,139,255,0.30)',
    badgeBg: '#171a23',
    muted: '#9aa2b1',
    aura: 'rgba(124,93,250,0.13)',
    auraMid: 'rgba(124,93,250,0.035)',
    auraClear: 'rgba(124,93,250,0)'
  }
}

// A node's optional `size` (SPEC.md) scales its depth's style: font, padding, height, corners.
export const SIZE_MIN = 0.8
export const SIZE_MAX = 1.6
export function nodeScale(node) {
  const s = node?.size
  // a JSON number only: strings, zero, negatives and NaN draw at normal size
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, s)) : 1
}
const scaled = new Map()
function styleFor(depth, k) {
  const base = STYLES[Math.min(depth, 2)]
  if (k === 1) return base
  const key = Math.min(depth, 2) + ':' + k
  let st = scaled.get(key)
  if (!st) {
    // whole pixels, so the font string stays simple for anything that reads it back
    const font = base.font.replace(/(\d+)px/, (_, px) => Math.round(px * k) + 'px')
    st = { font, padX: base.padX * k, h: base.h * k, r: base.r * k }
    if (scaled.size > 500) scaled.clear()
    scaled.set(key, st)
  }
  return st
}

const hasImage = node => typeof node.image === 'string' && node.image.trim() !== ''

// `shows` says whether a node gets image space. The app leaves it out once an image has failed.
export function makeMeasure(ctx, { shows = hasImage } = {}) {
  const widths = new Map()
  const measure = (node, depth) => {
    const k = nodeScale(node)
    const st = styleFor(depth, k)
    const key = st.font + '\u0000' + node.name
    let tw = widths.get(key)
    if (tw === undefined) {
      ctx.font = st.font
      tw = ctx.measureText(node.name || ' ').width
      if (widths.size > 5000) widths.clear()
      widths.set(key, tw)
    }
    const link = node.link ? LINK_W : 0
    const w = Math.max(tw + st.padX * 2 + link, 48 * k)
    const plain = { ...st, tw, w, link: Boolean(node.link), tx: st.padX, ty: 0, pic: null }
    if (!shows(node)) return plain
    // tx, ty: where the text sits, from the box's left edge and from its centre
    const pic = { w: IMAGE_W * k, h: IMAGE_H * k, pad: IMAGE_PAD * k }
    const wide = Math.max(w, pic.w + pic.pad * 2)
    const extra = pic.h + pic.pad
    return { ...plain, w: wide, h: st.h + extra, tx: (wide - tw - link) / 2, ty: extra / 2, pic }
  }
  measure.reset = () => widths.clear()
  return measure
}

// Distance from a box's centre to its edge along unit vector (dx, dy).
function exit(m, dx, dy) {
  const tx = Math.abs(dx) > 1e-6 ? m.w / 2 / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-6 ? m.h / 2 / Math.abs(dy) : Infinity
  return Math.min(tx, ty)
}

const unit = (x, y) => {
  const d = Math.hypot(x, y) || 1
  return [x / d, y / d]
}

function outward(i, s) {
  const p = s.pos(i)
  const par = s.info.parent[i]
  if (par === null || par === undefined) return [1, 0]
  const q = s.pos(par)
  return unit(p.x - q.x, p.y - q.y)
}

// Where the collapse / expand badge sits for node i (world units), or null.
export function badgeAt(i, s) {
  if (!s.info.kids[i].length) return null
  const p = s.pos(i)
  const m = s.size(i)
  const [ox, oy] = outward(i, s)
  const r = s.badgeR || 11
  const d = exit(m, ox, oy) + r + 4
  return { x: p.x + ox * d, y: p.y + oy * d, r }
}

// Centre of the ↗ link icon for node i (world units), or null.
export function linkIconAt(i, s) {
  const m = s.size(i)
  if (!m.link) return null
  const p = s.pos(i)
  return { x: p.x - m.w / 2 + m.tx + m.tw + 11, y: p.y + m.ty, r: 12 }
}

// A node's image, fitted inside its space and centred, or a faint panel while there's nothing to show.
function drawPicture(ctx, m, img, cx, top, ink) {
  const { w, h } = m.pic
  if (!img) {
    ctx.save()
    ctx.fillStyle = ink
    ctx.globalAlpha *= 0.08
    box(ctx, cx - w / 2, top, w, h, 6)
    ctx.fill()
    ctx.restore()
    return
  }
  const iw = img.naturalWidth || w
  const ih = img.naturalHeight || h
  const fit = Math.min(w / iw, h / ih)
  ctx.drawImage(img, cx - (iw * fit) / 2, top + (h - ih * fit) / 2, iw * fit, ih * fit)
}

export function colorsFor(i, s) {
  const n = s.nodes[i]
  const d = s.info.depth[i]
  const branch = s.info.branchColor[i] || BRANCH_COLORS[0]
  const bt = tones(branch, s.dark)
  if (d === 0) return { fill: ROOT_FILL, fillHi: ROOT_HI, fillLo: ROOT_LO, border: null, lw: 0, edge: s.theme.accent, glow: s.theme.accentSoft, surface: true }
  if (d === 1) {
    const t = tones(n.bgColor || branch, s.dark)
    return { fill: t.fill, fillHi: t.fillHi, fillLo: t.fillLo, border: t.border, lw: 1, edge: bt.edge, glow: t.glow, surface: true }
  }
  // Deeper nodes are text on the canvas, marked by a dot in their branch's colour. A node with
  // a picture keeps a card to hold it. (A deeper node's own bgColor is kept in the file; the
  // branch colour wins on screen so each branch reads as one colour.)
  if (s.size(i).pic) return { fill: s.theme.leaf, border: bt.border, lw: 1, edge: bt.edge, glow: bt.glow, surface: true }
  return { fill: s.theme.bg, text: s.theme.ink, border: null, lw: 0, edge: bt.edge, glow: bt.glow, surface: false }
}

function box(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

function ring(ctx, p, m, grow, width, color, dash) {
  box(ctx, p.x - m.w / 2 - grow, p.y - m.h / 2 - grow, m.w + grow * 2, m.h + grow * 2, m.r + grow)
  ctx.lineWidth = width
  ctx.strokeStyle = color
  ctx.setLineDash(dash || [])
  ctx.stroke()
  ctx.setLineDash([])
}

// Vertical node-fill gradients, kept per context and reused across nodes and frames.
const fills = new WeakMap()
function fillGradient(ctx, hi, lo, h) {
  let cache = fills.get(ctx)
  if (!cache) fills.set(ctx, (cache = new Map()))
  const key = hi + '|' + lo + '|' + h
  let g = cache.get(key)
  if (!g) {
    if (cache.size > 500) cache.clear()
    g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, hi)
    g.addColorStop(1, lo)
    cache.set(key, g)
  }
  return g
}

// The backdrop: the theme colour and a faint glow around the root that follows it. The colour
// only changes with size and theme, so it's drawn once into a layer; the glow is a small
// pre-drawn image stretched into place (a smooth gradient scales up without visible loss).
let layer = null
const auras = new Map()
const MAX_LAYER = 16e6 // device pixels; anything bigger (a large PNG export) is drawn directly
function drawBackdrop(ctx, s) {
  const { theme, view, nodes } = s
  const W = Math.round(s.width * s.dpr)
  const H = Math.round(s.height * s.dpr)
  if (!W || !H) return // nothing to draw on yet (a 0×0 canvas before the first resize)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (W * H <= MAX_LAYER) {
    const key = `${W}x${H}|${theme.bg}`
    if (layer?.key !== key) {
      const c = layer?.canvas ?? document.createElement('canvas')
      c.width = W
      c.height = H
      paintLayer(c.getContext('2d'), W, H, theme)
      layer = { key, canvas: c }
    }
    ctx.drawImage(layer.canvas, 0, 0)
  } else paintLayer(ctx, W, H, theme)

  const root = nodes.length ? s.pos(0) : null
  const cx = (root ? root.x * view.scale + view.x : s.width / 2) * s.dpr
  const cy = (root ? root.y * view.scale + view.y : s.height / 2) * s.dpr
  const R = Math.hypot(W, H) * 0.62
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(auraImage(theme), cx - R, cy - R, R * 2, R * 2)
}
function paintLayer(c, W, H, theme) {
  c.fillStyle = theme.bg
  c.fillRect(0, 0, W, H)
}
function auraImage(theme) {
  const key = theme.aura + theme.auraMid + theme.auraClear
  let img = auras.get(key)
  if (!img) {
    const N = 256
    img = document.createElement('canvas')
    img.width = img.height = N
    const c = img.getContext('2d')
    const g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
    g.addColorStop(0, theme.aura)
    g.addColorStop(0.48, theme.auraMid)
    g.addColorStop(1, theme.auraClear)
    c.fillStyle = g
    c.fillRect(0, 0, N, N)
    auras.set(key, img)
  }
  return img
}

// Where an edge meets a node, and the direction it leaves in, for an edge heading along (dx, dy).
// The root's branches leave in every direction, so they start on its outline; every other node
// is met at the middle of its left or right side, or of its top or bottom when the two nodes
// overlap side to side (`side` false).
function anchor(m, p, dx, dy, root, side) {
  if (root) {
    const e = exit(m, dx, dy)
    return { x: p.x + dx * e, y: p.y + dy * e, tx: dx, ty: dy }
  }
  if (side) {
    const sx = dx < 0 ? -1 : 1
    return { x: p.x + (sx * m.w) / 2, y: p.y, tx: sx, ty: 0 }
  }
  // stacked nodes: leave straight up or down, bending toward the other end
  const sy = dy < 0 ? -1 : 1
  const [tx, ty] = unit(dx, dy + sy * 0.8)
  return { x: p.x, y: p.y + (sy * m.h) / 2, tx, ty }
}

// Fill a cubic Bézier as a ribbon whose width runs from w0 to w1, (Its ends are flat; they sit against a node or under a leaf's dot.)
const SEGS = 18
function ribbon(ctx, [x0, y0, x1, y1, x2, y2, x3, y3], w0, w1) {
  const left = []
  const right = []
  for (let n = 0; n <= SEGS; n++) {
    const t = n / SEGS
    const u = 1 - t
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
    const [nx, ny] = unit(
      -(3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2)),
      3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2)
    )
    const h = (w0 + (w1 - w0) * t) / 2
    left.push(x + nx * h, y + ny * h)
    right.push(x - nx * h, y - ny * h)
  }
  ctx.beginPath()
  ctx.moveTo(left[0], left[1])
  for (let n = 2; n < left.length; n += 2) ctx.lineTo(left[n], left[n + 1])
  for (let n = right.length - 2; n >= 0; n -= 2) ctx.lineTo(right[n], right[n + 1])
  ctx.closePath()
  ctx.fill()
}

export function drawMap(ctx, s) {
  const { view, theme, info, nodes } = s
  // While the view moves (scroll, pan, pinch, drag, animation) the costliest effects are left
  // out: edge glow, node shadows, edge colour blends and the inner highlight. The app draws
  // one full frame once it settles.
  const moving = Boolean(s.moving)
  drawBackdrop(ctx, s)
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)

  if (s.grid) {
    const gap = 32 * view.scale
    if (gap > 10) {
      ctx.fillStyle = theme.grid
      const r = Math.min(1.4, Math.max(0.65, 0.85 * view.scale))
      ctx.beginPath()
      for (let gx = ((view.x % gap) + gap) % gap; gx < s.width; gx += gap) {
        for (let gy = ((view.y % gap) + gap) % gap; gy < s.height; gy += gap) {
          ctx.moveTo(gx + r, gy)
          ctx.arc(gx, gy, r, 0, Math.PI * 2)
        }
      }
      ctx.fill()
    }
  }

  ctx.setTransform(s.dpr * view.scale, 0, 0, s.dpr * view.scale, s.dpr * view.x, s.dpr * view.y)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // colours per node, worked out once per frame
  const colors = new Map()
  const col = i => {
    let c = colors.get(i)
    if (!c) colors.set(i, (c = colorsFor(i, s)))
    return c
  }

  // Branch focus: hovering a top-level branch fades the others back. top[i] is the
  // top-level node above i (or i itself); the root and its own edges never fade.
  let fade = null
  if (s.focus) {
    const top = []
    for (let i = 0; i < nodes.length; i++) {
      let j = i
      while (info.depth[j] > 1) j = info.parent[j]
      top[i] = j
    }
    const dim = 1 - 0.62 * s.focus.k
    fade = i => (info.depth[i] === 0 || top[i] === s.focus.branch ? 1 : dim)
  }

  // edges: tapered curves, thick at the parent and fine at the child, leaving and meeting
  // each node at the middle of the side that faces the other end
  for (const { start, end } of s.connections) {
    if (!info.visible[start] || !info.visible[end]) continue
    const a = s.pos(start)
    const b = s.pos(end)
    const [dx, dy] = unit(b.x - a.x, b.y - a.y)
    const ma = s.size(start)
    const mb = s.size(end)
    const side = Math.abs(b.x - a.x) - (ma.w + mb.w) / 2 > 14
    const from = anchor(ma, a, dx, dy, info.parent[start] === null, side)
    const to = anchor(mb, b, -dx, -dy, false, side)
    const dist = Math.hypot(to.x - from.x, to.y - from.y)
    if (dist < 2) continue
    const k = dist * (side ? 0.5 : 0.4)
    const curve = [from.x, from.y, from.x + from.tx * k, from.y + from.ty * k, to.x + to.tx * k, to.y + to.ty * k, to.x, to.y]
    const depth = info.depth[end]
    const target = col(end)
    const [w0, w1] = depth <= 1 ? [5.5, 2.6] : depth === 2 ? [2.4, 1.5] : [1.7, 1.2]
    let edge = target.edge
    if (!moving && depth <= 1) {
      edge = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
      edge.addColorStop(0, col(start).edge)
      edge.addColorStop(0.55, target.edge)
    }
    ctx.save()
    ctx.globalAlpha = (depth <= 1 ? 0.9 : 0.72) * (fade ? fade(end) : 1)
    ctx.fillStyle = edge
    ribbon(ctx, curve, w0, w1)
    if (!target.surface) {
      // the leaf's marker: a dot where the curve arrives
      ctx.globalAlpha = fade ? fade(end) : 1
      ctx.fillStyle = target.edge
      ctx.beginPath()
      ctx.arc(to.x, to.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // nodes: everything else first, then the branch being dragged on top
  const dimming = s.matches && s.matches.size > 0
  const drawNode = (i, lifted) => {
    const n = nodes[i]
    const p = s.pos(i)
    const m = s.size(i)
    const c = col(i)
    const x = p.x - m.w / 2
    const y = p.y - m.h / 2
    const editing = s.editing === i

    ctx.save()
    const g = s.appear ? s.appear(i) : 1
    if (g < 1) {
      const k = 0.6 + 0.4 * (1 + 2.2 * (g - 1) ** 3 + 1.2 * (g - 1) ** 2) // easeOutBack
      ctx.translate(p.x, p.y)
      ctx.scale(k, k)
      ctx.translate(-p.x, -p.y)
      ctx.globalAlpha = Math.min(1, g * 2)
    }
    if (dimming && !s.matches.has(i) && s.selected !== i) ctx.globalAlpha = 0.35
    else if (fade) ctx.globalAlpha *= fade(i)
    const selected = s.selected === i && !lifted
    const hovered = s.hover === i && !lifted
    // a text-only node gets a card while it's selected, edited or dragged
    const card = c.surface || selected || editing || lifted
    if (!editing) {
      if (selected && info.depth[i] === 0) {
        // the root is already violet: separate it with a background gap, then the ring
        ring(ctx, p, m, 2.5, 3, theme.bg)
        ring(ctx, p, m, 5, 2.5, theme.accent)
      } else if (selected) {
        ring(ctx, p, m, 3.5, 1.75, theme.accent)
      } else if (s.matches?.has(i)) {
        ring(ctx, p, m, 3, 1.5, `rgba(${theme.accentRgb},0.5)`)
      } else if (hovered && c.surface) {
        ring(ctx, p, m, 3, 1.5, theme.accentSoft)
      } else if (hovered) {
        box(ctx, x, y, m.w, m.h, m.r)
        ctx.fillStyle = theme.leafHover
        ctx.fill()
      }
    }
    if (s.flash && s.flash.ids.has(n['@id'])) {
      const t = s.flash.t
      ring(ctx, p, m, s.reduced ? 8 : 8 + 12 * (1 - t), 3, `rgba(${theme.accentRgb},${0.65 * t})`)
    }

    if (card) {
      ctx.save()
      // shadows only for the root, the selection and what's being dragged
      if (lifted) {
        ctx.globalAlpha *= s.drop !== null && s.drop !== undefined ? 0.5 : 0.92
        ctx.shadowColor = 'rgba(20,20,50,0.28)'
        ctx.shadowBlur = 24
        ctx.shadowOffsetY = 8
      } else if (!moving && info.depth[i] === 0) {
        ctx.shadowColor = theme.accentSoft
        ctx.shadowBlur = 30
        ctx.shadowOffsetY = 9
      } else if (!moving && (selected || editing)) {
        ctx.shadowColor = theme.shadow
        ctx.shadowBlur = 16
        ctx.shadowOffsetY = 5
      }
      // the fill gradient runs from the box's top to its bottom: drawn at the origin, one
      // gradient per colour pair and height serves every node
      ctx.translate(x, y)
      box(ctx, 0, 0, m.w, m.h, m.r)
      ctx.fillStyle = c.surface ? (c.fillHi && c.fillLo ? fillGradient(ctx, c.fillHi, c.fillLo, m.h) : c.fill) : theme.leaf
      ctx.fill()
      ctx.restore()
      if (c.border) {
        box(ctx, x + 0.5, y + 0.5, m.w - 1, m.h - 1, m.r)
        ctx.lineWidth = c.lw
        ctx.strokeStyle = c.border
        ctx.stroke()
      }
    }

    if (!editing) {
      const text = c.text && !card ? c.text : readableText(card && !c.surface ? theme.leaf : c.fill)
      if (m.pic) drawPicture(ctx, m, s.picture?.(n) ?? null, p.x, y + m.pic.pad, text)
      ctx.font = m.font
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      if (!card && !hovered) {
        // text on the canvas sits on a patch of background, so a passing edge doesn't cut it
        const ph = m.h * 0.66
        box(ctx, x + m.tx - 3, p.y + m.ty - ph / 2 + 0.5, m.tw + 6, ph, 6)
        ctx.fillStyle = theme.bg
        ctx.globalAlpha *= 0.9
        ctx.fill()
        ctx.globalAlpha /= 0.9
      }
      ctx.fillStyle = text
      ctx.fillText(n.name, x + m.tx, p.y + m.ty + 1)
      const li = linkIconAt(i, s)
      if (li) {
        // quiet until the node is hovered or selected
        const lit = hovered || selected
        if (lit) {
          ctx.save()
          ctx.fillStyle = text
          ctx.globalAlpha *= 0.1
          ctx.beginPath()
          ctx.arc(li.x, li.y, 7.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        ctx.save()
        ctx.strokeStyle = lit || !c.surface ? theme.accent : text
        ctx.globalAlpha *= lit ? 0.9 : 0.4
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(li.x - 4, li.y + 4)
        ctx.lineTo(li.x + 4, li.y - 4)
        ctx.moveTo(li.x - 1.5, li.y - 4)
        ctx.lineTo(li.x + 4, li.y - 4)
        ctx.lineTo(li.x + 4, li.y + 1.5)
        ctx.stroke()
        ctx.restore()
      }
    }

    // fold badge: a count when folded, a minus on the selected / hovered node
    const collapsed = info.hidden[i] > 0
    if (!lifted && (collapsed || ((s.selected === i || s.hover === i) && info.kids[i].length))) {
      const b = badgeAt(i, s)
      const edgeCol = c.edge
      ctx.save()
      if (!moving) {
        ctx.shadowColor = c.glow
        ctx.shadowBlur = 10
      }
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2)
      ctx.fillStyle = theme.bg
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fillStyle = collapsed ? edgeCol : theme.badgeBg
      ctx.fill()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = edgeCol
      ctx.stroke()
      if (collapsed) {
        ctx.fillStyle = readableText(edgeCol)
        ctx.font = `700 11px ${STACK}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(Math.min(info.hidden[i], 99)), b.x, b.y + 0.5)
      } else {
        ctx.beginPath()
        ctx.moveTo(b.x - 4.5, b.y)
        ctx.lineTo(b.x + 4.5, b.y)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  const lifted = s.dragging || null
  nodes.forEach((_, i) => info.visible[i] && !lifted?.has(i) && drawNode(i, false))
  if (lifted) for (const i of lifted) if (info.visible[i]) drawNode(i, true)
  // the drop target goes on top of everything so it's never hidden by what's being dragged
  if (s.drop !== null && s.drop !== undefined && info.visible[s.drop]) {
    const p = s.pos(s.drop)
    const m = s.size(s.drop)
    box(ctx, p.x - m.w / 2 - 8, p.y - m.h / 2 - 8, m.w + 16, m.h + 16, m.r + 8)
    ctx.fillStyle = theme.accentSoft
    ctx.fill()
    ring(ctx, p, m, 8, 3, theme.accent)
  }
}
