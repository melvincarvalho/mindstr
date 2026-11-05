// Claude from the browser, with the visitor's own API key: shared by the maker (make/) and the
// editor. The key and settings live in this browser's localStorage under the maker's names, so
// a key added once on make/ works in the editor too.

import { parseOutline } from './outline.js'

export const API = 'https://api.anthropic.com/v1/messages'
export const KEY_STORE = 'mindstr.make.key'
export const SETTINGS_STORE = 'mindstr.make.settings'
export const DEFAULT_MODEL = 'claude-haiku-5-5'
export const DEFAULT_BREADTH = 5

// The saved key, or '' (no storage, private window, nothing saved yet).
export function storedKey() {
  try {
    return (localStorage.getItem(KEY_STORE) || '').trim()
  } catch {
    return ''
  }
}

// The maker's saved settings, with defaults for what the editor needs.
export function storedSettings() {
  let s = {}
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_STORE) || '{}') || {}
  } catch {}
  return {
    model: typeof s.model === 'string' && s.model ? s.model : DEFAULT_MODEL,
    breadth: Number(s.breadth) || DEFAULT_BREADTH,
    think: s.think === 'yes',
    lang: typeof s.lang === 'string' && s.lang.trim() ? s.lang.trim() : 'English',
    links: s.links === 'yes'
  }
}

// Thinking off is spelled differently per model (checked 4 Nov 2026): Haiku 5.5 takes
// "disabled", Sonnet 5.5 takes "between_tools", Opus 5.5 always thinks and is quickest with
// adaptive thinking at low effort. On: adaptive for all.
export function thinkingFor(model, on) {
  if (on) return { thinking: { type: 'adaptive' } }
  if (/haiku/.test(model)) return { thinking: { type: 'disabled' } }
  if (/sonnet/.test(model)) return { thinking: { type: 'between_tools' } }
  return { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
}

// Claude's streamed reply: yields { text } as it arrives and { usage } when reported.
export async function* stream({ key, model, think = false, system, messages, signal, extra = {}, maxTokens = 4096 }) {
  if (!key) throw new Error('No Claude API key.')
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
      model,
      max_tokens: maxTokens,
      stream: true,
      ...thinkingFor(model, think),
      system,
      messages,
      ...extra
    })
  })
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText
    try {
      msg = (await res.json()).error?.message || msg
    } catch {}
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
      try {
        ev = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield { text: ev.delta.text }
      else if (ev.type === 'message_start' && ev.message?.usage) yield { usage: ev.message.usage }
      else if (ev.type === 'message_delta' && ev.usage) yield { usage: ev.usage }
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error')
    }
  }
}

// The system prompt for growing a node from the editor (the maker uses its own, which also
// covers whole maps).
export function growSystem({ lang = 'English', links = false } = {}) {
  return [
    'You add ideas to mind maps. Reply with Markdown bullets and nothing else: no preamble, no closing remarks, no code fences.',
    'Node text: at most 6 words, concrete and specific, title-free fragments, no trailing punctuation, no bold or emphasis.',
    'Order: the most important first. Put real content in: names, numbers, terms, not headings.',
    links ? 'When you are sure a URL exists, write a node as [text](https://…). Never invent URLs.' : 'No links.',
    `Language: ${lang}.`
  ].join('\n')
}

// The request to grow one node: the whole map as context, the node's path, how many children,
// and the children it already has, which the new ones shouldn't repeat.
export function growMessage({ outline, name, path, count, existing = [] }) {
  const where = path.length > 1 ? ` (${path.join(' › ')})` : ''
  const more = existing.length ? ` It already has: ${existing.map(e => `“${e}”`).join(', ')}. Add new ones that don't repeat these.` : ''
  return `Here is a mind map:\n\n${outline}\nAdd ${count} children to the node “${name}”${where}.${more} Output only those children as top-level "- " bullets, with no heading and no nesting.`
}

// Claude's bullets back as { name, link? } children. A stray heading or nesting is flattened;
// chatter lines that aren't bullets are dropped.
export function grownKids(text) {
  const bullets = text
    .split('\n')
    .filter(l => /^\s*([-*+]|\d+[.)])\s+\S/.test(l))
    .join('\n')
  const flat = []
  const walk = trees => {
    for (const t of trees) {
      if (t.name) flat.push(t.link ? { name: t.name, link: t.link } : { name: t.name })
      walk(t.kids)
    }
  }
  walk(parseOutline(bullets))
  return flat
}

// "Open as a new map": the node as the topic, its ancestors as context.
export function topicFor(path) {
  return path.length > 1 ? `${path[path.length - 1]}, in ${path.slice(0, -1).join(' › ')}` : path[0] || ''
}
