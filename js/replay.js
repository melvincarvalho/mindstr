// Replay (?replay=2s): regrow a map from its root, one node at a time. Pure functions, no DOM, so
// they run in Node for the tests; app.js drives the timer and the bar.

// "2s", "500ms" or "2" (seconds) → milliseconds per node, kept between 0.1 s and 60 s. Anything
// else, including an empty ?replay, means one second.
export function parseSpeed(value) {
  const m = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i)
  if (!m) return 1000
  const ms = Number(m[1]) * (m[2]?.toLowerCase() === 'ms' ? 1 : 1000)
  return Math.min(60000, Math.max(100, Math.round(ms)))
}

// The order to grow in: the stored order (the order nodes were added, for maps grown by leaf.js),
// but never a child before its parent. Nodes not connected to the root come last.
export function growthOrder({ nodes, connections }) {
  const parentOf = new Map()
  for (const c of connections) if (c.end !== 0 && !parentOf.has(c.end)) parentOf.set(c.end, c.start)
  const order = [0]
  const placed = new Set([0])
  for (let moved = true; moved; ) {
    moved = false
    for (let i = 1; i < nodes.length; i++) {
      if (placed.has(i) || !placed.has(parentOf.get(i))) continue
      order.push(i)
      placed.add(i)
      moved = true
    }
  }
  for (let i = 1; i < nodes.length; i++) if (!placed.has(i)) order.push(i)
  return order
}

// The map as it was after its first n nodes grew: a document the app can load like any other.
// The newest node is selected, and the root once the map is whole (as leaf.js does), so the app
// pops for each step and chimes at the end.
export function grownTo(doc, order, n) {
  const pick = order.slice(0, Math.max(1, Math.min(n, order.length)))
  const at = new Map(pick.map((old, k) => [old, k]))
  const nodes = pick.map(i => doc.nodes[i])
  const connections = doc.connections
    .filter(c => at.has(c.start) && at.has(c.end))
    .map(c => ({ start: at.get(c.start), end: at.get(c.end) }))
  const whole = pick.length === order.length
  return { ...doc, nodes, connections, selectedNode: whole ? 0 : pick.length - 1 }
}
