// Optional node size (SPEC.md, #16): scaling, clamping, and keeping `size` through save and copy/paste.
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

// render.js imports colors.js, which needs a canvas, so these run in the page.
test('nodeScale: numbers clamp to 0.8–1.6; anything else is 1', async () => {
  const page = await openPage(browser, server.url)
  await page.goto(server.url + 'test/fixtures/blank.html')
  const got = await page.evaluate(async () => {
    const { nodeScale, SIZE_MIN, SIZE_MAX } = await import('/js/render.js')
    const sizes = [1.25, 1, 0.8, 1.6, 5, 0.5, '1.25', 'big', 0, -1, NaN, Infinity, null, undefined, true]
    return { min: SIZE_MIN, max: SIZE_MAX, scales: sizes.map(size => nodeScale({ size })), none: nodeScale({}), nothing: nodeScale(undefined) }
  })
  assert.equal(got.min, 0.8)
  assert.equal(got.max, 1.6)
  assert.deepEqual(got.scales, [1.25, 1, 0.8, 1.6, 1.6, 0.8, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  assert.equal(got.none, 1)
  assert.equal(got.nothing, 1)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('measure: size scales font, padding, height, corners and minimum width', async () => {
  const page = await openPage(browser, server.url)
  await page.goto(server.url + 'test/fixtures/blank.html')
  const r = await page.evaluate(async () => {
    const { makeMeasure, STYLES } = await import('/js/render.js')
    const measure = makeMeasure(document.createElement('canvas').getContext('2d'))
    const px = font => Number(font.match(/(\d+(?:\.\d+)?)px/)[1])
    const out = []
    for (const depth of [0, 1, 2, 5]) {
      const base = STYLES[Math.min(depth, 2)]
      const plain = measure({ name: 'Idea' }, depth)
      const big = measure({ name: 'Idea', size: 1.25 }, depth)
      out.push({
        depth,
        basePx: px(base.font),
        bigFont: big.font,
        bigPx: px(big.font),
        ratios: [big.padX / plain.padX, big.h / plain.h, big.r / plain.r],
        wider: big.w > plain.w,
        same: [measure({ name: 'Idea', size: 1 }, depth), measure({ name: 'Idea', size: '2' }, depth)].map(m => JSON.stringify(m) === JSON.stringify(plain))
      })
    }
    const minW = [undefined, 0.8, 1.6].map(size => measure({ name: 'A', size }, 2).w)
    return { out, minW }
  })
  for (const d of r.out) {
    assert.equal(d.bigPx, Math.round(d.basePx * 1.25), `depth ${d.depth}: font is scaled to whole pixels`)
    assert.match(d.bigFont, /\b\d+px\b/, `depth ${d.depth}: no fractional px in the font string`)
    for (const k of d.ratios) assert.ok(Math.abs(k - 1.25) < 1e-9, `depth ${d.depth}: padding, height and corners scale by 1.25`)
    assert.ok(d.wider, `depth ${d.depth}: the box is wider`)
    assert.deepEqual(d.same, [true, true], `depth ${d.depth}: size 1 and a string size measure like no size`)
  }
  assert.deepEqual(r.minW.map(w => Math.round(w * 10) / 10), [48, 38.4, 76.8], 'the minimum width scales too')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('the app draws a sized map and saves every size unchanged, invalid ones included', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?uri=test/fixtures/sized.jsonld`)
  const map = await downloadMap(page)
  const size = Object.fromEntries(map.nodes.map(n => [n.name, n.size]))
  assert.deepEqual(size, { Root: 1.3, Big: 1.4, Small: 0.8, 'Text size': '1.5', Plain: undefined })
  assert.equal(map.version, '0.2', 'size does not change the format version')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('copying and pasting a branch keeps its sizes', async () => {
  const page = await openPage(browser, server.url)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await load(page, `${server.url}?uri=test/fixtures/sized.jsonld`)
  const selected = async () => {
    const li = page.locator('#tree li[aria-selected="true"]')
    return (await li.count()) ? li.first().textContent() : ''
  }
  // select a node the way a user can by keyboard: Find selects the first match, Escape returns to the map
  const pick = async name => {
    await page.locator('#tree').focus()
    await page.keyboard.press('ControlOrMeta+f')
    await page.keyboard.type(name)
    await page.keyboard.press('Escape')
    assert.equal(await selected(), name, `"${name}" is selected`)
  }
  await pick('Big')
  await page.keyboard.press('ControlOrMeta+c')
  await pick('Plain')
  const items = page.locator('#tree li')
  const before = await items.count()
  await page.keyboard.press('ControlOrMeta+v')
  // the pasted branch (Big, Small, Text size) shows up in the tree once it's in the map
  await page.waitForFunction(n => document.querySelectorAll('#tree li').length === n, before + 3)
  const map = await downloadMap(page)
  const plain = map.nodes.find(n => n.name === 'Plain')
  const pasted = map.nodes.filter(n => n.parent === plain['@id'])
  assert.equal(pasted.length, 1, 'the branch was pasted under Plain')
  assert.equal(pasted[0].name, 'Big')
  assert.equal(pasted[0].size, 1.4)
  const kids = map.nodes.filter(n => n.parent === pasted[0]['@id'])
  assert.deepEqual(Object.fromEntries(kids.map(n => [n.name, n.size])), { Small: 0.8, 'Text size': '1.5' })
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
