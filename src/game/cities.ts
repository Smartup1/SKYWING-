import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CityColliders, generateCity, LANE_STEP, localToWorld, type Building, type CityData, type Lane, type Perch } from './cityData'
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, surfaceAt } from './terrain'

// ============================================================================
// Constantes de design de rua
// ============================================================================

/**
 * Dimensões de cada tier viário, em metros.
 * As larguras seguem padrões reais (EUA/BR): avenida 2 faixas + estacionamento,
 * rua residencial 2 faixas, beco 1 faixa.
 */
const ROAD_SPEC = {
  0: { // avenida
    asphalt: 9.0,
    sidewalk: 3.0,
    curbHeight: 0.18,
    laneWidth: 3.5,
    centerLine: 'double-yellow' as const,
    edgeLines: true,
    hasParking: false,
  },
  1: { // rua
    asphalt: 6.4,
    sidewalk: 1.8,
    curbHeight: 0.15,
    laneWidth: 3.0,
    centerLine: 'dashed-white' as const,
    edgeLines: false,
    hasParking: false,
  },
  2: { // beco
    asphalt: 3.2,
    sidewalk: 0,
    curbHeight: 0,
    laneWidth: 3.2,
    centerLine: 'none' as const,
    edgeLines: false,
    hasParking: false,
  },
} as const

// Paleta asfalto
const ASPHALT_DARK = 0x2a2e33   // avenida
const ASPHALT_MID = 0x363b41    // rua
const ASPHALT_LIGHT = 0x45494e  // beco
const SIDEWALK_COLOR = 0x9a978c
const CURB_COLOR = 0xb8b4a8
const LINE_YELLOW = 0xd4b23a
const LINE_WHITE = 0xd8d4c4

// ============================================================================
// Scratch
// ============================================================================

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _col = new THREE.Color()

function composeMatrix(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _v.set(x, y, z)
  _e.set(0, ry, 0)
  _q.setFromEuler(_e)
  return _m.compose(_v, _q, _v.set(sx, sy, sz))
}

// ============================================================================
// Gerador de interseções — quadrados que preenchem os "buracos" nos cruzamentos
// ============================================================================

type Intersection = { x: number; z: number; size: number; tier: 0 | 1 | 2 }

/**
 * Detecta interseções varrendo pares de lanes que se cruzam.
 * Duas lanes são perpendiculares se |dot(dirA, dirB)| < 0.3, e a interseção
 * é o ponto onde as retas se cruzam (com tolerância).
 */
function findIntersections(lanes: readonly Lane[]): Intersection[] {
  const out: Intersection[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lanes.length; i += 1) {
    const a = lanes[i]
    const adx = a.bx - a.ax
    const adz = a.bz - a.az
    const alen = Math.hypot(adx, adz)
    if (alen < 0.1) continue
    const aux = adx / alen, auz = adz / alen

    for (let j = i + 1; j < lanes.length; j += 1) {
      const b = lanes[j]
      // Pula lanes do mesmo "site" com mesmo tier paralelas
      if (Math.abs(a.tier - b.tier) > 1) continue

      const bdx = b.bx - b.ax
      const bdz = b.bz - b.az
      const blen = Math.hypot(bdx, bdz)
      if (blen < 0.1) continue
      const bux = bdx / blen, buz = bdz / blen

      // Ângulo entre lanes — se for quase paralelo, não é cruzamento
      const dot = Math.abs(aux * bux + auz * buz)
      if (dot > 0.5) continue

      // Resolve interseção de retas paramétricas
      const denom = aux * buz - auz * bux
      if (Math.abs(denom) < 1e-4) continue
      const t = ((b.ax - a.ax) * buz - (b.az - a.az) * bux) / denom
      const s = ((b.ax - a.ax) * auz - (b.az - a.az) * aux) / denom

      // Só aceita se o ponto está DENTRO dos dois segmentos (não em extensão)
      if (t < -0.02 || t > 1.02 || s < -0.02 || s > 1.02) continue

      const cx = a.ax + adx * t
      const cz = a.az + adz * t

      // Evita duplicatas (mesma interseção detectada por pares múltiplos)
      const key = `${Math.round(cx / 4)},${Math.round(cz / 4)}`
      if (seen.has(key)) continue
      seen.add(key)

      // O tamanho da interseção é a maior largura das duas vias
      const wA = ROAD_SPEC[a.tier].asphalt
      const wB = ROAD_SPEC[b.tier].asphalt
      const size = Math.max(wA, wB) + 0.4
      const tier = Math.min(a.tier, b.tier) as 0 | 1 | 2

      out.push({ x: cx, z: cz, size, tier })
    }
  }
  return out
}

// ============================================================================
// Geometria de rua em camadas
// ============================================================================

type RoadLayerBuffers = {
  /** Asfalto principal (quad ribbon). */
  asphalt: { positions: number[]; indices: number[]; colors: number[] }
  /** Calçada (2 ribbons elevados, um por lado). */
  sidewalk: { positions: number[]; indices: number[]; colors: number[] }
  /** Guia (borda vertical da calçada). */
  curb: { positions: number[]; indices: number[]; colors: number[] }
  /** Linhas pintadas no asfalto (amarelo duplo, branco tracejado, bordas). */
  lines: { positions: number[]; indices: number[]; colors: number[] }
  /** Quadrados de interseção. */
  intersection: { positions: number[]; indices: number[]; colors: number[] }
  /** Zebra nas bordas das interseções. */
  crosswalk: { positions: number[]; indices: number[]; colors: number[] }
}

function newLayer(): { positions: number[]; indices: number[]; colors: number[] } {
  return { positions: [], indices: [], colors: [] }
}

function newBuffers(): RoadLayerBuffers {
  return {
    asphalt: newLayer(),
    sidewalk: newLayer(),
    curb: newLayer(),
    lines: newLayer(),
    intersection: newLayer(),
    crosswalk: newLayer(),
  }
}

/** Adiciona um quad (4 cantos em ordem anti-horária) à camada. */
function pushQuad(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  x0: number, z0: number, y0: number,
  x1: number, z1: number, y1: number,
  x2: number, z2: number, y2: number,
  x3: number, z3: number, y3: number,
  color: THREE.Color,
): void {
  const base = layer.positions.length / 3
  layer.positions.push(
    x0, y0, z0,
    x1, y1, z1,
    x2, y2, z2,
    x3, y3, z3,
  )
  for (let k = 0; k < 4; k += 1) layer.colors.push(color.r, color.g, color.b)
  layer.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/**
 * Emite um ribbon de asfalto entre `a` e `b`, com largura `width`.
 * Se `offsetLateral` for diferente de 0, desloca o ribbon perpendicularmente
 * (usado para calçadas laterais e faixas pintadas).
 */
function pushRibbon(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  width: number, yLift: number, offsetLateral: number, color: THREE.Color,
  step: number,
): void {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return
  const ux = dx / len, uz = dz / len
  // Perpendicular (esquerda)
  const px = -uz, pz = ux

  const segs = Math.max(1, Math.ceil(len / step))
  for (let i = 0; i < segs; i += 1) {
    const t0 = i / segs
    const t1 = (i + 1) / segs
    const ax = a[0] + dx * t0 + px * offsetLateral
    const az = a[1] + dz * t0 + pz * offsetLateral
    const bx = a[0] + dx * t1 + px * offsetLateral
    const bz = a[1] + dz * t1 + pz * offsetLateral

    const half = width / 2
    // 4 cantos do quad (esquerda, direita em cada extremidade)
    const p0x = ax + px * half, p0z = az + pz * half
    const p1x = ax - px * half, p1z = az - pz * half
    const p2x = bx - px * half, p2z = bz - pz * half
    const p3x = bx + px * half, p3z = bz + pz * half

    const y0 = surfaceAt(p0x, p0z) + yLift
    const y1 = surfaceAt(p1x, p1z) + yLift
    const y2 = surfaceAt(p2x, p2z) + yLift
    const y3 = surfaceAt(p3x, p3z) + yLift

    pushQuad(layer, p0x, p0z, y0, p1x, p1z, y1, p2x, p2z, y2, p3x, p3z, y3, color)
  }
}

/** Emite uma calçada elevada (faixa + guia vertical). */
function pushSidewalk(
  sidewalkLayer: { positions: number[]; indices: number[]; colors: number[] },
  curbLayer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  asphaltHalfWidth: number, sidewalkWidth: number, curbHeight: number,
  color: THREE.Color, curbColor: THREE.Color,
): void {
  if (sidewalkWidth <= 0) return
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return
  const ux = dx / len, uz = dz / len
  const px = -uz, pz = ux

  // Calçada esquerda e direita
  for (const side of [-1, 1]) {
    const innerOffset = (asphaltHalfWidth + 0.02) * side
    const outerOffset = (asphaltHalfWidth + sidewalkWidth) * side

    const ax = a[0] + px * innerOffset
    const az = a[1] + pz * innerOffset
    const bx = b[0] + px * innerOffset
    const bz = b[1] + pz * innerOffset
    const cx = b[0] + px * outerOffset
    const cz = b[1] + pz * outerOffset
    const ex = a[0] + px * outerOffset
    const ez = a[1] + pz * outerOffset

    const ya_in = surfaceAt(ax, az) + curbHeight
    const yb_in = surfaceAt(bx, bz) + curbHeight
    const yc = surfaceAt(cx, cz) + curbHeight
    const ye = surfaceAt(ex, ez) + curbHeight

    // Face superior da calçada
    pushQuad(sidewalkLayer, ex, ez, ye, ax, az, ya_in, bx, bz, yb_in, cx, cz, yc, color)

    // Guia (face vertical entre asfalto e calçada)
    const ya_in0 = surfaceAt(ax, az) + 0.02
    const yb_in0 = surfaceAt(bx, bz) + 0.02
    pushQuad(curbLayer, ax, az, ya_in0, ax, az, ya_in, bx, bz, yb_in, bx, bz, yb_in0, curbColor)
  }
}

/**
 * Faixa central dupla amarela (avenida): 2 ribbons finos separados por gap.
 */
function pushDoubleYellow(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  yLift: number, color: THREE.Color,
): void {
  pushRibbon(layer, a, b, 0.12, yLift, -0.18, color, 4)
  pushRibbon(layer, a, b, 0.12, yLift, 0.18, color, 4)
}

/** Faixa central tracejada branca (rua): 3m pintado, 3m gap. */
function pushDashedWhite(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  yLift: number, color: THREE.Color,
): void {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return
  const ux = dx / len, uz = dz / len
  const dash = 3, gap = 3
  for (let s = 0; s < len; s += dash + gap) {
    const s1 = Math.min(len, s + dash)
    pushRibbon(layer, [a[0] + ux * s, a[1] + uz * s], [a[0] + ux * s1, a[1] + uz * s1], 0.12, yLift, 0, color, 4)
  }
}

/** Linhas brancas de borda (guia de pista). */
function pushEdgeLines(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  halfWidth: number, yLift: number, color: THREE.Color,
): void {
  pushRibbon(layer, a, b, 0.1, yLift, -(halfWidth - 0.15), color, 4)
  pushRibbon(layer, a, b, 0.1, yLift, halfWidth - 0.15, color, 4)
}

/** Quadrado de interseção (asfalto mais claro, cobre o cruzamento). */
function pushIntersectionSquare(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  cx: number, cz: number, size: number, yLift: number, color: THREE.Color,
): void {
  const h = size / 2
  const y = surfaceAt(cx, cz) + yLift
  pushQuad(
    layer,
    cx - h, cz - h, y,
    cx - h, cz + h, y,
    cx + h, cz + h, y,
    cx + h, cz - h, y,
    color,
  )
}

/** Zebra de pedestre em uma das bordas da interseção. */
function pushCrosswalk(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  cx: number, cz: number, size: number, roadWidth: number,
  side: 'north' | 'south' | 'east' | 'west',
  yLift: number, color: THREE.Color,
): void {
  const stripeW = 0.5
  const gap = 0.45
  const count = Math.floor((roadWidth - 0.4) / (stripeW + gap))
  const span = count * (stripeW + gap) - gap
  const start = -span / 2
  const stripDepth = 2.2 // profundidade da zebra
  const h = size / 2 + stripDepth / 2 + 0.1

  for (let i = 0; i < count; i += 1) {
    const offset = start + i * (stripeW + gap)
    let x0 = 0, z0 = 0, x1 = 0, z1 = 0
    if (side === 'north') {
      x0 = cx + offset; z0 = cz - h - stripDepth / 2
      x1 = cx + offset; z1 = cz - h + stripDepth / 2
      // Ribbon perpendicular: pequeno quad
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer,
        x0 - stripeW / 2, z0, y,
        x0 - stripeW / 2, z1, y,
        x0 + stripeW / 2, z1, y,
        x0 + stripeW / 2, z0, y,
        color)
    } else if (side === 'south') {
      x0 = cx + offset; z0 = cz + h - stripDepth / 2
      x1 = cx + offset; z1 = cz + h + stripDepth / 2
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer,
        x0 - stripeW / 2, z0, y,
        x0 - stripeW / 2, z1, y,
        x0 + stripeW / 2, z1, y,
        x0 + stripeW / 2, z0, y,
        color)
    } else if (side === 'east') {
      x0 = cx + h - stripDepth / 2; z0 = cz + offset
      x1 = cx + h + stripDepth / 2; z1 = cz + offset
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer,
        x0, z0 - stripeW / 2, y,
        x0, z0 + stripeW / 2, y,
        x1, z1 + stripeW / 2, y,
        x1, z1 - stripeW / 2, y,
        color)
    } else {
      x0 = cx - h - stripDepth / 2; z0 = cz + offset
      x1 = cx - h + stripDepth / 2; z1 = cz + offset
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer,
        x0, z0 - stripeW / 2, y,
        x0, z0 + stripeW / 2, y,
        x1, z1 + stripeW / 2, y,
        x1, z1 - stripeW / 2, y,
        color)
    }
  }
}

/** Empacota buffers em BufferGeometry. */
function layerToGeometry(layer: { positions: number[]; indices: number[]; colors: number[] }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(layer.positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(layer.colors, 3))
  g.setIndex(layer.indices)
  g.computeVertexNormals()
  return g
}

// ============================================================================
// Cidade principal
// ============================================================================

const CAR_COLORS = [0xc0392b, 0x2e6da4, 0xe8e2d0, 0x2b2f33, 0xd6a02c, 0x3f8f5b, 0x8a8f96, 0x7a3b8c]
const TREE_TONES = [0x3f7d3a, 0x4d8c3f, 0x2f6b3c, 0x5b9a45, 0x6a9a3a]

type Car = {
  lane: number
  /** 0..1 — fração ao longo da lane. */
  t: number
  /** -1 = sentido b→a, +1 = sentido a→b. */
  dir: 1 | -1
  /** Offset lateral em metros (negativo = esquerda, positivo = direita). */
  lateral: number
  speed: number
  color: number
  wheelSpin: number
}

function makeCar(color: number): THREE.Group {
  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.25 })
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.8, metalness: 0.4 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x8eaac0, roughness: 0.18, metalness: 0.55, transparent: true, opacity: 0.8 })
  const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f0d0, emissive: 0xffe7a6, emissiveIntensity: 0.8, roughness: 0.35 })
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9, metalness: 0.25 })

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), bodyMaterial)
  chassis.position.y = 0.72
  group.add(chassis)

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 2.0), glassMaterial)
  cabin.position.set(0, 1.12, -0.18)
  group.add(cabin)

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.36, 1.2), trimMaterial)
  hood.position.set(0, 0.8, 1.45)
  group.add(hood)

  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 0.9), trimMaterial)
  rear.position.set(0, 0.8, -1.6)
  group.add(rear)

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 1.3), trimMaterial)
  roof.position.set(0, 1.55, -0.22)
  group.add(roof)

  const headlampL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.3), lightMaterial)
  headlampL.position.set(-0.72, 0.8, 1.95)
  const headlampR = headlampL.clone()
  headlampR.position.x = 0.72
  const taillampL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xff433d, emissive: 0xff2d2d, emissiveIntensity: 0.9 }))
  taillampL.position.set(-0.65, 0.8, -2.02)
  const taillampR = taillampL.clone()
  taillampR.position.x = 0.65
  group.add(headlampL, headlampR, taillampL, taillampR)

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16)
  const wheelPositions = [
    [-0.85, 0.38, 1.35],
    [0.85, 0.38, 1.35],
    [-0.85, 0.38, -1.35],
    [0.85, 0.38, -1.35],
  ] as const
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMaterial)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, y, z)
    group.add(wheel)
  }
  group.rotation.order = 'YXZ'
  return group
}

export class Cities {
  readonly group = new THREE.Group()
  readonly buildingCount: number
  readonly data: CityData
  readonly colliders: CityColliders
  readonly perches: readonly Perch[]

  private readonly windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  private readonly lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  private readonly headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  private readonly beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
  private readonly asphaltMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 })
  private readonly sidewalkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  private readonly curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  private readonly lineMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  private readonly crosswalkMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

  private readonly cars: Car[] = []
  private readonly carGroups: THREE.Group[] = []
  private readonly perchBeams: THREE.InstancedMesh
  private readonly perchRings: THREE.InstancedMesh
  private readonly visited = new Set<number>()
  private readonly intersections: Intersection[]

  constructor() {
    this.group.name = 'procedural-cities'
    this.data = generateCity()
    const data = this.data
    this.colliders = new CityColliders(data.buildings)
    this.perches = data.perches
    this.buildingCount = data.buildings.length
    this.intersections = findIntersections(data.lanes)

    // ---- Edifícios, praças, árvores, postes (mantém estrutura) ----
    this.buildBuildings()
    this.buildProps()
    this.buildRoads()
    this.buildCars()
    this.buildPerches()
    this.buildPlazas()

    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
    })
    this.perchBeams.receiveShadow = false
    this.perchRings.receiveShadow = false
  }

  // ==========================================================================
  // Edifícios (volumes, telhados, janelas)
  // ==========================================================================

  private buildBuildings(): void {
    const data = this.data
    const color = new THREE.Color()
    type Volume = { x: number; z: number; y0: number; w: number; d: number; h: number; rot: number; color: number }
    const volumes: Volume[] = []
    for (const b of data.buildings) {
      volumes.push({ x: b.x, z: b.z, y0: b.ground, w: b.width, d: b.depth, h: b.height, rot: b.rotation, color: b.color })
      if (b.upper) {
        const u = b.upper
        const c = Math.cos(b.rotation)
        const s = Math.sin(b.rotation)
        volumes.push({
          x: b.x + u.ox * c + u.oz * s,
          z: b.z - u.ox * s + u.oz * c,
          y0: u.fromGround ? b.ground : b.ground + b.height,
          w: u.width, d: u.depth, h: u.height, rot: b.rotation,
          color: u.spire ? b.color : new THREE.Color(b.color).multiplyScalar(0.92).getHex(),
        })
      }
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1)
    const body = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.02 }), volumes.length)
    for (const [i, v] of volumes.entries()) {
      body.setMatrixAt(i, composeMatrix(v.x, v.y0 + v.h / 2, v.z, v.rot, v.w, v.h, v.d))
      body.setColorAt(i, color.setHex(v.color, THREE.SRGBColorSpace))
    }
    body.instanceMatrix.needsUpdate = true

    const pitchedCount = data.buildings.filter(b => b.pitched).length
    const flatCount = data.buildings.length - pitchedCount
    const pitched = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7071, 1, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), Math.max(1, pitchedCount))
    const flat = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), Math.max(1, flatCount))
    let pi = 0, fi = 0, ai = 0
    const spires = data.buildings.filter(b => b.upper?.spire)
    const antennas = data.buildings.filter(b => b.antenna > 0)
    const spireMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7071, 1, 4), new THREE.MeshStandardMaterial({ color: 0x6f3a30, roughness: 0.85 }), Math.max(1, spires.length))
    const antennaMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 }), Math.max(1, antennas.length))
    const beaconMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), this.beaconMaterial, Math.max(1, antennas.length))

    for (const b of data.buildings) {
      if (b.pitched) {
        pitched.setMatrixAt(pi, composeMatrix(b.x, b.ground + b.height + b.roofHeight / 2, b.z, b.rotation + Math.PI / 4, b.width * 1.12, b.roofHeight, b.depth * 1.12))
        pitched.setColorAt(pi, color.setHex(b.roofColor, THREE.SRGBColorSpace))
        pi += 1
      } else {
        flat.setMatrixAt(fi, composeMatrix(b.x, b.ground + b.height + 0.2, b.z, b.rotation, b.width * 1.04, 0.4, b.depth * 1.04))
        flat.setColorAt(fi, color.setHex(b.roofColor, THREE.SRGBColorSpace))
        fi += 1
      }
    }
    pitched.count = pi
    flat.count = fi

    for (const [i, b] of spires.entries()) {
      const u = b.upper!
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)
      spireMesh.setMatrixAt(i, composeMatrix(b.x + u.ox * c + u.oz * s, b.ground + u.height + 2, b.z - u.ox * s + u.oz * c, b.rotation + Math.PI / 4, u.width * 1.15, 4, u.depth * 1.15))
    }
    for (const b of antennas) {
      const u = b.upper
      const top = u && !u.fromGround ? b.ground + b.height + u.height : b.ground + b.height
      antennaMesh.setMatrixAt(ai, composeMatrix(b.x, top + b.antenna / 2, b.z, b.rotation, 0.5, b.antenna, 0.5))
      beaconMesh.setMatrixAt(ai, composeMatrix(b.x, top + b.antenna + 0.4, b.z, 0, 1, 1, 1))
      ai += 1
    }
    antennaMesh.count = ai
    beaconMesh.count = ai
    spireMesh.count = spires.length

    const slots = volumes.reduce((acc, v) => acc + (v.h < 4.5 ? 0 : Math.min(14, Math.floor(v.h / 4.2)) * (Math.min(4, Math.max(1, Math.floor(v.w / 4))) + 1)), 0)
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.82, 0.045), this.windowMaterial, Math.max(1, slots))
    windows.renderOrder = 1
    let wi = 0
    for (const v of volumes) {
      if (v.h < 4.5) continue
      const c = Math.cos(v.rot), s = Math.sin(v.rot)
      const floors = Math.min(14, Math.floor(v.h / 4.2))
      const columns = Math.min(4, Math.max(1, Math.floor(v.w / 4)))
      for (let floor = 0; floor < floors; floor += 1) {
        const y = v.y0 + 2.4 + floor * 4.1
        for (let slot = 0; slot < columns; slot += 1) {
          const lx = ((slot + 1) / (columns + 1) - 0.5) * v.w
          const frontZ = -v.d / 2 - 0.04
          windows.setMatrixAt(wi++, composeMatrix(v.x + lx * c + frontZ * s, y, v.z - lx * s + frontZ * c, v.rot))
        }
        windows.setMatrixAt(wi++, composeMatrix(v.x + (v.w / 2 + 0.04) * c, y, v.z - (v.w / 2 + 0.04) * s, v.rot + Math.PI / 2))
      }
    }
    windows.count = wi

    this.group.add(body, flat, pitched, spireMesh, antennaMesh, beaconMesh, windows)
  }

  // ==========================================================================
  // Árvores e postes
  // ==========================================================================

  private buildProps(): void {
    const data = this.data
    const color = new THREE.Color()
    const trees = data.trees
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }), Math.max(1, trees.length))
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5a4331, roughness: 1 }), Math.max(1, trees.length))
    for (const [i, t] of trees.entries()) {
      const h = 2.2 * t.scale
      trunks.setMatrixAt(i, composeMatrix(t.x, t.ground + h / 2, t.z, 0, t.scale, h, t.scale))
      crowns.setMatrixAt(i, composeMatrix(t.x, t.ground + h + 1.2 * t.scale, t.z, t.tone * 6, 1.7 * t.scale, 1.5 * t.scale, 1.7 * t.scale))
      crowns.setColorAt(i, color.setHex(TREE_TONES[Math.floor(t.tone * TREE_TONES.length) % TREE_TONES.length], THREE.SRGBColorSpace))
    }
    if (!trees.length) { crowns.count = 0; trunks.count = 0 }

    const lamps = data.lamps
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7 }), Math.max(1, lamps.length))
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 8, 6), this.lampMaterial, Math.max(1, lamps.length))
    for (const [i, l] of lamps.entries()) {
      poles.setMatrixAt(i, composeMatrix(l.x, l.ground + 2.6, l.z, 0, 1, 5.2, 1))
      bulbs.setMatrixAt(i, composeMatrix(l.x, l.ground + 5.3, l.z, 0, 1, 1, 1))
    }
    if (!lamps.length) { poles.count = 0; bulbs.count = 0 }

    this.group.add(crowns, trunks, poles, bulbs)
  }

  // ==========================================================================
  // RUAS — o coração da mudança
  // ==========================================================================

  private buildRoads(): void {
    const data = this.data
    const buf = newBuffers()

    // Paleta por tier
    const asphaltColors: THREE.Color[] = [
      new THREE.Color(ASPHALT_DARK),
      new THREE.Color(ASPHALT_MID),
      new THREE.Color(ASPHALT_LIGHT),
    ]
    const sidewalkColor = new THREE.Color(SIDEWALK_COLOR)
    const curbColor = new THREE.Color(CURB_COLOR)
    const yellowLine = new THREE.Color(LINE_YELLOW)
    const whiteLine = new THREE.Color(LINE_WHITE)
    const intersectionColor = new THREE.Color(ASPHALT_MID)

    // Itera cada lane e gera suas camadas de acordo com o tier
    for (const lane of data.lanes) {
      const spec = ROAD_SPEC[lane.tier]
      const a: [number, number] = [lane.ax, lane.az]
      const b: [number, number] = [lane.bx, lane.bz]
      const asphaltCol = asphaltColors[lane.tier]

      // 1. Asfalto
      pushRibbon(buf.asphalt, a, b, spec.asphalt, 0.02, 0, asphaltCol, LANE_STEP)

      // 2. Faixa central
      if (spec.centerLine === 'double-yellow') {
        pushDoubleYellow(buf.lines, a, b, 0.045, yellowLine)
      } else if (spec.centerLine === 'dashed-white') {
        pushDashedWhite(buf.lines, a, b, 0.045, whiteLine)
      }

      // 3. Bordas
      if (spec.edgeLines) {
        pushEdgeLines(buf.lines, a, b, spec.asphalt / 2, 0.04, whiteLine)
      }

      // 4. Calçadas
      if (spec.sidewalk > 0) {
        pushSidewalk(buf.sidewalk, buf.curb, a, b, spec.asphalt / 2, spec.sidewalk, spec.curbHeight, sidewalkColor, curbColor)
      }
    }

    // Interseções: quadrado de asfalto + zebra em cada borda
    for (const it of this.intersections) {
      pushIntersectionSquare(buf.intersection, it.x, it.z, it.size, 0.04, intersectionColor)
      // Zebra nas 4 bordas (só se for tier 0/1)
      if (it.tier <= 1) {
        const roadW = ROAD_SPEC[it.tier].asphalt
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'north', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'south', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'east', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'west', 0.06, whiteLine)
      }
    }

    // Empacota cada camada numa mesh
    const asphaltMesh = new THREE.Mesh(layerToGeometry(buf.asphalt), this.asphaltMaterial)
    const sidewalkMesh = new THREE.Mesh(layerToGeometry(buf.sidewalk), this.sidewalkMaterial)
    const curbMesh = new THREE.Mesh(layerToGeometry(buf.curb), this.curbMaterial)
    const linesMesh = new THREE.Mesh(layerToGeometry(buf.lines), this.lineMaterial)
    const intersectionMesh = new THREE.Mesh(layerToGeometry(buf.intersection), this.asphaltMaterial)
    const crosswalkMesh = new THREE.Mesh(layerToGeometry(buf.crosswalk), this.crosswalkMaterial)

    // Ordem de renderização para evitar z-fighting entre camadas próximas
    intersectionMesh.renderOrder = 1
    linesMesh.renderOrder = 2
    crosswalkMesh.renderOrder = 3

    this.group.add(asphaltMesh, sidewalkMesh, curbMesh, intersectionMesh, linesMesh, crosswalkMesh)
  }

  // ==========================================================================
  // Praças
  // ==========================================================================

  private buildPlazas(): void {
    const data = this.data
    const positions: number[] = []
    const indices: number[] = []
    const n = 6
    for (const p of data.plazas) {
      const c = Math.cos(p.rotation)
      const s = Math.sin(p.rotation)
      const base = positions.length / 3
      for (let i = 0; i <= n; i += 1) {
        for (let j = 0; j <= n; j += 1) {
          const lx = (i / n - 0.5) * p.size
          const lz = (j / n - 0.5) * p.size
          const x = p.x + lx * c + lz * s
          const z = p.z - lx * s + lz * c
          positions.push(x, surfaceAt(x, z) + 0.12, z)
        }
      }
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          const a = base + i * (n + 1) + j
          indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
        }
      }
    }
    const plazaGeo = new THREE.BufferGeometry()
    plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    plazaGeo.setIndex(indices)
    plazaGeo.computeVertexNormals()

    const plazaMat = new THREE.MeshStandardMaterial({ color: 0x5f9a4c, roughness: 1 })
    const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat)

    const fountains = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.8, 2.1, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x8fb8d8, roughness: 0.25, metalness: 0.1 }),
      Math.max(1, data.plazas.length),
    )
    for (const [i, p] of data.plazas.entries()) {
      fountains.setMatrixAt(i, composeMatrix(p.x, surfaceAt(p.x, p.z) + 0.45, p.z, 0, 1, 1, 1))
    }
    fountains.count = data.plazas.length

    this.group.add(plazaMesh, fountains)
  }

  // ==========================================================================
  // Carros — faixas opostas, offset lateral correto
  // ==========================================================================

  private buildCars(): void {
    const data = this.data
    const lanes = data.lanes
    for (const [li, site] of CITY_SITES.entries()) {
      const laneIdx = lanes.map((l, i) => (l.site === li ? i : -1)).filter(i => i >= 0)
      if (!laneIdx.length) continue
      const count = site.kind === 'city' ? 40 : 14
      for (let k = 0; k < count; k += 1) {
        const laneI = laneIdx[Math.floor(hash2(k, li, 701) * laneIdx.length)]
        const lane = lanes[laneI]
        const spec = ROAD_SPEC[lane.tier]
        // Cada carro escolhe sentido e faixa lateral correspondente
        const dir: 1 | -1 = hash2(k, li, 705) < 0.5 ? 1 : -1
        // Offset lateral: metade da pista, do lado correto do centro
        const lateral = dir * (spec.laneWidth / 2 + 0.15)
        this.cars.push({
          lane: laneI,
          t: hash2(k, li, 702),
          dir,
          lateral,
          speed: 4.5 + hash2(k, li, 703) * 4.5,
          color: CAR_COLORS[Math.floor(hash2(k, li, 704) * CAR_COLORS.length)],
          wheelSpin: 0,
        })
      }
    }
    for (const car of this.cars) {
      const model = makeCar(car.color)
      model.scale.set(0.9, 0.9, 0.9)
      this.carGroups.push(model)
      this.group.add(model)
    }
    this.updateCars(0)
  }

  private updateCars(dt: number): void {
    const lanes = this.data.lanes
    for (const [i, car] of this.cars.entries()) {
      const lane = lanes[car.lane]
      const dx = lane.bx - lane.ax
      const dz = lane.bz - lane.az
      const len = Math.hypot(dx, dz) || 1
      const ux = dx / len, uz = dz / len

      // Progresso em [0, 1], com wrap
      car.t = (car.t + (car.speed * dt) / len * car.dir + 1) % 1

      // Posição base ao longo da lane
      const bx = lane.ax + dx * car.t
      const bz = lane.az + dz * car.t

      // Offset perpendicular (esquerda relativa ao vetor a→b)
      const px = -uz, pz = ux
      const x = bx + px * car.lateral
      const z = bz + pz * car.lateral

      // Altura interpolada
      const f = car.t * (lane.heights.length - 1)
      const i0 = Math.min(lane.heights.length - 1, Math.floor(f))
      const i1 = Math.min(lane.heights.length - 1, i0 + 1)
      const y = lane.heights[i0] + (lane.heights[i1] - lane.heights[i0]) * (f - i0) + 0.55

      // Heading: direção do movimento (a→b para dir=+1, b→a para dir=-1)
      const heading = Math.atan2(dx * car.dir, dz * car.dir)

      const model = this.carGroups[i]
      model.position.set(x, y, z)
      model.rotation.set(0, heading, 0)

      // Rodas
      car.wheelSpin += car.speed * dt * 2.2
      for (const child of model.children) {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry instanceof THREE.CylinderGeometry) {
          child.rotation.z = Math.PI / 2 + car.wheelSpin
        }
      }
    }
  }

  // ==========================================================================
  // Perches
  // ==========================================================================

  private buildPerches(): void {
    const perches = this.perches
    this.perchBeams = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 16, 1, true), this.beamMaterial, Math.max(1, perches.length))
    this.perchRings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
      Math.max(1, perches.length),
    )
    this.perchBeams.frustumCulled = false
    this.perchRings.frustumCulled = false
    for (const [i, p] of perches.entries()) {
      this.perchBeams.setMatrixAt(i, composeMatrix(p.x, p.y + 15, p.z, 0, 1, 30, 1))
      this.perchRings.setMatrixAt(i, composeMatrix(p.x, p.y + 0.5, p.z, 0, p.radius, 1, p.radius))
      this.setPerchColor(i, false)
    }
    this.perchBeams.count = perches.length
    this.perchRings.count = perches.length
    this.group.add(this.perchBeams, this.perchRings)
  }

  private setPerchColor(i: number, visited: boolean): void {
    const c = new THREE.Color(visited ? 0x7ee08a : 0xffd35c)
    this.perchBeams.setColorAt(i, c)
    this.perchRings.setColorAt(i, c)
    if (this.perchBeams.instanceColor) this.perchBeams.instanceColor.needsUpdate = true
    if (this.perchRings.instanceColor) this.perchRings.instanceColor.needsUpdate = true
  }

  setVisited(ids: Iterable<number>): void {
    const next = new Set(ids)
    for (const p of this.perches) {
      const was = this.visited.has(p.id)
      const now = next.has(p.id)
      if (was !== now) this.setPerchColor(p.id, now)
    }
    this.visited.clear()
    for (const id of next) this.visited.add(id)
  }

  nearestPerch(x: number, y: number, z: number, onlyNew = true): { perch: Perch; dist: number } | null {
    let best: { perch: Perch; dist: number } | null = null
    for (const p of this.perches) {
      if (onlyNew && this.visited.has(p.id)) continue
      const d = Math.hypot(p.x - x, p.y - y, p.z - z)
      if (!best || d < best.dist) best = { perch: p, dist: d }
    }
    return best
  }

  // ==========================================================================
  // Update
  // ==========================================================================

  update(daylight: number, dt = 0, time = 0): void {
    const night = THREE.MathUtils.clamp((1 - daylight) * 1.1, 0, 0.95)
    this.windowMaterial.opacity = night * 0.95
    this.lampMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.6, 0, 1)
    this.headlightMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.6, 0, 1)
    this.beaconMaterial.opacity = (0.35 + 0.65 * Math.max(0, Math.sin(time * 3))) * 0.95
    this.beamMaterial.opacity = 0.16 + 0.07 * Math.sin(time * 2.2)
    if (dt > 0) this.updateCars(Math.min(dt, 0.1))
  }
}
