// Mind maps on Nostr (#56): naddr decoding, the id check, and loading a map event from relays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeNaddr, fetchLatest, idMatches, loadMapEvent, signatureValid } from '../../js/nostr-map.js'

// a real kind 30627 event (the climate-change map, signed with a throwaway test key) and its naddr
const EVENT = JSON.parse(readFileSync(new URL('../fixtures/nostr-map-event.json', import.meta.url), 'utf8'))
const NADDR = 'naddr1qq8xxmrfd4shgefdvd5xzmn8v5q3wamn8ghj7vfexghrzd3c9cczuvfhxuarwdehxupzqwqfqnzwtu2jhvjaqede5fxdjfjanfwk8u2qdjyn2eudyvk2uq2tqvzqqqrh5vff7the'

test('decodeNaddr reads kind, author, slug and relay hints', () => {
  const a = decodeNaddr(NADDR)
  assert.equal(a.kind, 30627)
  assert.equal(a.pubkey, EVENT.pubkey)
  assert.equal(a.d, 'climate-change')
  assert.deepEqual(a.relays, ['ws://192.168.0.177:7777'])
  assert.deepEqual(decodeNaddr('nostr:' + NADDR.toUpperCase()), a, 'nostr: prefix and upper case are fine')
})

test('decodeNaddr rejects damaged or foreign links', () => {
  const broken = NADDR.slice(0, 20) + (NADDR[20] === 'q' ? 'p' : 'q') + NADDR.slice(21)
  assert.throws(() => decodeNaddr(broken), /checksum/)
  assert.throws(() => decodeNaddr('npub1xyz'), /not an naddr/)
  assert.throws(() => decodeNaddr(''), /not an naddr/)
})

test('idMatches catches an altered event', async () => {
  assert.equal(await idMatches(EVENT), true)
  assert.equal(await idMatches({ ...EVENT, content: EVENT.content.replace('Climate', 'Weather') }), false)
})

test('signatureValid: true or false from the checker, null when it cannot load', async () => {
  const fake = ok => async () => ({ schnorr: { verify: () => ok } })
  assert.equal(await signatureValid(EVENT, fake(true)), true)
  assert.equal(await signatureValid(EVENT, fake(false)), false)
  assert.equal(await signatureValid(EVENT, async () => { throw new Error('offline') }), null)
})

// A fake relay socket: answers a REQ with the given events, then EOSE
const relayWith = events => class {
  constructor (url) { this.url = url; setTimeout(() => this.onopen?.(), 0) }
  send (raw) {
    const [, sub] = JSON.parse(raw)
    for (const e of events) setTimeout(() => this.onmessage?.({ data: JSON.stringify(['EVENT', sub, e]) }), 0)
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(['EOSE', sub]) }), 1)
  }
  close () {}
}

test('fetchLatest keeps the newest answer', async () => {
  const older = { ...EVENT, created_at: EVENT.created_at - 100 }
  const got = await fetchLatest(['ws://a', 'ws://b'], {}, { WebSocketImpl: relayWith([older, EVENT]) })
  assert.equal(got.created_at, EVENT.created_at)
})

test('loadMapEvent returns the map, and refuses a tampered or missing one', async () => {
  const opts = { WebSocketImpl: relayWith([EVENT]), loadVerifier: async () => ({ schnorr: { verify: () => true } }) }
  const got = await loadMapEvent(NADDR, opts)
  assert.equal(got.title, 'Climate change')
  assert.equal(got.data.nodes.length, 27)
  assert.equal(got.signature, true)

  const tampered = { ...EVENT, content: EVENT.content.replace('Climate', 'Weather') }
  await assert.rejects(loadMapEvent(NADDR, { ...opts, WebSocketImpl: relayWith([tampered]) }), /altered/)
  await assert.rejects(loadMapEvent(NADDR, { ...opts, WebSocketImpl: relayWith([]) }), /no relay had this map/)
  await assert.rejects(loadMapEvent(NADDR, { ...opts, loadVerifier: async () => ({ schnorr: { verify: () => false } }) }), /bad signature/)
})
