// The map format (SPEC.md): reading any version, repairing it, writing it back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { context02, fragment, isV01, newId, normalize, NS, toDoc } from '../../js/doc.js'

const ID = /^#[abcdefghijkmnpqrstuvwxyz23456789]{6}$/

test('newId: # and six characters from the unambiguous alphabet', () => {
  const ids = new Set(Array.from({ length: 200 }, newId))
  for (const id of ids) assert.match(id, ID)
  assert.ok(ids.size > 195, 'ids are random')
})

test('isV01: missing, 0.1 and 0.0.x are 0.1; 0.2 is not', () => {
  for (const v of [undefined, null, '0.1', 0.1, '0.0.40']) assert.equal(isV01(v), true, String(v))
  for (const v of ['0.2', 0.2]) assert.equal(isV01(v), false, String(v))
})

test('fragment: keeps the part after # of a full IRI', () => {
  assert.equal(fragment('https://example.org/map.jsonld#k3x9q2'), '#k3x9q2')
  assert.equal(fragment('#this'), '#this')
  assert.equal(fragment(undefined), undefined)
})

test('context02: adds @vocab and link/image/parent typing, keeps what is there', () => {
  assert.deepEqual(context02(undefined), {
    '@vocab': NS,
    link: { '@type': '@id' },
    image: { '@type': '@id' },
    parent: { '@type': '@id' }
  })
  const own = { '@vocab': NS, foaf: 'http://xmlns.com/foaf/0.1/', link: { '@type': '@vocab' } }
  const merged = context02(own)
  assert.equal(merged.foaf, own.foaf)
  assert.deepEqual(merged.link, { '@type': '@vocab' }, 'an existing link definition wins')
  assert.deepEqual(merged.parent, { '@type': '@id' })
  const list = context02('https://example.org/context.jsonld')
  assert.ok(Array.isArray(list) && list[0] === 'https://example.org/context.jsonld' && list[1].parent)
  const done = ['https://example.org/c.jsonld', { parent: { '@type': '@id' } }]
  assert.equal(context02(done), done, 'a list that already types parent is left alone')
})

test('normalize: nothing usable gives a single root', () => {
  for (const input of [null, 'nope', {}, { nodes: [] }, { nodes: [null, 5] }]) {
    const m = normalize(input)
    assert.equal(m.nodes.length, 1)
    assert.equal(m.nodes[0]['@id'], '#this')
    assert.deepEqual(m.connections, [])
    assert.equal(m.version, '0.1')
  }
})

test('normalize: repairs ids, names and coordinates', () => {
  const m = normalize({
    nodes: [
      { '@id': '#root', name: 'Root', x: '10', y: 20 },
      { name: 42, x: 'left', y: null },
      { '@id': '#dup', name: 'A' },
      { '@id': '#dup', name: 'B' }
    ],
    connections: [{ start: 0, end: 1 }, { start: 0, end: 2 }, { start: 0, end: 3 }]
  })
  const [root, missing, a, b] = m.nodes
  assert.equal(root['@id'], '#this', 'the root is always #this')
  assert.equal(root.x, 10)
  assert.match(missing['@id'], ID, 'a missing id is generated')
  assert.equal(missing.name, '42')
  assert.equal(missing.x, 0)
  assert.equal(missing.y, 0)
  assert.equal(a['@id'], '#dup')
  assert.match(b['@id'], ID)
  assert.notEqual(b['@id'], '#dup', 'a duplicate id is replaced')
})

test('normalize: no other node may take #this, or the root\'s old id', () => {
  const m = normalize({
    nodes: [{ '@id': '#root', name: 'R' }, { '@id': '#this', name: 'A' }, { '@id': '#root', name: 'B' }],
    connections: [{ start: 0, end: 1 }, { start: 0, end: 2 }]
  })
  const ids = m.nodes.map(n => n['@id'])
  assert.equal(ids[0], '#this')
  assert.equal(new Set(ids).size, 3, 'ids are unique')
  assert.ok(!ids.slice(1).includes('#this') && !ids.includes('#root'))
})

test('normalize: parent links to the root\'s old id follow it to #this', () => {
  const m = normalize({
    version: '0.2',
    nodes: [
      { '@id': '#root', name: 'R' },
      { '@id': '#aaaaaa', name: 'A', parent: '#root' },
      { '@id': '#bbbbbb', name: 'B', parent: 'https://example.org/map.jsonld#root' }
    ]
  })
  assert.deepEqual(m.connections, [{ start: 0, end: 1 }, { start: 0, end: 2 }])
})

test('normalize: keeps unknown node and top-level fields', () => {
  const m = normalize({
    '@context': { '@vocab': NS },
    title: 'Mine',
    version: '0.2',
    nodes: [{ '@id': '#this', name: 'R', x: 0, y: 0, size: 1.25, mood: 'happy', bgColor: '#fff' }],
    connections: []
  })
  assert.equal(m.nodes[0].size, 1.25)
  assert.equal(m.nodes[0].mood, 'happy')
  assert.equal(m.nodes[0].bgColor, '#fff')
  assert.deepEqual(m.extra, { '@context': { '@vocab': NS }, title: 'Mine' })
  assert.equal(m.version, '0.2')
})

test('normalize: drops connections that are out of range, self-loops or malformed', () => {
  const m = normalize({
    nodes: [{ name: 'R' }, { name: 'A' }, { name: 'B' }],
    connections: [
      { start: 0, end: 1 },
      { start: 0, end: 9 },
      { start: 2, end: 2 },
      { start: '0', end: 2 },
      null,
      { start: 1, end: 2, extra: 'dropped' }
    ]
  })
  assert.deepEqual(m.connections, [{ start: 0, end: 1 }, { start: 1, end: 2 }])
})

test('normalize: rebuilds the tree from parent links when there are no connections', () => {
  const m = normalize({
    version: '0.2',
    nodes: [
      { '@id': '#this', name: 'R' },
      { '@id': '#aaaaaa', name: 'A', parent: '#this' },
      { '@id': '#bbbbbb', name: 'B', parent: 'https://example.org/map.jsonld#aaaaaa' },
      { '@id': '#cccccc', name: 'Orphan', parent: '#nobody' }
    ]
  })
  assert.deepEqual(m.connections, [{ start: 0, end: 1 }, { start: 1, end: 2 }])
  assert.ok(m.nodes.every(n => !('parent' in n)), 'parent is not kept in memory')
})

test('normalize: connections win over parent when both exist', () => {
  const m = normalize({
    nodes: [{ name: 'R' }, { '@id': '#aaaaaa', name: 'A', parent: '#this' }, { '@id': '#bbbbbb', name: 'B', parent: '#this' }],
    connections: [{ start: 0, end: 1 }, { start: 1, end: 2 }]
  })
  assert.deepEqual(m.connections, [{ start: 0, end: 1 }, { start: 1, end: 2 }])
})

test('normalize: selectedNode is kept when valid, else the root', () => {
  const nodes = [{ name: 'R' }, { name: 'A' }]
  assert.equal(normalize({ nodes, selectedNode: 1 }).selected, 1)
  assert.equal(normalize({ nodes, selectedNode: 7 }).selected, 0)
  assert.equal(normalize({ nodes, selectedNode: null }).selected, 0)
})

const sample = version =>
  normalize({
    version,
    nodes: [
      { '@id': '#this', name: 'R', x: 0, y: 0 },
      { '@id': '#aaaaaa', name: 'A', x: 1, y: 2 },
      { '@id': '#bbbbbb', name: 'B', x: 3, y: 4 }
    ],
    connections: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    selectedNode: 2
  })

test('toDoc: a 0.1 map is written as 0.1, with no context or parent added', () => {
  const doc = toDoc(sample('0.1'))
  assert.equal(doc.version, '0.1')
  assert.equal(doc['@context'], undefined)
  assert.ok(doc.nodes.every(n => !('parent' in n)))
  assert.equal(doc.selectedNode, 2)
})

test('toDoc: a 0.2 map gets its context and parent links from connections', () => {
  const doc = toDoc(sample('0.2'))
  assert.equal(doc.version, '0.2')
  assert.equal(doc['@context']['@vocab'], NS)
  assert.equal(doc.nodes[0].parent, undefined, 'the root has no parent')
  assert.equal(doc.nodes[1].parent, '#this')
  assert.equal(doc.nodes[2].parent, '#aaaaaa')
})

test('toDoc: a stale parent is rewritten after re-parenting', () => {
  const m = sample('0.2')
  m.connections = [{ start: 0, end: 1 }, { start: 0, end: 2 }] // B moved under the root
  assert.equal(toDoc(m).nodes[2].parent, '#this')
})

test('round trip: normalize(toDoc(map)) gives the same map', () => {
  for (const v of ['0.1', '0.2']) {
    const m = sample(v)
    const again = normalize(JSON.parse(JSON.stringify(toDoc(m))))
    assert.deepEqual(again.nodes, m.nodes)
    assert.deepEqual(again.connections, m.connections)
    assert.equal(again.selected, m.selected)
    assert.equal(again.version, v)
  }
})
