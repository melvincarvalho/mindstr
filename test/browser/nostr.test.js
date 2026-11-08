// Opening a mind map from a Nostr event (#56): ?nostr=naddr1… against a mocked relay.
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

const EVENT = JSON.parse(readFileSync(new URL('../fixtures/nostr-map-event.json', import.meta.url), 'utf8'))
const NADDR = 'naddr1qq8xxmrfd4shgefdvd5xzmn8v5q3wamn8ghj7vfexghrzd3c9cczuvfhxuarwdehxupzqwqfqnzwtu2jhvjaqede5fxdjfjanfwk8u2qdjyn2eudyvk2uq2tqvzqqqrh5vff7the' // its relay hint is ws://192.168.0.177:7777

async function mockRelay(page, events) {
  await page.routeWebSocket('ws://192.168.0.177:7777/', ws => {
    ws.onMessage(raw => {
      const [type, sub] = JSON.parse(raw)
      if (type !== 'REQ') return
      for (const e of events) ws.send(JSON.stringify(['EVENT', sub, e]))
      ws.send(JSON.stringify(['EOSE', sub]))
    })
  })
}

test('?nostr= opens the map from the relay, read-only, and says where it came from', async () => {
  const page = await openPage(browser, server.url)
  await mockRelay(page, [EVENT])
  await load(page, `${server.url}?nostr=${NADDR}`)
  assert.equal(await page.locator('#tree li').count(), 27)
  assert.match(await page.locator('#tree li').first().textContent(), /Climate change/)
  assert.match(await page.locator('#toast').textContent(), /From Nostr, by/)
  assert.equal(await page.locator('#status').textContent(), 'From Nostr')
  assert.equal(await page.locator('#front').isHidden(), true)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('?nostr= with &replay grows the event map from its root', async () => {
  const page = await openPage(browser, server.url)
  await mockRelay(page, [EVENT])
  await page.goto(`${server.url}?nostr=${NADDR}&replay=100ms`, { waitUntil: 'load' })
  await page.waitForSelector('#watch:not([hidden])')
  assert.equal(await page.locator('#replayCount').textContent(), '1 / 27')
  await page.context().close()
})

test('a tampered event is refused with a clear message', async () => {
  const page = await openPage(browser, server.url)
  await mockRelay(page, [{ ...EVENT, content: EVENT.content.replace('Climate', 'Weather') }])
  await page.goto(`${server.url}?nostr=${NADDR}`, { waitUntil: 'load' })
  await page.waitForFunction(() => /Couldn’t open this Nostr map/.test(document.body.textContent), null, { timeout: 10000 })
  assert.match(await page.textContent('body'), /altered/)
  await page.context().close()
})

test('without crypto.subtle (a pod on plain http), the map still opens', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined }))
  await mockRelay(page, [EVENT])
  await load(page, `${server.url}?nostr=${NADDR}`)
  assert.equal(await page.locator('#tree li').count(), 27)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
