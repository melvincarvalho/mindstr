---
name: mindstr
description: How to read, create and edit mindstr mind maps — JSON / JSON-LD documents of positioned nodes and connections, stored on a Solid pod and edited live in the mindstr app. Use when making a mind map on a pod, adding or reorganising ideas in an existing map, or turning notes into a laid-out map someone will keep editing.
---

# mindstr

**mindstr** is a build-free mind-map editor. A map is **one JSON document** on a Solid
pod; the app loads it from a URL, people drag and edit nodes, and saves go back to the
same URL. App: https://mindstr.org (also installed on pods at `/public/apps/mindstr/`).

Your job as an LLM is usually one of:
1. **Create** a map from a brief, outline or notes.
2. **Edit** an existing map: add, rename, link, recolour or remove nodes.

Unlike text-based mind maps, **every node has an explicit position**. Laying nodes out
well is part of the job; see *Layout* below.

## Document shape

The full format is in **[SPEC.md](SPEC.md)** (also at `<pod>/public/apps/mindstr/SPEC.md`
when installed, and https://github.com/melvincarvalho/mindstr/blob/gh-pages/SPEC.md).
Write **version 0.2**. The rules you must not get wrong:

- `nodes[0]` is the root and its `@id` is `#this`. Other ids are `#` + 6 characters
  from `abcdefghijkmnpqrstuvwxyz23456789`, unique, never changed once written.
- The tree is stored twice and **both must agree**: `connections` (`{ "start": i, "end": j }`,
  **array indices** into `nodes`) and `parent` on every non-root node (the parent's `@id`).
  If they disagree, readers trust `connections`.
- Every node is reachable from the root, with exactly one parent: a tree.
- Children are ordered as their connections appear.
- Keep any `@context` and other fields you didn't write. A new map gets the 0.2 context:
  `{ "@vocab": "https://mindstr.org/ns#", "link": { "@type": "@id" }, "parent": { "@type": "@id" } }`.
- `bgColor`: soft pastels; the app draws the root in its own colour, so don't colour it.
  Top-level branches cycle `#D6E8FF` `#D9F2DC` `#FFD6E8` `#FFE1CC` `#E6E0FF` `#D4F1F4`;
  leaves stay uncoloured.
- `link`: an `http(s)` URL, or a relative path to another map (`./other.jsonld`, or
  `./other.jsonld#k3x9q2` for one node in it) or a `.md` document.
- Names are one short line (1–4 words read best).

## Storage and viewing

- A user's own map: **`<pod>/public/mindstr/index.jsonld`** (the app's default). Other
  maps: `<pod>/public/mindstr/<name>.jsonld`. `/public/` is world-readable and
  owner-writable on JSS pods, so the link can be shared.
- Write with `PUT` and `Content-Type: application/ld+json` (`application/json` for `.json`).
- View/edit: `https://mindstr.org/?uri=<map-url>`, or `<pod>/public/apps/mindstr/?uri=<map-url>`
  when installed. `?uri=` takes absolute URLs or paths relative to the app.
- On a JSS pod with MCP: `read_resource` / `write_resource` / `list_resources` on those
  paths; `list_resources` on `/public/mindstr/` finds existing maps.

## Editing safely

People may have the map open. The app subscribes to changes and shows yours live, so:

1. **Read, change, write back the whole document.** Don't write fragments.
2. **Write conditionally when you can.** Use the `ETag` from your GET as
   `If-Match` on the PUT; for a brand-new file send `If-None-Match: *`. A `412` means
   someone saved in between: re-read, re-apply your change, try again.
3. **Add nodes at the end of `nodes`** so existing indices in `connections` stay valid,
   and give each new node its `parent`.
   Viewers see added nodes selected and highlighted.
4. **When removing node *i***: drop it from `nodes`, drop connections touching it,
   either remove its whole branch too (what the app's Delete does) or re-attach its children to its parent (the app's Shift+Delete), then **decrement every
   `start`/`end` greater than *i***, and update the moved children's `parent`. Never delete the root.
5. Keep every other node's `@id`, position and unknown fields untouched.

## Layout

Use this function. It is the exact algorithm that laid out the bundled examples, and the
example below comes from it. Pass an outline; it returns a complete map document.

```js
// Lay out an outline as a mindstr map. tree = { name, extra?, kids?: [tree] }
function layout(tree) {
  const nodes = [], connections = []
  const leaves = t => Math.max(1, (t.kids || []).reduce((s, k) => s + leaves(k), 0))
  const id = () => '#' + Array.from({ length: 6 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('')
  function add(t, parent, a0, a1, depth, nth) {
    const mid = (a0 + a1) / 2                      // centre of this node's wedge (radians)
    const r = depth === 0 ? 0                      // root at the origin
      : 230 + (depth - 1) * 220                    // ring radius: 230, 450, 670…
    nodes.push({ '@id': depth ? id() : '#this', name: t.name,
      x: Math.round(r * Math.cos(mid)), y: Math.round(r * Math.sin(mid) * 0.8), ...(t.extra || {}) })
    const i = nodes.length - 1
    if (parent !== null) connections.push({ start: parent, end: i })
    const kids = t.kids || [], total = kids.reduce((s, k) => s + leaves(k), 0)
    let a = a0
    kids.forEach((k, j) => {                        // split the wedge by leaf count
      const span = (a1 - a0) * leaves(k) / total
      add(k, i, a, a + span, depth + 1, j)
      a += span
    })
  }
  add(tree, null, -Math.PI, Math.PI, 0, 0)         // full circle, starting at the left
  // settle overlaps: push a clashing node outward along its own angle, 20 px at a time
  const w = n => Math.max(8 * n.name.length + 32, 56)
  const clash = (p, q) => Math.abs(p.x - q.x) < (w(p) + w(q)) / 2 + 24 && Math.abs(p.y - q.y) < 48
  nodes.forEach((n, i) => {
    const a = Math.atan2(n.y / 0.8, n.x)
    for (let t = 0; i > 0 && t < 40 && nodes.slice(0, i).some(m => clash(n, m)); t++) {
      n.x = Math.round(n.x + 20 * Math.cos(a)); n.y = Math.round(n.y + 16 * Math.sin(a))
    }
  })
  for (const c of connections) nodes[c.end].parent = nodes[c.start]['@id']
  return {
    '@context': { '@vocab': 'https://mindstr.org/ns#', link: { '@type': '@id' }, parent: { '@type': '@id' } },
    version: '0.2', nodes, connections, selectedNode: 0
  }
}

// usage
const N = (name, extra, ...kids) => ({ name, extra, kids })
const map = layout(N('Trip', {},
  N('Travel', { bgColor: '#D6E8FF' }, N('Train'), N('Packing')),
  N('Stay', { bgColor: '#D9F2DC' }, N('Hotel'))))
```

How it works, if you can't run code:

- Angles are in radians with **y pointing down**; the root's wedge is the full circle,
  from −π (left) going clockwise. Wedges have no gaps between them.
- Each child gets a share of its parent's wedge proportional to its **leaf count**: the
  number of descendants with no children of their own, counting a childless node as 1.
- A node sits at the middle angle of its wedge on a shared ellipse around the root:
  `x = r·cos(angle)`, `y = 0.8·r·sin(angle)`, with `r = 230` for top-level branches,
  `450` for the next level and `670` after that.

**Node size.** The app draws ovals 36 high and `text width + 32` wide (minimum 56), with
text in a 15 px sans-serif. `8 × characters + 32` slightly overestimates that, which is
the safe direction for overlap checks. Names never wrap.

**Overlap.** Two nodes `a`, `b` overlap when *both*
`|a.x − b.x| < (width(a) + width(b)) / 2 + 24` **and** `|a.y − b.y| < 48`.
`layout()` already fixes these: it moves each clashing node (in document order) outward
along its own angle in 20 px steps until it clears every earlier node. Do the same if you
place nodes by hand. Edges may cross; don't worry about that.

**Adding to an existing map** (keep everything else where it is): put the new child
~170 from its parent, continuing the grandparent → parent direction (for a child of the
root, pick the emptiest direction), fan siblings ±25° around that line, then fix
overlaps as above.

**Size.** 5–8 top-level branches with 2–5 leaves each read best. Split very big topics
into separate maps and connect them with relative links.

## Checklist before writing

- [ ] `version` is `"0.2"` and the 0.2 `@context` is present
- [ ] `nodes[0]` exists and has `"@id": "#this"`
- [ ] every `@id` is unique; existing ones unchanged
- [ ] every `start`/`end` is a valid index, and no node is its own parent
- [ ] every node except the root is the `end` of exactly one connection, and its `parent` names that connection's `start`
- [ ] `x`/`y` are finite numbers and no two nodes overlap (rule above)
- [ ] links are `http(s)` or relative `./…`

## Minimal example (validated: output of `layout()` above; passes the checklist and renders in mindstr)

```json
{
  "@context": { "@vocab": "https://mindstr.org/ns#", "link": { "@type": "@id" }, "parent": { "@type": "@id" } },
  "version": "0.2",
  "nodes": [
    {"@id": "#this", "name": "Weekend trip", "x": 0, "y": 0},
    {"@id": "#zyf9qd", "name": "Travel", "x": -110, "y": -152, "bgColor": "#D6E8FF", "parent": "#this"},
    {"@id": "#j5dew5", "name": "Train tickets", "x": -372, "y": -172, "parent": "#zyf9qd"},
    {"@id": "#m6xefa", "name": "Packing list", "x": 0, "y": -408, "link": "./packing.json", "parent": "#zyf9qd"},
    {"@id": "#zvmkg2", "name": "Stay", "x": 220, "y": 0, "bgColor": "#D9F2DC", "parent": "#this"},
    {"@id": "#ibdxv5", "name": "Hotel", "x": 372, "y": -172, "parent": "#zvmkg2"},
    {"@id": "#9khvdh", "name": "Breakfast", "x": 442, "y": 204, "parent": "#zvmkg2"},
    {"@id": "#uxh998", "name": "Do", "x": -110, "y": 152, "bgColor": "#FFD6E8", "parent": "#this"},
    {"@id": "#9eys32", "name": "Museum", "x": 0, "y": 344, "parent": "#uxh998"},
    {"@id": "#zajc4z", "name": "Coast walk", "x": -442, "y": 204, "link": "https://example.com/walk", "parent": "#uxh998"}
  ],
  "connections": [
    {"start": 0, "end": 1},
    {"start": 1, "end": 2},
    {"start": 1, "end": 3},
    {"start": 0, "end": 4},
    {"start": 4, "end": 5},
    {"start": 4, "end": 6},
    {"start": 0, "end": 7},
    {"start": 7, "end": 8},
    {"start": 7, "end": 9}
  ],
  "selectedNode": 0
}
```

## Related

- **markmap** (solid-apps) renders a mind map from Markdown with automatic layout and
  no positions. Use markmap for read-only outlines and mindstr when people will
  arrange and edit the map by hand.
