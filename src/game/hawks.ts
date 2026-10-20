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
  /** Voando junto de um bando de 3 ou mais aves. */
  withFlock: boolean
  /** Pousado dentro de uma cidade (telhado, rua ou praça). */
  sheltered: boolean
  /** Voando baixo sobre a cidade, entre os prédios. */
  inCover: boolean
  /** Assistência de voo ligada: o gavião é um pouco mais lento e menos ágil. */
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
} as const

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()

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
  private angle = 0

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
    if (this.phase === 'stalk') return 0.18
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
    this.distance = Infinity
    this.cooldown = Math.max(24, 52 - this.level * 4) + this.rng() * 18
  }

  private spawn(p: PlayerView): void {
    const b = this.body
    const heading = Math.atan2(-p.forward.x, -p.forward.z)
    // Aparece à frente (para o jogador ver o aviso), de um dos lados.
    const a = heading + (this.rng() - 0.5) * 2.4
    const dx = -Math.sin(a)
    const dz = -Math.cos(a)
    const x = p.pos.x + dx * 300
    const z = p.pos.z + dz * 300
    const y = clamp(p.pos.y + 55, this.world.ground(x, z) + 70, 380)
    b.pos.set(x, y, z)
    b.vel.set(-dx * 18, -2, -dz * 18)
    b.bank = 0
    b.flap = 0.5
    b.fold = 0
    b.active = true
    this.phase = 'stalk'
    this.timer = 5.5 + this.rng() * 2
    this.angle = this.rng() * Math.PI * 2
    this.leaving = false
    this.passes = 0
    this.stoopTime = 0
    this.coverTime = 0
    this.safeTime = 0
    this.events.warn(this.pan(p))
  }

  update(dt: number, p: PlayerView): void {
    const b = this.body
    if (!this.enabled) {
      if (this.phase !== 'idle') this.deactivate()
      return
    }
    if (this.phase === 'idle') {
      const exposed = !p.grounded && p.agl > 8 && !p.withFlock
      if (exposed) this.cooldown -= dt
      if (this.cooldown <= 0 && exposed) this.spawn(p)
      return
    }
    this.distance = b.pos.distanceTo(p.pos)
    this.timer -= dt

    // Condições de abrigo valem em qualquer fase ativa (exceto quando já está indo embora).
    if (!this.leaving) {
      this.safeTime = p.sheltered ? this.safeTime + dt : 0
      this.coverTime = p.inCover && !p.grounded ? this.coverTime + dt : Math.max(0, this.coverTime - dt)
      if (this.safeTime > 1.5) return this.escape('sheltered')
      if (p.withFlock && this.phase !== 'recover') {
        this.flockTime += dt
        if (this.flockTime > 2) return this.escape('flock')
      } else this.flockTime = Math.max(0, this.flockTime - dt)
      if (this.coverTime > 3.5 && this.phase === 'stoop') return this.escape('cover')
    }

    switch (this.phase) {
      case 'stalk':
        this.stalk(dt, p)
        break
      case 'stoop':
        this.stoop(dt, p)
        break
      case 'recover':
        this.recover(dt, p)
        break
      default:
        break
    }
  }

  private flockTime = 0

  private escape(reason: EscapeReason): void {
    this.events.escaped(reason)
    this.level = Math.min(8, this.level + 1)
    this.leaving = true
    this.phase = 'recover'
    this.timer = 3
  }

  /** Gira o vetor velocidade em direção a `dir` limitado por `maxTurn` (rad/s) e ajusta a rapidez. */
  private steer(dir: THREE.Vector3, speed: number, maxTurn: number, accel: number, dt: number): void {
    const b = this.body
    const cs = b.vel.length()
    const cur = _a.copy(b.vel)
    if (cs < 0.5) cur.copy(dir)
    else cur.divideScalar(cs)
    const yawBefore = Math.atan2(-cur.x, -cur.z)
    const ang = Math.acos(clamp(cur.dot(dir), -1, 1))
    const t = ang > 1e-4 ? Math.min(1, (maxTurn * dt) / ang) : 1
    cur.lerp(dir, t)
    if (cur.lengthSq() < 1e-6) cur.copy(dir)
    cur.normalize()
    const ns = cs + clamp(speed - cs, -accel * dt, accel * dt)
    b.vel.copy(cur).multiplyScalar(ns)
    b.pos.addScaledVector(b.vel, dt)
    const yawAfter = Math.atan2(-cur.x, -cur.z)
    const yawRate = Math.atan2(Math.sin(yawAfter - yawBefore), Math.cos(yawAfter - yawBefore)) / Math.max(dt, 1e-3)
    b.bank += (clamp(yawRate * 0.7, -1, 1) - b.bank) * Math.min(1, dt * 4)
  }

  /** Mantém o gavião acima do terreno e dos telhados à frente (sobe se for bater). */
  private avoid(dir: THREE.Vector3): void {
    const b = this.body
    const ahead = _b.copy(b.vel).setLength(Math.max(10, b.vel.length() * 0.7)).add(b.pos)
    const floor = Math.max(this.world.ground(ahead.x, ahead.z) + 3.2, this.world.roof(ahead.x, ahead.z) + 5)
    if (ahead.y < floor) {
      dir.y += clamp((floor - ahead.y) * 0.18 + 0.4, 0, 1.6)
      dir.normalize()
    }
  }

  private stalk(dt: number, p: PlayerView): void {
    const b = this.body
    this.angle += dt * 0.3
    const target = _c.set(Math.cos(this.angle) * 120, 48, Math.sin(this.angle) * 120).add(p.pos)
    const dir = _b.copy(target).sub(b.pos).normalize()
    this.avoid(dir)
    this.steer(dir, 17, 1.2, 10, dt)
    b.flap = 0.55
    b.fold = Math.max(0, b.fold - dt * 2)
    if (this.timer <= 0) this.beginStoop(p)
  }

  private beginStoop(p: PlayerView): void {
    this.phase = 'stoop'
    this.stoopTime = 0
    this.closest = Infinity
    this.inPass = false
    this.events.stoop(this.pan(p))
  }

  private stoop(dt: number, p: PlayerView): void {
    const b = this.body
    this.stoopTime += dt
    const dist = this.distance
    const vMax = (23 + Math.min(this.level, 6) * 1.2) * (p.assisted ? 0.88 : 1)
    const turn = p.assisted ? 0.85 : 1.0
    const lead = clamp(dist / Math.max(b.vel.length(), 10), 0, 1.1) * 0.55
    const aim = _c.copy(p.pos).addScaledVector(p.vel, lead)
    const dir = _b.copy(aim).sub(b.pos).normalize()
    this.avoid(dir)
    this.steer(dir, vMax, turn, 12, dt)
    b.flap = 0
    b.fold = Math.min(1, b.fold + dt * 3)

    if (dist < HAWK.hitRadius) {
      const away = new THREE.Vector3().copy(p.pos).sub(b.pos).setY(0)
      if (away.lengthSq() < 1e-4) away.copy(b.vel).setY(0)
      this.events.hit(away.normalize())
      this.leaving = true
      this.phase = 'recover'
      this.timer = 4
      this.level = Math.max(0, this.level - 1)
      return
    }
    // Passagem rente sem acerto = desvio por pouco.
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
    // Sobe em arco para longe do jogador.
    const dir = _b.set(b.vel.x, 0, b.vel.z)
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, -1)
    dir.normalize()
    if (this.leaving) {
      const away = _c.copy(b.pos).sub(p.pos).setY(0)
      if (away.lengthSq() > 1) dir.lerp(away.normalize(), 0.35)
    }
    dir.y = 0.5
    dir.normalize()
    this.avoid(dir)
    this.steer(dir, 20, 0.7, 10, dt)
    b.flap = 0.8
    b.fold = Math.max(0, b.fold - dt * 2)
    this.distance = b.pos.distanceTo(p.pos)
    if (this.leaving) {
      if (this.timer < -8 || this.distance > 380) this.deactivate()
    } else if (this.timer <= 0) {
      this.beginStoop(p)
    }
  }
}
