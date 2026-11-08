// Ready-made maps (#45): before building a map with Claude, look for one already made. A cache is
// any web folder with a lookup.json (or an index.json) whose `lookup` maps a slug to a file, and the
// map files, served with CORS, like https://github.com/melvincarvalho/mindstr-maps on GitHub Pages.
//
//   no ?cache              → ours
//   ?cache=URL[,URL…]      → those, checked in order
//   ?cache=off             → none: always build

export const DEFAULT_CACHE = 'https://melvincarvalho.github.io/mindstr-maps/'

// A search as a file name: lower case, accents dropped, anything between words one hyphen.
// The same rule as mindstr-maps' build.js. "Plan a Trip to Japan!" → plan-a-trip-to-japan
export const slug = text =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// The caches a ?cache= value names (http and https only), or ours when there's no value.
export function cachesFrom(value) {
  if (value === null || value === undefined) return [DEFAULT_CACHE]
  if (/^\s*(off|none|false|0)?\s*$/i.test(value)) return []
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s))
    .map(s => (s.endsWith('/') ? s : s + '/'))
}

// The first cache that has this topic: { url, source } or null. A cache that's down, slow or
// malformed is skipped, so a miss never costs more than a short wait.
export async function findCached(topic, caches, { timeout = 2500, fetchFn = fetch } = {}) {
  const key = slug(topic)
  if (!key) return null
  for (const base of caches) {
    const lookup = await lookupOf(base, timeout, fetchFn)
    const file = lookup?.[key]
    if (typeof file === 'string' && file) return { url: new URL(file, base).href, source: base }
  }
  return null
}

// A cache's lookup: the small lookup.json if it has one, else the full index.json
async function lookupOf(base, timeout, fetchFn) {
  for (const name of ['lookup.json', 'index.json']) {
    try {
      const res = await fetchFn(new URL(name, base).href, { signal: AbortSignal.timeout(timeout) })
      if (res.ok) return (await res.json())?.lookup
    } catch {
      return null // down or slow: skip this cache rather than wait twice
    }
  }
  return null
}

// A cache's directory page (mindstr-maps has one at its root), opening maps back in this app
export function directoryUrl(base, appBase) {
  const u = new URL(base)
  if (appBase !== 'https://mindstr.org/') u.searchParams.set('app', appBase)
  return u.href
}

// Where a cache lives, for people: "melvincarvalho.github.io/mindstr-maps"
export const cacheName = base => base.replace(/^https?:\/\//, '').replace(/\/$/, '')

// The app link that opens a ready-made map growing from its root, keeping any ?cache= choice.
export function openUrl(appBase, hit, cacheParam) {
  return `${appBase}?uri=${hit.url}&replay=1s` + (cacheParam !== null && cacheParam !== undefined ? `&cache=${encodeURIComponent(cacheParam)}` : '')
}
