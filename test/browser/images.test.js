// Images on nodes (SPEC.md, #31): the space they take, drawing, failures, PNG export, copy and paste.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { downloadMap, launch, load, openPage, serve } from './helpers.js'

let server
let browser
let other // a second origin, serving images with and without CORS headers
let OTHER
before(async () => {
  server = await serve()
  browser = await launch()
  other = createServer((req, res) => {
    const cors = req.url === '/cors.png' ? { 'access-control-allow-origin': '*' } : {}
    res.writeHead(200, { 'content-type': 'image/png', ...cors }).end(RED)
  })
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve))
  OTHER = `http://127.0.0.1:${other.address().port}/`
})
after(async () => {
  await browser?.close()
  await server?.close()
  await new Promise(resolve => other?.close(resolve))
})

// A solid red 1x1 PNG, for the images the tests serve.
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

// Open a map with one image node, and let the page reach the second origin.
async function openMap(image) {
  const page = await openPage(browser, server.url)
  const map = {
    version: '0.2',
    nodes: [
      { '@id': '#this', name: 'Root', x: 0, y: 0 },
      { '@id': '#k3x9q2', name: 'Picture', x: 300, y: 0, parent: '#this', image }
    ],
    connections: [{ start: 0, end: 1 }]
  }
  await page.route('**/map.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(map) }))
  await page.route('**/good.png', r => r.fulfill({ contentType: 'image/png', body: RED }))
  await page.route(OTHER + '**', r => r.continue())
  await load(page, server.url + '?uri=map.json')
  return page
}

// How much of the canvas is close to pure red, the colour of the test images.
const redPixels = page =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] < 40 && data[i + 2] < 40) n++
    return n
  })

async function exportPng(page) {
  await page.click('#menuBtn')
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="png"]')])
  const chunks = []
  for await (const c of await file.createReadStream()) chunks.push(c)
  return Buffer.concat(chunks)
}

const redInPng = (page, png) =>
  page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0)
    const { data } = x.getImageData(0, 0, c.width, c.height)
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] < 40 && data[i + 2] < 40) n++
    return n
  }, png.toString('base64'))

test('measure: an image makes the box taller and wide enough, and moves the text down', async () => {
  const page = await openPage(browser, server.url)
  await page.goto(server.url + 'test/fixtures/blank.html')
  const r = await page.evaluate(async () => {
    const { makeMeasure, IMAGE_W, IMAGE_H } = await import('/js/render.js')
    const ctx = document.createElement('canvas').getContext('2d')
    const measure = makeMeasure(ctx)
    const hide = makeMeasure(ctx, { shows: () => false })
    const name = 'A very long node name that is wider than any image would be'
    return {
      IMAGE_W,
      IMAGE_H,
      plain: measure({ name: 'Hi' }, 2),
      pic: measure({ name: 'Hi', image: 'a.png' }, 2),
      big: measure({ name: 'Hi', image: 'a.png', size: 1.5 }, 2),
      blank: measure({ name: 'Hi', image: '  ' }, 2),
      wrongType: measure({ name: 'Hi', image: 5 }, 2),
      hidden: hide({ name: 'Hi', image: 'a.png' }, 2),
      longPlain: measure({ name }, 2),
      long: measure({ name, image: 'a.png' }, 2)
    }
  })
  assert.equal(r.plain.pic, null)
  assert.equal(r.plain.ty, 0)
  assert.equal(r.plain.tx, r.plain.padX)
  assert.ok(r.pic.h > r.plain.h + r.IMAGE_H - 1, 'taller by at least the image')
  assert.ok(r.pic.w >= r.IMAGE_W, 'at least as wide as the image')
  assert.equal(r.pic.ty, (r.pic.h - r.plain.h) / 2, 'text sits in the same height of strip, at the bottom')
  assert.equal(r.big.pic.w, r.IMAGE_W * 1.5, 'the image scales with the node')
  for (const m of [r.blank, r.wrongType, r.hidden]) assert.equal(m.h, r.plain.h)
  assert.equal(r.long.w, r.longPlain.w, 'a long name keeps its width')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('a same-site image is drawn on the node, and saved with the map', async () => {
  const page = await openMap('good.png')
  await page.waitForTimeout(200)
  assert.ok((await redPixels(page)) > 500, 'the image is on the canvas')
  const map = await downloadMap(page)
  assert.equal(map.nodes[1].image, 'good.png')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('an image that fails leaves the node with its text, at plain size', async () => {
  const page = await openPage(browser, server.url)
  const map = (name, image) => ({
    version: '0.2',
    nodes: [
      { '@id': '#this', name: 'Root', x: 0, y: 0 },
      { '@id': '#k3x9q2', name, x: 300, y: 0, parent: '#this', ...(image ? { image } : {}) }
    ],
    connections: [{ start: 0, end: 1 }]
  })
  const shot = async doc => {
    await page.route('**/map.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(doc) }))
    await load(page, server.url + '?uri=map.json')
    await page.waitForTimeout(300)
    // the first fit happens while the image's space is still reserved, so fit again
    await page.locator('#tree').focus()
    await page.keyboard.press('0')
    await page.waitForTimeout(600)
    const png = await page.locator('canvas').screenshot()
    await page.unroute('**/map.json')
    return png.toString('base64')
  }
  const missing = await shot(map('Picture', 'https://images.example/missing.png'))
  const plain = await shot(map('Picture'))
  assert.equal(missing, plain, 'draws exactly as if it had no image')
  const map2 = await downloadMap(page)
  assert.equal(map2.nodes[1].image, undefined)
  await page.context().close()
})

test('PNG export includes an image with CORS', async () => {
  const page = await openMap(OTHER + 'cors.png')
  await page.waitForTimeout(200)
  assert.ok((await redPixels(page)) > 500, 'on screen')
  const png = await exportPng(page)
  assert.ok((await redInPng(page, png)) > 500, 'in the PNG')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('an image without CORS shows on screen, and PNG export leaves it out instead of failing', async () => {
  const page = await openMap(OTHER + 'plain.png')
  await page.waitForTimeout(200)
  // this image taints the canvas, so its pixels can't be read back: look at a screenshot
  assert.ok((await redInPng(page, await page.locator('canvas').screenshot())) > 500, 'on screen')
  const png = await exportPng(page)
  assert.ok(png.length > 100, 'the export still works')
  assert.equal(await redInPng(page, png), 0, 'not in the PNG')
  assert.match(await page.locator('#toast').innerText(), /without 1 node image/)
  // the browser logs the refused CORS attempt; that's expected, and anything else isn't
  assert.deepEqual(page.errors.filter(e => !e.includes('CORS policy')), [])
  await page.context().close()
})

test('copying and pasting a branch keeps its image', async () => {
  const page = await openMap('good.png')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const pick = async name => {
    await page.locator('#tree').focus()
    await page.keyboard.press('ControlOrMeta+f')
    await page.keyboard.type(name)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#tree li[aria-selected="true"]').first().textContent(), name)
  }
  await pick('Picture')
  await page.keyboard.press('ControlOrMeta+c')
  await pick('Root')
  await page.keyboard.press('ControlOrMeta+v')
  await page.waitForFunction(() => document.querySelectorAll('#tree li').length === 3, null, { timeout: 5000 })
  const map = await downloadMap(page)
  const copies = map.nodes.filter(n => n.name === 'Picture')
  assert.equal(copies.length, 2)
  for (const n of copies) assert.equal(n.image, 'good.png')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
