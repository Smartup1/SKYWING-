import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEFAULT_BIRD_ID, getBirdSpecies, type BirdPalette, type BirdSpecies, type RGB } from './birdSpecies'

// ============================================================================
// Math helpers (inlined hot path)
// ============================================================================
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const mixC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const scaleC = (c: RGB, s: number): RGB => [c[0] * s, c[1] * s, c[2] * s]

// Deterministic hash for per-feather variation
const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return s - Math.floor(s)
}

// ============================================================================
// Feather geometry — curved, cambered, with rachis and irregular edges
// ============================================================================
type FeatherOpts = {
  len: number
  width: number
  base: RGB
  tip: RGB
  edge: RGB
  /** Downward droop at tip (meters). */
  droop?: number
  /** Lateral camber (0..1). */
  camber?: number
  /** Twist along length (radians). */
  twist?: number
  rows?: number
  /** Random seed for edge noise. */
  seed?: number
}

/**
 * A single feather pointing +X, with:
 *  - aerodynamic camber (curved cross-section)
 *  - progressive droop and twist
 *  - dark central rachis
 *  - irregular edge profile (noise)
 *  - color gradient base→tip→edge
 */
function featherGeometry(o: FeatherOpts): THREE.BufferGeometry {
  const {
    len, width, base, tip, edge,
    droop = 0.05, camber = 0.35, twist = 0.0,
    rows = 8, seed = 0,
  } = o

  const cols = 3
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  // Pre-compute base mixed colors (color varies with t)
  for (let i = 0; i <= rows; i += 1) {
    const t = i / rows

    // Width profile: narrow quill → broad vane → tapered tip
    let prof: number
    if (t < 0.12) prof = 0.35 + 0.65 * (t / 0.12)
    else if (t < 0.72) prof = 1 - 0.08 * ((t - 0.42) / 0.3) ** 2
    else prof = 0.2 + 0.8 * Math.sqrt(Math.max(0, 1 - ((t - 0.72) / 0.28) ** 2))

    // Edge irregularity (barb separation at tip)
    const edgeNoise = (hash(seed + i, 1, 0) - 0.5) * 0.12 * sstep(0.6, 1, t)

    const hw = 0.5 * width * prof * (1 + edgeNoise)
    const y = -droop * t * t
    const x = t * len

    // Twist rotates the cross-section around X axis
    const tw = twist * t
    const cosT = Math.cos(tw)
    const sinT = Math.sin(tw)

    // Camber: center of feather is raised, edges droop (like a real vane)
    const camberY = camber * width * (1 - prof) * 0.3

    // Colors along the vane
    const body = mixC(base, tip, sstep(0.35, 1, t))
    const edgeCol = mixC(body, edge, 0.45)
    // Rachis (central shaft) darker
    const rachis = scaleC(body, 0.45)

    // Left edge
    let lx = x
    let ly = y + camberY * 0.0 - hw * sinT
    let lz = -hw * cosT
    // Center (rachis)
    let cx = x + 0.002 * Math.sin(t * 8) // slight natural bend
    let cy = y + camberY
    let cz = 0
    // Right edge
    let rx = x
    let ry = y + camberY * 0.0 + hw * sinT
    let rz = hw * cosT

    // Add slight vertical curvature to edges (camber)
    ly += hw * hw * camber * 4
    ry += hw * hw * camber * 4

    positions.push(lx, ly, lz, cx, cy, cz, rx, ry, rz)
    colors.push(...edgeCol, ...rachis, ...edgeCol)

    if (i < rows) {
      const a = i * cols
      const b = (i + 1) * cols
      // Left half
      indices.push(a, a + 1, b + 1, a, b + 1, b)
      // Right half
      indices.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

// ============================================================================
// Wing membrane patch (fills gap between feathers)
// ============================================================================
function patchGeometry(len: number, front: number, back: number, color: RGB): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = [
    0, 0, front,
    len * 0.35, 0, front * 0.92,
    len, 0, front * 0.7,
    len * 0.9, 0, back * 0.85,
    0, 0, back,
  ]
  const col: number[] = []
  // Slight gradient: darker at root
  const root = scaleC(color, 0.75)
  col.push(...root, ...color, ...color, ...color, ...color)
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex([0, 1, 4, 1, 3, 4, 1, 2, 3])
  g.computeVertexNormals()
  return g
}

// ============================================================================
// Bake transform into geometry (reusable scratch objects)
// ============================================================================
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _one = new THREE.Vector3(1, 1, 1)
function baked(
  g: THREE.BufferGeometry,
  x: number, y: number, z: number,
  ry: number, rz = 0, rx = 0,
): THREE.BufferGeometry {
  _e.set(rx, ry, rz, 'YXZ')
  _q.setFromEuler(_e)
  _v.set(x, y, z)
  _m.compose(_v, _q, _one)
  const c = g.clone()
  c.applyMatrix4(_m)
  return c
}

// ============================================================================
// Shared materials
// ============================================================================
const featherMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.82,
  metalness: 0.0,
  side: THREE.DoubleSide,
  // Subtle sheen for iridescence
  envMapIntensity: 0.6,
})
const bodyMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.88,
  metalness: 0.0,
  envMapIntensity: 0.5,
})

// ============================================================================
// Wing
// ============================================================================
export type Wing = {
  root: THREE.Group
  elbow: THREE.Group
  wrist: THREE.Group
  primaries: { pivot: THREE.Group; angle: number; spreadMul: number }[]
}

function buildWing(palette: BirdPalette): Wing {
  const root = new THREE.Group()
  const elbow = new THREE.Group()
  const wrist = new THREE.Group()
  elbow.position.set(0.25, 0, 0)
  wrist.position.set(0.21, 0, 0)
  root.add(elbow)
  elbow.add(wrist)

  const covertBase = palette.wingDark
  const covertMid = palette.wingMid
  const covertEdge = palette.wingEdge

  // ---- ARM (humerus) ----
  const arm: THREE.BufferGeometry[] = [patchGeometry(0.25, -0.05, 0.11, covertBase)]

  // Tertiaries (inner trailing feathers)
  for (let i = 0; i < 5; i += 1) {
    const x = 0.03 + i * 0.045
    arm.push(baked(
      featherGeometry({
        len: 0.19 - i * 0.012,
        width: 0.062,
        base: palette.wingMid,
        tip: palette.wingEdge,
        edge: palette.wingEdge,
        droop: 0.03,
        camber: 0.3,
        seed: i * 7 + 1,
      }),
      x, 0.004, 0.02, -(1.5 - i * 0.04),
    ))
  }

  // Coverts (3 rows, staggered)
  for (let row = 0; row < 3; row += 1) {
    const count = 6 - row
    for (let i = 0; i < count; i += 1) {
      const x = 0.015 + i * 0.045 + row * 0.012
      const g = featherGeometry({
        len: 0.1 - row * 0.012,
        width: 0.052,
        base: row === 0 ? palette.wingMid : covertBase,
        tip: palette.wingEdge,
        edge: palette.wingEdge,
        droop: 0.03,
        camber: 0.4,
        rows: 5,
        seed: i * 13 + row * 31 + 5,
      })
      arm.push(baked(
        g,
        x, 0.008 + row * 0.003, -0.045 + row * 0.04,
        -(1.35 + (hash(i, row, 1) - 0.5) * 0.18),
      ))
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(arm)!, featherMat))

  // ---- FOREARM (radius/ulna) ----
  const fore: THREE.BufferGeometry[] = [patchGeometry(0.21, -0.04, 0.09, covertBase)]

  // Secondaries
  for (let i = 0; i < 9; i += 1) {
    const x = 0.005 + i * 0.023
    fore.push(baked(
      featherGeometry({
        len: 0.21 - i * 0.002,
        width: 0.052,
        base: palette.wingDark,
        tip: palette.wingEdge,
        edge: palette.wingEdge,
        droop: 0.035,
        camber: 0.35,
        seed: i * 3 + 100,
      }),
      x, 0.0, 0.015, -(1.2 + i * 0.026),
    ))
  }

  // Secondary coverts (3 rows)
  for (let row = 0; row < 3; row += 1) {
    const count = 8 - row
    for (let i = 0; i < count; i += 1) {
      const x = 0.01 + i * 0.028 + row * 0.008
      const g = featherGeometry({
        len: 0.1 - row * 0.012,
        width: 0.045,
        base: row === 0 ? palette.wingMid : covertBase,
        tip: palette.wingEdge,
        edge: palette.wingEdge,
        droop: 0.03,
        camber: 0.4,
        rows: 5,
        seed: i * 17 + row * 23 + 200,
      })
      fore.push(baked(
        g,
        x, 0.007 + row * 0.003, -0.04 + row * 0.035,
        -(1.25 + (hash(i, row, 2) - 0.5) * 0.15),
      ))
    }
  }
  elbow.add(new THREE.Mesh(mergeGeometries(fore)!, featherMat))

  // ---- HAND (manus) ----
  const hand: THREE.BufferGeometry[] = [patchGeometry(0.14, -0.03, 0.06, covertBase)]

  // Primary coverts
  for (let i = 0; i < 5; i += 1) {
    hand.push(baked(
      featherGeometry({
        len: 0.1,
        width: 0.04,
        base: palette.wingMid,
        tip: palette.wingEdge,
        edge: palette.wingEdge,
        droop: 0.03,
        camber: 0.4,
        rows: 5,
        seed: i * 11 + 300,
      }),
      0.01 + i * 0.025, 0.007, -0.01 + i * 0.012,
      -(0.2 + i * 0.12),
    ))
  }
  wrist.add(new THREE.Mesh(mergeGeometries(hand)!, featherMat))

  // ---- PRIMARIES (individual, animated) ----
  // Real birds have 9-10 primaries; the outermost are the "fingers".
  const primaries: Wing['primaries'] = []
  const NUM_PRIMARIES = 9
  for (let i = 0; i < NUM_PRIMARIES; i += 1) {
    const k = i / (NUM_PRIMARIES - 1)
    const pivot = new THREE.Group()
    // Position along manus, outermost (P10) at tip
    pivot.position.set(
      lerp(0.12, 0.005, k),
      0.002,
      lerp(-0.012, 0.032, k),
    )
    // Splay angle: inner primaries forward, outer swept back
    const angle = lerp(0.05, 1.0, k * k)
    pivot.rotation.y = -angle

    // Length profile: P1 shortest, P8 longest, P10 slightly shorter (like a real wing)
    const lenProfile = Math.sin((k * 0.85 + 0.15) * Math.PI) * 0.85 + 0.15
    const len = lerp(0.30, 0.22, k) * (0.9 + lenProfile * 0.15) * (i === 0 ? 0.85 : 1)

    const g = featherGeometry({
      len,
      width: lerp(0.036, 0.048, k),
      base: palette.wingDark,
      tip: palette.wingMid,
      edge: palette.wingEdge,
      droop: lerp(0.05, 0.025, k),
      camber: 0.45,
      twist: lerp(0.0, 0.18, k),  // outer primaries twist more
      rows: 9,
      seed: i * 19 + 400,
    })
    const mesh = new THREE.Mesh(g, featherMat)
    pivot.add(mesh)
    wrist.add(pivot)

    // Spread multiplier: outer primaries open more
    primaries.push({ pivot, angle, spreadMul: lerp(0.6, 1.4, k) })
  }

  return { root, elbow, wrist, primaries }
}

// ============================================================================
// Body
// ============================================================================
function buildBodyGeometry(palette: BirdPalette): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 30) // higher res for smoother shading
  const pos = g.attributes.position
  const colors = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    // Egg-shaped body: wider in front (chest), tapered tail
    let rx = 0.118
    let ry = 0.125
    if (uz > 0) {
      // Front (chest): narrower, rounded
      rx *= 1 - 0.66 * uz * uz
      ry *= 1 - 0.58 * uz * uz
    } else {
      // Back (tail): elongated
      rx *= 1 - 0.16 * uz * uz
      ry *= 1 - 0.1 * uz * uz
    }
    // Belly bulges slightly
    const belly = uy < 0 ? 1.08 + 0.04 * sstep(0, -0.5, uy) : 1

    pos.setXYZ(i, ux * rx, uy * ry * belly - 0.005, uz * 0.31)

    // ---- Color blending ----
    const dorsal = sstep(-0.15, 0.55, uy)
    const ang = Math.atan2(ux, uy)

    // Base: breast → belly gradient (front to back)
    let c = mixC(palette.breast, palette.belly, sstep(0.1, 0.9, uz))

    // Throat patch (front-bottom)
    c = mixC(
      c,
      palette.throat,
      sstep(-0.5, -0.9, uz) * sstep(0.3, -0.2, uy),
    )

    // Streaks on flank (diagonal hash pattern)
    const streakZone = sstep(-0.5, -0.82, uz) * sstep(0.2, -0.5, uy)
    const streakPattern = hash(Math.round(ang * 9), 3, 1) > 0.5 ? 0.55 : 0
    c = mixC(c, palette.streak, streakZone * streakPattern)

    // Dorsal (back) with feather texture
    const backMix = mixC(
      palette.back,
      palette.backLight,
      hash(Math.round(uz * 12), Math.round(ang * 6), 4),
    )
    c = mixC(c, backMix, dorsal)

    // Subtle per-vertex noise for organic look
    const noise = 0.92 + 0.16 * hash(i, 5, 9)
    colors[i * 3] = c[0] * noise
    colors[i * 3 + 1] = c[1] * noise
    colors[i * 3 + 2] = c[2] * noise
  }

  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

// ============================================================================
// Head (with detailed beak and eyes)
// ============================================================================
function buildHead(palette: BirdPalette): THREE.Group {
  const head = new THREE.Group()

  // ---- Skull ----
  const hg = new THREE.SphereGeometry(1, 32, 24)
  const pos = hg.attributes.position
  const col = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    // Slightly oval, with brow ridge
    let sx = 0.088
    let sy = 0.086
    let sz = 0.098
    // Flatten forehead slightly
    if (uy > 0.5) sy *= 1 - 0.08 * (uy - 0.5)
    // Cheek bulge
    if (uz > 0 && Math.abs(ux) > 0.3) sz *= 1.02

    pos.setXYZ(i, ux * sx, uy * sy, uz * sz)

    // Color: crown darker, face lighter
    let c = mixC(palette.throat, palette.backLight, sstep(-0.3, 0.45, uy))
    c = mixC(c, palette.back, sstep(0.45, 0.95, uy))

    // Malar stripe (cheek)
    const malar = sstep(0.6, 0.9, Math.abs(ux)) * sstep(0.1, -0.5, uy) * sstep(-0.9, -0.2, -uz)
    c = mixC(c, palette.streak, malar * 0.8)

    // Supercilium (eyebrow)
    const superc = sstep(0.5, 0.8, uy) * sstep(0.4, 0.7, Math.abs(ux)) * sstep(-0.2, -0.7, uz)
    c = mixC(c, palette.belly, superc * 0.3)

    const n = 0.92 + 0.16 * hash(i, 2, 8)
    col[i * 3] = c[0] * n
    col[i * 3 + 1] = c[1] * n
    col[i * 3 + 2] = c[2] * n
  }
  hg.setAttribute('color', new THREE.BufferAttribute(col, 3))
  hg.computeVertexNormals()
  head.add(new THREE.Mesh(hg, bodyMat))

  // ---- Beak (upper + lower mandible with culmen) ----
  const beakColor = new THREE.Color().setRGB(...palette.beak, THREE.LinearSRGBColorSpace)
  const beakMat = new THREE.MeshStandardMaterial({
    color: beakColor,
    roughness: 0.42,
    metalness: 0.05,
    envMapIntensity: 0.8,
  })

  // Upper mandible: cone with slight culmen curve
  const upperGeo = new THREE.ConeGeometry(0.034, 0.13, 12, 1, false)
  upperGeo.rotateX(-Math.PI / 2)
  // Bend the culmen (top ridge) slightly downward
  {
    const p = upperGeo.attributes.position
    for (let i = 0; i < p.count; i += 1) {
      const z = p.getZ(i)
      const y = p.getY(i)
      if (y > 0) p.setY(i, y - 0.015 * (z / 0.065) ** 2)
    }
    upperGeo.computeVertexNormals()
  }
  const upper = new THREE.Mesh(upperGeo, beakMat)
  upper.scale.set(1, 1, 0.78)
  upper.position.set(0, 0.005, -0.155)

  // Lower mandible (slightly shorter, flatter)
  const lowerGeo = new THREE.ConeGeometry(0.026, 0.1, 10, 1, false)
  lowerGeo.rotateX(-Math.PI / 2)
  const lower = new THREE.Mesh(lowerGeo, beakMat)
  lower.scale.set(1, 0.85, 0.7)
  lower.position.set(0, -0.014, -0.142)

  // Nostril (small dark indentation)
  const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x1a0d08 })
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 5), nostrilMat)
    nostril.position.set(side * 0.018, 0.012, -0.105)
    head.add(nostril)
  }

  head.add(upper, lower)

  // ---- Eyes (sclera, iris, pupil, glint, orbital ring) ----
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.12, metalness: 0.15 })
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...palette.eyeRing, THREE.LinearSRGBColorSpace),
    roughness: 0.55,
  })
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const eyes: THREE.Mesh[] = []

  for (const side of [-1, 1]) {
    // Eye socket (slight darkening)
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x0a0805, roughness: 0.9 }),
    )
    socket.position.set(side * 0.072, 0.014, -0.042)
    head.add(socket)

    // Eyeball
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), eyeMat)
    eye.position.set(side * 0.074, 0.014, -0.045)
    head.add(eye)
    eyes.push(eye)

    // Orbital ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0065, 8, 24), ringMat)
    ring.rotation.y = Math.PI / 2
    ring.position.set(side * 0.071, 0.014, -0.045)
    head.add(ring)

    // Specular glint (fixed in world-ish, gives life)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), shine)
    glint.position.set(side * 0.083, 0.023, -0.055)
    head.add(glint)
  }

  return Object.assign(head, { userData: { eyes } })
}

// ============================================================================
// Public pose type
// ============================================================================
export type BirdPose = {
  flapPhase: number
  flapping: boolean
  speed: number
  pitch: number
  roll: number
  bank: number
  stalled: boolean
  grounded: boolean
  soaring: boolean
  boosting: boolean
  walking: boolean
}

// ============================================================================
// Bird class
// ============================================================================
export class Bird {
  readonly group = new THREE.Group()
  readonly species: BirdSpecies
  readonly body: THREE.Mesh
  readonly head: THREE.Group
  readonly tail = new THREE.Group()
  readonly legs: THREE.Group[] = []
  readonly wingR: Wing
  readonly wingL: Wing

  private readonly wingGroupR = new THREE.Group()
  private readonly wingGroupL = new THREE.Group()
  private readonly tailFeathers: THREE.Mesh[] = []
  private readonly rig = new THREE.Group()

  // Animation state (smoothed)
  private flapWeight = 0
  private fold = 0
  private dive = 0
  private spreadTail = 0.6
  private time = Math.random() * 10
  private blink = 3
  private blinkDir = 1
  private headRoll = 0
  private headPitch = 0
  private legTuck = 1
  private bob = 0
  private phase = 0
  private breathe = 0
  private lastPitch = 0

  constructor(species: BirdSpecies = getBirdSpecies(DEFAULT_BIRD_ID)) {
    this.species = species
    this.group.add(this.rig)

    // ---- Body ----
    this.body = new THREE.Mesh(buildBodyGeometry(species.palette), bodyMat)
    this.body.scale.setScalar(species.bodyScale)
    this.body.castShadow = true
    this.rig.add(this.body)

    // ---- Head ----
    this.head = buildHead(species.palette)
    this.head.scale.setScalar(species.headScale)
    this.head.position.set(0, 0.085, -0.3)
    this.rig.add(this.head)

    // ---- Wings ----
    this.wingR = buildWing(species.palette)
    this.wingL = buildWing(species.palette)
    this.wingGroupR.add(this.wingR.root)
    this.wingGroupL.add(this.wingL.root)
    this.wingGroupR.position.set(0.09, 0.05, -0.06)
    this.wingGroupL.position.set(-0.09, 0.05, -0.06)
    this.wingGroupR.scale.x = species.wingSpan
    this.wingGroupL.scale.x = -species.wingSpan
    this.rig.add(this.wingGroupR, this.wingGroupL)

    // ---- Tail (fan of rectrices) ----
    this.tail.position.set(0, 0.01, 0.27)
    for (let i = 0; i < 9; i += 1) {
      const k = i / 8
      const g = featherGeometry({
        len: 0.36 - Math.abs(k - 0.5) * 0.03,
        width: 0.085,
        base: species.palette.wingDark,
        tip: species.palette.wingMid,
        edge: species.palette.wingEdge,
        droop: 0.04,
        camber: 0.3,
        rows: 9,
        seed: i * 5 + 500,
      })
      const m = new THREE.Mesh(g, featherMat)
      m.position.y = i * 0.0012
      this.tail.add(m)
      this.tailFeathers.push(m)
    }
    this.rig.add(this.tail)

    // ---- Legs ----
    const legMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.55, 0.3, 0.2, THREE.LinearSRGBColorSpace),
      roughness: 0.68,
      metalness: 0.05,
    })
    for (const side of [-1, 1]) {
      const leg = new THREE.Group()
      leg.position.set(side * 0.05, -0.1, 0.06)

      // Tarsus
      const tarsus = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0065, 0.13, 8), legMat)
      tarsus.position.y = -0.065
      leg.add(tarsus)

      // Toes (3 forward + 1 back)
      const toeAngles = [-0.5, 0, 0.5]
      for (const toe of toeAngles) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.05, 6), legMat)
        t.rotation.x = Math.PI / 2
        t.rotation.z = toe
        t.position.set(Math.sin(toe) * -0.02, -0.13, -0.022)
        leg.add(t)
      }
      // Hallux (back toe)
      const hallux = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.03, 6), legMat)
      hallux.rotation.x = Math.PI / 2
      hallux.position.set(0, -0.13, 0.012)
      leg.add(hallux)

      this.rig.add(leg)
      this.legs.push(leg)
    }

    this.group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        ;(o as THREE.Mesh).castShadow = true
        ;(o as THREE.Mesh).receiveShadow = true
      }
    })
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      geometries.add(mesh.geometry)
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (m !== featherMat && m !== bodyMat) materials.add(m)
      }
    })
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
  }

  update(dt: number, p: BirdPose): void {
    this.time += dt
    const targetFlap = p.flapping ? 1 : 0
    this.flapWeight += (targetFlap - this.flapWeight) * Math.min(1, dt * 14)
    this.fold += ((p.grounded ? 1 : 0) - this.fold) * Math.min(1, dt * 7)

    const diveT = clamp(-p.pitch / 0.85, 0, 1) * sstep(10, 24, p.speed)
    this.dive += (diveT - this.dive) * Math.min(1, dt * 6)
    this.phase = p.flapPhase

    // ---- Glide pose ----
    const glide = {
      sz: 0.10, sy: -0.06, sx: 0,
      ez: -0.07, ey: -0.10,
      wz: -0.12, wy: -0.14,
      spread: 1.0,
    }
    if (p.soaring) {
      // Soaring: wings fully extended, flat, with slight dihedral
      glide.sz = 0.16
      glide.wz = 0.06
      glide.spread = 1.20
      glide.sy = 0.02
      glide.wy = -0.02
      glide.sx = -0.02
    }

    // Passive flutter (turbulence)
    const flutter = Math.sin(this.time * 7.3) * 0.02 + Math.sin(this.time * 3.1) * 0.015
    glide.sz += flutter
    glide.wz += flutter * 1.4
    glide.sx += flutter * 0.3

    // ---- Flap cycle ----
    // More realistic: strong downstroke (0-0.45), quick recovery (0.45-1)
    const phi = clamp(this.phase, 0, 0.9999)
    let s: number, u: number
    if (phi < 0.45) {
      // Downstroke: cos curve, 0→1→0 (wing goes down then starts up)
      const t = phi / 0.45
      s = Math.cos(Math.PI * t)
      u = Math.sin(Math.PI * t) * 0.3
    } else {
      // Upstroke: fast recovery with overshoot
      const t = (phi - 0.45) / 0.55
      s = -Math.cos(Math.PI * t)
      u = Math.sin(Math.PI * t) * 0.7
    }
    const amp = p.boosting ? 1.15 : 1
    const flap = {
      sz: 0.08 + 0.64 * s * amp,
      sy: -0.10 - 0.10 * u,
      sx: -0.22 * s,
      ez: -0.08 - 0.95 * u,
      ey: -0.10 - 0.30 * u,
      wz: -0.10 + 0.34 * Math.sin((Math.PI * clamp(phi / 0.45, 0, 1))) - 1.25 * u,
      wy: -0.14 - 0.20 * u,
      spread: 1 - 0.5 * u,
    }

    // ---- Blend glide ↔ flap ----
    const w = this.flapWeight
    let sz = lerp(glide.sz, flap.sz, w)
    let sy = lerp(glide.sy, flap.sy, w)
    let sx = lerp(glide.sx, flap.sx, w)
    let ez = lerp(glide.ez, flap.ez, w)
    let ey = lerp(glide.ey, flap.ey, w)
    let wz = lerp(glide.wz, flap.wz, w)
    let wy = lerp(glide.wy, flap.wy, w)
    let spread = lerp(glide.spread, flap.spread, w)

    // ---- Dive: wings swept back ----
    const d = this.dive
    sy += -0.95 * d
    ey += -0.35 * d
    wy += -0.55 * d
    sz += -0.22 * d
    wz += -0.45 * d
    spread = lerp(spread, 0.35, d)

    // ---- Stall: wings open and fluttering ----
    if (p.stalled) {
      spread = 1.25
      sz += Math.sin(this.time * 22) * 0.18
      wz += Math.sin(this.time * 22 + 1) * 0.3
      sx += Math.sin(this.time * 18 + 2) * 0.08
    }

    // ---- Folded (grounded) ----
    const f = this.fold
    sz = lerp(sz, -0.38, f)
    sy = lerp(sy, -1.38, f)
    sx = lerp(sx, 0, f)
    ez = lerp(ez, 0.0, f)
    ey = lerp(ey, 2.6, f)
    wz = lerp(wz, 0, f)
    wy = lerp(wy, -2.65, f)
    spread = lerp(spread, 0.12, f)

    // ---- Apply to wings ----
    for (const wing of [this.wingR, this.wingL]) {
      wing.root.rotation.set(sx, sy, sz, 'YXZ')
      wing.elbow.rotation.set(0, ey, ez, 'YXZ')
      wing.wrist.rotation.set(0, wy, wz, 'YXZ')

      for (let i = 0; i < wing.primaries.length; i += 1) {
        const pr = wing.primaries[i]
        // Spread modulates splay; outer primaries react more
        pr.pivot.rotation.y = -pr.angle * spread * pr.spreadMul
        // Soaring: primaries curl up at tips ("digits")
        if (p.soaring) {
          pr.pivot.rotation.z = 0.06 + i * 0.015
          pr.pivot.rotation.x = 0.02 + i * 0.005
        } else {
          // In flap: primaries twist for thrust
          const twist = w * Math.sin((Math.PI * phi) / 0.45) * 0.15
          pr.pivot.rotation.z = twist
          pr.pivot.rotation.x = 0
        }
      }
    }

    // ---- Tail ----
    const slow = sstep(13, 6, p.speed)
    const targetTail = clamp(
      0.55 + slow * 0.8 - this.dive * 0.5 + (p.grounded ? -0.2 : 0),
      0.1, 1.4,
    )
    this.spreadTail += (targetTail - this.spreadTail) * Math.min(1, dt * 5)

    for (let i = 0; i < this.tailFeathers.length; i += 1) {
      const k = i - (this.tailFeathers.length - 1) / 2
      this.tailFeathers[i].rotation.y = -Math.PI / 2 - k * 0.095 * this.spreadTail
    }

    const pitchRate = (p.pitch - this.lastPitch) / Math.max(dt, 0.001)
    this.lastPitch = p.pitch

    this.tail.rotation.x =
      clamp(-p.pitch * 0.25, -0.3, 0.3)
      + (0.1 + slow * 0.5) * (p.grounded ? 0.2 : 1) * (1 - this.dive)
      - 0.08
      + (p.grounded ? 0.15 : 0)
      + clamp(-pitchRate * 0.08, -0.15, 0.15) // inertia from pitch changes
    this.tail.rotation.z = clamp(-p.bank * 0.12, -0.2, 0.2)

    // ---- Legs ----
    const tuckTarget = p.grounded ? 0 : 1
    this.legTuck += (tuckTarget - this.legTuck) * Math.min(1, dt * 6)
    const legAngle = lerp(0.05, -1.5, this.legTuck)
    const stride = p.walking ? Math.sin(this.time * 10) * 0.5 : 0
    this.legs[0].rotation.x = legAngle + stride
    this.legs[1].rotation.x = legAngle - stride

    // ---- Body bob (driven by wingbeat) ----
    const bobTarget = this.flapWeight * (phi < 0.45
      ? Math.sin((Math.PI * phi) / 0.45) * 0.028
      : -0.012)
    this.bob += (bobTarget - this.bob) * Math.min(1, dt * 18)
    this.body.position.y = this.bob

    // Breathing (subtle when grounded)
    this.breathe += dt * 2.2
    const breatheAmt = p.grounded ? Math.sin(this.breathe) * 0.0015 : 0
    this.body.scale.y = 1 + breatheAmt
    this.body.scale.z = 1 + breatheAmt * 0.5

    this.rig.position.y = p.grounded ? -0.01 : 0
    this.body.rotation.x = -this.bob * 1.2 - p.pitch * 0.05

    // ---- Head stabilization (gaze stabilization) ----
    // Real birds keep their heads remarkably stable while the body moves
    const headTargetRoll = clamp(p.bank, -1, 1) * -0.25
    this.headRoll += (headTargetRoll - this.headRoll) * Math.min(1, dt * 5)

    const headTargetPitch = -p.pitch * 0.55 * (p.grounded ? 0 : 1) + (p.grounded ? 0.12 : 0)
    this.headPitch += (headTargetPitch - this.headPitch) * Math.min(1, dt * 6)

    this.head.rotation.set(
      this.headPitch - this.body.rotation.x * 1.5,
      this.headRoll,
      -p.roll * 0.35,
      'YXZ',
    )

    // Head bob when grounded (foraging behavior)
    const headY = 0.085 + (p.grounded ? Math.sin(this.time * 1.6) * 0.002 : 0)
    this.head.position.y += (headY - this.head.position.y) * Math.min(1, dt * 8)

    // ---- Blink (with smooth open/close) ----
    this.blink -= dt * this.blinkDir
    const eyes = (this.head.userData as { eyes: THREE.Mesh[] }).eyes
    let eyeScale = 1
    if (this.blink < 0.15 && this.blink > 0) {
      // Smooth close then open
      const t = this.blink / 0.15
      eyeScale = 0.12 + 0.88 * Math.abs(t - 0.5) * 2
    } else if (this.blink <= 0) {
      this.blinkDir = -1
      this.blink = 0.15
      if (Math.random() < 0.3) {
        // Occasional double-blink
        this.blink = 0.12
      }
    } else if (this.blink >= 0.15 && this.blinkDir === -1) {
      this.blinkDir = 1
      this.blink = 2.5 + Math.random() * 4
    } else if (this.blink > 0.15) {
      this.blinkDir = 1
    }
    for (const e of eyes) e.scale.y = eyeScale
  }
}
