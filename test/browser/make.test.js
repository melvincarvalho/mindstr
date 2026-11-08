// The maker (make/), with the Claude API mocked: a topic in, a map out.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { launch, openPage, serve } from './helpers.js'

let server
let browser
before(async () => {
  server = await serve()
  browser = await launch()
})
after(async () => {
  await browser?.close()
  await server?.close()
})

const OUTLINE = "I'll map that.\n# Coffee\n\n- Beans\n  - Arabica\n  - Robusta\n- Brewing\n  - Espresso\n  - Filter\n"
const sse = text =>
  [
    { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } },
    ...text.match(/[\s\S]{1,12}/g).map(t => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } },
    { type: 'message_stop' }
  ]
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')

test('make/?q= builds a map from Claude\'s streamed outline', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(() => localStorage.setItem('mindstr.make.key', 'sk-test'))
  const requests = []
  await page.route('https://api.anthropic.com/**', async route => {
    requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() })
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(OUTLINE) })
  })
  await page.goto(server.url + 'make/?q=coffee', { waitUntil: 'load' })
  const status = page.locator('#status')
  await page.waitForFunction(() => /\d+ nodes ·/.test(document.querySelector('#status')?.textContent || ''))
  assert.match(await status.textContent(), /^7 nodes ·/, 'root, 2 branches, 4 leaves; the chatter line is dropped')

  assert.equal(requests.length, 1)
  const { headers, body } = requests[0]
  assert.equal(headers['x-api-key'], 'sk-test')
  assert.equal(body.stream, true)
  assert.match(body.system, /You write mind maps as Markdown outlines/)
  assert.equal(body.messages[0].content, 'Mind map of: coffee')

  assert.equal(await page.locator('#actions').isVisible(), true, 'the copy and save actions appear')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

// Sounds (#47): pops as nodes appear and a chime when the build finishes. A fake AudioContext
// counts the notes; typing Enter in the topic box is the gesture that allows sound.
test('make pops as nodes appear and chimes when the build finishes', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(() => {
    localStorage.setItem('mindstr.make.key', 'sk-test')
    window.notes = []
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }
    window.AudioContext = class {
      state = 'running'
      destination = {}
      get currentTime() {
        return performance.now() / 1000
      }
      resume() {
        return Promise.resolve()
      }
      createGain() {
        return { gain: param, connect: d => d }
      }
      createOscillator() {
        const osc = { frequency: param, connect: d => d, start: () => window.notes.push(performance.now()), stop() {} }
        return osc
      }
    }
  })
  await page.route('https://api.anthropic.com/**', route =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(OUTLINE) })
  )
  await page.goto(server.url + 'make/', { waitUntil: 'load' })
  await page.fill('#q', 'coffee')
  await page.press('#q', 'Enter')
  await page.waitForFunction(() => /\d+ nodes ·/.test(document.querySelector('#status')?.textContent || ''))
  await page.waitForTimeout(300)
  const notes = await page.evaluate(() => window.notes.length)
  assert.ok(notes >= 3, `at least one pop plus the two-note chime, got ${notes}`)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
