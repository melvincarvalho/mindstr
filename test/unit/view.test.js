// The view maths: world ↔ screen, zoom, pinch, wheel, fit, animation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  animateView, boundsOf, fitBox, MAX_SCALE, MIN_SCALE, panBy, pinchInfo, pinchTo, stepView,
  toScreen, toWorld, VIEW_ANIM_MS, wheel, wheelDelta, zoomAt
} from '../../js/view.js'

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≈ ${b}`)

test('toWorld and toScreen are inverses', () => {
  const view = { x: 120, y: -40, scale: 1.7 }
  const s = toScreen(view, 33, -12)
  const w = toWorld(view, s.x, s.y)
  close(w.x, 33)
  close(w.y, -12)
})

test('zoomAt keeps the point under the cursor fixed', () => {
  const view = { x: 10, y: 20, scale: 1 }
  const before = toWorld(view, 300, 200)
  zoomAt(view, 300, 200, 2)
  assert.equal(view.scale, 2)
  const after = toWorld(view, 300, 200)
  close(after.x, before.x)
  close(after.y, before.y)
})

test('zoomAt clamps to MIN_SCALE and MAX_SCALE', () => {
  assert.equal(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 1000).scale, MAX_SCALE)
  assert.equal(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 0.0001).scale, MIN_SCALE)
})

test('panBy moves the view', () => {
  assert.deepEqual(panBy({ x: 1, y: 2, scale: 1 }, 10, -5), { x: 11, y: -3, scale: 1 })
})

test('pinch: spreading two fingers zooms about their midpoint', () => {
  const view = { x: 0, y: 0, scale: 1 }
  const prev = pinchInfo({ x: 100, y: 100 }, { x: 200, y: 100 })
  const now = pinchInfo({ x: 50, y: 100 }, { x: 250, y: 100 })
  const before = toWorld(view, prev.cx, prev.cy)
  pinchTo(view, prev, now)
  close(view.scale, 2)
  const after = toWorld(view, now.cx, now.cy)
  close(after.x, before.x)
  close(after.y, before.y)
  assert.equal(pinchInfo({ x: 5, y: 5 }, { x: 5, y: 5 }).dist, 1, 'no divide by zero')
})

test('wheelDelta: plain wheel pans, Ctrl/Cmd zooms, Shift pans sideways, line mode scales', () => {
  assert.deepEqual(wheelDelta({ deltaX: 3, deltaY: 40, deltaMode: 0 }, 800), { dx: -3, dy: -40 })
  assert.deepEqual(wheelDelta({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true }, 800), { dx: -40, dy: -0 })
  assert.deepEqual(wheelDelta({ deltaX: 0, deltaY: 2, deltaMode: 1 }, 800), { dx: -0, dy: -32 })
  assert.ok(wheelDelta({ deltaY: -10, deltaMode: 0, ctrlKey: true }, 800).zoom > 1, 'scroll up zooms in')
  assert.ok(wheelDelta({ deltaY: 10, deltaMode: 0, metaKey: true }, 800).zoom < 1, 'scroll down zooms out')
  const big = wheelDelta({ deltaY: -5000, deltaMode: 0, ctrlKey: true }, 800).zoom
  close(big, Math.exp(0.6), 'one wheel step is capped')
})

test('wheel applies the delta and reports whether it zoomed', () => {
  const view = { x: 0, y: 0, scale: 1 }
  assert.equal(wheel(view, { deltaX: 0, deltaY: 10, deltaMode: 0 }, { x: 0, y: 0 }, 800), false)
  assert.equal(view.y, -10)
  assert.equal(wheel(view, { deltaY: -10, deltaMode: 0, ctrlKey: true }, { x: 0, y: 0 }, 800), true)
  assert.ok(view.scale > 1)
})

test('boundsOf and fitBox: the box ends up centred in the area, within the cap', () => {
  const nodes = [
    { p: { x: -100, y: -50 }, m: { w: 40, h: 20 } },
    { p: { x: 300, y: 150 }, m: { w: 60, h: 30 } }
  ]
  const box = boundsOf(fn => nodes.forEach(n => fn(n.p, n.m)))
  assert.deepEqual(box, { minX: -120, minY: -60, maxX: 330, maxY: 165 })
  const area = { width: 1000, top: 50, bottom: 650, pad: 40 }
  const view = fitBox(box, area)
  const centre = toScreen(view, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2)
  close(centre.x, 500)
  close(centre.y, 350)
  const tl = toScreen(view, box.minX, box.minY)
  const br = toScreen(view, box.maxX, box.maxY)
  assert.ok(tl.x >= 40 - 1e-9 && br.x <= 960 + 1e-9 && tl.y >= 90 - 1e-9 && br.y <= 610 + 1e-9, 'inside the padding')
  assert.equal(fitBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, area).scale, 1.25, 'small maps stop at the cap')
  assert.equal(fitBox({ minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 }, area).scale, MIN_SCALE, 'huge maps stop at the minimum')
})

test('stepView eases from start to end in VIEW_ANIM_MS', () => {
  const view = { x: 0, y: 0, scale: 1 }
  const anim = animateView(view, { x: 100, y: -100, scale: 2 }, 0)
  assert.equal(stepView(view, anim, VIEW_ANIM_MS / 2), true)
  assert.ok(view.x > 50 && view.x < 100, 'ease-out is past halfway at half time')
  assert.equal(stepView(view, anim, VIEW_ANIM_MS), false)
  assert.deepEqual(view, { x: 100, y: -100, scale: 2 })
})
