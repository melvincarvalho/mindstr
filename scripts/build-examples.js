#!/usr/bin/env node
// Builds examples/*.json from the outlines below, laying nodes out radially.
// Usage: node scripts/build-examples.js

import { writeFileSync } from 'node:fs'

const OUT = new URL('../examples/', import.meta.url)

// Seeded PRNG so node ids are stable between runs.
let seed = 7
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const newId = () =>
  '#' + Array.from({ length: 6 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('')

// N(label, extraFields?, ...children)
const N = (name, extra = {}, ...kids) => ({ name, extra, kids })

const leaves = t => Math.max(1, t.kids.reduce((s, k) => s + leaves(k), 0))

function build(file, tree) {
  const nodes = []
  const connections = []
  const add = (t, parent, a0, a1, depth, nth = 0) => {
    const mid = (a0 + a1) / 2
    const r =
      depth === 0 ? 0 : 230 + (depth - 1) * 220
    nodes.push({
      '@id': depth === 0 ? '#this' : newId(),
      name: t.name,
      x: Math.round(r * Math.cos(mid)),
      y: Math.round(r * Math.sin(mid) * 0.8),
      ...t.extra
    })
    const i = nodes.length - 1
    if (parent !== null) connections.push({ start: parent, end: i })
    const total = t.kids.reduce((s, k) => s + leaves(k), 0)
    let a = a0
    t.kids.forEach((k, j) => {
      const span = ((a1 - a0) * leaves(k)) / total
      add(k, i, a, a + span, depth + 1, j)
      a += span
    })
  }
  add(tree, null, -Math.PI, Math.PI, 0)
  // settle overlaps using rendered sizes (≈ 8.5px per character + padding, 18px for a link icon)
  const w = n => Math.max(8.5 * [...n.name].length + 40 + (n.link ? 18 : 0), 56)
  const clash = (a, b) => Math.abs(a.x - b.x) < (w(a) + w(b)) / 2 + 24 && Math.abs(a.y - b.y) < 36 + 12
  nodes.forEach((n, i) => {
    const a = Math.atan2(n.y / 0.8, n.x)
    for (let t = 0; i > 0 && t < 60 && nodes.slice(0, i).some(m => clash(n, m)); t++) {
      n.x = Math.round(n.x + 20 * Math.cos(a))
      n.y = Math.round(n.y + 16 * Math.sin(a))
    }
  })
  // 0.2 (see SPEC.md): a JSON-LD context and parent links alongside connections
  for (const { start, end } of connections) nodes[end].parent = nodes[start]['@id']
  const data = {
    '@context': { '@vocab': 'https://mindstr.org/ns#', link: { '@type': '@id' }, parent: { '@type': '@id' } },
    version: '0.2',
    nodes,
    connections,
    selectedNode: 0
  }
  writeFileSync(new URL(file + '.json', OUT), JSON.stringify(data, null, 2) + '\n')
  console.log(`${file}.json  ${nodes.length} nodes`)
}

const P = '#FFD6E8', B = '#D6E8FF', G = '#D9F2DC', Y = '#FFF3C4', O = '#FFE1CC'
const back = N('← Back to welcome', { link: './welcome.json' })
const nip = n => ({ link: `https://github.com/nostr-protocol/nips/blob/master/${n}.md` })

build('welcome', N('Welcome to Mindstr', {},
  N('Add ideas', { bgColor: B },
    N('Tab: add a child'), N('Enter: add a sibling'), N('Double-click: rename'), N('Paste a list: adds a branch')),
  N('Arrange', { bgColor: G },
    N('Drag a branch to move it'), N('Drop on a node to re-parent'), N('Space folds a branch'), N('L tidies the layout')),
  N('Get around', { bgColor: O },
    N('Scroll or drag to pan'), N('Pinch or Ctrl+scroll to zoom'), N('Ctrl+F finds anything')),
  N('Links', { bgColor: '#D4F1F4' },
    N('Ctrl+K sets a link'), N('Click ↗ to open it'), N('./other.json opens a map')),
  N('Keep it', { bgColor: P },
    N('Save stores it in your pod'), N('Sign in with Nostr or Solid'), N('Edits sync live')),
  N('More examples', { bgColor: '#E6E0FF' },
    N('Solar system', { link: './solar-system.json' }),
    N('Plan a project', { link: './project-plan.json' }),
    N('Learn Nostr', { link: './nostr.json' }))))

build('solar-system', N('Sun', {},
  N('Inner planets', { bgColor: O },
    N('Mercury'), N('Venus'), N('Earth', { bgColor: B }, N('Moon')), N('Mars', {}, N('Phobos'), N('Deimos'))),
  N('Asteroid belt', {}, N('Ceres'), N('Vesta')),
  N('Outer planets', { bgColor: B },
    N('Jupiter', {}, N('Io'), N('Europa'), N('Ganymede'), N('Callisto')),
    N('Saturn', {}, N('Titan'), N('Enceladus')),
    N('Uranus'), N('Neptune', {}, N('Triton'))),
  N('Beyond', { bgColor: '#E6E0FF' },
    N('Kuiper belt', {}, N('Pluto')), N('Oort cloud')),
  back))

build('project-plan', N('Launch a website', {},
  N('Goals', { bgColor: G }, N('Who is it for?'), N('What should they do?'), N('How will we measure it?')),
  N('Content', { bgColor: B }, N('Home page'), N('About'), N('Blog', {}, N('First three posts')), N('Contact')),
  N('Build', { bgColor: O }, N('Pick a static host'), N('Design'), N('Accessibility check'), N('Performance check')),
  N('Launch', { bgColor: P }, N('Domain + HTTPS'), N('Announce'), N('Collect feedback')),
  N('Risks', {}, N('Scope creep'), N('Content late')),
  back))

build('nostr', N('Nostr', {},
  N('Keys', { bgColor: Y }, N('Private key signs'), N('Public key = identity'), N('NIP-19: npub / nsec', nip('19'))),
  N('Events', { bgColor: B }, N('NIP-01: the protocol', nip('01')), N('kind 0: profile'), N('kind 1: note'), N('id = sha256 of content'), N('sig = schnorr')),
  N('Relays', { bgColor: G }, N('Store and forward events'), N('Pick your own'), N('NIP-65: relay lists', nip('65'))),
  N('Clients', { bgColor: O }, N('NIP-07: browser signer', nip('07')), N('Many apps, one identity')),
  N('Beyond notes', { bgColor: P }, N('NIP-98: HTTP auth', nip('98')), N('Mindstr saves with NIP-98')),
  back))
