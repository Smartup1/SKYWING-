import * as THREE from 'three'
import { CONFIG } from './config'
import type { Forest } from './forest'
import { NEST_COUNT } from './rules'
import { isUrbanAt } from './cityLayout'
import { findSummit, forestDensity, hash2, heightAt, LAKE, slopeAt, surfaceAt } from './terrain'

export type Landmark = { pos: THREE.Vector3; index: number }

export type CollectEvents = {
  onSeed(pos: THREE.Vector3): void
  onNest(index: number, pos: THREE.Vector3): void
  onSummit(pos: THREE.Vector3): void
}

const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uScale;
uniform float uTime;
uniform vec3 uColor;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + aSeed * 30.0);
  gl_PointSize = clamp(aSize * pulse * uScale / max(-mv.z, 0.1), 0.0, 160.0);
  vA = aSize > 0.0 ? 1.0 : 0.0;
}
`
const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.2);
  gl_FragColor = vec4(uColor * 1.05, a * 0.85 * vA);
}
`

/** Posições determinísticas das sementes: trilhas curvas com altitudes variadas e rasantes no lago. */
export function seedPositions(count: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const trails = Math.max(1, Math.ceil(count / 6))
  for (let t = 0; t < trails && out.length < count; t += 1) {
    const a0 = hash2(t, 1, 301) * Math.PI * 2
    const r0 = 80 + Math.sqrt(hash2(t, 2, 301)) * 1000
    let x = Math.cos(a0) * r0
    let z = Math.sin(a0) * r0
    if (t === 0) {
      x = LAKE.x + 120
      z = LAKE.z - 200
    }
    let heading = hash2(t, 3, 301) * Math.PI * 2
    const turn = (hash2(t, 4, 301) - 0.5) * 0.14
    const base = 18 + hash2(t, 5, 301) * 55
    for (let i = 0; i < 6 && out.length < count; i += 1) {
      heading += turn + (hash2(t, i, 302) - 0.5) * 0.08
      x += Math.cos(heading) * 30
      z += Math.sin(heading) * 30
      if (isUrbanAt(x, z)) continue
      const overLake = (((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2) < 0.8
      const agl = overLake && t % 3 === 0 ? 3.2 : base + Math.sin(i * 0.9 + t) * 14
      out.push(new THREE.Vector3(x, surfaceAt(x, z) + agl, z))
    }
  }
  for (let k = 0; out.length < count && k < 600; k += 1) {
    const angle = hash2(k, 1, 390) * Math.PI * 2
    const radius = 300 + hash2(k, 2, 390) * 800
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (isUrbanAt(x, z)) continue
    out.push(new THREE.Vector3(x, surfaceAt(x, z) + 28 + hash2(k, 3, 390) * 30, z))
  }
  return out
}

/** Locais das árvores-ninho: uma por setor, em floresta densa e declive suave. */
export function nestSites(): THREE.Vector3[] {
  const sites: THREE.Vector3[] = []
  for (let s = 0; s < NEST_COUNT; s += 1) {
    let found: THREE.Vector3 | null = null
    for (let k = 0; k < 120 && !found; k += 1) {
      const a = ((s + hash2(s, k, 311) * 0.8) / NEST_COUNT) * Math.PI * 2
      const r = 380 + hash2(s, k + 500, 312) * 760
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (isUrbanAt(x, z)) continue
      const h = heightAt(x, z)
      if (h < 8 || h > 95) continue
      const sl = slopeAt(x, z, 3)
      if (sl > 0.3 || forestDensity(x, z, h, sl) < 0.5) continue
      found = new THREE.Vector3(x, h, z)
    }
    if (!found) {
      const x = Math.cos(s) * 600
      const z = Math.sin(s) * 600
      let fx = x
      let fz = z
      for (let k = 0; k < 10 && isUrbanAt(fx, fz); k += 1) {
        fx += Math.cos(s + k) * 120
        fz += Math.sin(s + k) * 120
      }
      found = new THREE.Vector3(fx, Math.max(heightAt(fx, fz), 2), fz)
    }
    sites.push(found)
  }
  return sites
}

export class Collectibles {
  readonly group = new THREE.Group()
  readonly nests: Landmark[] = []
  readonly summit: THREE.Vector3
  private seeds: THREE.Vector3[] = []
  private alive: boolean[] = []
  private readonly seedMesh: THREE.InstancedMesh
  private readonly glow: THREE.Points
  private readonly glowMat: THREE.ShaderMaterial
  private readonly glowSize: Float32Array
  private readonly nestGlow: THREE.Points
  private readonly nestFound = new Set<number>()
  private readonly ring: THREE.Mesh
  private summitFound = false
  private time = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly cap = 140

  constructor(forest: Forest, private readonly events: CollectEvents) {
    // Sementes: losango dourado que gira, mais halo aditivo visível de longe.
    const geo = new THREE.OctahedronGeometry(0.55, 0).scale(0.75, 1.15, 0.75)
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 1.7, 0.45, THREE.LinearSRGBColorSpace), toneMapped: true })
    this.seedMesh = new THREE.InstancedMesh(geo, mat, this.cap)
    this.seedMesh.frustumCulled = false
    this.group.add(this.seedMesh)
    this.glowSize = new Float32Array(this.cap)
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3))
    gg.setAttribute('aSize', new THREE.BufferAttribute(this.glowSize, 1))
    const seedAttr = new Float32Array(this.cap)
    for (let i = 0; i < this.cap; i += 1) seedAttr[i] = hash2(i, 9, 320)
    gg.setAttribute('aSeed', new THREE.BufferAttribute(seedAttr, 1))
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 700 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 0.66, 0.16) } },
    })
    this.glow = new THREE.Points(gg, this.glowMat)
    this.glow.frustumCulled = false
    this.glow.renderOrder = 9
    this.group.add(this.glow)

    // Árvores-ninho.
    const sites = nestSites()
    const nestPos = new Float32Array(NEST_COUNT * 3)
    const nestSize = new Float32Array(NEST_COUNT)
    const nestSeed = new Float32Array(NEST_COUNT)
    for (const [i, site] of sites.entries()) {
      const H = 34
      const tree = new THREE.Mesh(forest.broad.geometry, forest.broad.material)
      tree.position.copy(site).add(new THREE.Vector3(0, -0.4, 0))
      tree.scale.set(H, H, H)
      tree.rotation.y = hash2(i, 1, 330) * 6.28
      tree.castShadow = true
      this.group.add(tree)
      const nest = new THREE.Mesh(forest.nest.geometry, forest.nest.material)
      const top = site.clone().add(new THREE.Vector3(0.6, H * 0.94, 0.3))
      nest.position.copy(top)
      nest.scale.setScalar(2.2)
      nest.castShadow = true
      this.group.add(nest)
      this.nests.push({ pos: top, index: i })
      nestPos.set([top.x, top.y + 3, top.z], i * 3)
      nestSize[i] = 9
      nestSeed[i] = hash2(i, 2, 331)
    }
    const ng = new THREE.BufferGeometry()
    ng.setAttribute('position', new THREE.BufferAttribute(nestPos, 3))
    ng.setAttribute('aSize', new THREE.BufferAttribute(nestSize, 1))
    ng.setAttribute('aSeed', new THREE.BufferAttribute(nestSeed, 1))
    this.nestGlow = new THREE.Points(ng, this.glowMat)
    this.nestGlow.frustumCulled = false
    this.nestGlow.renderOrder = 9
    this.group.add(this.nestGlow)

    // Pico: rocha monumental e anel dourado para atravessar.
    const s = findSummit()
    this.summit = new THREE.Vector3(s.x, s.h, s.z)
    const rock = new THREE.Mesh(forest.rock.geometry, forest.rock.material)
    rock.position.set(s.x, s.h - 2, s.z)
    rock.scale.setScalar(16)
    rock.castShadow = true
    this.group.add(rock)
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(15, 0.8, 10, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.2, 1.6, 0.5, THREE.LinearSRGBColorSpace) }),
    )
    this.summit.y = s.h + 34
    this.ring.position.copy(this.summit)
    this.group.add(this.ring)
  }

  get remaining(): number {
    return this.alive.filter(Boolean).length
  }

  get total(): number {
    return this.seeds.length
  }

  /** (Re)planta as sementes de um novo voo. */
  resetSeeds(count: number): void {
    this.seeds = seedPositions(Math.min(count, this.cap))
    this.alive = this.seeds.map(() => true)
    const pos = this.glow.geometry.attributes.position as THREE.BufferAttribute
    for (const [i, p] of this.seeds.entries()) {
      pos.setXYZ(i, p.x, p.y, p.z)
      this.glowSize[i] = 5
    }
    for (let i = this.seeds.length; i < this.cap; i += 1) this.glowSize[i] = 0
    pos.needsUpdate = true
    this.glow.geometry.attributes.aSize.needsUpdate = true
    this.seedMesh.count = this.seeds.length
    this.refreshMatrices()
    this.summitFound = false
  }

  restoreFound(nests: Iterable<number>, summit: boolean): void {
    this.nestFound.clear()
    for (const n of nests) this.nestFound.add(n)
    this.summitFound = summit
    const size = this.nestGlow.geometry.attributes.aSize as THREE.BufferAttribute
    for (let i = 0; i < NEST_COUNT; i += 1) size.setX(i, this.nestFound.has(i) ? 0 : 9)
    size.needsUpdate = true
  }

  private refreshMatrices(): void {
    const t = this.time
    for (const [i, p] of this.seeds.entries()) {
      if (!this.alive[i]) {
        this.m.makeScale(0, 0, 0)
      } else {
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 1.8 + i)
        this.m.compose(new THREE.Vector3(p.x, p.y + Math.sin(t * 1.6 + i) * 0.45, p.z), this.q, new THREE.Vector3(1, 1, 1))
      }
      this.seedMesh.setMatrixAt(i, this.m)
    }
    this.seedMesh.instanceMatrix.needsUpdate = true
  }

  update(dt: number, viewScale: number, player: THREE.Vector3, daylight: number): void {
    this.time += dt
    this.glowMat.uniforms.uTime.value = this.time
    this.glowMat.uniforms.uScale.value = viewScale
    this.glowMat.uniforms.uColor.value.setRGB(1, 0.75 + 0.1 * (1 - daylight), 0.25 + 0.2 * (1 - daylight))
    this.refreshMatrices()
    const r2 = CONFIG.seeds.pickupRadius ** 2
    for (const [i, p] of this.seeds.entries()) {
      if (!this.alive[i]) continue
      if (p.distanceToSquared(player) < r2) {
        this.alive[i] = false
        this.glowSize[i] = 0
        this.glow.geometry.attributes.aSize.needsUpdate = true
        this.events.onSeed(p)
      }
    }
    for (const n of this.nests) {
      if (this.nestFound.has(n.index)) continue
      if (n.pos.distanceToSquared(player) < 34 * 34) {
        this.nestFound.add(n.index)
        const size = this.nestGlow.geometry.attributes.aSize as THREE.BufferAttribute
        size.setX(n.index, 0)
        size.needsUpdate = true
        this.events.onNest(n.index, n.pos)
      }
    }
    if (!this.summitFound && this.summit.distanceToSquared(player) < 22 * 22) {
      this.summitFound = true
      this.events.onSummit(this.summit)
    }
    this.ring.rotation.y = this.time * 0.3
    this.ring.rotation.x = Math.PI / 2 + Math.sin(this.time * 0.4) * 0.1
    this.ring.visible = !this.summitFound
  }

  /** Semente viva mais próxima: distância e direção (para a bússola do HUD). */
  nearestSeed(from: THREE.Vector3): { dist: number; dir: THREE.Vector3 } | null {
    let best = Infinity
    let idx = -1
    for (const [i, p] of this.seeds.entries()) {
      if (!this.alive[i]) continue
      const d = p.distanceToSquared(from)
      if (d < best) {
        best = d
        idx = i
      }
    }
    if (idx < 0) return null
    return { dist: Math.sqrt(best), dir: this.seeds[idx].clone().sub(from).normalize() }
  }
}
