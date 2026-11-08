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
  assert.ok(link.includes('?uri=examples/welcome.json'), 'readable, not percent-encoded: ' + link)
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

// A pod on the LAN over plain http isn't a secure context: no clipboard API (#42).
const noClipboard = copies => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined })
  window.copied = []
  document.execCommand = cmd => {
    if (cmd !== 'copy' || !copies) return false
    window.copied.push(document.activeElement.value)
    return true
  }
}

test('without the clipboard API, Share still copies the link', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(noClipboard, true)
  await load(page, `${server.url}?example=welcome`)
  await shareFromMenu(page, 'shareReplay')
  const copied = await page.evaluate(() => window.copied)
  assert.equal(copied.length, 1)
  assert.ok(copied[0].includes('?uri=examples/welcome.json&replay=1s&autoplay'), copied[0])
  assert.match(await page.locator('#toast').textContent(), /Replay link copied/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('when nothing can copy, the link is shown whole and selected', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(noClipboard, false)
  await load(page, `${server.url}?example=welcome`)
  await shareFromMenu(page, 'share')
  const box = page.locator('.share-link')
  assert.ok((await box.inputValue()).includes('?uri=examples/welcome.json'))
  assert.equal(await page.evaluate(() => document.activeElement.className), 'share-link')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
