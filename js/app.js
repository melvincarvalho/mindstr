import { authFetch, hostPod, identity, login as openLogin, MAP_PATH, myMapUrl, ready } from './pod.js'
import { watch } from './live.js'
import { BRANCH_COLORS } from './colors.js'
import { badgeAt, drawMap, linkIconAt, makeMeasure, THEMES } from './render.js'
import { radialLayout } from './layout.js'
import { parseOutline, toMarkdown } from './outline.js'

const DOC_VIEWER = 'https://nosdav.com/doc/?uri='
const MIN_SCALE = 0.1
const MAX_SCALE = 4
const DRAG_THRESHOLD = 5
const DOUBLE_TAP_MS = 350
const HISTORY_LIMIT = 200
const ANIM_MS = 220
const FLASH_MS = 2400
const NEW_NODE = { w: 150, h: 34 }

// ---------- DOM ----------

const $ = sel => document.querySelector(sel)
const stage = $('#stage')
const canvas = $('#canvas')
const ctx = canvas.getContext('2d')
const tree = $('#tree')
const editor = $('#editor')
const banner = $('#banner')
const toastEl = $('#toast')
const statusEl = $('#status')
const announceEl = $('#announce')
const helpDialog = $('#help')
const linkDialog = $('#linkDialog')
const linkInput = $('#linkInput')
const importDialog = $('#importDialog')
const importText = $('#importText')
const menu = $('#menu')
const menuBtn = $('#menuBtn')
const findBar = $('#find')
const findInput = $('#findInput')
const findCount = $('#findCount')
const hint = $('#hint')
const island = $('#initialData')
const saveLabel = $('#saveLabel')

const dark = matchMedia('(prefers-color-scheme: dark)')
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const coarse = matchMedia('(pointer: coarse)')
const store = {
  get: k => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
    } catch {}
  }
}
const session = {
  get: k => {
    try {
      return sessionStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v)
    } catch {}
  }
}

// ---------- where the map lives ----------

const params = new URLSearchParams(location.search)
const exampleParam = params.get('example')
// ?uri= is canonical (relative or absolute .json / .jsonld); ?map= and ?example= are aliases.
const mapParam =
  params.get('uri') ||
  params.get('map') ||
  (/^[\w-]+$/.test(exampleParam || '') ? `examples/${exampleParam}.json` : null) ||
  (hostPod ? hostPod + MAP_PATH : null) // installed in a pod: the owner's map
const titleParam = params.get('title')
let mapUrl = null
let badUri = false
try {
  if (mapParam) mapUrl = new URL(mapParam, location.href).href
} catch {
  badUri = true
}
if (mapUrl && !/^https?:$/.test(new URL(mapUrl).protocol)) {
  mapUrl = null
  badUri = true
}
const isJsonLd = Boolean(mapUrl) && /\.jsonld$/i.test(new URL(mapUrl).pathname)
// Maps bundled with the app (examples/) can be edited, but saving makes a copy in your pod.
const isExample = Boolean(mapUrl) && mapUrl.startsWith(new URL('./', location.href).href)
const SCRATCH_KEY = 'mindstr:scratch'

function uriParam(href) {
  const u = new URL(href)
  const appDir = new URL('./', location.href)
  if (u.origin === appDir.origin && u.pathname.startsWith(appDir.pathname) && !u.search && !u.hash) {
    return u.pathname.slice(appDir.pathname.length)
  }
  return u.href
}

function appUrlFor(href) {
  const target = new URL('./', location.href)
  target.searchParams.set('uri', uriParam(href))
  return target.href
}

// ---------- state ----------

const state = {
  nodes: [],
  connections: [],
  selected: null,
  hover: null,
  drop: null,
  view: { x: 0, y: 0, scale: 1 },
  editing: null, // { index, original, isNew }
  dirty: false,
  canSave: Boolean(mapUrl) && !isExample,
  saving: false,
  extra: {} // unknown top-level fields (e.g. @context) round-trip untouched
}
let info = { parent: [], kids: [], depth: [], branchColor: [], visible: [], hidden: [] }
let undoStack = []
let redoStack = []

// ---------- model ----------

const newId = () =>
  '#' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')

function normalize(data) {
  const raw = data && typeof data === 'object' ? data : {}
  const seen = new Set()
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter(n => n && typeof n === 'object')
    .map(n => {
      let id = typeof n['@id'] === 'string' ? n['@id'] : newId()
      if (seen.has(id)) id = newId()
      seen.add(id)
      return {
        ...n,
        '@id': id,
        name: typeof n.name === 'string' ? n.name : String(n.name ?? ''),
        x: Number.isFinite(+n.x) ? +n.x : 0,
        y: Number.isFinite(+n.y) ? +n.y : 0
      }
    })
  if (!nodes.length) nodes.push({ '@id': '#this', name: 'Central idea', x: 0, y: 0 })
  nodes[0]['@id'] = '#this'
  const valid = i => Number.isInteger(i) && i >= 0 && i < nodes.length
  const connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .filter(c => c && valid(c.start) && valid(c.end) && c.start !== c.end)
    .map(c => ({ start: c.start, end: c.end }))
  const selected = valid(raw.selectedNode) ? raw.selectedNode : 0
  const { nodes: _n, connections: _c, selectedNode: _s, version: _v, ...extra } = raw
  return { nodes, connections, selected, extra }
}

function serialize() {
  return {
    ...state.extra,
    version: '0.1',
    nodes: state.nodes,
    connections: state.connections,
    selectedNode: state.selected
  }
}

// Tree facts derived from nodes + connections: parents, depth, branch colours, folding.
function analyze() {
  const n = state.nodes.length
  const parent = Array(n).fill(null)
  const kids = Array.from({ length: n }, () => [])
  for (const c of state.connections) {
    if (parent[c.end] === null && c.end !== 0) {
      parent[c.end] = c.start
      kids[c.start].push(c.end)
    }
  }
  const depth = Array(n).fill(-1)
  const branchColor = Array(n).fill(null)
  const visible = Array(n).fill(false)
  const hidden = Array(n).fill(0)
  const walk = (root, d0, color) => {
    const stack = [[root, d0, color, true]]
    while (stack.length) {
      const [i, d, col, vis] = stack.pop()
      if (depth[i] !== -1) continue
      depth[i] = d
      visible[i] = vis
      const own = d === 1 ? state.nodes[i].bgColor || BRANCH_COLORS[kids[0].indexOf(i) % BRANCH_COLORS.length] || BRANCH_COLORS[0] : col
      branchColor[i] = own
      for (const k of kids[i]) stack.push([k, d + 1, own, vis && !state.nodes[i].collapsed])
    }
  }
  walk(0, 0, BRANCH_COLORS[0])
  for (let i = 0; i < n; i++) {
    if (depth[i] === -1 && (parent[i] === null || depth[parent[i]] === -1)) walk(i, 1, null)
  }
  for (let i = 0; i < n; i++) if (depth[i] === -1) walk(i, 1, null) // cycles
  const countBelow = i => kids[i].reduce((s, k) => s + 1 + countBelow(k), 0)
  for (let i = 0; i < n; i++) if (state.nodes[i].collapsed && kids[i].length) hidden[i] = countBelow(i)
  info = { parent, kids, depth, branchColor, visible, hidden }
}

const subtree = i => {
  const out = []
  const stack = [i]
  while (stack.length) {
    const j = stack.pop()
    out.push(j)
    stack.push(...(info.kids[j] || []))
  }
  return out
}

function snapshot() {
  return JSON.stringify({ nodes: state.nodes, connections: state.connections, selected: state.selected })
}

function restore(snap) {
  const s = JSON.parse(snap)
  state.nodes = s.nodes
  state.connections = s.connections
  state.selected = s.selected
  analyze()
}

function checkpoint() {
  undoStack.push(snapshot())
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack = []
}

const syncIsland = () => (island.textContent = JSON.stringify(serialize()))

function changed() {
  analyze()
  state.dirty = true
  syncIsland()
  if (!mapUrl) store.set(SCRATCH_KEY, JSON.stringify(serialize()))
  updateUi()
  invalidate()
}

function undo() {
  if (!undoStack.length) return
  commitEdit()
  redoStack.push(snapshot())
  restore(undoStack.pop())
  changed()
  if (state.selected !== null) ensureVisible(state.selected)
  announce('Undone')
}

function redo() {
  if (!redoStack.length) return
  commitEdit()
  undoStack.push(snapshot())
  restore(redoStack.pop())
  changed()
  if (state.selected !== null) ensureVisible(state.selected)
  announce('Redone')
}

// ---------- geometry ----------

let dpr = 1
let width = 0
let height = 0
const measure = makeMeasure(ctx)
const size = i => measure(state.nodes[i], info.depth[i] ?? 2)

// Animated positions: id → { x, y, t0 } (where the node is animating *from*).
const anims = new Map()
const ease = t => 1 - (1 - t) ** 3
function pos(i) {
  const n = state.nodes[i]
  const a = anims.get(n['@id'])
  if (!a) return n
  const t = (performance.now() - a.t0) / ANIM_MS
  if (t >= 1) {
    anims.delete(n['@id'])
    return n
  }
  const e = ease(t)
  return { x: a.x + (n.x - a.x) * e, y: a.y + (n.y - a.y) * e }
}
function animateFrom(before) {
  if (reducedMotion.matches) return
  const t0 = performance.now()
  for (const [id, p] of before) {
    const n = state.nodes.find(m => m['@id'] === id)
    if (n && (n.x !== p.x || n.y !== p.y)) anims.set(id, { x: p.x, y: p.y, t0 })
  }
  invalidate()
}
const positions = () => new Map(state.nodes.map(n => [n['@id'], { x: n.x, y: n.y }]))

const toWorld = (sx, sy) => ({ x: (sx - state.view.x) / state.view.scale, y: (sy - state.view.y) / state.view.scale })
const toScreen = (wx, wy) => ({ x: wx * state.view.scale + state.view.x, y: wy * state.view.scale + state.view.y })

function hitTest(p, exclude) {
  // Generous hit areas: at least 44 × 44 screen px, nearest node wins.
  const minHalf = 22 / state.view.scale
  let best = -1
  let bestD = Infinity
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    if (!info.visible[i] || exclude?.has(i)) continue
    const n = state.nodes[i]
    const m = size(i)
    const hw = Math.max(m.w / 2, minHalf)
    const hh = Math.max(m.h / 2, minHalf)
    const dx = Math.abs(p.x - n.x)
    const dy = Math.abs(p.y - n.y)
    if (dx <= hw && dy <= hh) {
      const inside = dx <= m.w / 2 && dy <= m.h / 2
      const d = inside ? -1 : dx / hw + dy / hh
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
  }
  return best
}

function badgeHit(p) {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    if (!info.visible[i] || !info.kids[i].length) continue
    const n = state.nodes[i]
    if (!n.collapsed && state.selected !== i && state.hover !== i) continue
    const b = badgeAt(i, scene())
    if (Math.hypot(p.x - b.x, p.y - b.y) <= Math.max(b.r + 2, 16 / state.view.scale)) return i
  }
  return -1
}

function onLinkIcon(i, p) {
  const li = linkIconAt(i, scene())
  return Boolean(li) && Math.hypot(p.x - li.x, p.y - li.y) <= Math.max(li.r, 16 / state.view.scale)
}

function overlaps(x, y, w, h, exclude) {
  return state.nodes.some((n, j) => {
    if (exclude?.has(j) || info.visible[j] === false) return false
    const m = j < info.depth.length ? size(j) : NEW_NODE
    return Math.abs(n.x - x) < (m.w + w) / 2 + 24 && Math.abs(n.y - y) < (m.h + h) / 2 + 12
  })
}

// Where a new child of `pi` should go: continue outward, fan siblings, avoid overlaps.
function placeChild(pi, exclude) {
  const p = state.nodes[pi]
  const parent = state.connections.find(c => c.end === pi)?.start
  const kids = state.connections.filter(c => c.start === pi && !exclude?.has(c.end)).map(c => c.end)
  let base
  let r
  if (parent === undefined || pi === 0) {
    const angles = kids.map(k => Math.atan2((state.nodes[k].y - p.y) / 0.8, state.nodes[k].x - p.x)).sort((a, b) => a - b)
    if (!angles.length) base = 0
    else if (angles.length === 1) base = angles[0] + Math.PI
    else {
      let gap = -1
      angles.forEach((a, k) => {
        const next = k + 1 < angles.length ? angles[k + 1] : angles[0] + Math.PI * 2
        if (next - a > gap) {
          gap = next - a
          base = a + gap / 2
        }
      })
    }
    r = 240
  } else {
    const g = state.nodes[parent]
    base = Math.atan2((p.y - g.y) / 0.8, p.x - g.x)
    r = 200
  }
  const fan = [0, 0.38, -0.38, 0.76, -0.76, 1.1, -1.1, 1.45, -1.45]
  for (const radius of [r, r + 90, r + 180, r + 300]) {
    for (const d of fan) {
      const a = base + d
      const x = Math.round(p.x + Math.cos(a) * radius)
      const y = Math.round(p.y + Math.sin(a) * radius * 0.8)
      if (!overlaps(x, y, NEW_NODE.w, NEW_NODE.h, exclude)) return { x, y }
    }
  }
  return { x: Math.round(p.x + Math.cos(base) * (r + 400)), y: Math.round(p.y + Math.sin(base) * (r + 400) * 0.8) }
}

// ---------- view ----------

let viewAnim = null
function setView(target, animate = true) {
  if (!animate || reducedMotion.matches) {
    viewAnim = null
    Object.assign(state.view, target)
    positionEditor()
    invalidate()
    return
  }
  viewAnim = { from: { ...state.view }, to: target, t0: performance.now() }
  invalidate()
}

function zoomAt(sx, sy, factor) {
  viewAnim = null
  const v = state.view
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const k = next / v.scale
  v.x = sx - (sx - v.x) * k
  v.y = sy - (sy - v.y) * k
  v.scale = next
  positionEditor()
  invalidate()
}

function fitView(animate = true) {
  if (!state.nodes.length || !width) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  state.nodes.forEach((n, i) => {
    if (!info.visible[i]) return
    const m = size(i)
    minX = Math.min(minX, n.x - m.w / 2)
    maxX = Math.max(maxX, n.x + m.w / 2)
    minY = Math.min(minY, n.y - m.h / 2)
    maxY = Math.max(maxY, n.y + m.h / 2)
  })
  const pad = width < 500 ? 24 : 56
  let scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1), 1.25)
  const floor = width < 760 || coarse.matches ? 0.62 : 0.3
  let cx = (minX + maxX) / 2
  let cy = (minY + maxY) / 2
  if (scale < floor) {
    // too big to read when fitted: show a readable piece around the selection or root
    scale = floor
    const focus = state.nodes[state.selected ?? 0]
    cx = focus.x
    cy = focus.y
  }
  scale = Math.max(MIN_SCALE, scale)
  setView({ scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale }, animate)
}

function ensureVisible(i, animate = true) {
  const n = state.nodes[i]
  if (!n) return
  const s = toScreen(n.x, n.y)
  const m = size(i)
  const margin = 40 + (m.w * state.view.scale) / 2
  if (s.x < margin || s.x > width - margin || s.y < 60 || s.y > height - 90) {
    setView({ ...state.view, x: state.view.x + width / 2 - s.x, y: state.view.y + height / 2 - s.y }, animate)
  }
}

// ---------- drawing ----------

let flashing = { ids: new Set(), until: 0 }
function flash(ids) {
  flashing = { ids: new Set(ids), until: performance.now() + FLASH_MS }
  invalidate()
}

const find = { matches: [], index: -1, set: null }

function scene(over = {}) {
  const now = performance.now()
  return {
    nodes: state.nodes,
    connections: state.connections,
    info,
    pos,
    size,
    view: state.view,
    width,
    height,
    dpr,
    dark: dark.matches,
    theme: dark.matches ? THEMES.dark : THEMES.light,
    selected: state.selected,
    hover: state.hover,
    drop: state.drop,
    editing: state.editing?.index ?? null,
    flash: flashing.until > now ? { ids: flashing.ids, t: (flashing.until - now) / FLASH_MS } : null,
    matches: find.set,
    reduced: reducedMotion.matches,
    grid: true,
    ...over
  }
}

let frame = 0
function invalidate() {
  if (!frame) frame = requestAnimationFrame(draw)
}

function draw() {
  frame = 0
  const now = performance.now()
  if (viewAnim) {
    const t = Math.min(1, (now - viewAnim.t0) / 260)
    const e = ease(t)
    const { from, to } = viewAnim
    state.view.x = from.x + (to.x - from.x) * e
    state.view.y = from.y + (to.y - from.y) * e
    state.view.scale = from.scale + (to.scale - from.scale) * e
    if (t >= 1) viewAnim = null
    positionEditor()
  }
  drawMap(ctx, scene())
  if (viewAnim || anims.size || flashing.until > now) invalidate()
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

// ---------- actions ----------

function describe(i) {
  const n = state.nodes[i]
  if (!n) return ''
  const parent = info.parent[i]
  const sibs = parent === null ? [i] : info.kids[parent]
  const parts = [n.name || 'Untitled', `level ${info.depth[i] + 1}`, `${sibs.indexOf(i) + 1} of ${sibs.length}`]
  const k = info.kids[i].length
  if (k) parts.push(n.collapsed ? `folded, ${info.hidden[i]} hidden` : `${k} ${k === 1 ? 'child' : 'children'}`)
  if (n.link) parts.push('has link')
  return parts.join(', ')
}

function select(i, { speak = true } = {}) {
  if (state.selected === i) return
  state.selected = i
  syncIsland()
  updateUi()
  invalidate()
  if (speak && i !== null) announce(describe(i))
}

function addChild(parentIndex = state.selected ?? 0) {
  if (!state.nodes[parentIndex]) return
  commitEdit()
  checkpoint()
  if (state.nodes[parentIndex].collapsed) state.nodes[parentIndex] = { ...state.nodes[parentIndex], collapsed: undefined }
  const at = placeChild(parentIndex)
  const node = { '@id': newId(), name: '', ...at }
  state.nodes.push(node)
  const index = state.nodes.length - 1
  state.connections.push({ start: parentIndex, end: index })
  state.selected = index
  changed()
  const from = state.nodes[parentIndex]
  if (!reducedMotion.matches) anims.set(node['@id'], { x: from.x, y: from.y, t0: performance.now() })
  ensureVisible(index)
  startEdit(index, true)
}

function addSibling() {
  const sel = state.selected
  if (sel === null) return addChild(0)
  const parent = info.parent[sel]
  addChild(parent === null ? sel : parent)
}

function deleteSelected() {
  const del = state.selected
  if (del === null) return
  if (del === 0) return toast('The central idea can’t be deleted')
  commitEdit()
  checkpoint()
  const name = state.nodes[del].name || 'Untitled'
  const moved = info.kids[del].length
  const parent = info.parent[del]
  const conns = []
  for (const c of state.connections) {
    if (c.end === del) continue
    let { start, end } = c
    if (start === del) {
      if (parent === null) continue
      start = parent // children move up to the deleted node's parent
    }
    conns.push({ start: start > del ? start - 1 : start, end: end > del ? end - 1 : end })
  }
  state.nodes.splice(del, 1)
  state.connections = conns
  state.selected = parent === null ? 0 : parent > del ? parent - 1 : parent
  changed()
  const msg = `Deleted “${name}”` + (moved ? ` · ${moved} moved up` : '')
  toast(msg, { action: ['Undo', undo], ms: 6000 })
}

function toggleCollapse(i = state.selected) {
  if (i === null || !info.kids[i]?.length) return
  commitEdit()
  checkpoint()
  const n = state.nodes[i]
  const collapsing = !n.collapsed
  state.nodes[i] = { ...n, collapsed: collapsing || undefined }
  if (collapsing && state.selected !== null && state.selected !== i && subtree(i).includes(state.selected)) state.selected = i
  changed()
  announce(describe(i))
}

function reveal(i) {
  // unfold any folded ancestors so node i is visible
  let p = info.parent[i]
  let changedAny = false
  while (p !== null && p !== undefined) {
    if (state.nodes[p].collapsed) {
      if (!changedAny) checkpoint()
      state.nodes[p] = { ...state.nodes[p], collapsed: undefined }
      changedAny = true
    }
    p = info.parent[p]
  }
  if (changedAny) changed()
}

function reparent(i, target) {
  if (i === 0 || target === i || subtree(i).includes(target)) return false
  const conn = state.connections.find(c => c.end === i)
  if (conn) {
    if (conn.start === target) return false
    conn.start = target
  } else {
    state.connections.push({ start: target, end: i })
  }
  if (state.nodes[target].collapsed) state.nodes[target] = { ...state.nodes[target], collapsed: undefined }
  const moving = new Set(subtree(i))
  const at = placeChild(target, moving)
  const dx = at.x - state.nodes[i].x
  const dy = at.y - state.nodes[i].y
  for (const j of moving) {
    state.nodes[j].x = Math.round(state.nodes[j].x + dx)
    state.nodes[j].y = Math.round(state.nodes[j].y + dy)
  }
  return true
}

function tidy() {
  commitEdit()
  checkpoint()
  const before = positions()
  const root = state.nodes[0]
  const placed = radialLayout(0, i => info.kids[i], size, { x: root.x, y: root.y })
  for (const [i, p] of placed) Object.assign(state.nodes[i], p)
  changed()
  animateFrom(before)
  fitView()
  announce('Layout tidied')
}

function setLink(i, value) {
  const current = state.nodes[i].link || ''
  if (value === current) return
  if (value && /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:/i.test(value)) {
    return toast('Only web links (http or https) and relative links are allowed')
  }
  checkpoint()
  const node = { ...state.nodes[i] }
  if (value) node.link = value
  else delete node.link
  state.nodes[i] = node
  changed()
  announce(value ? 'Link set' : 'Link removed')
}

function editLink() {
  const i = state.selected
  if (i === null) return
  commitEdit()
  linkInput.value = state.nodes[i].link || ''
  $('#linkRemove').hidden = !state.nodes[i].link
  linkDialog.returnValue = ''
  linkDialog.showModal()
  linkInput.select()
  linkDialog.onclose = () => {
    const v = linkDialog.returnValue
    if (v === 'save') setLink(i, linkInput.value.trim())
    else if (v === 'remove') setLink(i, '')
    focusMap()
  }
}
$('#linkForm').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target === linkInput) {
    e.preventDefault()
    linkDialog.close('save')
  }
})

function openLink(node) {
  const raw = (node?.link || '').trim()
  if (!raw) return
  const base = new URL(mapUrl || location.href)
  let url
  try {
    url = new URL(raw, base)
  } catch {
    return toast('That link isn’t a valid address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return toast('Blocked a non-web link')
  let target = url.href
  if (url.pathname.endsWith('.md')) target = DOC_VIEWER + encodeURIComponent(url.href)
  else if (/^\.\.?\//.test(raw)) target = appUrlFor(url.href) // another map next to this one
  window.open(target, '_blank', 'noopener')
}

function navigate(dx, dy) {
  const from = state.nodes[state.selected ?? 0]
  let best = -1
  let bestScore = Infinity
  state.nodes.forEach((n, i) => {
    if (i === state.selected || !info.visible[i]) return
    const ex = n.x - from.x
    const ey = n.y - from.y
    const primary = ex * dx + ey * dy
    if (primary <= 1) return
    const score = primary + Math.abs(ex * dy - ey * dx) * 2
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

// ---------- outlines: copy, paste, import, export ----------

const toTree = i => {
  const n = state.nodes[i]
  return {
    name: n.name,
    ...(n.link ? { link: n.link } : {}),
    ...(n.bgColor ? { bgColor: n.bgColor } : {}),
    kids: info.kids[i].map(toTree)
  }
}

function insertTrees(parent, trees) {
  if (!trees.length) return
  commitEdit()
  checkpoint()
  let first = null
  let count = 0
  const add = (t, pi) => {
    const at = placeChild(pi)
    const node = { '@id': newId(), name: t.name, ...at }
    if (t.link) node.link = t.link
    if (t.bgColor) node.bgColor = t.bgColor
    state.nodes.push(node)
    const i = state.nodes.length - 1
    state.connections.push({ start: pi, end: i })
    analyze()
    count++
    if (first === null) first = i
    for (const k of t.kids || []) add(k, i)
  }
  if (state.nodes[parent].collapsed) state.nodes[parent] = { ...state.nodes[parent], collapsed: undefined }
  for (const t of trees) add(t, parent)
  state.selected = first
  changed()
  ensureVisible(first)
  toast(`Added ${count} ${count === 1 ? 'idea' : 'ideas'}`, { action: ['Undo', undo] })
}

let clip = null
document.addEventListener('copy', e => onCopy(e, false))
document.addEventListener('cut', e => onCopy(e, true))
function onCopy(e, cut) {
  if (isField(e.target) || state.selected === null || anyDialogOpen()) return
  const t = toTree(state.selected)
  const md = toMarkdown(t)
  e.clipboardData.setData('text/plain', md)
  e.preventDefault()
  clip = { md, tree: t }
  if (cut && state.selected !== 0) deleteSelected()
  else toast('Copied branch')
}
document.addEventListener('paste', e => {
  if (isField(e.target) || anyDialogOpen()) return
  const text = e.clipboardData.getData('text/plain')
  if (!text.trim()) return
  e.preventDefault()
  const trees = clip && text === clip.md ? [clip.tree] : parseOutline(text)
  insertTrees(state.selected ?? 0, trees)
})

function openImport() {
  importText.value = ''
  importDialog.returnValue = ''
  importDialog.showModal()
  importDialog.onclose = () => {
    if (importDialog.returnValue === 'add') insertTrees(state.selected ?? 0, parseOutline(importText.value))
    focusMap()
  }
}

const slug = () =>
  (state.nodes[0]?.name || 'map')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 40) || 'map'

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function exportPng() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  state.nodes.forEach((n, i) => {
    if (!info.visible[i]) return
    const m = size(i)
    minX = Math.min(minX, n.x - m.w / 2 - 30)
    maxX = Math.max(maxX, n.x + m.w / 2 + 30)
    minY = Math.min(minY, n.y - m.h / 2 - 30)
    maxY = Math.max(maxY, n.y + m.h / 2 + 30)
  })
  const w = Math.ceil(maxX - minX + 48)
  const h = Math.ceil(maxY - minY + 48)
  const scale = Math.min(2, 8000 / Math.max(w, h))
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  drawMap(
    out.getContext('2d'),
    scene({ view: { x: 24 - minX, y: 24 - minY, scale: 1 }, width: w, height: h, dpr: scale, grid: false, selected: null, hover: null, drop: null, flash: null, matches: null, editing: null, pos: i => state.nodes[i] })
  )
  out.toBlob(b => download(b, slug() + '.png'), 'image/png')
  toast('Image downloaded')
}

async function copyOutline() {
  const md = toMarkdown(toTree(0))
  try {
    await navigator.clipboard.writeText(md)
    toast('Outline copied — paste it into notes, docs or another map')
  } catch {
    download(new Blob([md], { type: 'text/markdown' }), slug() + '.md')
    toast('Outline downloaded')
  }
}

function exportJson() {
  download(new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/ld+json' }), slug() + '.jsonld')
}

// ---------- find ----------

function openFind() {
  findBar.hidden = false
  findInput.focus()
  findInput.select()
  runFind()
}
function closeFind() {
  findBar.hidden = true
  find.matches = []
  find.set = null
  findCount.textContent = ''
  invalidate()
  focusMap()
}
function runFind() {
  const q = findInput.value.trim().toLowerCase()
  find.matches = q ? state.nodes.map((n, i) => (n.name.toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0) : []
  find.set = new Set(find.matches)
  find.index = -1
  findCount.textContent = q ? (find.matches.length ? `${find.matches.length} found` : 'none') : ''
  if (find.matches.length) stepFind(1)
  invalidate()
}
function stepFind(dir) {
  if (!find.matches.length) return
  find.index = (find.index + dir + find.matches.length) % find.matches.length
  const i = find.matches[find.index]
  reveal(i)
  select(i)
  ensureVisible(i)
  findCount.textContent = `${find.index + 1} of ${find.matches.length}`
}
findInput.addEventListener('input', runFind)
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault()
    stepFind(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeFind()
  }
})

// ---------- inline editor ----------

function startEdit(index, isNew = false) {
  commitEdit()
  const node = state.nodes[index]
  if (!node) return
  reveal(index)
  state.editing = { index, original: node.name, isNew }
  state.selected = index
  editor.value = node.name
  editor.placeholder = isNew ? 'New idea' : ''
  editor.hidden = false
  positionEditor()
  editor.focus({ preventScroll: true })
  editor.select()
  if (coarse.matches) {
    // keep the node above the on-screen keyboard
    const s = toScreen(node.x, node.y)
    const target = (window.visualViewport?.height || height) * 0.28
    setView({ ...state.view, y: state.view.y + (target - s.y) })
  }
  updateUi()
  invalidate()
}

function positionEditor() {
  if (!state.editing) return
  const i = state.editing.index
  const n = state.nodes[i]
  if (!n) return
  const s = toScreen(n.x, n.y)
  const m = size(i)
  const k = state.view.scale
  const fontPx = parseFloat(m.font.match(/(\d+)px/)[1])
  editor.style.left = s.x + 'px'
  editor.style.top = s.y + 'px'
  editor.style.font = m.font.replace(/\d+px/, Math.max(coarse.matches ? 16 : 13, Math.min(fontPx * k, 30)) + 'px')
  editor.style.width = Math.max(m.w * k + 28, 170) + 'px'
  editor.style.height = Math.max(m.h * k, coarse.matches ? 44 : 34) + 'px'
  editor.style.borderRadius = Math.min(m.r * k, 22) + 'px'
}

function commitEdit() {
  const e = state.editing
  if (!e) return
  state.editing = null
  editor.hidden = true
  const name = editor.value.trim()
  if (state.nodes[e.index]) state.nodes[e.index].name = e.original // undo the live preview first
  if (e.isNew && !name) {
    // abandoned new node: drop it without leaving an undo step behind
    restore(undoStack.pop())
    changed()
    focusMap()
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
  if (document.activeElement === editor || document.activeElement === document.body) focusMap()
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
  state.nodes[state.editing.index].name = editor.value // live width; committed properly on blur/enter
  positionEditor()
  invalidate()
})
window.visualViewport?.addEventListener('resize', positionEditor)

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
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
}

const focusMap = () => {
  if (!anyDialogOpen() && findBar.hidden) tree.focus({ preventScroll: true })
}

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  commitEdit()
  closeMenu()
  focusMap()
  viewAnim = null
  canvas.setPointerCapture(e.pointerId)
  const p = localPoint(e)
  pointers.set(e.pointerId, p)

  if (pointers.size === 2) {
    if (gesture?.type === 'node' && gesture.moved) finishDrag(gesture)
    state.drop = null
    gesture = { type: 'pinch', ...pinchInfo() }
    return
  }
  if (pointers.size > 2) return

  const w = toWorld(p.x, p.y)
  const badge = badgeHit(w)
  if (badge >= 0) {
    gesture = { type: 'badge', index: badge, start: p, moved: false }
    return
  }
  const hit = hitTest(w)
  if (hit >= 0) {
    select(hit)
    const items = (e.altKey ? [hit] : subtree(hit)).map(j => ({ j, dx: state.nodes[j].x - w.x, dy: state.nodes[j].y - w.y }))
    gesture = { type: 'node', index: hit, start: p, items, moved: false, onLink: onLinkIcon(hit, w) }
  } else {
    gesture = { type: 'pan', start: p, last: p, moved: false }
  }
})

canvas.addEventListener('pointermove', e => {
  const p = localPoint(e)
  if (!pointers.has(e.pointerId)) {
    // hover (mouse only)
    if (e.pointerType !== 'mouse' || gesture) return
    const w = toWorld(p.x, p.y)
    const badge = badgeHit(w)
    const hit = badge >= 0 ? badge : hitTest(w)
    if (hit !== state.hover) {
      state.hover = hit >= 0 ? hit : null
      invalidate()
    }
    canvas.style.cursor = badge >= 0 || (hit >= 0 && onLinkIcon(hit, w)) ? 'pointer' : hit >= 0 ? 'grab' : ''
    return
  }
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

  const far = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD
  if (gesture.type === 'node') {
    if (!gesture.moved && !far) return
    if (!gesture.moved) {
      checkpoint()
      gesture.moved = true
      canvas.classList.add('dragging')
    }
    const w = toWorld(p.x, p.y)
    for (const { j, dx, dy } of gesture.items) {
      state.nodes[j].x = Math.round(w.x + dx)
      state.nodes[j].y = Math.round(w.y + dy)
    }
    // drop target: a node under the pointer that isn't part of what we're dragging
    const moving = new Set(gesture.items.map(it => it.j))
    const t = hitTest(w, moving)
    state.drop = t >= 0 && t !== info.parent[gesture.index] && gesture.index !== 0 ? t : null
    invalidate()
  } else if (gesture.type === 'pan') {
    if (far) gesture.moved = true
    state.view.x += p.x - gesture.last.x
    state.view.y += p.y - gesture.last.y
    gesture.last = p
    canvas.classList.toggle('dragging', gesture.moved)
    positionEditor()
    invalidate()
  } else if (gesture.type === 'badge' && far) {
    gesture.moved = true
  }
})

canvas.addEventListener('pointerleave', () => {
  if (state.hover !== null && !gesture) {
    state.hover = null
    invalidate()
  }
})

function finishDrag(g) {
  canvas.classList.remove('dragging')
  if (g?.type !== 'node' || !g.moved) return
  g.moved = false
  const target = state.drop
  state.drop = null
  if (target !== null) {
    const before = positions()
    if (reparent(g.index, target)) {
      changed()
      animateFrom(before)
      announce(`Moved under ${state.nodes[target].name || 'Untitled'}`)
      return
    }
  }
  changed()
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
  canvas.classList.remove('dragging')
  if (e.type === 'pointercancel') {
    finishDrag(g)
    return
  }
  if (g.type === 'node') {
    if (g.moved) return finishDrag(g)
    const now = performance.now()
    if (lastTap.index === g.index && now - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = { index: -1, time: 0 }
      return startEdit(g.index)
    }
    lastTap = { index: g.index, time: now }
    if (g.onLink) openLink(state.nodes[g.index])
  } else if (g.type === 'badge') {
    if (!g.moved) toggleCollapse(g.index)
  } else if (g.type === 'pan' && !g.moved) {
    lastTap = { index: -1, time: 0 }
    select(null)
  }
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

canvas.addEventListener(
  'wheel',
  e => {
    e.preventDefault()
    viewAnim = null
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1
    if (e.ctrlKey || e.metaKey) {
      // pinch on a trackpad, or Ctrl+wheel
      const p = localPoint(e)
      const d = Math.max(-60, Math.min(60, e.deltaY * k))
      zoomAt(p.x, p.y, Math.exp(-d * 0.01))
    } else {
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k
      state.view.x -= dx
      state.view.y -= dy
      positionEditor()
      invalidate()
    }
  },
  { passive: false }
)

// ---------- keyboard ----------

const isField = t => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable
const anyDialogOpen = () => helpDialog.open || linkDialog.open || importDialog.open

document.addEventListener('keydown', e => {
  if (anyDialogOpen()) return
  const t = e.target
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod && key === 's') {
    e.preventDefault()
    return save()
  }
  if (isField(t)) return
  if (!menu.hidden && key === 'Escape') return closeMenu(true)
  if (mod && !e.altKey) {
    const handled =
      key === 'z' ? (e.shiftKey ? redo() : undo(), true)
      : key === 'y' ? (redo(), true)
      : key === 'k' ? (editLink(), true)
      : key === 'f' ? (openFind(), true)
      : false
    if (handled) e.preventDefault()
    return // Ctrl+C / X / V fall through to the clipboard events
  }
  const onMap = t === tree || t === canvas || t === document.body
  if (!onMap || e.altKey) return
  const sel = state.selected
  const handled = (() => {
    switch (key) {
      case 'Tab':
        if (e.shiftKey || sel === null) return false // let focus leave the map
        return addChild(), true
      case 'Insert':
        return addChild(), true
      case 'Enter':
        return addSibling(), true
      case 'F2':
        return sel !== null && startEdit(sel), true
      case 'Delete':
      case 'Backspace':
        return deleteSelected(), true
      case 'Escape':
        if (!findBar.hidden) return closeFind(), true
        return select(null), true
      case 'ArrowLeft':
        return navigate(-1, 0), true
      case 'ArrowRight':
        return navigate(1, 0), true
      case 'ArrowUp':
        return navigate(0, -1), true
      case 'ArrowDown':
        return navigate(0, 1), true
      case ' ':
        return toggleCollapse(), true
      case 'f':
      case '0':
        return fitView(), true
      case '+':
      case '=':
        return zoomAt(width / 2, height / 2, 1.25), true
      case '-':
        return zoomAt(width / 2, height / 2, 0.8), true
      case '?':
        return showHelp(), true
      case 'o':
        return sel !== null && openLink(state.nodes[sel]), true
      case 'l':
        return tidy(), true
    }
    return false
  })()
  if (handled) e.preventDefault()
})

// ---------- toolbar and menu ----------

function showHelp() {
  closeMenu()
  helpDialog.showModal()
  helpDialog.querySelector('.dlg-body').scrollTop = 0
  helpDialog.onclose = focusMap
}

function openMenu() {
  const r = menuBtn.getBoundingClientRect()
  menu.style.top = r.bottom + 6 + 'px'
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px'
  menu.hidden = false
  menuBtn.setAttribute('aria-expanded', 'true')
  menu.querySelector('button:not([hidden])')?.focus({ preventScroll: true })
}
function closeMenu(refocus) {
  if (menu.hidden) return
  menu.hidden = true
  menuBtn.setAttribute('aria-expanded', 'false')
  if (refocus) menuBtn.focus()
}
menu.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...menu.querySelectorAll('button')].filter(b => b.offsetParent)
  const k = items.indexOf(document.activeElement)
  items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
})
document.addEventListener('pointerdown', e => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu()
})

const actions = {
  child: () => addChild(),
  sibling: () => addSibling(),
  edit: () => state.selected !== null && startEdit(state.selected),
  link: editLink,
  open: () => state.selected !== null && openLink(state.nodes[state.selected]),
  delete: deleteSelected,
  undo,
  redo,
  fit: () => fitView(),
  zoomIn: () => zoomAt(width / 2, height / 2, 1.25),
  zoomOut: () => zoomAt(width / 2, height / 2, 0.8),
  find: openFind,
  findNext: () => stepFind(1),
  findPrev: () => stepFind(-1),
  findClose: closeFind,
  tidy,
  import: openImport,
  png: exportPng,
  outline: copyOutline,
  json: exportJson,
  save: () => save(),
  mine: () => openMine(),
  help: showHelp,
  menu: () => (menu.hidden ? openMenu() : closeMenu()),
  hintClose: () => {
    store.set('mindstr:hint', 'off')
    updateUi()
  }
}

for (const btn of document.querySelectorAll('[data-action]')) {
  const inMenu = menu.contains(btn)
  // keep keyboard focus on the map after mouse clicks on toolbar buttons
  if (!inMenu && !findBar.contains(btn)) btn.addEventListener('mousedown', e => e.preventDefault())
  btn.addEventListener('click', () => {
    if (inMenu) closeMenu()
    actions[btn.dataset.action]?.()
  })
}

function renderTree() {
  // A screen-reader mirror of the map: a flat ARIA tree with levels.
  const items = []
  const sel = state.selected
  const walk = i => {
    if (!info.visible[i]) return
    const n = state.nodes[i]
    const li = document.createElement('li')
    li.id = 'ti-' + i
    li.setAttribute('role', 'treeitem')
    li.setAttribute('aria-level', info.depth[i] + 1)
    const parent = info.parent[i]
    const sibs = parent === null ? [i] : info.kids[parent]
    li.setAttribute('aria-setsize', sibs.length)
    li.setAttribute('aria-posinset', sibs.indexOf(i) + 1)
    li.setAttribute('aria-selected', String(i === sel))
    if (info.kids[i].length) li.setAttribute('aria-expanded', String(!n.collapsed))
    li.textContent = (n.name || 'Untitled') + (n.link ? ' (link)' : '')
    items.push(li)
    for (const k of info.kids[i]) walk(k)
  }
  walk(0)
  state.nodes.forEach((_, i) => info.depth[i] === 1 && info.parent[i] === null && walk(i))
  tree.replaceChildren(...items)
  if (sel !== null && info.visible[sel]) tree.setAttribute('aria-activedescendant', 'ti-' + sel)
  else tree.removeAttribute('aria-activedescendant')
}

function updateUi() {
  const sel = state.selected
  const has = sel !== null && Boolean(state.nodes[sel])
  const set = (action, enabled) => {
    for (const b of document.querySelectorAll(`[data-action="${action}"]`)) b.disabled = !enabled
  }
  set('sibling', has)
  set('edit', has)
  set('link', has)
  set('open', has && Boolean(state.nodes[sel].link))
  set('delete', has && sel !== 0)
  set('undo', undoStack.length > 0)
  set('redo', redoStack.length > 0)
  const copy = !mapUrl || isExample
  set('save', !state.saving && (copy || state.canSave))
  saveLabel.textContent = copy ? (isExample ? 'Save copy' : 'Save') : 'Save'
  document.body.classList.toggle('has-selection', has)

  statusEl.textContent = state.saving
    ? 'Saving…'
    : !mapUrl
      ? 'Draft · in this browser'
      : isExample
        ? state.dirty
          ? 'Example · edited'
          : 'Example'
        : !state.canSave
          ? 'Read-only'
          : state.dirty
            ? 'Unsaved'
            : 'Saved'
  if (remote.live) statusEl.textContent += ' · live'
  statusEl.dataset.state = state.dirty && (state.canSave || isExample) ? 'dirty' : ''
  hint.hidden = Boolean(mapUrl) || store.get('mindstr:hint') === 'off' || state.nodes.length > 2
  document.title = (state.nodes[0]?.name || 'Untitled') + ' – Mindstr'
  renderTree()
}

// ---------- feedback ----------

let toastTimer
function toast(msg, { ms = 3200, action } = {}) {
  const text = document.createElement('span')
  text.textContent = msg
  toastEl.replaceChildren(text)
  if (action) {
    const b = document.createElement('button')
    b.textContent = action[0]
    b.addEventListener('click', () => {
      toastEl.hidden = true
      action[1]()
    })
    toastEl.append(b)
  }
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms)
}

function announce(msg) {
  announceEl.textContent = ''
  requestAnimationFrame(() => (announceEl.textContent = msg))
}

function showBanner(msg, buttons = []) {
  banner.replaceChildren(msg)
  for (const [label, fn] of buttons) {
    const b = document.createElement('button')
    b.textContent = label
    b.className = 'banner-btn'
    b.addEventListener('click', fn)
    banner.append(b)
  }
  banner.hidden = false
  requestAnimationFrame(resize)
}

function hideBanner() {
  if (banner.hidden) return
  banner.hidden = true
  requestAnimationFrame(resize)
}

// ---------- live sync ----------

const ACCEPT = 'application/ld+json, application/json;q=0.9, */*;q=0.1'
const remote = { etag: null, exists: false, live: false, pending: null, checking: false, again: false }

// Key-order-independent JSON, so reformatting by the server doesn't count as a change.
const stable = v =>
  Array.isArray(v)
    ? '[' + v.map(stable).join(',') + ']'
    : v && typeof v === 'object'
      ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
      : JSON.stringify(v)
const content = d => stable({ ...d, selectedNode: undefined, version: undefined })
const sameAsLocal = data => content(data) === content(JSON.parse(JSON.stringify(serialize())))

function applyRemote(data, etag) {
  const selId = state.nodes[state.selected]?.['@id']
  const known = new Set(state.nodes.map(n => n['@id']))
  if (state.editing) cancelEdit()
  const before = positions()
  const { nodes, connections, selected, extra } = normalize(data)
  state.nodes = nodes
  state.connections = connections
  state.extra = extra
  analyze()
  const added = nodes.map((n, i) => i).filter(i => !known.has(nodes[i]['@id']))
  if (added.length) {
    state.selected = added[added.length - 1]
    flash(added.map(i => nodes[i]['@id']))
    ensureVisible(state.selected)
  } else {
    const keep = nodes.findIndex(n => n['@id'] === selId)
    state.selected = keep >= 0 ? keep : selected
  }
  animateFrom(before)
  undoStack = []
  redoStack = []
  remote.etag = etag
  remote.exists = true
  remote.pending = null
  state.dirty = false
  hideBanner()
  syncIsland()
  updateUi()
  invalidate()
}

function showConflict(message) {
  showBanner(message, [
    ['Load theirs', () => remote.pending && applyRemote(remote.pending.data, remote.pending.etag)],
    [
      'Keep mine',
      () => {
        if (remote.pending) remote.etag = remote.pending.etag // next save deliberately replaces theirs
        remote.pending = null
        remote.exists = true
        hideBanner()
      }
    ]
  ])
}

async function checkRemote() {
  if (!mapUrl) return
  if (remote.checking || state.saving) {
    remote.again = true
    return
  }
  remote.checking = true
  try {
    const res = await authFetch(mapUrl, { cache: 'no-cache', headers: { Accept: ACCEPT } })
    if (!res.ok) return
    const etag = res.headers.get('ETag')
    if (etag && etag === remote.etag) return
    const data = await res.json()
    if (sameAsLocal(data)) {
      remote.etag = etag
      remote.exists = true
      return
    }
    if (state.dirty || state.editing || gesture) {
      remote.pending = { data, etag }
      showConflict('This map was changed elsewhere while you were editing.')
    } else {
      applyRemote(data, etag)
      toast('Map updated elsewhere')
    }
  } catch {
    // offline or bad JSON: try again on the next notification
  } finally {
    remote.checking = false
    if (remote.again) {
      remote.again = false
      checkRemote()
    }
  }
}

function startLive(updatesVia) {
  if (!updatesVia || !mapUrl || typeof WebSocket === 'undefined') return
  watch(mapUrl, updatesVia, {
    onChange: checkRemote,
    onStatus: on => {
      remote.live = on
      updateUi()
    }
  })
}

// ---------- saving ----------

let leaving = false

function stashForLogin(next) {
  session.set('mindstr:afterLogin', next)
  session.set('mindstr:stash', JSON.stringify({ href: location.href, data: serialize(), dirty: state.dirty }))
}

function askToSignIn(next, why) {
  stashForLogin(next)
  if (openLogin()) toast(why, { ms: 5000 })
  else toast('Sign-in couldn’t load. Check your connection and try again.', { ms: 6000 })
}

async function save() {
  commitEdit()
  if (state.saving) return
  if (!mapUrl || isExample) return saveCopy()
  if (!state.canSave) return toast('This map couldn’t be loaded, so saving is off to protect the original.', { ms: 6000 })
  state.saving = true
  updateUi()
  try {
    const headers = { 'Content-Type': isJsonLd ? 'application/ld+json' : 'application/json' }
    if (remote.etag) headers['If-Match'] = remote.etag
    else if (!remote.exists) headers['If-None-Match'] = '*'
    const res = await authFetch(mapUrl, { method: 'PUT', headers, body: JSON.stringify(serialize(), null, 2) })
    if (res.status === 412) {
      const theirs = await authFetch(mapUrl, { cache: 'no-cache', headers: { Accept: ACCEPT } })
      remote.pending = theirs.ok ? { data: await theirs.json(), etag: theirs.headers.get('ETag') } : null
      remote.exists = theirs.ok
      if (!theirs.ok) remote.etag = null
      showConflict('This map was saved elsewhere since you loaded it.')
      throw new Error('it changed on the server')
    }
    if (res.status === 401 || res.status === 403) {
      state.saving = false
      updateUi()
      if (!identity()) return askToSignIn('save', 'Sign in to save this map')
      return toast('You can’t write to this map.', { action: ['Save a copy', saveCopy], ms: 8000 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    state.dirty = false
    remote.exists = true
    remote.etag = null // JSS doesn't return the new ETag; checkRemote learns it
    hideBanner()
    toast('Saved')
    announce('Saved')
    new Audio('./audio/save.ogg').play().catch(() => {})
  } catch (err) {
    toast('Save failed: ' + err.message, { ms: 6000 })
  } finally {
    state.saving = false
    updateUi()
    if (remote.exists && !remote.etag) checkRemote()
  }
}

// Save this map as a new file in the signed-in user's pod, then open it there.
async function saveCopy() {
  if (!identity()) return askToSignIn('copy', 'Sign in to save this map to your pod')
  state.saving = true
  updateUi()
  try {
    const home = await myMapUrl()
    if (!home) throw new Error('couldn’t find your pod')
    const dir = new URL('./', home).href
    const name = slug()
    const candidates = [home, `${dir}${name}.jsonld`, ...Array.from({ length: 18 }, (_, k) => `${dir}${name}-${k + 2}.jsonld`)]
    let target = null
    for (const url of candidates) {
      const r = await authFetch(url, { method: 'HEAD', cache: 'no-cache' })
      if (r.status === 404) {
        target = url
        break
      }
      if (r.status === 401 || r.status === 403) throw new Error('no access to your pod')
    }
    if (!target) throw new Error('no free file name')
    const res = await authFetch(target, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/ld+json', 'If-None-Match': '*' },
      body: JSON.stringify(serialize(), null, 2)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!mapUrl) store.set(SCRATCH_KEY, null)
    session.set('mindstr:toast', 'Saved to your pod')
    leaving = true
    location.href = appUrlFor(target)
  } catch (err) {
    toast('Couldn’t save: ' + err.message, { ms: 6000 })
    state.saving = false
    updateUi()
  }
}

async function openMine() {
  commitEdit()
  closeMenu()
  if (!identity() && !hostPod) return askToSignIn('mine', 'Sign in to open your map')
  const target = await myMapUrl()
  if (!target) return askToSignIn('mine', 'Sign in to open your map')
  if (target === mapUrl) return toast('This is your map')
  if (!(isExample && state.dirty)) leaving = true // unsaved example edits: let the browser ask
  location.href = appUrlFor(target)
}

function continueAfterLogin() {
  const next = session.get('mindstr:afterLogin')
  if (!next || !identity()) return
  session.set('mindstr:afterLogin', null)
  if (next === 'copy') saveCopy()
  else if (next === 'save') save()
  else if (next === 'mine') openMine()
}
document.addEventListener('xlogin', () => {
  updateUi()
  continueAfterLogin()
})
document.addEventListener('xlogout', () => updateUi())

window.addEventListener('beforeunload', e => {
  if (leaving || !state.dirty) return
  if ((mapUrl && state.canSave) || isExample) e.preventDefault()
})

// ---------- loading ----------

async function load() {
  let data = JSON.parse(island.textContent)
  let isNew = true
  let restored = false
  if (badUri) {
    state.canSave = false
    showBanner(`Can’t open “${mapParam}”: use an http(s) link to a .json or .jsonld map.`)
  }
  let updatesVia = null
  if (mapUrl) {
    statusEl.textContent = 'Loading…'
    try {
      const get = () => authFetch(mapUrl, { cache: 'no-cache', headers: { Accept: ACCEPT } })
      let res = await get()
      if (res.status === 401 || res.status === 403) {
        await ready() // private map: wait for xlogin to restore the session, then retry
        res = await get()
      }
      updatesVia = res.headers.get('Updates-Via')
      if (res.status === 404) {
        toast('New map — press Save to create it', { ms: 5000 })
      } else if (!res.ok) {
        throw new Error('HTTP ' + res.status)
      } else {
        data = await res.json()
        isNew = false
        remote.etag = res.headers.get('ETag')
        remote.exists = true
      }
    } catch (err) {
      state.canSave = false
      showBanner(`Couldn’t load ${mapUrl} (${err.message}). Saving is off so the original isn’t overwritten.`)
    }
  } else {
    const saved = store.get(SCRATCH_KEY)
    if (saved && !titleParam) {
      try {
        data = JSON.parse(saved)
        restored = true
      } catch {}
    }
  }
  // work stashed before a sign-in redirect comes back with the page
  let stash = null
  try {
    stash = JSON.parse(session.get('mindstr:stash') || 'null')
  } catch {}
  session.set('mindstr:stash', null)
  const fromStash = stash && stash.href === location.href
  if (fromStash) data = stash.data

  const { nodes, connections, selected, extra } = normalize(data)
  state.extra = extra
  if (isNew && titleParam && !fromStash) nodes[0].name = titleParam
  state.nodes = nodes
  state.connections = connections
  state.selected = selected
  analyze()
  state.dirty = fromStash ? Boolean(stash.dirty) : !mapUrl ? restored : isNew && state.canSave
  syncIsland()
  resize()
  fitView(false)
  updateUi()
  if (state.canSave || remote.exists) startLive(updatesVia)

  const msg = session.get('mindstr:toast')
  if (msg) {
    session.set('mindstr:toast', null)
    toast(msg)
  }
  if (!mapUrl && !restored && !fromStash && !coarse.matches) startEdit(0)
  else if (!coarse.matches) focusMap()
  if (session.get('mindstr:afterLogin')) ready().then(continueAfterLogin)
}

new ResizeObserver(resize).observe(stage)
dark.addEventListener('change', invalidate)
document.fonts?.ready.then(invalidate)
load()
