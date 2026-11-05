// Radial and fan layouts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fanLayout, radialLayout } from '../../js/layout.js'
import { normalize } from '../../js/doc.js'

// Children by index from a map's connections, and a box size from the name's length.
function tree(file) {
  const m = normalize(JSON.parse(readFileSync(new URL(`../../examples/${file}`, import.meta.url))))
  const kids = m.nodes.map(() => [])
  for (const c of m.connections) kids[c.start].push(c.end)
  const size = i => ({ w: Math.max(48, m.nodes[i].name.length * 8 + 28), h: i === 0 ? 50 : 34 })
  return { m, children: i => kids[i], size }
}

const clash = (p, q, a, b) => Math.abs(p.x - q.x) < (a.w + b.w) / 2 + 24 && Math.abs(p.y - q.y) < (a.h + b.h) / 2 + 12

for (const file of ['welcome.json', 'nostr.json', 'project-plan.json', 'solar-system.json']) {
  test(`radialLayout places every node of ${file} on whole pixels, with no clashes`, () => {
    const { m, children, size } = tree(file)
    const pos = radialLayout(0, children, size, { x: 10, y: 20 })
    assert.equal(pos.size, m.nodes.length)
    assert.deepEqual(pos.get(0), { x: 10, y: 20 }, 'the root sits on the origin')
    for (const p of pos.values()) assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y))
    const ids = [...pos.keys()]
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const [i, j] = [ids[a], ids[b]]
        assert.ok(!clash(pos.get(i), pos.get(j), size(i), size(j)), `"${m.nodes[i].name}" clashes with "${m.nodes[j].name}"`)
      }
  })
}

test('radialLayout is deterministic', () => {
  const { children, size } = tree('welcome.json')
  assert.deepEqual([...radialLayout(0, children, size)], [...radialLayout(0, children, size)])
})

test('fanLayout fans children out on the given side of their parent', () => {
  // 0 → 1 → (2, 3, 4)
  const kids = [[1], [2, 3, 4], [], [], []]
  const pts = kids.map(() => ({ x: 0, y: 0 }))
  pts[1] = { x: 500, y: 0 }
  fanLayout(1, i => kids[i], () => ({ w: 80, h: 32 }), i => pts[i], 0) // pointing right
  for (const c of [2, 3, 4]) assert.ok(pts[c].x > 500, `child ${c} is to the right`)
  assert.ok(pts[2].y < pts[3].y && pts[3].y < pts[4].y, 'children keep their order')
  assert.deepEqual(pts[0], { x: 0, y: 0 }, 'nodes outside the branch are untouched')
})
