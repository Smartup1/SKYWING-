import * as THREE from 'three'
import { CityColliders, generateCity, LANE_STEP, localToWorld, type Building, type CityData, type Perch } from './cityData'
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, surfaceAt } from './terrain'

const _matrix = new THREE.Matrix4()
const _quaternion = new THREE.Quaternion()
const _rotation = new THREE.Euler()
const _scale = new THREE.Vector3()
const _position = new THREE.Vector3()

function matrixAt(x: number, y: number, z: number, rotation: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  _position.set(x, y, z)
  _rotation.set(0, rotation, 0)
  _quaternion.setFromEuler(_rotation)
  _scale.set(sx, sy, sz)
  return _matrix.compose(_position, _quaternion, _scale)
}

const roadIndices: number[] = []

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
  roadIndices.push(first, first + 1, first + 2, first, first + 2, first + 3)
}

function roadGeometry(sites: readonly CitySite[], width: number, lift: number, dashed = false): THREE.BufferGeometry {
  const positions: number[] = []
  roadIndices.length = 0
  for (const site of sites) {
    const ex = (site.columns * site.spacing) / 2
    const ez = (site.rows * site.spacing) / 2
    const step = dashed ? 6 : 16
    for (let c = 0; c <= site.columns; c += 1) {
      const x = (c - site.columns / 2) * site.spacing
      for (let z = -ez; z < ez; z += dashed ? 12 : step) addRoadQuad(positions, site, [x, z], [x, Math.min(ez, z + step)], width, lift)
    }
    for (let r = 0; r <= site.rows; r += 1) {
      const z = (r - site.rows / 2) * site.spacing
      for (let x = -ex; x < ex; x += dashed ? 12 : step) addRoadQuad(positions, site, [x, z], [Math.min(ex, x + step), z], width, lift)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(roadIndices.slice())
  geometry.computeVertexNormals()
  return geometry
}

/** Praça: gramado levemente ondulado seguindo o terreno. */
function plazaGeometry(data: CityData): THREE.BufferGeometry {
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
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

type Volume = { x: number; z: number; y0: number; w: number; d: number; h: number; rot: number; color: number }

function windowSlots(v: Volume): number {
  if (v.h < 4.5) return 0
  const floors = Math.min(14, Math.floor(v.h / 4.2))
  const columns = Math.min(4, Math.max(1, Math.floor(v.w / 4)))
  return floors * (columns + 1)
}

const CAR_COLORS = [0xc0392b, 0x2e6da4, 0xe8e2d0, 0x2b2f33, 0xd6a02c, 0x3f8f5b, 0x8a8f96, 0x7a3b8c]
const TREE_TONES = [0x3f7d3a, 0x4d8c3f, 0x2f6b3c, 0x5b9a45, 0x6a9a3a]

type Car = { lane: number; offset: number; speed: number }

/** Assentamentos instanciados (poucas chamadas de desenho): prédios, praças, árvores, postes, carros e poleiros. */
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
  private readonly cars: Car[] = []
  private readonly carBody: THREE.InstancedMesh
  private readonly carLights: THREE.InstancedMesh
  private readonly perchBeams: THREE.InstancedMesh
  private readonly perchRings: THREE.InstancedMesh
  private readonly visited = new Set<number>()

  constructor() {
    this.group.name = 'procedural-cities'
    this.data = generateCity()
    const data = this.data
    this.colliders = new CityColliders(data.buildings)
    this.perches = data.perches
    this.buildingCount = data.buildings.length

    const volumes: Volume[] = []
    const color = new THREE.Color()
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
      body.setMatrixAt(i, matrixAt(v.x, v.y0 + v.h / 2, v.z, v.rot, v.w, v.h, v.d))
      body.setColorAt(i, color.setHex(v.color, THREE.SRGBColorSpace))
    }
    body.instanceMatrix.needsUpdate = true

    // Telhados: pirâmides baixas (casas e igreja) ou lajes finas com platibanda (prédios).
    const pitchedCount = data.buildings.filter(b => b.pitched).length
    const flatCount = data.buildings.length - pitchedCount
    const pitched = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7071, 1, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), Math.max(1, pitchedCount))
    const flat = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), Math.max(1, flatCount))
    let pi = 0
    let fi = 0
    let ai = 0
    const spires = data.buildings.filter(b => b.upper?.spire)
    const antennas = data.buildings.filter(b => b.antenna > 0)
    const spireMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7071, 1, 4), new THREE.MeshStandardMaterial({ color: 0x6f3a30, roughness: 0.85 }), Math.max(1, spires.length))
    const antennaMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 }), Math.max(1, antennas.length))
    const beaconMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), this.beaconMaterial, Math.max(1, antennas.length))
    const flatTopFor = (b: Building) => b.ground + b.height
    for (const b of data.buildings) {
      if (b.pitched) {
        pitched.setMatrixAt(pi, matrixAt(b.x, b.ground + b.height + b.roofHeight / 2, b.z, b.rotation + Math.PI / 4, b.width * 1.12, b.roofHeight, b.depth * 1.12))
        pitched.setColorAt(pi, color.setHex(b.roofColor, THREE.SRGBColorSpace))
        pi += 1
      } else {
        flat.setMatrixAt(fi, matrixAt(b.x, flatTopFor(b) + 0.2, b.z, b.rotation, b.width * 1.04, 0.4, b.depth * 1.04))
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
      spireMesh.setMatrixAt(i, matrixAt(b.x + u.ox * c + u.oz * s, b.ground + u.height + 2, b.z - u.ox * s + u.oz * c, b.rotation + Math.PI / 4, u.width * 1.15, 4, u.depth * 1.15))
    }
    for (const b of antennas) {
      const u = b.upper
      const top = u && !u.fromGround ? b.ground + b.height + u.height : b.ground + b.height
      antennaMesh.setMatrixAt(ai, matrixAt(b.x, top + b.antenna / 2, b.z, b.rotation, 0.5, b.antenna, 0.5))
      beaconMesh.setMatrixAt(ai, matrixAt(b.x, top + b.antenna + 0.4, b.z, 0, 1, 1, 1))
      ai += 1
    }
    antennaMesh.count = ai
    beaconMesh.count = ai
    spireMesh.count = spires.length

    // Janelas acesas à noite.
    let slots = 0
    for (const v of volumes) slots += windowSlots(v)
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.82, 0.045), this.windowMaterial, Math.max(1, slots))
    windows.renderOrder = 1
    let wi = 0
    for (const v of volumes) {
      if (v.h < 4.5) continue
      const c = Math.cos(v.rot)
      const s = Math.sin(v.rot)
      const floors = Math.min(14, Math.floor(v.h / 4.2))
      const columns = Math.min(4, Math.max(1, Math.floor(v.w / 4)))
      for (let floor = 0; floor < floors; floor += 1) {
        const y = v.y0 + 2.4 + floor * 4.1
        for (let slot = 0; slot < columns; slot += 1) {
          const lx = ((slot + 1) / (columns + 1) - 0.5) * v.w
          const frontZ = -v.d / 2 - 0.04
          windows.setMatrixAt(wi++, matrixAt(v.x + lx * c + frontZ * s, y, v.z - lx * s + frontZ * c, v.rot, 1, 1, 1))
        }
        windows.setMatrixAt(wi++, matrixAt(v.x + (v.w / 2 + 0.04) * c, y, v.z - (v.w / 2 + 0.04) * s, v.rot + Math.PI / 2, 1, 1, 1))
      }
    }
    windows.count = wi

    // Árvores (copa + tronco), postes e praças.
    const trees = data.trees
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }), Math.max(1, trees.length))
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5a4331, roughness: 1 }), Math.max(1, trees.length))
    for (const [i, t] of trees.entries()) {
      const h = 2.2 * t.scale
      trunks.setMatrixAt(i, matrixAt(t.x, t.ground + h / 2, t.z, 0, t.scale, h, t.scale))
      crowns.setMatrixAt(i, matrixAt(t.x, t.ground + h + 1.2 * t.scale, t.z, t.tone * 6, 1.7 * t.scale, 1.5 * t.scale, 1.7 * t.scale))
      crowns.setColorAt(i, color.setHex(TREE_TONES[Math.floor(t.tone * TREE_TONES.length) % TREE_TONES.length], THREE.SRGBColorSpace))
    }
    const lamps = data.lamps
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7 }), Math.max(1, lamps.length))
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 8, 6), this.lampMaterial, Math.max(1, lamps.length))
    for (const [i, l] of lamps.entries()) {
      poles.setMatrixAt(i, matrixAt(l.x, l.ground + 2.6, l.z, 0, 1, 5.2, 1))
      bulbs.setMatrixAt(i, matrixAt(l.x, l.ground + 5.3, l.z, 0, 1, 1, 1))
    }
    if (!trees.length) {
      crowns.count = 0
      trunks.count = 0
    }
    if (!lamps.length) {
      poles.count = 0
      bulbs.count = 0
    }
    const fountains = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.8, 2.1, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x8fb8d8, roughness: 0.25, metalness: 0.1 }), Math.max(1, data.plazas.length))
    for (const [i, p] of data.plazas.entries()) fountains.setMatrixAt(i, matrixAt(p.x, surfaceAt(p.x, p.z) + 0.45, p.z, 0, 1, 1, 1))
    fountains.count = data.plazas.length

    // Carros circulando pelas faixas (posição calculada a cada quadro).
    const lanes = data.lanes
    for (const [li, site] of CITY_SITES.entries()) {
      const laneIdx = lanes.map((l, i) => (l.site === li ? i : -1)).filter(i => i >= 0)
      if (!laneIdx.length) continue
      const count = site.kind === 'city' ? 46 : 16
      for (let k = 0; k < count; k += 1) {
        const lane = laneIdx[Math.floor(hash2(k, li, 701) * laneIdx.length)]
        this.cars.push({ lane, offset: hash2(k, li, 702) * lanes[lane].length, speed: 4.5 + hash2(k, li, 703) * 4.5 })
      }
    }
    this.carBody = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.25 }), Math.max(1, this.cars.length))
    this.carLights = new THREE.InstancedMesh(boxGeo, this.headlightMaterial, Math.max(1, this.cars.length))
    this.carBody.frustumCulled = false
    this.carLights.frustumCulled = false
    this.carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.carLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (const [i] of this.cars.entries()) this.carBody.setColorAt(i, color.setHex(CAR_COLORS[Math.floor(hash2(i, 9, 704) * CAR_COLORS.length)], THREE.SRGBColorSpace))
    this.carBody.count = this.cars.length
    this.carLights.count = this.cars.length
    this.updateCars(0)

    // Faróis dos poleiros: coluna de luz e anel sobre a laje.
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
      this.perchBeams.setMatrixAt(i, matrixAt(p.x, p.y + 15, p.z, 0, 1, 30, 1))
      this.perchRings.setMatrixAt(i, matrixAt(p.x, p.y + 0.5, p.z, 0, p.radius, 1, p.radius))
      this.setPerchColor(i, false)
    }
    this.perchBeams.count = perches.length
    this.perchRings.count = perches.length

    const roadMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
    const plazaMesh = new THREE.Mesh(plazaGeometry(data), roadMat(0x5f9a4c))
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d0, toneMapped: true })
    this.group.add(
      new THREE.Mesh(roadGeometry(CITY_SITES, 9, 0.035), roadMat(0x9a9c92)),
      new THREE.Mesh(roadGeometry(CITY_SITES, 5.6, 0.075), roadMat(0x424a50)),
      new THREE.Mesh(roadGeometry(CITY_SITES, 0.25, 0.09, true), lineMat),
      plazaMesh, fountains,
      body, flat, pitched, spireMesh, antennaMesh, beaconMesh, windows,
      crowns, trunks, poles, bulbs,
      this.carBody, this.carLights,
      this.perchBeams, this.perchRings,
    )
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

  private setPerchColor(i: number, visited: boolean): void {
    const c = new THREE.Color(visited ? 0x7ee08a : 0xffd35c)
    this.perchBeams.setColorAt(i, c)
    this.perchRings.setColorAt(i, c)
    if (this.perchBeams.instanceColor) this.perchBeams.instanceColor.needsUpdate = true
    if (this.perchRings.instanceColor) this.perchRings.instanceColor.needsUpdate = true
  }

  /** Marca poleiros já usados neste voo (ficam verdes). */
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

  /** Poleiro mais próximo que ainda não foi visitado, se houver. */
  nearestPerch(x: number, y: number, z: number, onlyNew = true): { perch: Perch; dist: number } | null {
    let best: { perch: Perch; dist: number } | null = null
    for (const p of this.perches) {
      if (onlyNew && this.visited.has(p.id)) continue
      const d = Math.hypot(p.x - x, p.y - y, p.z - z)
      if (!best || d < best.dist) best = { perch: p, dist: d }
    }
    return best
  }

  private carTime = 0

  private updateCars(dt: number): void {
    this.carTime += dt
    const lanes = this.data.lanes
    for (const [i, car] of this.cars.entries()) {
      const lane = lanes[car.lane]
      const s = (car.offset + this.carTime * car.speed) % lane.length
      const k = s / lane.length
      const f = s / LANE_STEP
      const i0 = Math.min(lane.heights.length - 1, Math.floor(f))
      const i1 = Math.min(lane.heights.length - 1, i0 + 1)
      const y = lane.heights[i0] + (lane.heights[i1] - lane.heights[i0]) * (f - i0) + 0.75
      const x = lane.ax + (lane.bx - lane.ax) * k
      const z = lane.az + (lane.bz - lane.az) * k
      const heading = Math.atan2(lane.bx - lane.ax, lane.bz - lane.az)
      this.carBody.setMatrixAt(i, matrixAt(x, y, z, heading, 1.8, 1.3, 4))
      const fx = Math.sin(heading) * 2.05
      const fz = Math.cos(heading) * 2.05
      this.carLights.setMatrixAt(i, matrixAt(x + fx, y + 0.05, z + fz, heading, 1.5, 0.3, 0.12))
    }
    this.carBody.instanceMatrix.needsUpdate = true
    this.carLights.instanceMatrix.needsUpdate = true
  }

  update(daylight: number, dt = 0, time = 0): void {
    const night = THREE.MathUtils.clamp((1 - daylight) * 1.1, 0, 0.95)
    this.windowMaterial.opacity = night
    this.lampMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.6, 0, 1)
    this.headlightMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.6, 0, 1)
    this.beaconMaterial.opacity = (0.35 + 0.65 * Math.max(0, Math.sin(time * 3))) * 0.95
    this.beamMaterial.opacity = 0.16 + 0.07 * Math.sin(time * 2.2)
    if (dt > 0) this.updateCars(Math.min(dt, 0.1))
  }
}
