import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, heightAt, surfaceAt } from './terrain'

type Building = {
  x: number
  z: number
  ground: number
  width: number
  depth: number
  height: number
  rotation: number
  roof: boolean
  color: number
  roofColor: number
  windowCount: number
}
type TrafficVehicle = {
  site: CitySite
  axis: 'x' | 'z'
  line: number
  direction: 1 | -1
  min: number
  span: number
  speed: number
  phase: number
  scale: number
  color: number
}

const _matrix = new THREE.Matrix4()
const _quaternion = new THREE.Quaternion()
const _rotation = new THREE.Euler()
const _scale = new THREE.Vector3()
const _position = new THREE.Vector3()

function boxAssembly(parts: { size: [number, number, number]; at: [number, number, number] }[]): THREE.BufferGeometry {
  const pieces = parts.map(({ size, at }) => new THREE.BoxGeometry(...size).translate(...at))
  const geometry = mergeGeometries(pieces, false)
  pieces.forEach(piece => piece.dispose())
  if (!geometry) throw new Error('Não foi possível montar os detalhes de fachada')
  return geometry
}

const WINDOW_FRAME = boxAssembly([
  { size: [0.065, 0.92, 0.07], at: [-0.34, 0, 0] },
  { size: [0.065, 0.92, 0.07], at: [0.34, 0, 0] },
  { size: [0.74, 0.065, 0.07], at: [0, -0.43, 0] },
  { size: [0.74, 0.065, 0.07], at: [0, 0.43, 0] },
  { size: [0.032, 0.78, 0.07], at: [0, 0, 0] },
  { size: [0.68, 0.032, 0.07], at: [0, 0, 0] },
])

function localToWorld(site: CitySite, x: number, z: number): [number, number] {
  const a = site.seed * 0.017
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [site.x + x * c + z * s, site.z - x * s + z * c]
}

function addRoadQuad(out: number[], site: CitySite, a: [number, number], b: [number, number], width: number, lift: number): void {
  const [ax, az] = localToWorld(site, a[0], a[1])
  const [bx, bz] = localToWorld(site, b[0], b[1])
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz) || 1
  const nx = (-dz / length) * width * 0.5
  const nz = (dx / length) * width * 0.5
  const corners: [number, number][] = [[ax + nx, az + nz], [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz]]
  const first = out.length / 3
  for (const [x, z] of corners) out.push(x, surfaceAt(x, z) + lift, z)
  // Faces voltadas para +Y: a cidade é observada principalmente de cima e em rasante.
  roadIndices.push(first, first + 2, first + 1, first, first + 3, first + 2)
}

const roadIndices: number[] = []

function roadGeometry(sites: readonly CitySite[], width: number, lift: number): THREE.BufferGeometry {
  const positions: number[] = []
  roadIndices.length = 0
  for (const site of sites) {
    const ex = (site.columns * site.spacing) / 2
    const ez = (site.rows * site.spacing) / 2
    const step = 16
    for (let c = 0; c <= site.columns; c += 1) {
      const x = (c - site.columns / 2) * site.spacing
      for (let z = -ez; z < ez; z += step) {
        const end = Math.min(ez, z + step)
        addRoadQuad(positions, site, [x, z], [x, end], width, lift)
      }
    }
    for (let r = 0; r <= site.rows; r += 1) {
      const z = (r - site.rows / 2) * site.spacing
      for (let x = -ex; x < ex; x += step) {
        const end = Math.min(ex, x + step)
        addRoadQuad(positions, site, [x, z], [end, z], width, lift)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(roadIndices.slice())
  geometry.computeVertexNormals()
  return geometry
}
function roadMarkingGeometry(sites: readonly CitySite[], crosswalks: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  roadIndices.length = 0
  for (const site of sites) {
    const ex = (site.columns * site.spacing) / 2
    const ez = (site.rows * site.spacing) / 2
    const addDashes = (axis: 'x' | 'z', line: number, start: number, end: number, offset: number, width: number, dash: number, gap: number) => {
      for (let along = start + 3; along < end - 1; along += dash + gap) {
        const finish = Math.min(end - 1, along + dash)
        const a: [number, number] = axis === 'z' ? [line + offset, along] : [along, line + offset]
        const b: [number, number] = axis === 'z' ? [line + offset, finish] : [finish, line + offset]
        addRoadQuad(positions, site, a, b, width, 0.098)
      }
    }
    for (let c = 0; c <= site.columns; c += 1) {
      const x = (c - site.columns / 2) * site.spacing
      if (crosswalks) {
        for (let r = 0; r <= site.rows; r += 2) {
          const z = (r - site.rows / 2) * site.spacing
          for (let stripe = -2.2; stripe <= 2.2; stripe += 0.72) {
            addRoadQuad(positions, site, [x + stripe, z - 3.3], [x + stripe, z - 2.7], 0.38, 0.102)
            addRoadQuad(positions, site, [x + stripe, z + 2.7], [x + stripe, z + 3.3], 0.38, 0.102)
          }
        }
      } else {
        addDashes('z', x, -ez, ez, -0.17, 0.1, 2.5, 5)
        addDashes('z', x, -ez, ez, 0.17, 0.1, 2.5, 5)
      }
    }
    for (let r = 0; r <= site.rows; r += 1) {
      const z = (r - site.rows / 2) * site.spacing
      if (!crosswalks) {
        addDashes('x', z, -ex, ex, -0.17, 0.1, 2.5, 5)
        addDashes('x', z, -ex, ex, 0.17, 0.1, 2.5, 5)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(roadIndices.slice())
  geometry.computeVertexNormals()
  return geometry
}
type PerchPoint = { position: THREE.Vector3; yaw: number }
type UtilityNetwork = { poles: PerchPoint[]; poleGeometry: THREE.BufferGeometry; wireGeometry: THREE.BufferGeometry; spanCount: number }

function makeUtilityNetwork(): UtilityNetwork {
  const poles: PerchPoint[] = []
  const wirePieces: THREE.BufferGeometry[] = []
  const polePieces = [
    new THREE.CylinderGeometry(0.105, 0.18, 8.4, 7).translate(0, 4.2, 0),
    new THREE.BoxGeometry(2.15, 0.16, 0.18).translate(0, 7.65, 0),
    ...[-0.77, 0, 0.77].map(x => new THREE.CylinderGeometry(0.12, 0.12, 0.28, 6).translate(x, 7.88, 0)),
  ]
  const poleGeometry = mergeGeometries(polePieces, false)!
  polePieces.forEach(piece => piece.dispose())
  let spanCount = 0
  const addRun = (site: CitySite, axis: 'x' | 'z', line: number, start: number, end: number) => {
    const runLength = end - start
    const step = 30
    const count = Math.max(1, Math.ceil(runLength / step))
    const points: [number, number][] = []
    for (let i = 0; i <= count; i += 1) {
      const along = start + runLength * i / count
      const localX = axis === 'x' ? along : line
      const localZ = axis === 'x' ? line : along
      const [x, z] = localToWorld(site, localX, localZ)
      const ground = surfaceAt(x, z)
      const yaw = site.seed * 0.017 + (axis === 'x' ? Math.PI / 2 : 0)
      poles.push({ position: new THREE.Vector3(x, ground + 8.4, z), yaw })
      points.push([localX, localZ])
    }
    for (let i = 0; i < count; i += 1) {
      const [ax, az] = points[i]
      const [bx, bz] = points[i + 1]
      for (const side of [-0.77, 0, 0.77]) {
        const wirePath: THREE.Vector3[] = []
        for (let sample = 0; sample <= 8; sample += 1) {
          const t = sample / 8
          const lx = axis === 'x' ? ax + (bx - ax) * t : ax + side
          const lz = axis === 'x' ? az + side : az + (bz - az) * t
          const [x, z] = localToWorld(site, lx, lz)
          const sag = Math.sin(Math.PI * t) * 0.68
          wirePath.push(new THREE.Vector3(x, surfaceAt(x, z) + 8.4 - sag, z))
        }
        wirePieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePath), 8, 0.045, 4, false))
      }
      spanCount += 1
    }
  }
  for (const site of CITY_SITES) {
    const ex = site.columns * site.spacing / 2
    const ez = site.rows * site.spacing / 2
    for (let r = 0; r <= site.rows; r += 1) addRun(site, 'x', (r - site.rows / 2) * site.spacing + 10, -ex, ex)
    for (let c = 0; c <= site.columns; c += 1) addRun(site, 'z', (c - site.columns / 2) * site.spacing + 10, -ez, ez)
  }
  const wireGeometry = mergeGeometries(wirePieces, false) ?? new THREE.BufferGeometry()
  wirePieces.forEach(piece => piece.dispose())
  return { poles, poleGeometry, wireGeometry, spanCount }
}

function makeTraffic(): TrafficVehicle[] {
  const traffic: TrafficVehicle[] = []
  const palette = [0xb84235, 0xe0d7bd, 0x3e5968, 0x47504c, 0xc5a34f, 0x66806f, 0x343a43, 0xc4c7c2]
  for (const site of CITY_SITES) {
    const ex = (site.columns * site.spacing) / 2
    const ez = (site.rows * site.spacing) / 2
    const add = (axis: 'x' | 'z', lineIndex: number, line: number, span: number) => {
      const i = traffic.length
      const direction: 1 | -1 = hash2(i, lineIndex, site.seed + 31) > 0.5 ? 1 : -1
      traffic.push({
        site, axis, line, direction, min: -span / 2 + 5, span: span - 10,
        speed: 4.5 + hash2(i, lineIndex, site.seed + 32) * 4.5,
        phase: hash2(i, lineIndex, site.seed + 33) * (span - 10),
        scale: 0.86 + hash2(i, lineIndex, site.seed + 34) * 0.24,
        color: palette[Math.floor(hash2(i, lineIndex, site.seed + 35) * palette.length)],
      })
    }
    for (let c = 0; c <= site.columns; c += 1) add('z', c, (c - site.columns / 2) * site.spacing, ez * 2)
    for (let r = 0; r <= site.rows; r += 1) add('x', r, (r - site.rows / 2) * site.spacing, ex * 2)
  }
  return traffic
}

function makeBuildings(): Building[] {
  const buildings: Building[] = []
  const bodyColors = [0xd0c8b7, 0xd9d3c5, 0xb9c5c3, 0xd5c0a1, 0xc5b8a6, 0xaebdc4]
  const roofColors = [0x834c39, 0x6b4140, 0xa05e42, 0x544f4a, 0x3c5555]
  for (const site of CITY_SITES) {
    for (let c = 0; c < site.columns; c += 1) {
      for (let r = 0; r < site.rows; r += 1) {
        const h0 = hash2(c, r, site.seed)
        if (h0 < (site.kind === 'city' ? 0.16 : 0.2)) continue
        const lx = (c - (site.columns - 1) / 2) * site.spacing + (hash2(c, r, site.seed + 1) - 0.5) * 5
        const lz = (r - (site.rows - 1) / 2) * site.spacing + (hash2(c, r, site.seed + 2) - 0.5) * 5
        const [x, z] = localToWorld(site, lx, lz)
        const ground = heightAt(x, z)
        if (ground < 0.8) continue
        const distance = Math.hypot(lx, lz)
        const central = site.kind === 'city' && distance < site.radius * 0.42
        const centerC = Math.floor(site.columns / 2)
        const centerR = Math.floor(site.rows / 2)
        const tower = site.kind === 'city' && (
          (c === centerC && r === centerR) ||
          (c === centerC - 2 && r === centerR + 1) ||
          (c === centerC + 2 && r === centerR - 1)
        )
        const height = tower ? 48 + hash2(c, r, site.seed + 13) * 27 : central ? 21 + hash2(c, r, site.seed + 3) * 36 : site.kind === 'city' ? 8 + hash2(c, r, site.seed + 3) * 14 : 6 + hash2(c, r, site.seed + 3) * 11
        const width = (site.kind === 'city' && central ? 11 : 8) + hash2(c, r, site.seed + 4) * (central ? 8 : 6)
        const depth = (site.kind === 'city' && central ? 10 : 8) + hash2(c, r, site.seed + 5) * (central ? 7 : 6)
        buildings.push({
          x, z, ground, width, depth, height,
          rotation: site.seed * 0.017 + (hash2(c, r, site.seed + 6) - 0.5) * 0.12,
          roof: site.kind === 'town' || (!central && hash2(c, r, site.seed + 14) > 0.78),
          color: bodyColors[Math.floor(hash2(c, r, site.seed + 7) * bodyColors.length)],
          roofColor: roofColors[Math.floor(hash2(c, r, site.seed + 8) * roofColors.length)],
          windowCount: Math.min(8, Math.max(1, Math.floor(height / 5))),
        })
      }
    }
  }
  return buildings
}

function matrixAt(x: number, y: number, z: number, rotation: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  _position.set(x, y, z)
  _rotation.set(0, rotation, 0)
  _quaternion.setFromEuler(_rotation)
  _scale.set(sx, sy, sz)
  return _matrix.compose(_position, _quaternion, _scale)
}

/** Assentamentos estáticos, compartilhados e instanciados para manter poucos draw calls. */
export class Cities {
  readonly group = new THREE.Group()
  readonly buildingCount: number
  readonly windowCount: number
  readonly facadeDetailCount: number
  readonly vehicleCount: number
  readonly utilityPoleCount: number
  readonly wireSpanCount: number
  readonly perchCount: number
  private readonly perches: PerchPoint[]
  private readonly updateTraffic: (time: number) => void
  private readonly detailMeshes: THREE.Object3D[]
  private readonly trafficMeshes: THREE.Object3D[]
  private trafficActive = true
  private readonly windowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd88a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  })

  constructor() {
    this.group.name = 'procedural-cities'
    const buildings = makeBuildings()
    this.buildingCount = buildings.length
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.02 }),
      buildings.length,
    )
    const flatRoof = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
      buildings.length,
    )
    const pitchedRoof = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.72, 0.58, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      buildings.length,
    )
    const maxWindows = buildings.reduce((n, b) => {
      const floors = Math.min(b.windowCount, Math.floor(b.height / 4.2))
      const columns = Math.min(3, Math.max(1, Math.floor(b.width / 4)))
      return n + floors * (columns + (b.height > 10 ? 1 : 0))
    }, 0)
    const glass = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.82, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x263f49, roughness: 0.24, metalness: 0.28, emissive: 0x11232b, emissiveIntensity: 0.6 }),
      maxWindows,
    )
    const frames = new THREE.InstancedMesh(
      WINDOW_FRAME,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.04 }),
      maxWindows,
    )
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.62, 0.02), this.windowMaterial, maxWindows)
    windows.renderOrder = 1
    const doors = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.92, 2.25, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74 }),
      buildings.length,
    )
    const signs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.42, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0.05 }),
      buildings.length,
    )
    const cornices = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
      buildings.length * 8,
    )
    const roofUnits = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x78817f, roughness: 0.72, metalness: 0.14 }),
      buildings.length * 2,
    )
    const pilasters = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
      buildings.length * 4,
    )
    const parapets = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
      buildings.length * 4,
    )
    const storefronts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x38535a, roughness: 0.22, metalness: 0.2, emissive: 0x10191b, emissiveIntensity: 0.35 }),
      buildings.length,
    )
    const awnings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.16, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
      buildings.length,
    )
    const utilities = makeUtilityNetwork()
    this.perches = utilities.poles
    this.utilityPoleCount = utilities.poles.length
    this.wireSpanCount = utilities.spanCount
    this.perchCount = utilities.poles.length
    const utilityPoles = new THREE.InstancedMesh(utilities.poleGeometry, new THREE.MeshStandardMaterial({ color: 0x574a3b, roughness: 0.9 }), utilities.poles.length)
    utilityPoles.name = 'utility-poles'
    // A geometria do poste já parte do solo local (y=0) e termina em 8,4 m.
    utilities.poles.forEach((pole, i) => utilityPoles.setMatrixAt(i, matrixAt(pole.position.x, pole.position.y - 8.4, pole.position.z, pole.yaw, 1, 1, 1)))
    utilityPoles.instanceMatrix.needsUpdate = true
    const utilityWires = new THREE.Mesh(utilities.wireGeometry, new THREE.MeshStandardMaterial({ color: 0x242b2c, roughness: 0.55, metalness: 0.35 }))
    utilityWires.name = 'utility-wires'
    utilityWires.frustumCulled = false
    const traffic = makeTraffic()
    this.vehicleCount = traffic.length
    const carBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 0.58, 3.7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.16 }),
      traffic.length,
    )
    const carCabin = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.52, 0.7, 1.92),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.12 }),
      traffic.length,
    )
    const carWindows = new THREE.InstancedMesh(
      boxAssembly([
        { size: [0.035, 0.39, 1.3], at: [-0.77, 0, -0.08] },
        { size: [0.035, 0.39, 1.3], at: [0.77, 0, -0.08] },
        { size: [1.28, 0.39, 0.035], at: [0, 0, 0.89] },
        { size: [1.24, 0.34, 0.035], at: [0, 0, -1.02] },
      ]),
      new THREE.MeshStandardMaterial({ color: 0x233a43, roughness: 0.2, metalness: 0.28, emissive: 0x10181a, emissiveIntensity: 0.22 }),
      traffic.length,
    )
    const carWheels = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.9 }),
      traffic.length * 4,
    )
    const carLights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.24, 0.14, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xf8e7be, toneMapped: false }),
      traffic.length * 2,
    )
    const carTailLights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.23, 0.16, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xb33a31, toneMapped: false }),
      traffic.length * 2,
    )
    const carGrilles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.72, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x343b3d, roughness: 0.58, metalness: 0.22 }),
      traffic.length,
    )
    carBody.name = 'traffic-car-bodies'
    carCabin.name = 'traffic-car-cabins'
    carWindows.name = 'traffic-car-glass'
    const balconies = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.1, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x8b8c83, roughness: 0.78 }),
      maxWindows,
    )
    const balconyRails = new THREE.InstancedMesh(
      boxAssembly([
        { size: [0.9, 0.045, 0.045], at: [0, 0.28, 0] },
        { size: [0.045, 0.54, 0.045], at: [-0.42, 0.02, 0] },
        { size: [0.045, 0.54, 0.045], at: [0, 0.02, 0] },
        { size: [0.045, 0.54, 0.045], at: [0.42, 0.02, 0] },
      ]),
      new THREE.MeshStandardMaterial({ color: 0x525e5f, roughness: 0.52, metalness: 0.28 }),
      maxWindows,
    )
    let flatCount = 0
    let pitchedCount = 0
    let windowCount = 0
    let doorCount = 0
    let signCount = 0
    let corniceCount = 0
    let roofUnitCount = 0
    let balconyCount = 0
    let pilasterCount = 0
    let parapetCount = 0
    let storefrontCount = 0
    let awningCount = 0
    const color = new THREE.Color()
    for (const [i, b] of buildings.entries()) {
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)
      const localWorld = (lx: number, lz: number): [number, number] => [
        b.x + lx * c + lz * s,
        b.z - lx * s + lz * c,
      ]
      const placeWindow = (lx: number, lz: number, y: number, rotation: number) => {
        const [gx, gz] = localWorld(lx, lz - 0.05)
        const [wx, wz] = localWorld(lx, lz - 0.09)
        const [fx, fz] = localWorld(lx, lz - 0.085)
        glass.setMatrixAt(windowCount, matrixAt(gx, y, gz, rotation, 1, 1, 1))
        windows.setMatrixAt(windowCount, matrixAt(wx, y, wz, rotation, 1, 1, 1))
        frames.setMatrixAt(windowCount, matrixAt(fx, y, fz, rotation, 1, 1, 1))
        color.setHex(b.color, THREE.SRGBColorSpace).lerp(new THREE.Color(0xf3e0bd), 0.42)
        frames.setColorAt(windowCount, color)
        windowCount += 1
      }
      body.setMatrixAt(i, matrixAt(b.x, b.ground + b.height / 2, b.z, b.rotation, b.width, b.height, b.depth))
      color.setHex(b.color, THREE.SRGBColorSpace)
      body.setColorAt(i, color)
      if (b.roof) {
        pitchedRoof.setMatrixAt(pitchedCount, matrixAt(b.x, b.ground + b.height + 0.22, b.z, b.rotation + Math.PI / 4, b.width * 1.15, 0.76, b.depth * 1.15))
        color.setHex(b.roofColor, THREE.SRGBColorSpace)
        pitchedRoof.setColorAt(pitchedCount, color)
        pitchedCount += 1
      } else {
        flatRoof.setMatrixAt(flatCount, matrixAt(b.x, b.ground + b.height + 0.16, b.z, b.rotation, b.width * 1.03, 0.32, b.depth * 1.03))
        color.setHex(b.roofColor, THREE.SRGBColorSpace)
        flatRoof.setColorAt(flatCount, color)
        flatCount += 1
      }
      const floors = Math.min(b.windowCount, Math.floor(b.height / 4.2))
      const frontColumns = Math.min(3, Math.max(1, Math.floor(b.width / 4)))
      const frontZ = -b.depth / 2 - 0.045
      for (let floor = 0; floor < floors; floor += 1) {
        const y = b.ground + 2.4 + floor * 4.1
        for (let slot = 0; slot < frontColumns; slot += 1) {
          const lx = ((slot + 1) / (frontColumns + 1) - 0.5) * b.width
          placeWindow(lx, frontZ, y, b.rotation)
          if (b.height > 18 && b.height < 42 && floor > 0 && hash2(i, floor * 7 + slot, 105) > 0.62) {
            const [bx, bz] = localWorld(lx, frontZ - 0.22)
            const balconyY = y - 0.49
            balconies.setMatrixAt(balconyCount, matrixAt(bx, balconyY, bz, b.rotation, 0.82, 0.82, 1))
            const [rx, rz] = localWorld(lx, frontZ - 0.39)
            balconyRails.setMatrixAt(balconyCount, matrixAt(rx, balconyY + 0.05, rz, b.rotation, 0.82, 0.82, 1))
            balconyCount += 1
          }
        }
        if (b.height > 10) {
          placeWindow(b.width / 2 + 0.045, 0, y, b.rotation + Math.PI / 2)
        }
      }

      // Uma entrada visível ajuda a dar escala às construções vistas em rasante.
      const [doorX, doorZ] = localWorld(0, frontZ - 0.035)
      doors.setMatrixAt(doorCount, matrixAt(doorX, b.ground + 1.13, doorZ, b.rotation, 1, 1, 1))
      color.setHex([0x49362e, 0x35454a, 0x624333][Math.floor(hash2(i, 3, 106) * 3)], THREE.SRGBColorSpace)
      doors.setColorAt(doorCount++, color)

      if (b.height < 16 && hash2(i, 11, 109) > 0.28) {
        const shopWidth = Math.min(7.2, b.width * 0.72)
        const [sx, sz] = localWorld(0, frontZ - 0.01)
        storefronts.setMatrixAt(storefrontCount, matrixAt(sx, b.ground + 1.32, sz, b.rotation, shopWidth, 1.6, 1))
        color.setHex([0x38535a, 0x493a32, 0x52634e][Math.floor(hash2(i, 12, 109) * 3)], THREE.SRGBColorSpace)
        storefronts.setColorAt(storefrontCount++, color)
        const [ax, az] = localWorld(0, frontZ - 0.55)
        awnings.setMatrixAt(awningCount, matrixAt(ax, b.ground + 3.05, az, b.rotation, shopWidth, 1, 1))
        color.setHex([0x8a5140, 0x64704f, 0xb19a72, 0x566b78][Math.floor(hash2(i, 13, 109) * 4)], THREE.SRGBColorSpace)
        awnings.setColorAt(awningCount++, color)
      }

      // Letreiros em parte dos prédios baixos quebram a repetição do bloco residencial.
      if (b.height < 17 && hash2(i, 5, 107) > 0.52) {
        const [signX, signZ] = localWorld(0, frontZ - 0.09)
        signs.setMatrixAt(signCount, matrixAt(signX, b.ground + 3.25, signZ, b.rotation, Math.min(9, b.width * 0.72), 1, 1))
        color.setHex([0x315e68, 0x8c503e, 0x596344, 0x594b68][Math.floor(hash2(i, 9, 108) * 4)], THREE.SRGBColorSpace)
        signs.setColorAt(signCount++, color)
      }

      // Cornijas discretas marcam os andares; unidades de ventilação pontuam os terraços altos.
      for (let y = 10; y < b.height - 3 && corniceCount < buildings.length * 8; y += 9) {
        cornices.setMatrixAt(corniceCount, matrixAt(b.x, b.ground + y, b.z, b.rotation, b.width + 0.34, 0.15, b.depth + 0.34))
        color.setHex(b.roofColor, THREE.SRGBColorSpace).lerp(new THREE.Color(0xe5d6bc), 0.25)
        cornices.setColorAt(corniceCount++, color)
      }
      if (b.height > 20 && !b.roof) {
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
          const [px, pz] = localWorld(lx * (b.width / 2 + 0.04), lz * (b.depth / 2 + 0.04))
          pilasters.setMatrixAt(pilasterCount, matrixAt(px, b.ground + b.height / 2, pz, b.rotation, 0.24, b.height * 0.98, 0.24))
          color.setHex(b.color, THREE.SRGBColorSpace).lerp(new THREE.Color(0xf4eddb), 0.36)
          pilasters.setColorAt(pilasterCount++, color)
        }
      }
      if (!b.roof && b.height > 12) {
        const py = b.ground + b.height + 0.47
        for (const side of [-1, 1]) {
          const [fx, fz] = localWorld(0, side * (b.depth / 2 + 0.02))
          const [sx, sz] = localWorld(side * (b.width / 2 + 0.02), 0)
          parapets.setMatrixAt(parapetCount, matrixAt(fx, py, fz, b.rotation, b.width + 0.08, 0.72, 0.18))
          color.setHex(b.roofColor, THREE.SRGBColorSpace).lerp(new THREE.Color(0xf0e7d6), 0.24)
          parapets.setColorAt(parapetCount++, color)
          parapets.setMatrixAt(parapetCount, matrixAt(sx, py, sz, b.rotation, 0.18, 0.72, b.depth + 0.08))
          parapets.setColorAt(parapetCount++, color)
        }
      }
      if (!b.roof && b.height > 25) {
        for (const side of [-1, 1]) {
          const lx = side * Math.min(2.4, b.width * 0.23)
          const lz = b.depth * 0.14
          const rx = b.x + lx * c + lz * s
          const rz = b.z - lx * s + lz * c
          roofUnits.setMatrixAt(roofUnitCount++, matrixAt(rx, b.ground + b.height + 0.66, rz, b.rotation, 1.8, 1.1, 1.35))
        }
      }
    }
    body.instanceMatrix.needsUpdate = true
    flatRoof.count = flatCount
    flatRoof.instanceMatrix.needsUpdate = true
    pitchedRoof.count = pitchedCount
    pitchedRoof.instanceMatrix.needsUpdate = true
    glass.count = windowCount
    glass.instanceMatrix.needsUpdate = true
    frames.count = windowCount
    frames.instanceMatrix.needsUpdate = true
    if (frames.instanceColor) frames.instanceColor.needsUpdate = true
    windows.count = windowCount
    windows.instanceMatrix.needsUpdate = true
    doors.count = doorCount
    doors.instanceMatrix.needsUpdate = true
    if (doors.instanceColor) doors.instanceColor.needsUpdate = true
    signs.count = signCount
    signs.instanceMatrix.needsUpdate = true
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true
    cornices.count = corniceCount
    cornices.instanceMatrix.needsUpdate = true
    if (cornices.instanceColor) cornices.instanceColor.needsUpdate = true
    roofUnits.count = roofUnitCount
    roofUnits.instanceMatrix.needsUpdate = true
    this.windowCount = windowCount
    this.facadeDetailCount = windowCount * 3 + doorCount + signCount + corniceCount + roofUnitCount + balconyCount * 2 + pilasterCount + parapetCount + storefrontCount + awningCount

    traffic.forEach((vehicle, i) => {
      color.setHex(vehicle.color, THREE.SRGBColorSpace)
      carBody.setColorAt(i, color)
      color.lerp(new THREE.Color(0xe7dec9), 0.16)
      carCabin.setColorAt(i, color)
    })
    carBody.instanceColor!.needsUpdate = true
    carCabin.instanceColor!.needsUpdate = true
    this.updateTraffic = (time: number) => {
      for (let i = 0; i < traffic.length; i += 1) {
        const vehicle = traffic[i]
        const progress = ((vehicle.phase + time * vehicle.speed) % vehicle.span + vehicle.span) % vehicle.span
        const along = vehicle.min + progress
        const localX = vehicle.axis === 'z' ? vehicle.line + vehicle.direction * 1.45 : along
        const localZ = vehicle.axis === 'z' ? along : vehicle.line - vehicle.direction * 1.45
        const [x, z] = localToWorld(vehicle.site, localX, localZ)
        const siteRotation = vehicle.site.seed * 0.017
        const rotation = siteRotation + (vehicle.axis === 'x' ? Math.PI / 2 : 0) + (vehicle.direction < 0 ? Math.PI : 0)
        const scale = vehicle.scale
        const roadY = surfaceAt(x, z) + 0.09
        carBody.setMatrixAt(i, matrixAt(x, roadY + 0.52 * scale, z, rotation, scale, scale, scale))
        carCabin.setMatrixAt(i, matrixAt(x, roadY + 0.91 * scale, z - 0.08 * scale, rotation, scale, scale, scale))
        carWindows.setMatrixAt(i, matrixAt(x, roadY + 0.94 * scale, z - 0.08 * scale, rotation, scale, scale, scale))
        let wheel = i * 4
        for (const wx of [-0.84, 0.84]) for (const wz of [-1.12, 1.12]) {
          const px = x + (wx * Math.cos(rotation) + wz * Math.sin(rotation)) * scale
          const pz = z + (-wx * Math.sin(rotation) + wz * Math.cos(rotation)) * scale
          carWheels.setMatrixAt(wheel++, matrixAt(px, roadY + 0.32 * scale, pz, rotation, scale, scale, scale))
        }
        for (let side = 0; side < 2; side += 1) {
          const lx = side === 0 ? -0.58 : 0.58
          const px = x + (lx * Math.cos(rotation) + 1.84 * Math.sin(rotation)) * scale
          const pz = z + (-lx * Math.sin(rotation) + 1.84 * Math.cos(rotation)) * scale
          carLights.setMatrixAt(i * 2 + side, matrixAt(px, roadY + 0.53 * scale, pz, rotation, scale, scale, scale))
          const tx = x + (lx * Math.cos(rotation) - 1.84 * Math.sin(rotation)) * scale
          const tz = z + (-lx * Math.sin(rotation) - 1.84 * Math.cos(rotation)) * scale
          carTailLights.setMatrixAt(i * 2 + side, matrixAt(tx, roadY + 0.53 * scale, tz, rotation, scale, scale, scale))
        }
        const gx = x + 1.88 * Math.sin(rotation) * scale
        const gz = z + 1.88 * Math.cos(rotation) * scale
        carGrilles.setMatrixAt(i, matrixAt(gx, roadY + 0.48 * scale, gz, rotation, scale, scale, scale))
      }
      carBody.instanceMatrix.needsUpdate = true
      carCabin.instanceMatrix.needsUpdate = true
      carWindows.instanceMatrix.needsUpdate = true
      carWheels.instanceMatrix.needsUpdate = true
      carLights.instanceMatrix.needsUpdate = true
      carTailLights.instanceMatrix.needsUpdate = true
      carGrilles.instanceMatrix.needsUpdate = true
    }
    this.updateTraffic(0)
    for (const mesh of [pilasters, parapets, storefronts, awnings]) mesh.instanceMatrix.needsUpdate = true
    for (const mesh of [pilasters, parapets, storefronts, awnings]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    pilasters.count = pilasterCount
    parapets.count = parapetCount
    storefronts.count = storefrontCount
    awnings.count = awningCount
    balconies.count = balconyCount
    balconyRails.count = balconyCount
    balconies.instanceMatrix.needsUpdate = true
    balconyRails.instanceMatrix.needsUpdate = true
    for (const mesh of [carBody, carCabin, carWindows, carWheels, carLights, carTailLights, carGrilles]) {
      mesh.castShadow = false
      mesh.receiveShadow = true
    }
    const laneMarkings = new THREE.Mesh(roadMarkingGeometry(CITY_SITES, false), new THREE.MeshStandardMaterial({ color: 0xd3bd76, roughness: 0.95 }))
    const crosswalkMarkings = new THREE.Mesh(roadMarkingGeometry(CITY_SITES, true), new THREE.MeshStandardMaterial({ color: 0xe0dfd4, roughness: 0.94 }))
    const sidewalks = new THREE.Mesh(roadGeometry(CITY_SITES, 14, 0.025), new THREE.MeshStandardMaterial({ color: 0xb7b2a5, roughness: 1 }))
    const roadShoulders = new THREE.Mesh(roadGeometry(CITY_SITES, 9, 0.045), new THREE.MeshStandardMaterial({ color: 0x686d69, roughness: 1 }))
    const asphalt = new THREE.Mesh(roadGeometry(CITY_SITES, 6.2, 0.075), new THREE.MeshStandardMaterial({ color: 0x30383d, roughness: 1 }))
    laneMarkings.name = 'road-lane-markings'
    crosswalkMarkings.name = 'road-crosswalk-markings'
    sidewalks.name = 'road-sidewalks'
    roadShoulders.name = 'road-shoulders'
    asphalt.name = 'road-asphalt'
    this.group.add(
      sidewalks,
      roadShoulders,
      asphalt,
      laneMarkings,
      crosswalkMarkings,
      body,
      flatRoof,
      pitchedRoof,
      glass,
      frames,
      windows,
      doors,
      signs,
      cornices,
      roofUnits,
      balconies,
      balconyRails,
      pilasters,
      parapets,
      storefronts,
      awnings,
      carBody,
      carCabin,
      carWindows,
      carWheels,
      carLights,
      carTailLights,
      carGrilles,
      utilityPoles,
      utilityWires,
    )
    this.detailMeshes = [laneMarkings, crosswalkMarkings, utilityPoles, utilityWires, glass, frames, windows, doors, signs, cornices, roofUnits, balconies, balconyRails, pilasters, parapets, storefronts, awnings]
    this.trafficMeshes = [carBody, carCabin, carWindows, carWheels, carLights, carTailLights, carGrilles]
    this.detailMeshes.forEach(mesh => { mesh.visible = false })
    this.trafficMeshes.forEach(mesh => { mesh.visible = false })
    this.trafficActive = false
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
    })
  }

  nearestPerch(position: THREE.Vector3, maxDistance: number): { position: THREE.Vector3; yaw: number; distance: number } | null {
    if (!Number.isFinite(maxDistance) || maxDistance < 0) return null
    let nearest: PerchPoint | null = null
    let nearestDistance = maxDistance
    for (const perch of this.perches) {
      const distance = position.distanceTo(perch.position)
      if (distance <= nearestDistance) { nearest = perch; nearestDistance = distance }
    }
    return nearest ? { position: nearest.position.clone(), yaw: nearest.yaw, distance: nearestDistance } : null
  }

  update(daylight: number, time = 0, camera?: THREE.Vector3): void {
    this.windowMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.1, 0, 0.95)
    if (!camera) {
      this.detailMeshes.forEach(mesh => { mesh.visible = true })
      this.trafficMeshes.forEach(mesh => { mesh.visible = true })
      this.trafficActive = true
      this.updateTraffic(time)
      return
    }
    const nearby = CITY_SITES.some(site => Math.hypot(camera.x - site.x, camera.z - site.z) < 380)
    if (nearby !== this.trafficActive) {
      this.detailMeshes.forEach(mesh => { mesh.visible = nearby })
      this.trafficMeshes.forEach(mesh => { mesh.visible = nearby })
      this.trafficActive = nearby
    }
    if (nearby) this.updateTraffic(time)
  }
}
