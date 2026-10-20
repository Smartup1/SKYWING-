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

// ============================================================================
// Tuning constants (exported so game designers can tweak)
// ============================================================================

export const SEED_CONFIG = {
  /** Distância (m) a partir da qual a seed começa a ser atraída ao jogador. */
  attractRadius: 8,
  /** Tempo (s) da animação de pop após coleta. */
  popTime: 0.28,
  /** Tamanho base do glow (unidades do shader). */
  glowSize: 5,
} as const

export const NEST_CONFIG = {
  pickupRadius: 34,
  glowSize: 9,
} as const

export const SUMMIT_CONFIG = {
  pickupRadius: 22,
  glowSize: 40,
} as const

// ============================================================================
// Shaders
// ============================================================================

const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute vec3 aTint;
uniform float uScale;
uniform float uTime;
uniform vec3 uColor;
varying float vA;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Distância em metros (assumindo câmera em perspectiva; -mv.z > 0)
  float dist = max(-mv.z, 0.1);
  // Pulso único por seed: frequência um pouco diferente para cada uma
  float freq = 2.0 + aSeed * 1.3;
  float pulse = 0.75 + 0.25 * sin(uTime * freq + aSeed * 30.0);
  // Escala com distância: longe → menor, mas com piso para não sumir
  float distScale = uScale / dist;
  float minSize = 2.5;
  gl_PointSize = clamp(aSize * pulse * distScale, minSize, 160.0);
  vA = aSize > 0.0 ? 1.0 : 0.0;
  vTint = aTint;
}
`

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vA;
varying vec3 vTint;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float r = length(pc) * 2.0;
  // Núcleo + halo suave
  float core = pow(max(1.0 - r, 0.0), 3.0);
  float halo = pow(max(1.0 - r, 0.0), 1.2) * 0.35;
  float a = (core + halo) * 0.9 * vA;
  gl_FragColor = vec4(uColor * vTint * 1.05, a);
}
`

// ============================================================================
// Seed placement
// ============================================================================

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
  // Fallback: preencher o resto com um padrão espiral determinístico.
  // Garante spacing mínimo para evitar pickups sobrepostos.
  const MIN_SPACING = 12
  const minSpacingSq = MIN_SPACING * MIN_SPACING
  let attempt = 0
  while (out.length < count && attempt < 4000) {
    attempt += 1
    const angle = hash2(attempt, 1, 390) * Math.PI * 2
    const radius = 300 + hash2(attempt, 2, 390) * 800
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (isUrbanAt(x, z)) continue
    // Evita colocar uma seed em cima de outra
    let conflict = false
    for (const p of out) {
      const dx = p.x - x
      const dz = p.z - z
      if (dx * dx + dz * dz < minSpacingSq) {
        conflict = true
        break
      }
    }
    if (conflict) continue
    out.push(new THREE.Vector3(x, surfaceAt(x, z) + 28 + hash2(attempt, 3, 390) * 30, z))
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
      // Fallback: busca em espiral, pulando áreas urbanas
      for (let attempt = 0; attempt < 400 && !found; attempt += 1) {
        const a = hash2(attempt, s, 313) * Math.PI * 2
        const r = 300 + attempt * 8
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (isUrbanAt(x, z)) continue
        const h = heightAt(x, z)
        if (h < 2) continue
        found = new THREE.Vector3(x, h, z)
      }
      // Último recurso: qualquer lugar não-urbano perto da origem
      if (!found) {
        let fx = 0, fz = 0
        for (let k = 0; k < 20; k += 1) {
          const a = (k / 20) * Math.PI * 2
          const testX = Math.cos(a) * 400
          const testZ = Math.sin(a) * 400
          if (!isUrbanAt(testX, testZ)) {
            fx = testX
            fz = testZ
            break
          }
        }
        found = new THREE.Vector3(fx, Math.max(heightAt(fx, fz), 2), fz)
      }
    }
    sites.push(found!)
  }
  return sites
}

// ============================================================================
// Collectibles
// ============================================================================

// Estados de coleta
const STATE_DEAD = 0
const STATE_ALIVE = 1
const STATE_DYING = 2

// Cores por nest — variedade visual. Multiplicadas por uColor no shader.
const NEST_TINTS: THREE.Color[] = [
  new THREE.Color(1.0, 0.85, 0.55), // dourado
  new THREE.Color(0.85, 1.0, 0.75), // verde-esmeralda
  new THREE.Color(1.0, 0.75, 0.85), // rosa-pérola
  new THREE.Color(0.80, 0.90, 1.0), // azul-gelo
]

const _white = new THREE.Color(1, 1, 1)

export class Collectibles {
  readonly group = new THREE.Group()
  readonly nests: Landmark[] = []
  readonly summit: THREE.Vector3

  private seeds: THREE.Vector3[] = []
  private seedRender: THREE.Vector3[] = []
  private state = new Uint8Array(0)
  private dieT = new Float32Array(0)

  private readonly seedMesh: THREE.InstancedMesh
  private readonly glow: THREE.Points
  private readonly glowMat: THREE.ShaderMaterial
  private readonly glowSize: Float32Array
  private readonly nestGlow: THREE.Points
  private readonly summitGlow: THREE.Points
  private readonly nestFound = new Set<number>()
  private readonly ring: THREE.Mesh
  private readonly beacon: THREE.Mesh
  private _summitFound = false
  private time = 0
  private readonly cap = 140

  // Scratch objects (zero allocations in hot path)
  private readonly _m = new THREE.Matrix4()
  private readonly _q = new THREE.Quaternion()
  private readonly _up = new THREE.Vector3(0, 1, 0)
  private readonly _pos = new THREE.Vector3()
  private readonly _scale = new THREE.Vector3()
  private readonly _scaleOne = new THREE.Vector3(1, 1, 1)
  private readonly _scaleZero = new THREE.Vector3(0, 0, 0)
  private readonly _col = new THREE.Color()

  constructor(forest: Forest, private readonly events: CollectEvents) {
    // ---------------------------------------------------------------------
    // Seed mesh
    // ---------------------------------------------------------------------
    const geo = new THREE.OctahedronGeometry(0.55, 0).scale(0.75, 1.15, 0.75)
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.4, 1.7, 0.45, THREE.LinearSRGBColorSpace),
      toneMapped: true,
    })
    this.seedMesh = new THREE.InstancedMesh(geo, mat, this.cap)
    this.seedMesh.frustumCulled = false
    this.seedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.cap * 3).fill(1), 3,
    )
    this.group.add(this.seedMesh)

    // ---------------------------------------------------------------------
    // Seed glow (billboard points)
    // ---------------------------------------------------------------------
    this.glowSize = new Float32Array(this.cap)
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3))
    gg.setAttribute('aSize', new THREE.BufferAttribute(this.glowSize, 1))
    const seedAttr = new Float32Array(this.cap)
    const seedTint = new Float32Array(this.cap * 3)
    for (let i = 0; i < this.cap; i += 1) {
      seedAttr[i] = hash2(i, 9, 320)
      seedTint[i * 3] = 1
      seedTint[i * 3 + 1] = 1
      seedTint[i * 3 + 2] = 1
    }
    gg.setAttribute('aSeed', new THREE.BufferAttribute(seedAttr, 1))
    gg.setAttribute('aTint', new THREE.BufferAttribute(seedTint, 3))

    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uScale: { value: 700 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1, 0.66, 0.16) },
      },
    })
    this.glow = new THREE.Points(gg, this.glowMat)
    this.glow.frustumCulled = false
    this.glow.renderOrder = 9
    this.group.add(this.glow)

    // ---------------------------------------------------------------------
    // Nests (trees + nest meshes + glow)
    // ---------------------------------------------------------------------
    const sites = nestSites()
    const nestPos = new Float32Array(NEST_COUNT * 3)
    const nestSize = new Float32Array(NEST_COUNT)
    const nestSeed = new Float32Array(NEST_COUNT)
    const nestTint = new Float32Array(NEST_COUNT * 3)
    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i]
      const H = 34
      const tree = new THREE.Mesh(forest.broad.geometry, forest.broad.material)
      tree.position.copy(site).add(this._pos.set(0, -0.4, 0))
      tree.scale.setScalar(H)
      tree.rotation.y = hash2(i, 1, 330) * 6.28
      tree.castShadow = true
      this.group.add(tree)

      const nest = new THREE.Mesh(forest.nest.geometry, forest.nest.material)
      const top = site.clone().add(this._pos.set(0.6, H * 0.94, 0.3))
      nest.position.copy(top)
      nest.scale.setScalar(2.2)
      nest.castShadow = true
      this.group.add(nest)
      this.nests.push({ pos: top, index: i })

      nestPos[i * 3] = top.x
      nestPos[i * 3 + 1] = top.y + 3
      nestPos[i * 3 + 2] = top.z
      nestSize[i] = NEST_CONFIG.glowSize
      nestSeed[i] = hash2(i, 2, 331)

      const tint = NEST_TINTS[i % NEST_TINTS.length]
      nestTint[i * 3] = tint.r
      nestTint[i * 3 + 1] = tint.g
      nestTint[i * 3 + 2] = tint.b
    }
    const ng = new THREE.BufferGeometry()
    ng.setAttribute('position', new THREE.BufferAttribute(nestPos, 3))
    ng.setAttribute('aSize', new THREE.BufferAttribute(nestSize, 1))
    ng.setAttribute('aSeed', new THREE.BufferAttribute(nestSeed, 1))
    ng.setAttribute('aTint', new THREE.BufferAttribute(nestTint, 3))
    this.nestGlow = new THREE.Points(ng, this.glowMat)
    this.nestGlow.frustumCulled = false
    this.nestGlow.renderOrder = 9
    this.group.add(this.nestGlow)

    // ---------------------------------------------------------------------
    // Summit (rock + ring + beacon glow)
    // ---------------------------------------------------------------------
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

    // Far-visible beacon: a tall thin additive cylinder that pulses
    const beaconGeo = new THREE.CylinderGeometry(1.2, 4.5, 140, 12, 1, true)
    const beaconMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(2.4, 1.6, 0.45) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying float vY;
        void main() {
          vY = position.y / 70.0 + 0.5; // 0..1
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uTime;
        varying float vY;
        void main() {
          // Pulso vertical
          float pulse = 0.75 + 0.25 * sin(uTime * 2.2 + vY * 6.0);
          // Fade out no topo e na base
          float fadeTop = smoothstep(1.0, 0.3, vY);
          float fadeBot = smoothstep(0.0, 0.15, vY);
          float a = fadeTop * fadeBot * 0.28 * pulse;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    })
    this.beacon = new THREE.Mesh(beaconGeo, beaconMat)
    this.beacon.position.set(s.x, s.h + 70, s.z)
    this.group.add(this.beacon)

    // Beacon glow point (very large, always visible)
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([this.summit.x, this.summit.y, this.summit.z]), 3))
    sg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([SUMMIT_CONFIG.glowSize]), 1))
    sg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array([0.5]), 1))
    sg.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array([1.5, 1.2, 0.7]), 3))
    this.summitGlow = new THREE.Points(sg, this.glowMat)
    this.summitGlow.frustumCulled = false
    this.summitGlow.renderOrder = 9
    this.group.add(this.summitGlow)
  }

  // ---------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------

  get remaining(): number {
    let n = 0
    for (let i = 0; i < this.seeds.length; i += 1) {
      if (this.state[i] === STATE_ALIVE) n += 1
    }
    return n
  }

  get total(): number {
    return this.seeds.length
  }

  get seedsCollected(): number {
    return this.seeds.length - this.remaining
  }

  get nestsFound(): number {
    return this.nestFound.size
  }

  get summitReached(): boolean {
    return this._summitFound
  }

  // ---------------------------------------------------------------------
  // Reset / restore
  // ---------------------------------------------------------------------

  /** (Re)planta as sementes de um novo voo. */
  resetSeeds(count: number): void {
    const n = Math.min(count, this.cap)
    this.seeds = seedPositions(n)

    // State arrays
    if (this.state.length !== n) {
      this.state = new Uint8Array(n)
      this.dieT = new Float32Array(n)
    } else {
      this.state.fill(STATE_DEAD)
      this.dieT.fill(0)
    }
    if (this.seedRender.length !== n) {
      this.seedRender = []
      for (let i = 0; i < n; i += 1) this.seedRender.push(new THREE.Vector3())
    }

    const pos = this.glow.geometry.attributes.position as THREE.BufferAttribute
    const tint = this.glow.geometry.attributes.aTint as THREE.BufferAttribute
    const colorArr = this.seedMesh.instanceColor!.array as Float32Array

    for (let i = 0; i < n; i += 1) {
      const p = this.seeds[i]
      this.state[i] = STATE_ALIVE
      this.seedRender[i].copy(p)
      pos.setXYZ(i, p.x, p.y, p.z)
      this.glowSize[i] = SEED_CONFIG.glowSize
      tint.setXYZ(i, 1, 1, 1)
      colorArr[i * 3] = 1
      colorArr[i * 3 + 1] = 1
      colorArr[i * 3 + 2] = 1
    }
    for (let i = n; i < this.cap; i += 1) this.glowSize[i] = 0

    pos.needsUpdate = true
    tint.needsUpdate = true
    this.glow.geometry.attributes.aSize.needsUpdate = true
    this.seedMesh.instanceColor!.needsUpdate = true
    this.seedMesh.count = n

    this.refreshMatricesStatic()
    this._summitFound = false
  }

  /** Restaura o estado de "encontrado" (para carregar save). */
  restoreFound(nests: Iterable<number>, summit: boolean): void {
    this.nestFound.clear()
    for (const n of nests) {
      if (n >= 0 && n < NEST_COUNT) this.nestFound.add(n)
    }
    this._summitFound = summit
    this.applyNestVisibility()
  }

  /** Reset completo: sementes + nests + summit. */
  resetAll(count: number): void {
    this.resetSeeds(count)
    this.nestFound.clear()
    this.applyNestVisibility()
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private applyNestVisibility(): void {
    const size = this.nestGlow.geometry.attributes.aSize as THREE.BufferAttribute
    for (let i = 0; i < NEST_COUNT; i += 1) {
      size.setX(i, this.nestFound.has(i) ? 0 : NEST_CONFIG.glowSize)
    }
    size.needsUpdate = true
  }

  /** Atualiza matrizes sem animação (usado após reset). */
  private refreshMatricesStatic(): void {
    const m = this._m
    const q = this._q
    const s1 = this._scaleOne
    for (let i = 0; i < this.seeds.length; i += 1) {
      m.compose(this.seeds[i], q, s1)
      this.seedMesh.setMatrixAt(i, m)
    }
    this.seedMesh.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------

  update(dt: number, viewScale: number, player: THREE.Vector3, daylight: number): void {
    this.time += dt
    this.glowMat.uniforms.uTime.value = this.time
    this.glowMat.uniforms.uScale.value = viewScale
    // Glow fica mais quente/alaranjado à noite
    const nightBoost = 1 - daylight
    this.glowMat.uniforms.uColor.value.setRGB(
      1,
      0.72 + 0.10 * nightBoost,
      0.22 + 0.20 * nightBoost,
    )
    // Beacon pulse
    ;(this.beacon.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time

    // ---- Seeds ----
    const pickupR2 = CONFIG.seeds.pickupRadius ** 2
    const attractR2 = SEED_CONFIG.attractRadius ** 2
    const attractRadius = SEED_CONFIG.attractRadius
    const m = this._m
    const q = this._q
    const up = this._up
    const s1 = this._scaleOne
    const s0 = this._scaleZero
    const scratchPos = this._pos
    const scratchScale = this._scale
    const scratchCol = this._col
    const colorArr = this.seedMesh.instanceColor!.array as Float32Array
    const glowPos = this.glow.geometry.attributes.position as THREE.BufferAttribute
    let colorsChanged = false
    let glowPosChanged = false

    const n = this.seeds.length
    for (let i = 0; i < n; i += 1) {
      const st = this.state[i]

      if (st === STATE_DEAD) {
        // Morto — matriz já está em escala 0, nada a fazer
        continue
      }

      if (st === STATE_DYING) {
        // Animação de coleta: pop + fade
        this.dieT[i] += dt
        const t = this.dieT[i] / SEED_CONFIG.popTime
        if (t >= 1) {
          this.state[i] = STATE_DEAD
          m.compose(scratchPos, q, s0)
          this.seedMesh.setMatrixAt(i, m)
          colorArr[i * 3] = 0
          colorArr[i * 3 + 1] = 0
          colorArr[i * 3 + 2] = 0
          colorsChanged = true
          continue
        }
        // Curva de pop: 1 → ~2.2 → 0
        const peak = Math.sin(t * Math.PI)
        const sc = (1 - t * t) * (1 + peak * 1.2)
        scratchScale.set(sc, sc, sc)
        m.compose(this.seedRender[i], q.identity(), scratchScale)
        this.seedMesh.setMatrixAt(i, m)
        // Fade-out escurecendo
        const fade = 1 - t
        colorArr[i * 3] = fade
        colorArr[i * 3 + 1] = fade
        colorArr[i * 3 + 2] = fade
        colorsChanged = true
        continue
      }

      // STATE_ALIVE
      const base = this.seeds[i]
      const render = this.seedRender[i]
      const baseD2 = base.distanceToSquared(player)

      // Atração magnética: quando perto, a seed flui em direção ao jogador
      if (baseD2 < attractR2) {
        const d = Math.sqrt(baseD2)
        const pull = 1 - d / attractRadius
        const t = Math.min(1, dt * 14 * pull)
        render.lerp(player, t)
      } else {
        // Retorno suave à base
        const t = Math.min(1, dt * 5)
        render.lerp(base, t)
      }

      // Pickup baseado em render (sensação satisfatória de "puxar" a seed)
      const renderD2 = render.distanceToSquared(player)
      if (renderD2 < pickupR2) {
        this.state[i] = STATE_DYING
        this.dieT[i] = 0
        this.glowSize[i] = 0
        this.glow.geometry.attributes.aSize.needsUpdate = true
        this.events.onSeed(render.clone())
        continue
      }

      // Atualizar matriz (bob + rotação)
      const bob = Math.sin(this.time * 1.6 + i) * 0.45
      scratchPos.copy(render)
      scratchPos.y += bob
      q.setFromAxisAngle(up, this.time * 1.8 + i)
      m.compose(scratchPos, q, s1)
      this.seedMesh.setMatrixAt(i, m)

      // Glow segue a render pos (para o pull ser visível)
      glowPos.setXYZ(i, scratchPos.x, scratchPos.y, scratchPos.z)
      glowPosChanged = true
    }

    this.seedMesh.instanceMatrix.needsUpdate = true
    if (colorsChanged) this.seedMesh.instanceColor!.needsUpdate = true
    if (glowPosChanged) glowPos.needsUpdate = true

    // ---- Nests ----
    const nestPickupR2 = NEST_CONFIG.pickupRadius ** 2
    for (const nest of this.nests) {
      if (this.nestFound.has(nest.index)) continue
      if (nest.pos.distanceToSquared(player) < nestPickupR2) {
        this.nestFound.add(nest.index)
        const size = this.nestGlow.geometry.attributes.aSize as THREE.BufferAttribute
        size.setX(nest.index, 0)
        size.needsUpdate = true
        this.events.onNest(nest.index, nest.pos)
      }
    }

    // ---- Summit ----
    if (!this._summitFound && this.summit.distanceToSquared(player) < SUMMIT_CONFIG.pickupRadius ** 2) {
      this._summitFound = true
      this.events.onSummit(this.summit)
    }

    // Ring + beacon animation
    this.ring.rotation.y = this.time * 0.35
    this.ring.rotation.x = Math.PI / 2 + Math.sin(this.time * 0.4) * 0.1
    const found = this._summitFound
    this.ring.visible = !found
    this.beacon.visible = !found
    this.summitGlow.visible = !found
  }

  // ---------------------------------------------------------------------
  // Query API
  // ---------------------------------------------------------------------

  /**
   * Semente viva mais próxima: distância e direção (para a bússola do HUD).
   * Se `outDir` for fornecido, escreve nele sem alocar; senão, aloca um novo.
   */
  nearestSeed(from: THREE.Vector3, outDir?: THREE.Vector3): { dist: number; dir: THREE.Vector3 } | null {
    let best = Infinity
    let idx = -1
    for (let i = 0; i < this.seeds.length; i += 1) {
      if (this.state[i] !== STATE_ALIVE) continue
      const d = this.seeds[i].distanceToSquared(from)
      if (d < best) {
        best = d
        idx = i
      }
    }
    if (idx < 0) return null
    const dir = outDir ?? new THREE.Vector3()
    dir.copy(this.seeds[idx]).sub(from).normalize()
    return { dist: Math.sqrt(best), dir }
  }
}
