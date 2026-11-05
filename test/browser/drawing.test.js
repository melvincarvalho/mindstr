// Drawing while the view moves (#20): frames in motion leave out costly effects, and the app
// draws one full frame once the movement stops.
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

// Fraction of pixels that differ by more than a few levels, compared in the page.
async function differ(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async src => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + src
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const x = c.getContext('2d')
        x.drawImage(img, 0, 0)
        return x.getImageData(0, 0, c.width, c.height).data
      }
      const [p, q] = await Promise.all([pixels(a), pixels(b)])
      let n = 0
      for (let i = 0; i < p.length; i += 4)
        if (Math.abs(p[i] - q[i]) > 6 || Math.abs(p[i + 1] - q[i + 1]) > 6 || Math.abs(p[i + 2] - q[i + 2]) > 6) n++
      return n / (p.length / 4)
    },
    [a.toString('base64'), b.toString('base64')]
  )
}

for (const colorScheme of ['light', 'dark']) {
  test(`${colorScheme}: after scrolling away and back, the map is redrawn at full quality`, async () => {
    const page = await openPage(browser, server.url, { colorScheme })
    await load(page, `${server.url}?example=welcome`)
    await page.waitForTimeout(1200) // fonts, layout and the appear animation
    const canvas = page.locator('canvas').first()
    const still = await canvas.screenshot()

    await page.mouse.move(640, 400)
    for (let k = 0; k < 6; k++) await page.mouse.wheel(0, 40) // plain wheel pans
    for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -40) // and back to the same view
    const moving = await canvas.screenshot() // within the settle time: the light frame
    await page.waitForTimeout(500)
    const settled = await canvas.screenshot()

    assert.ok((await differ(page, still, moving)) > 0.002, 'frames in motion leave effects out')
    assert.ok((await differ(page, still, settled)) < 0.001, 'the full frame is back once it settles')
    assert.deepEqual(page.errors, [])
    await page.context().close()
  })
}

test('the app goes idle after tidying a map with a folded branch', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(() => {
    window.__frames = 0
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = cb => raf(ts => (window.__frames++, cb(ts)))
  })
  await load(page, `${server.url}?example=welcome`)
  await page.locator('#tree').focus()
  await page.keyboard.press('ControlOrMeta+f')
  await page.keyboard.type('Arrange')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Space') // fold "Arrange"
  await page.keyboard.press('l') // tidy: moves nodes, including the ones now hidden
  await page.waitForTimeout(1500)
  const before = await page.evaluate(() => window.__frames)
  await page.waitForTimeout(600)
  const frames = (await page.evaluate(() => window.__frames)) - before
  assert.equal(frames, 0, 'no frames are drawn while nothing changes')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
