import * as THREE from 'three'

/**
 * Gavião caçador. Um diretor decide quando uma perseguição começa e conduz o gavião por fases:
 * avistar (stalk) → mergulho de ataque (stoop) → recuperação (recover). O jogador escapa fazendo
 * curvas fechadas no último instante, voando baixo entre prédios, pousando na cidade, juntando-se
 * a um bando ou apenas aguentando até o gavião se cansar. Sem three.js de renderização: só vetores.
 */

export type HunterBody = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  bank: number
  flap: number
  active: boolean
  /** 0 = asas abertas, 1 = asas recolhidas (mergulho). */
  fold: number
}

export type HawkPhase = 'idle' | 'stalk' | 'stoop' | 'recover'
export type EscapeReason = 'timeout' | 'sheltered' | 'flock' | 'cover' | 'dodged'

export type PlayerView = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  forward: THREE.Vector3
  grounded: boolean
  agl: number
  withFlock: boolean
  sheltered: boolean
  inCover: boolean
  assisted: boolean
}

export type HawkWorld = {
  ground(x: number, z: number): number
  roof(x: number, z: number): number
}

export type HawkEvents = {
  warn(pan: number): void
  stoop(pan: number): void
  dodge(): void
  hit(dir: THREE.Vector3): void
  escaped(reason: EscapeReason): void
}

export const HAWK = {
  firstDelay: 30,
  hitRadius: 2.3,
  dodgeRadius: 8,
  stoopTimeout: 24,
  maxPasses: 2,
  /** Altitude de cruzeiro desejada em `recover`. */
  cruiseAlt: 130,
  /** Teto operacional (não persegue acima disso). */
  ceiling: 320,
  /** Piso operacional relativo ao chão. */
  floorAgl: 3,
} as const

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const damp = (dt: number, rate: number) => 1 - Math.exp(-rate * dt)

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _e = new THREE.Vector3()

export class HawkDirector {
  enabled = true
  phase: HawkPhase = 'idle'
  /** Escapadas bem-sucedidas: deixam o gavião mais rápido (limitado). */
  level = 0
  distance = Infinity

  private timer = 0
  private cooldown: number = HAWK.firstDelay
  private stoopTime = 0
  private passes = 0
  private closest = Infinity
  private inPass = false
  private leaving = false
  private coverTime = 0
  private safeTime = 0
  private flockTime = 0
  private angle = 0
  private wingPhase = 0
  private assistedSmooth = 0
  /** Tempo até o próximo mergulho (usado para telegrafia visual). */
  private telegraph = 0

  constructor(
    readonly body: HunterBody,
    private readonly world: HawkWorld,
    private readonly events: HawkEvents,
    private readonly rng: () => number = Math.random,
  ) {}

  reset(delay: number = HAWK.firstDelay): void {
    this.deactivate()
    this.level = 0
    this.cooldown = delay
  }

  /** 0–1: o quanto o gavião ameaça agora (HUD e áudio). */
  get danger(): number {
    if (this.phase === 'stoop') return clamp(1.15 - this.distance / 170, 0.25, 1)
    if (this.phase === 'stalk') return 0.18 + 0.12 * (1 - clamp(this.telegraph, 0, 1))
    if (this.phase === 'recover' && !this.leaving) return 0.12
    return 0
  }

  private pan(p: PlayerView): number {
    return clamp((this.body.pos.x - p.pos.x) / 80, -1, 1)
  }

  private deactivate(): void {
    this.body.active = false
    this.phase = 'idle'
    this.leaving = false
    this.passes = 0
    this.stoopTime = 0
    this.closest = Infinity
    this.inPass = false
    this.coverTime = 0
    this.safeTime = 0
    this.flockTime = 0
    this.telegraph = 0
    this.distance = Infinity
    this.cooldown = Math.max(24, 52 - this.level * 4) + this.rng() * 18
  }

  private spawn(p: PlayerView): void {
    const b = this.body
    const heading = Math.atan2(-p.forward.x, -p.forward.z)

    // Try several bearings; pick the one with the most vertical clearance.
    // This avoids spawning behind a building or clipping through the terrain.
    let px = p.pos.x, py = p.pos.y + 55, pz = p.pos.z - 300
    let bestScore = -Infinity
    const minIdealAlt = Math.min(HAWK.ceiling, p.pos.y + 60)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const a = heading + (this.rng() - 0.5) * 2.4
      const dx = -Math.sin(a)
      const dz = -Math.cos(a)
      const x = p.pos.x + dx * 300
      const z = p.pos.z + dz * 300
      const gY = this.world.ground(x, z)
      const rY = this.world.roof(x, z)
      const minY = Math.max(gY + 40, rY + 20, p.pos.y + 45)
      const y = Math.min(minY, HAWK.ceiling)
      // Score = clearance over obstacles, with a preference for being close to ideal altitude
      const clearance = y - Math.max(gY, rY)
      const altitudeFit = -Math.abs(y - minIdealAlt)
      const score = clearance * 1.5 + altitudeFit * 0.5
      if (score > bestScore) {
        bestScore = score
        px = x; py = y; pz = z
      }
      if (clearance > 60 && Math.abs(y - minIdealAlt) < 30) break
    }

    b.pos.set(px, py, pz)
    // Initial velocity: dive toward player so the hawk doesn't dawdle
    _d.set(p.pos.x - px, p.pos.y - py, p.pos.z - pz).normalize()
    b.vel.copy(_d).multiplyScalar(18)
    b.bank = 0
    b.flap = 0.5
    b.fold = 0
    b.active = true

    this.phase = 'stalk'
    this.timer = 5.5 + this.rng() * 2
    this.angle = this.rng() * Math.PI * 2
    this.wingPhase = 0
    this.leaving = false
    this.passes = 0
    this.stoopTime = 0
    this.coverTime = 0
    this.safeTime = 0
    this.flockTime = 0
    this.telegraph = 1
    this.events.warn(this.pan(p))
  }

  update(dt: number, p: PlayerView): void {
    const b = this.body
    if (!this.enabled) {
      if (this.phase !== 'idle') this.deactivate()
      return
    }

    // Smooth assisted state — avoids sudden speed/turn jumps when the player toggles
    this.assistedSmooth += ((p.assisted ? 1 : 0) - this.assistedSmooth) * damp(dt, 3)

    if (this.phase === 'idle') {
      const exposed = !p.grounded && p.agl > 8 && !p.withFlock && p.pos.y < HAWK.ceiling
      if (exposed) this.cooldown -= dt
      if (this.cooldown <= 0 && exposed) this.spawn(p)
      return
    }

    // `distance` here is used by the `danger` getter (readers read it between frames)
    this.distance = b.pos.distanceTo(p.pos)
    this.timer -= dt
    this.wingPhase += dt * (2 + Math.abs(b.vel.y) * 0.15)

    // --- Wing animation (state-driven, not constant) ---
    if (this.phase === 'stalk') {
      // Slow cruise flap, slightly faster when telegraphing
      const telegraphed = 1 - clamp(this.telegraph, 0, 1)
      b.flap = 0.42 + 0.12 * Math.sin(this.wingPhase * 2.4) + 0.18 * telegraphed
    } else if (this.phase === 'recover') {
      const climb = clamp(b.vel.y / 5, 0, 1)
      b.flap = 0.55 + climb * 0.35 + 0.08 * Math.sin(this.wingPhase * 3.1)
    } else {
      b.flap = 0
    }

    // --- Escape conditions (only when not leaving) ---
    if (!this.leaving) {
      this.safeTime = p.sheltered ? this.safeTime + dt : 0
      this.coverTime = p.inCover && !p.grounded ? this.coverTime + dt : Math.max(0, this.coverTime - dt)

      if (this.safeTime > 1.5) return this.escape('sheltered')

      // Flock: hawk is intimidated by numbers, but only during active attack phases
      if (p.withFlock && this.phase !== 'recover') {
        this.flockTime += dt
        if (this.flockTime > 2) return this.escape('flock')
      } else {
        this.flockTime = Math.max(0, this.flockTime - dt * 2)
      }

      if (this.coverTime > 3.5 && this.phase === 'stoop') return this.escape('cover')
    }

    switch (this.phase) {
      case 'stalk': this.stalk(dt, p); break
      case 'stoop': this.stoop(dt, p); break
      case 'recover': this.recover(dt, p); break
      default: break
    }
  }

  private escape(reason: EscapeReason): void {
    this.events.escaped(reason)
    // Dodging is harder than hiding; a clean dodge should reward more
    const reward = reason === 'dodged' ? 2 : 1
    this.level = Math.min(8, this.level + reward)
    this.leaving = true
    this.phase = 'recover'
    this.timer = 3
    this.coverTime = 0
    this.safeTime = 0
    this.flockTime = 0
    this.telegraph = 0
  }

  /**
   * Turn velocity toward `dir` at up to `maxTurn` rad/s, and adjust speed by up to `accel` m/s².
   * Applies gravity to the hawk body so dives feel heavier than climbs.
   */
  private steer(dir: THREE.Vector3, speed: number, maxTurn: number, accel: number, dt: number): void {
    const b = this.body
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1)
    dir.normalize()

    const cs = b.vel.length()
    const cur = _a.copy(b.vel)
    if (cs < 0.5) cur.copy(dir)
    else cur.divideScalar(cs)

    // Yaw tracking (pre-turn) for banking
    const yawBefore = Math.atan2(-cur.x, -cur.z)

    // Angular interpolation toward target direction
    const ang = Math.acos(clamp(cur.dot(dir), -1, 1))
    const t = ang > 1e-4 ? Math.min(1, (maxTurn * dt) / ang) : 1
    cur.lerp(dir, t)
    if (cur.lengthSq() < 1e-6) cur.copy(dir)
    cur.normalize()

    // Speed adjustment
    const ns = cs + clamp(speed - cs, -accel * dt, accel * dt)
    b.vel.copy(cur).multiplyScalar(ns)

    // Integrate
    b.pos.addScaledVector(b.vel, dt)

    // Hard floor: never let the hawk clip through terrain or roofs
    const groundHere = this.world.ground(b.pos.x, b.pos.z)
    const roofHere = this.world.roof(b.pos.x, b.pos.z)
    const hardFloor = Math.max(groundHere + HAWK.floorAgl, roofHere + 2)
    if (b.pos.y < hardFloor) {
      b.pos.y = hardFloor
      if (b.vel.y < 0) b.vel.y = 0
    }

    // Yaw post-turn, for banking
    const yawAfter = Math.atan2(-cur.x, -cur.z)
    const yawRate = Math.atan2(Math.sin(yawAfter - yawBefore), Math.cos(yawAfter - yawBefore)) / Math.max(dt, 1e-3)
    const bankTarget = clamp(yawRate * 0.7, -1, 1)
    // Bank response: fast when entering a hard turn, calm when straightening out
    const bankResp = damp(dt, 4 + Math.abs(bankTarget) * 6)
    b.bank += (bankTarget - b.bank) * bankResp
  }

  /**
   * Predict where the hawk is heading and steer upward if it would clip terrain.
   * Uses multiple look-ahead points so sharp dives are caught in time.
   */
  private avoid(dir: THREE.Vector3): void {
    const b = this.body
    const speed = Math.max(b.vel.length(), 10)
    let lift = 0

    // Two look-ahead points: 0.4s and 0.9s
    for (let i = 0; i < 2; i += 1) {
      const t = (0.4 + i * 0.5) * speed
      _e.copy(b.vel).setLength(t).add(b.pos)
      const floor = Math.max(
        this.world.ground(_e.x, _e.z) + HAWK.floorAgl,
        this.world.roof(_e.x, _e.z) + 4,
      )
      if (_e.y < floor) {
        const deficit = (floor - _e.y) * 0.18
        lift = Math.max(lift, deficit + 0.35)
      }
    }

    // Immediate clearance: if already very close to a wall or the ground, force climb
    const here = Math.max(
      this.world.ground(b.pos.x, b.pos.z) + HAWK.floorAgl,
      this.world.roof(b.pos.x, b.pos.z) + 3,
    )
    if (b.pos.y < here + 2) lift = Math.max(lift, 1.2)

    if (lift > 0) {
      dir.y += clamp(lift, 0, 1.4)
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0)
      dir.normalize()
    }
  }

  private stalk(dt: number, p: PlayerView): void {
    const b = this.body
    this.angle += dt * 0.35

    // Orbit above and around the player with oscillating radius and altitude
    const radius = 100 + Math.sin(this.angle * 0.7) * 30
    const altitude = 40 + Math.sin(this.angle * 1.3) * 15
    const target = _c.set(
      Math.cos(this.angle) * radius,
      altitude,
      Math.sin(this.angle) * radius,
    ).add(p.pos)

    const dir = _b.copy(target).sub(b.pos).normalize()
    this.avoid(dir)

    // Assisted mode: slower and less agile
    const speedMul = 1 - 0.15 * this.assistedSmooth
    this.steer(dir, 17 * speedMul, 1.2 * speedMul, 10, dt)

    b.fold = Math.max(0, b.fold - dt * 2)

    // Telegraph: fold wings slightly as the stoop approaches
    this.telegraph = clamp(this.timer / 1.5, 0, 1)
    if (this.telegraph < 1) {
      b.fold = Math.max(b.fold, (1 - this.telegraph) * 0.18)
    }

    if (this.timer <= 0) this.beginStoop(p)
  }

  private beginStoop(p: PlayerView): void {
    this.phase = 'stoop'
    this.stoopTime = 0
    this.closest = Infinity
    this.inPass = false
    this.telegraph = 0
    this.events.stoop(this.pan(p))
  }

  private stoop(dt: number, p: PlayerView): void {
    const b = this.body
    this.stoopTime += dt

    // Predictive aim: lead by flight time × player velocity, clamped to avoid overshoot
    const preDist = this.distance
    const lead = clamp(preDist / Math.max(b.vel.length(), 10), 0, 1.1) * 0.55
    const aim = _c.copy(p.pos).addScaledVector(p.vel, lead)
    const dir = _b.copy(aim).sub(b.pos).normalize()
    this.avoid(dir)

    const assist = 1 - 0.12 * this.assistedSmooth
    const vMax = (23 + Math.min(this.level, 6) * 1.2) * assist
    const turn = 1.0 - 0.15 * this.assistedSmooth

    this.steer(dir, vMax, turn, 12, dt)
    b.fold = Math.min(1, b.fold + dt * 3)

    // Fresh distance (post-integration) — eliminates 1-frame hit lag
    const dist = b.pos.distanceTo(p.pos)

    if (dist < HAWK.hitRadius) {
      const away = _d.copy(p.pos).sub(b.pos).setY(0)
      if (away.lengthSq() < 1e-4) away.copy(b.vel).setY(0)
      this.events.hit(away.normalize())
      this.leaving = true
      this.phase = 'recover'
      this.timer = 4
      this.level = Math.max(0, this.level - 1)
      // Bleed speed so the hawk doesn't fly through the player
      b.vel.multiplyScalar(0.55)
      return
    }

    // Near-miss detection
    if (dist < 16) {
      this.inPass = true
      this.closest = Math.min(this.closest, dist)
    } else if (this.inPass && dist > this.closest + 5) {
      const near = this.closest < HAWK.dodgeRadius
      this.inPass = false
      this.closest = Infinity
      if (near) {
        this.events.dodge()
        this.passes += 1
        this.phase = 'recover'
        this.timer = 3.2
        if (this.passes >= HAWK.maxPasses) this.escape('dodged')
        return
      }
    }

    if (this.stoopTime > HAWK.stoopTimeout) this.escape('timeout')
  }

  private recover(dt: number, p: PlayerView): void {
    const b = this.body

    // Direction: keep horizontal velocity, bias away from player if leaving
    const dir = _b.set(b.vel.x, 0, b.vel.z)
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, -1)
    dir.normalize()

    if (this.leaving) {
      const away = _c.copy(b.pos).sub(p.pos).setY(0)
      if (away.lengthSq() > 1) dir.lerp(away.normalize(), 0.35)
      // Cruise slightly upward while retreating
      dir.y = 0.15
    } else {
      // Climb to cruise altitude for a better dive angle on the next pass
      const altError = HAWK.cruiseAlt - b.pos.y
      dir.y = clamp(altError * 0.02 + 0.35, 0.05, 0.7)
    }
    dir.normalize()

    this.avoid(dir)
    this.steer(dir, 20, 0.7, 10, dt)
    b.fold = Math.max(0, b.fold - dt * 2)

    this.distance = b.pos.distanceTo(p.pos)

    if (this.leaving) {
      if (this.timer < -8 || this.distance > 380 || b.pos.y > HAWK.ceiling + 80) {
        this.deactivate()
      }
    } else if (this.timer <= 0) {
      this.beginStoop(p)
    }
  }
}
