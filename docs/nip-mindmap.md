# Mind maps (kind 30627)

`draft` `optional`

A mind map is a tree of short ideas around one central topic. This spec stores one as an addressable event, so it can be shared, edited by its author, forked by others, and opened by any client that understands the kind.

## Event

```jsonc
{
  "kind": 30627,
  "content": "<JSON map document, see below>",
  "tags": [
    ["d", "climate-change"],
    ["title", "Climate change"],
    ["alt", "Mind map: Climate change (27 ideas). Open it in a mind map app."],
    ["t", "mindmap"],
    ["t", "science"],
    ["t", "global-warming"],
    ["license", "CC0-1.0"],
    ["r", "https://melvincarvalho.github.io/mindstr-maps/maps/climate-change.json"]
  ]
}
```

| Tag | | Meaning |
|---|---|---|
| `d` | required | A slug for the map, unique per author. Editing republishes with the same `d`. |
| `title` | required | The central topic (the root node's name). |
| `alt` | required | [NIP-31](https://github.com/nostr-protocol/nips/blob/master/31.md) fallback text for clients that don't know this kind. |
| `t` | recommended | Lower-case topics for search. Include `mindmap`. At most 10. |
| `license` | optional | An SPDX identifier, e.g. `CC0-1.0`. |
| `r` | optional | Other places the same map lives (a Solid pod, a static cache). |
| `a` | optional | `["a", "30627:<pubkey>:<d>", "<relay>", "fork"]` when this map was made from another one. |

## The map document

`content` is a JSON object, the same document [mindstr](https://mindstr.org) saves to files and Solid pods (JSON-LD, version `0.2`, specified in [SPEC.md](https://github.com/melvincarvalho/mindstr/blob/gh-pages/SPEC.md); its terms are defined at [mindstr.org/ns](https://mindstr.org/ns/)):

```jsonc
{
  "@context": { "@vocab": "https://mindstr.org/ns#", "link": { "@type": "@id" }, "parent": { "@type": "@id" } },
  "version": "0.2",
  "nodes": [
    { "@id": "#this", "name": "Climate change" },
    { "@id": "#a7k2pq", "name": "The greenhouse effect", "parent": "#this", "bgColor": "#D6E8FF" },
    { "@id": "#m3x9tr", "name": "Gases trap heat from the Sun", "parent": "#a7k2pq",
      "link": "https://en.wikipedia.org/wiki/Greenhouse_effect" }
  ]
}
```

**Required for every client:**

- `nodes`: an array of nodes. The first node is the root, with `@id` `#this` and no `parent`.
- Each node has an `@id` (a fragment, unique in the map), a `name` (plain text), and, except the root, a `parent` (the `@id` of another node).
- Nodes form one tree: every `parent` exists, and there are no cycles. Clients MUST ignore nodes that break this rather than reject the map.

**Optional (clients MAY ignore):**

- `link`: an absolute `http(s)` URL for the node, or an `naddr` of another map. Clients MUST NOT open other schemes (no `javascript:`, `data:` and so on). Relative links don't apply inside an event.
- `image`: an `http(s)` image URL.
- `x`, `y`: the author's layout, in pixels from the root. Clients MAY lay the map out themselves instead.
- `bgColor`, `size`, `collapsed`: presentation hints.
- `connections`: the same tree by array index (`[{ "start": i, "end": j }]`), which mindstr also writes. When present, it MUST agree with `parent`.

Unknown fields MUST be kept when a client re-publishes a map it didn't make.

Node order is meaningful: it's the order the map was built, and clients MAY replay it to show the map growing.

## Size

Keep the event under **64 KB** (strfry's default event limit; most relays allow 64–128 KB). A 30-node map is about 4 KB. A map that doesn't fit SHOULD be published with `content` holding only the required fields (no layout), or split into linked maps (a node whose `link` is another map's `naddr`).

## Editing, history and forks

- **Editing:** republish with the same `d`. Relays keep only the latest version.
- **History:** the latest event is the map. To keep a provable history, authors MAY also anchor versions elsewhere (for example git, or a timestamp service) and point to them with an `r` tag; this spec doesn't define one.
- **Forks:** to build on someone else's map, publish your own 30627 with your own `d`, and an `a` tag to the original marked `fork`.
- **Deleting:** a [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) deletion with an `a` tag to the map.

## Related kinds

- Comments on a map: [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) (kind 1111), with the map's `a` tag. A comment about one node MAY add `["node", "<@id>"]`.
- Reactions and zaps: kinds 7 and 9735, as for any event.
- Collections of maps: [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) sets, or NKBIP-04 directories (kind 30045).
- Apps that open maps announce it with [NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) (kind 31990, `k` = `30627`).
- Kanban boards (NIP-100 draft, kinds 30301/30302) are a different view of tasks; a map node MAY link to a board's `naddr`.

## Why not an existing kind

- **30023 (long-form):** it's for articles; maps would fill readers' blog feeds, and layout would be lost.
- **30078 (app-specific data):** it's for one app's private settings, not documents other apps should read.
- **30040/30041 (publications):** a tree of separate events, made for books; heavy for a 30-node map that's edited as a whole.

## Implementations

- [mindstr](https://mindstr.org): opens maps from `?nostr=naddr1…` (planned) and publishes them from its Share menu (planned).
- [mindstr-maps](https://github.com/melvincarvalho/mindstr-maps): 1,061 CC0 maps in this document format.
