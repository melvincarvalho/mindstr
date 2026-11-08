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

// Publishing (#56): a fake signer and four mocked relays; nothing leaves the test
test('Publish to Nostr asks first, signs, sends to the relays, and copies a working link', async () => {
  const page = await openPage(browser, server.url, { permissions: ['clipboard-read', 'clipboard-write'] })
  const PUB = 'c'.repeat(64)
  await page.addInitScript(pub => {
    window.nostr = {
      getPublicKey: async () => pub,
      signEvent: async e => ({ ...e, pubkey: pub, id: 'f'.repeat(64), sig: 'e'.repeat(128) })
    }
  }, PUB)
  const sent = []
  for (const relay of ['wss://relay.ditto.pub/', 'wss://nos.lol/', 'wss://relay.primal.net/', 'wss://relay.damus.io/']) {
    await page.routeWebSocket(relay, ws => ws.onMessage(raw => {
      const [type, e] = JSON.parse(raw)
      if (type !== 'EVENT') return
      sent.push({ relay, e })
      ws.send(JSON.stringify(['OK', e.id, true, '']))
    }))
  }
  await load(page, `${server.url}?example=welcome`)
  await page.click('#menuBtn')
  await page.click('[data-action="publishNostr"]')
  assert.match(await page.locator('#banner').textContent(), /Publish “Welcome to Mindstr” .* Anyone can read it/)
  assert.equal(sent.length, 0, 'nothing sent before confirming')
  await page.click('#banner >> text=Publish')
  await page.waitForFunction(() => /Published to 4 of 4 relays/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 })
  assert.equal(sent.length, 4)
  const e = sent[0].e
  assert.equal(e.kind, 30627)
  assert.deepEqual(e.tags.find(t => t[0] === 'd'), ['d', 'welcome-to-mindstr'])
  assert.equal(JSON.parse(e.content).nodes[0].name, 'Welcome to Mindstr')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const { decodeNaddr } = await import('../../js/nostr-map.js')
  const addr = decodeNaddr(new URL(link).searchParams.get('nostr'))
  assert.deepEqual([addr.kind, addr.pubkey, addr.d], [30627, PUB, 'welcome-to-mindstr'])
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('Publish to Nostr without a signer says to sign in, and sends nothing', async () => {
  const page = await openPage(browser, server.url)
  await load(page, `${server.url}?example=welcome`)
  await page.click('#menuBtn')
  await page.click('[data-action="publishNostr"]')
  assert.match(await page.locator('#toast').textContent(), /Sign in with Nostr first/)
  await page.context().close()
})
