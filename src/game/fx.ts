import * as THREE from 'three'
import type { Thermal } from './atmosphere'
import type { SkyState } from './daylight'
import { hash2, heightAt } from './terrain'

const SPRITE_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 220.0);
  vColor = aColor;
}
`
const SPRITE_FRAG = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a = a * a * (3.0 - 2.0 * a);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}
`

export type Emit = {
  life: number
  size: number
  size1?: number
  color: THREE.Color | number
  alpha?: number
  gravity?: number
  drag?: number
}

class SpriteSystem {
  readonly points: THREE.Points
  private readonly cap: number
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly s0: Float32Array
  private readonly s1: Float32Array
  private readonly a0: Float32Array
  private readonly grav: Float32Array
  private readonly drag: Float32Array
  private cursor = 0
  private readonly mat: THREE.ShaderMaterial

  constructor(cap: number, additive: boolean) {
    this.cap = cap
    this.pos = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 4)
    this.size = new Float32Array(cap)
    this.vel = new Float32Array(cap * 3)
    this.age = new Float32Array(cap).fill(1e9)
    this.life = new Float32Array(cap).fill(1)
    this.s0 = new Float32Array(cap)
    this.s1 = new Float32Array(cap)
    this.a0 = new Float32Array(cap)
    this.grav = new Float32Array(cap)
    this.drag = new Float32Array(cap)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 700 } },
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 6
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: Emit): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.cap
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.age[i] = 0
    this.life[i] = o.life
    this.s0[i] = o.size
    this.s1[i] = o.size1 ?? o.size
    this.a0[i] = o.alpha ?? 1
    this.grav[i] = o.gravity ?? 0
    this.drag[i] = o.drag ?? 0
    const c = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color)
    this.col[i * 4] = c.r
    this.col[i * 4 + 1] = c.g
    this.col[i * 4 + 2] = c.b
  }

  update(dt: number, viewScale: number): void {
    this.mat.uniforms.uScale.value = viewScale
    for (let i = 0; i < this.cap; i += 1) {
      if (this.age[i] >= this.life[i]) {
        this.size[i] = 0
        this.col[i * 4 + 3] = 0
        continue
      }
      this.age[i] += dt
      const k = Math.min(1, this.age[i] / this.life[i])
      const damp = Math.max(0, 1 - this.drag[i] * dt)
      this.vel[i * 3] *= damp
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.grav[i] * dt
      this.vel[i * 3 + 2] *= damp
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k
      this.col[i * 4 + 3] = this.a0[i] * (1 - k) * Math.min(1, k * 12)
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aColor.needsUpdate = true
    g.attributes.aSize.needsUpdate = true
  }
}

const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform vec3 uCam;
uniform vec3 uDrift;
uniform float uTime;
uniform float uScale;
uniform float uBox;
varying float vA;
void main() {
  vec3 p = position + uDrift * 1.0 + vec3(sin(uTime * 0.6 + aSeed * 40.0), cos(uTime * 0.5 + aSeed * 20.0) * 0.6, cos(uTime * 0.4 + aSeed * 31.0)) * 1.6;
  vec3 rel = mod(p - uCam + uBox, 2.0 * uBox) - uBox;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(rel);
  gl_PointSize = clamp((0.09 + aSeed * 0.07) * uScale / max(-mv.z, 0.1), 1.0, 6.0);
  vA = (1.0 - smoothstep(uBox * 0.6, uBox, dist)) * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 90.0));
}
`
const MOTE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAmount;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(uColor, smoothstep(1.0, 0.2, r) * vA * uAmount);
}
`

export class Fx {
  readonly group = new THREE.Group()
  private readonly soft = new SpriteSystem(1400, false)
  private readonly glow = new SpriteSystem(1400, true)
  private readonly motes: THREE.Points
  private readonly moteMat: THREE.ShaderMaterial
  private readonly streaks: THREE.LineSegments
  private readonly streakPos = new Float32Array(60 * 6)
  private readonly streakHead = new Float32Array(60 * 3)
  private readonly streakMat: THREE.LineBasicMaterial
  private readonly thermalPts: THREE.Points
  private readonly thermalSprites: SpriteSystem
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpP = new THREE.Vector3()
  private thermalList: Thermal[] = []

  constructor(thermals: Thermal[]) {
    this.thermalList = thermals
    this.group.add(this.soft.points, this.glow.points)
    // Motas de pólen/poeira ao redor da câmera.
    const n = 260
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      pos.set([hash2(i, 1, 50) * 80 - 40, hash2(i, 2, 50) * 80 - 40, hash2(i, 3, 50) * 80 - 40], i * 3)
      seed[i] = hash2(i, 4, 50)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uDrift: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uScale: { value: 700 },
        uBox: { value: 40 },
        uColor: { value: new THREE.Color(1, 0.95, 0.8) },
        uAmount: { value: 0.5 },
      },
    })
    this.motes = new THREE.Points(g, this.moteMat)
    this.motes.frustumCulled = false
    this.motes.renderOrder = 7
    this.group.add(this.motes)

    // Rajadas de vento (velocidade).
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage))
    this.streakMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    this.streaks = new THREE.LineSegments(sg, this.streakMat)
    this.streaks.frustumCulled = false
    this.streaks.renderOrder = 8
    this.group.add(this.streaks)
    for (let i = 0; i < 60; i += 1) this.streakHead.set([1e5, 0, 0], i * 3)

    // Colunas de térmica.
    this.thermalSprites = new SpriteSystem(1, true)
    const tg = new THREE.BufferGeometry()
    this.thermalPts = new THREE.Points(tg, new THREE.PointsMaterial())
    void this.thermalPts
    void this.thermalSprites
  }

  setThermals(list: Thermal[]): void {
    this.thermalList = list
  }

  burst(pos: THREE.Vector3, kind: 'seed' | 'feather' | 'spray' | 'dust' | 'leaf' | 'sparkle', power = 1, dir?: THREE.Vector3): void {
    const v = this.tmpV
    const n = Math.floor(14 * power)
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const u = Math.random() * 2 - 1
      const s = Math.sqrt(1 - u * u)
      v.set(Math.cos(a) * s, u, Math.sin(a) * s)
      if (kind === 'seed' || kind === 'sparkle') {
        this.glow.emit(pos, v.clone().multiplyScalar(2 + Math.random() * 5), { life: 0.9 + Math.random() * 0.7, size: 0.5, size1: 0.05, color: kind === 'seed' ? 0xffd25a : 0xfff0b0, alpha: 1, drag: 1.5 })
      } else if (kind === 'feather') {
        this.soft.emit(pos, v.clone().multiplyScalar(2 + Math.random() * 3), { life: 1.6 + Math.random(), size: 0.45, size1: 0.3, color: Math.random() < 0.5 ? 0x6b4a2c : 0xe8a35a, alpha: 0.9, gravity: 1.5, drag: 1.2 })
      } else if (kind === 'spray') {
        const base = dir ? dir.clone().multiplyScalar(4) : new THREE.Vector3()
        this.soft.emit(pos, v.clone().multiplyScalar(2.5).add(base).add(new THREE.Vector3(0, 3 + Math.random() * 3, 0)), { life: 0.8 + Math.random() * 0.6, size: 0.5, size1: 1.0, color: 0xdff3ff, alpha: 0.55, gravity: 9, drag: 0.5 })
      } else if (kind === 'dust') {
        this.soft.emit(pos, new THREE.Vector3(v.x * 3, Math.abs(v.y) * 1.2, v.z * 3), { life: 1.1 + Math.random() * 0.6, size: 0.8, size1: 2.2, color: 0xb8a77f, alpha: 0.5, drag: 2 })
      } else {
        this.soft.emit(pos, v.clone().multiplyScalar(2), { life: 1.8, size: 0.35, size1: 0.3, color: 0x5d8a35, alpha: 0.9, gravity: 2, drag: 0.8 })
      }
    }
  }

  /** Esguicho contínuo ao roçar a água ou o chão. */
  trail(pos: THREE.Vector3, vel: THREE.Vector3, kind: 'spray' | 'dust'): void {
    const d = vel.clone().normalize()
    this.burst(pos, kind, 0.35, d)
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewHeight: number, sky: SkyState, time: number, wind: THREE.Vector3, airVel: THREE.Vector3, speed: number): void {
    const scale = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    this.soft.update(dt, scale)
    this.glow.update(dt, scale)
    // Motas.
    const u = this.moteMat.uniforms
    u.uCam.value.copy(camera.position)
    u.uDrift.value.copy(wind).multiplyScalar(time)
    u.uTime.value = time
    u.uScale.value = scale
    u.uColor.value.copy(sky.sunColor).lerp(new THREE.Color(1, 1, 1), 0.4)
    u.uAmount.value = 0.15 + 0.7 * sky.daylight
    // Rajadas de velocidade.
    const strength = THREE.MathUtils.clamp((speed - 17) / 18, 0, 1)
    this.streakMat.opacity = strength * 0.5
    if (strength > 0.01) {
      const dir = this.tmpV.copy(airVel).normalize()
      const cam = camera.position
      const right = this.tmpP.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3().crossVectors(right, dir).normalize()
      for (let i = 0; i < 60; i += 1) {
        const hx = this.streakHead[i * 3]
        let px = hx
        let py = this.streakHead[i * 3 + 1]
        let pz = this.streakHead[i * 3 + 2]
        const rel = new THREE.Vector3(px - cam.x, py - cam.y, pz - cam.z)
        const along = rel.dot(dir)
        if (hx > 9e4 || along < -6) {
          const a = Math.random() * Math.PI * 2
          const r = 3 + Math.random() * 14
          const ahead = 25 + Math.random() * 45
          px = cam.x + dir.x * ahead + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r
          py = cam.y + dir.y * ahead + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r
          pz = cam.z + dir.z * ahead + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r
        }
        const len = Math.min(10, speed * 0.2)
        px -= dir.x * speed * dt
        py -= dir.y * speed * dt
        pz -= dir.z * speed * dt
        px += airVel.x * 0
        this.streakHead[i * 3] = px
        this.streakHead[i * 3 + 1] = py
        this.streakHead[i * 3 + 2] = pz
        this.streakPos.set([px, py, pz, px + dir.x * len, py + dir.y * len, pz + dir.z * len], i * 6)
      }
      this.streaks.geometry.attributes.position.needsUpdate = true
      this.streaks.visible = true
    } else {
      this.streaks.visible = false
    }
    // Colunas de térmica próximas: poeira dourada subindo.
    if (sky.daylight > 0.1) {
      for (const th of this.thermalList) {
        const dx = th.x - camera.position.x
        const dz = th.z - camera.position.z
        const d2 = dx * dx + dz * dz
        if (d2 > 700 * 700) continue
        if (Math.random() < dt * 14) {
          const a = Math.random() * Math.PI * 2
          const r = Math.sqrt(Math.random()) * th.radius * 0.8
          const x = th.x + Math.cos(a) * r
          const z = th.z + Math.sin(a) * r
          const y = Math.max(heightAt(x, z), 0) + 4 + Math.random() * 20
          this.tmpP.set(x, y, z)
          this.glow.emit(this.tmpP, this.tmpV.set((Math.random() - 0.5) * 0.8, 6 + Math.random() * 3, (Math.random() - 0.5) * 0.8), {
            life: 14, size: 2.2, size1: 4.5, color: 0xffe9b8, alpha: 0.2 * sky.daylight, drag: 0,
          })
        }
      }
    }
  }
}
