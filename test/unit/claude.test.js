// Claude from the browser (js/claude.js): settings, prompts, reading replies, streaming.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  API, DEFAULT_BREADTH, DEFAULT_MODEL, growMessage, growSystem, grownKids, KEY_STORE, SETTINGS_STORE,
  storedKey, storedSettings, stream, thinkingFor, topicFor
} from '../../js/claude.js'

const realFetch = globalThis.fetch
afterEach(() => {
  delete globalThis.localStorage
  globalThis.fetch = realFetch
})
const fakeStorage = data => ({ getItem: k => (k in data ? data[k] : null) })

test('storedKey and storedSettings: defaults without storage', () => {
  assert.equal(storedKey(), '')
  assert.deepEqual(storedSettings(), { model: DEFAULT_MODEL, breadth: DEFAULT_BREADTH, think: false, lang: 'English', links: false, depth: 2, style: 'overview' })
})

test('storedKey and storedSettings: read what make/ saved', () => {
  globalThis.localStorage = fakeStorage({
    [KEY_STORE]: '  sk-test  ',
    [SETTINGS_STORE]: JSON.stringify({ model: 'claude-opus-5-5', breadth: '7', think: 'yes', lang: 'French', links: 'yes', style: 'plan', depth: '3' })
  })
  assert.equal(storedKey(), 'sk-test')
  assert.deepEqual(storedSettings(), { model: 'claude-opus-5-5', breadth: 7, think: true, lang: 'French', links: true, depth: 3, style: 'plan' })
})

test('storedSettings: bad JSON falls back to defaults', () => {
  globalThis.localStorage = fakeStorage({ [SETTINGS_STORE]: '{nope' })
  assert.equal(storedSettings().model, DEFAULT_MODEL)
})

test('thinkingFor: off is spelled per model; on is adaptive', () => {
  assert.deepEqual(thinkingFor('claude-haiku-5-5', false), { thinking: { type: 'disabled' } })
  assert.deepEqual(thinkingFor('claude-sonnet-5-5', false), { thinking: { type: 'between_tools' } })
  assert.deepEqual(thinkingFor('claude-opus-5-5', false), { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } })
  assert.deepEqual(thinkingFor('claude-haiku-5-5', true), { thinking: { type: 'adaptive' } })
})

test('growMessage: the map, the node and its path, the count, and children not to repeat', () => {
  const m = growMessage({ outline: '# Trip\n\n- Travel\n', name: 'Travel', path: ['Trip', 'Travel'], count: 5, existing: ['Train'] })
  assert.match(m, /# Trip\n\n- Travel\n/)
  assert.match(m, /Add 5 children to the node “Travel” \(Trip › Travel\)\./)
  assert.match(m, /It already has: “Train”\. Add new ones that don't repeat these\./)
  assert.doesNotMatch(growMessage({ outline: '# R\n', name: 'R', path: ['R'], count: 3 }), /already has|\(R\)/)
})

test('growSystem: language and links follow the settings', () => {
  const fr = growSystem({ lang: 'French', links: true })
  assert.match(fr, /Language: French\./)
  assert.match(fr, /When you are sure a URL exists/)
  assert.doesNotMatch(fr, /No links\./)
  assert.match(growSystem(), /No links\./)
  assert.match(growSystem(), /Language: English\./)
})

test('grownKids: bullets in, chatter and headings out, nesting flattened, links kept', () => {
  const text = [
    "Here are some ideas:",
    '# Travel',
    '- Night train',
    '- [Ferry times](https://example.org/ferry)',
    '  - Book early',
    '1. Bike hire',
    'Hope that helps!'
  ].join('\n')
  assert.deepEqual(grownKids(text), [
    { name: 'Night train' },
    { name: 'Ferry times', link: 'https://example.org/ferry' },
    { name: 'Book early' },
    { name: 'Bike hire' }
  ])
  assert.deepEqual(grownKids('Sorry, I can’t help with that.'), [])
})

test('topicFor: the node, in its path', () => {
  assert.equal(topicFor(['Trip', 'Travel', 'Train']), 'Train, in Trip › Travel')
  assert.equal(topicFor(['Trip']), 'Trip')
  assert.equal(topicFor([]), '')
})

// A streamed Messages API response, as server-sent events split across chunks.
function sse(events, splitAt = 7) {
  const body = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const chunks = []
  for (let i = 0; i < body.length; i += splitAt) chunks.push(body.slice(i, i + splitAt))
  return new Response(
    new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(new TextEncoder().encode(s))
        c.close()
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

test('stream: sends the request and yields text and usage as they arrive', async () => {
  let sent
  globalThis.fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) }
    return sse([
      { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '- Night ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'train\n' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' }
    ])
  }
  const got = []
  for await (const c of stream({ key: 'sk-test', model: 'claude-haiku-5-5', system: 'S', messages: [{ role: 'user', content: 'Q' }] })) got.push(c)
  assert.equal(sent.url, API)
  assert.equal(sent.init.headers['x-api-key'], 'sk-test')
  assert.equal(sent.init.headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(sent.body.model, 'claude-haiku-5-5')
  assert.equal(sent.body.stream, true)
  assert.equal(sent.body.system, 'S')
  assert.deepEqual(sent.body.thinking, { type: 'disabled' })
  assert.deepEqual(got, [
    { usage: { input_tokens: 12, output_tokens: 1 } },
    { text: '- Night ' },
    { text: 'train\n' },
    { usage: { output_tokens: 5 } }
  ])
})

test('stream: an API error becomes an Error with its message', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401, statusText: 'Unauthorized' })
  await assert.rejects(async () => {
    for await (const _ of stream({ key: 'bad', model: 'm', system: '', messages: [] })) void _
  }, /invalid x-api-key/)
})

test('stream: an error event mid-stream throws', async () => {
  globalThis.fetch = async () => sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }])
  await assert.rejects(async () => {
    for await (const _ of stream({ key: 'k', model: 'm', system: '', messages: [] })) void _
  }, /Overloaded/)
})

test('stream: no key, no request', async () => {
  let called = false
  globalThis.fetch = async () => ((called = true), new Response(''))
  await assert.rejects(async () => {
    for await (const _ of stream({ key: '', model: 'm', system: '', messages: [] })) void _
  }, /No Claude API key/)
  assert.equal(called, false)
})
