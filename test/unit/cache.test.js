// Ready-made maps (#45): slugs, the ?cache= rule, and the lookup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CACHE, cacheName, cachesFrom, directoryUrl, findCached, openUrl, slug } from '../../js/cache.js'

test('slug matches mindstr-maps: lower case, no accents, hyphens', () => {
  assert.equal(slug('Plan a Trip to Japan!'), 'plan-a-trip-to-japan')
  assert.equal(slug('  Café   Culture '), 'cafe-culture')
  assert.equal(slug('World War II'), 'world-war-ii')
  assert.equal(slug('???'), '')
})

test('cachesFrom: ours by default, a list in order, off for none, only http(s)', () => {
  assert.deepEqual(cachesFrom(null), [DEFAULT_CACHE])
  assert.deepEqual(cachesFrom('off'), [])
  assert.deepEqual(cachesFrom(''), [])
  assert.deepEqual(cachesFrom('https://a.org/maps, https://b.org/x/'), ['https://a.org/maps/', 'https://b.org/x/'])
  assert.deepEqual(cachesFrom('javascript:alert(1),https://ok.org'), ['https://ok.org/'])
})

const fake = sites => async url => {
  const body = sites[url]
  if (body === 'down') throw new Error('offline')
  return body === undefined ? { ok: false } : { ok: true, json: async () => body }
}

test('findCached takes the first cache that has the topic, skipping ones that are down', async () => {
  const caches = ['https://a.org/', 'https://b.org/', 'https://c.org/']
  const fetchFn = fake({
    'https://a.org/index.json': 'down',
    'https://b.org/index.json': { lookup: { 'global-warming': 'maps/climate-change.json' } },
    'https://c.org/index.json': { lookup: { 'global-warming': 'maps/other.json' } }
  })
  assert.deepEqual(await findCached('Global warming', caches, { fetchFn }), { url: 'https://b.org/maps/climate-change.json', source: 'https://b.org/' })
  assert.equal(await findCached('Knitting', caches, { fetchFn }), null)
  assert.equal(await findCached('!!!', caches, { fetchFn }), null)
})

test('openUrl opens the map as a replay and keeps the cache choice', () => {
  const hit = { url: 'https://b.org/maps/x.json', source: 'https://b.org/' }
  assert.equal(openUrl('https://mindstr.org/', hit, null), 'https://mindstr.org/?uri=https://b.org/maps/x.json&replay=1s')
  assert.equal(openUrl('https://mindstr.org/', hit, 'https://b.org/'), 'https://mindstr.org/?uri=https://b.org/maps/x.json&replay=1s&cache=https%3A%2F%2Fb.org%2F')
  assert.equal(cacheName('https://melvincarvalho.github.io/mindstr-maps/'), 'melvincarvalho.github.io/mindstr-maps')
})

test('findCached prefers the small lookup.json, and falls back to index.json', async () => {
  const asked = []
  const sites = {
    'https://a.org/lookup.json': { lookup: { planets: 'maps/slim.json' } },
    'https://a.org/index.json': { lookup: { planets: 'maps/full.json' } },
    'https://b.org/index.json': { lookup: { planets: 'maps/old.json' } }
  }
  const fetchFn = async url => (asked.push(url), sites[url] ? { ok: true, json: async () => sites[url] } : { ok: false })
  assert.equal((await findCached('planets', ['https://a.org/'], { fetchFn })).url, 'https://a.org/maps/slim.json')
  assert.deepEqual(asked, ['https://a.org/lookup.json'], 'one small request')
  assert.equal((await findCached('planets', ['https://b.org/'], { fetchFn })).url, 'https://b.org/maps/old.json', 'an older cache still works')
})

test('directoryUrl sends maps back to this app, unless it is mindstr.org', () => {
  assert.equal(directoryUrl(DEFAULT_CACHE, 'https://mindstr.org/'), DEFAULT_CACHE)
  assert.equal(directoryUrl(DEFAULT_CACHE, 'http://localhost:5470/'), DEFAULT_CACHE + '?app=http%3A%2F%2Flocalhost%3A5470%2F')
})
