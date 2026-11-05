// Canvas rendering for mind maps. Pure drawing: the app passes in a `scene`.
import { BRANCH_COLORS, readableText, tones } from './colors.js'

const STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif'
// Node styles by depth: root, top-level branch, everything deeper.
export const STYLES = [
  { font: `800 20px Manrope, ${STACK}`, padX: 24, h: 50, r: 25 },
  { font: `700 15px Manrope, ${STACK}`, padX: 17, h: 38, r: 14 },
  { font: `600 14px Manrope, ${STACK}`, padX: 14, h: 32, r: 11 }
]
const LINK_W = 20 // room for the ↗ icon
const ROOT_FILL = '#6d4aff'
const ROOT_HI = '#8b5cf6'
const ROOT_LO = '#5438df'

export const THEMES = {
  light: {
    bg: '#f6f7fb',
    grid: 'rgba(63,55,105,0.055)',
    leaf: '#ffffff',
    leafHi: '#ffffff',
    leafLo: '#f2f3f9',
    shadow: 'rgba(43,32,85,0.12)',
    accent: '#6d4aff',
    accentRgb: '109,74,255',
    accentSoft: 'rgba(109,74,255,0.22)',
    badgeBg: '#ffffff',
    muted: '#687080',
    aura: 'rgba(124,93,250,0.13)',
    auraMid: 'rgba(124,93,250,0.045)',
    auraClear: 'rgba(124,93,250,0)',
    wash: 'rgba(80,170,255,0.09)',
    washClear: 'rgba(80,170,255,0)',
    nodeHighlight: 'rgba(255,255,255,0.72)'
  },
  dark: {
    bg: '#11131b',
    grid: 'rgba(255,255,255,0.045)',
    leaf: '#20242e',
    leafHi: '#2a2f3b',
    leafLo: '#1b1f28',
    shadow: 'rgba(0,0,0,0.32)',
    accent: '#a28bff',
    accentRgb: '162,139,255',
    accentSoft: 'rgba(162,139,255,0.30)',
    badgeBg: '#171a23',
    muted: '#9aa2b1',
    aura: 'rgba(124,93,250,0.19)',
    auraMid: 'rgba(124,93,250,0.05)',
    auraClear: 'rgba(124,93,250,0)',
    wash: 'rgba(34,211,238,0.075)',
    washClear: 'rgba(34,211,238,0)',
    nodeHighlight: 'rgba(255,255,255,0.08)'
  }
}

export function makeMeasure(ctx) {
  const widths = new Map()
  const measure = (node, depth) => {
    const st = STYLES[Math.min(depth, 2)]
    const key = st.font + '\u0000' + node.name
    let tw = widths.get(key)
    if (tw === undefined) {
      ctx.font = st.font
      tw = ctx.measureText(node.name || ' ').width
      if (widths.size > 5000) widths.clear()
      widths.set(key, tw)
    }
    const link = node.link ? LINK_W : 0
    return { ...st, tw, w: Math.max(tw + st.padX * 2 + link, 48), link: Boolean(node.link) }
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
  return { x: p.x - m.w / 2 + m.padX + m.tw + 11, y: p.y, r: 12 }
}

export function colorsFor(i, s) {
  const n = s.nodes[i]
  const d = s.info.depth[i]
  const branch = s.info.branchColor[i] || BRANCH_COLORS[0]
  const bt = tones(branch, s.dark)
  if (d === 0) return { fill: ROOT_FILL, fillHi: ROOT_HI, fillLo: ROOT_LO, border: null, lw: 0, edge: s.theme.accent, glow: s.theme.accentSoft }
  if (d === 1 || n.bgColor) {
    const t = tones(n.bgColor || branch, s.dark)
    return { fill: t.fill, fillHi: t.fillHi, fillLo: t.fillLo, border: t.border, lw: 1.25, edge: bt.edge, glow: t.glow }
  }
  return { fill: s.theme.leaf, fillHi: s.theme.leafHi, fillLo: s.theme.leafLo, border: bt.border, lw: 1, edge: bt.edge, glow: bt.glow }
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

export function drawMap(ctx, s) {
  const { view, theme, info, nodes } = s
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, s.width, s.height)

  const root = nodes.length ? s.pos(0) : null
  const cx = root ? root.x * view.scale + view.x : s.width / 2
  const cy = root ? root.y * view.scale + view.y : s.height / 2
  const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(s.width, s.height) * 0.62)
  aura.addColorStop(0, theme.aura)
  aura.addColorStop(0.48, theme.auraMid)
  aura.addColorStop(1, theme.auraClear)
  ctx.fillStyle = aura
  ctx.fillRect(0, 0, s.width, s.height)
  const wash = ctx.createRadialGradient(s.width * 0.9, s.height * 0.08, 0, s.width * 0.9, s.height * 0.08, Math.max(s.width, s.height) * 0.7)
  wash.addColorStop(0, theme.wash)
  wash.addColorStop(1, theme.washClear)
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, s.width, s.height)

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

  // edges
  for (const { start, end } of s.connections) {
    if (!info.visible[start] || !info.visible[end]) continue
    const a = s.pos(start)
    const b = s.pos(end)
    const ma = s.size(start)
    const mb = s.size(end)
    const [dx, dy] = unit(b.x - a.x, b.y - a.y)
    const [fx, fy] = info.parent[start] === null ? [dx, dy] : outward(start, s)
    const ea = exit(ma, dx, dy)
    const eb = exit(mb, dx, dy)
    const p0 = [a.x + dx * ea, a.y + dy * ea]
    const p3 = [b.x - dx * eb, b.y - dy * eb]
    const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    if (dist < 2) continue
    const [cx, cy] = unit(fx + dx, fy + dy)
    ctx.beginPath()
    ctx.moveTo(p0[0], p0[1])
    ctx.bezierCurveTo(p0[0] + cx * dist * 0.45, p0[1] + cy * dist * 0.45, p3[0] - dx * dist * 0.35, p3[1] - dy * dist * 0.35, p3[0], p3[1])
    const depth = info.depth[end]
    const source = colorsFor(start, s)
    const target = colorsFor(end, s)
    const lineWidth = depth <= 1 ? 3.25 : depth === 2 ? 1.9 : 1.5
    ctx.save()
    ctx.lineWidth = lineWidth + (depth <= 1 ? 9 : 5)
    ctx.strokeStyle = target.glow
    ctx.stroke()
    ctx.restore()
    const edge = ctx.createLinearGradient(p0[0], p0[1], p3[0], p3[1])
    edge.addColorStop(0, source.edge)
    edge.addColorStop(1, target.edge)
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = edge
    ctx.stroke()
  }

  // nodes: everything else first, then the branch being dragged on top
  const dimming = s.matches && s.matches.size > 0
  const drawNode = (i, lifted) => {
    const n = nodes[i]
    const p = s.pos(i)
    const m = s.size(i)
    const c = colorsFor(i, s)
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
    if (!editing) {
      if (s.selected === i && !lifted && info.depth[i] === 0) {
        // the root is already violet: separate it with a background gap, then the ring
        ring(ctx, p, m, 2.5, 3, theme.bg)
        ring(ctx, p, m, 5, 2.5, theme.accent)
      } else if (s.selected === i && !lifted) {
        ring(ctx, p, m, 6, 5, theme.accentSoft)
        ring(ctx, p, m, 3, 2, theme.accent)
      } else if (s.matches?.has(i)) {
        ring(ctx, p, m, 3, 1.5, `rgba(${theme.accentRgb},0.5)`)
      } else if (s.hover === i && !lifted) {
        ring(ctx, p, m, 3, 2, theme.accentSoft)
      }
    }
    if (s.flash && s.flash.ids.has(n['@id'])) {
      const t = s.flash.t
      ring(ctx, p, m, s.reduced ? 8 : 8 + 12 * (1 - t), 3, `rgba(${theme.accentRgb},${0.65 * t})`)
    }

    ctx.save()
    if (lifted) {
      ctx.globalAlpha *= s.drop !== null && s.drop !== undefined ? 0.5 : 0.92
      ctx.shadowColor = 'rgba(20,20,50,0.28)'
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 8
    } else {
      const isRoot = info.depth[i] === 0
      ctx.shadowColor = isRoot ? theme.accentSoft : s.dark ? theme.shadow : c.glow
      ctx.shadowBlur = isRoot ? 30 : 14
      ctx.shadowOffsetY = isRoot ? 9 : 4
    }
    box(ctx, x, y, m.w, m.h, m.r)
    if (c.fillHi && c.fillLo) {
      const fill = ctx.createLinearGradient(x, y, x, y + m.h)
      fill.addColorStop(0, c.fillHi)
      fill.addColorStop(1, c.fillLo)
      ctx.fillStyle = fill
    } else {
      ctx.fillStyle = c.fill
    }
    ctx.fill()
    ctx.restore()
    if (c.border) {
      box(ctx, x + 0.5, y + 0.5, m.w - 1, m.h - 1, m.r)
      ctx.lineWidth = c.lw
      ctx.strokeStyle = c.border
      ctx.stroke()
    }
    box(ctx, x + 1.25, y + 1.25, m.w - 2.5, m.h - 2.5, Math.max(0, m.r - 1.25))
    ctx.lineWidth = 0.75
    ctx.strokeStyle = theme.nodeHighlight
    ctx.stroke()

    if (!editing) {
      const text = readableText(c.fill)
      ctx.font = m.font
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = text
      ctx.fillText(n.name, x + m.padX, p.y + 1)
      const li = linkIconAt(i, s)
      if (li) {
        ctx.save()
        ctx.fillStyle = text
        ctx.globalAlpha *= 0.1
        ctx.beginPath()
        ctx.arc(li.x, li.y, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.strokeStyle = s.dark && c.fill === theme.leaf ? theme.accent : text
        ctx.globalAlpha *= 0.85
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
      const col = c.edge
      ctx.save()
      ctx.shadowColor = c.glow
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2)
      ctx.fillStyle = theme.bg
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fillStyle = collapsed ? col : theme.badgeBg
      ctx.fill()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = col
      ctx.stroke()
      if (collapsed) {
        ctx.fillStyle = readableText(col)
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
