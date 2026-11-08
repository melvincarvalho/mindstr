// Small sounds, made in the browser with Web Audio (no files): a soft pop when a node arrives from
// elsewhere, and a short two-note chime when a map is complete. Short, dry and quiet, with a little
// variation so twenty in a row don't grate. Browsers only allow sound after a click or key press on
// the page, so unlock() is called from those.

const KEY = 'mindstr.sound'
// A pentatonic scale: any two branches sound fine one after the other.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66]
let ctx = null
let last = -1

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSound(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // private window: it just isn't remembered
  }
}

// From a click or key press: create or resume the audio context while the browser allows it.
export function unlock() {
  if (typeof AudioContext === 'undefined') return
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
}

// True when sound is on but the browser hasn't allowed it yet (no click on the page so far).
export const blocked = () => soundOn() && (!ctx || ctx.state !== 'running')

const ready = () => soundOn() && ctx && ctx.state === 'running'

function tone(freq, at, dur, gain) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, at)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.82, at + dur) // the slight drop makes it a pop, not a beep
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(amp).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

// One node arrived: a ~100 ms pop, its note set by the branch, nudged a little each time.
// Several in a burst make one sound.
export function pop(branch = 0) {
  if (!ready()) return
  const now = ctx.currentTime
  if (now - last < 0.08) return
  last = now
  const note = SCALE[((branch % SCALE.length) + SCALE.length) % SCALE.length]
  tone(note * (1 + (Math.random() - 0.5) * 0.03), now, 0.1, 0.1 * (0.9 + Math.random() * 0.2))
}

// The map is complete: a rising two-note chime, ~400 ms.
export function chime() {
  if (!ready()) return
  const now = ctx.currentTime
  last = now
  tone(659.25, now, 0.22, 0.1)
  tone(987.77, now + 0.12, 0.3, 0.1)
}
