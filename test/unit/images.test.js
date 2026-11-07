// Images on nodes (SPEC.md, #31): resolving addresses, and loading each one once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageUrl, makeImages } from '../../js/images.js'
import { normalize, toDoc } from '../../js/doc.js'

const BASE = 'https://pod.example/maps/index.jsonld'

test('imageUrl: web addresses and relative references; nothing else', () => {
  assert.equal(imageUrl('https://x.example/a.png', BASE), 'https://x.example/a.png')
  assert.equal(imageUrl('http://x.example/a.png', BASE), 'http://x.example/a.png')
  assert.equal(imageUrl('a.png', BASE), 'https://pod.example/maps/a.png')
  assert.equal(imageUrl('../a.png', BASE), 'https://pod.example/a.png')
  assert.equal(imageUrl('  a.png ', BASE), 'https://pod.example/maps/a.png')
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd', '', '   ', null, undefined, 5, {}]) {
    assert.equal(imageUrl(bad, BASE), null, String(bad))
  }
})

// A fake Image: `answer(img)` says how each load ends, and every attempt is recorded.
function setup(answer) {
  const made = []
  let changes = 0
  const images = makeImages({
    base: () => BASE,
    onChange: () => changes++,
    create: () => {
      const img = {
        set src(url) {
          this.url = url
          made.push(this)
          answer(this) ? this.onload() : this.onerror()
        }
      }
      return img
    }
  })
  return { images, made, changes: () => changes }
}

test('makeImages: an image with CORS is ready and can be exported', () => {
  const { images, made, changes } = setup(() => true)
  const e = images.get('a.png')
  assert.equal(e.status, 'ready')
  assert.equal(e.exportable, true)
  assert.equal(e.img.url, 'https://pod.example/maps/a.png')
  assert.equal(made[0].crossOrigin, 'anonymous')
  assert.equal(made[0].referrerPolicy, 'no-referrer')
  assert.equal(changes(), 1)
})

test('makeImages: without CORS it loads again for display, and can\'t be exported', () => {
  const { images, made } = setup(img => img.crossOrigin === undefined)
  const e = images.get('a.png')
  assert.equal(made.length, 2)
  assert.equal(e.status, 'ready')
  assert.equal(e.exportable, false)
  assert.equal(e.img, made[1])
})

test('makeImages: an image that never loads has failed, and is not retried', () => {
  const { images, made, changes } = setup(() => false)
  const e = images.get('a.png')
  assert.equal(e.status, 'failed')
  assert.equal(e.img, null)
  assert.equal(made.length, 2)
  assert.equal(changes(), 1)
  images.get('a.png')
  assert.equal(made.length, 2)
})

test('makeImages: each address loads once', () => {
  const { images, made } = setup(() => true)
  images.get('a.png')
  images.get('https://pod.example/maps/a.png')
  images.get('b.png')
  assert.equal(made.length, 2)
})

test('makeImages: no image, or an unusable one, has failed without loading anything', () => {
  const { images, made } = setup(() => true)
  for (const raw of [undefined, '', 'javascript:alert(1)']) assert.equal(images.get(raw).status, 'failed')
  assert.equal(made.length, 0)
})

test('image survives reading and writing the map', () => {
  const data = { version: '0.2', nodes: [{ '@id': '#this', name: 'A', x: 0, y: 0, image: 'a.png' }], connections: [] }
  const { nodes, connections, selected, extra, version } = normalize(data)
  assert.equal(nodes[0].image, 'a.png')
  const doc = toDoc({ nodes, connections, selected, extra, version })
  assert.equal(doc.nodes[0].image, 'a.png')
  assert.deepEqual(doc['@context'].image, { '@type': '@id' })
})
