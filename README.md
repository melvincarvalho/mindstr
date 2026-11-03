# Mindstr

A mind map you own. Mindstr is a single static page: it loads a JSON or
JSON-LD map from any URL and saves it back to your Solid pod with an HTTP
`PUT`. Sign-in is [xlogin](https://github.com/melvincarvalho/xlogin): Nostr
([NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)) or Solid
(OIDC + DPoP). Built for [JSS](https://jss.live) pods.

**Live:** https://mindstr.org

## Use

| URL | What happens |
| --- | --- |
| `https://mindstr.org/` | Scratch map (not saved) |
| `?uri=<url>` | Open the `.json` / `.jsonld` map at `<url>` (absolute, or relative to the app); Ctrl+S saves it back there |
| `?title=<text>` | Name the root node of a *new* map |

For example `?uri=examples/welcome.json` or
`?uri=https://nosdav.net/<pubkey>/mm/index.jsonld`. Older links keep working:
`?map=<url>` is an alias for `?uri=`, and `?example=welcome` is short for
`?uri=examples/welcome.json`.

### Your map

Press 🏠 (or the xlogin button) to sign in. Your map lives at
`public/mindstr/index.jsonld` in the root of your pod, so it's readable by
anyone you share the link with and writable only by you:

| Where mindstr runs | Your pod |
| --- | --- |
| Installed in a pod (`jss install melvincarvalho/mindstr=mindstr` → `<pod>/public/apps/mindstr/`) | That pod; opening the app goes straight to your map |
| mindstr.org, signed in with Solid | The `pim:storage` in your WebID profile |
| mindstr.org, signed in with Nostr | `https://nosdav.net/<pubkey>/` |

If a map can't be loaded, saving is disabled so the original isn't overwritten.
A 404 is treated as a new map.

### Shortcuts

| Key | Action |
| --- | --- |
| Tab / Insert | Add child |
| Enter | Add sibling |
| F2 / double-click / double-tap | Rename |
| Delete | Delete node (its children move up to its parent) |
| Ctrl+K | Set link |
| O / click link text | Open link |
| Arrows | Move selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Save |
| F, +, −, wheel, pinch | Fit / zoom |

Links: `http(s)` URLs open in a new tab; `.md` files open in the NosDAV doc
viewer; relative links (`./other.json`) open another map next to this one via `?uri=`.
Other schemes are blocked.

## Examples

[welcome](https://mindstr.org/?uri=examples/welcome.json) ·
[solar-system](https://mindstr.org/?uri=examples/solar-system.json) ·
[project-plan](https://mindstr.org/?uri=examples/project-plan.json) ·
[nostr](https://mindstr.org/?uri=examples/nostr.json)

Maps live in [`examples/`](examples/). Add a JSON file there and open it
with `?uri=examples/<file>.json`. The bundled ones are generated from
outlines in `scripts/build-examples.js` (`node scripts/build-examples.js`). Maps served from mindstr.org itself are
read-only.

## Data format

```json
{
  "version": "0.1",
  "nodes": [
    { "@id": "#this", "name": "Root", "x": 0, "y": 0, "bgColor": "#FFD6E8" },
    { "@id": "#k3x9q2", "name": "Child", "x": 170, "y": 0, "link": "./child.json" }
  ],
  "connections": [{ "start": 0, "end": 1 }],
  "selectedNode": 1
}
```

- `nodes[0]` is the root and always has `@id` `#this`.
- `connections` refer to nodes by array index.
- `bgColor`, `link` and any other fields on a node are preserved, as are
  extra top-level fields such as a JSON-LD `@context`. `.jsonld` maps are
  saved as `application/ld+json`.
- The current map is also kept in the page's `<script id="initialData">` data island.

## Develop

No build step. Serve the folder (`npx serve .`) and open it. Pushing to
`gh-pages` deploys mindstr.org.

- `index.html`: markup and styles
- `js/app.js`: canvas, interaction, load/save
- `js/pod.js`: xlogin sign-in, `authFetch`, and finding your pod / default map
- `scripts/build-examples.js`: regenerates `examples/` (Node, no dependencies)

MIT licensed.
