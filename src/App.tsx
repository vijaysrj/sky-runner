import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const LANE_X = [-1.7, 0, 1.7]
const RUN_H = 1.7
const SLIDE_H = 0.8
const GRAVITY = 0.0105
const JUMP_V = 0.22
const RAMP_V = 0.29
const BEST_KEY = 'runner-best'
const TRACK_LEN = 90
const ROAD_HALF = 2.8
const LEVEL_DIST = [0, 700, 1600, 2600, 3800]

type Status = 'ready' | 'playing' | 'over'
type Kind = 'crate' | 'overhead' | 'car' | 'train' | 'ramp' | 'puddle' | 'lava'
type Obstacle = { kind: Kind; lane: number; z: number; hit: boolean; color: number }
type Coin = { lane: number; z: number; y: number; taken: boolean }
type Action = 'left' | 'right' | 'jump' | 'slide'

type State = {
  status: Status
  lane: number
  x: number
  py: number
  vy: number
  sliding: number
  obstacles: Obstacle[]
  coins: Coin[]
  speed: number
  dist: number
  coinCount: number
  hearts: number
  invuln: number
  nextSpawn: number
  tick: number
  best: number
  level: number
  flash: number
  fumble: number
}

const THEMES = [
  { name: 'Meadow', top: '#7dd3fc', bottom: '#e0f2fe', fog: '#e0f2fe', grass: '#ffffff', sun: 2.2 },
  { name: 'Sunset City', top: '#fb923c', bottom: '#fde68a', fog: '#fed7aa', grass: '#fde68a', sun: 2.0 },
  { name: 'Candy Town', top: '#f0abfc', bottom: '#fce7f3', fog: '#fbcfe8', grass: '#d9f99d', sun: 2.2 },
  { name: 'Moonlight', top: '#1e1b4b', bottom: '#6d28d9', fog: '#312e81', grass: '#7c9bb8', sun: 1.3 },
  { name: 'Rainbow Road', top: '#60a5fa', bottom: '#fef08a', fog: '#fef9c3', grass: '#bbf7d0', sun: 2.3 },
]

const CAR_COLORS = [0xf472b6, 0xa855f7, 0x38bdf8, 0xfacc15]
const TRAIN_COLOR = 0x22d3ee

const NEEDED_HEIGHT: Partial<Record<Kind, number>> = { crate: 0.5, lava: 0.5, car: 2.6, train: 2.7 }
const PLAYER_HALF_DEPTH = 0.2
const HALF_LEN: Record<Kind, number> = { crate: 0.35, overhead: 0.5, car: 1.1, train: 3.0, ramp: 0.8, puddle: 0.8, lava: 0.9 }
const FUMBLE_FRAMES = 150

function bend(p: number) {
  return 4.6 * Math.sin(p * 0.013) + 1.8 * Math.sin(p * 0.029 + 1.3)
}

function offsetAt(dist: number, z: number) {
  return bend(dist - z) - bend(dist)
}

function levelOf(dist: number) {
  let level = 1
  for (let i = 1; i < LEVEL_DIST.length; i++) if (dist >= LEVEL_DIST[i]) level = i + 1
  return level
}

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function saveBest(score: number) {
  try {
    localStorage.setItem(BEST_KEY, String(score))
  } catch {}
}

function scoreOf(s: State) {
  return Math.floor(s.dist / 4) + s.coinCount * 5
}

function reset(s: State) {
  Object.assign(s, {
    status: 'playing',
    lane: 1,
    x: LANE_X[1],
    py: 0,
    vy: 0,
    sliding: 0,
    obstacles: [],
    coins: [],
    speed: 0.13,
    dist: 0,
    coinCount: 0,
    hearts: 3,
    invuln: 0,
    nextSpawn: 50,
    tick: 0,
    level: 1,
    flash: 0,
    fumble: 0,
  })
}

function act(s: State, a: Action) {
  if (s.status !== 'playing') {
    reset(s)
    return
  }
  if (s.fumble > 0) return
  if (a === 'left') s.lane = Math.max(0, s.lane - 1)
  if (a === 'right') s.lane = Math.min(2, s.lane + 1)
  if (a === 'jump' && s.py <= 0) {
    s.vy = JUMP_V
    s.sliding = 0
  }
  if (a === 'slide' && s.py <= 0) s.sliding = 45
}

function pickKind(level: number): Kind | 'coins' {
  const weights: [Kind | 'coins', number][] = [
    ['coins', 6],
    ['crate', 3],
    ['ramp', 1.5 + level * 0.3],
  ]
  weights.push(['puddle', 2])
  if (level >= 2) weights.push(['lava', 1 + level * 0.3])
  if (level >= 2) weights.push(['overhead', 2])
  if (level >= 2) weights.push(['car', 1.5 + level * 0.4])
  if (level >= 2) weights.push(['train', 0.6 + level * 0.2])
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  let r = Math.random() * total
  for (const [kind, w] of weights) {
    r -= w
    if (r <= 0) return kind
  }
  return 'coins'
}

function spawn(s: State) {
  const lane = Math.floor(Math.random() * 3)
  const kind = pickKind(s.level)
  if (kind === 'coins') {
    for (let i = 0; i < 4; i++) s.coins.push({ lane, z: -TRACK_LEN - i * 1.4, y: 1.0, taken: false })
    return
  }
  const color = Math.floor(Math.random() * CAR_COLORS.length)
  s.obstacles.push({ kind, lane, z: -TRACK_LEN, hit: false, color })
  if (kind === 'ramp') {
    for (let i = 0; i < 4; i++) s.coins.push({ lane, z: -TRACK_LEN - 2 - i * 1.2, y: 3.2, taken: false })
  }
}

function update(s: State) {
  if (s.status !== 'playing') return
  s.tick++
  s.x += (LANE_X[s.lane] - s.x) * 0.25

  s.vy -= GRAVITY
  s.py += s.vy
  if (s.py <= 0) {
    s.py = 0
    s.vy = 0
  }
  if (s.sliding > 0) s.sliding--

  const level = levelOf(s.dist)
  if (level !== s.level) {
    s.level = level
    s.flash = 150
  }
  if (s.flash > 0) s.flash--
  if (s.fumble > 0) s.fumble--

  s.speed = Math.min(0.36, 0.13 + (s.level - 1) * 0.035) * (s.fumble > 0 ? 0.35 : 1)
  s.dist += s.speed
  if (s.invuln > 0) s.invuln--

  s.nextSpawn--
  if (s.nextSpawn <= 0) {
    spawn(s)
    const gap = s.level === 1 ? 46 : Math.max(18, 30 - s.level * 2)
    s.nextSpawn = gap + Math.random() * 18
  }

  s.obstacles.forEach((o) => (o.z += s.speed))
  s.coins.forEach((c) => (c.z += s.speed))

  const playerH = s.sliding > 0 ? SLIDE_H : RUN_H
  for (const o of s.obstacles) {
    if (o.hit || o.lane !== s.lane || Math.abs(o.z) > HALF_LEN[o.kind] + PLAYER_HALF_DEPTH) continue
    if (o.kind === 'ramp') {
      if (s.py <= 0) {
        s.vy = RAMP_V
        s.sliding = 0
        o.hit = true
      }
      continue
    }
    if (o.kind === 'puddle') {
      if (s.py <= 0.1) {
        s.fumble = FUMBLE_FRAMES
        o.hit = true
      }
      continue
    }
    if (s.invuln > 0) continue
    const blocked =
      o.kind === 'overhead' ? s.py + playerH > 1.25 : s.py < (NEEDED_HEIGHT[o.kind] ?? 1)
    if (blocked) {
      o.hit = true
      s.hearts--
      s.invuln = 130
      if (s.hearts <= 0) {
        s.status = 'over'
        s.tick = -1
        return
      }
    }
  }

  const centerY = s.py + playerH / 2
  for (const c of s.coins) {
    if (!c.taken && c.lane === s.lane && Math.abs(c.z) < 0.9 && Math.abs(centerY - c.y) < 1.4) {
      c.taken = true
      s.coinCount++
    }
  }

  s.obstacles = s.obstacles.filter((o) => !o.hit && o.z < 10)
  s.coins = s.coins.filter((c) => !c.taken && c.z < 8)
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function skyTexture(top: string, bottom: string) {
  return canvasTexture(4, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, top)
    g.addColorStop(0.6, bottom)
    g.addColorStop(1, bottom)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4, 256)
  })
}

function buildAssets() {
  const roadTex = canvasTexture(512, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 512, 0)
    g.addColorStop(0, '#3f4a5c')
    g.addColorStop(0.5, '#4b5769')
    g.addColorStop(1, '#3f4a5c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2)
    }
    ctx.fillStyle = '#fdf2f8'
    for (const x of [178, 334]) {
      for (let y = 0; y < 512; y += 128) ctx.fillRect(x - 5, y + 16, 10, 64)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(18, 0, 10, 512)
    ctx.fillRect(484, 0, 10, 512)
  })
  roadTex.repeat.set(1, TRACK_LEN / 8)

  const curbTex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#f472b6'
    ctx.fillRect(0, 0, 64, 32)
  })
  curbTex.repeat.set(1, TRACK_LEN / 1.2)

  const grassTex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(22,163,74,0.25)' : 'rgba(134,239,172,0.25)'
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3)
    }
  })
  grassTex.repeat.set(40, 40)

  const woodTex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#c2410c'
    ctx.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 256; y += 64) {
      ctx.fillStyle = y % 128 === 0 ? '#ea580c' : '#c2410c'
      ctx.fillRect(0, y, 256, 64)
      ctx.fillStyle = 'rgba(69,26,3,0.6)'
      ctx.fillRect(0, y, 256, 4)
    }
    ctx.fillStyle = 'rgba(69,26,3,0.5)'
    ctx.fillRect(20, 0, 6, 256)
    ctx.fillRect(200, 0, 6, 256)
  })

  const hazardTex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#facc15'
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#111827'
    for (let i = -128; i < 256; i += 64) {
      ctx.beginPath()
      ctx.moveTo(i, 128)
      ctx.lineTo(i + 32, 128)
      ctx.lineTo(i + 96, 0)
      ctx.lineTo(i + 64, 0)
      ctx.closePath()
      ctx.fill()
    }
  })

  const rampTex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#fef08a'
    for (let i = -128; i < 256; i += 48) {
      ctx.beginPath()
      ctx.moveTo(i, 128)
      ctx.lineTo(i + 24, 128)
      ctx.lineTo(i + 72, 0)
      ctx.lineTo(i + 48, 0)
      ctx.closePath()
      ctx.fill()
    }
  })

  const trainWindowTex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#22d3ee'
    ctx.fillRect(0, 0, 128, 128)
    for (let y = 16; y < 128; y += 56) {
      ctx.fillStyle = '#e0f2fe'
      ctx.fillRect(12, y, 104, 40)
      ctx.fillStyle = '#0e7490'
      ctx.fillRect(12, y + 38, 104, 4)
    }
  })

  const lavaTex = canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 150)
    g.addColorStop(0, '#fde047')
    g.addColorStop(0.5, '#f97316')
    g.addColorStop(1, '#7f1d1d')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(254,240,138,0.6)'
      ctx.beginPath()
      ctx.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 10, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  const carMats = CAR_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.1 }))

  return {
    roadMat: new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 }),
    curbMat: new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6 }),
    grassMat: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
    woodMat: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }),
    hazardMat: new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.5 }),
    rampMat: new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.6 }),
    puddleMat: new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 }),
    lavaMat: new THREE.MeshStandardMaterial({ map: lavaTex, emissive: '#f97316', emissiveMap: lavaTex, emissiveIntensity: 0.9, roughness: 0.4 }),
    trainMat: new THREE.MeshStandardMaterial({ map: trainWindowTex, roughness: 0.5 }),
    trainBodyMat: new THREE.MeshStandardMaterial({ color: TRAIN_COLOR, roughness: 0.5 }),
    carMats,
    glassMat: new THREE.MeshStandardMaterial({ color: '#bae6fd', roughness: 0.2, metalness: 0.1 }),
    wheelMat: new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 }),
    bandMat: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.5, metalness: 0.3 }),
    goldMat: new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.9, roughness: 0.22, emissive: '#78350f', emissiveIntensity: 0.25 }),
    trunkMat: new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.9 }),
    leafMats: ['#f9a8d4', '#f472b6', '#86efac'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
    cloudMat: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 }),

    skin: new THREE.MeshStandardMaterial({ color: '#f7cfae', roughness: 0.55 }),
    hair: new THREE.MeshStandardMaterial({ color: '#8b4a2b', roughness: 0.5 }),
    hairDark: new THREE.MeshStandardMaterial({ color: '#6b3620', roughness: 0.5 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 }),
    iris: new THREE.MeshStandardMaterial({ color: '#4c1d95', roughness: 0.25 }),
    cheek: new THREE.MeshStandardMaterial({ color: '#fb7185', roughness: 0.6, transparent: true, opacity: 0.55 }),
    lips: new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.4 }),
    bow: new THREE.MeshStandardMaterial({ color: '#f472b6', roughness: 0.4 }),
    top: new THREE.MeshStandardMaterial({ color: '#f472b6', roughness: 0.6 }),
    collar: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
    skirt: new THREE.MeshStandardMaterial({ color: '#a855f7', roughness: 0.7 }),
    leggings: new THREE.MeshStandardMaterial({ color: '#14b8a6', roughness: 0.7 }),
    shoe: new THREE.MeshStandardMaterial({ color: '#fdf4ff', roughness: 0.4 }),
    sole: new THREE.MeshStandardMaterial({ color: '#f472b6', roughness: 0.5 }),
    backpack: new THREE.MeshStandardMaterial({ color: '#f9a8d4', roughness: 0.5 }),

    geo: {
      crate: new THREE.BoxGeometry(1.2, 1.0, 0.9),
      band: new THREE.BoxGeometry(1.24, 0.12, 0.94),
      bar: new THREE.BoxGeometry(1.9, 0.6, 0.5),
      post: new THREE.BoxGeometry(0.14, 1.2, 0.14),
      coin: new THREE.CylinderGeometry(0.3, 0.3, 0.08, 28),
      ring: new THREE.TorusGeometry(0.3, 0.03, 8, 28),
      trunk: new THREE.CylinderGeometry(0.12, 0.16, 0.9, 10),
      leaf: new THREE.SphereGeometry(0.75, 16, 12),
      cloud: new THREE.SphereGeometry(0.6, 16, 12),
      carBody: new THREE.BoxGeometry(1.2, 0.6, 2.2),
      carCabin: new THREE.BoxGeometry(1.0, 0.5, 1.1),
      wheel: new THREE.CylinderGeometry(0.25, 0.25, 0.2, 14),
      trainBody: new THREE.BoxGeometry(1.3, 2.4, 6),
      trainRoof: new THREE.BoxGeometry(1.36, 0.14, 6.1),
      torso: new THREE.CapsuleGeometry(0.28, 0.4, 6, 14),
      limb: new THREE.CapsuleGeometry(0.09, 0.38, 6, 12),
      leg: new THREE.CapsuleGeometry(0.12, 0.5, 6, 12),
      skirt: new THREE.CylinderGeometry(0.34, 0.5, 0.36, 18),
      head: new THREE.SphereGeometry(0.34, 28, 22),
      hairCap: new THREE.SphereGeometry(0.37, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      bangs: new THREE.SphereGeometry(0.3, 18, 12),
      ponytail: new THREE.CapsuleGeometry(0.12, 0.5, 6, 12),
      bow: new THREE.TorusGeometry(0.1, 0.05, 8, 16),
      eyeWhite: new THREE.SphereGeometry(0.075, 14, 12),
      iris: new THREE.SphereGeometry(0.05, 12, 10),
      glint: new THREE.SphereGeometry(0.02, 8, 6),
      cheek: new THREE.SphereGeometry(0.06, 10, 8),
      smile: new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI),
      hand: new THREE.SphereGeometry(0.11, 12, 10),
      shoe: new THREE.SphereGeometry(0.17, 16, 12),
      backpack: new THREE.BoxGeometry(0.42, 0.46, 0.16),
      ramp: buildRampGeometry(),
      disc: new THREE.CircleGeometry(1, 28),
    },
  }
}

function buildRampGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(1.6, 0)
  shape.lineTo(0, 0.9)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.3, bevelEnabled: false })
  geo.translate(-0.8, 0, -0.65)
  geo.rotateY(-Math.PI / 2)
  return geo
}

type Assets = ReturnType<typeof buildAssets>

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = shadow
  m.receiveShadow = shadow
  return m
}

// The runner faces -z (away from the camera), so face details sit at negative z.
function makeRunner(a: Assets) {
  const group = new THREE.Group()

  const torso = mesh(a.geo.torso, a.top)
  torso.scale.set(1.15, 1, 0.85)
  torso.position.y = 1.2
  const collar = mesh(a.geo.bangs, a.collar, false)
  collar.scale.set(1.0, 0.25, 0.8)
  collar.position.set(0, 1.56, -0.04)
  const skirt = mesh(a.geo.skirt, a.skirt)
  skirt.position.y = 0.92
  const backpack = mesh(a.geo.backpack, a.backpack)
  backpack.position.set(0, 1.25, 0.3)
  group.add(torso, collar, skirt, backpack)

  const headGroup = new THREE.Group()
  headGroup.position.y = 1.85
  const head = mesh(a.geo.head, a.skin)
  const cap = mesh(a.geo.hairCap, a.hair)
  cap.position.y = 0.04
  const bangs = mesh(a.geo.bangs, a.hair)
  bangs.scale.set(1.05, 0.5, 0.6)
  bangs.position.set(0, 0.2, -0.22)
  const ponytail = mesh(a.geo.ponytail, a.hairDark)
  ponytail.position.set(0, 0.05, 0.42)
  ponytail.rotation.x = 0.9
  const tie = mesh(a.geo.bow, a.bow, false)
  tie.position.set(0, 0.25, 0.3)
  tie.rotation.y = Math.PI / 2
  const bow = mesh(a.geo.bow, a.bow, false)
  bow.position.set(0.22, 0.4, -0.16)
  bow.rotation.set(0, 0, 0.5)
  headGroup.add(head, cap, bangs, ponytail, tie, bow)

  for (const x of [-0.13, 0.13]) {
    const white = mesh(a.geo.eyeWhite, a.eyeWhite, false)
    white.position.set(x, 0.0, -0.3)
    white.scale.set(1, 1.2, 0.6)
    const iris = mesh(a.geo.iris, a.iris, false)
    iris.position.set(x, -0.01, -0.36)
    const glint = mesh(a.geo.glint, a.eyeWhite, false)
    glint.position.set(x + 0.02, 0.03, -0.39)
    headGroup.add(white, iris, glint)
  }
  for (const x of [-0.2, 0.2]) {
    const cheek = mesh(a.geo.cheek, a.cheek, false)
    cheek.position.set(x, -0.12, -0.27)
    cheek.scale.set(1.2, 0.7, 0.4)
    headGroup.add(cheek)
  }
  const smile = mesh(a.geo.smile, a.lips, false)
  smile.position.set(0, -0.17, -0.31)
  smile.rotation.z = Math.PI
  headGroup.add(smile)
  group.add(headGroup)

  const armL = new THREE.Group()
  armL.position.set(-0.4, 1.4, 0)
  const armLMesh = mesh(a.geo.limb, a.top)
  armLMesh.position.y = -0.28
  const handL = mesh(a.geo.hand, a.skin)
  handL.position.y = -0.62
  armL.add(armLMesh, handL)
  const armR = armL.clone()
  armR.position.x = 0.4
  group.add(armL, armR)

  const legL = new THREE.Group()
  legL.position.set(-0.16, 0.78, 0)
  const legLMesh = mesh(a.geo.leg, a.leggings)
  legLMesh.position.y = -0.3
  const shoeL = mesh(a.geo.shoe, a.shoe)
  shoeL.scale.set(1, 0.6, 1.5)
  shoeL.position.set(0, -0.76, -0.07)
  const soleL = mesh(a.geo.shoe, a.sole, false)
  soleL.scale.set(1.02, 0.18, 1.52)
  soleL.position.set(0, -0.86, -0.07)
  legL.add(legLMesh, shoeL, soleL)
  const legR = legL.clone()
  legR.position.x = 0.16
  group.add(legL, legR)

  return { group, legL, legR, torso, headGroup, armL, armR }
}

function makeCrate(a: Assets) {
  const g = new THREE.Group()
  g.add(mesh(a.geo.crate, a.woodMat))
  const band = mesh(a.geo.band, a.bandMat)
  band.position.y = 0.42
  const band2 = band.clone()
  band2.position.y = -0.42
  g.add(band, band2)
  return g
}

function makeOverhead(a: Assets) {
  const g = new THREE.Group()
  const bar = mesh(a.geo.bar, a.hazardMat)
  bar.position.y = 1.55
  g.add(bar)
  for (const x of [-0.85, 0.85]) {
    const post = mesh(a.geo.post, a.bandMat)
    post.position.set(x, 0.6, 0)
    g.add(post)
  }
  return g
}

function makeCar(a: Assets, color: number) {
  const g = new THREE.Group()
  const body = mesh(a.geo.carBody, a.carMats[color])
  body.position.y = 0.5
  const cabin = mesh(a.geo.carCabin, a.glassMat)
  cabin.position.set(0, 1.0, -0.1)
  g.add(body, cabin)
  for (const x of [-0.62, 0.62]) {
    for (const z of [-0.75, 0.75]) {
      const wheel = mesh(a.geo.wheel, a.wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.25, z)
      g.add(wheel)
    }
  }
  return g
}

function makeTrain(a: Assets) {
  const g = new THREE.Group()
  const body = mesh(a.geo.trainBody, a.trainMat)
  body.position.y = 1.4
  const roof = mesh(a.geo.trainRoof, a.trainBodyMat)
  roof.position.y = 2.6
  g.add(body, roof)
  return g
}

function makePuddle(a: Assets) {
  const g = new THREE.Group()
  const disc = new THREE.Mesh(a.geo.disc, a.puddleMat)
  disc.rotation.x = -Math.PI / 2
  disc.scale.set(0.95, 0.6, 1)
  disc.position.y = 0.02
  disc.receiveShadow = true
  g.add(disc)
  return g
}

function makeLava(a: Assets) {
  const g = new THREE.Group()
  const disc = new THREE.Mesh(a.geo.disc, a.lavaMat)
  disc.rotation.x = -Math.PI / 2
  disc.scale.set(1.0, 0.9, 1)
  disc.position.y = 0.03
  g.add(disc)
  return g
}

function makeRamp(a: Assets) {
  const g = new THREE.Group()
  g.add(mesh(a.geo.ramp, a.rampMat))
  return g
}

function makeCoin(a: Assets, y: number) {
  const g = new THREE.Group()
  const disc = mesh(a.geo.coin, a.goldMat)
  disc.rotation.x = Math.PI / 2
  const ring = mesh(a.geo.ring, a.goldMat)
  g.add(disc, ring)
  g.position.y = y
  return g
}

function makeTree(a: Assets) {
  const t = new THREE.Group()
  const trunk = mesh(a.geo.trunk, a.trunkMat)
  trunk.position.y = 0.45
  t.add(trunk)
  const h = 1 + Math.random() * 0.5
  const puffs: [number, number][] = [
    [1.4, 0.9],
    [2.0, 0.7],
    [2.5, 0.5],
  ]
  puffs.forEach(([y, scale], i) => {
    const leaf = mesh(a.geo.leaf, a.leafMats[i % a.leafMats.length])
    leaf.position.y = y
    leaf.scale.setScalar(scale * h * 1.1)
    t.add(leaf)
  })
  return t
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<State>({
    status: 'ready',
    lane: 1,
    x: LANE_X[1],
    py: 0,
    vy: 0,
    sliding: 0,
    obstacles: [],
    coins: [],
    speed: 0.13,
    dist: 0,
    coinCount: 0,
    hearts: 3,
    invuln: 0,
    nextSpawn: 50,
    tick: 0,
    best: loadBest(),
    level: 1,
    flash: 0,
    fumble: 0,
  })
  const [hud, setHud] = useState({
    status: 'ready' as Status,
    score: 0,
    coins: 0,
    hearts: 3,
    best: stateRef.current.best,
    level: 1,
    flash: 0,
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const s = stateRef.current
    const a = buildAssets()

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(THEMES[0].fog, 40, 95)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
    camera.position.set(0, 4.2, 9.5)

    const hemi = new THREE.HemisphereLight('#e0f2fe', '#4ade80', 1.0)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff7ed', THEMES[0].sun)
    sun.position.set(5, 11, 5)
    sun.castShadow = true
    sun.shadow.mapSize.set(512, 512)
    sun.shadow.camera.left = -9
    sun.shadow.camera.right = 9
    sun.shadow.camera.top = 14
    sun.shadow.camera.bottom = -10
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 40
    sun.shadow.bias = -0.0005
    sun.target.position.set(0, 0, -4)
    scene.add(sun, sun.target)

    let skyTex: THREE.CanvasTexture | null = null
    let currentTheme = -1
    const applyTheme = (index: number) => {
      if (index === currentTheme) return
      currentTheme = index
      const t = THEMES[index]
      skyTex?.dispose()
      skyTex = skyTexture(t.top, t.bottom)
      scene.background = skyTex
      ;(scene.fog as THREE.Fog).color.set(t.fog)
      a.grassMat.color.set(t.grass)
      sun.intensity = t.sun
      hemi.intensity = index === 3 ? 0.7 : 1.0
    }
    applyTheme(0)

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), a.grassMat)
    grass.rotation.x = -Math.PI / 2
    grass.position.y = -0.02
    grass.receiveShadow = true
    scene.add(grass)

    const roadGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, 220, 1, 110)
    const roadPos = roadGeo.attributes.position as THREE.BufferAttribute
    const roadBaseX = Float32Array.from({ length: roadPos.count }, (_, i) => roadPos.getX(i))
    const roadLocalY = Float32Array.from({ length: roadPos.count }, (_, i) => roadPos.getY(i))
    const road = new THREE.Mesh(roadGeo, a.roadMat)
    road.rotation.x = -Math.PI / 2
    road.receiveShadow = true
    scene.add(road)

    const CURB_SEG = 48
    const CURB_LEN = 5
    const curbs: { mesh: THREE.Mesh; side: number; z: number }[] = []
    for (const side of [-1, 1]) {
      for (let i = 0; i < CURB_SEG; i++) {
        const curb = mesh(new THREE.BoxGeometry(0.3, 0.14, CURB_LEN), a.curbMat)
        const z = -120 + i * CURB_LEN
        curb.position.set(side * (ROAD_HALF + 0.15), 0.07, z)
        scene.add(curb)
        curbs.push({ mesh: curb, side, z })
      }
    }

    const trees: { group: THREE.Group; baseX: number }[] = []
    for (const side of [-1, 1]) {
      for (let z = -TRACK_LEN; z < 10; z += 7) {
        const t = makeTree(a)
        const baseX = side * (5.6 + Math.random() * 1.6)
        t.position.set(baseX, 0, z + Math.random() * 2)
        scene.add(t)
        trees.push({ group: t, baseX })
      }
    }

    const clouds: THREE.Group[] = []
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Group()
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Mesh(a.geo.cloud, a.cloudMat)
        puff.position.set(k * 0.7 - 0.7, Math.random() * 0.3, 0)
        c.add(puff)
      }
      c.position.set(-20 + Math.random() * 40, 11 + Math.random() * 4, -20 - Math.random() * 60)
      scene.add(c)
      clouds.push(c)
    }

    const runner = makeRunner(a)
    scene.add(runner.group)


    let modelRoot: THREE.Group | null = null
    let mixer: THREE.AnimationMixer | null = null
    const clock = new THREE.Clock()
    new FBXLoader().load(`${import.meta.env.BASE_URL}girl.fbx`, (obj) => {
      obj.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = true
          c.receiveShadow = true
        }
      })
      const root = new THREE.Group()
      root.add(obj)
      root.updateMatrixWorld(true)
      const b = new THREE.Box3().setFromObject(root)
      const sc = 1.85 / (b.max.y - b.min.y)
      root.scale.setScalar(sc)
      root.updateMatrixWorld(true)
      const b2 = new THREE.Box3().setFromObject(root)
      obj.position.set(
        -((b2.min.x + b2.max.x) / 2) / sc,
        -b2.min.y / sc,
        -((b2.min.z + b2.max.z) / 2) / sc,
      )
      root.rotation.y = Math.PI
      scene.add(root)
      mixer = new THREE.AnimationMixer(obj)
      const clip = obj.animations[0]
      if (clip) {
        clip.tracks = clip.tracks.filter((t) => !t.name.endsWith('.position'))
        mixer.clipAction(clip).play()
      }
      runner.group.visible = false
      modelRoot = root
    })

    const obstacleMeshes = new Map<Obstacle, THREE.Group>()
    const coinMeshes = new Map<Coin, THREE.Group>()

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    let frame = 0
    let camX = 0
    let last = { score: -1, coins: -1, hearts: -1, status: '' as Status, level: 0, flash: 0 }

    const STEP = 1000 / 60
    let acc = 0
    let prevTime = performance.now()
    const loop = (now: number) => {
      const body: THREE.Object3D = modelRoot ?? runner.group
      mixer?.update(clock.getDelta())
      acc += Math.min(now - prevTime, 100)
      prevTime = now
      let steps = 0
      while (acc >= STEP && steps < 4) {
        const wasPlaying = s.status === 'playing'
        update(s)
        if (wasPlaying && s.status === 'over') {
          const score = scoreOf(s)
          if (score > s.best) {
            s.best = score
            saveBest(score)
          }
        }
        acc -= STEP
        steps++
      }
      if (steps === 4) acc = 0
      applyTheme(s.level - 1)

      body.position.x = s.x
      body.position.y = s.py
      const running = s.status === 'playing' && s.py <= 0 && s.sliding === 0
      const swing = running ? Math.sin(s.tick * 0.35) * 0.6 : 0
      runner.legL.rotation.x = swing
      runner.legR.rotation.x = -swing
      runner.armL.rotation.x = -swing * 0.6
      runner.armR.rotation.x = swing * 0.6
      if (s.fumble > 0) {
        const wobble = Math.sin(s.tick * 0.45)
        body.rotation.z = wobble * 0.32
        runner.armL.rotation.x = -2.2 + wobble * 0.5
        runner.armR.rotation.x = -2.2 - wobble * 0.5
        runner.legL.rotation.x = wobble * 0.5
        runner.legR.rotation.x = -wobble * 0.5
      } else {
        body.rotation.z = 0
      }
      const sliding = s.sliding > 0
      const targetTilt = sliding ? -1.4 : 0
      body.rotation.x += (targetTilt - body.rotation.x) * 0.3
      body.position.y = s.py + (sliding ? 0.38 : 0) * (1 - Math.abs(body.rotation.x) / 1.4)
      runner.torso.scale.y = 1
      runner.torso.position.y = 1.2
      runner.headGroup.position.y = 1.85
      body.visible = !(s.invuln > 0 && Math.floor(s.tick / 5) % 2 === 0)

      a.roadMat.map!.offset.y = (s.dist / 8) % 1
      for (let i = 0; i < roadPos.count; i++) {
        roadPos.setX(i, roadBaseX[i] + offsetAt(s.dist, -roadLocalY[i]))
      }
      roadPos.needsUpdate = true
      for (const c of curbs) {
        c.z += s.speed
        if (c.z > 14) c.z -= CURB_SEG * CURB_LEN
        const slope = offsetAt(s.dist, c.z + 0.5) - offsetAt(s.dist, c.z - 0.5)
        c.mesh.position.set(c.side * (ROAD_HALF + 0.15) + offsetAt(s.dist, c.z), 0.07, c.z)
        c.mesh.rotation.y = Math.atan2(slope, 1)
      }
      for (const t of trees) {
        t.group.position.z += s.speed
        if (t.group.position.z > 8) t.group.position.z -= TRACK_LEN + 10
        t.group.position.x = t.baseX + offsetAt(s.dist, t.group.position.z)
      }
      for (const c of clouds) {
        c.position.x -= 0.004
        if (c.position.x < -30) c.position.x = 30
      }

      for (const o of s.obstacles) {
        let m = obstacleMeshes.get(o)
        if (!m) {
          if (o.kind === 'crate') m = makeCrate(a)
          else if (o.kind === 'overhead') m = makeOverhead(a)
          else if (o.kind === 'car') m = makeCar(a, o.color)
          else if (o.kind === 'train') m = makeTrain(a)
          else if (o.kind === 'puddle') m = makePuddle(a)
          else if (o.kind === 'lava') m = makeLava(a)
          else m = makeRamp(a)
          scene.add(m)
          obstacleMeshes.set(o, m)
        }
        m.position.set(LANE_X[o.lane] + offsetAt(s.dist, o.z), 0, o.z)
      }
      for (const [o, m] of obstacleMeshes) {
        if (!s.obstacles.includes(o)) {
          scene.remove(m)
          obstacleMeshes.delete(o)
        }
      }

      for (const c of s.coins) {
        let m = coinMeshes.get(c)
        if (!m) {
          m = makeCoin(a, c.y)
          scene.add(m)
          coinMeshes.set(c, m)
        }
        m.position.set(LANE_X[c.lane] + offsetAt(s.dist, c.z), c.y, c.z)
        m.rotation.y += 0.08
      }
      for (const [c, m] of coinMeshes) {
        if (!s.coins.includes(c)) {
          scene.remove(m)
          coinMeshes.delete(c)
        }
      }

      camX += (s.x * 0.5 - camX) * 0.15
      camera.position.set(camX, 4.2, 9.5)
      camera.lookAt(camX * 0.6 + offsetAt(s.dist, -8) * 0.5, 1.2, -8)
      sun.position.x = camX + 5
      sun.target.position.x = camX * 0.5

      renderer.render(scene, camera)

      const score = scoreOf(s)
      const flashOn = s.flash > 0 ? 1 : 0
      if (
        score !== last.score ||
        s.coinCount !== last.coins ||
        s.hearts !== last.hearts ||
        s.status !== last.status ||
        s.level !== last.level ||
        flashOn !== last.flash
      ) {
        last = { score, coins: s.coinCount, hearts: s.hearts, status: s.status, level: s.level, flash: flashOn }
        setHud({
          status: s.status,
          score,
          coins: s.coinCount,
          hearts: s.hearts,
          best: s.best,
          level: s.level,
          flash: flashOn,
        })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    const keys: Record<string, Action> = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'jump',
      KeyW: 'jump',
      Space: 'jump',
      ArrowDown: 'slide',
      KeyS: 'slide',
    }
    const onKey = (e: KeyboardEvent) => {
      const action = keys[e.code]
      if (!action) return
      e.preventDefault()
      act(s, action)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', resize)
      skyTex?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const press = (action: Action) => (e: React.PointerEvent) => {
    e.preventDefault()
    act(stateRef.current, action)
  }

  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  function onSurfaceDown(e: React.PointerEvent<HTMLDivElement>) {
    swipeStart.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    act(stateRef.current, 'jump')
  }

  function onSurfaceMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const s = stateRef.current
    const THRESHOLD = 26
    if (Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      act(s, dx < 0 ? 'left' : 'right')
      swipeStart.current = { x: e.clientX, y: e.clientY }
    } else if (dy >= THRESHOLD && dy > Math.abs(dx)) {
      act(s, 'slide')
      swipeStart.current = null
    }
  }

  function onSurfaceUp() {
    swipeStart.current = null
  }

  const btn =
    'flex-1 h-16 rounded-2xl bg-white/90 text-slate-800 text-3xl font-bold shadow select-none touch-manipulation active:scale-95 active:bg-white'

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-pink-100 select-none overflow-hidden touch-none">
      <div className="relative w-full max-w-[360px] px-3">
        <div className="flex justify-between items-center text-slate-800 font-extrabold text-lg px-1 mb-2">
          <span>Score {hud.score}</span>
          <span>Coins {hud.coins}</span>
          <span className="text-pink-500">{'♥'.repeat(hud.hearts) || '·'}</span>
        </div>
        <div className="text-center text-sm font-bold text-slate-600 mb-2">
          Level {hud.level} · {THEMES[hud.level - 1].name}
        </div>

        <div className="relative flex justify-center">
          <div
            ref={mountRef}
            onPointerDown={onSurfaceDown}
            onPointerMove={onSurfaceMove}
            onPointerUp={onSurfaceUp}
            onPointerCancel={onSurfaceUp}
            className="w-full rounded-3xl overflow-hidden shadow-lg"
            style={{ height: 'min(640px, calc(100vh - 210px))', touchAction: 'none' }}
          />

          {hud.flash === 1 && hud.status === 'playing' && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-pink-500 text-white px-5 py-2 font-extrabold text-lg shadow pointer-events-none">
              Level {hud.level}!
            </div>
          )}

          {hud.status !== 'playing' && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-slate-900/40 text-white text-center p-6"
              onPointerDown={() => act(stateRef.current, 'jump')}
            >
              {hud.status === 'ready' ? (
                <>
                  <h1 className="text-3xl font-extrabold mb-2">Sky Runner</h1>
                  <p className="text-lg mb-6">Tap the screen to start</p>
                </>
              ) : (
                <>
                  <h1 className="text-3xl font-extrabold mb-2">Good run!</h1>
                  <p className="text-lg">Score {hud.score}</p>
                  <p className="text-md mb-2">Reached Level {hud.level}</p>
                  <p className="text-md mb-6">Best {hud.best}</p>
                  <span className="rounded-full bg-white text-slate-900 px-6 py-3 font-bold">Play again</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="hidden md:grid grid-cols-4 gap-3 mt-4">
          <button type="button" className={btn} onPointerDown={press('left')} aria-label="Move left">
            ←
          </button>
          <button type="button" className={btn} onPointerDown={press('jump')} aria-label="Jump">
            ↑
          </button>
          <button type="button" className={btn} onPointerDown={press('slide')} aria-label="Slide">
            ↓
          </button>
          <button type="button" className={btn} onPointerDown={press('right')} aria-label="Move right">
            →
          </button>
        </div>
      </div>
    </div>
  )
}
