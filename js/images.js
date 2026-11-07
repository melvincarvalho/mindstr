// Images on nodes (SPEC.md, #31): turning a node's `image` into something the canvas can draw.
// No DOM needed except what `create` makes, so this runs in Node for the tests.

// A node's `image` as an absolute web address, or null. Relative references resolve against the
// map's own URL, as links do.
export function imageUrl(raw, base) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw.trim(), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const NONE = Object.freeze({ status: 'failed', img: null, exportable: false })

// Loads each address once. get(raw) → { status: 'loading' | 'ready' | 'failed', img, exportable }.
//
// A cross-origin image served without CORS headers can be shown, but drawing it stops the canvas
// being exported. So ask for CORS first, and if that fails, load it again for display only.
export function makeImages({ base, onChange = () => {}, create = () => new Image() }) {
  const cache = new Map()
  const load = (url, entry, cors) => {
    const img = create()
    img.referrerPolicy = 'no-referrer'
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => {
      Object.assign(entry, { status: 'ready', img, exportable: cors })
      onChange()
    }
    img.onerror = () => {
      if (cors) return load(url, entry, false)
      entry.status = 'failed'
      onChange()
    }
    img.src = url
  }
  return {
    get(raw) {
      const url = imageUrl(raw, base())
      if (!url) return NONE
      let entry = cache.get(url)
      if (!entry) {
        entry = { status: 'loading', img: null, exportable: false }
        cache.set(url, entry)
        load(url, entry, true)
      }
      return entry
    }
  }
}
