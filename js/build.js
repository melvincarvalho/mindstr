// Build a whole map from a query: Claude writes it as a Markdown outline and the tree grows as
// the outline streams in. No DOM: the caller gives the key and settings and draws each tree.
// Used by make/ and the app (#49).
import { parseOutline } from './outline.js'
import { stream as claudeStream } from './claude.js'
import { tally } from './usage.js'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export const newId = () => '#' + Array.from({ length: 6 }, () => ALPHABET[(Math.random() * 32) | 0]).join('')
const CAP = [0, 8, 30, 60, 110] // nodes in total, by depth

export const STYLE = {
  overview: 'A balanced overview: the main parts of the topic, then what matters most inside each.',
  study: 'Study notes: definitions, key facts, examples, common mistakes, with concrete details a learner would need.',
  plan: 'A plan of action: phases, concrete steps, what to decide, risks, what done looks like.',
  questions: 'Questions worth asking about the topic, grouped by theme, each node one short question.'
}

const on = v => v === true || v === 'yes' // Make's form gives 'yes', storedSettings() gives true

// The system prompt for a whole map, from the settings { depth, breadth, style, links, lang }
export function buildSystem(settings) {
  const d = Number(settings.depth)
  const b = Number(settings.breadth)
  return [
    'You write mind maps as Markdown outlines and nothing else: no preamble, no closing remarks, no code fences.',
    'Format: the first line is "# <title>" (the root, at most 5 words). Then nested bullets, "- " with two spaces of indent per level.',
    `Shape: the root has ${Math.min(b, 7)} branches. Any node has at most ${b} children. Nest at most ${d} level${d > 1 ? 's' : ''} below the root. Keep the whole map under ${CAP[d]} nodes.`,
    'Node text: at most 6 words, concrete and specific, title-free fragments, no trailing punctuation, no bold or emphasis.',
    'Order: the most important first. Put real content in the map: names, numbers, terms, not headings like "Introduction".',
    STYLE[settings.style] || STYLE.overview,
    on(settings.links) ? 'When you are sure a URL exists, write a node as [text](https://…). Never invent URLs.' : 'No links.',
    `Language: ${settings.lang || 'English'}.`,
    'If the request names a URL, fetch it with web_fetch first and map what that page actually says: the root is the page title, the branches its main sections or claims. Do not pad with general knowledge.'
  ].join('\n')
}

const URLS = /https?:\/\/[^\s<>"')\]]+/g

// The user message for a query, and the web_fetch tool when it names URLs
export function buildRequest(q) {
  const urls = q.match(URLS) || []
  if (!urls.length) return { urls, content: `Mind map of: ${q}`, extra: {} }
  const rest = q.replace(URLS, '').trim()
  return {
    urls,
    content: `Mind map of the page${urls.length > 1 ? 's' : ''} at ${urls.join(' and ')}${rest ? ` (${rest})` : ''}. Fetch first, then map what it says.`,
    extra: { tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: Math.min(urls.length, 3) }] }
  }
}

// Keep the outline and drop any chatter around it ("I'll fetch the page first." and the like).
export function outlineOnly(text) {
  let at = text.search(/(^|\n)#\s/)
  if (at < 0) at = text.search(/#\s+\S/) // "I'll fetch the page first.# Title" on one line
  if (at >= 0) text = text.slice(at)
  return text.split('\n').filter(l => /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(l)).join('\n') + '\n'
}

// No heading came back: the bullets go under one root named after the request.
export const rooted = (roots, q) => (roots.length > 1 ? [{ name: q.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), kids: roots }] : roots)

// Give every node a stable id by its path, so a re-parse of the growing outline keeps ids.
export function adopt(roots, ids, path = '') {
  roots.forEach((n, i) => {
    const p = path + '/' + i
    n.id = ids.get(p) || (ids.set(p, path ? newId() : '#this'), ids.get(p))
    adopt(n.kids, ids, p)
  })
}

// What the centre node says while a build waits for its first idea: "Reading host/file…" for a
// link, "Building <topic>…" otherwise. Short enough for one node.
export function waitingLabel(q) {
  const url = (q.match(URLS) || [])[0]
  if (!url) return `Building ${q.length > 32 ? q.slice(0, 32).trimEnd() : q}…`
  let host = url
  let last = ''
  try {
    const u = new URL(url)
    host = u.hostname.replace(/^www\./, '')
    last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
  } catch {}
  const where = last ? `${host}/…/${last}` : host
  return `Reading ${where.length > 44 ? where.slice(0, 44) : where}…`
}

export const countNodes = n => 1 + n.kids.reduce((s, k) => s + countNodes(k), 0)

// Build a map for `q`. Yields { tree, usage } each time the outline gains a complete line, then
// once more with done: true. tree: { id, name, link?, kids: [tree] }; usage: { input, output }.
export async function* buildMap(q, { key, settings, signal, stream = claudeStream }) {
  const { content, extra } = buildRequest(q)
  const ids = new Map()
  const usage = {}
  let text = ''
  const chunks = stream({ key, model: settings.model, think: on(settings.think), system: buildSystem(settings), messages: [{ role: 'user', content }], signal, extra })
  for await (const chunk of chunks) {
    if (chunk.usage) { tally(chunk.usage, usage); continue }
    text += chunk.text
    const roots = rooted(parseOutline(outlineOnly(text.slice(0, text.lastIndexOf('\n') + 1))), q)
    if (!roots.length) continue
    adopt(roots, ids)
    yield { tree: roots[0], usage }
  }
  const roots = rooted(parseOutline(outlineOnly(text)), q)
  if (!roots.length) throw new Error('Claude sent no outline. Try again.')
  adopt(roots, ids)
  yield { tree: roots[0], usage, done: true }
}
