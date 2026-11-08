// Auto-fit (#33, #36): the app keeps fitting the whole map until the viewer moves the view. A click
// (which is also how a viewer allows sound) doesn't count; a drag does. Seen through a resize, which
// re-fits only while auto-fit is on.
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

const rootX = page => page.evaluate(() => {
  const r = document.querySelector('#tree li').getBoundingClientRect()
  return Math.round(r.left + r.width / 2)
})

// Shrink the window and report how far the root moved on screen.
async function shiftOnResize(page) {
  const x = await rootX(page)
  await page.setViewportSize({ width: 900, height: 800 })
  await page.waitForTimeout(400)
  return Math.abs((await rootX(page)) - x)
}

test('a click on the map keeps auto-fit on', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?example=welcome`)
  await page.mouse.click(20, 760) // empty background, no movement
  await page.waitForTimeout(200)
  assert.ok((await shiftOnResize(page)) > 40, 'the map was re-fitted to the smaller window')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('dragging the map turns auto-fit off', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?example=welcome`)
  await page.mouse.move(20, 760)
  await page.mouse.down()
  await page.mouse.move(120, 700, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(await shiftOnResize(page), 0, 'the view stayed where the viewer put it')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
