// Colour helpers: branch palette, dark-mode variants and readable text.

// Pastels for top-level branches, used when a branch has no bgColor of its own.
export const BRANCH_COLORS = ['#D6E8FF', '#D9F2DC', '#FFD6E8', '#FFE1CC', '#E6E0FF', '#D4F1F4', '#FFF1B8', '#E3E8EF']

const probe = document.createElement('canvas').getContext('2d')
const cache = new Map()

// Any CSS colour → [r, g, b] (0–255).
export function toRgb(color) {
  if (cache.has(color)) return cache.get(color)
  probe.fillStyle = '#000'
  probe.fillStyle = color
  const v = probe.fillStyle
  let rgb
  if (v[0] === '#') {
    const n = parseInt(v.slice(1, 7), 16)
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  } else {
    rgb = (v.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number)
  }
  cache.set(color, rgb)
  return rgb
}

function rgbToHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
const hsla = (h, s, l, a) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}% / ${a})`

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// Dark or light text, whichever reads better on `fill`.
export function readableText(fill) {
  return contrast(fill, '#1b1f27') >= contrast(fill, '#f4f5f8') ? '#1b1f27' : '#f4f5f8'
}

// Fill, border and edge colours for a branch colour in the current theme.
export function tones(color, dark) {
  const [h, s0, l0] = rgbToHsl(toRgb(color))
  const s = s0 < 8 ? 0 : Math.max(s0, 45)
  return dark
    ? {
        fill: hsl(h, s * 0.45, 21),
        fillHi: hsl(h, s * 0.5, 26),
        fillLo: hsl(h, s * 0.48, 18),
        border: hsla(h, s * 0.7, 68, 0.72),
        edge: hsl(h, s * 0.75, 66),
        glow: hsla(h, s * 0.8, 58, 0.2),
        tint: hsl(h, s * 0.4, 17)
      }
    : {
        fill: color,
        fillHi: hsl(h, s * 0.85, Math.min(98, l0 + 3)),
        fillLo: hsl(h, s === 0 ? 0 : Math.max(s * 0.8, 40), Math.max(30, l0 - 3)),
        border: hsla(h, s * 0.6, 48, 0.58),
        edge: hsl(h, s * 0.65, 44),
        glow: hsla(h, s * 0.8, 52, 0.16),
        tint: hsl(h, s, 97)
      }
}
