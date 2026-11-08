import { authFetch, hostPod, identity, login as openLogin, MAP_PATH, myMapUrl, ready } from './pod.js'
import { watch } from './live.js'
import { BRANCH_COLORS, readableText } from './colors.js'
import { newId, normalize, toDoc } from './doc.js'
import { makeImages } from './images.js'
import { blocked, chime, pop, setSound, soundOn, unlock } from './sound.js'
import { grownTo, growthOrder, parseSpeed } from './replay.js'
import { badgeAt, colorsFor, drawMap, linkIconAt, makeMeasure, THEMES } from './render.js'
import { fanLayout, radialLayout } from './layout.js'
import { parseOutline, toMarkdown } from './outline.js'
import { grownKids, growMessage, growSystem, storedKey, storedSettings, stream as claudeStream, topicFor } from './claude.js'
import { boundsOf, DRAG_THRESHOLD, fitBox, MIN_SCALE, pinchInfo as pinchOf, pinchTo, stepView, toScreen as screenOf, toWorld as worldOf, wheel as wheelView, zoomAt as zoomView } from './view.js'

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
const signinDialog = $('#signinDialog')
const mapsDialog = $('#mapsDialog')
const mapsList = $('#mapsList')
const menu = $('#menu')
const menuBtn = $('#menuBtn')
const findBar = $('#find')
const nodeMenu = $('#nodeMenu')
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
      return true
    } catch {
      return false
    }
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
const replayParam = params.get('replay') // ?replay=2s: regrow the map from its root
let mapUrl = null
let badUri = false
try {
  if (mapParam) mapUrl = new URL(mapParam, location.href).href
} catch {
  badUri = true
}
let focusId = null
if (mapUrl) {
  const u = new URL(mapUrl)
  if (u.hash.length > 1) focusId = u.hash
  u.hash = ''
  mapUrl = u.href
}
if (mapUrl && !/^https?:$/.test(new URL(mapUrl).protocol)) {
  mapUrl = null
  badUri = true
}
const isJsonLd = Boolean(mapUrl) && /\.jsonld$/i.test(new URL(mapUrl).pathname)
// Maps bundled with the app (examples/): the first edit turns them into a draft of your own.
let isExample = Boolean(mapUrl) && mapUrl.startsWith(new URL('./', location.href).href)

// ---------- drafts: maps kept in this browser until saved to a pod ----------

const DRAFTS_KEY = 'mindstr:drafts'
const draftKey = id => 'mindstr:draft:' + id
let draftId = null
const newDraftId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
function drafts() {
  try {
    return JSON.parse(store.get(DRAFTS_KEY) || '[]')
  } catch {
    return []
  }
}
let draftSource = null // file name or example a draft came from
let storageFailed = false
function saveDraft() {
  if (!draftId) return
  if (new URLSearchParams(location.search).get('draft') !== draftId) history.replaceState(null, '', draftUrl(draftId))
  const prev = drafts().find(d => d.id === draftId)
  const ok =
    store.set(draftKey(draftId), JSON.stringify(serialize())) &&
    store.set(
      DRAFTS_KEY,
      JSON.stringify([
        { id: draftId, title: state.nodes[0]?.name || 'Untitled', at: Date.now(), count: state.nodes.length, source: prev?.source || draftSource || undefined },
        ...drafts().filter(d => d.id !== draftId)
      ])
    )
  if (!ok && !storageFailed) {
    storageFailed = true
    showBanner('This browser can’t store your draft (storage is full or blocked). Download it or sign in to save it to your pod.', [
      ['Download', exportJson],
      ['Save to pod', () => saveCopy()]
    ])
  } else if (ok && storageFailed) {
    storageFailed = false
    hideBanner()
  }
  updateUi()
}
function deleteDraft(id) {
  store.set(draftKey(id), null)
  store.set(DRAFTS_KEY, JSON.stringify(drafts().filter(d => d.id !== id)))
}
function createDraft(data, title, source) {
  const id = newDraftId()
  const ok =
    store.set(draftKey(id), JSON.stringify(data)) &&
    store.set(DRAFTS_KEY, JSON.stringify([{ id, title: title || data?.nodes?.[0]?.name || 'Untitled', at: Date.now(), count: data?.nodes?.length || 1, source }, ...drafts()]))
  if (!ok) throw new Error('this browser can’t store it (storage full or blocked)')
  return id
}
// one-time move of the old single scratch slot into the drafts list
{
  const old = store.get('mindstr:scratch')
  if (old) {
    try {
      createDraft(JSON.parse(old))
    } catch {}
    store.set('mindstr:scratch', null)
  }
}
const draftUrl = id => {
  const u = new URL('./', location.href)
  u.searchParams.set('draft', id)
  return u.href
}

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
  version: '0.2', // format version of this map; kept on save (SPEC.md)
  extra: {} // unknown top-level fields (e.g. @context) round-trip untouched
}
let info = { parent: [], kids: [], depth: [], branchColor: [], visible: [], hidden: [] }
const peek = new Set() // ids of folded nodes shown open for find, without changing the map
const folded = n => n.collapsed && !peek.has(n['@id'])
let undoStack = [] // [{ n: serial, s: snapshot }]
let redoStack = []
let serial = 0
const topSerial = () => undoStack.at(-1)?.n

// ---------- model ----------

function serialize() {
  return toDoc(state)
}

// A stable colour for a branch that has none of its own (doesn't change when siblings move).
const hashColor = id => BRANCH_COLORS[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % BRANCH_COLORS.length]
// The branch colour least used among the root's current branches.
function freshColor() {
  const used = new Map(BRANCH_COLORS.map(c => [c, 0]))
  for (const k of info.kids[0] || []) {
    const c = info.branchColor[k]
    if (used.has(c)) used.set(c, used.get(c) + 1)
  }
  return [...used].sort((a, b) => a[1] - b[1])[0][0]
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
      const own = d === 1 ? branchOf(i) : col
      branchColor[i] = own
      for (const k of kids[i]) stack.push([k, d + 1, own, vis && !folded(state.nodes[i])])
    }
  }
  // top-level branch colours: explicit ones are kept; the rest take their hashed colour,
  // or the next palette colour no sibling is using
  const rootKids = kids[0]
  const taken = new Set(rootKids.map(k => state.nodes[k].bgColor).filter(Boolean).map(c => c.toUpperCase()))
  const assigned = new Map()
  for (const k of rootKids) {
    if (state.nodes[k].bgColor) continue
    let c = hashColor(state.nodes[k]['@id'])
    const start = BRANCH_COLORS.indexOf(c)
    for (let t = 0; t < BRANCH_COLORS.length && taken.has(c.toUpperCase()); t++) c = BRANCH_COLORS[(start + t + 1) % BRANCH_COLORS.length]
    taken.add(c.toUpperCase())
    assigned.set(k, c)
  }
  const branchOf = i => state.nodes[i].bgColor || assigned.get(i) || hashColor(state.nodes[i]['@id'])
  walk(0, 0, BRANCH_COLORS[0])
  for (let i = 0; i < n; i++) {
    if (depth[i] === -1 && (parent[i] === null || depth[parent[i]] === -1)) walk(i, 1, null)
  }
  for (let i = 0; i < n; i++) if (depth[i] === -1) walk(i, 1, null) // cycles
  const countBelow = i => kids[i].reduce((s, k) => s + 1 + countBelow(k), 0)
  for (let i = 0; i < n; i++) if (folded(state.nodes[i]) && kids[i].length) hidden[i] = countBelow(i)
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
  undoStack.push({ n: ++serial, s: snapshot() })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack = []
}

const syncIsland = () => (island.textContent = JSON.stringify(serialize()))

function changed({ view = false } = {}) {
  if (session.get('mindstr:afterLogin')) clearLoginIntent()
  analyze()
  if (view && (isExample || (mapUrl && !state.canSave))) {
    // folding / tidying an example or unloadable map is just looking: no fork, no dirty
    syncIsland()
    updateUi()
    invalidate()
    return
  }
  state.dirty = true
  syncIsland()
  if (isExample || (mapUrl && !state.canSave)) forkToDraft()
  if (!mapUrl) saveDraft()
  updateUi()
  invalidate()
}

const hideToast = () => (toastEl.hidden = true)
let lastInput = 'pointer'
document.addEventListener('pointerdown', () => (lastInput = 'pointer'), true)
document.addEventListener('keydown', e => {
  lastInput = 'key'
  document.querySelectorAll('dialog.quiet').forEach(d => d.classList.remove('quiet'))
}, true)
function openDialog(d) {
  d.classList.toggle('quiet', lastInput === 'pointer')
  hideToast()
  const pill = document.getElementById('xlogin-widget')
  if (pill) pill.style.visibility = 'hidden'
  d.showModal()
  d.addEventListener('close', () => pill && (pill.style.visibility = ''), { once: true })
}

function undo() {
  if (!undoStack.length) return
  hideToast()
  commitEdit()
  redoStack.push({ n: ++serial, s: snapshot() })
  restore(undoStack.pop().s)
  changed({ view: isExample || (Boolean(mapUrl) && !state.canSave) })
  if (state.selected !== null) ensureVisible(state.selected)
  announce('Undone')
}

function redo() {
  if (!redoStack.length) return
  hideToast()
  commitEdit()
  undoStack.push({ n: ++serial, s: snapshot() })
  restore(redoStack.pop().s)
  changed({ view: isExample || (Boolean(mapUrl) && !state.canSave) })
  if (state.selected !== null) ensureVisible(state.selected)
  announce('Redone')
}

// ---------- geometry ----------

let dpr = 1
let width = 0
let height = 0
const images = makeImages({ base: () => mapUrl || location.href, onChange: () => invalidate() })
const measure = makeMeasure(ctx, { shows: node => images.get(node.image).status !== 'failed' })
const size = i => measure(state.nodes[i], info.depth[i] ?? 2)
const pictureOf = node => {
  const { status, img } = images.get(node.image)
  return status === 'ready' ? img : null
}

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

// while hovering a drop target, draw the dragged branch offset from the pointer
function dragPos(i) {
  const p = pos(i)
  if (!gesture?.items?.some(it => it.j === i)) return p
  const t = state.drop !== null ? size(state.drop) : { h: 36 }
  return { x: p.x + 12 / state.view.scale, y: p.y + (t.h / 2 + 34) / state.view.scale }
}

const toWorld = (sx, sy) => worldOf(state.view, sx, sy)
const toScreen = (wx, wy) => screenOf(state.view, wx, wy)

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
    if (!(info.hidden[i] > 0) && state.selected !== i && state.hover !== i) continue
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
  userMoved = true
  zoomView(state.view, sx, sy, factor)
  positionEditor()
  invalidate()
}

// The part of the stage not covered by floating bars.
function visibleArea() {
  const top = findBar.hidden ? 0 : 64
  const bar = width < 760 && document.body.classList.contains('has-selection') ? 76 : 0
  return { top, bottom: height - bar }
}

function fitView(animate = true, initial = false) {
  if (!state.nodes.length || !width) return
  const box = boundsOf(fn => state.nodes.forEach((n, i) => info.visible[i] && fn(n, size(i))))
  const area = visibleArea()
  const small = width < 760 || coarse.matches
  const pad = width < 500 ? 20 : 56
  let view = fitBox(box, { width, top: area.top, bottom: area.bottom, pad, cap: small ? 1 : 1.25 })
  if (initial && small && view.scale < 0.45) {
    // too big to read when fitted on a phone: open on a readable piece around the root
    const scale = 0.62
    view = { scale, x: width / 2 - state.nodes[0].x * scale, y: (area.top + area.bottom) / 2 - state.nodes[0].y * scale }
  }
  setView(view, animate)
}

// Fit on request, and keep fitting as nodes arrive from elsewhere
function fitAll() {
  userMoved = false
  fitView()
}

function ensureVisible(i, animate = true) {
  const n = state.nodes[i]
  if (!n) return
  const s = toScreen(n.x, n.y)
  const m = size(i)
  const margin = 40 + (m.w * state.view.scale) / 2
  const area = visibleArea()
  if (s.x < margin || s.x > width - margin || s.y < area.top + 50 || s.y > area.bottom - 110) {
    const midY = (area.top + area.bottom) / 2
    setView({ ...state.view, x: state.view.x + width / 2 - s.x, y: state.view.y + midY - s.y }, animate)
  }
}

// ---------- drawing ----------

let flashing = { ids: new Set(), until: 0 }
function flash(ids, ms = FLASH_MS) {
  flashing = { ids: new Set(ids), until: performance.now() + ms, ms }
  invalidate()
}
const appearing = new Map() // id → start time
function appear(id) {
  if (reducedMotion.matches) return
  appearing.set(id, performance.now())
  invalidate()
}
function appearT(i) {
  const t0 = appearing.get(state.nodes[i]?.['@id'])
  if (t0 === undefined) return 1
  const t = (performance.now() - t0) / 240
  if (t >= 1) {
    appearing.delete(state.nodes[i]['@id'])
    return 1
  }
  return t
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
    dragging: gesture?.type === 'node' && gesture.moved ? new Set(gesture.items.map(it => it.j)) : null,
    pos: gesture?.type === 'node' && gesture.moved && state.drop !== null ? dragPos : pos,
    badgeR: coarse.matches ? 13 : 11,
    editing: state.editing?.index ?? null,
    flash: flashing.until > now ? { ids: flashing.ids, t: (flashing.until - now) / (flashing.ms || FLASH_MS) } : null,
    appear: appearT,
    matches: find.set,
    reduced: reducedMotion.matches,
    grid: true,
    picture: pictureOf,
    ...over
  }
}

let frame = 0
function invalidate() {
  if (!frame) frame = requestAnimationFrame(draw)
}

// While the view or the map moves, frames leave out the costliest effects (render.js); one
// full frame is drawn SETTLE_MS after the movement stops.
const SETTLE_MS = 140
let lastWheel = -Infinity // no scroll yet, so the first frames are full ones
let settle = 0
const isMoving = now =>
  Boolean(viewAnim) || anims.size > 0 || (gesture !== null && (gesture.moved || gesture.type === 'pinch')) || now - lastWheel < SETTLE_MS

function draw() {
  frame = 0
  const now = performance.now()
  // pos() clears a finished animation only for nodes it draws; clear the rest (nodes in a folded
  // branch) here, or they'd keep the map "moving" and redrawing forever
  for (const [id, a] of anims) if (now - a.t0 >= ANIM_MS) anims.delete(id)
  if (viewAnim) {
    if (!stepView(state.view, viewAnim, now)) viewAnim = null
    positionEditor()
  }
  const moving = isMoving(now)
  drawMap(ctx, scene({ moving }))
  if (moving) {
    clearTimeout(settle)
    settle = setTimeout(invalidate, SETTLE_MS)
  }
  placeTreeItems()
  if (viewAnim || anims.size || appearing.size || flashing.until > now) invalidate()
}

let userMoved = false
let loaded = false
function resize() {
  const rect = stage.getBoundingClientRect()
  const changedSize = Math.abs(rect.height - height) > 1 || Math.abs(rect.width - width) > 1
  dpr = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  positionEditor()
  if (loaded && !userMoved && changedSize && !state.editing) fitView(false, true)
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
  if (k) parts.push(info.hidden[i] > 0 ? `folded, ${info.hidden[i]} hidden` : `${k} ${k === 1 ? 'child' : 'children'}`)
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
  if (parentIndex === 0) node.bgColor = freshColor()
  state.nodes.push(node)
  const index = state.nodes.length - 1
  state.connections.push({ start: parentIndex, end: index })
  state.selected = index
  changed()
  const from = state.nodes[parentIndex]
  if (!reducedMotion.matches) anims.set(node['@id'], { x: from.x, y: from.y, t0: performance.now() })
  appear(node['@id'])
  ensureVisible(index)
  startEdit(index, true)
  announce(`New idea under ${state.nodes[parentIndex].name || 'Untitled'}. Type a name, Enter to finish.`)
}

function addSibling() {
  const sel = state.selected
  if (sel === null) return addChild(0)
  const parent = info.parent[sel]
  addChild(parent === null ? sel : parent)
}

// Undo for a specific action: only if nothing else has happened since.
function undoTo(mark) {
  return () => {
    if (topSerial() === mark) undo()
    else toast('Other changes came after that — use Ctrl+Z to step back')
  }
}

// Delete the selected branch (or, with nodeOnly, just the node: its children move up).
function deleteSelected({ nodeOnly = false, quiet = false } = {}) {
  const del = state.selected
  if (del === null) return
  if (del === 0) return toast('The central idea can’t be deleted')
  commitEdit()
  checkpoint()
  const mark = topSerial()
  const name = state.nodes[del].name || 'Untitled'
  const parent = info.parent[del]
  const kids = info.kids[del].slice()
  const gone = new Set(nodeOnly ? [del] : subtree(del))
  const ids = state.nodes.map(n => n['@id'])
  const keep = state.nodes.map((_, i) => i).filter(i => !gone.has(i))
  const newIndex = new Map(keep.map((old, k) => [old, k]))
  const conns = []
  for (const c of state.connections) {
    let { start, end } = c
    if (gone.has(end)) continue
    if (gone.has(start)) {
      if (!nodeOnly || parent === null) continue
      start = parent // children move up to the deleted node's parent
    }
    conns.push({ start: newIndex.get(start), end: newIndex.get(end) })
  }
  state.nodes = keep.map(i => state.nodes[i])
  state.connections = conns
  state.selected = parent === null ? 0 : newIndex.get(parent)
  analyze()
  if (nodeOnly && parent !== null) {
    // re-place the lifted children next to their new parent
    const before = positions()
    for (const k of kids) {
      const j = state.nodes.findIndex(n => n['@id'] === ids[k])
      if (j >= 0) placeBranch(j)
    }
    animateFrom(before)
  }
  changed()
  if (quiet) return
  const extra = gone.size - 1
  const msg = nodeOnly
    ? `Deleted “${name}”` + (kids.length ? ` · ${kids.length} moved up` : '')
    : `Deleted “${name}”` + (extra ? ` and ${extra} more` : '')
  toast(msg, { action: ['Undo', undoTo(mark)], ms: 6000 })
  announce(msg + '. Press Control Z to undo.')
}

function toggleCollapse(i = state.selected) {
  if (i === null || !info.kids[i]?.length) return
  commitEdit()
  checkpoint()
  const n = state.nodes[i]
  const collapsing = !(info.hidden[i] > 0)
  peek.delete(n['@id'])
  state.nodes[i] = { ...n, collapsed: collapsing || undefined }
  if (collapsing && state.selected !== null && state.selected !== i && subtree(i).includes(state.selected)) state.selected = i
  changed({ view: true })
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
  analyze()
  placeBranch(i)
  return true
}

// Put node i and its branch beside its parent, fanned outward and clear of other nodes.
function placeBranch(i) {
  const parent = info.parent[i]
  if (parent === null || parent === undefined) return
  const moving = new Set(subtree(i))
  const at = placeChild(parent, moving)
  state.nodes[i].x = at.x
  state.nodes[i].y = at.y
  const p = state.nodes[parent]
  const angle = Math.atan2((at.y - p.y) / 0.8, at.x - p.x)
  fanLayout(i, j => info.kids[j], size, j => state.nodes[j], angle)
  settleWithin(i, moving)
  pushClear(moving, angle)
}

// Nudge a block of nodes along `angle` until it no longer overlaps anything else.
function pushClear(moving, angle) {
  const others = state.nodes.map((_, j) => j).filter(j => !moving.has(j) && info.visible[j])
  const clash = () =>
    [...moving].some(a => {
      if (!info.visible[a]) return false
      const na = state.nodes[a]
      const ma = size(a)
      return others.some(b => {
        const nb = state.nodes[b]
        const mb = size(b)
        return Math.abs(na.x - nb.x) < (ma.w + mb.w) / 2 + 20 && Math.abs(na.y - nb.y) < (ma.h + mb.h) / 2 + 10
      })
    })
  for (let t = 0; t < 40 && clash(); t++) {
    for (const j of moving) {
      state.nodes[j].x += Math.round(40 * Math.cos(angle))
      state.nodes[j].y += Math.round(32 * Math.sin(angle))
    }
  }
}

// Inside a freshly laid-out branch, push any node that overlaps an earlier one
// outward from its parent (breadth-first), so nested fans don't collide.
function settleWithin(root, moving) {
  const order = []
  const queue = [root]
  while (queue.length) {
    const j = queue.shift()
    order.push(j)
    queue.push(...info.kids[j])
  }
  const box = j => ({ n: state.nodes[j], m: size(j) })
  const hits = (a, b) => Math.abs(a.n.x - b.n.x) < (a.m.w + b.m.w) / 2 + 20 && Math.abs(a.n.y - b.n.y) < (a.m.h + b.m.h) / 2 + 10
  order.forEach((j, k) => {
    if (!k) return
    const p = state.nodes[info.parent[j]]
    const a = Math.atan2((state.nodes[j].y - p.y) / 0.8, state.nodes[j].x - p.x)
    const me = box(j)
    for (let t = 0; t < 30 && order.slice(0, k).some(o => hits(me, box(o))); t++) {
      for (const d of subtree(j)) {
        state.nodes[d].x += Math.round(24 * Math.cos(a))
        state.nodes[d].y += Math.round(19 * Math.sin(a))
      }
    }
  })
}

// Keyboard restructuring: Alt+↑/↓ reorder, Alt+← promote, Alt+→ demote.
function moveNode(dir) {
  const i = state.selected
  if (i === null || i === 0) return
  const parent = info.parent[i]
  if (parent === null) return
  const sibs = info.kids[parent]
  const k = sibs.indexOf(i)
  const name = state.nodes[i].name || 'Untitled'
  commitEdit()
  const before = positions()
  if (dir === 'up' || dir === 'down') {
    const j = sibs[k + (dir === 'up' ? -1 : 1)]
    if (j === undefined) return say(dir === 'up' ? 'Already first' : 'Already last')
    checkpoint()
    // swap their order and their places on the canvas
    const ci = state.connections.findIndex(c => c.end === i)
    const cj = state.connections.findIndex(c => c.end === j)
    ;[state.connections[ci], state.connections[cj]] = [state.connections[cj], state.connections[ci]]
    const dx = state.nodes[j].x - state.nodes[i].x
    const dy = state.nodes[j].y - state.nodes[i].y
    for (const a of subtree(i)) Object.assign(state.nodes[a], { x: state.nodes[a].x + dx, y: state.nodes[a].y + dy })
    for (const b of subtree(j)) Object.assign(state.nodes[b], { x: state.nodes[b].x - dx, y: state.nodes[b].y - dy })
    changed()
    announce(`${name} moved ${dir}, ${k + (dir === 'up' ? 0 : 2)} of ${sibs.length}`)
  } else if (dir === 'left') {
    const gp = info.parent[parent]
    if (gp === null || gp === undefined) return say('Already at the top level')
    checkpoint()
    reparent(i, gp)
    changed()
    announce(`${name} moved up a level, under ${state.nodes[gp].name || 'Untitled'}`)
  } else {
    const prev = sibs[k - 1]
    if (prev === undefined) return say('No previous sibling to move under')
    checkpoint()
    reparent(i, prev)
    changed()
    announce(`${name} moved under ${state.nodes[prev].name || 'Untitled'}`)
  }
  animateFrom(before)
  ensureVisible(state.selected)
}

function tidy() {
  commitEdit()
  checkpoint()
  const before = positions()
  const root = state.nodes[0]
  const placed = radialLayout(0, i => info.kids[i], size, { x: root.x, y: root.y })
  for (const [i, p] of placed) Object.assign(state.nodes[i], p)
  changed({ view: true })
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
  openDialog(linkDialog)
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
  if (/^\.\.?\//.test(raw)) target = appUrlFor(url.href) // another map next to this one; .md links open where they live, like any other link
  window.open(target, '_blank', 'noopener')
}

function navigate(dx, dy) {
  if (state.selected === null) {
    select(0)
    return ensureVisible(0)
  }
  const from = state.nodes[state.selected]
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
    ...(n.image ? { image: n.image } : {}),
    ...(n.bgColor ? { bgColor: n.bgColor } : {}),
    ...(n.size !== undefined ? { size: n.size } : {}),
    kids: info.kids[i].map(toTree)
  }
}

function insertTrees(parent, trees) {
  if (!trees.length) return
  commitEdit()
  checkpoint()
  let first = null
  let count = 0
  const roots = []
  const add = (t, pi, top) => {
    const node = { '@id': newId(), name: t.name, x: state.nodes[pi].x, y: state.nodes[pi].y }
    if (t.link) node.link = t.link
    if (t.image) node.image = t.image
    if (t.bgColor) node.bgColor = t.bgColor
    if (t.size !== undefined) node.size = t.size
    state.nodes.push(node)
    const i = state.nodes.length - 1
    state.connections.push({ start: pi, end: i })
    count++
    if (first === null) first = i
    if (top) roots.push(i)
    for (const k of t.kids || []) add(k, i, false)
  }
  if (state.nodes[parent].collapsed) state.nodes[parent] = { ...state.nodes[parent], collapsed: undefined }
  for (const t of trees) add(t, parent, true)
  analyze()
  if (parent === 0) {
    for (const r of roots) {
      if (state.nodes[r].bgColor) continue
      state.nodes[r].bgColor = freshColor()
      analyze()
    }
  }
  for (const r of roots) placeBranch(r)
  state.selected = first
  changed()
  ensureVisible(first)
  toast(`Added ${count} ${count === 1 ? 'idea' : 'ideas'}`, { action: ['Undo', undoTo(topSerial())] })
  announce(`Added ${count} ideas`)
}

// ---------- grow with AI (js/claude.js) ----------
// Claude adds children to a node, with the whole map as context, using the key the visitor
// saved on make/ (same site, same localStorage). The result goes in as one edit.

const pathTo = i => {
  const path = []
  for (let j = i; j !== null && j !== undefined; j = info.parent[j]) path.unshift(state.nodes[j].name || 'Untitled')
  return path
}
const makeUrl = q => {
  const u = new URL('make/', location.href)
  if (q) u.searchParams.set('q', q)
  return u.href
}

let growing = null
async function grow(i) {
  const node = state.nodes[i]
  if (!node) return
  if (growing) return say('Already growing an idea: wait for it, or press Stop')
  const key = storedKey()
  if (!key) {
    toast('To grow ideas with AI, add your Claude API key on the Make page first.', {
      ms: 9000,
      action: ['Open Make', () => window.open(makeUrl(), '_blank', 'noopener')]
    })
    return
  }
  commitEdit()
  const id = node['@id']
  const name = node.name || 'Untitled'
  const existing = info.kids[i].map(k => state.nodes[k].name)
  const s = storedSettings()
  const content = growMessage({ outline: toMarkdown(toTree(0)), name, path: pathTo(i), count: s.breadth, existing })
  growing = new AbortController()
  toast(`Growing “${name}” with Claude…`, { ms: 120000, action: ['Stop', () => growing?.abort()] })
  announce(`Growing ${name}`)
  let text = ''
  try {
    const chunks = claudeStream({
      key,
      model: s.model,
      think: s.think,
      system: growSystem(s),
      messages: [{ role: 'user', content }],
      signal: growing.signal,
      maxTokens: 2048
    })
    for await (const c of chunks) if (c.text) text += c.text
    const seen = new Set(existing.map(n => n.toLowerCase()))
    const kids = grownKids(text).filter(k => !seen.has(k.name.toLowerCase()) && seen.add(k.name.toLowerCase()))
    // the map may have changed while Claude answered (edits, live updates): find the node again
    const at = state.nodes.findIndex(n => n['@id'] === id)
    if (at < 0) return say('That idea was removed while Claude was answering')
    if (!kids.length) return say('Claude sent no new ideas. Try again.')
    insertTrees(at, kids.slice(0, 12).map(k => ({ ...k, kids: [] })))
  } catch (e) {
    if (e.name === 'AbortError') say('Stopped growing')
    else toast(`Couldn’t grow “${name}”: ${e.message}`, { ms: 8000 })
  } finally {
    growing = null
  }
}

function openAsNewMap(i) {
  if (!state.nodes[i]) return
  window.open(makeUrl(topicFor(pathTo(i))), '_blank', 'noopener')
}

// the idea menu: right-click a node (a long-press on touch screens fires the same event)
function openNodeMenu(i, clientX, clientY) {
  closeMenu()
  select(i)
  nodeMenu.querySelector('#nodeMenuLink').hidden = !state.nodes[i].link
  nodeMenu.hidden = false
  const w = nodeMenu.offsetWidth
  const h = nodeMenu.offsetHeight
  nodeMenu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - w - 8)) + 'px'
  nodeMenu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - h - 8)) + 'px'
  nodeMenu.style.right = 'auto'
  nodeMenu.querySelector('button')?.focus({ preventScroll: true })
}
function closeNodeMenu(refocus) {
  if (nodeMenu.hidden) return
  nodeMenu.hidden = true
  if (refocus) focusMap()
}
canvas.addEventListener('contextmenu', e => {
  const p = localPoint(e)
  const i = hitTest(toWorld(p.x, p.y))
  if (i < 0) return // the browser's own menu, off the nodes
  e.preventDefault()
  openNodeMenu(i, e.clientX, e.clientY)
})
nodeMenu.addEventListener('keydown', e => {
  const items = [...nodeMenu.querySelectorAll('button')].filter(b => !b.hidden)
  const k = items.indexOf(document.activeElement)
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    return closeNodeMenu(true)
  }
  const go = { ArrowDown: k + 1, ArrowUp: k - 1, Home: 0, End: items.length - 1 }[e.key]
  if (go === undefined) return
  e.preventDefault()
  items[(go + items.length) % items.length]?.focus()
})
nodeMenu.addEventListener('focusout', e => {
  if (!nodeMenu.contains(e.relatedTarget)) closeNodeMenu()
})
document.addEventListener('pointerdown', e => {
  if (!nodeMenu.hidden && !nodeMenu.contains(e.target)) closeNodeMenu()
})

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
  const count = subtree(state.selected).length
  if (cut && state.selected !== 0) {
    const name = state.nodes[state.selected].name || 'Untitled'
    deleteSelected({ quiet: true })
    const mark = topSerial()
    toast(`Cut “${name}”` + (count > 1 ? ` (${count} ideas)` : ''), { action: ['Undo', undoTo(mark)] })
  } else toast(`Copied ${count === 1 ? 'idea' : `branch (${count} ideas)`}`)
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
  openDialog(importDialog)
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
  // an image served without CORS headers would stop the canvas being saved, so it's left out
  const exportable = node => {
    const { img, exportable: canSave } = images.get(node.image)
    return canSave ? img : null
  }
  const leftOut = state.nodes.filter((n, i) => info.visible[i] && pictureOf(n) && !exportable(n)).length
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  drawMap(
    out.getContext('2d'),
    scene({ view: { x: 24 - minX, y: 24 - minY, scale: 1 }, width: w, height: h, dpr: scale, grid: false, picture: exportable, selected: null, hover: null, drop: null, dragging: null, flash: null, matches: null, editing: null, pos: i => state.nodes[i] })
  )
  out.toBlob(b => download(b, slug() + '.png'), 'image/png')
  toast(leftOut ? `Image downloaded, without ${leftOut} node ${leftOut === 1 ? 'image' : 'images'} from sites that don't allow it` : 'Image downloaded')
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
  if (findBar.hidden) {
    let top = Infinity
    state.nodes.forEach((n, i) => info.visible[i] && (top = Math.min(top, toScreen(n.x, n.y).y - (size(i).h * state.view.scale) / 2)))
    if (top < 72) setView({ ...state.view, y: state.view.y + (72 - top) })
  }
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
  if (peek.size) {
    peek.clear()
    analyze()
    // if the selection went back into a folded branch, select its visible ancestor
    let i = state.selected
    while (i !== null && !info.visible[i]) i = info.parent[i]
    if (i !== state.selected) select(i, { speak: false })
    updateUi()
  }
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
  for (let p = info.parent[i]; p !== null && p !== undefined; p = info.parent[p]) if (state.nodes[p].collapsed) peek.add(state.nodes[p]['@id'])
  analyze()
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
  {
    // make sure the box is on screen (and above the on-screen keyboard on touch)
    const v = viewAnim?.to ?? state.view
    const sx = node.x * v.scale + v.x
    const sy = node.y * v.scale + v.y
    const half = (Math.max(size(index).w * v.scale + 28, 170)) / 2
    const ty = coarse.matches ? (window.visualViewport?.height || height) * 0.28 : sy < 60 || sy > height - 90 ? height / 2 : sy
    const tx = coarse.matches || sx - half < 8 || sx + half > width - 8 ? width / 2 : sx
    if (tx !== sx || ty !== sy) setView({ scale: v.scale, x: v.x + (tx - sx), y: v.y + (ty - sy) })
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
  editor.style.width = Math.max(m.w * k + 24, 140) + 'px'
  editor.style.height = Math.max(m.h * k, coarse.matches ? 44 : 34) + 'px'
  editor.style.borderRadius = Math.min(m.r * k, 22) + 'px'
  const sc = scene()
  const c = colorsFor(i, sc)
  editor.style.background = c.fill
  editor.style.color = readableText(c.fill)
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
    restore(undoStack.pop().s)
    changed()
    focusMap()
    return
  }
  if (name !== e.original) {
    if (!e.isNew) checkpoint()
    state.nodes[e.index] = { ...state.nodes[e.index], name }
    changed()
    announce(e.isNew ? `Added ${name}` : `Renamed to ${name}`)
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
    if (!editor.value.trim()) return cancelEdit()
    const id = state.nodes[state.editing.index]['@id']
    commitEdit()
    const i = state.nodes.findIndex(n => n['@id'] === id)
    if (i >= 0) addChild(i)
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
  return pinchOf(a, b)
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
  const hit = hitTest(w)
  const insideNode = hit >= 0 && Math.abs(w.x - state.nodes[hit].x) <= size(hit).w / 2 && Math.abs(w.y - state.nodes[hit].y) <= size(hit).h / 2
  const badge = insideNode ? -1 : badgeHit(w)
  if (badge >= 0) {
    gesture = { type: 'badge', index: badge, start: p, moved: false }
    return
  }
  if (hit >= 0) {
    const wasSelected = state.selected === hit
    select(hit)
    const items = (e.altKey ? [hit] : subtree(hit)).map(j => ({ j, dx: state.nodes[j].x - w.x, dy: state.nodes[j].y - w.y }))
    gesture = { type: 'node', index: hit, start: p, items, moved: false, onLink: onLinkIcon(hit, w) && (e.pointerType === 'mouse' || wasSelected) }
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
    viewAnim = null
    userMoved = true
    pinchTo(state.view, gesture, now)
    positionEditor()
    invalidate()
    Object.assign(gesture, now)
    return
  }

  const far = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD
  if (gesture.type === 'node') {
    if (!gesture.moved && !far) return
    if (!gesture.moved) {
      checkpoint()
      gesture.moved = true
      gesture.orig = new Map(gesture.items.map(({ j }) => [j, { x: state.nodes[j].x, y: state.nodes[j].y }]))
      canvas.classList.add('dragging')
    }
    const w = toWorld(p.x, p.y)
    for (const { j, dx, dy } of gesture.items) {
      state.nodes[j].x = Math.round(w.x + dx)
      state.nodes[j].y = Math.round(w.y + dy)
    }
    // drop target: a node under the pointer that isn't part of what we're dragging
    const moving = new Set(subtree(gesture.index))
    const t = hitTest(w, moving)
    const inside = t >= 0 && Math.abs(w.x - state.nodes[t].x) <= size(t).w / 2 && Math.abs(w.y - state.nodes[t].y) <= size(t).h / 2
    state.drop = inside && t !== info.parent[gesture.index] && gesture.index !== 0 ? t : null
    // pointing at a node inside the branch being dragged (possible with Alt) is not allowed
    const own = hitTest(w, new Set(gesture.items.map(it => it.j)))
    gesture.invalid = own >= 0 && moving.has(own) && Math.abs(w.x - state.nodes[own].x) <= size(own).w / 2 && Math.abs(w.y - state.nodes[own].y) <= size(own).h / 2
    canvas.style.cursor = gesture.invalid ? 'not-allowed' : ''
    invalidate()
  } else if (gesture.type === 'pan') {
    // a click doesn't count as moving the view (it's also how a viewer allows sound); a drag does
    if (far) gesture.moved = userMoved = true
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
  canvas.style.cursor = ''
  const before = positions()
  if (g.invalid) {
    for (const [j, p] of g.orig) Object.assign(state.nodes[j], p)
    restore(undoStack.pop().s)
    animateFrom(before)
    invalidate()
    updateUi()
    return toast('A branch can’t move into itself')
  }
  if (target !== null && reparent(g.index, target)) {
    changed()
    animateFrom(before)
    flash([state.nodes[target]['@id']], 500)
    announce(`Moved under ${state.nodes[target].name || 'Untitled'}`)
    return
  }
  // a free move: keep the moved block from landing on top of other nodes
  const moved = new Set(g.items.map(it => it.j))
  const o = g.orig.get(g.index)
  const n = state.nodes[g.index]
  if (o && (n.x !== o.x || n.y !== o.y)) pushClear(moved, Math.atan2((n.y - o.y) / 0.8, n.x - o.x))
  changed()
  animateFrom(before)
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
    userMoved = true
    lastWheel = performance.now()
    wheelView(state.view, e, localPoint(e), height) // pinch or Ctrl+wheel zooms, else pans
    positionEditor()
    invalidate()
  },
  { passive: false }
)

// ---------- keyboard ----------

const isField = t => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable
const anyDialogOpen = () => [helpDialog, linkDialog, importDialog, signinDialog, mapsDialog].some(d => d.open)

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
  if (!onMap) return
  if (e.altKey) {
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key]
    if (dir) {
      e.preventDefault()
      moveNode(dir)
    }
    return
  }
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
        return deleteSelected({ nodeOnly: e.shiftKey }), true
      case 'Escape':
        if (!findBar.hidden) return closeFind(), true
        if (sel === null) return false
        select(null)
        announce('Nothing selected. Tab leaves the map; Insert adds an idea.')
        return true
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
        return fitAll(), true
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
      case 'g':
        return grow(state.selected ?? 0), true
    }
    return false
  })()
  if (handled) e.preventDefault()
})

// ---------- toolbar and menu ----------

function showHelp() {
  closeMenu()
  $('#kbdHelp').open = !coarse.matches
  openDialog(helpDialog)
  helpDialog.querySelector('.dlg-body').scrollTop = 0
  $('#helpTitle').focus()
  helpDialog.onclose = focusMap
}

function openMenu(byKeyboard) {
  const r = menuBtn.getBoundingClientRect()
  menu.style.top = r.bottom + 6 + 'px'
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px'
  menu.hidden = false
  menuBtn.setAttribute('aria-expanded', 'true')
  if (byKeyboard) [...menu.querySelectorAll('button')].find(b => b.offsetParent)?.focus({ preventScroll: true })
  else menu.focus({ preventScroll: true })
}
function closeMenu(refocus) {
  if (menu.hidden) return
  menu.hidden = true
  menuBtn.setAttribute('aria-expanded', 'false')
  if (refocus) menuBtn.focus()
}
menu.addEventListener('keydown', e => {
  const items = [...menu.querySelectorAll('button')].filter(b => b.offsetParent)
  const k = items.indexOf(document.activeElement)
  if (e.key === 'Tab') {
    e.preventDefault()
    return closeMenu(true)
  }
  const go = { ArrowDown: k + 1, ArrowUp: k - 1, Home: 0, End: items.length - 1 }[e.key]
  if (go === undefined) return
  e.preventDefault()
  items[(go + items.length) % items.length]?.focus()
})
menu.addEventListener('focusout', e => {
  if (!menu.contains(e.relatedTarget) && e.relatedTarget !== menuBtn) closeMenu()
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
  fit: () => fitAll(),
  sound: toggleSound,
  replayPlay: () => (replay.timer ? pauseReplay() : playReplay()),
  replayRestart: () => (replayTo(1), playReplay()),
  replayEnd: () => replayTo(replay.order.length),
  zoomIn: () => zoomAt(width / 2, height / 2, 1.25),
  zoomOut: () => zoomAt(width / 2, height / 2, 0.8),
  find: openFind,
  maps: openMaps,
  openFile,
  newMap,
  findNext: () => stepFind(1),
  findPrev: () => stepFind(-1),
  findClose: closeFind,
  tidy,
  import: openImport,
  grow: () => grow(state.selected ?? 0),
  growMap: () => openAsNewMap(state.selected ?? 0),
  png: exportPng,
  outline: copyOutline,
  json: exportJson,
  save: () => save(),
  mine: () => openMine(),
  help: showHelp,
  menu: e => (menu.hidden ? openMenu(e?.detail === 0) : closeMenu()),
  hintClose: () => {
    store.set('mindstr:hint', 'off')
    updateUi()
  }
}

// browsers allow sound only after the viewer clicks or types on the page
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })
showSoundState()

for (const btn of document.querySelectorAll('[data-action]')) {
  const inMenu = menu.contains(btn)
  const inNodeMenu = nodeMenu.contains(btn)
  // keep keyboard focus on the map after mouse clicks on toolbar buttons
  if (!inMenu && !inNodeMenu && !findBar.contains(btn)) btn.addEventListener('mousedown', e => e.preventDefault())
  if (inMenu || inNodeMenu) btn.tabIndex = -1
  btn.addEventListener('click', e => {
    if (inMenu) closeMenu()
    if (inNodeMenu) closeNodeMenu()
    actions[btn.dataset.action]?.(e)
  })
}

tree.addEventListener('click', e => {
  const li = e.target.closest('[role=treeitem]')
  if (!li) return
  const i = Number(li.id.slice(3))
  if (state.selected === i) startEdit(i)
  else {
    select(i)
    ensureVisible(i)
  }
})

function placeTreeItems() {
  const k = state.view.scale
  for (const li of tree.children) {
    const i = Number(li.id.slice(3))
    const n = state.nodes[i]
    if (!n) continue
    const p = pos(i)
    const m = size(i)
    const w = Math.max(m.w * k, 44)
    const h = Math.max(m.h * k, 44)
    li.style.left = p.x * k + state.view.x - w / 2 + 'px'
    li.style.top = p.y * k + state.view.y - h / 2 + 'px'
    li.style.width = w + 'px'
    li.style.height = h + 'px'
  }
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
    if (info.kids[i].length) li.setAttribute('aria-expanded', String(!(info.hidden[i] > 0)))
    li.textContent = (n.name || 'Untitled') + (n.link ? ' (link)' : '')
    items.push(li)
    for (const k of info.kids[i]) walk(k)
  }
  walk(0)
  state.nodes.forEach((_, i) => info.depth[i] === 1 && info.parent[i] === null && walk(i))
  tree.replaceChildren(...items)
  placeTreeItems()
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
  document.body.classList.toggle('has-selection', has || width < 760 || coarse.matches)
  document.body.classList.toggle('node-selected', has)

  statusEl.textContent = state.saving
    ? 'Saving…'
    : storageFailed
      ? 'Not saved'
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

function say(msg) {
  toast(msg, { ms: 2000 })
  announce(msg)
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

// ---------- replay (?replay=2s): regrow the map from its root, one node at a time ----------
// It reuses the live-update path, so each step flashes, fits, pops, and the last one chimes. It's
// for watching: saving is refused part-way, so a half-grown map never replaces the real one.
const replay = { doc: null, order: [], n: 0, ms: parseSpeed(replayParam), timer: null }
const replayActive = () => replay.doc !== null && replay.n < replay.order.length
const currentDoc = () => ({ ...state.extra, version: state.version, nodes: state.nodes.map(n => ({ ...n })), connections: state.connections.map(c => ({ ...c })) })

function startReplay() {
  replay.doc = currentDoc()
  replay.order = growthOrder(replay.doc)
  const speed = $('#replaySpeed')
  if (![...speed.options].some(o => +o.value === replay.ms)) speed.add(new Option(`${replay.ms / 1000} s`, replay.ms))
  speed.value = String(replay.ms)
  $('#replay').hidden = false
  replayTo(1)
  fitView(false)
}

function replayTo(n) {
  if (state.dirty) {
    pauseReplay()
    return toast('You changed the map, so the replay stopped here.')
  }
  replay.n = Math.max(1, Math.min(n, replay.order.length))
  applyRemote(grownTo(replay.doc, replay.order, replay.n), remote.etag)
  if (!replayActive()) pauseReplay()
  showReplay()
}

function playReplay() {
  if (!replayActive()) replayTo(1)
  clearInterval(replay.timer)
  replay.timer = setInterval(() => replayTo(replay.n + 1), replay.ms)
  showReplay()
}

function pauseReplay() {
  clearInterval(replay.timer)
  replay.timer = null
  showReplay()
}

function showReplay() {
  if (!replay.doc) return
  const play = $('#replay [data-action=replayPlay]')
  play.querySelector('use').setAttribute('href', replay.timer ? '#i-pause' : '#i-play')
  play.title = replay.timer ? 'Pause' : replayActive() ? 'Play' : 'Play again'
  play.setAttribute('aria-label', play.title)
  $('#replayCount').textContent = `${replay.n} / ${replay.order.length}`
}

// The map changed on the pod while replaying: keep replaying the new version. Once the replay
// has finished, go back to normal live updates.
function replayLive(data, etag) {
  if (!replayActive()) {
    pauseReplay()
    replay.doc = null
    $('#replay').hidden = true
    return false
  }
  const { nodes, connections, extra, version } = normalize(data)
  replay.doc = { ...extra, version, nodes, connections }
  replay.order = growthOrder(replay.doc)
  remote.etag = etag
  remote.exists = true
  showReplay()
  return true
}

$('#replaySpeed').addEventListener('change', e => {
  replay.ms = Number(e.target.value)
  if (replay.timer) playReplay()
})

// A pop for a node from elsewhere, its note set by its main branch; a chime when the writer marks
// the map complete by selecting the root. Said once if the browser is still blocking sound.
let soundHinted = false
function arrivalSound(complete) {
  if (blocked()) {
    if (!soundHinted) toast('Click the map to hear updates')
    soundHinted = true
    return
  }
  if (complete) return chime()
  let i = state.selected
  while (i !== null && info.parent[i] !== 0 && info.parent[i] !== null && info.parent[i] !== undefined) i = info.parent[i]
  pop(Math.max(0, (info.kids[0] || []).indexOf(i)))
}

function toggleSound() {
  setSound(!soundOn())
  if (soundOn()) unlock()
  showSoundState()
  toast(soundOn() ? 'Sound on' : 'Sound off')
}
function showSoundState() {
  const label = document.querySelector('#menu [data-action=sound] span')
  if (label) label.textContent = soundOn() ? 'Sound: on' : 'Sound: off'
}

function applyRemote(data, etag) {
  const selId = state.nodes[state.selected]?.['@id']
  const known = new Set(state.nodes.map(n => n['@id']))
  if (state.editing) cancelEdit()
  const before = positions()
  const { nodes, connections, selected, extra, version } = normalize(data)
  state.nodes = nodes
  state.connections = connections
  state.extra = extra
  state.version = version
  analyze()
  const added = nodes.map((n, i) => i).filter(i => !known.has(nodes[i]['@id']))
  if (added.length) {
    state.selected = added[added.length - 1]
    flash(added.map(i => nodes[i]['@id']))
    // fit the whole map, as Make does, until the viewer pans or zooms; then just keep the new node in view
    if (userMoved) ensureVisible(state.selected)
    else fitView()
    arrivalSound(selected === 0 && nodes.length > 1)
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
    if (replay.doc && replayLive(data, etag)) return
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

// ---------- update events ----------
// A repo with a blocktrail announces each new state on Nostr (kind 30811, blocktrails.org); the
// event names the repo's map in an r tag. Hearing one for the map on screen: refetch and redraw,
// the same path as a change on the pod. Nothing is trusted from the event itself but the nudge.

const EVENT_KIND = 30811
const EVENT_RELAYS = ['wss://melvin.me/relay', 'wss://relay.nostr.com', 'wss://relay.primal.net']
function startEvents() {
  if (!mapUrl || !/^https?:/.test(mapUrl) || typeof WebSocket === 'undefined') return
  const since = Math.floor(Date.now() / 1000) - 60
  const seen = new Set()
  for (const url of EVENT_RELAYS) {
    let attempt = 0
    const open = () => {
      let ws
      try { ws = new WebSocket(url) } catch { return }
      ws.onopen = () => { attempt = 0; ws.send(JSON.stringify(['REQ', 'upd', { kinds: [EVENT_KIND], '#r': [mapUrl], since }])) }
      ws.onmessage = m => {
        let x
        try { x = JSON.parse(m.data) } catch { return }
        if (x[0] !== 'EVENT' || !x[2] || seen.has(x[2].id)) return
        seen.add(x[2].id)
        checkRemote()
      }
      ws.onerror = () => {}
      ws.onclose = () => setTimeout(open, Math.min(60000, 2000 * 2 ** attempt++))
    }
    open()
  }
}

// ---------- saving ----------

let leaving = false

const STASH_MS = 15 * 60 * 1000
function stashForLogin(next) {
  session.set('mindstr:afterLogin', JSON.stringify({ next, at: Date.now() }))
  // scratch maps already live in localStorage; only pod/example maps need carrying across a redirect
  if (mapUrl) session.set('mindstr:stash', JSON.stringify({ href: location.href, data: serialize(), dirty: state.dirty, at: Date.now() }))
}
function clearLoginIntent() {
  session.set('mindstr:afterLogin', null)
  session.set('mindstr:stash', null)
}
function loginIntent() {
  try {
    const v = JSON.parse(session.get('mindstr:afterLogin') || 'null')
    return v && Date.now() - v.at < STASH_MS ? v.next : null
  } catch {
    return null
  }
}

function askToSignIn(next, why) {
  hideToast()
  $('#signinTitle').textContent = why
  signinDialog.returnValue = ''
  openDialog(signinDialog)
  signinDialog.onclose = () => {
    const v = signinDialog.returnValue
    if (v === 'signin') {
      stashForLogin(next)
      if (!openLogin()) toast('Sign-in couldn’t load. Check your connection and try again.', { ms: 6000 })
    } else if (v === 'download') {
      exportJson()
      focusMap()
    } else focusMap()
  }
}

// The first edit to an example (or a map that couldn't be loaded) makes it your own draft.
function forkToDraft() {
  const from = mapUrl
  const wasExample = isExample
  isExample = false
  mapUrl = null
  state.canSave = false
  draftId = newDraftId()
  draftSource = from
  saveDraft()
  hideBanner()
  toast(`Editing your own copy · kept in this browser`, { ms: 4000 })
  announce(`Editing your own copy of ${state.nodes[0].name}, kept in this browser`)
  if (!wasExample) remote.live = false
}

function openFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.jsonld,.md,.markdown,.txt,application/json,application/ld+json,text/markdown,text/plain'
  input.onchange = () => input.files[0] && importFile(input.files[0])
  input.click()
}
// Turn outline trees into a laid-out map document.
function mapFromTrees(trees, fallbackTitle) {
  const root = trees.length === 1 ? trees[0] : { name: fallbackTitle, kids: trees }
  const nodes = []
  const connections = []
  const add = (t, parent) => {
    nodes.push({ '@id': nodes.length ? newId() : '#this', name: t.name, x: 0, y: 0, ...(t.link ? { link: t.link } : {}) })
    const i = nodes.length - 1
    if (parent !== null) connections.push({ start: parent, end: i })
    for (const k of t.kids || []) add(k, i)
  }
  add(root, null)
  const kidsOf = i => connections.filter(c => c.start === i).map(c => c.end)
  const depthOf = i => (i === 0 ? 0 : 1 + depthOf(connections.find(c => c.end === i).start))
  const placed = radialLayout(0, kidsOf, i => measure(nodes[i], depthOf(i)))
  for (const [i, p] of placed) Object.assign(nodes[i], p)
  return { version: '0.2', nodes, connections }
}

async function importFile(file) {
  try {
    const text = await file.text()
    let data
    if (/\.(md|markdown|txt|opml)$/i.test(file.name) || /^text\/(markdown|plain)/.test(file.type)) {
      const trees = parseOutline(text)
      if (!trees.length) throw new Error('no outline found')
      data = mapFromTrees(trees, file.name.replace(/\.[^.]+$/, ''))
    } else {
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('Mindstr opens .json / .jsonld maps and text or Markdown outlines')
      }
      if (!Array.isArray(data?.nodes)) throw new Error('that JSON isn’t a Mindstr map')
    }
    if (!(mapUrl && state.dirty && state.canSave)) leaving = true
    location.href = draftUrl(createDraft(data, null, file.name))
  } catch (err) {
    toast(`Couldn’t open ${file.name}: ${err.message}`, { ms: 6000 })
  }
}
stage.addEventListener('dragover', e => {
  if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault()
})
stage.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  e.preventDefault()
  importFile(f)
})

// ---------- your maps ----------

const RECENT_KEY = 'mindstr:recent'
function recentMaps() {
  try {
    return JSON.parse(store.get(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}
function remember(url, title) {
  const list = recentMaps().filter(m => m.url !== url)
  list.unshift({ url, title: title || 'Untitled', at: Date.now() })
  store.set(RECENT_KEY, JSON.stringify(list.slice(0, 12)))
}

function mapLink(url, title, note) {
  const li = document.createElement('li')
  const a = document.createElement('a')
  a.href = appUrlFor(url)
  a.textContent = title
  const span = document.createElement('span')
  span.textContent = note
  a.append(span)
  li.append(a)
  return li
}

async function openMaps() {
  closeMenu()
  hideToast()
  mapsList.replaceChildren()
  const section = (title, items) => {
    if (!items.length) return
    const h = document.createElement('h3')
    h.textContent = title
    const ul = document.createElement('ul')
    ul.className = 'maplist'
    ul.append(...items)
    mapsList.append(h, ul)
  }
  const ago = t => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  section(
    'Drafts in this browser',
    drafts().map(d => {
      const li = document.createElement('li')
      li.className = 'row'
      const a = document.createElement('a')
      a.href = draftUrl(d.id)
      a.textContent = d.title
      const span = document.createElement('span')
      const from = d.source ? ` · from ${decodeURIComponent(String(d.source).split('/').pop())}` : ''
      span.textContent = (d.id === draftId ? 'open now · ' : '') + ago(d.at) + (d.count ? ` · ${d.count} ${d.count === 1 ? 'idea' : 'ideas'}` : '') + from
      a.append(span)
      const del = document.createElement('button')
      del.className = 'danger-ghost'
      if (d.id === draftId) {
        del.disabled = true
        del.title = 'Open another map to delete this one'
      }
      del.setAttribute('aria-label', 'Delete draft ' + d.title)
      del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-delete" /></svg>'
      del.addEventListener('click', () => {
        const json = store.get(draftKey(d.id))
        deleteDraft(d.id)
        li.remove()
        toast(`Deleted draft “${d.title}”`, {
          action: ['Undo', () => {
            store.set(draftKey(d.id), json)
            store.set(DRAFTS_KEY, JSON.stringify([d, ...drafts()]))
            openMaps()
          }],
          ms: 7000
        })
        if (d.id === draftId) {
          // the map is still on screen: keep it as a fresh draft so nothing is lost
          draftId = newDraftId()
          saveDraft()
          openMaps()
        }
      })
      li.append(a, del)
      return li
    })
  )
  const when = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  section('Recent', recentMaps().map(m => mapLink(m.url, m.title, new URL(m.url).host + ' · ' + when(m.at))))
  const status = document.createElement('p')
  status.className = 'muted'
  mapsList.append(status)
  openDialog(mapsDialog)
  $('#mapsTitle').focus()
  mapsDialog.onclose = focusMap
  if (!identity() && !hostPod) {
    status.textContent = 'Sign in to see the maps in your pod.'
    return
  }
  status.textContent = 'Looking in your pod…'
  try {
    const dir = new URL('./', await myMapUrl()).href
    const res = await authFetch(dir, { headers: { Accept: 'application/ld+json' } })
    if (res.status === 404) return (status.textContent = 'No maps in your pod yet.')
    const listing = await res.json()
    const graph = [].concat(listing['@graph'] || listing)
    const items = graph.flatMap(g => [].concat(g['ldp:contains'] || g.contains || []))
    const urls = items
      .map(it => new URL(typeof it === 'string' ? it : it['@id'], dir).href)
      .filter(u => /\.jsonld?$/i.test(u))
    status.remove()
    section('In your pod', urls.map(u => mapLink(u, decodeURIComponent(u.split('/').pop().replace(/\.jsonld?$/i, '')), new URL(u).pathname)))
    if (!urls.length) mapsList.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No maps in your pod yet.' }))
  } catch {
    status.textContent = 'Couldn’t list your pod.'
  }
}

function newMap() {
  closeMenu()
  if (!mapUrl && state.nodes.length === 1 && state.nodes[0].name === 'Central idea') return startEdit(0)
  if (!(mapUrl && state.dirty && state.canSave)) leaving = true
  location.href = draftUrl(newDraftId())
}

async function save() {
  commitEdit()
  if (state.saving) return
  if (replayActive()) return toast('This is a replay, part-way through. Show the whole map (⏭) before saving.', { ms: 6000 })
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
    remember(mapUrl, state.nodes[0].name)
    remote.exists = true
    remote.etag = null // JSS doesn't return the new ETag; checkRemote learns it
    hideBanner()
    toast('Saved')
    announce('Saved')
    if (soundOn()) new Audio('./audio/save.ogg').play().catch(() => {})
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
    remember(target, state.nodes[0].name)
    if (draftId) deleteDraft(draftId)
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
  const next = loginIntent()
  if (!next || !identity()) return
  clearLoginIntent()
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
  if ((mapUrl && state.canSave) || isExample || storageFailed) e.preventDefault()
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
        if (!isExample) remember(mapUrl, data?.nodes?.[0]?.name)
        remote.etag = res.headers.get('ETag')
        remote.exists = true
      }
    } catch (err) {
      state.canSave = false
      showBanner(`Couldn’t load ${mapUrl} (${err.message}). Saving is off so the original isn’t overwritten.`)
    }
  } else {
    const wanted = params.get('draft')
    draftId = wanted || (!titleParam && drafts()[0]?.id) || newDraftId()
    const saved = store.get(draftKey(draftId))
    if (saved) {
      try {
        data = JSON.parse(saved)
        restored = true
      } catch {}
    }
    if (wanted !== draftId) history.replaceState(null, '', draftUrl(draftId) + (titleParam ? '&title=' + encodeURIComponent(titleParam) : ''))
  }
  // work stashed before a sign-in redirect comes back with the page
  let stash = null
  try {
    stash = JSON.parse(session.get('mindstr:stash') || 'null')
  } catch {}
  session.set('mindstr:stash', null)
  const fromStash = Boolean(mapUrl) && stash?.href === location.href && Date.now() - stash.at < STASH_MS
  if (fromStash) data = stash.data

  const { nodes, connections, selected, extra, version } = normalize(data)
  state.extra = extra
  state.version = isNew && !fromStash && !restored ? '0.2' : version
  if (isNew && titleParam && !fromStash) nodes[0].name = titleParam
  state.nodes = nodes
  state.connections = connections
  state.selected = fromStash ? selected : null // open calm: nothing selected until you act
  analyze()
  state.dirty = fromStash ? Boolean(stash.dirty) : !mapUrl ? restored : isNew && state.canSave
  syncIsland()
  resize()
  fitView(false, true)
  loaded = true
  updateUi()
  if (state.canSave || remote.exists) startLive(updatesVia)
  if (remote.exists) startEvents()
  if (replayParam !== null && state.nodes.length > 1) startReplay()

  if (focusId) {
    const i = state.nodes.findIndex(n => n['@id'] === focusId)
    if (i >= 0) {
      reveal(i)
      select(i)
      ensureVisible(i, false)
    }
  }
  if (isExample) {
    const copy = drafts().find(d => d.source === mapUrl)
    if (copy) showBanner(`You already have a copy of this example (“${copy.title}”). Editing here starts another copy.`, [['Open your copy', () => (location.href = draftUrl(copy.id))]])
  }
  const msg = session.get('mindstr:toast')
  if (msg) {
    session.set('mindstr:toast', null)
    toast(msg)
  }
  if (!mapUrl && !restored && !fromStash && !coarse.matches) startEdit(0)
  else if (!coarse.matches) focusMap()
  if (loginIntent()) ready().then(continueAfterLogin)
}

new ResizeObserver(resize).observe(stage)
dark.addEventListener('change', invalidate)
document.fonts?.load('700 18px Manrope').then(() => document.fonts.load('700 15px Manrope')).then(() => {
  measure.reset()
  invalidate()
}).catch(() => {})
load()
