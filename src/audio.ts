type Sfx = 'jump' | 'coin' | 'hit' | 'boost' | 'splash' | 'over'

let ctx: AudioContext | null = null
let musicBus: GainNode | null = null
let sfxBus: GainNode | null = null
let timer: number | null = null
let nextTime = 0
let step = 0
let musicOn = true
let sfxOn = true

const BPM = 124
const STEP_SEC = 60 / BPM / 4
const MELODY = [
  659, 0, 784, 0, 880, 0, 784, 0, 659, 0, 587, 0, 659, 0, 0, 0,
  698, 0, 880, 0, 1047, 0, 880, 0, 784, 0, 698, 0, 659, 0, 0, 0,
]
const BASS = [
  131, 0, 131, 0, 165, 0, 131, 0, 147, 0, 147, 0, 175, 0, 147, 0,
  175, 0, 175, 0, 220, 0, 175, 0, 196, 0, 175, 0, 165, 0, 196, 0,
]

function ensure() {
  if (!ctx) {
    ctx = new AudioContext()
    musicBus = ctx.createGain()
    musicBus.gain.value = 0.18
    musicBus.connect(ctx.destination)
    sfxBus = ctx.createGain()
    sfxBus.gain.value = 0.35
    sfxBus.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(bus: GainNode, freq: number, when: number, dur: number, type: OscillatorType, vol: number) {
  const c = ctx!
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, when)
  g.gain.setValueAtTime(vol, when)
  g.gain.exponentialRampToValueAtTime(0.0008, when + dur)
  osc.connect(g)
  g.connect(bus)
  osc.start(when)
  osc.stop(when + dur + 0.05)
}

function schedule() {
  const c = ctx!
  while (nextTime < c.currentTime + 0.12) {
    if (MELODY[step]) tone(musicBus!, MELODY[step], nextTime, STEP_SEC * 1.6, 'square', 0.5)
    if (BASS[step]) tone(musicBus!, BASS[step], nextTime, STEP_SEC * 3.5, 'triangle', 0.9)
    nextTime += STEP_SEC
    step = (step + 1) % MELODY.length
  }
}

export function startMusic() {
  if (!musicOn) return
  ensure()
  if (timer !== null) return
  nextTime = ctx!.currentTime + 0.05
  timer = window.setInterval(schedule, 25)
}

export function stopMusic() {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

export function setMusic(on: boolean) {
  musicOn = on
  if (!on) stopMusic()
}

export function setSfx(on: boolean) {
  sfxOn = on
}

export function sfx(name: Sfx) {
  if (!sfxOn) return
  ensure()
  const c = ctx!
  const t = c.currentTime
  const bus = sfxBus!
  switch (name) {
    case 'jump':
      tone(bus, 320, t, 0.25, 'sine', 0.6)
      tone(bus, 640, t + 0.02, 0.2, 'sine', 0.3)
      break
    case 'coin':
      tone(bus, 1046, t, 0.08, 'square', 0.4)
      tone(bus, 1568, t + 0.07, 0.14, 'square', 0.4)
      break
    case 'hit':
      tone(bus, 220, t, 0.3, 'sawtooth', 0.5)
      tone(bus, 110, t + 0.1, 0.35, 'sawtooth', 0.4)
      break
    case 'boost':
      ;[523, 659, 784, 1046].forEach((f, i) => tone(bus, f, t + i * 0.06, 0.14, 'square', 0.35))
      break
    case 'splash':
      tone(bus, 180, t, 0.4, 'triangle', 0.5)
      tone(bus, 120, t + 0.15, 0.4, 'triangle', 0.4)
      break
    case 'over':
      ;[392, 330, 262, 196].forEach((f, i) => tone(bus, f, t + i * 0.22, 0.3, 'triangle', 0.5))
      break
  }
}
