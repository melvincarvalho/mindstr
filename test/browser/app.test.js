// Smoke tests: the app in headless Chromium, with outside requests blocked.
import { after, before, describe, test } from 'node:test'
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

describe('loading', () => {
  // Several loads each, light and dark: #19 shipped an error that showed up in about one load in three.
  for (const example of ['welcome', 'nostr', 'project-plan', 'solar-system']) {
    test(`example "${example}" loads with no page errors`, async () => {
      for (const colorScheme of ['light', 'dark', 'light', 'dark']) {
        const page = await openPage(browser, server.url, { colorScheme })
        await load(page, `${server.url}?example=${example}`)
        const items = await page.locator('#tree li').count()
        assert.ok(items > 1, 'the map is on screen')
        assert.deepEqual(page.errors, [])
        await page.context().close()
      }
    })
  }

  test('a blank start has a root node and no page errors', async () => {
    const page = await openPage(browser, server.url)
    await load(page, server.url)
    const map = await downloadMap(page)
    assert.equal(map.nodes[0]['@id'], '#this')
    assert.equal(map.version, '0.2')
    assert.deepEqual(page.errors, [])
    await page.context().close()
  })
})

describe('editing', () => {
  test('add a child, rename it, undo and redo', async () => {
    const page = await openPage(browser, server.url)
    await load(page, server.url)
    const start = (await downloadMap(page)).nodes.length

    await page.locator('#tree').focus()
    await page.keyboard.press('Tab') // new child of the selected root, opened for renaming
    await page.keyboard.type('Hello test')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    let map = await downloadMap(page)
    assert.equal(map.nodes.length, start + 1)
    const added = map.nodes.at(-1)
    assert.equal(added.name, 'Hello test')
    assert.equal(added.parent, '#this')

    await page.keyboard.press('Escape') // close the menu
    await page.locator('#tree').focus()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)
    map = await downloadMap(page)
    assert.ok(!map.nodes.some(n => n.name === 'Hello test'), 'undo removes it')

    await page.keyboard.press('Escape')
    await page.locator('#tree').focus()
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(200)
    map = await downloadMap(page)
    assert.ok(map.nodes.some(n => n.name === 'Hello test'), 'redo brings it back')
    assert.deepEqual(page.errors, [])
    await page.context().close()
  })
})

describe('saving', () => {
  test('Download JSON-LD keeps unknown fields and repairs the tree', async () => {
    const page = await openPage(browser, server.url)
    await load(page, `${server.url}?uri=test/fixtures/extras.jsonld`)
    const map = await downloadMap(page)
    assert.equal(map.version, '0.2')
    assert.equal(map.title, 'Kept at the top level')
    assert.equal(map['@context'].foaf, 'http://xmlns.com/foaf/0.1/')
    const byName = Object.fromEntries(map.nodes.map(n => [n.name, n]))
    assert.equal(byName.Root['@id'], '#this')
    assert.equal(byName.Child.mood, 'kept on the node')
    assert.equal(byName.Child.parent, '#this')
    assert.equal(byName.Grandchild.parent, byName.Child['@id'])
    assert.ok(map.connections.length === 2, 'connections rebuilt from parent links')
    assert.deepEqual(page.errors, [])
    await page.context().close()
  })
})

describe('colours', () => {
  // colors.js uses a canvas to read CSS colours, so it runs here rather than in Node.
  test('toRgb, contrast, readableText and tones', async () => {
    const page = await openPage(browser, server.url)
    await page.goto(server.url + 'test/fixtures/blank.html')
    const r = await page.evaluate(async () => {
      const c = await import('/js/colors.js')
      const hslOf = s => s.match(/hsl\((\d+) (\d+)% (\d+)%/).slice(1).map(Number)
      return {
        rgb: [c.toRgb('#ff8000'), c.toRgb('rebeccapurple'), c.toRgb('rgb(1, 2, 3)'), c.toRgb('not a colour')],
        contrastBW: c.contrast('#000', '#fff'),
        contrastSame: c.contrast('#abc', '#abc'),
        textOnDark: c.readableText('#202020'),
        textOnLight: c.readableText('#fafafa'),
        greyLight: hslOf(c.tones('#F2F2F2', false).fillLo),
        greyDark: hslOf(c.tones('#F2F2F2', true).fill),
        blue: c.tones('#D6E8FF', false),
        keys: Object.keys(c.tones('#D6E8FF', true)).sort()
      }
    })
    assert.deepEqual(r.rgb, [[255, 128, 0], [102, 51, 153], [1, 2, 3], [0, 0, 0]])
    assert.ok(Math.abs(r.contrastBW - 21) < 0.01, 'black on white is 21:1')
    assert.equal(r.contrastSame, 1)
    assert.equal(r.textOnDark, '#f4f5f8')
    assert.equal(r.textOnLight, '#1b1f27')
    assert.equal(r.greyLight[1], 0, 'a grey fill shades to grey, not pink (#19)')
    assert.equal(r.greyDark[1], 0)
    assert.equal(r.blue.fill, '#D6E8FF', 'light mode keeps the branch colour as the fill')
    assert.deepEqual(r.keys, ['border', 'edge', 'fill', 'fillHi', 'fillLo', 'glow', 'tint'])
    await page.context().close()
  })
})
