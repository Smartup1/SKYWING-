import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEFAULT_BIRD_ID, getBirdSpecies, type BirdPalette, type BirdSpecies, type RGB } from './birdSpecies'

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const mixC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** Pena achatada apontando para +X, ligeiramente curva para baixo, com eixo central. */
function featherGeometry(len: number, width: number, base: RGB, tip: RGB, edge: RGB, droop = 0.05, rows = 7): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= rows; i += 1) {
    const t = i / rows
    let prof = 1
    if (t < 0.14) prof = 0.5 + 0.5 * (t / 0.14)
    else if (t > 0.78) prof = 0.18 + 0.82 * Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2))
    const hw = 0.5 * width * prof
    const y = -droop * t * t
    const body = mixC(base, tip, sstep(0.45, 1, t))
    const edged = mixC(body, edge, 0.38)
    positions.push(t * len, y, -hw, t * len, y + 0.004, 0, t * len, y, hw)
    colors.push(...edged, ...mixC(body, [body[0] * 0.55, body[1] * 0.55, body[2] * 0.55], 0.5), ...edged)
    if (i < rows) {
      const a = i * 3
      const b = a + 3
      indices.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/** Plano trapezoidal que preenche o vão entre as penas de uma asa. */
function patchGeometry(len: number, front: number, back: number, color: RGB): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = [0, 0, front, len, 0, front * 0.7, len, 0, back * 0.8, 0, 0, back]
  const col: number[] = []
  for (let i = 0; i < 4; i += 1) col.push(...color)
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex([0, 2, 1, 0, 3, 2])
  g.computeVertexNormals()
  return g
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
function baked(g: THREE.BufferGeometry, x: number, y: number, z: number, ry: number, rz = 0): THREE.BufferGeometry {
  _e.set(0, ry, rz, 'YXZ')
  _q.setFromEuler(_e)
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1))
  const c = g.clone()
  c.applyMatrix4(_m)
  return c
}

const featherMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })

export type Wing = {
  root: THREE.Group
  elbow: THREE.Group
  wrist: THREE.Group
  primaries: { pivot: THREE.Group; angle: number }[]
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
  // Braço: tercárias, coberteiras e membrana.
  const arm: THREE.BufferGeometry[] = [patchGeometry(0.25, -0.05, 0.11, covertBase)]
  for (let i = 0; i < 5; i += 1) {
    const x = 0.03 + i * 0.045
    arm.push(baked(featherGeometry(0.19 - i * 0.012, 0.062, palette.wingMid, palette.wingEdge, palette.wingEdge, 0.03), x, 0.004, 0.02, -(1.5 - i * 0.04)))
  }
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 6; i += 1) {
      const x = 0.015 + i * 0.043
      const g = featherGeometry(0.1 - row * 0.012, 0.052, row === 0 ? palette.wingMid : covertBase, palette.wingEdge, palette.wingEdge, 0.03, 4)
      arm.push(baked(g, x, 0.008 + row * 0.003, -0.045 + row * 0.04, -(1.35 + (hash(i, row, 1) - 0.5) * 0.18)))
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(arm)!, featherMat))

  // Antebraço: secundárias.
  const fore: THREE.BufferGeometry[] = [patchGeometry(0.21, -0.04, 0.09, covertBase)]
  for (let i = 0; i < 9; i += 1) {
    const x = 0.005 + i * 0.023
    fore.push(baked(featherGeometry(0.21 - i * 0.002, 0.052, palette.wingDark, palette.wingEdge, palette.wingEdge, 0.035), x, 0.0, 0.015, -(1.2 + i * 0.026)))
  }
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 8; i += 1) {
      const x = 0.01 + i * 0.026
      const g = featherGeometry(0.1 - row * 0.012, 0.045, row === 0 ? palette.wingMid : covertBase, palette.wingEdge, palette.wingEdge, 0.03, 4)
      fore.push(baked(g, x, 0.007 + row * 0.003, -0.04 + row * 0.035, -(1.25 + (hash(i, row, 2) - 0.5) * 0.15)))
    }
  }
  elbow.add(new THREE.Mesh(mergeGeometries(fore)!, featherMat))

  // Mão: coberteiras primárias e primárias individuais.
  const hand: THREE.BufferGeometry[] = [patchGeometry(0.14, -0.03, 0.06, covertBase)]
  for (let i = 0; i < 5; i += 1) {
    hand.push(baked(featherGeometry(0.1, 0.04, palette.wingMid, palette.wingEdge, palette.wingEdge, 0.03, 4), 0.01 + i * 0.025, 0.007, -0.01 + i * 0.012, -(0.2 + i * 0.12)))
  }
  wrist.add(new THREE.Mesh(mergeGeometries(hand)!, featherMat))
  const primaries: Wing['primaries'] = []
  for (let i = 0; i < 9; i += 1) {
    const k = i / 8
    const pivot = new THREE.Group()
    pivot.position.set(lerp(0.12, 0.01, k), 0.002, lerp(-0.012, 0.03, k))
    const angle = lerp(0.04, 0.95, k)
    pivot.rotation.y = -angle
    const len = lerp(0.3, 0.18, k) * (i === 0 ? 0.88 : 1)
    pivot.add(new THREE.Mesh(featherGeometry(len, lerp(0.036, 0.046, k), palette.wingDark, palette.wingMid, palette.wingEdge, lerp(0.05, 0.03, k)), featherMat))
    wrist.add(pivot)
    primaries.push({ pivot, angle })
  }
  return { root, elbow, wrist, primaries }
}

function buildBodyGeometry(palette: BirdPalette): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 36, 26)
  const pos = g.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)
    let rx = 0.118
    let ry = 0.125
    if (uz > 0) {
      rx *= 1 - 0.66 * uz * uz
      ry *= 1 - 0.58 * uz * uz
    } else {
      rx *= 1 - 0.16 * uz * uz
      ry *= 1 - 0.1 * uz * uz
    }
    const belly = uy < 0 ? 1.1 : 1
    pos.setXYZ(i, ux * rx, uy * ry * belly - 0.005, uz * 0.31)
    // Cor: dorso marrom, flancos de transição, peito alaranjado, barriga clara, garganta listrada.
    const dorsal = sstep(-0.15, 0.55, uy)
    const ang = Math.atan2(ux, uy)
    let c = mixC(palette.breast, palette.belly, sstep(0.1, 0.9, uz))
    c = mixC(c, palette.throat, sstep(-0.5, -0.9, uz) * sstep(0.3, -0.2, uy))
    const streak = sstep(-0.5, -0.82, uz) * sstep(0.2, -0.5, uy) * (hash(Math.round(ang * 9), 3, 1) > 0.5 ? 0.55 : 0)
    c = mixC(c, palette.streak, streak)
    c = mixC(c, mixC(palette.back, palette.backLight, hash(Math.round(uz * 12), Math.round(ang * 6), 4)), dorsal)
    const noise = 0.9 + 0.2 * hash(i, 5, 9)
    colors[i * 3] = c[0] * noise
    colors[i * 3 + 1] = c[1] * noise
    colors[i * 3 + 2] = c[2] * noise
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

function buildHead(palette: BirdPalette): THREE.Group {
  const head = new THREE.Group()
  const hg = new THREE.SphereGeometry(1, 28, 20)
  const pos = hg.attributes.position
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)
    pos.setXYZ(i, ux * 0.088, uy * 0.086, uz * 0.098)
    let c = mixC(palette.throat, palette.backLight, sstep(-0.3, 0.45, uy))
    c = mixC(c, palette.back, sstep(0.45, 0.95, uy))
    const malar = sstep(0.6, 0.9, Math.abs(ux)) * sstep(0.1, -0.5, uy) * sstep(-0.9, -0.2, -uz)
    c = mixC(c, palette.streak, malar * 0.8)
    const n = 0.92 + 0.16 * hash(i, 2, 8)
    col[i * 3] = c[0] * n
    col[i * 3 + 1] = c[1] * n
    col[i * 3 + 2] = c[2] * n
  }
  hg.setAttribute('color', new THREE.BufferAttribute(col, 3))
  hg.computeVertexNormals()
  head.add(new THREE.Mesh(hg, bodyMat))

  const beakMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...palette.beak, THREE.LinearSRGBColorSpace), roughness: 0.45 })
  const upper = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.125, 10), beakMat)
  upper.rotation.x = -Math.PI / 2
  upper.scale.set(1, 1, 0.78)
  upper.position.set(0, 0.0, -0.152)
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.1, 8), beakMat)
  lower.rotation.x = -Math.PI / 2
  lower.scale.set(1, 1, 0.7)
  lower.position.set(0, -0.016, -0.14)
  head.add(upper, lower)

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.15, metalness: 0.1 })
  const ringMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...palette.eyeRing, THREE.LinearSRGBColorSpace), roughness: 0.6 })
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const eyes: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), eyeMat)
    eye.position.set(side * 0.071, 0.014, -0.045)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0065, 8, 20), ringMat)
    ring.rotation.y = Math.PI / 2
    ring.position.set(side * 0.07, 0.014, -0.045)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 6, 6), shine)
    glint.position.set(side * 0.082, 0.024, -0.054)
    head.add(ring, eye, glint)
    eyes.push(eye)
  }
  return Object.assign(head, { userData: { eyes } })
}

export type BirdPose = {
  flapPhase: number
  flapping: boolean
  /** Velocidade do ar (m/s). */
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

/** Pássaro articulado do jogador. Frente = -Z, topo = +Y. */
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
  private flapWeight = 0
  private fold = 0
  private dive = 0
  private spreadTail = 0.6
  private time = Math.random() * 10
  private blink = 3
  private headRoll = 0
  private legTuck = 1
  private bob = 0
  /** Fase suavizada usada para o movimento das asas. */
  private phase = 0

  constructor(species: BirdSpecies = getBirdSpecies(DEFAULT_BIRD_ID)) {
    this.species = species
    this.group.add(this.rig)
    this.body = new THREE.Mesh(buildBodyGeometry(species.palette), bodyMat)
    this.body.scale.setScalar(species.bodyScale)
    this.body.castShadow = true
    this.rig.add(this.body)

    this.head = buildHead(species.palette)
    this.head.scale.setScalar(species.headScale)
    this.head.position.set(0, 0.085, -0.3)
    this.rig.add(this.head)

    this.wingR = buildWing(species.palette)
    this.wingL = buildWing(species.palette)
    this.wingGroupR.add(this.wingR.root)
    this.wingGroupL.add(this.wingL.root)
    this.wingGroupR.position.set(0.09, 0.05, -0.06)
    this.wingGroupL.position.set(-0.09, 0.05, -0.06)
    this.wingGroupR.scale.x = species.wingSpan
    this.wingGroupL.scale.x = -species.wingSpan
    this.rig.add(this.wingGroupR, this.wingGroupL)

    // Cauda: leque de retrizes.
    this.tail.position.set(0, 0.01, 0.27)
    const tg = featherGeometry(0.36, 0.085, species.palette.wingDark, species.palette.wingMid, species.palette.wingEdge, 0.04, 8)
    for (let i = 0; i < 9; i += 1) {
      const m = new THREE.Mesh(tg, featherMat)
      m.position.y = i * 0.0012
      this.tail.add(m)
      this.tailFeathers.push(m)
    }
    this.rig.add(this.tail)

    // Pernas finas (recolhidas em voo).
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.55, 0.3, 0.2, THREE.LinearSRGBColorSpace), roughness: 0.7 })
    for (const side of [-1, 1]) {
      const leg = new THREE.Group()
      leg.position.set(side * 0.05, -0.1, 0.06)
      const tarsus = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0065, 0.13, 6), legMat)
      tarsus.position.y = -0.065
      leg.add(tarsus)
      for (const toe of [-0.5, 0, 0.5]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.05, 5), legMat)
        t.rotation.x = Math.PI / 2
        t.rotation.z = toe
        t.position.set(Math.sin(toe) * -0.02, -0.13, -0.022)
        leg.add(t)
      }
      this.rig.add(leg)
      this.legs.push(leg)
    }
    this.group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      geometries.add(mesh.geometry)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material !== featherMat && material !== bodyMat) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }

  update(dt: number, p: BirdPose): void {
    this.time += dt
    const targetFlap = p.flapping ? 1 : 0
    this.flapWeight += (targetFlap - this.flapWeight) * Math.min(1, dt * 14)
    this.fold += ((p.grounded ? 1 : 0) - this.fold) * Math.min(1, dt * 7)
    const diveT = clamp(-p.pitch / 0.85, 0, 1) * sstep(10, 24, p.speed)
    this.dive += (diveT - this.dive) * Math.min(1, dt * 6)
    this.phase = p.flapPhase

    // Poses base.
    const glide = {
      sz: 0.1, sy: -0.06, sx: 0,
      ez: -0.07, ey: -0.1,
      wz: -0.12, wy: -0.14,
      spread: 1.0,
    }
    if (p.soaring) {
      glide.sz = 0.16
      glide.wz = 0.06
      glide.spread = 1.18
      glide.sy = 0.02
      glide.wy = -0.02
    }
    // Ondulação sutil das penas no planeio (turbulência).
    const flutter = Math.sin(this.time * 7.3) * 0.02 + Math.sin(this.time * 3.1) * 0.015
    glide.sz += flutter
    glide.wz += flutter * 1.4

    // Ciclo da batida.
    const phi = clamp(this.phase, 0, 0.9999)
    const s = phi < 0.45 ? Math.cos((Math.PI * phi) / 0.45) : -Math.cos((Math.PI * (phi - 0.45)) / 0.55)
    const u = phi > 0.45 ? Math.sin((Math.PI * (phi - 0.45)) / 0.55) : 0
    const amp = p.boosting ? 1.15 : 1
    const flap = {
      sz: 0.08 + 0.64 * s * amp, sy: -0.1 - 0.1 * u, sx: -0.22 * s,
      ez: -0.08 - 0.95 * u, ey: -0.1 - 0.3 * u,
      wz: -0.1 + 0.34 * Math.sin((Math.PI * clamp(phi / 0.45, 0, 1))) - 1.25 * u, wy: -0.14 - 0.2 * u,
      spread: 1 - 0.5 * u,
    }
    const w = this.flapWeight
    let sz = lerp(glide.sz, flap.sz, w)
    let sy = lerp(glide.sy, flap.sy, w)
    let sx = lerp(glide.sx, flap.sx, w)
    let ez = lerp(glide.ez, flap.ez, w)
    let ey = lerp(glide.ey, flap.ey, w)
    let wz = lerp(glide.wz, flap.wz, w)
    let wy = lerp(glide.wy, flap.wy, w)
    let spread = lerp(glide.spread, flap.spread, w)

    // Mergulho: asas varridas para trás.
    const d = this.dive
    sy += -0.95 * d
    ey += -0.35 * d
    wy += -0.55 * d
    sz += -0.22 * d
    wz += -0.45 * d
    spread = lerp(spread, 0.35, d)
    // Estol: asas abertas e agitadas.
    if (p.stalled) {
      spread = 1.25
      sz += Math.sin(this.time * 22) * 0.18
      wz += Math.sin(this.time * 22 + 1) * 0.3
    }
    // Pousado: asas dobradas em Z contra o corpo.
    const f = this.fold
    sz = lerp(sz, -0.38, f)
    sy = lerp(sy, -1.38, f)
    sx = lerp(sx, 0, f)
    ez = lerp(ez, 0.0, f)
    ey = lerp(ey, 2.6, f)
    wz = lerp(wz, 0, f)
    wy = lerp(wy, -2.65, f)
    spread = lerp(spread, 0.12, f)

    for (const wing of [this.wingR, this.wingL]) {
      wing.root.rotation.set(sx, sy, sz, 'YXZ')
      wing.elbow.rotation.set(0, ey, ez, 'YXZ')
      wing.wrist.rotation.set(0, wy, wz, 'YXZ')
      for (const [i, pr] of wing.primaries.entries()) {
        pr.pivot.rotation.y = -pr.angle * spread
        // Pontas individuais "digitam" para cima no planeio de térmica.
        pr.pivot.rotation.z = p.soaring ? 0.06 + i * 0.012 : 0.0
      }
    }

    // Cauda: abre em baixa velocidade/pouso, fecha em mergulho.
    const slow = sstep(13, 6, p.speed)
    const targetTail = clamp(0.55 + slow * 0.8 - this.dive * 0.5 + (p.grounded ? -0.2 : 0), 0.1, 1.4)
    this.spreadTail += (targetTail - this.spreadTail) * Math.min(1, dt * 5)
    for (const [i, f2] of this.tailFeathers.entries()) {
      const k = i - (this.tailFeathers.length - 1) / 2
      f2.rotation.y = -Math.PI / 2 - k * 0.095 * this.spreadTail
    }
    this.tail.rotation.x = clamp(-p.pitch * 0.25, -0.3, 0.3) + (0.1 + slow * 0.5) * (p.grounded ? 0.2 : 1) * (1 - this.dive) - 0.08 + (p.grounded ? 0.15 : 0)
    this.tail.rotation.z = clamp(-p.bank * 0.12, -0.2, 0.2)

    // Pernas recolhidas em voo, estendidas no pouso.
    const tuckTarget = p.grounded ? 0 : 1
    this.legTuck += (tuckTarget - this.legTuck) * Math.min(1, dt * 6)
    const legAngle = lerp(0.05, -1.5, this.legTuck)
    const stride = p.walking ? Math.sin(this.time * 10) * 0.5 : 0
    this.legs[0].rotation.x = legAngle + stride
    this.legs[1].rotation.x = legAngle - stride

    // Corpo balança com cada batida; a cabeça se mantém estável e olha para a curva.
    const bobTarget = this.flapWeight * (phi < 0.45 ? Math.sin((Math.PI * phi) / 0.45) * 0.028 : -0.012)
    this.bob += (bobTarget - this.bob) * Math.min(1, dt * 18)
    this.body.position.y = this.bob
    this.rig.position.y = p.grounded ? -0.01 : 0
    this.body.rotation.x = -this.bob * 1.2
    const headTarget = clamp(p.bank, -1, 1) * -0.25
    this.headRoll += (headTarget - this.headRoll) * Math.min(1, dt * 5)
    this.head.rotation.set(-this.body.rotation.x * 1.5 - p.pitch * 0.15 * (p.grounded ? 0 : 1) + (p.grounded ? 0.12 : 0), this.headRoll, -p.roll * 0.35, 'YXZ')
    if (p.grounded) this.head.position.y = 0.085 + Math.sin(this.time * 1.6) * 0.002
    else this.head.position.y = 0.085

    // Piscar.
    this.blink -= dt
    const eyes = (this.head.userData as { eyes: THREE.Mesh[] }).eyes
    const closed = this.blink < 0.1 && this.blink > 0
    for (const e of eyes) e.scale.y = closed ? 0.12 : 1
    if (this.blink <= 0) this.blink = 2.5 + Math.random() * 4
  }
}
