// Make a map: type a topic, Claude writes it as an outline, the map grows on screen as the
// outline streams in. Runs entirely in the browser with the visitor's own API key.
import { radialLayout } from '../js/layout.js'
import { drawMap, makeMeasure, THEMES } from '../js/render.js'
import { parseOutline, toMarkdown } from '../js/outline.js'
import { BRANCH_COLORS } from '../js/colors.js'

const $ = s => document.querySelector(s)
const API = 'https://api.anthropic.com/v1/messages'
const SAVE_HELPER = 'http://localhost:5463/save'
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const newId = () => '#' + Array.from({ length: 6 }, () => ALPHABET[(Math.random() * 32) | 0]).join('')
const CAP = [0, 8, 30, 60, 110] // nodes in total, by depth

// ---------- settings ----------
const fields = ['depth', 'breadth', 'model', 'style', 'lang', 'links', 'think']
const settings = Object.fromEntries(fields.map(f => [f, $('#' + f).value]))
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('mindstr.make.settings') || '{}'))
  $('#key').value = localStorage.getItem('mindstr.make.key') || ''
} catch {}
for (const f of fields) {
  const el = $('#' + f)
  if (settings[f] !== undefined) el.value = settings[f]
  el.addEventListener('input', () => {
    settings[f] = el.value
    try { localStorage.setItem('mindstr.make.settings', JSON.stringify(settings)) } catch {}
    showRanges()
  })
}
const showRanges = () => {
  $('#depthOut').value = settings.depth
  $('#breadthOut').value = settings.breadth
}
showRanges()
$('#key').addEventListener('input', () => {
  try { localStorage.setItem('mindstr.make.key', $('#key').value.trim()) } catch {}
})
$('#gear').addEventListener('click', () => {
  const open = $('#settings').hidden
  $('#settings').hidden = !open
  $('#gear').setAttribute('aria-expanded', String(open))
})
for (const chip of document.querySelectorAll('.chip')) chip.addEventListener('click', () => { $('#q').value = chip.textContent; build() })
$('#form').addEventListener('submit', e => { e.preventDefault(); build() })

// Prices in $ per million tokens, editable, saved with the other settings.
const PRICES = { haiku: [0.1, 0.5], sonnet: [2, 10], opus: [4, 20] } // platform.claude.com pricing, 4 Nov 2026
const family = model => (/haiku/.test(model) ? 'haiku' : /sonnet/.test(model) ? 'sonnet' : 'opus')
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
const cost = (req, model) => {
  const [pin, pout] = prices[family(model)] || [0, 0]
  return ((req.input || 0) * pin + (req.output || 0) * pout) / 1e6
}
const money = usd => (usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`)

// ---------- the tree ----------
// tree: { id, name, link?, kids: [tree] }
let tree = null
let busy = false

const STYLE = {
  overview: 'A balanced overview: the main parts of the topic, then what matters most inside each.',
  study: 'Study notes: definitions, key facts, examples, common mistakes, with concrete details a learner would need.',
  plan: 'A plan of action: phases, concrete steps, what to decide, risks, what done looks like.',
  questions: 'Questions worth asking about the topic, grouped by theme, each node one short question.'
}

function system() {
  const d = Number(settings.depth)
  const b = Number(settings.breadth)
  return [
    'You write mind maps as Markdown outlines and nothing else: no preamble, no closing remarks, no code fences.',
    'Format: the first line is "# <title>" (the root, at most 5 words). Then nested bullets, "- " with two spaces of indent per level.',
    `Shape: the root has ${Math.min(b, 7)} branches. Any node has at most ${b} children. Nest at most ${d} level${d > 1 ? 's' : ''} below the root. Keep the whole map under ${CAP[d]} nodes.`,
    'Node text: at most 6 words, concrete and specific, title-free fragments, no trailing punctuation, no bold or emphasis.',
    'Order: the most important first. Put real content in the map: names, numbers, terms, not headings like "Introduction".',
    STYLE[settings.style] || STYLE.overview,
    settings.links === 'yes' ? 'When you are sure a URL exists, write a node as [text](https://…). Never invent URLs.' : 'No links.',
    `Language: ${settings.lang || 'English'}.`,
    'If the request names a URL, fetch it with web_fetch first and map what that page actually says: the root is the page title, the branches its main sections or claims. Do not pad with general knowledge.'
  ].join('\n')
}

// Thinking off is spelled differently per model (checked 4 Nov 2026): Haiku 5.5 takes
// "disabled", Sonnet 5.5 takes "between_tools", Opus 5.5 always thinks and is quickest with
// adaptive thinking at low effort. On: adaptive for all.
function thinkingFor(model, on) {
  if (on) return { thinking: { type: 'adaptive' } }
  if (/haiku/.test(model)) return { thinking: { type: 'disabled' } }
  if (/sonnet/.test(model)) return { thinking: { type: 'between_tools' } }
  return { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
}

// Claude's streamed text, as it arrives.
async function* stream(messages, { signal, extra = {} } = {}) {
  const key = $('#key').value.trim()
  if (!key) throw new Error('Add your Claude API key under ⚙ first.')
  const res = await fetch(API, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      stream: true,
      ...thinkingFor(settings.model, settings.think === 'yes'),
      system: system(),
      messages,
      ...extra
    })
  })
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText
    try { msg = (await res.json()).error?.message || msg } catch {}
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let ev
      try { ev = JSON.parse(line.slice(6)) } catch { continue }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield { text: ev.delta.text }
      else if (ev.type === 'message_start' && ev.message?.usage) yield { usage: ev.message.usage }
      else if (ev.type === 'message_delta' && ev.usage) yield { usage: ev.usage }
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error')
    }
  }
}

// Keep the outline and drop any chatter around it ("I'll fetch the page first." and the like).
function outlineOnly(text) {
  let at = text.search(/(^|\n)#\s/)
  if (at < 0) at = text.search(/#\s+\S/) // "I'll fetch the page first.# Title" on one line
  if (at >= 0) text = text.slice(at)
  return text.split('\n').filter(l => /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(l)).join('\n') + '\n'
}

// No heading came back: the bullets go under one root named after the request.
const rooted = (roots, q) => (roots.length > 1 ? [{ name: q.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), kids: roots }] : roots)

// Give every node a stable id by its path, so a re-parse of the growing outline keeps ids.
function adopt(roots, ids, path = '') {
  roots.forEach((n, i) => {
    const p = path + '/' + i
    n.id = ids.get(p) || (ids.set(p, path ? newId() : '#this'), ids.get(p))
    adopt(n.kids, ids, p)
  })
}

let abort = null
async function build() {
  const q = $('#q').value.trim()
  if (!q || busy) return
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
  const urls = q.match(/https?:\/\/[^\s<>"')\]]+/g) || []
  const who = settings.model.replace('claude-', '').replace(/-/g, ' ')
  status(urls.length ? `Fetching ${urls.length === 1 ? 'the page' : urls.length + ' pages'}, then asking ${who}…` : `Asking ${who}…`)
  const content = urls.length
    ? `Mind map of the page${urls.length > 1 ? 's' : ''} at ${urls.join(' and ')}${q.replace(/https?:\/\/[^\s<>"')\]]+/g, '').trim() ? ` (${q.replace(/https?:\/\/[^\s<>"')\]]+/g, '').trim()})` : ''}. Fetch first, then map what it says.`
    : `Mind map of: ${q}`
  const extra = urls.length ? { tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: Math.min(urls.length, 3) }] } : {}
  const ids = new Map()
  let text = ''
  const req = {}
  try {
    for await (const chunk of stream([{ role: 'user', content }], { signal: abort.signal, extra })) {
      if (chunk.usage) { tally(chunk.usage, req); continue }
      text += chunk.text
      const complete = outlineOnly(text.slice(0, text.lastIndexOf('\n') + 1))
      const roots = rooted(parseOutline(complete), q)
      if (!roots.length) continue
      adopt(roots, ids)
      setTree(roots[0])
      status(`Building… ${count(tree)} nodes`)
    }
    const roots = rooted(parseOutline(outlineOnly(text)), q)
    if (!roots.length) throw new Error('Claude sent no outline. Try again.')
    adopt(roots, ids)
    setTree(roots[0])
    status(`${count(tree)} nodes · ${spent(req)}`, 'done')
    $('#actions').hidden = false
  } catch (e) {
    if (e.name !== 'AbortError') status(e.message, 'err')
  } finally {
    busy = false
    $('#go').disabled = false
    $('#go').textContent = 'Build'
  }
}

// Ask for the children of one leaf, in the context of the whole map.
async function grow(i) {
  if (busy || !tree) return
  const node = flat.nodes[i]
  if (node.kids.length) return
  const path = []
  for (let j = i; j !== null && j !== undefined; j = flat.parent[j]) path.unshift(flat.nodes[j].name)
  busy = true
  status(`Growing “${node.name}”…`)
  let text = ''
  const req = {}
  try {
    const messages = [{
      role: 'user',
      content: `Here is a mind map:\n\n${toMarkdown(tree)}\nAdd ${settings.breadth} children to the node “${node.name}” (${path.join(' › ')}). Output only those children as top-level "- " bullets, with no heading and no nesting.`
    }]
    const pending = []
    for await (const chunk of stream(messages)) {
      if (chunk.usage) { tally(chunk.usage, req); continue }
      text += chunk.text
      const complete = text.slice(0, text.lastIndexOf('\n') + 1)
      const kids = parseOutline(complete).flatMap(r => (r.kids.length ? [r, ...r.kids] : [r]))
      kids.forEach((k, j) => {
        if (!pending[j]) {
          pending[j] = { id: newId(), name: k.name, link: k.link, kids: [] }
          node.kids.push(pending[j])
        } else Object.assign(pending[j], { name: k.name, link: k.link })
      })
      setTree(tree)
    }
    status(`${count(tree)} nodes · ${spent(req)}`, 'done')
  } catch (e) {
    status(e.message, 'err')
  } finally {
    busy = false
  }
}

const count = n => 1 + n.kids.reduce((s, k) => s + count(k), 0)

// Tokens: per request and for the whole page session (input tokens come with message_start,
// output tokens arrive as a running figure in message_delta).
const used = { input: 0, output: 0, calls: 0, usd: 0 }
function tally(usage, req) {
  if (usage.input_tokens !== undefined) {
    req.input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
  }
  if (usage.output_tokens !== undefined) req.output = usage.output_tokens
}
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
let width = 0
let height = 0
let dpr = 1
let hover = null

function resetView() {
  current.clear()
  target.clear()
  appearing.clear()
  viewTarget = null
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
  nodes.forEach((n, i) => {
    const p = placed.get(i)
    target.set(n.id, p)
    if (!current.has(n.id)) {
      // start a new node at its parent, so it grows out of it
      const from = parent[i] !== null ? current.get(nodes[parent[i]].id) || p : p
      current.set(n.id, { x: from.x, y: from.y })
      appearing.set(n.id, now)
    }
  })
  fit()
  invalidate()
}

function fit() {
  if (!flat.nodes.length) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  flat.nodes.forEach((n, i) => {
    const p = target.get(n.id)
    const m = measure(n, flat.depth[i])
    x0 = Math.min(x0, p.x - m.w / 2)
    x1 = Math.max(x1, p.x + m.w / 2)
    y0 = Math.min(y0, p.y - m.h / 2)
    y1 = Math.max(y1, p.y + m.h / 2)
  })
  const pad = 48 // the status pill sits in the bottom margin
  const scale = Math.min(1.1, (width - pad * 2) / Math.max(1, x1 - x0), (height - pad * 2 - 30) / Math.max(1, y1 - y0))
  viewTarget = { scale, x: width / 2 - ((x0 + x1) / 2) * scale, y: (height - 30) / 2 - ((y0 + y1) / 2) * scale }
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

// hover and click: a leaf grows on click
function hit(ev) {
  const r = canvas.getBoundingClientRect()
  const x = (ev.clientX - r.left - view.x) / view.scale
  const y = (ev.clientY - r.top - view.y) / view.scale
  for (let i = flat.nodes.length - 1; i >= 0; i--) {
    const p = pos(i)
    const m = size(i)
    if (Math.abs(x - p.x) <= m.w / 2 && Math.abs(y - p.y) <= m.h / 2) return i
  }
  return null
}
canvas.addEventListener('pointermove', ev => {
  const h = hit(ev)
  if (h !== hover) {
    hover = h
    canvas.style.cursor = h !== null && !flat.kids[h].length ? 'pointer' : ''
    invalidate()
  }
})
canvas.addEventListener('pointerleave', () => { hover = null; invalidate() })
canvas.addEventListener('click', ev => {
  const h = hit(ev)
  if (h === null) return
  const n = flat.nodes[h]
  if (n.link && ev.altKey) return window.open(n.link, '_blank', 'noopener')
  grow(h)
})

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
