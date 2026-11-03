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
    const r = depth === 0 ? 0 : 230 + (depth - 1) * 220 + (depth >= 2 && nth % 2 ? 80 : 0)
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
