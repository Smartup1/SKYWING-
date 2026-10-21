import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
<<<<<<< HEAD
import type { Assets } from '../engine/assets'
import arvoreUrl from '../../assets/models/arvore_folhosa.glb?url'
import coniferaUrl from '../../assets/models/conifera.glb?url'
import rochaUrl from '../../assets/models/rocha.glb?url'
import ninhoUrl from '../../assets/models/ninho.glb?url'
import { coniferShare, forestDensity, groundColor, hash2, heightAt, noise2, slopeAt, WATER_LEVEL } from './terrain'
import { isUrbanAt } from './cityLayout'
import type { SkyState } from './daylight'

export type WindUniforms = {
  uTime: { value: number }
  uWind: { value: THREE.Vector3 }
}

export class WindState {
  readonly direction = new THREE.Vector3(1, 0, 0.35).normalize()
  strength = 0.55
  gust = 1
  readonly uniforms: WindUniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(this.direction.x, this.strength, this.direction.z) },
  }

  update(time: number): void {
    this.uniforms.uTime.value = time
    this.gust = 0.65
      + 0.25 * Math.sin(time * 0.27)
      + 0.10 * Math.sin(time * 0.71 + 1.4)
    const s = this.strength * this.gust
    this.uniforms.uWind.value.set(this.direction.x * s, s, this.direction.z * s)
  }
}

const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g)

export type Prop = { geometry: THREE.BufferGeometry; material: THREE.Material }

const _c = new THREE.Color()

const tint = (hex: number, jitter: number, seed: number): THREE.Color => {
  _c.setHex(hex)
  const k = 1 + (hash2(seed, 3, 3) - 0.5) * jitter
  return _c.multiplyScalar(k).clone()
}

function paint(g: THREE.BufferGeometry, fn: (y: number, i: number) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 1) {
    const c = fn(pos.getY(i), i)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

function makeTreeBillboard(kind: 'broad' | 'conifer' | 'rock'): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, S, S)

  if (kind === 'broad') {
    ctx.fillStyle = '#3a2414'
    ctx.beginPath()
    ctx.moveTo(S * 0.46, S * 0.98)
    ctx.lineTo(S * 0.485, S * 0.55)
    ctx.lineTo(S * 0.515, S * 0.55)
    ctx.lineTo(S * 0.54, S * 0.98)
    ctx.closePath()
    ctx.fill()
    for (let i = 0; i < 22; i += 1) {
      const ang = i * 2.399
      const rad = 0.08 + (i / 22) * 0.22
      const cx = S * 0.5 + Math.cos(ang) * rad * S * (0.5 + 0.35 * Math.sin(i * 1.3))
      const cy = S * 0.34 + Math.sin(ang) * rad * S * 0.55
      const r = S * (0.09 + 0.06 * Math.sin(i * 1.9))
      const shade = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(i * 2.1))
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6)
      g.addColorStop(0, `rgb(${(62 * shade) | 0},${(105 * shade) | 0},${(45 * shade) | 0})`)
      g.addColorStop(1, `rgba(${(40 * shade) | 0},${(72 * shade) | 0},${(30 * shade) | 0},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (kind === 'conifer') {
    ctx.fillStyle = '#2a1a0a'
    ctx.fillRect(S * 0.47, S * 0.85, S * 0.06, S * 0.15)
    for (let tier = 0; tier < 4; tier += 1) {
      const y0 = S * (0.06 + tier * 0.19)
      const y1 = S * (0.32 + tier * 0.19)
      const w = S * (0.10 + tier * 0.06)
      const shade = 0.7 + tier * 0.08
      ctx.fillStyle = `rgb(${(25 * shade) | 0},${(58 * shade) | 0},${(32 * shade) | 0})`
      ctx.beginPath()
      ctx.moveTo(S * 0.5, y0)
      ctx.lineTo(S * 0.5 - w, y1)
      ctx.lineTo(S * 0.5 + w, y1)
      ctx.closePath()
      ctx.fill()
    }
  } else {
    ctx.fillStyle = '#7a7568'
    ctx.beginPath()
    ctx.moveTo(S * 0.12, S * 0.85)
    for (let i = 0; i <= 12; i += 1) {
      const a = Math.PI + (i / 12) * Math.PI
      const r = S * (0.36 + 0.08 * Math.sin(i * 3.7 + 0.3))
      ctx.lineTo(S * 0.5 + Math.cos(a) * r, S * 0.75 + Math.sin(a) * r * 0.55)
    }
    ctx.closePath()
    ctx.fill()
    const g = ctx.createLinearGradient(0, S * 0.5, 0, S * 0.9)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = g
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 2
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

function billboardGeometry(w: number, h: number, planes = 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < planes; i += 1) {
    const q = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0)
    q.rotateY((i / planes) * Math.PI)
    parts.push(q)
  }
  return mergeGeometries(parts)!
}

const INJECT_CACHE = new WeakSet<THREE.Material>()

function injectWind(mat: THREE.Material, uniforms: WindUniforms, scale: number, bendExp: number): void {
  if (INJECT_CACHE.has(mat)) return
  INJECT_CACHE.add(mat)
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, ...rest) => {
    prev?.(shader, ...rest)
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uWind = uniforms.uWind
    shader.vertexShader = `
      uniform float uTime;
      uniform vec3 uWind;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
       #else
         vec3 iPos = vec3(0.0);
       #endif
       float wPhase = uTime * 1.6 + iPos.x * 0.11 + iPos.z * 0.09;
       float wSway = sin(wPhase) * 0.6 + sin(wPhase * 1.73 + 1.4) * 0.4;
       float wFac = pow(max(position.y, 0.0), ${bendExp.toFixed(2)}) * ${scale.toFixed(4)};
       transformed.xz += uWind.xz * wSway * wFac;
      `,
    )
  }
}

let _lowBroad: THREE.BufferGeometry | null = null
let _lowConifer: THREE.BufferGeometry | null = null
let _lowRock: THREE.BufferGeometry | null = null

function lowPolyBroad(): THREE.BufferGeometry {
  if (_lowBroad) return _lowBroad
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(flat(new THREE.CylinderGeometry(0.025, 0.04, 0.42, 6).translate(0, 0.21, 0)), () => new THREE.Color(0x4a3524)))
  const blobs: [number, number, number, number][] = [
    [0, 0.62, 0, 0.34], [0.2, 0.52, 0.08, 0.24], [-0.18, 0.56, -0.1, 0.26],
    [0.04, 0.82, -0.06, 0.22], [-0.04, 0.5, 0.2, 0.22],
  ]
  for (let i = 0; i < blobs.length; i += 1) {
    const [x, y, z, r] = blobs[i]
    const b = new THREE.IcosahedronGeometry(r, 1).scale(1, 0.82, 1).translate(x, y, z)
    parts.push(paint(flat(b), (py, vi) =>
      tint(0x3d6b2a, 0.5, vi + i * 7).lerp(new THREE.Color(0x6a8f3a), Math.max(0, (py - y) / r) * 0.5),
    ))
  }
  _lowBroad = mergeGeometries(parts)!
  _lowBroad.computeVertexNormals()
  return _lowBroad
}

function lowPolyConifer(): THREE.BufferGeometry {
  if (_lowConifer) return _lowConifer
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(flat(new THREE.CylinderGeometry(0.02, 0.035, 0.2, 6).translate(0, 0.1, 0)), () => new THREE.Color(0x4a3524)))
  const tiers: [number, number, number][] = [[0.2, 0.3, 0.3], [0.4, 0.24, 0.3], [0.6, 0.18, 0.26], [0.78, 0.12, 0.22]]
  for (let i = 0; i < tiers.length; i += 1) {
    const [y, r, h] = tiers[i]
    const c = new THREE.ConeGeometry(r, h, 9).translate(0, y + h / 2, 0)
    parts.push(paint(flat(c), (py, vi) =>
      tint(0x24462d, 0.45, vi + i * 5).lerp(new THREE.Color(0x3c6b3d), Math.max(0, (py - y) / h) * 0.3),
    ))
  }
  _lowConifer = mergeGeometries(parts)!
  _lowConifer.computeVertexNormals()
  return _lowConifer
}

function lowPolyRock(): THREE.BufferGeometry {
  if (_lowRock) return _lowRock
  const g = new THREE.IcosahedronGeometry(0.5, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i += 1) {
    const k = 0.78 + 0.4 * hash2(Math.round(p.getX(i) * 40), Math.round(p.getY(i) * 40), Math.round(p.getZ(i) * 40))
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k)
  }
  g.translate(0, 0.28, 0)
  const ng = flat(g)
  paint(ng, (_y, i) => tint(0x777166, 0.3, i))
  ng.computeVertexNormals()
  _lowRock = ng
  return ng
}

async function loadProp(assets: Assets, url: string, fallback: () => Prop): Promise<Prop> {
  try {
    const gltf = await assets.gltf(url)
    let mesh: THREE.Mesh | undefined
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse(o => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh
    })
    if (!mesh) return fallback()
    const g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const h = bb.max.y - bb.min.y
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
    g.scale(1 / h, 1 / h, 1 / h)
    g.computeBoundingSphere()
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const mat = src.clone()
    mat.metalness = 0
    mat.roughness = Math.max(mat.roughness ?? 0.9, 0.85)
    mat.side = THREE.FrontSide
    mat.envMapIntensity = 0.6
    return { geometry: g, material: mat }
  } catch (err) {
    console.warn('Modelo não carregou, usando versão simples:', url, err)
    return fallback()
  }
}

type Cell = { t: 1 | 2 | 3; x: number; y: number; z: number; s: number; r: number; tilt: number }

const CELL = 14
const KEY_OFFSET = 600
const KEY_WIDTH = 2048
const key = (ix: number, iz: number) => (ix + KEY_OFFSET) * KEY_WIDTH + (iz + KEY_OFFSET)
const unkey = (k: number): [number, number] => [Math.floor(k / KEY_WIDTH) - KEY_OFFSET, (k % KEY_WIDTH) - KEY_OFFSET]

function evalCell(ix: number, iz: number): Cell | null {
  const px = (ix + 0.12 + 0.76 * hash2(ix, iz, 1)) * CELL
  const pz = (iz + 0.12 + 0.76 * hash2(ix, iz, 2)) * CELL
  const r2 = px * px + pz * pz
  if (r2 > 1560 * 1560) return null
  if (isUrbanAt(px, pz)) return null
  const h = heightAt(px, pz)
  if (h < 0.6) return null
  const slope = slopeAt(px, pz, 3)
  const fd = forestDensity(px, pz, h, slope)
  const roll = hash2(ix, iz, 3)
  const rot = hash2(ix, iz, 4) * Math.PI * 2
  if (roll < fd * 0.8) {
    const conifer = hash2(ix, iz, 5) < coniferShare(h, px, pz)
    const s = (conifer ? 22 + hash2(ix, iz, 6) * 14 : 15 + hash2(ix, iz, 6) * 10) * (0.85 + 0.3 * fd)
    return { t: conifer ? 2 : 1, x: px, y: h - 0.4, z: pz, s, r: rot, tilt: (hash2(ix, iz, 7) - 0.5) * 0.06 }
  }
  if (fd < 0.3 && slope < 0.45 && h < 100 && hash2(ix, iz, 8) < 0.02) {
    return { t: 1, x: px, y: h - 0.3, z: pz, s: 13 + hash2(ix, iz, 6) * 8, r: rot, tilt: 0 }
  }
  const rockChance = slope > 0.4 ? 0.1 : h > 110 ? 0.07 : h < 4 ? 0.025 : 0.004
  if (hash2(ix, iz, 9) < rockChance) {
    const big = h > 90 || slope > 0.6 ? 1.8 : 1
    return { t: 3, x: px, y: h - 0.2, z: pz, s: (1.8 + hash2(ix, iz, 10) * 5) * big, r: rot, tilt: 0 }
  }
  return null
}
=======
import { CityColliders, generateCity, LANE_STEP, localToWorld, type Building, type CityData, type Lane, type Perch } from './cityData'
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, surfaceAt } from './terrain'

const ROAD_SPEC = {
  0: { asphalt: 9.0, sidewalk: 3.0, curbHeight: 0.18, laneWidth: 3.5, centerLine: 'double-yellow' as const, edgeLines: true, hasParking: false },
  1: { asphalt: 6.4, sidewalk: 1.8, curbHeight: 0.15, laneWidth: 3.0, centerLine: 'dashed-white' as const, edgeLines: false, hasParking: false },
  2: { asphalt: 3.2, sidewalk: 0, curbHeight: 0, laneWidth: 3.2, centerLine: 'none' as const, edgeLines: false, hasParking: false },
} as const

const ASPHALT_DARK = 0x2a2e33
const ASPHALT_MID = 0x363b41
const ASPHALT_LIGHT = 0x45494e
const SIDEWALK_COLOR = 0x9a978c
const CURB_COLOR = 0xb8b4a8
const LINE_YELLOW = 0xd4b23a
const LINE_WHITE = 0xd8d4c4
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
<<<<<<< HEAD
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _cc = new THREE.Color()

function place(mesh: THREE.InstancedMesh, i: number, c: Cell, widthScale: number, shade: number): void {
  _e.set(c.tilt, c.r, 0, 'YXZ')
  _q.setFromEuler(_e)
  _p.set(c.x, c.y, c.z)
  _s.set(c.s * widthScale, c.s, c.s * widthScale)
  _m.compose(_p, _q, _s)
  mesh.setMatrixAt(i, _m)
  _cc.setScalar(shade)
  mesh.setColorAt(i, _cc)
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

const SEASON_TINT: Record<Season, THREE.Color> = {
  spring: new THREE.Color(1.05, 1.08, 0.92),
  summer: new THREE.Color(1.00, 1.00, 1.00),
  autumn: new THREE.Color(1.30, 0.92, 0.55),
  winter: new THREE.Color(0.82, 0.86, 0.94),
}

export class Forest {
  readonly group = new THREE.Group()
  broad!: Prop
  conifer!: Prop
  rock!: Prop
  nest!: Prop

  readonly wind = new WindState()
  season: Season = 'summer'

  private nearBroad!: THREE.InstancedMesh
  private nearConifer!: THREE.InstancedMesh
  private nearRock!: THREE.InstancedMesh
  private midBroad!: THREE.InstancedMesh
  private midConifer!: THREE.InstancedMesh
  private midRock!: THREE.InstancedMesh
  private farBroad!: THREE.InstancedMesh
  private farConifer!: THREE.InstancedMesh
  private farRock!: THREE.InstancedMesh

  private readonly cells = new Map<number, Cell | null>()
  private lastX = Infinity
  private lastZ = Infinity
  nearTreeRadius = 90
  midTreeRadius = 220
  farRadius = 950
  private nearCap = 70
  private midCap = 380
  private grass?: GrassField
  private disposed = false

  // Rastreamento de recursos próprios para dispose.
  private readonly ownedGeoms = new Set<THREE.BufferGeometry>()
  private readonly ownedMats = new Set<THREE.Material>()
  private readonly ownedTextures = new Set<THREE.Texture>()

  async load(assets: Assets, onProgress: (p: number) => void): Promise<void> {
    const mk = (g: () => THREE.BufferGeometry): (() => Prop) => () =>
      ({ geometry: g(), material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }) })
    ;[this.broad, this.conifer, this.rock, this.nest] = await Promise.all([
      loadProp(assets, arvoreUrl, mk(lowPolyBroad)),
      loadProp(assets, coniferaUrl, mk(lowPolyConifer)),
      loadProp(assets, rochaUrl, mk(lowPolyRock)),
      loadProp(assets, ninhoUrl, () => ({
        geometry: new THREE.TorusGeometry(0.4, 0.15, 8, 16).rotateX(Math.PI / 2),
        material: new THREE.MeshStandardMaterial({ color: 0x8a6a3a }),
      })),
    ])
    if (this.disposed) return
    for (const p of [this.broad, this.conifer, this.rock, this.nest]) {
      this.ownedGeoms.add(p.geometry)
      this.ownedMats.add(p.material as THREE.Material)
    }

    injectWind(this.broad.material, this.wind.uniforms, 0.14, 1.8)
    injectWind(this.conifer.material, this.wind.uniforms, 0.10, 2.0)
    injectWind(this.rock.material, this.wind.uniforms, 0.0, 1.0)

    onProgress(0.4)
    if (this.disposed) return

    const mkNear = (p: Prop, cap: number) => this.mkInst(p, cap, true, true)
    const mkMid = (p: Prop, cap: number) => {
      const mat = (p.material as THREE.MeshStandardMaterial).clone()
      this.ownedMats.add(mat)
      injectWind(mat, this.wind.uniforms, 0.10, 1.9)
      const m = new THREE.InstancedMesh(p.geometry, mat, cap)
      m.castShadow = false
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
      return m
    }
    const mkFar = (kind: 'broad' | 'conifer' | 'rock', cap: number) => {
      const tex = makeTreeBillboard(kind)
      this.ownedTextures.add(tex)
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        color: 0xffffff,
        fog: true,
      })
      this.ownedMats.add(mat)
      const geo = billboardGeometry(kind === 'conifer' ? 1.4 : 2.2, kind === 'rock' ? 0.9 : 1.9, 3)
      this.ownedGeoms.add(geo)
      const m = new THREE.InstancedMesh(geo, mat, cap)
      m.castShadow = false
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
      return m
    }

    this.nearBroad = mkNear(this.broad, this.nearCap)
    this.nearConifer = mkNear(this.conifer, this.nearCap)
    this.nearRock = mkNear(this.rock, 60)
    this.midBroad = mkMid(this.broad, this.midCap)
    this.midConifer = mkMid(this.conifer, this.midCap)
    this.midRock = mkMid(this.rock, 180)
    this.farBroad = mkFar('broad', 6000)
    this.farConifer = mkFar('conifer', 6000)
    this.farRock = mkFar('rock', 1500)

    const R = Math.ceil(this.farRadius / CELL)
    for (let iz = -R; iz <= R; iz += 1) {
      if (this.disposed) return
      for (let ix = -R; ix <= R; ix += 1) this.cell(ix, iz)
      if (iz % 8 === 0) {
        onProgress(0.4 + 0.6 * ((iz + R) / (2 * R)))
        await new Promise(r => setTimeout(r, 0))
      }
    }
    if (this.disposed) return
    this.grass = new GrassField(this.wind)
    this.group.add(this.grass.group)
=======
const _v = new THREE.Vector3()
const _col = new THREE.Color()

function composeMatrix(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _v.set(x, y, z)
  _e.set(0, ry, 0)
  _q.setFromEuler(_e)
  return _m.compose(_v, _q, _v.set(sx, sy, sz))
}

type Intersection = { x: number; z: number; size: number; tier: 0 | 1 | 2 }

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
      if (Math.abs(a.tier - b.tier) > 1) continue

      const bdx = b.bx - b.ax
      const bdz = b.bz - b.az
      const blen = Math.hypot(bdx, bdz)
      if (blen < 0.1) continue
      const bux = bdx / blen, buz = bdz / blen

      const dot = Math.abs(aux * bux + auz * buz)
      if (dot > 0.5) continue

      const denom = aux * buz - auz * bux
      if (Math.abs(denom) < 1e-4) continue
      const t = ((b.ax - a.ax) * buz - (b.az - a.az) * bux) / denom
      const s = ((b.ax - a.ax) * auz - (b.az - a.az) * aux) / denom

      if (t < -0.02 || t > 1.02 || s < -0.02 || s > 1.02) continue

      const cx = a.ax + adx * t
      const cz = a.az + adz * t

      const key = `${Math.round(cx / 4)},${Math.round(cz / 4)}`
      if (seen.has(key)) continue
      seen.add(key)

      const wA = ROAD_SPEC[a.tier].asphalt
      const wB = ROAD_SPEC[b.tier].asphalt
      const size = Math.max(wA, wB) + 0.4
      const tier = Math.min(a.tier, b.tier) as 0 | 1 | 2

      out.push({ x: cx, z: cz, size, tier })
    }
  }
  return out
}

type RoadLayerBuffers = {
  asphalt: { positions: number[]; indices: number[]; colors: number[] }
  sidewalk: { positions: number[]; indices: number[]; colors: number[] }
  curb: { positions: number[]; indices: number[]; colors: number[] }
  lines: { positions: number[]; indices: number[]; colors: number[] }
  intersection: { positions: number[]; indices: number[]; colors: number[] }
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

    pushQuad(sidewalkLayer, ex, ez, ye, ax, az, ya_in, bx, bz, yb_in, cx, cz, yc, color)

    const ya_in0 = surfaceAt(ax, az) + 0.02
    const yb_in0 = surfaceAt(bx, bz) + 0.02
    pushQuad(curbLayer, ax, az, ya_in0, ax, az, ya_in, bx, bz, yb_in, bx, bz, yb_in0, curbColor)
  }
}

function pushDoubleYellow(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  yLift: number, color: THREE.Color,
): void {
  pushRibbon(layer, a, b, 0.12, yLift, -0.18, color, 4)
  pushRibbon(layer, a, b, 0.12, yLift, 0.18, color, 4)
}

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

function pushEdgeLines(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  a: [number, number], b: [number, number],
  halfWidth: number, yLift: number, color: THREE.Color,
): void {
  pushRibbon(layer, a, b, 0.1, yLift, -(halfWidth - 0.15), color, 4)
  pushRibbon(layer, a, b, 0.1, yLift, halfWidth - 0.15, color, 4)
}

function pushIntersectionSquare(
  layer: { positions: number[]; indices: number[]; colors: number[] },
  cx: number, cz: number, size: number, yLift: number, color: THREE.Color,
): void {
  const h = size / 2
  const y = surfaceAt(cx, cz) + yLift
  pushQuad(layer, cx - h, cz - h, y, cx - h, cz + h, y, cx + h, cz + h, y, cx + h, cz - h, y, color)
}

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
  const stripDepth = 2.2
  const h = size / 2 + stripDepth / 2 + 0.1

  for (let i = 0; i < count; i += 1) {
    const offset = start + i * (stripeW + gap)
    let x0 = 0, z0 = 0, x1 = 0, z1 = 0
    if (side === 'north') {
      x0 = cx + offset; z0 = cz - h - stripDepth / 2
      x1 = cx + offset; z1 = cz - h + stripDepth / 2
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer, x0 - stripeW / 2, z0, y, x0 - stripeW / 2, z1, y, x0 + stripeW / 2, z1, y, x0 + stripeW / 2, z0, y, color)
    } else if (side === 'south') {
      x0 = cx + offset; z0 = cz + h - stripDepth / 2
      x1 = cx + offset; z1 = cz + h + stripDepth / 2
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer, x0 - stripeW / 2, z0, y, x0 - stripeW / 2, z1, y, x0 + stripeW / 2, z1, y, x0 + stripeW / 2, z0, y, color)
    } else if (side === 'east') {
      x0 = cx + h - stripDepth / 2; z0 = cz + offset
      x1 = cx + h + stripDepth / 2; z1 = cz + offset
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer, x0, z0 - stripeW / 2, y, x0, z0 + stripeW / 2, y, x1, z1 + stripeW / 2, y, x1, z1 - stripeW / 2, y, color)
    } else {
      x0 = cx - h - stripDepth / 2; z0 = cz + offset
      x1 = cx - h + stripDepth / 2; z1 = cz + offset
      const y = surfaceAt(x0, z0) + yLift
      pushQuad(layer, x0, z0 - stripeW / 2, y, x0, z0 + stripeW / 2, y, x1, z1 + stripeW / 2, y, x1, z1 - stripeW / 2, y, color)
    }
  }
}

function layerToGeometry(layer: { positions: number[]; indices: number[]; colors: number[] }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(layer.positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(layer.colors, 3))
  g.setIndex(layer.indices)
  g.computeVertexNormals()
  return g
}

const CAR_COLORS = [0xc0392b, 0x2e6da4, 0xe8e2d0, 0x2b2f33, 0xd6a02c, 0x3f8f5b, 0x8a8f96, 0x7a3b8c]
const TREE_TONES = [0x3f7d3a, 0x4d8c3f, 0x2f6b3c, 0x5b9a45, 0x6a9a3a]

type Car = {
  lane: number
  t: number
  dir: 1 | -1
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
  ;(group.userData as { materials?: THREE.Material[] }).materials = [
    bodyMaterial, trimMaterial, glassMaterial, lightMaterial, wheelMaterial,
  ]

  const chassisGeo = new THREE.BoxGeometry(2.0, 0.7, 4.2)
  const cabinGeo = new THREE.BoxGeometry(1.7, 0.7, 2.0)
  const hoodGeo = new THREE.BoxGeometry(1.6, 0.36, 1.2)
  const rearGeo = new THREE.BoxGeometry(1.5, 0.36, 0.9)
  const roofGeo = new THREE.BoxGeometry(1.3, 0.2, 1.3)
  const lampGeo = new THREE.BoxGeometry(0.2, 0.16, 0.3)
  const tailGeo = new THREE.BoxGeometry(0.16, 0.16, 0.3)
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16)
  ;(group.userData as { geometries?: THREE.BufferGeometry[] }).geometries = [
    chassisGeo, cabinGeo, hoodGeo, rearGeo, roofGeo, lampGeo, tailGeo, wheelGeo,
  ]

  const chassis = new THREE.Mesh(chassisGeo, bodyMaterial)
  chassis.position.y = 0.72
  group.add(chassis)

  const cabin = new THREE.Mesh(cabinGeo, glassMaterial)
  cabin.position.set(0, 1.12, -0.18)
  group.add(cabin)

  const hood = new THREE.Mesh(hoodGeo, trimMaterial)
  hood.position.set(0, 0.8, 1.45)
  group.add(hood)

  const rear = new THREE.Mesh(rearGeo, trimMaterial)
  rear.position.set(0, 0.8, -1.6)
  group.add(rear)

  const roof = new THREE.Mesh(roofGeo, trimMaterial)
  roof.position.set(0, 1.55, -0.22)
  group.add(roof)

  const headlampL = new THREE.Mesh(lampGeo, lightMaterial)
  headlampL.position.set(-0.72, 0.8, 1.95)
  const headlampR = new THREE.Mesh(lampGeo, lightMaterial)
  headlampR.position.set(0.72, 0.8, 1.95)
  const taillampL = new THREE.Mesh(tailGeo, new THREE.MeshStandardMaterial({ color: 0xff433d, emissive: 0xff2d2d, emissiveIntensity: 0.9 }))
  taillampL.position.set(-0.65, 0.8, -2.02)
  const taillampR = new THREE.Mesh(tailGeo, taillampL.material)
  taillampR.position.set(0.65, 0.8, -2.02)
  ;((group.userData as { materials?: THREE.Material[] }).materials as THREE.Material[]).push(taillampL.material as THREE.Material)
  group.add(headlampL, headlampR, taillampL, taillampR)

  const wheelPositions = [
    [-0.85, 0.38, 1.35], [0.85, 0.38, 1.35],
    [-0.85, 0.38, -1.35], [0.85, 0.38, -1.35],
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

  private readonly windowMaterial: THREE.MeshBasicMaterial
  private readonly lampMaterial: THREE.MeshBasicMaterial
  private readonly beaconMaterial: THREE.MeshBasicMaterial
  private readonly beamMaterial: THREE.MeshBasicMaterial
  private readonly asphaltMaterial: THREE.MeshStandardMaterial
  private readonly sidewalkMaterial: THREE.MeshStandardMaterial
  private readonly curbMaterial: THREE.MeshStandardMaterial
  private readonly lineMaterial: THREE.MeshBasicMaterial
  private readonly crosswalkMaterial: THREE.MeshBasicMaterial
  private readonly treesMaterial: THREE.MeshStandardMaterial
  private readonly trunksMaterial: THREE.MeshStandardMaterial
  private readonly polesMaterial: THREE.MeshStandardMaterial
  private readonly plazaMaterial: THREE.MeshStandardMaterial
  private readonly fountainMaterial: THREE.MeshStandardMaterial
  private readonly bodyMaterial: THREE.MeshStandardMaterial
  private readonly pitchedMaterial: THREE.MeshStandardMaterial
  private readonly flatMaterial: THREE.MeshStandardMaterial
  private readonly spireMaterial: THREE.MeshStandardMaterial
  private readonly antennaMaterial: THREE.MeshStandardMaterial
  private readonly perchRingMaterial: THREE.MeshBasicMaterial

  private readonly cars: Car[] = []
  private readonly carGroups: THREE.Group[] = []
  private readonly perchBeams: THREE.InstancedMesh
  private readonly perchRings: THREE.InstancedMesh
  private readonly visited = new Set<number>()
  private readonly intersections: Intersection[]
  private disposed = false

  // Recursos próprios: materiais acima + geometrias + meshes instanciados.
  private readonly ownedGeoms = new Set<THREE.BufferGeometry>()
  private readonly ownedMats = new Set<THREE.Material>()
  private readonly ownedMeshes = new Set<THREE.Mesh | THREE.InstancedMesh>()

  constructor() {
    this.group.name = 'procedural-cities'
    this.data = generateCity()
    const data = this.data
    this.colliders = new CityColliders(data.buildings)
    this.perches = data.perches
    this.buildingCount = data.buildings.length
    this.intersections = findIntersections(data.lanes)

    this.windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    this.beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    this.asphaltMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 })
    this.sidewalkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
    this.curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
    this.lineMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    this.crosswalkMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.treesMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true })
    this.trunksMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4331, roughness: 1 })
    this.polesMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7 })
    this.plazaMaterial = new THREE.MeshStandardMaterial({ color: 0x5f9a4c, roughness: 1 })
    this.fountainMaterial = new THREE.MeshStandardMaterial({ color: 0x8fb8d8, roughness: 0.25, metalness: 0.1 })
    this.bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.02 })
    this.pitchedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
    this.flatMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    this.spireMaterial = new THREE.MeshStandardMaterial({ color: 0x6f3a30, roughness: 0.85 })
    this.antennaMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 })
    this.perchRingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })

    for (const m of [
      this.windowMaterial, this.lampMaterial, this.beaconMaterial, this.beamMaterial,
      this.asphaltMaterial, this.sidewalkMaterial, this.curbMaterial, this.lineMaterial,
      this.crosswalkMaterial, this.treesMaterial, this.trunksMaterial, this.polesMaterial,
      this.plazaMaterial, this.fountainMaterial, this.bodyMaterial, this.pitchedMaterial,
      this.flatMaterial, this.spireMaterial, this.antennaMaterial, this.perchRingMaterial,
    ]) this.ownedMats.add(m)

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
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
<<<<<<< HEAD
    this.grass?.dispose()
    this.grass = undefined
    for (const m of [this.nearBroad, this.nearConifer, this.nearRock, this.midBroad, this.midConifer, this.midRock, this.farBroad, this.farConifer, this.farRock]) {
      if (m) m.dispose()
    }
    for (const g of this.ownedGeoms) g.dispose()
    for (const m of this.ownedMats) m.dispose()
    for (const t of this.ownedTextures) t.dispose()
    this.ownedGeoms.clear()
    this.ownedMats.clear()
    this.ownedTextures.clear()
    this.cells.clear()
    this.group.clear()
  }

  private mkInst(p: Prop, cap: number, shadow: boolean, receive: boolean): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(p.geometry, p.material, cap)
    m.castShadow = shadow
    m.receiveShadow = receive
    m.frustumCulled = false
    m.count = 0
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
=======
    // Carros: geometrias e materiais são únicos por carro.
    for (const car of this.carGroups) {
      const ud = car.userData as { materials?: THREE.Material[]; geometries?: THREE.BufferGeometry[] }
      for (const g of ud.geometries ?? []) g.dispose()
      for (const m of ud.materials ?? []) m.dispose()
    }
    this.carGroups.length = 0
    this.cars.length = 0
    // Instanciados
    this.perchBeams.dispose()
    this.perchRings.dispose()
    // Recursos próprios
    for (const m of this.ownedMeshes) m.dispose?.()
    for (const g of this.ownedGeoms) g.dispose()
    for (const m of this.ownedMats) m.dispose()
    this.ownedMeshes.clear()
    this.ownedGeoms.clear()
    this.ownedMats.clear()
    this.group.clear()
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeoms.add(g)
    return g
  }

  private trackMesh<T extends THREE.Mesh | THREE.InstancedMesh>(m: T): T {
    this.ownedMeshes.add(m)
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad
    this.group.add(m)
    return m
  }

<<<<<<< HEAD
  private cell(ix: number, iz: number): Cell | null {
    const k = key(ix, iz)
    let c = this.cells.get(k)
    if (c === undefined) {
      c = evalCell(ix, iz)
      this.cells.set(k, c)
    }
    return c
  }

  private evictFarCells(cx: number, cz: number): void {
    if (this.cells.size < 60000) return
    const R = 120
    const toDelete: number[] = []
    for (const k of this.cells.keys()) {
      const [ix, iz] = unkey(k)
      if (Math.abs(ix - cx) > R || Math.abs(iz - cz) > R) toDelete.push(k)
    }
    for (const k of toDelete) this.cells.delete(k)
  }

  update(camX: number, camZ: number, camAgl: number, dt: number, sky: SkyState, time: number, density: number): void {
    if (this.disposed) return
    this.wind.update(time)
    if (Math.hypot(camX - this.lastX, camZ - this.lastZ) > 22) {
      this.lastX = camX
      this.lastZ = camZ
      this.evictFarCells(Math.floor(camX / CELL), Math.floor(camZ / CELL))
      this.rebuild(camX, camZ, density)
    }
    this.grass?.update(camX, camZ, camAgl, dt, sky, time, density)
  }

  forceRebuild(camX: number, camZ: number, density: number): void {
    if (this.disposed) return
    this.lastX = camX
    this.lastZ = camZ
    this.rebuild(camX, camZ, density)
  }

  setSeason(s: Season): void {
    this.season = s
    const t = SEASON_TINT[s]
    ;(this.broad.material as THREE.MeshStandardMaterial).color.copy(t)
    ;(this.conifer.material as THREE.MeshStandardMaterial).color.copy(t)
    ;(this.midBroad.material as THREE.MeshStandardMaterial).color.copy(t)
    ;(this.midConifer.material as THREE.MeshStandardMaterial).color.copy(t)
    ;(this.farBroad.material as THREE.MeshLambertMaterial).color.copy(t)
    ;(this.farConifer.material as THREE.MeshLambertMaterial).color.copy(t)
  }

  private rebuild(camX: number, camZ: number, density: number): void {
    if (this.disposed) return
    const R = Math.ceil(this.farRadius / CELL)
    const cx = Math.floor(camX / CELL)
    const cz = Math.floor(camZ / CELL)

    let nb = 0, nc = 0, nr = 0
    let mb = 0, mc = 0, mr = 0
    let fb = 0, fc = 0, fr = 0

    const nearR2 = this.nearTreeRadius * this.nearTreeRadius
    const midR2 = this.midTreeRadius * this.midTreeRadius
    const nearRockR2 = 150 * 150
    const midRockR2 = 280 * 280
    const farR2 = this.farRadius * this.farRadius

    for (let iz = cz - R; iz <= cz + R; iz += 1) {
      for (let ix = cx - R; ix <= cx + R; ix += 1) {
        const c = this.cell(ix, iz)
        if (!c) continue
        if (density < 1 && hash2(ix, iz, 99) > density) continue
        const dx = c.x - camX
        const dz = c.z - camZ
        const d2 = dx * dx + dz * dz
        if (d2 > farR2) continue

        if (c.t === 3) {
          if (d2 < nearRockR2 && nr < 60) place(this.nearRock, nr++, c, 1, 1)
          else if (d2 < midRockR2 && mr < 180) place(this.midRock, mr++, c, 1, 0.95)
          else if (fr < 1500) place(this.farRock, fr++, c, 0.8, 0.9 + hash2(ix, iz, 20) * 0.2)
        } else if (c.t === 1) {
          if (d2 < nearR2 && nb < this.nearCap) place(this.nearBroad, nb++, c, 1, 1)
          else if (d2 < midR2 && mb < this.midCap) place(this.midBroad, mb++, c, 1, 0.9 + hash2(ix, iz, 21) * 0.2)
          else if (fb < 6000) place(this.farBroad, fb++, c, 0.9, 0.85 + hash2(ix, iz, 21) * 0.3)
        } else {
          if (d2 < nearR2 && nc < this.nearCap) place(this.nearConifer, nc++, c, 1, 1)
          else if (d2 < midR2 && mc < this.midCap) place(this.midConifer, mc++, c, 1, 0.9 + hash2(ix, iz, 22) * 0.2)
          else if (fc < 6000) place(this.farConifer, fc++, c, 0.9, 0.85 + hash2(ix, iz, 22) * 0.3)
        }
      }
    }

    const set = (m: THREE.InstancedMesh, n: number) => {
      m.count = n
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    set(this.nearBroad, nb); set(this.nearConifer, nc); set(this.nearRock, nr)
    set(this.midBroad, mb); set(this.midConifer, mc); set(this.midRock, mr)
    set(this.farBroad, fb); set(this.farConifer, fc); set(this.farRock, fr)
  }

  setShadows(on: boolean): void {
    if (!this.nearBroad) return
    this.nearBroad.castShadow = on
    this.nearConifer.castShadow = on
    this.nearRock.castShadow = on
    this.midBroad.castShadow = false
    this.midConifer.castShadow = false
    this.midRock.castShadow = false
  }
}

// ============================================================================
// Grass field
// ============================================================================

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  for (let i = 0; i < 32; i += 1) {
    const x = 6 + hash2(i, 1, 40) * 116
    const lean = (hash2(i, 2, 40) - 0.5) * 40
    const h = 55 + hash2(i, 3, 40) * 70
    const grad = g.createLinearGradient(0, 128, 0, 128 - h)
    grad.addColorStop(0, 'rgb(60,80,35)')
    grad.addColorStop(0.55, 'rgb(105,140,60)')
    grad.addColorStop(1, `rgb(${170 + hash2(i, 4, 40) * 60},${205 + hash2(i, 5, 40) * 35},100)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x - 3, 128)
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h)
    g.quadraticCurveTo(x + lean * 0.35 + 3, 128 - h * 0.55, x + 3.5, 128)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function flowerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgb(70,120,50)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(32, 64)
  g.quadraticCurveTo(30, 40, 32, 26)
  g.stroke()
  g.fillStyle = 'rgb(255,255,255)'
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    g.beginPath()
    g.ellipse(32 + Math.cos(a) * 9, 20 + Math.sin(a) * 9, 7, 5, a, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = 'rgb(255,200,60)'
  g.beginPath()
  g.arc(32, 20, 5, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function crossQuads(w: number, h: number, planes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < planes; i += 1) {
    const q = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0)
    q.rotateY((i / planes) * Math.PI)
    parts.push(q)
  }
  return mergeGeometries(parts)!
}

const GRASS_RADIUS = 52
const GRASS_STEP = 1.15
const FLOWER_COLORS = [0xffffff, 0xffe45c, 0xff6fa4, 0x9a7bff, 0xff7a3d, 0xf5f0a0]

class GrassField {
  readonly group = new THREE.Group()
  private readonly tufts: THREE.InstancedMesh
  private readonly flowers: THREE.InstancedMesh
  private readonly tuftGeo: THREE.BufferGeometry
  private readonly flowerGeo: THREE.BufferGeometry
  private readonly tuftMat: THREE.MeshLambertMaterial
  private readonly flowerMat: THREE.MeshLambertMaterial
  private readonly tuftTex: THREE.CanvasTexture
  private readonly flowerTex: THREE.CanvasTexture
  private lastX = Infinity
  private lastZ = Infinity
  private job: Generator<void, void, void> | null = null
  private readonly capT = 8200
  private readonly capF = 1800
  private readonly bufT = new Float32Array(this.capT * 16)
  private readonly colT = new Float32Array(this.capT * 3)
  private readonly bufF = new Float32Array(this.capF * 16)
  private readonly colF = new Float32Array(this.capF * 3)
  private nT = 0
  private nF = 0
  private densityScale = 1
  private disposed = false

  constructor(wind: WindState) {
    this.tuftTex = grassTexture()
    this.tuftMat = new THREE.MeshLambertMaterial({
      map: this.tuftTex,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
    })
    injectWind(this.tuftMat, wind.uniforms, 0.22, 1.55)
    this.tuftGeo = crossQuads(0.9, 0.62, 3)
    this.tufts = new THREE.InstancedMesh(this.tuftGeo, this.tuftMat, this.capT)

    this.flowerTex = flowerTexture()
    this.flowerMat = new THREE.MeshLambertMaterial({
      map: this.flowerTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    })
    injectWind(this.flowerMat, wind.uniforms, 0.10, 1.6)
    this.flowerGeo = crossQuads(0.5, 0.5, 2)
    this.flowers = new THREE.InstancedMesh(this.flowerGeo, this.flowerMat, this.capF)

    for (const m of [this.tufts, this.flowers]) {
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
    }
    this.tufts.receiveShadow = true
    this.flowers.receiveShadow = true
    this.tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capT * 3), 3)
    this.flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capF * 3), 3)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tufts.dispose()
    this.flowers.dispose()
    this.tuftGeo.dispose()
    this.flowerGeo.dispose()
    this.tuftMat.dispose()
    this.flowerMat.dispose()
    this.tuftTex.dispose()
    this.flowerTex.dispose()
    this.group.clear()
  }

  setSeason(s: Season): void {
    const t = SEASON_TINT[s]
    ;(this.tufts.material as THREE.MeshLambertMaterial).color.copy(t)
    ;(this.flowers.material as THREE.MeshLambertMaterial).color.copy(t)
  }

  update(camX: number, camZ: number, agl: number, dt: number, sky: SkyState, time: number, density: number): void {
    if (this.disposed) return
    const active = agl < 70 && density > 0.05
    this.group.visible = active
    if (!active) return
    this.densityScale = density
    if (!this.job && Math.hypot(camX - this.lastX, camZ - this.lastZ) > 12) {
      this.lastX = camX
      this.lastZ = camZ
      this.job = this.generate(camX, camZ)
    }
    if (this.job) {
      for (let i = 0; i < 6; i += 1) {
        const r = this.job.next()
        if (r.done) {
          this.job = null
          this.commit()
          break
        }
      }
    }
    const lam = this.tufts.material as THREE.MeshLambertMaterial
    const sunTint = sky.sunColor
    const dusk = sky.twilight
    lam.emissive.setRGB(
      sunTint.r * 0.04 * dusk,
      sunTint.g * 0.03 * dusk,
      sunTint.b * 0.02 * dusk,
    )
    void dt
  }

  private commit(): void {
    if (this.disposed) return
    this.tufts.instanceMatrix.array.set(this.bufT.subarray(0, this.nT * 16))
    ;(this.tufts.instanceColor!.array as Float32Array).set(this.colT.subarray(0, this.nT * 3))
    this.tufts.count = this.nT
    this.tufts.instanceMatrix.needsUpdate = true
    this.tufts.instanceColor!.needsUpdate = true

    this.flowers.instanceMatrix.array.set(this.bufF.subarray(0, this.nF * 16))
    ;(this.flowers.instanceColor!.array as Float32Array).set(this.colF.subarray(0, this.nF * 3))
    this.flowers.count = this.nF
    this.flowers.instanceMatrix.needsUpdate = true
    this.flowers.instanceColor!.needsUpdate = true
  }

  private *generate(camX: number, camZ: number): Generator<void, void, void> {
    if (this.disposed) return
    const rgb: [number, number, number] = [0, 0, 0]
    const gx0 = Math.floor((camX - GRASS_RADIUS) / GRASS_STEP)
    const gx1 = Math.floor((camX + GRASS_RADIUS) / GRASS_STEP)
    const gz0 = Math.floor((camZ - GRASS_RADIUS) / GRASS_STEP)
    const gz1 = Math.floor((camZ + GRASS_RADIUS) / GRASS_STEP)
    let nT = 0
    let nF = 0
    let counter = 0
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    for (let gz = gz0; gz <= gz1; gz += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        counter += 1
        if (counter % 900 === 0) {
          if (this.disposed) return
          yield
        }
        const x = (gx + hash2(gx, gz, 61)) * GRASS_STEP
        const z = (gz + hash2(gx, gz, 62)) * GRASS_STEP
        if (isUrbanAt(x, z)) continue
        const dx = x - camX
        const dz = z - camZ
        const d = Math.hypot(dx, dz)
        if (d > GRASS_RADIUS) continue
        const fade = 1 - d / GRASS_RADIUS
        if (hash2(gx, gz, 63) > Math.min(1, fade * 1.7) * this.densityScale) continue
        const h = heightAt(x, z)
        if (h < 0.9 || h > 150) continue
        const slope = slopeAt(x, z, 2)
        if (slope > 0.6) continue
        const fd = forestDensity(x, z, h, slope)
        const dense = 0.45 + 0.55 * (noise2(x * 0.05, z * 0.05, 8) * 0.5 + 0.5)
        if (hash2(gx, gz, 64) > dense * (1 - fd * 0.35)) continue
        const sc = (0.7 + hash2(gx, gz, 65) * 0.9) * (0.7 + 0.5 * fade)
        e.set(0, hash2(gx, gz, 66) * 6.28, 0)
        q.setFromEuler(e)
        p.set(x, h - 0.03, z)
        s.set(sc, sc * (0.8 + 0.5 * hash2(gx, gz, 67)), sc)
        m.compose(p, q, s)
        if (nT < this.capT) {
          m.toArray(this.bufT, nT * 16)
          groundColor(x, z, h, slope, rgb)
          const k = 3.4 * (0.8 + hash2(gx, gz, 68) * 0.5)
          this.colT[nT * 3] = Math.min(1, rgb[0] * k + 0.04)
          this.colT[nT * 3 + 1] = Math.min(1, rgb[1] * k + 0.05)
          this.colT[nT * 3 + 2] = Math.min(1, rgb[2] * k + 0.02)
          nT += 1
        }
        const patch = noise2(x * 0.045 + 5, z * 0.045, 12)
        if (patch > 0.25 && nF < this.capF && hash2(gx, gz, 69) < 0.5 && h > 1.5) {
          const fc = FLOWER_COLORS[Math.floor(hash2(Math.floor(x / 9), Math.floor(z / 9), 70) * FLOWER_COLORS.length)]
          _cc.setHex(fc)
          p.set(x + 0.3, h - 0.02, z - 0.2)
          const fs = 0.55 + hash2(gx, gz, 71) * 0.5
          s.set(fs, fs, fs)
          m.compose(p, q, s)
          m.toArray(this.bufF, nF * 16)
          this.colF[nF * 3] = _cc.r
          this.colF[nF * 3 + 1] = _cc.g
          this.colF[nF * 3 + 2] = _cc.b
          nF += 1
        }
      }
    }
    this.nT = nT
    this.nF = nF
    void WATER_LEVEL
=======
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

    const boxGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1))
    const body = new THREE.InstancedMesh(boxGeo, this.bodyMaterial, volumes.length)
    for (const [i, v] of volumes.entries()) {
      body.setMatrixAt(i, composeMatrix(v.x, v.y0 + v.h / 2, v.z, v.rot, v.w, v.h, v.d))
      body.setColorAt(i, color.setHex(v.color, THREE.SRGBColorSpace))
    }
    body.instanceMatrix.needsUpdate = true
    this.trackMesh(body)

    const pitchedCount = data.buildings.filter(b => b.pitched).length
    const flatCount = data.buildings.length - pitchedCount
    const pitchedGeo = this.trackGeo(new THREE.ConeGeometry(0.7071, 1, 4))
    const pitched = new THREE.InstancedMesh(pitchedGeo, this.pitchedMaterial, Math.max(1, pitchedCount))
    const flat = new THREE.InstancedMesh(boxGeo, this.flatMaterial, Math.max(1, flatCount))
    let pi = 0, fi = 0, ai = 0
    const spires = data.buildings.filter(b => b.upper?.spire)
    const antennas = data.buildings.filter(b => b.antenna > 0)
    const spireGeo = this.trackGeo(new THREE.ConeGeometry(0.7071, 1, 4))
    const spireMesh = new THREE.InstancedMesh(spireGeo, this.spireMaterial, Math.max(1, spires.length))
    const antennaMesh = new THREE.InstancedMesh(boxGeo, this.antennaMaterial, Math.max(1, antennas.length))
    const beaconGeo = this.trackGeo(new THREE.SphereGeometry(0.55, 8, 6))
    const beaconMesh = new THREE.InstancedMesh(beaconGeo, this.beaconMaterial, Math.max(1, antennas.length))

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
    const winGeo = this.trackGeo(new THREE.BoxGeometry(0.62, 0.82, 0.045))
    const windows = new THREE.InstancedMesh(winGeo, this.windowMaterial, Math.max(1, slots))
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
    this.trackMesh(pitched)
    this.trackMesh(flat)
    this.trackMesh(spireMesh)
    this.trackMesh(antennaMesh)
    this.trackMesh(beaconMesh)
    this.trackMesh(windows)
  }

  private buildProps(): void {
    const data = this.data
    const color = new THREE.Color()
    const trees = data.trees
    const crownGeo = this.trackGeo(new THREE.IcosahedronGeometry(1, 1))
    const crowns = new THREE.InstancedMesh(crownGeo, this.treesMaterial, Math.max(1, trees.length))
    const trunkGeo = this.trackGeo(new THREE.CylinderGeometry(0.14, 0.2, 1, 6))
    const trunks = new THREE.InstancedMesh(trunkGeo, this.trunksMaterial, Math.max(1, trees.length))
    for (const [i, t] of trees.entries()) {
      const h = 2.2 * t.scale
      trunks.setMatrixAt(i, composeMatrix(t.x, t.ground + h / 2, t.z, 0, t.scale, h, t.scale))
      crowns.setMatrixAt(i, composeMatrix(t.x, t.ground + h + 1.2 * t.scale, t.z, t.tone * 6, 1.7 * t.scale, 1.5 * t.scale, 1.7 * t.scale))
      crowns.setColorAt(i, color.setHex(TREE_TONES[Math.floor(t.tone * TREE_TONES.length) % TREE_TONES.length], THREE.SRGBColorSpace))
    }
    if (!trees.length) { crowns.count = 0; trunks.count = 0 }

    const lamps = data.lamps
    const poleGeo = this.trackGeo(new THREE.CylinderGeometry(0.07, 0.09, 1, 5))
    const poles = new THREE.InstancedMesh(poleGeo, this.polesMaterial, Math.max(1, lamps.length))
    const bulbGeo = this.trackGeo(new THREE.SphereGeometry(0.36, 8, 6))
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampMaterial, Math.max(1, lamps.length))
    for (const [i, l] of lamps.entries()) {
      poles.setMatrixAt(i, composeMatrix(l.x, l.ground + 2.6, l.z, 0, 1, 5.2, 1))
      bulbs.setMatrixAt(i, composeMatrix(l.x, l.ground + 5.3, l.z, 0, 1, 1, 1))
    }
    if (!lamps.length) { poles.count = 0; bulbs.count = 0 }

    this.trackMesh(crowns)
    this.trackMesh(trunks)
    this.trackMesh(poles)
    this.trackMesh(bulbs)
  }

  private buildRoads(): void {
    const data = this.data
    const buf = newBuffers()

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

    for (const lane of data.lanes) {
      const spec = ROAD_SPEC[lane.tier]
      const a: [number, number] = [lane.ax, lane.az]
      const b: [number, number] = [lane.bx, lane.bz]
      const asphaltCol = asphaltColors[lane.tier]
      pushRibbon(buf.asphalt, a, b, spec.asphalt, 0.02, 0, asphaltCol, LANE_STEP)
      if (spec.centerLine === 'double-yellow') pushDoubleYellow(buf.lines, a, b, 0.045, yellowLine)
      else if (spec.centerLine === 'dashed-white') pushDashedWhite(buf.lines, a, b, 0.045, whiteLine)
      if (spec.edgeLines) pushEdgeLines(buf.lines, a, b, spec.asphalt / 2, 0.04, whiteLine)
      if (spec.sidewalk > 0) pushSidewalk(buf.sidewalk, buf.curb, a, b, spec.asphalt / 2, spec.sidewalk, spec.curbHeight, sidewalkColor, curbColor)
    }

    for (const it of this.intersections) {
      pushIntersectionSquare(buf.intersection, it.x, it.z, it.size, 0.04, intersectionColor)
      if (it.tier <= 1) {
        const roadW = ROAD_SPEC[it.tier].asphalt
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'north', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'south', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'east', 0.06, whiteLine)
        pushCrosswalk(buf.crosswalk, it.x, it.z, it.size, roadW, 'west', 0.06, whiteLine)
      }
    }

    const asphaltGeo = this.trackGeo(layerToGeometry(buf.asphalt))
    const sidewalkGeo = this.trackGeo(layerToGeometry(buf.sidewalk))
    const curbGeo = this.trackGeo(layerToGeometry(buf.curb))
    const linesGeo = this.trackGeo(layerToGeometry(buf.lines))
    const intersectionGeo = this.trackGeo(layerToGeometry(buf.intersection))
    const crosswalkGeo = this.trackGeo(layerToGeometry(buf.crosswalk))

    const asphaltMesh = new THREE.Mesh(asphaltGeo, this.asphaltMaterial)
    const sidewalkMesh = new THREE.Mesh(sidewalkGeo, this.sidewalkMaterial)
    const curbMesh = new THREE.Mesh(curbGeo, this.curbMaterial)
    const linesMesh = new THREE.Mesh(linesGeo, this.lineMaterial)
    const intersectionMesh = new THREE.Mesh(intersectionGeo, this.asphaltMaterial)
    const crosswalkMesh = new THREE.Mesh(crosswalkGeo, this.crosswalkMaterial)

    intersectionMesh.renderOrder = 1
    linesMesh.renderOrder = 2
    crosswalkMesh.renderOrder = 3

    this.trackMesh(asphaltMesh)
    this.trackMesh(sidewalkMesh)
    this.trackMesh(curbMesh)
    this.trackMesh(intersectionMesh)
    this.trackMesh(linesMesh)
    this.trackMesh(crosswalkMesh)
  }

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
    this.trackGeo(plazaGeo)

    const plazaMesh = new THREE.Mesh(plazaGeo, this.plazaMaterial)
    this.trackMesh(plazaMesh)

    const fountainGeo = this.trackGeo(new THREE.CylinderGeometry(1.8, 2.1, 0.7, 16))
    const fountains = new THREE.InstancedMesh(fountainGeo, this.fountainMaterial, Math.max(1, data.plazas.length))
    for (const [i, p] of data.plazas.entries()) {
      fountains.setMatrixAt(i, composeMatrix(p.x, surfaceAt(p.x, p.z) + 0.45, p.z, 0, 1, 1, 1))
    }
    fountains.count = data.plazas.length
    this.trackMesh(fountains)
  }

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
        const dir: 1 | -1 = hash2(k, li, 705) < 0.5 ? 1 : -1
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

      car.t = (car.t + (car.speed * dt) / len * car.dir + 1) % 1

      const bx = lane.ax + dx * car.t
      const bz = lane.az + dz * car.t
      const px = -uz, pz = ux
      const x = bx + px * car.lateral
      const z = bz + pz * car.lateral

      const f = car.t * (lane.heights.length - 1)
      const i0 = Math.min(lane.heights.length - 1, Math.floor(f))
      const i1 = Math.min(lane.heights.length - 1, i0 + 1)
      const y = lane.heights[i0] + (lane.heights[i1] - lane.heights[i0]) * (f - i0) + 0.55

      const heading = Math.atan2(dx * car.dir, dz * car.dir)
      const model = this.carGroups[i]
      model.position.set(x, y, z)
      model.rotation.set(0, heading, 0)

      car.wheelSpin += car.speed * dt * 2.2
      for (const child of model.children) {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry instanceof THREE.CylinderGeometry) {
          child.rotation.z = Math.PI / 2 + car.wheelSpin
        }
      }
    }
  }

  private buildPerches(): void {
    const perches = this.perches
    const beamGeo = this.trackGeo(new THREE.CylinderGeometry(1.4, 1.4, 1, 16, 1, true))
    this.perchBeams = new THREE.InstancedMesh(beamGeo, this.beamMaterial, Math.max(1, perches.length))
    const ringGeo = this.trackGeo(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2))
    this.perchRings = new THREE.InstancedMesh(ringGeo, this.perchRingMaterial, Math.max(1, perches.length))
    this.perchBeams.frustumCulled = false
    this.perchRings.frustumCulled = false
    for (const [i, p] of perches.entries()) {
      this.perchBeams.setMatrixAt(i, composeMatrix(p.x, p.y + 15, p.z, 0, 1, 30, 1))
      this.perchRings.setMatrixAt(i, composeMatrix(p.x, p.y + 0.5, p.z, 0, p.radius, 1, p.radius))
      this.setPerchColor(i, false)
    }
    this.perchBeams.count = perches.length
    this.perchRings.count = perches.length
    this.trackMesh(this.perchBeams)
    this.trackMesh(this.perchRings)
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

  update(daylight: number, dt = 0, time = 0): void {
    if (this.disposed) return
    const night = THREE.MathUtils.clamp((1 - daylight) * 1.1, 0, 0.95)
    this.windowMaterial.opacity = night * 0.95
    this.lampMaterial.opacity = THREE.MathUtils.clamp((1 - daylight) * 1.6, 0, 1)
    this.beaconMaterial.opacity = (0.35 + 0.65 * Math.max(0, Math.sin(time * 3))) * 0.95
    this.beamMaterial.opacity = 0.16 + 0.07 * Math.sin(time * 2.2)
    if (dt > 0) this.updateCars(Math.min(dt, 0.1))
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad
  }
}
