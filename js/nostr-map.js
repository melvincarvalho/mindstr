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

// True when the event's id is the hash of its contents (NIP-01)
export async function idMatches(event) {
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))
  return hex(new Uint8Array(digest)) === event.id
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
