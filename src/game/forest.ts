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

const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g)

export type Prop = { geometry: THREE.BufferGeometry; material: THREE.Material }

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
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    mat.metalness = 0
    mat.roughness = Math.max(mat.roughness, 0.85)
    mat.side = THREE.FrontSide
    return { geometry: g, material: mat }
  } catch (err) {
    console.warn('Modelo não carregou, usando versão simples:', url, err)
    return fallback()
  }
}

const tint = (hex: number, jitter: number, seed: number) => {
  const c = new THREE.Color(hex)
  const k = 1 + (hash2(seed, 3, 3) - 0.5) * jitter
  return c.multiplyScalar(k)
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

function lowPolyBroad(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.025, 0.04, 0.42, 6).translate(0, 0.21, 0)
  parts.push(paint(flat(trunk), () => new THREE.Color(0x4a3524)))
  const blobs = [[0, 0.62, 0, 0.34], [0.2, 0.52, 0.08, 0.24], [-0.18, 0.56, -0.1, 0.26], [0.04, 0.82, -0.06, 0.22], [-0.04, 0.5, 0.2, 0.22]]
  for (const [i, [x, y, z, r]] of blobs.entries()) {
    const b = new THREE.IcosahedronGeometry(r, 1).scale(1, 0.82, 1).translate(x, y, z)
    parts.push(paint(flat(b), (py, vi) => tint(0x3d6b2a, 0.5, vi + i * 7).lerp(new THREE.Color(0x6a8f3a), Math.max(0, (py - y) / r) * 0.5)))
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

function lowPolyConifer(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  parts.push(paint(flat(new THREE.CylinderGeometry(0.02, 0.035, 0.2, 6).translate(0, 0.1, 0)), () => new THREE.Color(0x4a3524)))
  const tiers = [[0.2, 0.3, 0.3], [0.4, 0.24, 0.3], [0.6, 0.18, 0.26], [0.78, 0.12, 0.22]]
  for (const [i, [y, r, h]] of tiers.entries()) {
    const c = new THREE.ConeGeometry(r, h, 9).translate(0, y + h / 2, 0)
    parts.push(paint(flat(c), (py, vi) => tint(0x24462d, 0.45, vi + i * 5).lerp(new THREE.Color(0x3c6b3d), Math.max(0, (py - y) / h) * 0.3)))
  }
  const g = mergeGeometries(parts)!
  g.computeVertexNormals()
  return g
}

function lowPolyRock(): THREE.BufferGeometry {
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
  return ng
}

type Cell = { t: 1 | 2 | 3; x: number; y: number; z: number; s: number; r: number; tilt: number }

const CELL = 14
const key = (ix: number, iz: number) => (ix + 600) * 2048 + (iz + 600)

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
  // Árvores isoladas em campo aberto.
  if (fd < 0.3 && slope < 0.45 && h < 100 && hash2(ix, iz, 8) < 0.02) {
    return { t: 1, x: px, y: h - 0.3, z: pz, s: 13 + hash2(ix, iz, 6) * 8, r: rot, tilt: 0 }
  }
  // Rochas: encostas, altitudes e margens.
  const rockChance = slope > 0.4 ? 0.1 : h > 110 ? 0.07 : h < 4 ? 0.025 : 0.004
  if (hash2(ix, iz, 9) < rockChance) {
    const big = h > 90 || slope > 0.6 ? 1.8 : 1
    return { t: 3, x: px, y: h - 0.2, z: pz, s: (1.8 + hash2(ix, iz, 10) * 5) * big, r: rot, tilt: 0 }
  }
  return null
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

function place(mesh: THREE.InstancedMesh, i: number, c: Cell, widthScale: number, shade: number): void {
  _e.set(c.tilt, c.r, 0, 'YXZ')
  _q.setFromEuler(_e)
  _p.set(c.x, c.y, c.z)
  _s.set(c.s * widthScale, c.s, c.s * widthScale)
  _m.compose(_p, _q, _s)
  mesh.setMatrixAt(i, _m)
  _c.setScalar(shade)
  mesh.setColorAt(i, _c)
}

export class Forest {
  readonly group = new THREE.Group()
  broad!: Prop
  conifer!: Prop
  rock!: Prop
  nest!: Prop
  private nearBroad!: THREE.InstancedMesh
  private nearConifer!: THREE.InstancedMesh
  private nearRock!: THREE.InstancedMesh
  private farBroad!: THREE.InstancedMesh
  private farConifer!: THREE.InstancedMesh
  private farRock!: THREE.InstancedMesh
  private readonly cells = new Map<number, Cell | null>()
  private lastX = Infinity
  private lastZ = Infinity
  nearTreeRadius = 90
  farRadius = 950
  private nearCap = 70
  private grass?: GrassField

  async load(assets: Assets, onProgress: (p: number) => void): Promise<void> {
    const mk = (g: () => THREE.BufferGeometry, color: number): (() => Prop) => () => ({ geometry: g(), material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, color }) })
    const lowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
    ;[this.broad, this.conifer, this.rock, this.nest] = await Promise.all([
      loadProp(assets, arvoreUrl, mk(lowPolyBroad, 0xffffff)),
      loadProp(assets, coniferaUrl, mk(lowPolyConifer, 0xffffff)),
      loadProp(assets, rochaUrl, mk(lowPolyRock, 0xffffff)),
      loadProp(assets, ninhoUrl, () => ({ geometry: new THREE.TorusGeometry(0.4, 0.15, 8, 16).rotateX(Math.PI / 2), material: new THREE.MeshStandardMaterial({ color: 0x8a6a3a }) })),
    ])
    onProgress(0.4)
    const mkInst = (p: Prop, cap: number, shadow: boolean) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, cap)
      m.castShadow = shadow
      m.receiveShadow = false
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
      return m
    }
    this.nearBroad = mkInst(this.broad, this.nearCap, true)
    this.nearConifer = mkInst(this.conifer, this.nearCap, true)
    this.nearRock = mkInst(this.rock, 60, true)
    this.farBroad = mkInst({ geometry: lowPolyBroad(), material: lowMat }, 5000, false)
    this.farConifer = mkInst({ geometry: lowPolyConifer(), material: lowMat }, 5000, false)
    this.farRock = mkInst({ geometry: lowPolyRock(), material: lowMat }, 1500, false)
    // Pré-aquece o cache de células ao redor do ponto inicial, em fatias.
    const R = Math.ceil(this.farRadius / CELL)
    for (let iz = -R; iz <= R; iz += 1) {
      for (let ix = -R; ix <= R; ix += 1) this.cell(ix, iz)
      if (iz % 8 === 0) {
        onProgress(0.4 + 0.6 * ((iz + R) / (2 * R)))
        await new Promise(r => setTimeout(r, 0))
      }
    }
    this.grass = new GrassField()
    this.group.add(this.grass.group)
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

  /** Reposiciona as instâncias ao redor da câmera. */
  update(camX: number, camZ: number, camAgl: number, dt: number, sky: SkyState, time: number, density: number): void {
    if (Math.hypot(camX - this.lastX, camZ - this.lastZ) > 22) {
      this.lastX = camX
      this.lastZ = camZ
      this.rebuild(camX, camZ, density)
    }
    this.grass?.update(camX, camZ, camAgl, dt, sky, time, density)
  }

  forceRebuild(camX: number, camZ: number, density: number): void {
    this.lastX = camX
    this.lastZ = camZ
    this.rebuild(camX, camZ, density)
  }

  private rebuild(camX: number, camZ: number, density: number): void {
    const R = Math.ceil(this.farRadius / CELL)
    const cx = Math.floor(camX / CELL)
    const cz = Math.floor(camZ / CELL)
    let nb = 0
    let nc = 0
    let nr = 0
    let fb = 0
    let fc = 0
    let fr = 0
    const nearR2 = this.nearTreeRadius * this.nearTreeRadius
    const nearRockR2 = 150 * 150
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
          else if (fr < 1500) place(this.farRock, fr++, c, 1, 0.9 + hash2(ix, iz, 20) * 0.2)
        } else if (c.t === 1) {
          if (d2 < nearR2 && nb < this.nearCap) place(this.nearBroad, nb++, c, 1, 1)
          else if (fb < 5000) place(this.farBroad, fb++, c, 1, 0.85 + hash2(ix, iz, 21) * 0.3)
        } else if (d2 < nearR2 && nc < this.nearCap) place(this.nearConifer, nc++, c, 1, 1)
        else if (fc < 5000) place(this.farConifer, fc++, c, 1, 0.85 + hash2(ix, iz, 22) * 0.3)
      }
    }
    const set = (m: THREE.InstancedMesh, n: number) => {
      m.count = n
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    set(this.nearBroad, nb)
    set(this.nearConifer, nc)
    set(this.nearRock, nr)
    set(this.farBroad, fb)
    set(this.farConifer, fc)
    set(this.farRock, fr)
  }

  setShadows(on: boolean): void {
    for (const m of [this.nearBroad, this.nearConifer, this.nearRock]) m.castShadow = on
  }
}

// --- Capim e flores --------------------------------------------------------------------------

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  for (let i = 0; i < 26; i += 1) {
    const x = 6 + hash2(i, 1, 40) * 116
    const lean = (hash2(i, 2, 40) - 0.5) * 40
    const h = 55 + hash2(i, 3, 40) * 70
    const grad = g.createLinearGradient(0, 128, 0, 128 - h)
    grad.addColorStop(0, 'rgb(70,90,40)')
    grad.addColorStop(1, `rgb(${180 + hash2(i, 4, 40) * 50},${215 + hash2(i, 5, 40) * 30},110)`)
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
  const g = mergeGeometries(parts)!
  return g
}

const GRASS_RADIUS = 52
const GRASS_STEP = 1.15
const FLOWER_COLORS = [0xffffff, 0xffe45c, 0xff6fa4, 0x9a7bff, 0xff7a3d, 0xf5f0a0]

class GrassField {
  readonly group = new THREE.Group()
  private readonly tufts: THREE.InstancedMesh
  private readonly flowers: THREE.InstancedMesh
  private readonly timeU = { value: 0 }
  private readonly lightU = { value: new THREE.Color(1, 1, 1) }
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

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide })
    const timeU = this.timeU
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = timeU
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
         float sway = sin(uTime * 1.8 + iw.x * 0.35 + iw.z * 0.27) * 0.5 + sin(uTime * 3.1 + iw.x * 0.9) * 0.25;
         transformed.x += sway * 0.22 * pow(position.y / 0.55, 1.6);
         transformed.z += sway * 0.12 * pow(position.y / 0.55, 1.6);`,
      )
    }
    this.tufts = new THREE.InstancedMesh(crossQuads(0.9, 0.62, 3), mat, this.capT)
    const fmat = new THREE.MeshLambertMaterial({ map: flowerTexture(), alphaTest: 0.5, side: THREE.DoubleSide })
    fmat.onBeforeCompile = mat.onBeforeCompile
    this.flowers = new THREE.InstancedMesh(crossQuads(0.5, 0.5, 2), fmat, this.capF)
    for (const m of [this.tufts, this.flowers]) {
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
    }
    this.tufts.receiveShadow = false
    // Cor por instância.
    this.tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capT * 3), 3)
    this.flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capF * 3), 3)
  }

  update(camX: number, camZ: number, agl: number, dt: number, sky: SkyState, time: number, density: number): void {
    this.timeU.value = time
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
      // Fatias para não travar o quadro.
      for (let i = 0; i < 6; i += 1) {
        const r = this.job.next()
        if (r.done) {
          this.job = null
          this.commit()
          break
        }
      }
    }
    // Iluminação do capim acompanha o dia.
    const l = 0.35 + 0.65 * sky.daylight
    this.lightU.value.setScalar(l)
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
        // Densidade cai com a distância (dissolve sem "pop").
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
        // Flores em manchas.
        const patch = noise2(x * 0.045 + 5, z * 0.045, 12)
        if (patch > 0.25 && nF < this.capF && hash2(gx, gz, 69) < 0.5 && h > 1.5) {
          const fc = FLOWER_COLORS[Math.floor(hash2(Math.floor(x / 9), Math.floor(z / 9), 70) * FLOWER_COLORS.length)]
          _c.setHex(fc)
          p.set(x + 0.3, h - 0.02, z - 0.2)
          const fs = 0.55 + hash2(gx, gz, 71) * 0.5
          s.set(fs, fs, fs)
          m.compose(p, q, s)
          m.toArray(this.bufF, nF * 16)
          this.colF[nF * 3] = _c.r
          this.colF[nF * 3 + 1] = _c.g
          this.colF[nF * 3 + 2] = _c.b
          nF += 1
        }
      }
    }
    this.nT = nT
    this.nF = nF
    void WATER_LEVEL
  }
}
