// Ready-made maps (#45): the front door and Make look in the cache before asking Claude.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const CACHE = 'https://melvincarvalho.github.io/mindstr-maps/'
const MAP = readFileSync(new URL('../../examples/solar-system.json', import.meta.url), 'utf8')
// a fake mindstr-maps: "the solar system" and "planets" are cached
async function mockCache(page) {
  const seen = []
  await page.route(CACHE + '**', route => {
    const url = route.request().url()
    seen.push(url)
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    if (url.endsWith('/index.json')) return route.fulfill({ headers: cors, body: JSON.stringify({ version: 1, lookup: { 'the-solar-system': 'maps/the-solar-system.json', planets: 'maps/the-solar-system.json' } }) })
    if (url.endsWith('/maps/the-solar-system.json')) return route.fulfill({ headers: cors, body: MAP })
    return route.fulfill({ status: 404, headers: cors, body: 'no' })
  })
  return seen
}

test('front door: a cached topic opens as a replay, with where it came from', async () => {
  const page = await openPage(browser, server.url)
  await mockCache(page)
  await load(page, server.url)
  await page.fill('#frontQ', 'Planets')
  await Promise.all([page.waitForURL(/replay=1s/), page.press('#frontQ', 'Enter')])
  assert.equal(new URL(page.url()).searchParams.get('uri'), CACHE + 'maps/the-solar-system.json')
  await page.waitForSelector('#watch:not([hidden])')
  assert.match(await page.locator('#toast').textContent(), /Ready-made map from melvincarvalho\.github\.io\/mindstr-maps/)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('front door: a topic not in the cache is built here with Claude (no key yet: it asks for one)', async () => {
  const page = await openPage(browser, server.url)
  const seen = await mockCache(page)
  await load(page, server.url)
  await page.fill('#frontQ', 'knitting')
  await page.press('#frontQ', 'Enter')
  await page.waitForSelector('#frontKeyRow:not([hidden])')
  assert.ok(seen.length > 0, 'the cache was asked first')
  assert.equal(new URL(page.url()).search, '', 'still on the front door')
  await page.context().close()
})

test('make/: a cached topic needs no Claude key', async () => {
  const page = await openPage(browser, server.url)
  await mockCache(page)
  await Promise.all([page.waitForURL(/replay=1s/), page.goto(server.url + 'make/?q=the%20solar%20system')])
  assert.equal(new URL(page.url()).searchParams.get('uri'), CACHE + 'maps/the-solar-system.json')
  await page.context().close()
})

test('?cache=off never looks, and ?cache= can name another cache', async () => {
  const page = await openPage(browser, server.url)
  const seen = await mockCache(page)
  await page.goto(server.url + 'make/?q=planets&cache=off', { waitUntil: 'load' })
  await page.waitForTimeout(300)
  assert.equal(seen.length, 0, 'no cache asked')
  assert.equal(await page.locator('#settings').isVisible(), true, 'so it asks for a key')

  const other = 'https://maps.example.org/'
  const asked = []
  await page.route(other + '**', route => (asked.push(route.request().url()), route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' })))
  await page.goto(server.url + 'make/?q=planets&cache=' + encodeURIComponent(other), { waitUntil: 'load' })
  await page.waitForTimeout(300)
  assert.deepEqual(asked, [other + 'lookup.json', other + 'index.json'], 'the small lookup first, then the full index')
  assert.equal(seen.length, 0, 'ours not asked')
  await page.context().close()
})
