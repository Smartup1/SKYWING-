import * as THREE from 'three'
import { hash2, heightAt } from './terrain'
import type { Thermal } from './atmosphere'
import type { SkyState } from './daylight'

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}
`
const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uSunColor, uFog;
uniform float uNight, uTime;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
  float mu = max(dot(d, uSunDir), 0.0);
  // Brilho do sol: disco, halo e dispersão ao longo do horizonte.
  col += uSunColor * (smoothstep(0.99955, 0.99985, mu) * 7.0);
  col += uSunColor * (pow(mu, 120.0) * 0.55 + pow(mu, 10.0) * 0.16 + pow(mu, 3.0) * 0.05);
  col = mix(col, uSunColor * 0.85, pow(mu, 5.0) * exp(-up * 5.0) * 0.32);
  // Estrelas e lua.
  float stars = 0.0;
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 p = d * 190.0;
    vec3 id = floor(p);
    float h = hash3(id);
    vec3 f = fract(p) - 0.5;
    float tw = 0.75 + 0.25 * sin(uTime * 2.0 + h * 40.0);
    stars = step(0.982, h) * smoothstep(0.42, 0.0, length(f)) * ((h - 0.982) / 0.018 * 0.9 + 0.1) * tw;
    stars *= smoothstep(0.0, 0.2, d.y) * uNight;
    float band = smoothstep(0.35, 0.0, abs(dot(d, normalize(vec3(0.3, 0.55, 0.78)))));
    stars += band * 0.035 * hash3(floor(d * 90.0)) * uNight;
  }
  col += vec3(0.85, 0.9, 1.0) * stars * 1.4;
  float moon = smoothstep(0.99935, 0.99965, max(dot(d, uMoonDir), 0.0)) * uNight;
  col += vec3(0.9, 0.93, 1.0) * moon * 2.2;
  col += vec3(0.4, 0.5, 0.8) * pow(max(dot(d, uMoonDir), 0.0), 40.0) * 0.18 * uNight;
  // Neblina no horizonte para casar com o terreno distante.
  float haze = exp(-max(d.y, 0.0) * 8.0);
  col = mix(col, uFog, clamp(haze * 0.75 + step(d.y, 0.0), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`

export class Sky {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly geom: THREE.SphereGeometry

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
    })
    this.geom = new THREE.SphereGeometry(1, 40, 24)
    this.mesh = new THREE.Mesh(this.geom, this.mat)
    this.mesh.scale.setScalar(9000)
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
  }

  dispose(): void {
    this.geom.dispose()
    this.mat.dispose()
  }

  update(sky: SkyState, camPos: THREE.Vector3, time: number): void {
    this.mesh.position.copy(camPos)
    const u = this.mat.uniforms
    u.uSunDir.value.copy(sky.sunDir)
    u.uMoonDir.value.copy(sky.moonDir)
    u.uZenith.value.copy(sky.zenith)
    u.uHorizon.value.copy(sky.horizon)
    u.uSunColor.value.copy(sky.sunColor)
    u.uFog.value.copy(sky.fog)
    u.uNight.value = sky.night
    u.uTime.value = time
  }
}

const CLOUD_VERT = /* glsl */ `
attribute float aSize;
attribute float aShade;
attribute float aSeed;
uniform vec3 uCam;
uniform vec2 uDrift;
uniform float uScale;
uniform float uRange;
varying float vShade;
varying float vSeed;
varying float vAlpha;
varying float vDist;
void main() {
  vec2 rel = position.xz + uDrift - uCam.xz;
  rel = mod(rel + uRange, 2.0 * uRange) - uRange;
  vec3 wp = vec3(uCam.x + rel.x, position.y, uCam.z + rel.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = length(mv.xyz);
  vDist = dist;
  gl_Position = projectionMatrix * mv;
  float px = aSize * uScale / max(dist, 1.0);
  gl_PointSize = clamp(px, 0.0, 900.0);
  vShade = aShade;
  vSeed = aSeed;
  // Desaparece perto da câmera (sem estourar o tamanho do ponto) e no limite do campo.
  float nearFade = smoothstep(aSize * 0.18, aSize * 0.8, dist);
  float farFade = 1.0 - smoothstep(uRange * 0.72, uRange * 0.98, length(rel));
  vAlpha = nearFade * farFade;
}
`
const CLOUD_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec3 uLit, uDark, uFog;
varying float vShade;
varying float vSeed;
varying float vAlpha;
varying float vDist;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float ang = vSeed * 6.2831;
  mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 uv = r * c + 0.5;
  float a = texture2D(uTex, uv).a;
  vec3 col = mix(uDark, uLit, smoothstep(0.0, 1.0, vShade));
  col = mix(col, uFog, smoothstep(2500.0, 7500.0, vDist) * 0.8);
  gl_FragColor = vec4(col, a * vAlpha * 0.9);
}
`

function cloudTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  // Nuvem = soma de blobs gaussianos com ruído → bordas fofas e irregulares.
  const blobs = Array.from({ length: 14 }, (_, i) => ({
    x: 0.5 + (hash2(i, 1, 5) - 0.5) * 0.46,
    y: 0.5 + (hash2(i, 2, 5) - 0.5) * 0.46,
    r: 0.14 + hash2(i, 3, 5) * 0.14,
  }))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size
      let a = 0
      for (const b of blobs) {
        const d = Math.hypot(u - b.x, v - b.y) / b.r
        a += Math.exp(-d * d * 1.6)
      }
      const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2)
      a = Math.min(1, a * 0.75) * Math.min(1, edge * 2.2)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Nuvens cúmulos sobre as térmicas + camadas altas, em um campo que acompanha a câmera. */
export class Clouds {
  readonly points: THREE.Points
  private readonly mat: THREE.ShaderMaterial
  private readonly geom: THREE.BufferGeometry
  private readonly tex: THREE.CanvasTexture
  private readonly range = 3600

  constructor(thermals: Thermal[]) {
    const pos: number[] = []
    const size: number[] = []
    const shade: number[] = []
    const seed: number[] = []
    const clump = (cx: number, cy: number, cz: number, radius: number, puffs: number, flat: number, key: number) => {
      for (let i = 0; i < puffs; i += 1) {
        const a = hash2(i, key, 11) * Math.PI * 2
        const rr = Math.sqrt(hash2(i, key, 12)) * radius
        const x = cx + Math.cos(a) * rr
        const z = cz + Math.sin(a) * rr
        const dome = 1 - (rr / radius) ** 2
        const y = cy + dome * radius * 0.42 * (0.4 + hash2(i, key, 13)) + (hash2(i, key, 14) - 0.5) * radius * 0.1
        pos.push(x, y, z)
        size.push(radius * (0.55 + hash2(i, key, 15) * 0.55) * flat)
        shade.push(Math.min(1, 0.15 + (y - cy) / (radius * 0.5)))
        seed.push(hash2(i, key, 16))
      }
    }
    let key = 1
    // Cúmulos acima das térmicas.
    for (const th of thermals) {
      clump(th.x, 255 + hash2(key, 2, 3) * 50, th.z, 55 + th.radius * 0.8, 20, 1.0, key)
      key += 1
    }
    // Camada dispersa de cúmulos e estratocúmulos, repetida no campo.
    for (let i = 0; i < 70; i += 1) {
      const x = (hash2(i, 7, 21) - 0.5) * this.range * 2
      const z = (hash2(i, 8, 21) - 0.5) * this.range * 2
      const high = hash2(i, 9, 21) > 0.55
      const y = high ? 420 + hash2(i, 10, 21) * 140 : 270 + hash2(i, 10, 21) * 90
      const radius = high ? 130 + hash2(i, 11, 21) * 120 : 70 + hash2(i, 11, 21) * 80
      clump(x, y, z, radius, high ? 14 : 18, high ? 1.5 : 1.0, key)
      key += 1
    }
    this.geom = new THREE.BufferGeometry()
    this.geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.geom.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
    this.geom.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1))
    this.geom.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    this.tex = cloudTexture()
    this.mat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTex: { value: this.tex },
        uCam: { value: new THREE.Vector3() },
        uDrift: { value: new THREE.Vector2() },
        uScale: { value: 700 },
        uRange: { value: this.range },
        uLit: { value: new THREE.Color() },
        uDark: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
      },
    })
    this.points = new THREE.Points(this.geom, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  dispose(): void {
    this.geom.dispose()
    this.tex.dispose()
    this.mat.dispose()
  }

  update(sky: SkyState, camera: THREE.PerspectiveCamera, drift: THREE.Vector2, viewportHeight: number): void {
    const u = this.mat.uniforms
    u.uCam.value.copy(camera.position)
    u.uDrift.value.copy(drift)
    u.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    u.uLit.value.copy(sky.cloudLit)
    u.uDark.value.copy(sky.cloudDark)
    u.uFog.value.copy(sky.fog)
  }
}

/** Utilitário para topos de térmica: altura mínima de nuvem acima do terreno. */
export const cloudBase = (x: number, z: number) => Math.max(240, heightAt(x, z) + 200)
