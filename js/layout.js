// Radial tree layout (the same algorithm as SKILL.md and scripts/build-examples.js),
// using real node sizes for overlap settling.

// children: index → [child indices]; size: index → { w, h }
// Returns index → { x, y } for every node reachable from `root`, centred on `origin`.
export function radialLayout(root, children, size, origin = { x: 0, y: 0 }) {
  const pos = new Map()
  const leaves = new Map()
  const countLeaves = i => {
    const kids = children(i)
    const n = kids.length ? kids.reduce((s, k) => s + countLeaves(k), 0) : 1
    leaves.set(i, n)
    return n
  }
  countLeaves(root)

  const order = []
  const place = (i, a0, a1, depth, nth) => {
    const mid = (a0 + a1) / 2
    const r = depth === 0 ? 0 : 230 + (depth - 1) * 220
    pos.set(i, { x: origin.x + r * Math.cos(mid), y: origin.y + r * Math.sin(mid) * 0.8, a: mid })
    order.push(i)
    const kids = children(i)
    const total = kids.reduce((s, k) => s + leaves.get(k), 0)
    let a = a0
    kids.forEach((k, j) => {
      const span = ((a1 - a0) * leaves.get(k)) / total
      place(k, a, a + span, depth + 1, j)
      a += span
    })
  }
  place(root, -Math.PI, Math.PI, 0, 0)

  // settle overlaps: push a clashing node outward along its own angle
  const clash = (i, j) => {
    const p = pos.get(i)
    const q = pos.get(j)
    const si = size(i)
    const sj = size(j)
    return Math.abs(p.x - q.x) < (si.w + sj.w) / 2 + 24 && Math.abs(p.y - q.y) < (si.h + sj.h) / 2 + 12
  }
  order.forEach((i, k) => {
    if (!k) return
    const p = pos.get(i)
    for (let t = 0; t < 60 && order.slice(0, k).some(j => clash(i, j)); t++) {
      p.x += 20 * Math.cos(p.a)
      p.y += 16 * Math.sin(p.a)
    }
  })
  for (const p of pos.values()) {
    p.x = Math.round(p.x)
    p.y = Math.round(p.y)
    delete p.a
  }
  return pos
}

// Lay out the descendants of node i as a fan pointing away from its parent
// (angle in radians; y is squashed by 0.8 like the radial layout). Mutates pos(j).
export function fanLayout(i, children, size, pos, angle) {
  const leaves = j => {
    const k = children(j)
    return k.length ? k.reduce((s, c) => s + leaves(c), 0) : 1
  }
  const place = (j, a) => {
    const kids = children(j)
    if (!kids.length) return
    const total = kids.reduce((s, c) => s + leaves(c), 0)
    const spread = Math.min(Math.PI * 0.95, 0.42 * total)
    const p = pos(j)
    let a0 = a - spread / 2
    for (const c of kids) {
      const span = (spread * leaves(c)) / total
      const mid = a0 + span / 2
      const r = 170 + (size(j).w / 2 + size(c).w / 2) * Math.abs(Math.cos(mid)) * 0.7
      const q = pos(c)
      q.x = Math.round(p.x + Math.cos(mid) * r)
      q.y = Math.round(p.y + Math.sin(mid) * r * 0.8)
      place(c, mid)
      a0 += span
    }
  }
  place(i, angle)
}
