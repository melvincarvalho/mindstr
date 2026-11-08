// Share (#40): copy a link to the map, or to a replay that grows as it opens.
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

const open = async () => {
  const page = await openPage(browser, server.url, { permissions: ['clipboard-read', 'clipboard-write'] })
  return page
}
const shareFromMenu = async (page, action) => {
  await page.click('#menuBtn')
  await page.click(`[data-action="${action}"]`)
  await page.waitForTimeout(200)
}

test('Share link and Share replay copy links that open this map', async () => {
  const page = await open()
  await load(page, `${server.url}?example=welcome`)
  await shareFromMenu(page, 'share')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(new URL(link).searchParams.get('uri'), 'examples/welcome.json')
  assert.equal(new URL(link).searchParams.has('replay'), false)
  assert.match(await page.locator('#toast').textContent(), /Link copied/)

  await shareFromMenu(page, 'shareReplay')
  const replay = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(replay.endsWith('&replay=1s&autoplay'), replay)
  assert.match(await page.locator('#toast').textContent(), /Replay link copied/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('a map with no pod address says it needs saving first', async () => {
  const page = await open()
  await load(page, server.url)
  await page.keyboard.press('Escape')
  await shareFromMenu(page, 'share')
  assert.match(await page.locator('#toast').textContent(), /Save this map to a pod first/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
