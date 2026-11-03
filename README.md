# Mindstr

A mind map you own. Mindstr is a single static page: it loads a JSON map
from any URL and saves it back with an HTTP `PUT`, signed with your Nostr key
([NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)).

**Live:** https://mindstr.org

## Use

| URL | What happens |
| --- | --- |
| `https://mindstr.org/` | Scratch map (not saved) |
| `?map=<url>` | Load the map at `<url>`; Ctrl+S saves it back there |
| `?example=<name>` | Open `examples/<name>.json` (read-only) |
| `?title=<text>` | Name the root node of a *new* map |

Press 🔐 to sign in with a NIP-07 extension (nos2x, Alby, …); that opens your
own map at `https://nosdav.net/<pubkey>/mm/index.json`. A hex key in
`localStorage['nostr:privkey']` is used instead of an extension if present.

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
viewer; relative links (`./other.json`) open another map next to this one.
Other schemes are blocked.

## Examples

[welcome](https://mindstr.org/?example=welcome) ·
[solar-system](https://mindstr.org/?example=solar-system) ·
[project-plan](https://mindstr.org/?example=project-plan) ·
[nostr](https://mindstr.org/?example=nostr)

Maps live in [`examples/`](examples/). Add a JSON file there and it's
available as `?example=<file name>`. The bundled ones are generated from
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
- `bgColor`, `link` and any other fields on a node are preserved.
- The current map is also kept in the page's `<script id="initialData">` data island.

## Develop

No build step. Serve the folder (`npx serve .`) and open it. Pushing to
`gh-pages` deploys mindstr.org.

- `index.html`: markup and styles
- `js/app.js`: canvas, interaction, load/save
- `js/nostr-auth.js`: NIP-07 / local-key signing and NIP-98 `authFetch`
- `scripts/build-examples.js`: regenerates `examples/` (Node, no dependencies)

MIT licensed.
