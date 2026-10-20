import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEFAULT_BIRD_ID, getBirdSpecies, type BirdPalette, type BirdSpecies, type RGB } from './birdSpecies'

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const mixColor = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]
const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function featherGeometry(len: number, width: number, base: RGB, tip: RGB, edge: RGB, droop = 0.05, rows = 7): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= rows; i += 1) {
    const t = i / rows
    let profile = 1
    if (t < 0.14) profile = 0.5 + 0.5 * (t / 0.14)
    else if (t > 0.78) profile = 0.18 + 0.82 * Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2))

    const halfWidth = 0.5 * width * profile
    const y = -droop * t * t
    const body = mixColor(base, tip, smoothstep(0.45, 1, t))
    const edged = mixColor(body, edge, 0.38)

    positions.push(t * len, y, -halfWidth, t * len, y + 0.004, 0, t * len, y, halfWidth)
    colors.push(...edged, ...mixColor(body, [body[0] * 0.55, body[1] * 0.55, body[2] * 0.55], 0.5), ...edged)

    if (i < rows) {
      const a = i * 3
      const b = a + 3
      indices.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function patchGeometry(len: number, front: number, back: number, color: RGB): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = [0, 0, front, len, 0, front * 0.7, len, 0, back * 0.8, 0, 0, back]
  const colors: number[] = []
  for (let i = 0; i < 4; i += 1) colors.push(...color)

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  geometry.computeVertexNormals()
  return geometry
}

const transformMatrix = new THREE.Matrix4()
const transformQuaternion = new THREE.Quaternion()
const transformEuler = new THREE.Euler()

function baked(geometry: THREE.BufferGeometry, x: number, y: number, z: number, ry: number, rz = 0): THREE.BufferGeometry {
  transformEuler.set(0, ry, rz, 'YXZ')
  transformQuaternion.setFromEuler(transformEuler)
  transformMatrix.compose(new THREE.Vector3(x, y, z), transformQuaternion, new THREE.Vector3(1, 1, 1))

  const cloned = geometry.clone()
  cloned.applyMatrix4(transformMatrix)
  return cloned
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

  const arm: THREE.BufferGeometry[] = [patchGeometry(0.25, -0.05, 0.11, covertBase)]
  for (let i = 0; i < 5; i += 1) {
    const x = 0.03 + i * 0.045
    arm.push(baked(featherGeometry(0.19 - i * 0.012, 0.062, palette.wingMid, palette.wingEdge, palette.wingEdge, 0.03), x, 0.004, 0.02, -(1.5 - i * 0.04)))
  }
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 6; i += 1) {
      const x = 0.015 + i * 0.043
      const geometry = featherGeometry(0.1 - row * 0.012, 0.052, row === 0 ? palette.wingMid : covertBase, palette.wingEdge, palette.wingEdge, 0.03, 4)
      arm.push(baked(geometry, x, 0.008 + row * 0.003, -0.045 + row * 0.04, -(1.35 + (hash(i, row, 1) - 0.5) * 0.18)))
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(arm)!, featherMat))

  const fore: THREE.BufferGeometry[] = [patchGeometry(0.21, -0.04, 0.09, covertBase)]
  for (let i = 0; i < 9; i += 1) {
    const x = 0.005 + i * 0.023
    fore.push(baked(featherGeometry(0.21 - i * 0.002, 0.052, palette.wingDark, palette.wingEdge, palette.wingEdge, 0.035), x, 0.0, 0.015, -(1.2 + i * 0.026)))
  }
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 8; i += 1) {
      const x = 0.01 + i * 0.026
      const geometry = featherGeometry(0.1 - row * 0.012, 0.045, row === 0 ? palette.wingMid : covertBase, palette.wingEdge, palette.wingEdge, 0.03, 4)
      fore.push(baked(geometry, x, 0.007 + row * 0.003, -0.04 + row * 0.035, -(1.25 + (hash(i, row, 2) - 0.5) * 0.15)))
    }
  }
  elbow.add(new THREE.Mesh(mergeGeometries(fore)!, featherMat))

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
    const length = lerp(0.3, 0.18, k) * (i === 0 ? 0.88 : 1)
    pivot.add(new THREE.Mesh(featherGeometry(length, lerp(0.036, 0.046, k), palette.wingDark, palette.wingMid, palette.wingEdge, lerp(0.05, 0.03, k)), featherMat))
    wrist.add(pivot)
    primaries.push({ pivot, angle })
  }

  return { root, elbow, wrist, primaries }
}

function buildBodyGeometry(palette: BirdPalette): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 36, 26)
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)

  for (let i = 0; i < positions.count; i += 1) {
    const ux = positions.getX(i)
    const uy = positions.getY(i)
    const uz = positions.getZ(i)

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
    positions.setXYZ(i, ux * rx, uy * ry * belly - 0.005, uz * 0.31)

    const dorsal = smoothstep(-0.15, 0.55, uy)
    const ang = Math.atan2(ux, uy)
    let color = mixColor(palette.breast, palette.belly, smoothstep(0.1, 0.9, uz))
    color = mixColor(color, palette.throat, smoothstep(-0.5, -0.9, uz) * smoothstep(0.3, -0.2, uy))

    const streak = smoothstep(-0.5, -0.82, uz) * smoothstep(0.2, -0.5, uy) * (hash(Math.round(ang * 9), 3, 1) > 0.5 ? 0.55 : 0)
    color = mixColor(color, palette.streak, streak)
    color = mixColor(color, mixColor(palette.back, palette.backLight, hash(Math.round(uz * 12), Math.round(ang * 6), 4)), dorsal)

    const noise = 0.9 + 0.2 * hash(i, 5, 9)
    colors[i * 3] = color[0] * noise
    colors[i * 3 + 1] = color[1] * noise
    colors[i * 3 + 2] = color[2] * noise
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function buildHead(palette: BirdPalette): THREE.Group & { userData: { eyes: THREE.Mesh[] } } {
  const head = new THREE.Group()
  const geometry = new THREE.SphereGeometry(1, 28, 20)
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)

  for (let i = 0; i < positions.count; i += 1) {
    const ux = positions.getX(i)
    const uy = positions.getY(i)
    const uz = positions.getZ(i)
    positions.setXYZ(i, ux * 0.088, uy * 0.086, uz * 0.098)

    let color = mixColor(palette.throat, palette.backLight, smoothstep(-0.3, 0.45, uy))
    color = mixColor(color, palette.back, smoothstep(0.45, 0.95, uy))
    const malar = smoothstep(0.6, 0.9, Math.abs(ux)) * smoothstep(0.1, -0.5, uy) * smoothstep(-0.9, -0.2, -uz)
    color = mixColor(color, palette.streak, malar * 0.8)

    const variation = 0.92 + 0.16 * hash(i, 2, 8)
    colors[i * 3] = color[0] * variation
    colors[i * 3 + 1] = color[1] * variation
    colors[i * 3 + 2] = color[2] * variation
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  head.add(new THREE.Mesh(geometry, bodyMat))

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
  readonly head: THREE.Group & { userData: { eyes: THREE.Mesh[] } }
  readonly tail = new THREE.Group()
  readonly legs: THREE.Group[] = []
  readonly wingR: Wing
  readonly wingL: Wing
  readonly wings: readonly [Wing, Wing]
  private readonly wingGroupR = new THREE.Group()
  private readonly wingGroupL = new THREE.Group()
  private readonly tailFeathers: THREE.Mesh[] = []
  private readonly rig = new THREE.Group()
  private readonly eyes: THREE.Mesh[]
  private flapWeight = 0
  private fold = 0
  private dive = 0
  private spreadTail = 0.6
  private time = Math.random() * 10
  private blink = 3
  private headRoll = 0
  private legTuck = 1
  private bob = 0
  private phase = 0

  constructor(species: BirdSpecies = getBirdSpecies(DEFAULT_BIRD_ID)) {
    this.species = species
    this.group.name = 'bird'
    this.group.add(this.rig)

    this.body = new THREE.Mesh(buildBodyGeometry(species.palette), bodyMat)
    this.body.scale.setScalar(species.bodyScale)
    this.body.castShadow = true
    this.rig.add(this.body)

    this.head = buildHead(species.palette)
    this.head.scale.setScalar(species.headScale)
    this.head.position.set(0, 0.085, -0.3)
    this.rig.add(this.head)
    this.eyes = this.head.userData.eyes

    this.wingR = buildWing(species.palette)
    this.wingL = buildWing(species.palette)
    this.wings = [this.wingR, this.wingL]
    this.wingGroupR.add(this.wingR.root)
    this.wingGroupL.add(this.wingL.root)
    this.wingGroupR.position.set(0.09, 0.05, -0.06)
    this.wingGroupL.position.set(-0.09, 0.05, -0.06)
    this.wingGroupR.scale.x = species.wingSpan
    this.wingGroupL.scale.x = -species.wingSpan
    this.rig.add(this.wingGroupR, this.wingGroupL)

    this.tail.position.set(0, 0.01, 0.27)
    const tailGeometry = featherGeometry(0.36, 0.085, species.palette.wingDark, species.palette.wingMid, species.palette.wingEdge, 0.04, 8)
    for (let i = 0; i < 9; i += 1) {
      const feather = new THREE.Mesh(tailGeometry, featherMat)
      feather.position.y = i * 0.0012
      this.tail.add(feather)
      this.tailFeathers.push(feather)
    }
    this.rig.add(this.tail)

    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.55, 0.3, 0.2, THREE.LinearSRGBColorSpace), roughness: 0.7 })
    for (const side of [-1, 1]) {
      const leg = new THREE.Group()
      leg.position.set(side * 0.05, -0.1, 0.06)

      const tarsus = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0065, 0.13, 6), legMat)
      tarsus.position.y = -0.065
      leg.add(tarsus)

      for (const toe of [-0.5, 0, 0.5]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.05, 5), legMat)
        foot.rotation.x = Math.PI / 2
        foot.rotation.z = toe
        foot.position.set(Math.sin(toe) * -0.02, -0.13, -0.022)
        leg.add(foot)
      }

      this.rig.add(leg)
      this.legs.push(leg)
    }

    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) mesh.castShadow = true
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

  private updateWingPose(p: BirdPose, pose: {
    sx: number
    sy: number
    sz: number
    ey: number
    ez: number
    wy: number
    wz: number
    spread: number
  }): void {
    for (const wing of this.wings) {
      wing.root.rotation.set(pose.sx, pose.sy, pose.sz, 'YXZ')
      wing.elbow.rotation.set(0, pose.ey, pose.ez, 'YXZ')
      wing.wrist.rotation.set(0, pose.wy, pose.wz, 'YXZ')
      for (const [index, primary] of wing.primaries.entries()) {
        primary.pivot.rotation.y = -primary.angle * pose.spread
        primary.pivot.rotation.z = p.soaring ? 0.06 + index * 0.012 : 0
      }
    }
  }

  private updateTailPose(p: BirdPose, dt: number): void {
    const slow = smoothstep(13, 6, p.speed)
    const targetTail = clamp(0.55 + slow * 0.8 - this.dive * 0.5 + (p.grounded ? -0.2 : 0), 0.1, 1.4)
    this.spreadTail += (targetTail - this.spreadTail) * Math.min(1, dt * 5)

    for (const [index, feather] of this.tailFeathers.entries()) {
      const offset = index - (this.tailFeathers.length - 1) / 2
      feather.rotation.y = -Math.PI / 2 - offset * 0.095 * this.spreadTail
    }

    this.tail.rotation.x = clamp(-p.pitch * 0.25, -0.3, 0.3) + (0.1 + slow * 0.5) * (p.grounded ? 0.2 : 1) * (1 - this.dive) - 0.08 + (p.grounded ? 0.15 : 0)
    this.tail.rotation.z = clamp(-p.bank * 0.12, -0.2, 0.2)
  }

  private updateLegPose(p: BirdPose, dt: number): void {
    const tuckTarget = p.grounded ? 0 : 1
    this.legTuck += (tuckTarget - this.legTuck) * Math.min(1, dt * 6)
    const legAngle = lerp(0.05, -1.5, this.legTuck)
    const stride = p.walking ? Math.sin(this.time * 10) * 0.5 : 0

    this.legs[0].rotation.x = legAngle + stride
    this.legs[1].rotation.x = legAngle - stride
  }

  private updateBlink(dt: number): void {
    this.blink -= dt
    const closed = this.blink < 0.1 && this.blink > 0
    for (const eye of this.eyes) eye.scale.y = closed ? 0.12 : 1
    if (this.blink <= 0) this.blink = 2.5 + Math.random() * 4
  }

  update(dt: number, p: BirdPose): void {
    this.time += dt

    const targetFlap = p.flapping ? 1 : 0
    this.flapWeight += (targetFlap - this.flapWeight) * Math.min(1, dt * 14)
    this.fold += ((p.grounded ? 1 : 0) - this.fold) * Math.min(1, dt * 7)

    const diveTarget = clamp(-p.pitch / 0.85, 0, 1) * smoothstep(10, 24, p.speed)
    this.dive += (diveTarget - this.dive) * Math.min(1, dt * 6)
    this.phase = p.flapPhase

    const glide = {
      sz: 0.1,
      sy: -0.06,
      sx: 0,
      ez: -0.07,
      ey: -0.1,
      wz: -0.12,
      wy: -0.14,
      spread: 1.0,
    }

    if (p.soaring) {
      glide.sz = 0.16
      glide.wz = 0.06
      glide.spread = 1.18
      glide.sy = 0.02
      glide.wy = -0.02
    }

    const flutter = Math.sin(this.time * 7.3) * 0.02 + Math.sin(this.time * 3.1) * 0.015
    glide.sz += flutter
    glide.wz += flutter * 1.4

    const phi = clamp(this.phase, 0, 0.9999)
    const flapFactor = phi < 0.45 ? Math.cos((Math.PI * phi) / 0.45) : -Math.cos((Math.PI * (phi - 0.45)) / 0.55)
    const flapLift = phi > 0.45 ? Math.sin((Math.PI * (phi - 0.45)) / 0.55) : 0
    const amplitude = p.boosting ? 1.15 : 1

    const flap = {
      sz: 0.08 + 0.64 * flapFactor * amplitude,
      sy: -0.1 - 0.1 * flapLift,
      sx: -0.22 * flapFactor,
      ez: -0.08 - 0.95 * flapLift,
      ey: -0.1 - 0.3 * flapLift,
      wz: -0.1 + 0.34 * Math.sin((Math.PI * clamp(phi / 0.45, 0, 1))) - 1.25 * flapLift,
      wy: -0.14 - 0.2 * flapLift,
      spread: 1 - 0.5 * flapLift,
    }

    const pose = {
      sx: lerp(glide.sx, flap.sx, this.flapWeight),
      sy: lerp(glide.sy, flap.sy, this.flapWeight),
      sz: lerp(glide.sz, flap.sz, this.flapWeight),
      ez: lerp(glide.ez, flap.ez, this.flapWeight),
      ey: lerp(glide.ey, flap.ey, this.flapWeight),
      wz: lerp(glide.wz, flap.wz, this.flapWeight),
      wy: lerp(glide.wy, flap.wy, this.flapWeight),
      spread: lerp(glide.spread, flap.spread, this.flapWeight),
    }

    const dive = this.dive
    pose.sy += -0.95 * dive
    pose.ey += -0.35 * dive
    pose.wy += -0.55 * dive
    pose.sz += -0.22 * dive
    pose.wz += -0.45 * dive
    pose.spread = lerp(pose.spread, 0.35, dive)

    if (p.stalled) {
      pose.spread = 1.25
      pose.sz += Math.sin(this.time * 22) * 0.18
      pose.wz += Math.sin(this.time * 22 + 1) * 0.3
    }

    const groundedBlend = this.fold
    pose.sz = lerp(pose.sz, -0.38, groundedBlend)
    pose.sy = lerp(pose.sy, -1.38, groundedBlend)
    pose.sx = lerp(pose.sx, 0, groundedBlend)
    pose.ez = lerp(pose.ez, 0.0, groundedBlend)
    pose.ey = lerp(pose.ey, 2.6, groundedBlend)
    pose.wz = lerp(pose.wz, 0, groundedBlend)
    pose.wy = lerp(pose.wy, -2.65, groundedBlend)
    pose.spread = lerp(pose.spread, 0.12, groundedBlend)

    this.updateWingPose(p, pose)
    this.updateTailPose(p, dt)
    this.updateLegPose(p, dt)

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

    this.updateBlink(dt)
  }
}
