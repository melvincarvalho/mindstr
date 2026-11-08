// Sounds (#34): a pop when a node arrives, a chime when a map is complete, and a remembered
// on/off switch in the ⋯ menu. A fake AudioContext counts the notes instead of playing them.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { launch, load, openPage, serve } from './helpers.js'

let server
let browser
before(async () => {
  server = await serve()
  browser = await launch()
})
after(async () => {
  await browser?.close()
  await server?.close()
})

const fakeAudio = () => {
  window.notes = []
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  window.AudioContext = class {
    state = 'running'
    destination = {}
    get currentTime() {
      return performance.now() / 1000
    }
    resume() {
      return Promise.resolve()
    }
    createGain() {
      return { gain: param, connect: d => d }
    }
    createOscillator() {
      const osc = { frequency: param, connect: d => d, start: () => window.notes.push(osc), stop() {} }
      return osc
    }
  }
}

test('pop plays one note, a burst still one, and chime two', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(fakeAudio)
  await load(page, server.url)
  const counts = await page.evaluate(async () => {
    const s = await import('./js/sound.js')
    s.unlock()
    s.pop(2)
    s.pop(3) // same instant: merged into the first
    const afterPops = window.notes.length
    await new Promise(r => setTimeout(r, 120))
    s.chime()
    return { afterPops, total: window.notes.length }
  })
  assert.deepEqual(counts, { afterPops: 1, total: 3 })
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('Sound in the ⋯ menu turns sounds off, and it is remembered', async () => {
  const page = await openPage(browser, server.url)
  await page.addInitScript(fakeAudio)
  await load(page, server.url)
  const label = () => page.locator('#menu [data-action=sound] span').textContent()
  assert.equal(await label(), 'Sound: on')
  await page.click('#menuBtn')
  await page.click('[data-action="sound"]')
  assert.equal(await label(), 'Sound: off')
  const silent = await page.evaluate(async () => {
    const s = await import('./js/sound.js')
    s.unlock()
    s.pop(0)
    return window.notes.length
  })
  assert.equal(silent, 0)
  await load(page, server.url)
  assert.equal(await label(), 'Sound: off')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})
