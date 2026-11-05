// The map document format (SPEC.md): reading any version into a clean in-memory shape, and
// writing it back. Pure functions, no DOM, so they run in Node for the tests.

export const newId = () =>
  '#' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')

// Format versions (see SPEC.md). 0.1: connections only. 0.2: adds @context and parent.
export const NS = 'https://mindstr.org/ns#'
export const isV01 = v => v === undefined || v === null || String(v) === '0.1' || String(v).startsWith('0.0')
export const fragment = v => (typeof v === 'string' && v.includes('#') ? '#' + v.split('#').pop() : v)

// Ensure a 0.2 context: keep whatever is there, add @vocab and the link/parent typing.
export function context02(existing) {
  const typing = { link: { '@type': '@id' }, parent: { '@type': '@id' } }
  if (!existing) return { '@vocab': NS, ...typing }
  if (typeof existing === 'object' && !Array.isArray(existing)) {
    return { '@vocab': NS, ...existing, link: existing.link ?? typing.link, parent: existing.parent ?? typing.parent }
  }
  const list = Array.isArray(existing) ? existing : [existing]
  return list.some(c => c && typeof c === 'object' && c.parent) ? existing : [...list, typing]
}

// Any map document → { nodes, connections, selected, extra, version }, repairing what it can.
export function normalize(data) {
  const raw = data && typeof data === 'object' ? data : {}
  // The root is always #this: it keeps that id, no other node may take it, and parent links
  // that named the root by its old id follow it.
  const seen = new Set(['#this'])
  const parents = [] // parent @id per node, as read from the file (0.2)
  const kept = (Array.isArray(raw.nodes) ? raw.nodes : []).filter(n => n && typeof n === 'object')
  const oldRoot = typeof kept[0]?.['@id'] === 'string' ? fragment(kept[0]['@id']) : null
  if (oldRoot) seen.add(oldRoot)
  const nodes = kept
    .map((n, i) => {
      const { parent, ...rest } = n
      const p = fragment(parent)
      parents.push(oldRoot && p === oldRoot ? '#this' : p)
      let id = i === 0 ? '#this' : typeof n['@id'] === 'string' ? n['@id'] : newId()
      if (i > 0 && seen.has(id)) id = newId()
      seen.add(id)
      return {
        ...rest,
        '@id': id,
        name: typeof n.name === 'string' ? n.name : String(n.name ?? ''),
        x: Number.isFinite(+n.x) ? +n.x : 0,
        y: Number.isFinite(+n.y) ? +n.y : 0
      }
    })
  if (!nodes.length) nodes.push({ '@id': '#this', name: 'Central idea', x: 0, y: 0 })
  nodes[0]['@id'] = '#this'
  const valid = i => Number.isInteger(i) && i >= 0 && i < nodes.length
  let connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .filter(c => c && valid(c.start) && valid(c.end) && c.start !== c.end)
    .map(c => ({ start: c.start, end: c.end }))
  if (!connections.length) {
    // no usable connections: rebuild the tree from parent links (0.2), in node order
    const index = new Map(nodes.map((n, i) => [n['@id'], i]))
    parents.forEach((p, i) => {
      const start = index.get(p)
      if (i > 0 && start !== undefined && start !== i) connections.push({ start, end: i })
    })
  }
  // when both exist and disagree, connections win; parent is recomputed on save
  const selected = valid(raw.selectedNode) ? raw.selectedNode : 0
  const { nodes: _n, connections: _c, selectedNode: _s, version, ...extra } = raw
  return { nodes, connections, selected, extra, version: version ?? '0.1' }
}

// The state back as a map document: 0.1 stays 0.1; 0.2 gets its context and parent links.
export function toDoc({ nodes: stateNodes, connections, selected, extra: stateExtra, version }) {
  const v01 = isV01(version)
  const extra = v01 ? stateExtra : { ...stateExtra, '@context': context02(stateExtra['@context']) }
  let nodes = stateNodes
  if (!v01) {
    const parentOf = new Map()
    for (const c of connections) if (c.end !== 0 && !parentOf.has(c.end)) parentOf.set(c.end, c.start)
    nodes = stateNodes.map((n, i) => {
      const p = parentOf.get(i)
      return i === 0 || p === undefined || !stateNodes[p] ? n : { ...n, parent: stateNodes[p]['@id'] }
    })
  }
  return { ...extra, version, nodes, connections, selectedNode: selected }
}
