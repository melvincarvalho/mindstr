// Identity and storage, following the solid-apps conventions:
// - xlogin (https://github.com/melvincarvalho/xlogin) handles sign-in for both
//   Nostr (NIP-98) and Solid (DPoP) and gives us authFetch.
// - When mindstr is installed into a JSS pod (`jss install`, served from
//   <pod>/public/apps/<name>/), that pod is the storage.
// - Otherwise Solid users use the storage from their WebID profile and Nostr
//   users their folder on NOSTR_HOST.

export const MAP_PATH = 'public/mindstr/index.jsonld'
const NOSTR_HOST = 'https://nosdav.net/'

export const authFetch = (url, options) =>
  window.xlogin?.authFetch ? window.xlogin.authFetch(url, options) : fetch(url, options)

export const identity = () =>
  window.xlogin?.id ? { type: window.xlogin.type, id: window.xlogin.id } : null

export const ready = () =>
  Promise.race([
    window.xlogin?.ready ?? Promise.resolve(),
    new Promise(r => setTimeout(r, 3000))
  ]).catch(() => {})

export function login() {
  if (typeof window.xlogin?.login !== 'function') return false
  window.xlogin.login()
  return true
}

// Root of the pod this copy of mindstr is installed in, if any.
export const hostPod = (() => {
  const m = location.pathname.match(/^(.*\/)public\/apps\/[^/]+\//)
  return m ? location.origin + m[1] : null
})()

const slash = u => (u.endsWith('/') ? u : u + '/')

function findStorage(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return null
  seen.add(node)
  for (const [k, v] of Object.entries(node)) {
    if (/(^|[:#/])storage$/.test(k)) {
      const first = Array.isArray(v) ? v[0] : v
      const id = typeof first === 'string' ? first : first?.['@id']
      if (id) return id
    }
  }
  for (const v of Object.values(node)) {
    const found = findStorage(v, seen)
    if (found) return found
  }
  return null
}

// pim:storage from a WebID profile (JSON-LD or Turtle), else a best guess.
async function solidStorage(webId) {
  try {
    const res = await authFetch(webId, {
      headers: { Accept: 'application/ld+json, text/turtle;q=0.9' }
    })
    const text = await res.text()
    let storage = null
    try {
      storage = findStorage(JSON.parse(text))
    } catch {
      storage = text.match(
        /(?:pim:storage|space:storage|<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>)\s+<([^>]*)>/
      )?.[1]
    }
    if (storage) return slash(new URL(storage, webId).href)
  } catch {}
  const u = new URL(webId)
  return u.pathname.includes('/profile/') ? new URL('../', u).href : u.origin + '/'
}

// URL of the signed-in user's default map, or null if we can't tell yet.
export async function myMapUrl() {
  if (hostPod) return hostPod + MAP_PATH
  const who = identity()
  if (!who) return null
  if (who.type === 'nostr') return `${NOSTR_HOST}${who.id}/${MAP_PATH}`
  if (who.type === 'solid') return (await solidStorage(who.id)) + MAP_PATH
  return null
}
