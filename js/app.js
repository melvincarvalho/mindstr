import { authFetch, getPubkey, hasSigner } from './nostr-auth.js'

const STORAGE_ROOT = 'https://nosdav.net'
const DOC_VIEWER = 'https://nosdav.com/doc/?uri='
const NODE_H = 36
const FONT = '500 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MIN_SCALE = 0.1
const MAX_SCALE = 5
const DRAG_THRESHOLD = 4
const DOUBLE_TAP_MS = 350
const HISTORY_LIMIT = 100

// ---------- DOM ----------

const $ = sel => document.querySelector(sel)
const stage = $('#stage')
const canvas = $('#canvas')
const ctx = canvas.getContext('2d')
const editor = $('#editor')
const banner = $('#banner')
const toastEl = $('#toast')
const statusEl = $('#status')
const helpDialog = $('#help')
const island = $('#initialData')

// ---------- state ----------

const params = new URLSearchParams(location.search)
const exampleParam = params.get('example')
const mapUrl =
  params.get('map') ||
  (/^[\w-]+$/.test(exampleParam || '') ? `examples/${exampleParam}.json` : null)
const titleParam = params.get('title')
// Maps hosted alongside the app (e.g. examples/) are read-only: gh-pages can't take a PUT.
const readOnly = Boolean(mapUrl) && new URL(mapUrl, location.href).origin === location.origin

const state = {
  nodes: [],
  connections: [],
  selected: null,
  view: { x: 0, y: 0, scale: 1 },
  editing: null, // { index, original, isNew }
  dirty: false,
  canSave: Boolean(mapUrl) && !readOnly,
  saving: false
}
let undoStack = []
let redoStack = []

// ---------- model helpers ----------

const newId = () =>
  '#' +
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
    (b % 36).toString(36)
  ).join('')

function normalize(data) {
  const raw = data && typeof data === 'object' ? data : {}
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter(n => n && typeof n === 'object')
    .map(n => ({
      ...n,
      '@id': typeof n['@id'] === 'string' ? n['@id'] : newId(),
      name: typeof n.name === 'string' ? n.name : String(n.name ?? ''),
      x: Number.isFinite(+n.x) ? +n.x : 0,
      y: Number.isFinite(+n.y) ? +n.y : 0
    }))
  if (!nodes.length) nodes.push({ '@id': '#this', name: 'New', x: 0, y: 0 })
  nodes[0]['@id'] = '#this'
  const valid = i => Number.isInteger(i) && i >= 0 && i < nodes.length
  const connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .filter(c => c && valid(c.start) && valid(c.end) && c.start !== c.end)
    .map(c => ({ start: c.start, end: c.end }))
  const selected = valid(raw.selectedNode) ? raw.selectedNode : 0
  return { nodes, connections, selected }
}

function serialize() {
  return {
    version: '0.1',
    nodes: state.nodes,
    connections: state.connections,
    selectedNode: state.selected
  }
}

const parentOf = i => state.connections.find(c => c.end === i)?.start ?? null
const childrenOf = i =>
  state.connections.filter(c => c.start === i).map(c => c.end)

function snapshot() {
  return JSON.stringify({
    nodes: state.nodes,
    connections: state.connections,
    selected: state.selected
  })
}

function restore(snap) {
  const s = JSON.parse(snap)
  state.nodes = s.nodes
  state.connections = s.connections
  state.selected = s.selected
}

// Call before every mutation.
function checkpoint() {
  undoStack.push(snapshot())
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack = []
}

const syncIsland = () => (island.textContent = JSON.stringify(serialize()))

function changed() {
  state.dirty = true
  syncIsland()
  updateUi()
  invalidate()
}

function undo() {
  if (!undoStack.length) return
  redoStack.push(snapshot())
  restore(undoStack.pop())
  changed()
}

function redo() {
  if (!redoStack.length) return
  undoStack.push(snapshot())
  restore(redoStack.pop())
  changed()
}

// ---------- geometry ----------

let dpr = 1
let width = 0
let height = 0

function nodeWidth(node) {
  ctx.font = FONT
  return Math.max(ctx.measureText(node.name || ' ').width + 32, 56)
}

const toWorld = (sx, sy) => ({
  x: (sx - state.view.x) / state.view.scale,
  y: (sy - state.view.y) / state.view.scale
})
const toScreen = (wx, wy) => ({
  x: wx * state.view.scale + state.view.x,
  y: wy * state.view.scale + state.view.y
})

function hitTest(p) {
  // Topmost (last drawn) node wins.
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i]
    const rx = nodeWidth(n) / 2
    const ry = NODE_H / 2
    if (((p.x - n.x) / rx) ** 2 + ((p.y - n.y) / ry) ** 2 <= 1) return i
  }
  return -1
}

function onLabel(i, p) {
  const n = state.nodes[i]
  const half = (nodeWidth(n) - 32) / 2 + 4
  return Math.abs(p.x - n.x) <= half && Math.abs(p.y - n.y) <= 12
}

function placeChild(parentIndex) {
  const p = state.nodes[parentIndex]
  const gp = parentOf(parentIndex)
  const k = childrenOf(parentIndex).length
  let angle
  if (gp === null) {
    angle = (k * Math.PI) / 4 // root: fan out all around
  } else {
    const g = state.nodes[gp]
    const base = Math.atan2(p.y - g.y, p.x - g.x)
    const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1)
    angle = base + step * 0.45
  }
  const r = 170
  const pos = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r }
  for (let tries = 0; tries < 12; tries++) {
    const clash = state.nodes.some(
      n => Math.abs(n.x - pos.x) < 90 && Math.abs(n.y - pos.y) < NODE_H + 8
    )
    if (!clash) break
    pos.y += NODE_H + 12
  }
  return pos
}

// ---------- drawing ----------

const dark = matchMedia('(prefers-color-scheme: dark)')
const palette = () =>
  dark.matches
    ? {
        bg: '#15171c',
        grid: '#1f232a',
        edge: '#5b6372',
        node: '#232833',
        stroke: '#8a93a3',
        text: '#e8eaee',
        link: '#7fb2ff',
        selFill: '#1e3a5f',
        selStroke: '#7fb2ff'
      }
    : {
        bg: '#fafafa',
        grid: '#eceef1',
        edge: '#9aa1ad',
        node: '#ffffff',
        stroke: '#3c4350',
        text: '#1b1f27',
        link: '#1a5fd0',
        selFill: '#dcebff',
        selStroke: '#1a5fd0'
      }

let frame = 0
function invalidate() {
  if (!frame) frame = requestAnimationFrame(draw)
}

function draw() {
  frame = 0
  const c = palette()
  const { x: ox, y: oy, scale } = state.view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, width, height)

  // dot grid
  const gap = 40 * scale
  if (gap > 8) {
    ctx.fillStyle = c.grid
    const r = Math.max(1, 1.5 * Math.min(scale, 1.5))
    for (let gx = ox % gap; gx < width; gx += gap) {
      for (let gy = oy % gap; gy < height; gy += gap) {
        ctx.fillRect(gx - r / 2, gy - r / 2, r, r)
      }
    }
  }

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.lineWidth = 1.5
  ctx.strokeStyle = c.edge
  for (const { start, end } of state.connections) {
    const a = state.nodes[start]
    const b = state.nodes[end]
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    const mx = (a.x + b.x) / 2
    ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y)
    ctx.stroke()
  }

  state.nodes.forEach((n, i) => {
    if (state.editing?.index === i) return
    const w = nodeWidth(n)
    const sel = state.selected === i
    ctx.beginPath()
    ctx.ellipse(n.x, n.y, w / 2, NODE_H / 2, 0, 0, Math.PI * 2)
    ctx.fillStyle = sel ? c.selFill : n.bgColor || c.node
    ctx.fill()
    ctx.lineWidth = sel ? 2.5 : i === 0 ? 2 : 1.25
    ctx.strokeStyle = sel ? c.selStroke : c.stroke
    ctx.stroke()

    const textColor = n.link ? c.link : n.bgColor && dark.matches ? '#1b1f27' : c.text
    ctx.fillStyle = textColor
    ctx.fillText(n.name, n.x, n.y + 1)
    if (n.link) {
      const tw = ctx.measureText(n.name).width
      ctx.beginPath()
      ctx.moveTo(n.x - tw / 2, n.y + 10)
      ctx.lineTo(n.x + tw / 2, n.y + 10)
      ctx.lineWidth = 1
      ctx.strokeStyle = textColor
      ctx.stroke()
    }
  })
}

function resize() {
  const rect = stage.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  positionEditor()
  invalidate()
}

function zoomAt(sx, sy, factor) {
  const v = state.view
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const k = next / v.scale
  v.x = sx - (sx - v.x) * k
  v.y = sy - (sy - v.y) * k
  v.scale = next
  positionEditor()
  invalidate()
}

function fitView() {
  if (!state.nodes.length || !width) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of state.nodes) {
    const hw = nodeWidth(n) / 2
    minX = Math.min(minX, n.x - hw)
    maxX = Math.max(maxX, n.x + hw)
    minY = Math.min(minY, n.y - NODE_H / 2)
    maxY = Math.max(maxY, n.y + NODE_H / 2)
  }
  const pad = 48
  const scale = Math.min(
    (width - pad * 2) / (maxX - minX || 1),
    (height - pad * 2) / (maxY - minY || 1),
    1.25
  )
  state.view.scale = Math.max(MIN_SCALE, scale)
  state.view.x = width / 2 - ((minX + maxX) / 2) * state.view.scale
  state.view.y = height / 2 - ((minY + maxY) / 2) * state.view.scale
  positionEditor()
  invalidate()
}

function ensureVisible(i) {
  const n = state.nodes[i]
  const s = toScreen(n.x, n.y)
  const margin = 60
  if (s.x < margin || s.x > width - margin || s.y < margin || s.y > height - margin) {
    state.view.x += width / 2 - s.x
    state.view.y += height / 2 - s.y
    invalidate()
  }
}

// ---------- actions ----------

function select(i) {
  if (state.selected === i) return
  state.selected = i
  syncIsland()
  updateUi()
  invalidate()
}

function addChild(parentIndex = state.selected ?? 0) {
  if (!state.nodes[parentIndex]) return
  commitEdit()
  checkpoint()
  const pos = placeChild(parentIndex)
  state.nodes.push({ '@id': newId(), name: '', ...pos })
  const index = state.nodes.length - 1
  state.connections.push({ start: parentIndex, end: index })
  state.selected = index
  changed()
  ensureVisible(index)
  startEdit(index, true)
}

function addSibling() {
  const sel = state.selected
  if (sel === null) return addChild(0)
  const parent = parentOf(sel)
  addChild(parent === null ? sel : parent)
}

function deleteSelected() {
  const del = state.selected
  if (del === null) return
  if (del === 0) return toast('The root node can’t be deleted')
  commitEdit()
  checkpoint()
  const parent = parentOf(del)
  const conns = []
  for (const c of state.connections) {
    if (c.end === del) continue
    let { start, end } = c
    if (start === del) {
      if (parent === null) continue
      start = parent // re-attach orphans to the deleted node's parent
    }
    conns.push({ start: start > del ? start - 1 : start, end: end > del ? end - 1 : end })
  }
  state.nodes.splice(del, 1)
  state.connections = conns
  state.selected = parent === null ? 0 : parent > del ? parent - 1 : parent
  changed()
}

function editLink() {
  const i = state.selected
  if (i === null) return
  commitEdit()
  const current = state.nodes[i].link || ''
  const value = prompt('Link for this node (blank to remove):', current)
  if (value === null || value.trim() === current) return
  checkpoint()
  const node = { ...state.nodes[i] }
  if (value.trim()) node.link = value.trim()
  else delete node.link
  state.nodes[i] = node
  changed()
}

function openLink(node) {
  const raw = (node.link || '').trim()
  if (!raw) return
  const base = mapUrl ? new URL(mapUrl, location.href) : new URL(location.href)
  let url
  try {
    url = new URL(raw, base)
  } catch {
    return toast('Invalid link: ' + raw)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return toast('Blocked non-http link')
  }
  let target = url.href
  if (url.pathname.endsWith('.md')) {
    target = DOC_VIEWER + encodeURIComponent(url.href)
  } else if (/^\.\.?\//.test(raw) && mapUrl) {
    // relative link → another mind map next to this one
    const here = new URL(location.href)
    here.search = ''
    const example =
      url.origin === location.origin &&
      url.pathname.match(/\/examples\/([\w-]+)\.json$/)
    if (example) here.searchParams.set('example', example[1])
    else here.searchParams.set('map', url.href)
    target = here.href
  }
  window.open(target, '_blank', 'noopener')
}

function navigate(dx, dy) {
  const from = state.nodes[state.selected ?? 0]
  let best = -1
  let bestScore = Infinity
  state.nodes.forEach((n, i) => {
    if (i === state.selected) return
    const ex = n.x - from.x
    const ey = n.y - from.y
    const primary = ex * dx + ey * dy
    if (primary <= 1) return
    const secondary = Math.abs(ex * dy - ey * dx)
    const score = primary + secondary * 2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  if (best >= 0) {
    select(best)
    ensureVisible(best)
  }
}

// ---------- inline editor ----------

function startEdit(index, isNew = false) {
  commitEdit()
  const node = state.nodes[index]
  state.editing = { index, original: node.name, isNew }
  state.selected = index
  editor.value = node.name
  editor.hidden = false
  positionEditor()
  editor.focus()
  editor.select()
  updateUi()
  invalidate()
}

function positionEditor() {
  if (!state.editing) return
  const n = state.nodes[state.editing.index]
  const s = toScreen(n.x, n.y)
  const scale = Math.min(Math.max(state.view.scale, 0.75), 1.5)
  editor.style.left = s.x + 'px'
  editor.style.top = s.y + 'px'
  editor.style.width = Math.max(nodeWidth(n) * state.view.scale, 160) + 'px'
  editor.style.fontSize = 15 * scale + 'px'
}

function commitEdit() {
  const e = state.editing
  if (!e) return
  state.editing = null
  editor.hidden = true
  const name = editor.value.trim()
  state.nodes[e.index].name = e.original // undo the live preview first
  if (e.isNew && !name) {
    // abandoned new node: drop it without leaving an undo step behind
    restore(undoStack.pop())
    changed()
    return
  }
  if (name !== e.original) {
    if (!e.isNew) checkpoint()
    state.nodes[e.index] = { ...state.nodes[e.index], name }
    changed()
  } else {
    invalidate()
    updateUi()
  }
}

function cancelEdit() {
  const e = state.editing
  if (!e) return
  editor.value = e.isNew ? '' : e.original
  commitEdit()
}

editor.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    const i = state.editing.index
    commitEdit()
    if (state.nodes[i]) addChild(i)
  }
})
editor.addEventListener('blur', () => commitEdit())
editor.addEventListener('input', () => {
  if (!state.editing) return
  const n = state.nodes[state.editing.index]
  n.name = editor.value // live width; committed properly on blur/enter
  positionEditor()
})

// ---------- pointer input ----------

const pointers = new Map()
let gesture = null
let lastTap = { index: -1, time: 0 }

function localPoint(e) {
  const r = canvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2
  }
}

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  commitEdit()
  canvas.setPointerCapture(e.pointerId)
  const p = localPoint(e)
  pointers.set(e.pointerId, p)

  if (pointers.size === 2) {
    if (gesture?.type === 'node' && gesture.moved) finishDrag()
    gesture = { type: 'pinch', ...pinchInfo() }
    return
  }
  if (pointers.size > 2) return

  const w = toWorld(p.x, p.y)
  const hit = hitTest(w)
  if (hit >= 0) {
    select(hit)
    const n = state.nodes[hit]
    gesture = {
      type: 'node',
      index: hit,
      start: p,
      dx: n.x - w.x,
      dy: n.y - w.y,
      moved: false,
      onLink: Boolean(n.link) && onLabel(hit, w)
    }
  } else {
    gesture = { type: 'pan', start: p, last: p, moved: false }
  }
})

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return
  const p = localPoint(e)
  pointers.set(e.pointerId, p)
  if (!gesture) return

  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const now = pinchInfo()
    state.view.x += now.cx - gesture.cx
    state.view.y += now.cy - gesture.cy
    zoomAt(now.cx, now.cy, now.dist / gesture.dist)
    Object.assign(gesture, now)
    return
  }

  const far =
    Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD
  if (gesture.type === 'node') {
    if (!gesture.moved && !far) return
    if (!gesture.moved) {
      checkpoint()
      gesture.moved = true
      canvas.classList.add('dragging')
    }
    const w = toWorld(p.x, p.y)
    const n = state.nodes[gesture.index]
    n.x = w.x + gesture.dx
    n.y = w.y + gesture.dy
    invalidate()
  } else if (gesture.type === 'pan') {
    if (far) gesture.moved = true
    state.view.x += p.x - gesture.last.x
    state.view.y += p.y - gesture.last.y
    gesture.last = p
    canvas.classList.toggle('dragging', gesture.moved)
    positionEditor()
    invalidate()
  }
})

function finishDrag() {
  canvas.classList.remove('dragging')
  if (gesture?.type === 'node' && gesture.moved) {
    gesture.moved = false
    changed()
  }
}

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return
  const g = gesture
  if (!g) return
  if (g.type === 'pinch') {
    if (pointers.size === 0) gesture = null
    return // ignore the remaining finger until it lifts
  }
  if (pointers.size) return
  gesture = null
  if (e.type === 'pointercancel') return finishDrag()

  if (g.type === 'node') {
    if (g.moved) return finishDrag()
    const now = performance.now()
    if (lastTap.index === g.index && now - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = { index: -1, time: 0 }
      return startEdit(g.index)
    }
    lastTap = { index: g.index, time: now }
    if (g.onLink) openLink(state.nodes[g.index])
  } else if (g.type === 'pan') {
    canvas.classList.remove('dragging')
    if (!g.moved) {
      lastTap = { index: -1, time: 0 }
      select(null)
    }
  }
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

canvas.addEventListener(
  'wheel',
  e => {
    e.preventDefault()
    const p = localPoint(e)
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    zoomAt(p.x, p.y, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)))
  },
  { passive: false }
)

canvas.addEventListener('pointermove', e => {
  if (gesture || e.pointerType !== 'mouse') return
  const w = toWorld(...Object.values(localPoint(e)))
  const hit = hitTest(w)
  canvas.style.cursor =
    hit < 0 ? '' : state.nodes[hit].link && onLabel(hit, w) ? 'pointer' : 'move'
})

// ---------- keyboard ----------

document.addEventListener('keydown', e => {
  if (helpDialog.open) return
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
  if (t instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

  const handled = (() => {
    if (mod && key === 's') return save(), true
    if (mod && key === 'z') return (e.shiftKey ? redo() : undo()), true
    if (mod && key === 'y') return redo(), true
    if (mod && (key === 'k' || key === 'm')) return editLink(), true
    if (mod || e.altKey) return false
    switch (key) {
      case 'Tab':
      case 'Insert':
        return addChild(), true
      case 'Enter':
        return addSibling(), true
      case 'F2':
        return state.selected !== null && startEdit(state.selected), true
      case 'Delete':
      case 'Backspace':
        return deleteSelected(), true
      case 'Escape':
        return select(null), true
      case 'ArrowLeft':
        return navigate(-1, 0), true
      case 'ArrowRight':
        return navigate(1, 0), true
      case 'ArrowUp':
        return navigate(0, -1), true
      case 'ArrowDown':
        return navigate(0, 1), true
      case 'f':
      case '0':
        return fitView(), true
      case '+':
      case '=':
        return zoomAt(width / 2, height / 2, 1.2), true
      case '-':
        return zoomAt(width / 2, height / 2, 1 / 1.2), true
      case '?':
        return helpDialog.showModal(), true
      case 'o':
        return state.selected !== null && openLink(state.nodes[state.selected]), true
    }
    return false
  })()
  if (handled) e.preventDefault()
})

// ---------- toolbar ----------

const actions = {
  child: () => addChild(),
  sibling: () => addSibling(),
  edit: () => state.selected !== null && startEdit(state.selected),
  link: () => editLink(),
  open: () => state.selected !== null && openLink(state.nodes[state.selected]),
  delete: () => deleteSelected(),
  undo,
  redo,
  fit: fitView,
  save: () => save(),
  login: () => login(),
  help: () => helpDialog.showModal()
}

for (const btn of document.querySelectorAll('[data-action]')) {
  // keep focus (and keyboard shortcuts) on the canvas after mouse clicks
  btn.addEventListener('mousedown', e => e.preventDefault())
  btn.addEventListener('click', () => actions[btn.dataset.action]())
}

function updateUi() {
  const sel = state.selected
  const has = sel !== null && Boolean(state.nodes[sel])
  const set = (action, enabled) => {
    const b = document.querySelector(`[data-action="${action}"]`)
    if (b) b.disabled = !enabled
  }
  set('sibling', has)
  set('edit', has)
  set('link', has)
  set('open', has && Boolean(state.nodes[sel].link))
  set('delete', has && sel !== 0)
  set('undo', undoStack.length > 0)
  set('redo', redoStack.length > 0)
  set('save', state.canSave && !state.saving)

  statusEl.textContent = !mapUrl
    ? 'Scratch map'
    : readOnly
      ? 'Example (read-only)'
      : !state.canSave
      ? 'Read-only'
      : state.saving
        ? 'Saving…'
        : state.dirty
          ? 'Unsaved'
          : 'Saved'
  statusEl.dataset.state = state.dirty && state.canSave ? 'dirty' : ''
  document.title = 'Mindstr – ' + (state.nodes[0]?.name || 'untitled')
}

// ---------- feedback ----------

let toastTimer
function toast(msg, ms = 3200) {
  toastEl.textContent = msg
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms)
}

function showBanner(msg) {
  banner.textContent = msg
  banner.hidden = false
  requestAnimationFrame(resize)
}

// ---------- persistence ----------

async function save() {
  commitEdit()
  if (!mapUrl) {
    return toast('Sign in (🔐) to get a map you can save, or open one with ?map=')
  }
  if (readOnly) {
    return toast('Examples are read-only. Press 🔐 to open your own map.', 5000)
  }
  if (!state.canSave || state.saving) return
  state.saving = true
  updateUi()
  try {
    const res = await authFetch(mapUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serialize(), null, 2)
    })
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? hasSigner()
            ? ' — this key can’t write here'
            : ' — sign in with a Nostr extension'
          : ''
      throw new Error(`HTTP ${res.status}${hint}`)
    }
    state.dirty = false
    toast('Saved')
    new Audio('./audio/save.ogg').play().catch(() => {})
  } catch (err) {
    toast('Save failed: ' + err.message, 6000)
  } finally {
    state.saving = false
    updateUi()
  }
}

async function login() {
  commitEdit()
  let pubkey
  try {
    pubkey = await getPubkey()
  } catch (err) {
    return toast('Sign-in cancelled: ' + err.message)
  }
  if (!pubkey) {
    return toast('Install a Nostr signer extension (NIP-07) to sign in', 6000)
  }
  try {
    localStorage.setItem('currentUser', pubkey)
    if (state.dirty) {
      sessionStorage.setItem('mindstr:pending', JSON.stringify(serialize()))
    }
  } catch {}
  const target = new URL(location.href)
  target.search = ''
  target.searchParams.set('map', `${STORAGE_ROOT}/${pubkey}/mm/index.json`)
  if (target.href !== location.href) location.href = target.href
  else toast('This is your map')
}

function takePending() {
  try {
    const raw = sessionStorage.getItem('mindstr:pending')
    sessionStorage.removeItem('mindstr:pending')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

window.addEventListener('beforeunload', e => {
  if (state.dirty && state.canSave) e.preventDefault()
})

async function load() {
  let data = JSON.parse(island.textContent)
  let isNew = true
  if (mapUrl) {
    try {
      const res = await fetch(mapUrl, { cache: 'no-cache' })
      if (res.status === 404) {
        data = takePending() || data
        toast('New map — press Ctrl+S to create it', 5000)
      } else if (!res.ok) {
        throw new Error('HTTP ' + res.status)
      } else {
        data = await res.json()
        isNew = false
      }
    } catch (err) {
      state.canSave = false
      showBanner(
        `Couldn’t load ${mapUrl} (${err.message}). Saving is disabled so the original isn’t overwritten.`
      )
    }
  }
  const { nodes, connections, selected } = normalize(data)
  if (isNew && titleParam) nodes[0].name = titleParam
  state.nodes = nodes
  state.connections = connections
  state.selected = selected
  state.dirty = isNew && Boolean(mapUrl) && state.canSave
  syncIsland()
  resize()
  fitView()
  updateUi()
}

new ResizeObserver(resize).observe(stage)
dark.addEventListener('change', invalidate)
document.fonts?.ready.then(invalidate)
load()
