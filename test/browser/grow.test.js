// Grow here with AI in the editor (#26), with the Claude API mocked.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { downloadMap, launch, load, openPage, serve } from './helpers.js'

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

// Claude's reply as a stream of server-sent events, with some chatter and a repeat of an
// existing child to be filtered out.
const REPLY = 'Sure, here you go:\n- Drag a branch to move it\n- Snap to grid\n- [Align guides](https://example.org/guides)\n- Keyboard nudging\n'
const sse = text =>
  [
    { type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 25) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(25) } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
    { type: 'message_stop' }
  ]
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')

async function setUp({ key }) {
  const page = await openPage(browser, server.url)
  if (key) await page.addInitScript(k => localStorage.setItem('mindstr.make.key', k), key)
  page.requests = []
  await page.route('https://api.anthropic.com/**', async route => {
    page.requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() })
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(REPLY) })
  })
  await load(page, `${server.url}?example=welcome`)
  return page
}

// The screen point of a node, from the screen-reader tree laid over the canvas.
async function pointOf(page, name) {
  const li = page.locator('#tree li', { hasText: new RegExp(`^${name}$`) })
  const b = await li.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test('right-click a node, Grow here: Claude\'s new ideas go in as one undoable edit', async () => {
  const page = await setUp({ key: 'sk-test' })
  const before = await downloadMap(page)
  const arrange = before.nodes.find(n => n.name === 'Arrange')
  const existing = before.nodes.filter(n => n.parent === arrange['@id']).map(n => n.name)
  assert.ok(existing.includes('Drag a branch to move it'), 'the fixture has the child Claude will repeat')

  await page.keyboard.press('Escape') // close the More menu left by downloadMap
  const p = await pointOf(page, 'Arrange')
  await page.mouse.click(p.x, p.y, { button: 'right' })
  const menu = page.locator('#nodeMenu')
  await menu.waitFor({ state: 'visible' })
  assert.equal(await page.locator('#nodeMenuLink').isHidden(), true, 'no link, no Open link')
  await menu.getByRole('menuitem', { name: 'Grow here with AI' }).click()
  await page.locator('#toast', { hasText: 'Added 3 ideas' }).waitFor()

  // the request: the key, the node, its path, and the children not to repeat
  assert.equal(page.requests.length, 1)
  const req = page.requests[0]
  assert.equal(req.headers['x-api-key'], 'sk-test')
  assert.equal(req.body.model, 'claude-haiku-5-5')
  const asked = req.body.messages[0].content
  assert.match(asked, /“Arrange” \(Welcome to Mindstr › Arrange\)/)
  assert.match(asked, /It already has: .*“Drag a branch to move it”/)
  assert.match(asked, /# Welcome to Mindstr/, 'the whole map is the context')

  const grown = await downloadMap(page)
  const kids = grown.nodes.filter(n => n.parent === arrange['@id'])
  assert.deepEqual(kids.map(n => n.name).filter(n => !existing.includes(n)), ['Snap to grid', 'Align guides', 'Keyboard nudging'])
  assert.equal(kids.find(n => n.name === 'Align guides').link, 'https://example.org/guides')
  assert.equal(kids.filter(n => n.name === 'Drag a branch to move it').length, 1, 'the repeat is dropped')

  await page.keyboard.press('Escape')
  await page.locator('#tree').focus()
  await page.keyboard.press('ControlOrMeta+z')
  const undone = await downloadMap(page)
  assert.equal(undone.nodes.length, before.nodes.length, 'one undo removes all of them')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('G grows the selected node from the keyboard', async () => {
  const page = await setUp({ key: 'sk-test' })
  const count = (await downloadMap(page)).nodes.length
  await page.keyboard.press('Escape')
  await page.locator('#tree').focus()
  await page.keyboard.press('ControlOrMeta+f')
  await page.keyboard.type('Links')
  await page.keyboard.press('Escape')
  await page.keyboard.press('g')
  await page.locator('#toast', { hasText: /Added \d+ ideas/ }).waitFor()
  assert.match(page.requests[0].body.messages[0].content, /“Links”/)
  assert.ok((await downloadMap(page)).nodes.length > count)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('without a key, the editor says where to add one and asks Claude nothing', async () => {
  const page = await setUp({ key: null })
  const count = (await downloadMap(page)).nodes.length
  await page.keyboard.press('Escape')
  await page.locator('#tree').focus()
  await page.keyboard.press('g')
  const toast = page.locator('#toast')
  await toast.waitFor({ state: 'visible' })
  assert.match(await toast.textContent(), /add your Claude API key on the Make page/)
  assert.equal(await toast.getByRole('button', { name: 'Open Make' }).count(), 1)
  assert.equal(page.requests.length, 0)
  assert.equal((await downloadMap(page)).nodes.length, count)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('Open as a new map opens make/ with the node and its path as the topic', async () => {
  const page = await setUp({ key: 'sk-test' })
  const p = await pointOf(page, 'Arrange')
  await page.mouse.click(p.x, p.y, { button: 'right' })
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('#nodeMenu').getByRole('menuitem', { name: 'Open as a new map' }).click()
  ])
  const u = new URL(popup.url())
  assert.equal(u.pathname, '/make/')
  assert.equal(u.searchParams.get('q'), 'Arrange, in Welcome to Mindstr')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
