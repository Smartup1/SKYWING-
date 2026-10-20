import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Assets } from '../engine/assets'
import arvoreUrl from '../../assets/models/arvore_folhosa.glb?url'
import coniferaUrl from '../../assets/models/conifera.glb?url'
import rochaUrl from '../../assets/models/rocha.glb?url'
import ninhoUrl from '../../assets/models/ninho.glb?url'
import { coniferShare, forestDensity, groundColor, hash2, heightAt, noise2, slopeAt, WATER_LEVEL } from './terrain'
import { isUrbanAt } from './cityLayout'
import type { SkyState } from './daylight'

// ============================================================================
// Global wind — shared by trees, grass and clouds
// ============================================================================

export type WindUniforms = {
  uTime: { value: number }
  /** (dir.x, strength, dir.z) — dir normalizado no plano horizontal, strength 0..1. */
  uWind: { value: THREE.Vector3 }
}

export class WindState {
  /** Direção horizontal (normalizada). */
  readonly direction = new THREE.Vector3(1, 0, 0.35).normalize()
  /** Força base 0..1 (pode ser multiplicada externamente por clima). */
  strength = 0.55
  /** Multiplicador de rajada suave (0.5..1.5). */
  gust = 1

  readonly uniforms: WindUniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(this.direction.x, this.strength, this.direction.z) },
  }

  update(time: number): void {
    this.uniforms.uTime.value = time
    // Rajada lenta por seno + ruído do tempo (não gaussiano) — parece vento real
    this.gust = 0.65
      + 0.25 * Math.sin(time * 0.27)
      + 0.10 * Math.sin(time * 0.71 + 1.4)
    const s = this.strength * this.gust
    this.uniforms.uWind.value.set(this.direction.x * s, s, this.direction.z * s)
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Procedural billboards for far LOD — cheaper than 5000 instanced geometries
// ============================================================================

function makeTreeBillboard(kind: 'broad' | 'conifer' | 'rock'): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, S, S)

  if (kind === 'broad') {
    // Trunk
    ctx.fillStyle = '#3a2414'
    ctx.beginPath()
    ctx.moveTo(S * 0.46, S * 0.98)
    ctx.lineTo(S * 0.485, S * 0.55)
    ctx.lineTo(S * 0.515, S * 0.55)
    ctx.lineTo(S * 0.54, S * 0.98)
    ctx.closePath()
    ctx.fill()
    // Canopy — overlapping blobs with radial gradients
    for (let i = 0; i < 22; i += 1) {
      const ang = i * 2.399 // golden angle
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
    // Trunk
    ctx.fillStyle = '#2a1a0a'
    ctx.fillRect(S * 0.47, S * 0.85, S * 0.06, S * 0.15)
    // Four stacked triangles (like a real conifer)
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
    // Rock — bumpy silhouette with shading
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

// ============================================================================
// Wind shader injection — respects InstancedMesh and existing materials
// ============================================================================

const INJECT_CACHE = new WeakSet<THREE.Material>()

/**
 * Inject a wind animation into the vertex shader.
 * Uses a shared `WindUniforms` so all materials obey the same global wind.
 * `scale` controls how far the top of the tree bends (in local units).
 * `bendExp` shapes the vertical falloff (>1 = only top bends, <1 = whole tree).
 */
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
       // --- wind ---
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

// ============================================================================
// Procedural fallbacks — cached so failures don't re-allocate geometry
// ============================================================================

let _lowBroad: THREE.BufferGeometry | null = null
let _lowConifer: THREE.BufferGeometry | null = null
let _lowRock: THREE.BufferGeometry | null = null

function lowPolyBroad(): THREE.BufferGeometry {
  if (_lowBroad) return _lowBroad
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(flat(new THREE.CylinderGeometry(0.025, 0.04, 0.42, 6).translate(0, 0.21, 0)), () => new THREE.Color(0x4a3524)))
  // 3 leaf-cluster variants spread across cells for visual variety
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

// ============================================================================
// GLB loader with proper fallback
// ============================================================================

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
    // Clone so we can inject wind per-mesh without bleeding into other users
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

// ============================================================================
// Cells
// ============================================================================

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
  // Isolated tree in open field
  if (fd < 0.3 && slope < 0.45 && h < 100 && hash2(ix, iz, 8) < 0.02) {
    return { t: 1, x: px, y: h - 0.3, z: pz, s: 13 + hash2(ix, iz, 6) * 8, r: rot, tilt: 0 }
  }
  // Rock: slopes, altitudes and shorelines
  const rockChance = slope > 0.4 ? 0.1 : h > 110 ? 0.07 : h < 4 ? 0.025 : 0.004
  if (hash2(ix, iz, 9) < rockChance) {
    const big = h > 90 || slope > 0.6 ? 1.8 : 1
    return { t: 3, x: px, y: h - 0.2, z: pz, s: (1.8 + hash2(ix, iz, 10) * 5) * big, r: rot, tilt: 0 }
  }
  return null
}

// ============================================================================
// Placement
// ============================================================================

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
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

// ============================================================================
// Season tint — multiplies instanceColor via material.color
// ============================================================================

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

const SEASON_TINT: Record<Season, THREE.Color> = {
  spring: new THREE.Color(1.05, 1.08, 0.92),
  summer: new THREE.Color(1.00, 1.00, 1.00),
  autumn: new THREE.Color(1.30, 0.92, 0.55),
  winter: new THREE.Color(0.82, 0.86, 0.94),
}

// ============================================================================
// Forest
// ============================================================================

export class Forest {
  readonly group = new THREE.Group()
  broad!: Prop
  conifer!: Prop
  rock!: Prop
  nest!: Prop

  readonly wind = new WindState()
  season: Season = 'summer'

  // Near (GLB or fallback geometry) — cast shadows
  private nearBroad!: THREE.InstancedMesh
  private nearConifer!: THREE.InstancedMesh
  private nearRock!: THREE.InstancedMesh
  // Mid (lowpoly geometry, no shadow) — medium distance
  private midBroad!: THREE.InstancedMesh
  private midConifer!: THREE.InstancedMesh
  private midRock!: THREE.InstancedMesh
  // Far (billboard cross-quad) — up to farRadius
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

    // --- Wind injection (near + mid) ---
    // Tree tops sway more than trunks (bendExp > 1)
    injectWind(this.broad.material, this.wind.uniforms, 0.14, 1.8)
    injectWind(this.conifer.material, this.wind.uniforms, 0.10, 2.0)
    injectWind(this.rock.material, this.wind.uniforms, 0.0, 1.0) // rocks: no wind

    onProgress(0.4)

    // Near: nearCap per kind, shadows on
    const mkNear = (p: Prop, cap: number) => this.mkInst(p, cap, true, true)
    // Mid: same materials, no shadow, cap larger
    const mkMid = (p: Prop, cap: number) => {
      const mat = (p.material as THREE.MeshStandardMaterial).clone()
      injectWind(mat, this.wind.uniforms, 0.10, 1.9)
      const m = new THREE.InstancedMesh(p.geometry, mat, cap)
      m.castShadow = false
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
      return m
    }
    // Far: billboard
    const mkFar = (kind: 'broad' | 'conifer' | 'rock', cap: number) => {
      const mat = new THREE.MeshLambertMaterial({
        map: makeTreeBillboard(kind),
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        color: 0xffffff,
        fog: true,
      })
      const geo = billboardGeometry(kind === 'conifer' ? 1.4 : 2.2, kind === 'rock' ? 0.9 : 1.9, 3)
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

    // Pre-warm cell cache in slices
    const R = Math.ceil(this.farRadius / CELL)
    for (let iz = -R; iz <= R; iz += 1) {
      for (let ix = -R; ix <= R; ix += 1) this.cell(ix, iz)
      if (iz % 8 === 0) {
        onProgress(0.4 + 0.6 * ((iz + R) / (2 * R)))
        await new Promise(r => setTimeout(r, 0))
      }
    }
    this.grass = new GrassField(this.wind)
    this.group.add(this.grass.group)
  }

  private mkInst(p: Prop, cap: number, shadow: boolean, receive: boolean): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(p.geometry, p.material, cap)
    m.castShadow = shadow
    m.receiveShadow = receive
    m.frustumCulled = false
    m.count = 0
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(m)
    return m
  }

  private cell(ix: number, iz: number): Cell | null {
    const k = key(ix, iz)
    let c = this.cells.get(k)
    if (c === undefined) {
      c = evalCell(ix, iz)
      this.cells.set(k, c)
    }
    return c
  }

  /** Evict cells far from camera when the map grows too large. */
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

  /** Reposiciona as instâncias ao redor da câmera. */
  update(camX: number, camZ: number, camAgl: number, dt: number, sky: SkyState, time: number, density: number): void {
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
    // Grass picks it up in its own update loop
  }

  private rebuild(camX: number, camZ: number, density: number): void {
    const R = Math.ceil(this.farRadius / CELL)
    const cx = Math.floor(camX / CELL)
    const cz = Math.floor(camZ / CELL)

    // Counters
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
          // Rocks: near → near geom, mid → mid geom, far → billboard
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

  constructor(wind: WindState) {
    // Tufts — Lambert with wind injection
    const mat = new THREE.MeshLambertMaterial({
      map: grassTexture(),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
    })
    injectWind(mat, wind.uniforms, 0.22, 1.55)

    // Two-pass grass: main mesh + backface pass for density
    this.tufts = new THREE.InstancedMesh(crossQuads(0.9, 0.62, 3), mat, this.capT)

    const fmat = new THREE.MeshLambertMaterial({
      map: flowerTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    })
    injectWind(fmat, wind.uniforms, 0.10, 1.6)
    this.flowers = new THREE.InstancedMesh(crossQuads(0.5, 0.5, 2), fmat, this.capF)

    for (const m of [this.tufts, this.flowers]) {
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
    }
    // Grass receives shadows — tree shadows fall on grass correctly
    this.tufts.receiveShadow = true
    this.flowers.receiveShadow = true
    // Manual instanceColor allocation for perf (avoids three.js realloc on first setColorAt)
    this.tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capT * 3), 3)
    this.flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capF * 3), 3)
  }

  setSeason(s: Season): void {
    // Applied to material.color so instanceColor × material.color = final
    // Slight warm shift in autumn, cool in winter
    const t = SEASON_TINT[s]
    ;(this.tufts.material as THREE.MeshLambertMaterial).color.copy(t)
    ;(this.flowers.material as THREE.MeshLambertMaterial).color.copy(t)
  }

  update(camX: number, camZ: number, agl: number, dt: number, sky: SkyState, time: number, density: number): void {
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
    // Sky-driven grass tint — subtle atmospheric shift at dusk/dawn
    const lam = this.tufts.material as THREE.MeshLambertMaterial
    // Blend sun tint into grass (slight) — sun color is a hint about time-of-day
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
        if (counter % 900 === 0) yield
        const x = (gx + hash2(gx, gz, 61)) * GRASS_STEP
        const z = (gz + hash2(gx, gz, 62)) * GRASS_STEP
        if (isUrbanAt(x, z)) continue
        const dx = x - camX
        const dz = z - camZ
        const d = Math.hypot(dx, dz)
        if (d > GRASS_RADIUS) continue
        // Distance fade — dissolve without pop
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
        // Flower patches
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
  }
}
