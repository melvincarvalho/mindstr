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

test('Create sends the topic to make/', async () => {
  const page = await openPage(browser, server.url)
  await load(page, server.url)
  await page.fill('#frontQ', 'coffee beans')
  await Promise.all([page.waitForURL(/make\//), page.press('#frontQ', 'Enter')])
  assert.equal(new URL(page.url()).searchParams.get('q'), 'coffee beans')
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

test('?cache= alone still shows the front door, and Create passes it on', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?cache=off`)
  assert.equal(await page.locator('#front').isVisible(), true)
  await page.fill('#frontQ', 'coffee')
  await Promise.all([page.waitForURL(/make\//), page.press('#frontQ', 'Enter')])
  const u = new URL(page.url())
  assert.equal(u.searchParams.get('q'), 'coffee')
  assert.equal(u.searchParams.get('cache'), 'off')
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
