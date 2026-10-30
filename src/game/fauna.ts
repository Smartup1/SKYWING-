import * as THREE from 'three'
import type { Atmosphere } from './atmosphere'
import { CITY_SITES } from './cityLayout'
import { hash2, heightAt, LAKE, riverX, surfaceAt } from './terrain'
import type { DiscoveryId } from './rules'

type Mode = 'patrol' | 'curious' | 'scatter'

type Boid = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  offset: THREE.Vector3
  phase: number
  flap: number
  bank: number
}

type Flock = {
  id: number
  boids: Boid[]
  center: THREE.Vector3
  centerVel: THREE.Vector3
  anchor: THREE.Vector2
  radius: number
  angle: number
  omega: number
  altitude: number
  mode: Mode
  timer: number
  cooldown: number
  side: number
  scale: number
  maxSpeed: number
  color: number
}

type Hawk = { boid: Boid; thermal: number; angle: number; omega: number; climb: number }
type Macaw = { id: Extract<DiscoveryId, `arara-${string}`>; boid: Boid; x: number; z: number; radius: number; angle: number; omega: number; color: number; discovered: boolean }

function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const wing: number[] = []
  const col: number[] = []
  const tri = (a: number[], b: number[], c: number[], wa: number, wb: number, wc: number, ca: number[], cb: number[], cc: number[]) => {
    pos.push(...a, ...b, ...c)
    wing.push(wa, wb, wc)
    col.push(...ca, ...cb, ...cc)
  }
  const W = [0.95, 0.95, 0.95]
  const G = [0.7, 0.72, 0.76]
  const D = [0.12, 0.12, 0.14]
  const nose = [0, 0, -0.3]
  const top = [0, 0.07, -0.08]
  const bot = [0, -0.06, -0.06]
  const l = [-0.055, 0, -0.06]
  const r = [0.055, 0, -0.06]
  const tail = [0, 0, 0.18]
  tri(nose, top, l, 0, 0, 0, W, W, W)
  tri(nose, r, top, 0, 0, 0, W, W, W)
  tri(nose, l, bot, 0, 0, 0, W, W, W)
  tri(nose, bot, r, 0, 0, 0, W, W, W)
  tri(top, tail, l, 0, 0, 0, G, G, G)
  tri(top, r, tail, 0, 0, 0, G, G, G)
  tri(l, tail, bot, 0, 0, 0, W, W, W)
  tri(r, bot, tail, 0, 0, 0, W, W, W)
  // Cauda (leque).
  tri([0, 0, 0.1], [-0.07, 0, 0.3], [0.07, 0, 0.3], 0, 0, 0, G, G, G)
  for (const s of [-1, 1]) {
    const sh1 = [s * 0.05, 0.02, -0.14]
    const sh2 = [s * 0.05, 0.02, 0.06]
    const m1 = [s * 0.4, 0.02, -0.1]
    const m2 = [s * 0.36, 0.02, 0.1]
    const t1 = [s * 0.78, 0.0, 0.08]
    const t2 = [s * 0.66, 0.0, 0.18]
    // Faces nos dois sentidos (DoubleSide no material).
    tri(sh1, m1, sh2, 0, s * 0.5, 0, G, W, G)
    tri(sh2, m1, m2, 0, s * 0.5, s * 0.5, G, W, W)
    tri(m1, t1, m2, s * 0.5, s, s * 0.5, W, D, W)
    tri(m2, t1, t2, s * 0.5, s, s, W, D, D)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

export type FaunaEvents = {
  onCall(pan: number, kind: 'curious' | 'scatter'): void
  onMacaw?(id: Extract<DiscoveryId, `arara-${string}`>, position: THREE.Vector3): void
}

const MAX = 256

export class Fauna {
  readonly mesh: THREE.InstancedMesh
  private readonly flocks: Flock[] = []
  private readonly hawks: Hawk[] = []
  private readonly macaws: Macaw[] = []
  private readonly knownDiscoveries: Set<DiscoveryId>
  private readonly phaseAttr: THREE.InstancedBufferAttribute
  private readonly flapAttr: THREE.InstancedBufferAttribute
  private readonly timeU = { value: 0 }
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly sc = new THREE.Vector3()
  private readonly col = new THREE.Color()
  /** Quantas aves estão voando ao lado do jogador (para a descoberta "voar com o bando"). */
  companions = 0
  private callCooldown = 0

  constructor(private readonly atm: Atmosphere, private readonly events: FaunaEvents, known: Iterable<DiscoveryId> = []) {
    this.knownDiscoveries = new Set(known)
    const geo = birdGeometry()
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1)
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1)
    geo.setAttribute('aPhase', this.phaseAttr)
    geo.setAttribute('aFlap', this.flapAttr)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
    const timeU = this.timeU
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = timeU
      shader.vertexShader = 'attribute float aWing;\nattribute float aPhase;\nattribute float aFlap;\nuniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         float wAbs = abs(aWing);
         float ang = sin(uTime * (7.0 + aFlap * 3.0) + aPhase - wAbs * 1.4) * 0.55 * aFlap;
         transformed.y += (ang * 0.5 + 0.03) * abs(position.x) * wAbs * 1.6 - 0.04 * wAbs * wAbs;
         transformed.x *= 1.0 - 0.22 * abs(sin(uTime * (7.0 + aFlap * 3.0) + aPhase)) * aFlap * wAbs;`,
      )
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3)
    this.build()
  }

  private makeBoid(x: number, y: number, z: number, i: number, seed: number): Boid {
    return {
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(Math.cos(seed) * 10, 0, Math.sin(seed) * 10),
      offset: new THREE.Vector3((hash2(i, seed | 0, 31) - 0.5) * 16, (hash2(i, seed | 0, 32) - 0.5) * 6, (hash2(i, seed | 0, 33) - 0.5) * 16),
      phase: hash2(i, 5, 34) * 6.28,
      flap: 1,
      bank: 0,
    }
  }

  private build(): void {
    const anchors = [
      { x: LAKE.x, z: LAKE.z, alt: 40, radius: 150, scale: 0.78, speed: 13, color: 0xa8b0b7 },
      { x: LAKE.x + 320, z: LAKE.z - 380, alt: 70, radius: 170, scale: 0.8, speed: 14, color: 0x929ca6 },
      { x: -520, z: -300, alt: 55, radius: 155, scale: 0.7, speed: 12, color: 0x9b9c91 },
      { x: 420, z: 120, alt: 80, radius: 190, scale: 0.82, speed: 15, color: 0x8998a4 },
      { x: 80, z: -700, alt: 60, radius: 160, scale: 0.72, speed: 13, color: 0xa4a7a1 },
      { x: -720, z: 640, alt: 90, radius: 180, scale: 0.82, speed: 16, color: 0x8491a0 },
      { x: CITY_SITES[0].x, z: CITY_SITES[0].z, alt: 45, radius: 76, scale: 0.9, speed: 14, color: 0x858d98 }, // pombos
      { x: CITY_SITES[1].x, z: CITY_SITES[1].z, alt: 34, radius: 58, scale: 0.82, speed: 15, color: 0x4b9d56 }, // periquitos
      { x: CITY_SITES[2].x, z: CITY_SITES[2].z, alt: 30, radius: 68, scale: 0.62, speed: 12, color: 0x9a7550 }, // pardais
      { x: LAKE.x + 240, z: LAKE.z + 65, alt: 23, radius: 82, scale: 0.6, speed: 11, color: 0x7b8c82 }, // aves na margem
      { x: LAKE.x - 72, z: LAKE.z + 205, alt: 28, radius: 90, scale: 0.64, speed: 12, color: 0x9a8063 }, // aves aquáticas
      { x: riverX(700), z: 700, alt: 32, radius: 112, scale: 0.58, speed: 13, color: 0x8b897c }, // corredor do rio
      { x: CITY_SITES[0].x - 58, z: CITY_SITES[0].z + 54, alt: 28, radius: 50, scale: 0.48, speed: 12, color: 0x655b4d }, // andorinhas urbanas
      { x: CITY_SITES[1].x + 40, z: CITY_SITES[1].z + 34, alt: 26, radius: 48, scale: 0.46, speed: 11, color: 0x8b765e },
      { x: CITY_SITES[2].x - 48, z: CITY_SITES[2].z - 38, alt: 25, radius: 54, scale: 0.46, speed: 11, color: 0x87735b },
    ]
    let idx = 0
    for (const [id, anchor] of anchors.entries()) {
      const { x: ax, z: az, alt } = anchor
      const count = 10 + Math.floor(hash2(id, 1, 35) * 7)
      const flock: Flock = {
        id,
        boids: [],
        center: new THREE.Vector3(ax + (id < 6 ? 150 : 0), Math.max(surfaceAt(ax, az), 0) + alt, az),
        centerVel: new THREE.Vector3(),
        anchor: new THREE.Vector2(ax, az),
        radius: anchor.radius + hash2(id, 2, 35) * (id < 6 ? 50 : 18),
        angle: hash2(id, 3, 35) * 6.28,
        omega: (hash2(id, 4, 35) > 0.5 ? 1 : -1) * (0.05 + hash2(id, 5, 35) * 0.04),
        altitude: alt,
        mode: 'patrol',
        timer: 0,
        cooldown: 0,
        side: 1,
        scale: anchor.scale,
        maxSpeed: anchor.speed,
        color: anchor.color,
      }
      for (let i = 0; i < count && idx < MAX - 7; i += 1) {
        const b = this.makeBoid(flock.center.x, flock.center.y, flock.center.z, i + id * 40, id + i * 0.7)
        b.pos.add(b.offset)
        flock.boids.push(b)
        this.col.setHex(anchor.color, THREE.SRGBColorSpace)
        this.col.multiplyScalar(0.86 + hash2(i, id, 38) * 0.24)
        this.mesh.setColorAt(idx + i, this.col)
        this.phaseAttr.array[idx + i] = b.phase
      }
      idx += flock.boids.length
      this.flocks.push(flock)
    }
    const macawData: Array<{ id: Macaw['id']; color: number; city: number; angle: number; omega: number }> = [
      { id: 'arara-azul', color: 0x0878e8, city: 0, angle: 0.7, omega: 0.19 },
      { id: 'arara-vermelha', color: 0xe52d35, city: 1, angle: 2.8, omega: -0.17 },
      { id: 'arara-amarela', color: 0xffd21c, city: 2, angle: 4.9, omega: 0.15 },
    ]
    for (const [i, data] of macawData.entries()) {
      const site = CITY_SITES[data.city]
      const radius = 38 + i * 5
      const ground = Math.max(surfaceAt(site.x, site.z), 0)
      const boid = this.makeBoid(site.x + Math.cos(data.angle) * radius, ground + 48 + i * 5, site.z + Math.sin(data.angle) * radius, 1000 + i, i + 10)
      boid.flap = 0.8
      this.macaws.push({ ...data, boid, x: site.x, z: site.z, radius, discovered: this.knownDiscoveries.has(data.id) })
      this.col.setHex(data.color, THREE.SRGBColorSpace)
      this.mesh.setColorAt(idx, this.col)
      this.phaseAttr.array[idx] = boid.phase
      idx += 1
    }
    // Gaviões planando sobre as térmicas.
    const th = this.atm.thermals
    for (let h = 0; h < Math.min(3, th.length); h += 1) {
      const t = th[Math.floor((h * th.length) / 3)]
      const boid = this.makeBoid(t.x + 20, 120, t.z, 900 + h, h)
      boid.flap = 0
      this.hawks.push({ boid, thermal: th.indexOf(t), angle: hash2(h, 0, 39) * 6.28, omega: 0.17, climb: 0 })
      this.col.setRGB(0.28, 0.2, 0.13, THREE.SRGBColorSpace)
      this.mesh.setColorAt(idx, this.col)
      idx += 1
    }
    this.mesh.count = idx
    this.mesh.instanceColor!.needsUpdate = true
  }

  get count(): number {
    return this.mesh.count
  }

  get macawCount(): number {
    return this.macaws.length
  }

  get macawsDiscovered(): number {
    return this.macaws.filter(macaw => macaw.discovered).length
  }

  /** Aves mais próximas do jogador (para câmera/áudio), se houver. */
  update(dt: number, time: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, playerForward: THREE.Vector3, allowMacawDiscoveries = true): void {
    this.timeU.value = time
    this.callCooldown -= dt
    const speed = playerVel.length()
    this.companions = 0
    let idx = 0
    for (const f of this.flocks) {
      this.updateFlock(f, dt, playerPos, playerVel, playerForward, speed)
      for (const b of f.boids) {
        this.writeBoid(idx, b, f.scale, dt)
        idx += 1
      }
    }
    for (const macaw of this.macaws) {
      macaw.angle += macaw.omega * dt
      const x = macaw.x + Math.cos(macaw.angle) * macaw.radius
      const z = macaw.z + Math.sin(macaw.angle) * macaw.radius
      const macawIndex = this.macaws.indexOf(macaw)
      macaw.boid.pos.set(x, Math.max(surfaceAt(x, z), 0) + 48 + macawIndex * 5 + Math.sin(macaw.angle * 2) * 3, z)
      macaw.boid.vel.set(-Math.sin(macaw.angle) * macaw.omega * macaw.radius, 0, Math.cos(macaw.angle) * macaw.omega * macaw.radius)
      this.writeBoid(idx++, macaw.boid, 3.2, dt)
      if (allowMacawDiscoveries && !macaw.discovered && macaw.boid.pos.distanceTo(playerPos) <= 24) {
        macaw.discovered = true
        this.events.onMacaw?.(macaw.id, macaw.boid.pos.clone())
      }
    }
    for (const h of this.hawks) {
      this.updateHawk(h, dt)
      this.writeBoid(idx, h.boid, 2.2, dt)
      idx += 1
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.phaseAttr.needsUpdate = true
    this.flapAttr.needsUpdate = true
  }

  private writeBoid(i: number, b: Boid, scale: number, dt: number): void {
    const v = b.vel
    const hs = Math.hypot(v.x, v.z)
    const yaw = Math.atan2(-v.x, -v.z)
    const pitch = Math.atan2(v.y, Math.max(hs, 0.1))
    this.e.set(pitch, yaw, b.bank, 'YXZ')
    this.q.setFromEuler(this.e)
    this.sc.setScalar(scale)
    this.m.compose(b.pos, this.q, this.sc)
    this.mesh.setMatrixAt(i, this.m)
    this.flapAttr.array[i] = b.flap
    void dt
  }

  private steer(b: Boid, f: Flock, target: THREE.Vector3, dt: number, maxSpeed: number, flee?: THREE.Vector3): void {
    const desired = new THREE.Vector3()
    if (flee) {
      desired.copy(flee).setLength(maxSpeed * 1.5)
    } else {
      desired.copy(target).sub(b.pos)
      const d = desired.length()
      desired.setLength(Math.min(maxSpeed * 1.1, 4 + d * 0.9))
    }
    // Separação.
    for (const o of f.boids) {
      if (o === b) continue
      const dx = b.pos.x - o.pos.x
      const dy = b.pos.y - o.pos.y
      const dz = b.pos.z - o.pos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < 36 && d2 > 1e-4) {
        const k = (6 - Math.sqrt(d2)) / 6
        desired.x += (dx / Math.sqrt(d2)) * k * 5
        desired.y += (dy / Math.sqrt(d2)) * k * 5
        desired.z += (dz / Math.sqrt(d2)) * k * 5
      }
    }
    // Evita o solo.
    const ground = Math.max(heightAt(b.pos.x + b.vel.x * 1.2, b.pos.z + b.vel.z * 1.2), 0)
    const clearance = b.pos.y - ground
    if (clearance < 14) desired.y += (14 - clearance) * 1.2
    const prevYaw = Math.atan2(-b.vel.x, -b.vel.z)
    b.vel.lerp(desired, Math.min(1, dt * 1.8))
    const newYaw = Math.atan2(-b.vel.x, -b.vel.z)
    const turn = Math.atan2(Math.sin(newYaw - prevYaw), Math.cos(newYaw - prevYaw)) / Math.max(dt, 1e-3)
    b.bank += (THREE.MathUtils.clamp(turn * 0.8, -0.9, 0.9) - b.bank) * Math.min(1, dt * 4)
    if (b.vel.length() > maxSpeed * 1.6) b.vel.setLength(maxSpeed * 1.6)
    b.pos.addScaledVector(b.vel, dt)
  }

  private updateFlock(f: Flock, dt: number, player: THREE.Vector3, _pVel: THREE.Vector3, pFwd: THREE.Vector3, pSpeed: number): void {
    f.cooldown -= dt
    f.timer -= dt
    const dc = f.center.distanceTo(player)
    // Transições de comportamento.
    if (f.mode !== 'scatter' && pSpeed > 25 && dc < 110 && f.cooldown < 0) {
      f.mode = 'scatter'
      f.timer = 5
      f.cooldown = 14
      if (this.callCooldown <= 0) {
        this.events.onCall(THREE.MathUtils.clamp((f.center.x - player.x) / 60, -1, 1), 'scatter')
        this.callCooldown = 1.5
      }
    } else if (f.mode === 'scatter' && f.timer <= 0) {
      f.mode = 'patrol'
      const mean = new THREE.Vector3()
      for (const b of f.boids) mean.add(b.pos)
      f.center.copy(mean.divideScalar(f.boids.length))
      f.anchor.set(f.center.x - Math.cos(f.angle) * f.radius, f.center.z - Math.sin(f.angle) * f.radius)
    } else if (f.mode === 'patrol' && pSpeed < 19 && pSpeed > 5 && dc < 230 && f.cooldown < 0) {
      f.mode = 'curious'
      f.timer = 45
      f.side = Math.random() < 0.5 ? -1 : 1
      if (this.callCooldown <= 0) {
        this.events.onCall(THREE.MathUtils.clamp((f.center.x - player.x) / 60, -1, 1), 'curious')
        this.callCooldown = 1.5
      }
    } else if (f.mode === 'curious' && (pSpeed > 24 || dc > 380 || f.timer <= 0)) {
      f.mode = 'patrol'
      f.cooldown = 22
    }

    const target = new THREE.Vector3()
    let maxSpeed = f.maxSpeed
    if (f.mode === 'patrol') {
      f.angle += f.omega * dt
      const tx = f.anchor.x + Math.cos(f.angle) * f.radius
      const tz = f.anchor.y + Math.sin(f.angle) * f.radius
      const ty = Math.max(surfaceAt(tx, tz), 0) + f.altitude + Math.sin(f.angle * 3) * 10
      target.set(tx, ty, tz)
      // O centro "persegue" o ponto de patrulha.
      f.centerVel.copy(target).sub(f.center).setLength(11)
      f.center.addScaledVector(f.centerVel, dt)
    } else if (f.mode === 'curious') {
      // Voa ao lado e um pouco atrás do jogador, igualando a velocidade.
      const right = new THREE.Vector3().crossVectors(pFwd, new THREE.Vector3(0, 1, 0)).normalize()
      target.copy(player).addScaledVector(pFwd, -6).addScaledVector(right, f.side * 13)
      target.y += 1.5
      f.centerVel.copy(target).sub(f.center)
      const gap = f.centerVel.length()
      f.centerVel.setLength(Math.min(gap * 1.2, pSpeed + 6))
      f.center.addScaledVector(f.centerVel, dt)
      maxSpeed = Math.max(11, pSpeed * 0.95)
    } else {
      target.copy(f.center)
    }

    const flee = new THREE.Vector3()
    for (const b of f.boids) {
      if (f.mode === 'scatter') {
        flee.copy(b.pos).sub(player)
        flee.y = Math.abs(flee.y) * 0.3 + 6
        flee.add(new THREE.Vector3((hash2(f.id, b.phase * 10, 41) - 0.5) * 20, 0, (hash2(f.id, b.phase * 10, 42) - 0.5) * 20))
        this.steer(b, f, target, dt, f.maxSpeed * 1.55, flee)
        b.flap = 1.4
      } else {
        const slot = target.clone().add(b.offset)
        if (f.mode === 'curious') slot.copy(f.center).add(b.offset.clone().multiplyScalar(0.6))
        this.steer(b, f, slot, dt, maxSpeed)
        // Planam em intervalos; batem asas quando sobem ou aceleram.
        const climbing = b.vel.y > 0.5
        b.flap = THREE.MathUtils.lerp(b.flap, climbing || f.mode === 'curious' ? 1 : 0.55 + 0.45 * Math.sin(b.phase + this.timeU.value * 0.5), Math.min(1, dt * 2))
      }
      if (f.mode === 'curious' && b.pos.distanceTo(player) < 30) this.companions += 1
    }
  }

  private updateHawk(h: Hawk, dt: number): void {
    const th = this.atm.thermals[h.thermal]
    if (!th) return
    h.angle += h.omega * dt
    const r = th.radius * 0.55
    const tx = th.x + Math.cos(h.angle) * r
    const tz = th.z + Math.sin(h.angle) * r
    const ground = Math.max(heightAt(tx, tz), 0)
    // Sobe na térmica, depois planeia para baixo e recomeça.
    h.climb += dt * 2.1
    const cycle = (h.climb % 190) / 190
    const ty = ground + 40 + (cycle < 0.7 ? cycle / 0.7 : 1 - (cycle - 0.7) / 0.3 * 0.9) * 190
    const target = new THREE.Vector3(tx, ty, tz)
    const prev = h.boid.pos.clone()
    h.boid.pos.lerp(target, Math.min(1, dt * 1.5))
    const v = h.boid.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-3))
    h.boid.vel.lerp(v, Math.min(1, dt * 4))
    const yawNow = Math.atan2(-h.boid.vel.x, -h.boid.vel.z)
    h.boid.bank += (THREE.MathUtils.clamp(h.omega * -6 * (yawNow === 0 ? 1 : 1), -0.6, 0.6) * -1 - h.boid.bank) * Math.min(1, dt * 2)
    h.boid.flap = 0.0
  }

  /** Posição da ave mais próxima ao ponto dado (para sons espaciais). */
  nearest(p: THREE.Vector3): number {
    let best = Infinity
    for (const f of this.flocks) for (const b of f.boids) best = Math.min(best, b.pos.distanceTo(p))
    return best
  }
}
