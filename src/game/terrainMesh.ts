import * as THREE from 'three'
import { CONFIG } from './config'
import { forestDensity, groundColor, heightAt, WATER_LEVEL } from './terrain'
import type { SkyState } from './daylight'

const CHUNK = 128
const LOD_RES = [64, 32, 16, 8]
const LOD_DIST = [360, 780, 1500]

function detailTexture(): THREE.CanvasTexture {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  // Ruído tileável (valor + folhagem fina) para quebrar a cor chapada do solo.
  const grid = (n: number, seed: number) => {
    const a = new Float32Array(n * n)
    let s = seed
    for (let i = 0; i < a.length; i += 1) {
      s = (s * 1664525 + 1013904223) >>> 0
      a[i] = s / 4294967296
    }
    return a
  }
  const layers = [
    { n: 8, a: grid(8, 3), w: 0.4 },
    { n: 32, a: grid(32, 9), w: 0.3 },
    { n: 128, a: grid(128, 21), w: 0.3 },
  ]
  const sample = (l: { n: number; a: Float32Array }, u: number, v: number) => {
    const x = u * l.n
    const y = v * l.n
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const at = (i: number, j: number) => l.a[(((j % l.n) + l.n) % l.n) * l.n + (((i % l.n) + l.n) % l.n)]
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0
      for (const l of layers) v += sample(l, x / size, y / size) * l.w
      const k = Math.round(255 * (0.62 + 0.38 * v))
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

type Chunk = { ix: number; iz: number; cx: number; cz: number; lod: number; mesh: THREE.Mesh }

export class TerrainManager {
  readonly group = new THREE.Group()
  readonly material: THREE.MeshStandardMaterial
  private readonly chunks: Chunk[] = []
  private readonly half = CONFIG.world.size / 2
  private readonly n = CONFIG.world.size / CHUNK

  constructor() {
    const tex = detailTexture()
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.96, metalness: 0 })
    this.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec3 t1 = texture2D(map, vMapUv).rgb;
         vec3 t2 = texture2D(map, vMapUv * 0.137 + vec2(0.37, 0.61)).rgb;
         vec3 t3 = texture2D(map, vMapUv * 3.7).rgb;
         diffuseColor.rgb *= t1 * t2 * (0.6 + 0.8 * t3) * 3.1;`,
      )
    }
    for (let iz = 0; iz < this.n; iz += 1) {
      for (let ix = 0; ix < this.n; ix += 1) {
        const cx = -this.half + (ix + 0.5) * CHUNK
        const cz = -this.half + (iz + 0.5) * CHUNK
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
        mesh.receiveShadow = true
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = true
        this.group.add(mesh)
        this.chunks.push({ ix, iz, cx, cz, lod: -1, mesh })
      }
    }
  }

  private wantedLod(c: Chunk, camX: number, camZ: number): number {
    // Distância ao ponto mais próximo do bloco, para o LOD não depender do centro.
    const dx = Math.max(Math.abs(camX - c.cx) - CHUNK / 2, 0)
    const dz = Math.max(Math.abs(camZ - c.cz) - CHUNK / 2, 0)
    const d = Math.hypot(dx, dz)
    return d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : d < LOD_DIST[2] ? 2 : 3
  }

  /** Reconstrói até `budget` blocos cujo nível de detalhe mudou. Devolve quantos restam. */
  update(camX: number, camZ: number, budget: number): number {
    let pending: Chunk[] = []
    for (const c of this.chunks) {
      const want = this.wantedLod(c, camX, camZ)
      // Histerese: só troca se a diferença for clara.
      if (c.lod < 0 || want !== c.lod) pending.push(c)
    }
    if (pending.length === 0) return 0
    pending.sort((a, b) => Math.hypot(a.cx - camX, a.cz - camZ) - Math.hypot(b.cx - camX, b.cz - camZ))
    const count = pending.length
    pending = pending.slice(0, budget)
    for (const c of pending) this.build(c, this.wantedLod(c, camX, camZ))
    return count - pending.length
  }

  private build(c: Chunk, lod: number): void {
    const res = LOD_RES[lod]
    const cell = CHUNK / res
    const x0 = c.cx - CHUNK / 2
    const z0 = c.cz - CHUNK / 2
    const w = res + 3
    const H = new Float32Array(w * w)
    for (let j = 0; j < w; j += 1) {
      for (let i = 0; i < w; i += 1) H[j * w + i] = heightAt(x0 + (i - 1) * cell, z0 + (j - 1) * cell)
    }
    const nv = (res + 1) * (res + 1)
    const skirt = (res + 1) * 4
    const pos = new Float32Array((nv + skirt) * 3)
    const nor = new Float32Array((nv + skirt) * 3)
    const col = new Float32Array((nv + skirt) * 3)
    const uv = new Float32Array((nv + skirt) * 2)
    const rgb: [number, number, number] = [0, 0, 0]
    for (let j = 0; j <= res; j += 1) {
      for (let i = 0; i <= res; i += 1) {
        const k = j * (res + 1) + i
        const hx = H[(j + 1) * w + (i + 1)]
        const gx = (H[(j + 1) * w + (i + 2)] - H[(j + 1) * w + i]) / (2 * cell)
        const gz = (H[(j + 2) * w + (i + 1)] - H[j * w + (i + 1)]) / (2 * cell)
        const inv = 1 / Math.hypot(gx, 1, gz)
        const px = x0 + i * cell
        const pz = z0 + j * cell
        pos[k * 3] = px
        pos[k * 3 + 1] = hx
        pos[k * 3 + 2] = pz
        nor[k * 3] = -gx * inv
        nor[k * 3 + 1] = inv
        nor[k * 3 + 2] = -gz * inv
        const slope = Math.hypot(gx, gz)
        groundColor(px, pz, hx, slope, rgb)
        const floor = lod < 3 ? 1 - 0.3 * forestDensity(px, pz, hx, slope) : 1
        col[k * 3] = rgb[0] * floor
        col[k * 3 + 1] = rgb[1] * floor
        col[k * 3 + 2] = rgb[2] * floor
        uv[k * 2] = px * 0.11
        uv[k * 2 + 1] = pz * 0.11
      }
    }
    const indices: number[] = []
    for (let j = 0; j < res; j += 1) {
      for (let i = 0; i < res; i += 1) {
        const a = j * (res + 1) + i
        const b = a + 1
        const d = a + res + 1
        const e = d + 1
        indices.push(a, d, b, b, d, e)
      }
    }
    // Saia: copia as bordas para baixo e fecha frestas entre níveis de detalhe diferentes.
    const drop = 3 + lod * 5
    let s = nv
    const edge: number[][] = [[], [], [], []]
    for (let i = 0; i <= res; i += 1) {
      edge[0].push(i)
      edge[1].push(res * (res + 1) + i)
      edge[2].push(i * (res + 1))
      edge[3].push(i * (res + 1) + res)
    }
    for (const [ei, list] of edge.entries()) {
      const first = s
      for (const k of list) {
        pos[s * 3] = pos[k * 3]
        pos[s * 3 + 1] = pos[k * 3 + 1] - drop
        pos[s * 3 + 2] = pos[k * 3 + 2]
        nor[s * 3] = nor[k * 3]
        nor[s * 3 + 1] = nor[k * 3 + 1]
        nor[s * 3 + 2] = nor[k * 3 + 2]
        col[s * 3] = col[k * 3]
        col[s * 3 + 1] = col[k * 3 + 1]
        col[s * 3 + 2] = col[k * 3 + 2]
        uv[s * 2] = uv[k * 2]
        uv[s * 2 + 1] = uv[k * 2 + 1]
        s += 1
      }
      for (let i = 0; i < res; i += 1) {
        const a = list[i]
        const b = list[i + 1]
        const a2 = first + i
        const b2 = first + i + 1
        if (ei === 0 || ei === 3) indices.push(a, b, a2, b, b2, a2)
        else indices.push(a, a2, b, b, a2, b2)
      }
    }
    const old = c.mesh.geometry
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(indices)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    c.mesh.geometry = g
    old.dispose()
    c.lod = lod
  }

  /** Constrói todos os blocos em fatias, para a barra de progresso. */
  async buildAll(camX: number, camZ: number, onProgress: (p: number) => void): Promise<void> {
    const total = this.chunks.length
    let done = 0
    const order = [...this.chunks].sort((a, b) => Math.hypot(a.cx - camX, a.cz - camZ) - Math.hypot(b.cx - camX, b.cz - camZ))
    for (const c of order) {
      this.build(c, this.wantedLod(c, camX, camZ))
      done += 1
      if (done % 24 === 0) {
        onProgress(done / total)
        await new Promise(r => setTimeout(r, 0))
      }
    }
    onProgress(1)
  }
}

// --- Água -----------------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`
const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uTime;
uniform sampler2D uDepth;
uniform float uWorldSize;
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
uniform float uDaylight;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += vec2(0.7, 0.3) * cos(dot(p, vec2(0.7, 0.3)) * 0.9 + t * 1.1) * 0.05;
  g += vec2(-0.4, 0.8) * cos(dot(p, vec2(-0.4, 0.8)) * 1.7 + t * 1.6) * 0.035;
  g += vec2(0.2, -0.9) * cos(dot(p, vec2(0.2, -0.9)) * 3.1 + t * 2.3) * 0.02;
  float n1 = vnoise(p * 1.3 + vec2(t * 0.25, -t * 0.2));
  float n2 = vnoise(p * 2.7 - vec2(t * 0.3, t * 0.12));
  g += (vec2(n1 - 0.5, n2 - 0.5)) * 0.1;
  return g;
}
void main() {
  vec2 uv = (vWorld.xz / uWorldSize) + 0.5;
  float h = texture2D(uDepth, clamp(uv, 0.001, 0.999)).r * 32.0 - 24.0;
  float depth = WATER_LEVEL_C - h;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  depth = mix(30.0, depth, inside);
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec2 g = waveGrad(vWorld.xz, uTime);
  g *= 1.0 / (1.0 + dist * 0.004);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 4.5);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  float mu = max(dot(R, uSunDir), 0.0);
  vec3 sunGlint = uSunColor * (pow(mu, 700.0) * 18.0 + pow(mu, 60.0) * 0.6);
  float shallow = exp(-max(depth, 0.0) * 0.55);
  vec3 deepCol = vec3(0.012, 0.075, 0.115);
  vec3 shallowCol = vec3(0.05, 0.28, 0.26);
  vec3 body = mix(deepCol, shallowCol, shallow) * (0.18 + 0.82 * uDaylight);
  vec3 col = mix(body, sky, fres) + sunGlint * uDaylight;
  // Espuma na margem.
  float ripple = vnoise(vWorld.xz * 2.2 + vec2(uTime * 0.35, uTime * 0.2));
  float foamEdge = smoothstep(0.7 + 0.25 * sin(uTime * 0.9 + ripple * 6.0), 0.0, depth + ripple * 0.35);
  float foamNoise = smoothstep(0.35, 0.7, vnoise(vWorld.xz * 4.5 + uTime * 0.2));
  col = mix(col, vec3(0.9, 0.95, 1.0) * (0.25 + 0.75 * uDaylight), foamEdge * foamNoise * 0.7);
  float alpha = mix(0.58, 0.96, clamp(depth * 0.45, 0.0, 1.0));
  alpha = mix(alpha, 1.0, fres);
  alpha *= smoothstep(-1.3, 0.05, depth);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`.replace(/WATER_LEVEL_C/g, WATER_LEVEL.toFixed(1))

export class Water {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private depthTex: THREE.DataTexture

  constructor() {
    const size = 512
    this.depthTex = new THREE.DataTexture(new Uint8Array(size * size).fill(0), size, size, THREE.RedFormat, THREE.UnsignedByteType)
    this.depthTex.magFilter = THREE.LinearFilter
    this.depthTex.minFilter = THREE.LinearFilter
    this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping
    this.depthTex.needsUpdate = true
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDepth: { value: this.depthTex },
          uWorldSize: { value: CONFIG.world.size },
          uSunDir: { value: new THREE.Vector3() },
          uSunColor: { value: new THREE.Color() },
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uDaylight: { value: 1 },
        },
      ]),
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), this.mat)
    this.mesh.position.y = WATER_LEVEL
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
  }

  /** Amostra o terreno em grade grossa para saber a profundidade em qualquer ponto do lago. */
  async bake(onProgress: (p: number) => void): Promise<void> {
    const size = 512
    const data = new Uint8Array(size * size)
    const span = CONFIG.world.size
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const x = (i / (size - 1) - 0.5) * span
        const z = (j / (size - 1) - 0.5) * span
        const h = heightAt(x, z)
        data[j * size + i] = Math.round(Math.min(1, Math.max(0, (h + 24) / 32)) * 255)
      }
      if (j % 32 === 31) {
        onProgress((j + 1) / size)
        await new Promise(r => setTimeout(r, 0))
      }
    }
    this.depthTex.image = { data, width: size, height: size }
    this.depthTex.needsUpdate = true
  }

  update(sky: SkyState, camPos: THREE.Vector3, time: number): void {
    this.mesh.position.x = camPos.x
    this.mesh.position.z = camPos.z
    const u = this.mat.uniforms
    u.uTime.value = time
    u.uSunDir.value.copy(sky.sunDir)
    u.uSunColor.value.copy(sky.sunColor)
    u.uZenith.value.copy(sky.zenith)
    u.uHorizon.value.copy(sky.horizon)
    u.uDaylight.value = sky.daylight
  }
}
