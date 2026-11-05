// Plain-text outlines ↔ trees, for copy/paste and import/export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOutline, toMarkdown } from '../../js/outline.js'

const names = t => ({ name: t.name, ...(t.link ? { link: t.link } : {}), kids: t.kids.map(names) })

test('bullets and indentation nest', () => {
  const trees = parseOutline('- Fruit\n  - Apple\n  - Pear\n- Veg\n    * Leek')
  assert.deepEqual(trees.map(names), [
    { name: 'Fruit', kids: [{ name: 'Apple', kids: [] }, { name: 'Pear', kids: [] }] },
    { name: 'Veg', kids: [{ name: 'Leek', kids: [] }] }
  ])
})

test('headings outrank any list indent', () => {
  const [root] = parseOutline('# Trip\n## Travel\n- Train\n## Stay\n- Hotel')
  assert.deepEqual(names(root), {
    name: 'Trip',
    kids: [
      { name: 'Travel', kids: [{ name: 'Train', kids: [] }] },
      { name: 'Stay', kids: [{ name: 'Hotel', kids: [] }] }
    ]
  })
})

test('numbered items, task boxes, tabs and blank lines', () => {
  const trees = parseOutline('1. One\r\n\r\n\t- [x] Done\n\t- [ ] Todo\n2) Two\n+ Three')
  assert.deepEqual(trees.map(names), [
    { name: 'One', kids: [{ name: 'Done', kids: [] }, { name: 'Todo', kids: [] }] },
    { name: 'Two', kids: [] },
    { name: 'Three', kids: [] }
  ])
})

test('a Markdown link becomes the node link', () => {
  const [t] = parseOutline('- [Solid](https://solidproject.org/)')
  assert.equal(t.name, 'Solid')
  assert.equal(t.link, 'https://solidproject.org/')
})

test('names are capped at 200 characters', () => {
  const [t] = parseOutline('- ' + 'x'.repeat(300))
  assert.equal(t.name.length, 200)
})

test('toMarkdown: root as a heading, the rest as nested bullets', () => {
  const tree = {
    name: 'Trip',
    kids: [
      { name: 'Travel', link: 'https://example.org/', kids: [{ name: 'Train', kids: [] }] },
      { name: 'Stay', kids: [] }
    ]
  }
  assert.equal(toMarkdown(tree), '# Trip\n\n- [Travel](https://example.org/)\n  - Train\n- Stay\n')
})

test('round trip: parseOutline(toMarkdown(tree)) gives the tree back', () => {
  const tree = {
    name: 'Root',
    kids: [
      { name: 'A', kids: [{ name: 'A1', kids: [] }, { name: 'A2', link: './other.jsonld', kids: [{ name: 'deep', kids: [] }] }] },
      { name: 'B', kids: [] }
    ]
  }
  assert.deepEqual(parseOutline(toMarkdown(tree)).map(names), [names(tree)])
})
