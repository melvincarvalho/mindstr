// The front door (#49): a bare visit starts with a search box; links that name a map skip it.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { launch, load, openPage, serve } from './helpers.js'

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

test('a bare visit shows the search box, focused, with My map and Start blank', async () => {
  const page = await openPage(browser, server.url)
  await load(page, server.url)
  assert.equal(await page.locator('#front').isVisible(), true)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'frontQ')
  assert.equal(await page.locator('#frontContinue').isHidden(), true, 'no draft yet, so nothing to continue')
  assert.equal(new URL(page.url()).search, '', 'the address stays bare')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

// Create builds in the app (#49), with the Claude API mocked
const OUTLINE = '# Coffee\n\n- Beans\n  - Arabica\n  - Robusta\n- Brewing\n  - Espresso\n  - Filter\n'
const sse = text =>
  [
    { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } },
    ...text.match(/[\s\S]{1,12}/g).map(t => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } },
    { type: 'message_stop' }
  ]
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')
const mockClaude = async page => {
  const requests = []
  await page.route('https://api.anthropic.com/**', route => {
    requests.push(route.request())
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(OUTLINE) })
  })
  return requests
}
const island = page => page.evaluate(() => JSON.parse(document.querySelector('#initialData').textContent))

test('Create without a key asks for one, then builds the map here, as an editable draft', async () => {
  const page = await openPage(browser, server.url)
  const requests = await mockClaude(page)
  await load(page, `${server.url}?cache=off`)
  await page.fill('#frontQ', 'coffee')
  await page.press('#frontQ', 'Enter')
  assert.equal(await page.locator('#frontKeyRow').isVisible(), true, 'asks for a key')
  assert.equal(requests.length, 0)
  await page.fill('#frontKey', 'sk-test')
  await Promise.all([page.waitForURL(/build=coffee/), page.press('#frontKey', 'Enter')])
  await page.waitForFunction(() => /7 ideas/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 })
  const map = await island(page)
  assert.deepEqual(map.nodes.map(n => n.name), ['Coffee', 'Beans', 'Arabica', 'Robusta', 'Brewing', 'Espresso', 'Filter'])
  assert.equal(map.connections.length, 6)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].headers()['x-api-key'], 'sk-test')
  assert.equal(JSON.parse(requests[0].postData()).messages[0].content, 'Mind map of: coffee')
  const u = new URL(page.url())
  assert.equal(u.searchParams.get('build'), null, 'the build is done: a reload opens the draft')
  assert.ok(u.searchParams.get('draft'))
  assert.equal(await page.evaluate(() => localStorage.getItem('mindstr.make.key')), 'sk-test', 'the key is kept for next time')
  assert.equal(await page.locator('#menuBtn').isVisible(), true, 'the whole app: menu, share, publish, save')
  await page.reload()
  await page.waitForTimeout(500)
  assert.equal((await island(page)).nodes.length, 7, 'the draft was saved')
  assert.equal(requests.length, 1, 'and not built again')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('with a saved key, Create goes straight to building', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(() => localStorage.setItem('mindstr.make.key', 'sk-test'))
  const requests = await mockClaude(page)
  await load(page, `${server.url}?cache=off`)
  await page.fill('#frontQ', 'coffee')
  await Promise.all([page.waitForURL(/build=coffee/), page.press('#frontQ', 'Enter')])
  await page.waitForFunction(() => /7 ideas/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 })
  assert.equal(requests.length, 1)
  assert.equal(await page.locator('#frontKeyRow').isHidden(), true)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('Start blank opens the editor on an empty map', async () => {
  const page = await openPage(browser, server.url)
  await load(page, server.url)
  await page.click('#frontBlank')
  await page.waitForTimeout(300)
  assert.equal(await page.locator('#front').isHidden(), true)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('with a draft, Continue returns to it', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?draft=front-test`)
  await page.locator('#tree').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Remember me')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await load(page, server.url)
  const resume = page.locator('#frontContinue')
  assert.equal(await resume.isVisible(), true)
  await resume.click()
  assert.equal(await page.locator('#front').isHidden(), true)
  assert.match(page.url(), /draft=front-test/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('a link that names a map skips the front door', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?example=welcome`)
  assert.equal(await page.locator('#front').isHidden(), true)
  await page.context().close()
})

test('the example pills open a replay with the Watch it grow button', async () => {
  const page = await openPage(browser, server.url)
  await load(page, server.url)
  const pills = page.locator('.front-examples a')
  assert.equal(await pills.count(), 3)
  await Promise.all([page.waitForURL(/example=japan-trip/), pills.nth(2).click()])
  await page.waitForSelector('#watch:not([hidden])')
  assert.equal(await page.locator('#front').isHidden(), true)
  assert.match(await page.locator('#replayCount').textContent(), /^1 \/ 27$/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('?cache= alone still shows the front door', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?cache=off`)
  assert.equal(await page.locator('#front').isVisible(), true)
  await page.context().close()
})

test('the front door links to the directory of ready-made maps, but not with ?cache=off', async () => {
  const page = await openPage(browser, server.url)
  await load(page, server.url)
  const browse = page.locator('#frontBrowse')
  assert.equal(await browse.isVisible(), true)
  assert.ok((await browse.getAttribute('href')).startsWith('https://melvincarvalho.github.io/mindstr-maps/?app='))
  await load(page, `${server.url}?cache=off`)
  assert.equal(await page.locator('#frontBrowse').isHidden(), true)
  await page.context().close()
})
