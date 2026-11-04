# Mindstr

[![Mind map](https://mindstr.org/badge.svg)](https://mindstr.org/?uri=https://mindstr.org/mindstr/index.jsonld)

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

### Live editing

When the server advertises `Updates-Via` (JSS does with `--notifications`),
mindstr subscribes to the map and shows **· live**. Changes saved by anyone
else appear straight away. If you have unsaved edits you get a choice instead:
**Load theirs** or **Keep mine**. Saves send `If-Match`, so nobody silently
overwrites a newer version.

### Using it

| Do | How |
| --- | --- |
| Add a child / sibling | Tab / Enter (or the toolbar) |
| Rename | Double-click, double-tap or F2 |
| Move a branch | Drag it (Alt-drag moves one node) |
| Re-parent | Drop a node onto another |
| Fold a branch | Space, or click the round badge |
| Tidy the layout | L |
| Find | Ctrl+F |
| Link | Ctrl+K to set, click ↗ or O to open |
| Copy / paste | Ctrl+C copies a branch as an outline; Ctrl+V pastes branches or any Markdown/indented list |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Pan / zoom | Scroll or drag; pinch, Ctrl+scroll or the + − buttons |
| Export | ⋯ menu: PNG image, Markdown outline, JSON-LD |
| Save | Ctrl+S. Scratch maps and examples are saved as a new map in your pod |

Scratch maps (no `?uri=`) are kept in your browser until you save them.

Links: `http(s)` URLs open in a new tab; `.md` files open in the NosDAV doc
viewer; relative links (`./other.json`) open another map next to this one via `?uri=`.
Other schemes are blocked.

## Make a map from a topic

[mindstr.org/make](https://mindstr.org/make/): type a topic and watch Claude build the map as its
outline streams in. Runs in your browser with your own API key (kept in localStorage, sent only to
api.anthropic.com). Click a leaf to grow it; copy or download the JSON-LD; the status line shows
tokens and cost. Settings: depth, breadth, model, style, language, thinking, links.

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

A map is one JSON / JSON-LD document. The format (versions 0.1 and 0.2, field rules,
content types and compatibility) is specified in **[SPEC.md](SPEC.md)**. The app reads
both versions, saves existing maps in the version they came in, and creates new maps as
0.2. The current map is also mirrored in the page's `<script id="initialData">` data
island.

## Maps for a repo

Any repo or site can carry its own mind maps. The convention, used across 30+ repos:

- `/mindstr/index.jsonld` is the entry map; child maps sit beside it with relative links,
  and `outline.md` is the whole set as one nested Markdown list for people and LLMs.
- Open it at `https://mindstr.org/?uri=<site>/mindstr/index.jsonld`.
- The repo gets the GitHub topic `mindstr`, so https://github.com/topics/mindstr lists every
  repo with maps, and a badge in its README:

  ```markdown
  [![Mind map](https://mindstr.org/badge.svg)](https://mindstr.org/?uri=https://example.org/mindstr/index.jsonld)
  ```
- An org gets a `mindstr` repo whose map links to each repo's folder
  (for example https://jss.live/mindstr/).

What a repo map holds: what the project is (README sections, docs, specs, a roadmap when
there is one), what is there (source tree with exports, CLI commands from `--help`, examples,
chapters), and what is in flight (open PRs, open issues by label). No commit logs. Maps keep
to about 30 nodes, no fan wider than 7, one hue per branch; anything bigger is a child map,
marked with `›`. The generator lives in cos (`cos maps <set>`); the rules and their sources
are in its `mindstr/research.md`.

## For agents

[`SKILL.md`](SKILL.md) tells LLMs how to create and edit maps: the document
shape, where maps live on a pod, safe concurrent edits and layout. When mindstr
is installed in a JSS pod with `--mcp`, it is discoverable via `list_skills`.

## Develop

No build step. Serve the folder (`npx serve .`) and open it. Pushing to
`gh-pages` deploys mindstr.org.

- `index.html`: markup and styles
- `js/app.js`: canvas, interaction, load/save
- `js/pod.js`: xlogin sign-in, `authFetch`, and finding your pod / default map
- `js/live.js`: solid-0.1 WebSocket notifications
- `scripts/build-examples.js`: regenerates `examples/` (Node, no dependencies)
- `scripts/social-card.html`: source of `social-card.png`; open at 1200×630 and screenshot

MIT licensed.
