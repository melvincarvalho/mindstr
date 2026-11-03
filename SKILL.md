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

```json
{
  "version": "0.1",
  "nodes": [
    { "@id": "#this",  "name": "Trip",    "x": 0,    "y": 0, "bgColor": "#FFF3C4" },
    { "@id": "#k3x9q2", "name": "Travel", "x": 220,  "y": 0 },
    { "@id": "#p7m2wd", "name": "Guide",  "x": 430,  "y": -40, "link": "https://example.com/guide" }
  ],
  "connections": [
    { "start": 0, "end": 1 },
    { "start": 1, "end": 2 }
  ],
  "selectedNode": 0
}
```

| Field | Rules |
| --- | --- |
| `nodes[]` | Required. **`nodes[0]` is the root**; its `@id` is always `#this`. |
| `@id` | Unique fragment, `#` + 6 lowercase letters/digits. Never reuse or change an existing one; the app uses them to keep selection and highlight changes. |
| `name` | Node text. Keep it short: 1–4 words. Long names make wide ovals that collide. |
| `x`, `y` | Centre of the node in map units (≈ CSS px at 100% zoom). `y` grows **downward**. Any origin; the app fits the map to the screen on load. |
| `bgColor` | Optional CSS colour. Use soft pastels (`#FFD6E8` `#D6E8FF` `#D9F2DC` `#FFF3C4` `#FFE1CC` `#E6E0FF`) so dark text stays readable. |
| `link` | Optional. `http(s)` URL opens in a new tab; a `.md` URL opens in the NosDAV doc viewer; a relative link to `.json`/`.jsonld` (`./other.json`) opens that map in mindstr. Other schemes are blocked. |
| `connections[]` | Parent → child edges. **`start` and `end` are array indices into `nodes`, not `@id`s.** Each non-root node should have exactly one parent, forming a tree under the root. |
| `selectedNode` | Index of the selected node; optional. Leave it as is when editing. |
| `version` | `"0.1"`. |

Unknown fields on nodes and at the top level (e.g. a JSON-LD `@context` or `@type`) are
**preserved** by the app, so you can annotate a map without breaking it.

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
3. **Add nodes at the end of `nodes`** so existing indices in `connections` stay valid.
   Viewers see added nodes selected and highlighted.
4. **When removing node *i***: drop it from `nodes`, drop connections touching it,
   re-attach its children to its parent (as the app does), then **decrement every
   `start`/`end` greater than *i***. Never delete the root.
5. Keep every other node's `@id`, position and unknown fields untouched.

## Layout

Nodes are ovals ~36 high and about `8 × characters + 32` wide (minimum 56). Aim for:

- **Radial tree.** Root at `(0, 0)`. Give each top-level branch an angular wedge sized by
  how many leaves it has; place depth-1 nodes on an ellipse of radius ~220 × 175,
  and each further level ~210 farther out, within the parent's wedge.
- **Spacing.** Keep at least ~24 px between oval edges horizontally and ~12 vertically.
  On a crowded outer ring, push alternate siblings ~80 farther out.
- **Adding to an existing map.** Place a child ~170 away from its parent, continuing
  outward along the grandparent → parent direction, and fan siblings ±25° around it.
  Check for overlaps with *all* nodes and nudge down by ~48 until clear.
- **Size.** 5–8 top-level branches and 2–5 leaves each read best. Split very big
  topics into separate maps and connect them with relative links.

The examples in this repo were laid out this way by `scripts/build-examples.js`;
read it for a working implementation.

## Checklist before writing

- [ ] `nodes[0]` exists and has `"@id": "#this"`
- [ ] every `@id` is unique; existing ones unchanged
- [ ] every `start`/`end` is a valid index, and no node is its own parent
- [ ] every node except the root is the `end` of exactly one connection
- [ ] `x`/`y` are finite numbers and no two ovals overlap
- [ ] links are `http(s)` or relative `./…`

## Minimal example (validated: renders in mindstr)

```json
{
  "@context": { "@vocab": "https://mindstr.org/ns#" },
  "version": "0.1",
  "nodes": [
    { "@id": "#this",   "name": "Weekend trip", "x": 0,    "y": 0,    "bgColor": "#FFF3C4" },
    { "@id": "#trv001", "name": "Travel",       "x": 220,  "y": 0,    "bgColor": "#D6E8FF" },
    { "@id": "#trv002", "name": "Train tickets","x": 440,  "y": -50 },
    { "@id": "#trv003", "name": "Packing list", "x": 440,  "y": 50,   "link": "./packing.json" },
    { "@id": "#sty001", "name": "Stay",         "x": -110, "y": 150,  "bgColor": "#D9F2DC" },
    { "@id": "#sty002", "name": "Hotel",        "x": -160, "y": 270 },
    { "@id": "#do0001", "name": "Do",           "x": -110, "y": -150, "bgColor": "#FFD6E8" },
    { "@id": "#do0002", "name": "Museum",       "x": -260, "y": -260 },
    { "@id": "#do0003", "name": "Coast walk",   "x": -40,  "y": -280, "link": "https://example.com/walk" }
  ],
  "connections": [
    { "start": 0, "end": 1 }, { "start": 1, "end": 2 }, { "start": 1, "end": 3 },
    { "start": 0, "end": 4 }, { "start": 4, "end": 5 },
    { "start": 0, "end": 6 }, { "start": 6, "end": 7 }, { "start": 6, "end": 8 }
  ],
  "selectedNode": 0
}
```

## Related

- **markmap** (solid-apps) renders a mind map from Markdown with automatic layout and
  no positions. Use markmap for read-only outlines and mindstr when people will
  arrange and edit the map by hand.
