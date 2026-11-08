// Replay (#38): speed parsing, growth order, and the map at each step.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grownTo, growthOrder, parseSpeed } from '../../js/replay.js'
import { normalize } from '../../js/doc.js'

test('parseSpeed reads seconds and milliseconds, and keeps to 0.1–60 s', () => {
  assert.equal(parseSpeed('2s'), 2000)
  assert.equal(parseSpeed('2'), 2000)
  assert.equal(parseSpeed('500ms'), 500)
  assert.equal(parseSpeed('0.5'), 500)
  assert.equal(parseSpeed('10ms'), 100)
  assert.equal(parseSpeed('999'), 60000)
  assert.equal(parseSpeed(''), 1000)
  assert.equal(parseSpeed(null), 1000)
  assert.equal(parseSpeed('fast'), 1000)
})

const n = (name, i) => ({ '@id': '#n' + i, name, x: 0, y: 0 })

test('growthOrder keeps the stored order when parents already come first', () => {
  const doc = { nodes: ['root', 'a', 'a1', 'b'].map(n), connections: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 0, end: 3 }] }
  assert.deepEqual(growthOrder(doc), [0, 1, 2, 3])
})

test('growthOrder never puts a child before its parent, and puts unconnected nodes last', () => {
  // stored child-first (as after edits in the app), plus a node with no parent
  const doc = { nodes: ['root', 'a1', 'a', 'loose'].map(n), connections: [{ start: 2, end: 1 }, { start: 0, end: 2 }] }
  assert.deepEqual(growthOrder(doc), [0, 2, 1, 3])
})

test('grownTo gives a loadable map of the first n nodes, newest selected, root once whole', () => {
  const doc = { version: '0.2', nodes: ['root', 'a', 'a1', 'b'].map(n), connections: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 0, end: 3 }] }
  const order = growthOrder(doc)
  const two = grownTo(doc, order, 2)
  assert.deepEqual(two.nodes.map(x => x.name), ['root', 'a'])
  assert.deepEqual(two.connections, [{ start: 0, end: 1 }])
  assert.equal(two.selectedNode, 1)
  assert.equal(normalize(two).nodes.length, 2)
  const whole = grownTo(doc, order, 4)
  assert.equal(whole.nodes.length, 4)
  assert.equal(whole.selectedNode, 0)
  assert.equal(grownTo(doc, order, 0).nodes.length, 1, 'never less than the root')
  assert.equal(grownTo(doc, order, 99).nodes.length, 4)
})

test('grownTo renumbers connections when the growth order differs from the stored order', () => {
  const doc = { nodes: ['root', 'a1', 'a'].map(n), connections: [{ start: 2, end: 1 }, { start: 0, end: 2 }] }
  const step = grownTo(doc, growthOrder(doc), 3)
  assert.deepEqual(step.nodes.map(x => x.name), ['root', 'a', 'a1'])
  assert.deepEqual(step.connections, [{ start: 1, end: 2 }, { start: 0, end: 1 }])
})
