// Shared set-up for the browser tests: a static server for the repo, a headless Chromium,
// and a page that records errors.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonld': 'application/ld+json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown'
}

// Serve the repo on a free port. Resolves to { url, close }.
export function serve() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT.replace(/[\\/]$/, '') + sep) && file !== ROOT) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) })
    )
  )
}

export const launch = () => chromium.launch()

// A new page that collects uncaught errors and console errors in page.errors. Requests to
// other hosts (fonts, the xlogin widget) are blocked, and WebSockets to other hosts (Nostr
// relays) are mocked as relays that never answer, so the tests don't touch the network.
export async function openPage(browser, base, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...options })
  const page = await context.newPage()
  const origin = new URL(base).origin
  const outside = url => new URL(url).origin !== origin
  await page.route('**/*', route => (outside(route.request().url()) ? route.abort() : route.continue()))
  await page.routeWebSocket(url => outside(url.href.replace(/^ws/, 'http')), () => {}) // never connects out
  page.errors = []
  page.on('pageerror', e => page.errors.push(e.stack || e.message))
  page.on('console', m => {
    // the blocked outside requests above each log "Failed to load resource"; anything else counts
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) page.errors.push('console.error: ' + m.text())
  })
  return page
}

// Load a map and wait until it's on screen.
export async function load(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelectorAll('#tree li').length > 0, null, { timeout: 10000 })
  await page.waitForTimeout(300)
}

// The map as the app would save it, via More → Download JSON-LD.
export async function downloadMap(page) {
  await page.click('#menuBtn')
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="json"]')])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
