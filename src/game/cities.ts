import * as THREE from 'three'
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

const _matrix = new THREE.Matrix4()
const _quaternion = new THREE.Quaternion()
const _rotation = new THREE.Euler()
const _scale = new THREE.Vector3()
const _position = new THREE.Vector3()

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
  roadIndices.push(first, first + 1, first + 2, first, first + 2, first + 3)
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
        const tower = site.kind === 'city' && c === Math.floor(site.columns / 2) && r === Math.floor(site.rows / 2)
        const height = tower ? 58 : central ? 21 + hash2(c, r, site.seed + 3) * 36 : site.kind === 'city' ? 8 + hash2(c, r, site.seed + 3) * 14 : 6 + hash2(c, r, site.seed + 3) * 11
        const width = (site.kind === 'city' && central ? 11 : 8) + hash2(c, r, site.seed + 4) * (central ? 8 : 6)
        const depth = (site.kind === 'city' && central ? 10 : 8) + hash2(c, r, site.seed + 5) * (central ? 7 : 6)
        buildings.push({
          x, z, ground, width, depth, height,
          rotation: site.seed * 0.017 + (hash2(c, r, site.seed + 6) - 0.5) * 0.12,
          roof: site.kind === 'town' || !central,
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
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.82, 0.045), this.windowMaterial, maxWindows)
    windows.renderOrder = 1
    let flatCount = 0
    let pitchedCount = 0
    let windowCount = 0
    const color = new THREE.Color()
    for (const [i, b] of buildings.entries()) {
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)
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
      for (let floor = 0; floor < floors; floor += 1) {
        const y = b.ground + 2.4 + floor * 4.1
        for (let slot = 0; slot < frontColumns; slot += 1) {
          const lx = ((slot + 1) / (frontColumns + 1) - 0.5) * b.width
          const frontZ = -b.depth / 2 - 0.04
          const fx = b.x + lx * c + frontZ * s
          const fz = b.z - lx * s + frontZ * c
          windows.setMatrixAt(windowCount++, matrixAt(fx, y, fz, b.rotation, 1, 1, 1))
        }
        if (b.height > 10) {
          const sideX = b.x + (b.width / 2 + 0.04) * c
          const sideZ = b.z - (b.width / 2 + 0.04) * s
          windows.setMatrixAt(windowCount++, matrixAt(sideX, y, sideZ, b.rotation + Math.PI / 2, 1, 1, 1))
        }
      }
    }
    body.instanceMatrix.needsUpdate = true
    flatRoof.count = flatCount
    flatRoof.instanceMatrix.needsUpdate = true
    pitchedRoof.count = pitchedCount
    pitchedRoof.instanceMatrix.needsUpdate = true
    windows.count = windowCount
    windows.instanceMatrix.needsUpdate = true
    this.group.add(
      new THREE.Mesh(roadGeometry(CITY_SITES, 9, 0.035), new THREE.MeshStandardMaterial({ color: 0x8b8e83, roughness: 1 })),
      new THREE.Mesh(roadGeometry(CITY_SITES, 5.6, 0.075), new THREE.MeshStandardMaterial({ color: 0x424a50, roughness: 1 })),
      body,
      flatRoof,
      pitchedRoof,
      windows,
    )
    this.group.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
    })
  }

  update(daylight: number): void {
    this.windowMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.1, 0, 0.95)
  }
}
