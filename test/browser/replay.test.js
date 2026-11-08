// Replay (#38): ?replay= regrows a map from its root, one node at a time.
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

const count = page => page.locator('#replayCount').textContent()

test('?replay opens paused on the root, plays to the whole map, and can restart', async () => {
  const page = await openPage(browser, server.url)
  await page.goto(`${server.url}?example=welcome&replay=100ms`, { waitUntil: 'load' })
  await page.waitForFunction(() => !document.querySelector('#replay').hidden, null, { timeout: 10000 })
  const first = await count(page)
  const total = Number(first.split('/')[1])
  assert.equal(first, `1 / ${total}`)
  assert.ok(total > 3)
  assert.equal(await page.locator('#tree li').count(), 1, 'only the root at first')

  await page.click('[data-action="replayPlay"]')
  await page.waitForFunction(t => document.querySelector('#replayCount').textContent === `${t} / ${t}`, total, { timeout: total * 400 + 5000 })
  assert.equal(await page.locator('#tree li').count(), total, 'the whole map at the end')
  assert.equal(await page.getAttribute('[data-action="replayPlay"]', 'title'), 'Play again')

  await page.click('[data-action="replayRestart"]')
  await page.waitForTimeout(50)
  assert.ok(Number((await count(page)).split('/')[0]) < total, 'restarted from the root')
  await page.click('[data-action="replayEnd"]')
  assert.equal(await count(page), `${total} / ${total}`)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('&autoplay starts the replay without a click', async () => {
  const page = await openPage(browser, server.url)
  await page.goto(`${server.url}?example=welcome&replay=100ms&autoplay`, { waitUntil: 'load' })
  await page.waitForFunction(() => {
    const c = document.querySelector('#replayCount')?.textContent || ''
    return Number(c.split('/')[0]) >= 3
  }, null, { timeout: 10000 })
  assert.equal(await page.getAttribute('[data-action="replayPlay"]', 'title'), 'Pause')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('without ?replay there is no replay bar', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?example=welcome`)
  assert.equal(await page.locator('#replay').isHidden(), true)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
