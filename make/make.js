// Make a map: type a topic, Claude writes it as an outline, the map grows on screen as the
// outline streams in. Runs entirely in the browser with the visitor's own API key.
import { radialLayout } from '../js/layout.js'
import { drawMap, linkIconAt, makeMeasure, THEMES } from '../js/render.js'
import { parseOutline, toMarkdown } from '../js/outline.js'
import { BRANCH_COLORS } from '../js/colors.js'
import { boundsOf, DRAG_THRESHOLD, fitBox, panBy, pinchInfo, pinchTo, toWorld, wheel } from '../js/view.js'
import { growMessage, grownKids, KEY_STORE, SETTINGS_STORE, stream as claudeStream, topicFor } from '../js/claude.js'
import { buildMap, buildRequest, buildSystem, countNodes as count, newId } from '../js/build.js'
import { cost as costAt, money, PRICES, stopwatch, tally } from '../js/usage.js'
import { chime, pop, unlock } from '../js/sound.js'
import { cachesFrom, findCached, openUrl } from '../js/cache.js'

// Ready-made maps (#45): look in the caches before asking Claude; ?cache=off always builds
const cacheParam = new URLSearchParams(location.search).get('cache')
const caches = cachesFrom(cacheParam)

// the Build click or Enter is the gesture that lets the page make sound (js/sound.js)
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })

const $ = s => document.querySelector(s)
const SAVE_HELPER = 'http://localhost:5463/save'
// ---------- settings ----------
const fields = ['depth', 'breadth', 'model', 'style', 'lang', 'links', 'think']
const settings = Object.fromEntries(fields.map(f => [f, $('#' + f).value]))
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_STORE) || '{}'))
  $('#key').value = localStorage.getItem(KEY_STORE) || ''
} catch {}
for (const f of fields) {
  const el = $('#' + f)
  if (settings[f] !== undefined) el.value = settings[f]
  el.addEventListener('input', () => {
    settings[f] = el.value
    try { localStorage.setItem(SETTINGS_STORE, JSON.stringify(settings)) } catch {}
    showRanges()
  })
}
const showRanges = () => {
  $('#depthOut').value = settings.depth
  $('#breadthOut').value = settings.breadth
}
showRanges()
$('#key').addEventListener('input', () => {
  try { localStorage.setItem(KEY_STORE, $('#key').value.trim()) } catch {}
})
$('#gear').addEventListener('click', () => {
  const open = $('#settings').hidden
  $('#settings').hidden = !open
  $('#gear').setAttribute('aria-expanded', String(open))
})
for (const chip of document.querySelectorAll('.chip')) chip.addEventListener('click', () => { $('#q').value = chip.textContent; build() })
$('#form').addEventListener('submit', e => { e.preventDefault(); build() })

// Prices in $ per million tokens (js/usage.js), editable, saved with the other settings.
let prices = { ...PRICES }
try { prices = { ...PRICES, ...JSON.parse(localStorage.getItem('mindstr.make.prices') || '{}') } } catch {}
for (const f of Object.keys(PRICES)) {
  ;['in', 'out'].forEach((side, k) => {
    const el = $(`#p-${f}-${side}`)
    el.value = prices[f][k]
    el.addEventListener('input', () => {
      prices[f] = [...prices[f]]
      prices[f][k] = Number(el.value) || 0
      try { localStorage.setItem('mindstr.make.prices', JSON.stringify(prices)) } catch {}
    })
  })
}
const cost = (req, model) => costAt(req, model, prices)

// ---------- the tree ----------
// tree: { id, name, link?, kids: [tree] }
let tree = null
let busy = false

// Claude's streamed text, as it arrives (js/claude.js), with this page's key and settings.
async function* stream(messages, { signal, extra = {} } = {}) {
  const key = $('#key').value.trim()
  if (!key) throw new Error('Add your Claude API key under ⚙ first.')
  yield* claudeStream({ key, model: settings.model, think: settings.think === 'yes', system: buildSystem(settings), messages, signal, extra })
}

let abort = null
async function build() {
  const q = $('#q').value.trim()
  if (!q || busy) return
  // a ready-made map needs no key: open it in the app, growing, and say where it came from
  if (caches.length) {
    status('Looking for a ready-made map…')
    const hit = await findCached(q, caches)
    if (hit) {
      try {
        sessionStorage.setItem('mindstr:cacheHit', JSON.stringify({ source: hit.source, topic: q }))
      } catch {}
      location.href = openUrl(new URL('../', location.href).href, hit, cacheParam)
      return
    }
    status('')
  }
  if (!$('#key').value.trim()) {
    $('#settings').hidden = false
    $('#gear').setAttribute('aria-expanded', 'true')
    $('#key').focus()
    return
  }
  abort?.abort()
  abort = new AbortController()
  busy = true
  document.body.classList.replace('home', 'built')
  $('#settings').hidden = true
  $('#gear').setAttribute('aria-expanded', 'false')
  $('#actions').hidden = true
  $('#open').hidden = true
  $('#go').disabled = true
  $('#go').textContent = 'Building…'
  tree = null
  resetView()
  // A URL in the request: the API fetches the page (web_fetch server tool) and the map summarises it.
  const { urls } = buildRequest(q)
  const who = settings.model.replace('claude-', '').replace(/-/g, ' ')
  status(urls.length ? `Fetching ${urls.length === 1 ? 'the page' : urls.length + ' pages'}, then asking ${who}…` : `Asking ${who}…`)
  let req = {}
  const watch = stopwatch()
  try {
    for await (const step of buildMap(q, { key: $('#key').value.trim(), settings, signal: abort.signal })) {
      req = step.usage
      setTree(step.tree)
      watch.firstNode()
      if (!step.done) status(`Building… ${count(tree)} nodes`)
    }
    const nodes = count(tree)
    status(`${nodes} nodes · ${watch.took(nodes)} · ${spent(req)}`, 'done')
    $('#actions').hidden = false
    chime()
  } catch (e) {
    if (e.name !== 'AbortError') status(e.message, 'err')
  } finally {
    busy = false
    $('#go').disabled = false
    $('#go').textContent = 'Build'
  }
}

// Ask for the children of one leaf, in the context of the whole map.
const pathTo = i => {
  const path = []
  for (let j = i; j !== null && j !== undefined; j = flat.parent[j]) path.unshift(flat.nodes[j].name)
  return path
}

async function grow(i) {
  if (busy || !tree) return
  const node = flat.nodes[i]
  if (node.kids.length) return
  const path = pathTo(i)
  busy = true
  status(`Growing “${node.name}”…`)
  let text = ''
  const req = {}
  const watch = stopwatch()
  try {
    const messages = [{ role: 'user', content: growMessage({ outline: toMarkdown(tree), name: node.name, path, count: settings.breadth }) }]
    const pending = []
    for await (const chunk of stream(messages)) {
      if (chunk.usage) { tally(chunk.usage, req); continue }
      text += chunk.text
      const complete = text.slice(0, text.lastIndexOf('\n') + 1)
      const kids = grownKids(complete)
      kids.forEach((k, j) => {
        if (!pending[j]) {
          pending[j] = { id: newId(), name: k.name, link: k.link, kids: [] }
          node.kids.push(pending[j])
        } else Object.assign(pending[j], { name: k.name, link: k.link })
      })
      setTree(tree)
      if (pending.length) watch.firstNode()
    }
    status(`${count(tree)} nodes · ${watch.took(pending.length)} · ${spent(req)}`, 'done')
  } catch (e) {
    status(e.message, 'err')
  } finally {
    busy = false
  }
}

// Tokens for the whole page session (a request's tokens: tally in js/usage.js)
const used = { input: 0, output: 0, calls: 0, usd: 0 }
function spent(req) {
  const usd = cost(req, settings.model)
  used.input += req.input || 0
  used.output += req.output || 0
  used.usd += usd
  used.calls++
  return `${(req.input || 0) + (req.output || 0)} tokens (${req.input || 0} in, ${req.output || 0} out) ≈ ${money(usd)} · session ${used.input + used.output} tokens ≈ ${money(used.usd)} in ${used.calls} call${used.calls === 1 ? '' : 's'}`
}

// ---------- flatten, lay out, draw ----------
const canvas = $('#map')
const ctx = canvas.getContext('2d')
const measure = makeMeasure(ctx)
const dark = matchMedia('(prefers-color-scheme: dark)')
let flat = { nodes: [], connections: [], parent: [], kids: [], depth: [], branchColor: [] }
const current = new Map() // id → { x, y } drawn now
const target = new Map() // id → { x, y } where layout wants it
const appearing = new Map() // id → time first seen
let view = { x: 0, y: 0, scale: 1 }
let viewTarget = null
let userMoved = false // once the visitor pans or zooms, the map stops re-fitting itself
let width = 0
let height = 0
let dpr = 1
let hover = null

function resetView() {
  current.clear()
  target.clear()
  appearing.clear()
  viewTarget = null
  userMoved = false
  $('#fit').hidden = true
  flat = { nodes: [], connections: [], parent: [], kids: [], depth: [], branchColor: [] }
  invalidate()
}

function setTree(t) {
  tree = t
  const nodes = []
  const connections = []
  const parent = []
  const kids = []
  const depth = []
  const branchColor = []
  const walk = (n, par, d, col) => {
    const i = nodes.length
    nodes.push(n)
    parent.push(par)
    kids.push([])
    depth.push(d)
    branchColor.push(col)
    if (par !== null) {
      kids[par].push(i)
      connections.push({ start: par, end: i })
    }
    n.kids.forEach((k, j) => walk(k, i, d + 1, d === 0 ? BRANCH_COLORS[j % BRANCH_COLORS.length] : col))
  }
  walk(t, null, 0, BRANCH_COLORS[0])
  flat = { nodes, connections, parent, kids, depth, branchColor }
  const placed = radialLayout(0, i => kids[i], i => measure(nodes[i], depth[i]))
  const now = performance.now()
  let newest = -1
  nodes.forEach((n, i) => {
    const p = placed.get(i)
    target.set(n.id, p)
    if (!current.has(n.id)) {
      newest = i
      // start a new node at its parent, so it grows out of it
      const from = parent[i] !== null ? current.get(nodes[parent[i]].id) || p : p
      current.set(n.id, { x: from.x, y: from.y })
      appearing.set(n.id, now)
    }
  })
  // a pop for new nodes, its note set by their main branch (js/sound.js merges a burst into one)
  if (newest > 0) {
    let top = newest
    while (parent[top] !== 0 && parent[top] !== null) top = parent[top]
    pop(kids[0].indexOf(top))
  }
  fit()
  invalidate()
}

function fit(force = false) {
  if (!flat.nodes.length || (userMoved && !force)) return
  const box = boundsOf(fn => flat.nodes.forEach((n, i) => fn(target.get(n.id), measure(n, flat.depth[i]))))
  viewTarget = fitBox(box, { width, top: 0, bottom: height - 30, pad: 48, cap: 1.1 }) // the status pill sits in the bottom margin
  invalidate()
}
$('#fit').addEventListener('click', () => {
  userMoved = false
  $('#fit').hidden = true
  fit(true)
})
const moved = () => {
  userMoved = true
  viewTarget = null
  $('#fit').hidden = false
}

const pos = i => current.get(flat.nodes[i].id)
const size = i => measure(flat.nodes[i], flat.depth[i])
const appearT = i => {
  const t0 = appearing.get(flat.nodes[i].id)
  if (t0 === undefined) return 1
  const t = (performance.now() - t0) / 300
  if (t >= 1) appearing.delete(flat.nodes[i].id)
  return Math.min(1, t)
}

function resize() {
  const r = canvas.getBoundingClientRect()
  width = r.width
  height = r.height
  dpr = devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  measure.reset()
  fit()
  if (viewTarget && !flat.nodes.length) view = viewTarget
  invalidate()
}
new ResizeObserver(resize).observe(canvas)
dark.addEventListener('change', invalidate)

let frame = 0
function invalidate() {
  if (!frame) frame = requestAnimationFrame(draw)
}
function draw() {
  frame = 0
  if (!width) return
  let moving = false
  const ease = (a, b) => (Math.abs(a - b) < 0.5 ? b : a + (b - a) * 0.18)
  for (const [id, t] of target) {
    const c = current.get(id)
    const nx = ease(c.x, t.x)
    const ny = ease(c.y, t.y)
    if (nx !== c.x || ny !== c.y) moving = true
    c.x = nx
    c.y = ny
  }
  if (viewTarget) {
    const v = { x: ease(view.x, viewTarget.x), y: ease(view.y, viewTarget.y), scale: Math.abs(view.scale - viewTarget.scale) < 0.001 ? viewTarget.scale : view.scale + (viewTarget.scale - view.scale) * 0.18 }
    if (v.x !== view.x || v.y !== view.y || v.scale !== view.scale) moving = true
    view = v
  }
  const n = flat.nodes.length
  drawMap(ctx, {
    nodes: flat.nodes,
    connections: flat.connections,
    info: { parent: flat.parent, kids: flat.kids, depth: flat.depth, branchColor: flat.branchColor, visible: Array(n).fill(true), hidden: Array(n).fill(0) },
    pos,
    size,
    view,
    width,
    height,
    dpr,
    dark: dark.matches,
    theme: dark.matches ? THEMES.dark : THEMES.light,
    selected: null,
    hover,
    drop: null,
    dragging: null,
    badgeR: 11,
    editing: null,
    flash: null,
    appear: appearT,
    matches: null,
    reduced: false,
    grid: true
  })
  if (moving || appearing.size) invalidate()
}

// hit testing in canvas coordinates
const local = ev => {
  const r = canvas.getBoundingClientRect()
  return { x: ev.clientX - r.left, y: ev.clientY - r.top }
}
function hit(ev) {
  const { x, y } = toWorld(view, ...Object.values(local(ev)))
  for (let i = flat.nodes.length - 1; i >= 0; i--) {
    const p = pos(i)
    const m = size(i)
    if (Math.abs(x - p.x) <= m.w / 2 && Math.abs(y - p.y) <= m.h / 2) return i
  }
  return null
}
// the ↗ icon opens the link, as in the app; the rest of the node grows it
function onIcon(ev, i) {
  const li = linkIconAt(i, { nodes: flat.nodes, size, pos })
  if (!li) return false
  const { x, y } = toWorld(view, ...Object.values(local(ev)))
  return Math.hypot(x - li.x, y - li.y) <= li.r + 2
}
// Pan by dragging, zoom with the wheel or a pinch, click a node to grow it (shared view maths).
const pointers = new Map()
let gesture = null // { start, last, moved, hit, icon } or { pinch }
canvas.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  canvas.setPointerCapture(ev.pointerId)
  const p = local(ev)
  pointers.set(ev.pointerId, p)
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    gesture = { pinch: pinchInfo(a, b) }
    return
  }
  if (pointers.size > 2) return
  const h = hit(ev)
  gesture = { start: p, last: p, moved: false, hit: h, icon: h !== null && Boolean(flat.nodes[h].link) && onIcon(ev, h) }
  hideMenu()
  if (h !== null && ev.pointerType !== 'mouse') {
    // a long press on touch opens the same menu as a right-click
    gesture.hold = setTimeout(() => {
      if (gesture?.hit === h && !gesture.moved) {
        gesture.menu = true
        showMenu(h, p)
      }
    }, 500)
  }
})
canvas.addEventListener('pointermove', ev => {
  const p = local(ev)
  if (!pointers.has(ev.pointerId)) {
    if (ev.pointerType !== 'mouse') return
    const h = hit(ev)
    if (h !== hover) {
      hover = h
      invalidate()
    }
    canvas.style.cursor = h !== null && (!flat.kids[h].length || (flat.nodes[h].link && onIcon(ev, h))) ? 'pointer' : h !== null ? 'grab' : ''
    return
  }
  pointers.set(ev.pointerId, p)
  if (!gesture) return
  if (gesture.pinch) {
    if (pointers.size < 2) return
    const [a, b] = [...pointers.values()]
    const now = pinchInfo(a, b)
    pinchTo(view, gesture.pinch, now)
    gesture.pinch = now
    moved()
    invalidate()
    return
  }
  if (!gesture.moved && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD) {
    gesture.moved = true
    clearTimeout(gesture.hold)
    canvas.style.cursor = 'grabbing'
  }
  if (gesture.moved) {
    panBy(view, p.x - gesture.last.x, p.y - gesture.last.y)
    moved()
    invalidate()
  }
  gesture.last = p
})
function endPointer(ev) {
  if (!pointers.delete(ev.pointerId)) return
  const g = gesture
  if (!g) return
  if (g.pinch) {
    if (!pointers.size) gesture = null
    return
  }
  if (pointers.size) return
  gesture = null
  clearTimeout(g.hold)
  canvas.style.cursor = ''
  if (ev.type === 'pointercancel' || g.moved || g.menu || g.hit === null) return
  const n = flat.nodes[g.hit]
  if (n.link && (g.icon || ev.altKey)) return window.open(n.link, '_blank', 'noopener')
  grow(g.hit)
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)
canvas.addEventListener('pointerleave', () => { hover = null; invalidate() })
canvas.addEventListener('contextmenu', ev => {
  ev.preventDefault()
  const h = hit(ev)
  if (h !== null) showMenu(h, local(ev))
})

// ---------- node menu: grow, open as a new map, open link ----------
const menu = $('#menu')
let menuFor = null
function showMenu(i, p) {
  menuFor = i
  const n = flat.nodes[i]
  $('#m-grow').hidden = n.kids.length > 0
  $('#m-link').hidden = !n.link
  menu.hidden = false
  const r = canvas.getBoundingClientRect()
  menu.style.left = Math.min(p.x, r.width - menu.offsetWidth - 8) + 'px'
  menu.style.top = Math.min(p.y, r.height - menu.offsetHeight - 8) + 'px'
  $('#m-grow').hidden ? $('#m-map').focus() : $('#m-grow').focus()
}
function hideMenu() {
  menu.hidden = true
  menuFor = null
}
$('#m-grow').addEventListener('click', () => { const i = menuFor; hideMenu(); if (i !== null) grow(i) })
$('#m-link').addEventListener('click', () => { const n = flat.nodes[menuFor]; hideMenu(); if (n?.link) window.open(n.link, '_blank', 'noopener') })
$('#m-map').addEventListener('click', () => {
  const i = menuFor
  hideMenu()
  if (i === null) return
  // the node as the topic, its ancestors as context, built on arrival by the ?q= form
  const topic = topicFor(pathTo(i))
  const u = new URL(location.href)
  u.search = ''
  u.searchParams.set('q', topic)
  window.open(u.href, '_blank', 'noopener')
})
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hideMenu() })
document.addEventListener('pointerdown', ev => { if (!menu.hidden && !menu.contains(ev.target)) hideMenu() })

canvas.addEventListener('wheel', ev => {
  ev.preventDefault()
  wheel(view, ev, local(ev), height)
  moved()
  invalidate()
}, { passive: false })

// ---------- output ----------
function toDoc() {
  const nodes = flat.nodes.map((n, i) => {
    const p = target.get(n.id)
    const out = { '@id': n.id, name: n.name, x: p.x, y: p.y }
    if (flat.depth[i] === 1) out.bgColor = flat.branchColor[i]
    if (n.link) out.link = n.link
    if (flat.parent[i] !== null) out.parent = flat.nodes[flat.parent[i]].id
    return out
  })
  return {
    '@context': { '@vocab': 'https://mindstr.org/ns#', link: { '@type': '@id' }, parent: { '@type': '@id' } },
    version: '0.2',
    nodes,
    connections: flat.connections,
    selectedNode: 0
  }
}
const json = () => JSON.stringify(toDoc(), null, 2) + '\n'
const slug = () => (tree?.name || 'map').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'map'

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    status(`${label} copied`, 'done')
  } catch {
    status('Copy failed: your browser blocked the clipboard', 'err')
  }
}
$('#copy').addEventListener('click', () => copy(json(), 'JSON-LD'))
$('#copyMd').addEventListener('click', () => copy(toMarkdown(tree), 'Outline'))
$('#download').addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json()], { type: 'application/ld+json' }))
  a.download = slug() + '.jsonld'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
})
// Saving goes through a helper that only runs beside a local pod; elsewhere the map is copied or downloaded.
if (location.hostname !== 'localhost') $('#save').hidden = true
$('#save').addEventListener('click', async () => {
  status('Saving to the pod…')
  try {
    const res = await fetch(SAVE_HELPER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: slug(), doc: toDoc() }) })
    if (!res.ok) throw new Error(await res.text())
    const { url } = await res.json()
    const open = new URL('../', location.href)
    open.searchParams.set('uri', url)
    $('#open').href = open.href
    $('#open').hidden = false
    status('Saved', 'done')
  } catch (e) {
    status(`Save failed: ${e.message}. Is the save helper running? (node mindstr/make-save.js)`, 'err')
  }
})

function status(text, kind = '') {
  const el = $('#status')
  el.hidden = false
  el.className = 'status ' + kind
  el.innerHTML = kind === 'err' ? '' : '<span class="dot"></span>'
  el.append(text)
}

// ?q=… builds straight away
const q = new URLSearchParams(location.search).get('q')
if (q) {
  $('#q').value = q
  build()
}
