// The view: where the map sits on the canvas and how big. Pure maths shared by the app and
// the maker: a view is { x, y, scale } (screen = world * scale + offset), and these helpers
// pan, zoom about a point, read a pinch, normalise a wheel event, fit a box and animate.

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4
export const DRAG_THRESHOLD = 5 // px before a press becomes a drag
export const VIEW_ANIM_MS = 260

export const toWorld = (view, sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale })
export const toScreen = (view, wx, wy) => ({ x: wx * view.scale + view.x, y: wy * view.scale + view.y })

// Zoom by `factor` keeping the screen point (sx, sy) fixed. Mutates and returns `view`.
export function zoomAt(view, sx, sy, factor) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const k = next / view.scale
  view.x = sx - (sx - view.x) * k
  view.y = sy - (sy - view.y) * k
  view.scale = next
  return view
}

export function panBy(view, dx, dy) {
  view.x += dx
  view.y += dy
  return view
}

// Two pointers → their distance and midpoint.
export function pinchInfo(a, b) {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
}

// Apply the change between two pinch readings: pan with the midpoint, zoom with the spread.
export function pinchTo(view, prev, now) {
  panBy(view, now.cx - prev.cx, now.cy - prev.cy)
  return zoomAt(view, now.cx, now.cy, now.dist / prev.dist)
}

// A wheel event, normalised: either { zoom: factor } (pinch on a trackpad, or Ctrl/Cmd+wheel)
// or { dx, dy } to pan by. `height` is the canvas height for page-mode deltas; `at` is the
// pointer in canvas coordinates. Shift turns a vertical wheel into a horizontal pan.
export function wheelDelta(e, height) {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1
  if (e.ctrlKey || e.metaKey) {
    const d = Math.max(-60, Math.min(60, e.deltaY * k))
    return { zoom: Math.exp(-d * 0.01) }
  }
  const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k
  const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k
  return { dx: -dx, dy: -dy }
}

// Apply a wheel event to the view. Returns true when it zoomed.
export function wheel(view, e, at, height) {
  const d = wheelDelta(e, height)
  if (d.zoom) {
    zoomAt(view, at.x, at.y, d.zoom)
    return true
  }
  panBy(view, d.dx, d.dy)
  return false
}

// The view that shows the world box { minX, minY, maxX, maxY } inside the canvas area.
// area: { width, top, bottom } (top/bottom leave room for bars); pad in px; cap = max scale.
export function fitBox(box, { width, top = 0, bottom, pad = 40, cap = 1.25, min = MIN_SCALE }) {
  const w = box.maxX - box.minX || 1
  const h = box.maxY - box.minY || 1
  const scale = Math.max(min, Math.min((width - pad * 2) / w, (bottom - top - pad * 2) / h, cap))
  return {
    scale,
    x: width / 2 - ((box.minX + box.maxX) / 2) * scale,
    y: (top + bottom) / 2 - ((box.minY + box.maxY) / 2) * scale
  }
}

// Bounding box of nodes, given their centre and size. `each(fn)` calls fn(pos, size) per node.
export function boundsOf(each) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  each((p, m) => {
    b.minX = Math.min(b.minX, p.x - m.w / 2)
    b.maxX = Math.max(b.maxX, p.x + m.w / 2)
    b.minY = Math.min(b.minY, p.y - m.h / 2)
    b.maxY = Math.max(b.maxY, p.y + m.h / 2)
  })
  return b
}

const easeOut = t => 1 - (1 - t) ** 3

// Start an animation from the current view to `to`: returns the anim handle to pass to step().
export const animateView = (view, to, t0 = performance.now()) => ({ from: { ...view }, to, t0 })

// Advance `view` along `anim` at time `now`. Returns true while still moving.
export function stepView(view, anim, now = performance.now()) {
  const t = Math.min(1, (now - anim.t0) / VIEW_ANIM_MS)
  const e = easeOut(t)
  const { from, to } = anim
  view.x = from.x + (to.x - from.x) * e
  view.y = from.y + (to.y - from.y) * e
  view.scale = from.scale + (to.scale - from.scale) * e
  return t < 1
}
