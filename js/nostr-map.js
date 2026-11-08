// Mind maps on Nostr (kind 30627, docs/nip-mindmap.md): ?nostr=naddr1… opens a map from relays.
// Decoding, fetching and checking are here; app.js opens the map like any other.

export const MAP_KIND = 30627
// Used when the naddr names no relays
export const DEFAULT_RELAYS = ['wss://relay.ditto.pub', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
// Signature checking, loaded only when a Nostr map is opened (a pinned version)
const NOBLE = 'https://cdn.jsdelivr.net/npm/@noble/curves@1.9.7/secp256k1/+esm'

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')

function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i]
  }
  return chk
}

// naddr1… (NIP-19) → { kind, pubkey, d, relays }. Throws on anything malformed.
export function decodeNaddr(input) {
  const s = String(input || '').trim().toLowerCase().replace(/^nostr:/, '')
  const sep = s.lastIndexOf('1')
  const hrp = s.slice(0, sep)
  if (hrp !== 'naddr' || s.length < 20) throw new Error('not an naddr link')
  const words = [...s.slice(sep + 1)].map(c => CHARSET.indexOf(c))
  if (words.some(w => w < 0)) throw new Error('not an naddr link')
  const expanded = [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)]
  if (polymod([...expanded, ...words]) !== 1) throw new Error('the naddr link is damaged (checksum)')
  const bytes = []
  let acc = 0
  let bits = 0
  for (const w of words.slice(0, -6)) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 255)
    }
  }
  const out = { relays: [] }
  for (let i = 0; i + 1 < bytes.length; ) {
    const type = bytes[i]
    const len = bytes[i + 1]
    const value = bytes.slice(i + 2, i + 2 + len)
    if (type === 0) out.d = new TextDecoder().decode(new Uint8Array(value))
    if (type === 1) out.relays.push(new TextDecoder().decode(new Uint8Array(value)))
    if (type === 2 && len === 32) out.pubkey = hex(value)
    if (type === 3 && len === 4) out.kind = ((value[0] << 24) | (value[1] << 16) | (value[2] << 8) | value[3]) >>> 0
    i += 2 + len
  }
  if (out.d === undefined || !out.pubkey || out.kind === undefined) throw new Error('the naddr link is incomplete')
  return out
}

// Ask each relay for the event; the newest answer wins. Never waits longer than `timeout`.
export function fetchLatest(relays, filter, { timeout = 6000, WebSocketImpl = globalThis.WebSocket } = {}) {
  return new Promise(resolve => {
    let best = null
    let pending = relays.length
    if (!pending) return resolve(null)
    const done = () => --pending === 0 && finish()
    const sockets = []
    const finish = () => {
      clearTimeout(timer)
      sockets.forEach(ws => { try { ws.close() } catch {} })
      resolve(best)
    }
    const timer = setTimeout(finish, timeout)
    for (const url of relays) {
      let ws
      try {
        ws = new WebSocketImpl(url)
      } catch {
        done()
        continue
      }
      sockets.push(ws)
      let closed = false
      const end = () => !closed && (closed = true, done())
      ws.onopen = () => ws.send(JSON.stringify(['REQ', 'map', filter]))
      ws.onmessage = msg => {
        let m
        try { m = JSON.parse(msg.data) } catch { return }
        if (m[0] === 'EVENT' && m[2] && (!best || m[2].created_at > best.created_at)) best = m[2]
        if (m[0] === 'EOSE' || m[0] === 'CLOSED') end()
      }
      ws.onerror = end
      ws.onclose = end
    }
  })
}

// SHA-256 in plain JS, for pages that aren't a secure context (a pod on the LAN over plain http
// has no crypto.subtle). FIPS 180-4, bytes in, bytes out.
export function sha256(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const len = bytes.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[len] = 0x80
  const bits = len * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32))
  view.setUint32(padded.length - 4, bits >>> 0)
  const W = new Uint32Array(64)
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h
  }
  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  H.forEach((x, i) => ov.setUint32(i * 4, x))
  return out
}

// True when the event's id is the hash of its contents (NIP-01)
export async function idMatches(event) {
  const serial = new TextEncoder().encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
  const digest = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', serial)) : sha256(serial)
  return hex(digest) === event.id
}

// true or false when the signature could be checked, null when the checker couldn't load
export async function signatureValid(event, load = () => import(NOBLE)) {
  try {
    const { schnorr } = await load()
    return schnorr.verify(event.sig, event.id, event.pubkey)
  } catch {
    return null
  }
}

const tag = (event, name) => (event.tags.find(t => t[0] === name) || [])[1]

// naddr → { data, event, signature } where data is the map document, ready for normalize().
// Throws an Error whose message can be shown to the person.
export async function loadMapEvent(naddr, opts = {}) {
  const addr = decodeNaddr(naddr)
  if (addr.kind !== MAP_KIND) throw new Error(`that link is a kind ${addr.kind} event, not a mind map (${MAP_KIND})`)
  const relays = addr.relays.length ? addr.relays : DEFAULT_RELAYS
  const event = await fetchLatest(relays, { kinds: [MAP_KIND], authors: [addr.pubkey], '#d': [addr.d], limit: 1 }, opts)
  if (!event) throw new Error(`no relay had this map (asked ${relays.length})`)
  if (event.pubkey !== addr.pubkey || event.kind !== MAP_KIND || tag(event, 'd') !== addr.d) throw new Error('a relay sent a different event')
  if (!(await idMatches(event))) throw new Error('the map event was altered (its id does not match)')
  const signature = await signatureValid(event, opts.loadVerifier)
  if (signature === false) throw new Error('the map event has a bad signature')
  let data
  try {
    data = JSON.parse(event.content)
  } catch {
    throw new Error('the map event does not contain a map')
  }
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) throw new Error('the map event does not contain a map')
  return { data, event, signature, title: tag(event, 'title') || data.nodes[0]?.name }
}

// ---------- publishing (kind 30627) ----------

// Relays a published map goes to, and that its link names
export const PUBLISH_RELAYS = ['wss://relay.ditto.pub', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io']
// strfry's default event limit; most relays allow 64–128 KB
export const MAX_EVENT_BYTES = 65536

const toWords = bytes => {
  const out = []
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >> bits) & 31)
    }
  }
  if (bits) out.push((acc << (5 - bits)) & 31)
  return out
}

// { kind, pubkey, d, relays } → naddr1… (NIP-19)
export function encodeNaddr({ kind, pubkey, d, relays = [] }) {
  const enc = new TextEncoder()
  const tlv = (type, bytes) => [type, bytes.length, ...bytes]
  const pk = pubkey.match(/../g).map(h => parseInt(h, 16))
  const bytes = [
    ...tlv(0, enc.encode(d)),
    ...relays.flatMap(r => tlv(1, enc.encode(r))),
    ...tlv(2, pk),
    ...tlv(3, [(kind >>> 24) & 255, (kind >> 16) & 255, (kind >> 8) & 255, kind & 255])
  ]
  const hrp = 'naddr'
  const words = toWords(bytes)
  const expanded = [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)]
  const pm = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const checksum = [0, 1, 2, 3, 4, 5].map(i => (pm >> (5 * (5 - i))) & 31)
  return hrp + '1' + [...words, ...checksum].map(w => CHARSET[w]).join('')
}

// The unsigned event for a map (see docs/nip-mindmap.md). `from` is the event the map was opened
// from, if any: the same author keeps its `d` (an update); anyone else's becomes a fork.
export function mapEventTemplate(doc, { d, pubkey, from = null, url = null } = {}) {
  const title = doc.nodes[0]?.name || 'Mind map'
  const tags = [
    ['d', d],
    ['title', title],
    ['alt', `Mind map: ${title} (${doc.nodes.length} ideas). Open it in a mind map app.`],
    ['t', 'mindmap']
  ]
  if (from && from.pubkey !== pubkey) {
    const fromD = tag(from, 'd')
    tags.push(['a', `${MAP_KIND}:${from.pubkey}:${fromD}`, '', 'fork'])
  }
  if (url && /^https?:\/\//.test(url)) tags.push(['r', url])
  return { kind: MAP_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(doc) }
}

// Send a signed event to each relay: [{ relay, ok, message }], never waiting longer than `timeout`
export function publishEvent(relays, event, { timeout = 8000, WebSocketImpl = globalThis.WebSocket } = {}) {
  return Promise.all(relays.map(relay => new Promise(resolve => {
    let ws
    const finish = (ok, message) => {
      clearTimeout(timer)
      try { ws?.close() } catch {}
      resolve({ relay, ok, message })
    }
    const timer = setTimeout(() => finish(false, 'no answer'), timeout)
    try {
      ws = new WebSocketImpl(relay)
    } catch {
      return finish(false, 'could not connect')
    }
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]))
    ws.onmessage = msg => {
      let m
      try { m = JSON.parse(msg.data) } catch { return }
      if (m[0] === 'OK' && m[1] === event.id) finish(Boolean(m[2]), m[3] || '')
    }
    ws.onerror = () => finish(false, 'could not connect')
  })))
}
