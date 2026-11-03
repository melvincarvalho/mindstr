// Nostr identity + NIP-98 HTTP auth.
// Signs with a NIP-07 extension (window.nostr), or with a hex key in
// localStorage['nostr:privkey'] if one has been set.

const SECP_URL = 'https://cdn.jsdelivr.net/npm/@noble/secp256k1@1.7.1/+esm'
const enc = new TextEncoder()
let secpPromise

const secp = () => (secpPromise ??= import(SECP_URL))
const toHex = bytes =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(str) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)))
  )
}

function storedPrivkey() {
  try {
    const sk = localStorage.getItem('nostr:privkey')
    return sk && /^[0-9a-f]{64}$/i.test(sk.trim()) ? sk.trim() : null
  } catch {
    return null
  }
}

export function hasSigner() {
  return Boolean(storedPrivkey() || window.nostr)
}

export async function getPubkey() {
  const sk = storedPrivkey()
  if (sk) return toHex((await secp()).schnorr.getPublicKey(sk))
  if (window.nostr) return window.nostr.getPublicKey()
  return null
}

export async function signEvent(event) {
  const sk = storedPrivkey()
  if (sk) {
    const s = await secp()
    const pubkey = toHex(s.schnorr.getPublicKey(sk))
    const ev = { ...event, pubkey }
    const id = await sha256Hex(
      JSON.stringify([0, pubkey, ev.created_at, ev.kind, ev.tags, ev.content])
    )
    const sig = toHex(await s.schnorr.sign(id, sk))
    return { ...ev, id, sig }
  }
  if (window.nostr) return window.nostr.signEvent(event)
  return null
}

// fetch() with a NIP-98 Authorization header when a signer is available.
export async function authFetch(url, options = {}) {
  const absolute = new URL(url, location.href).href
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers)
  const signed = await signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', absolute],
      ['method', method]
    ],
    content: ''
  })
  if (signed) {
    headers.set('Authorization', 'Nostr ' + btoa(JSON.stringify(signed)))
  }
  return fetch(absolute, { ...options, headers })
}
