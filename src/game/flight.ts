import * as THREE from 'three'
import { CONFIG } from './config'
import { DEFAULT_BIRD_ID, getBirdSpecies, type FlightProfile } from './birdSpecies'

export type FlightInput = {
  /** +1 subir (S/↓), -1 mergulhar (W/↑). */
  pitch: number
  /** +1 curva à esquerda (A/←), -1 à direita (D/→). */
  bank: number
  /** +1 rolar à esquerda (Q), -1 à direita (E). */
  roll: number
  /** Segurando bater asas. */
  flap: boolean
  /** Toque novo em bater asas (decolagem). */
  flapPressed: boolean
  /** Impulsionar (bater asas mais forte e rápido). */
  boost: boolean
}

export type FlightEnv = {
  /** Altura da superfície (terreno ou água) em x, z. */
  surface(x: number, z: number): number
  /** Velocidade do ar (m/s) em x, y, z. */
  wind(out: THREE.Vector3, x: number, y: number, z: number): void
}

export type FlightEvent =
  | { type: 'flap'; power: number }
  | { type: 'takeoff' }
  | { type: 'land' }
  | { type: 'perch' }
  | { type: 'skim'; speed: number }
  | { type: 'crash'; impact: number }
  | { type: 'stall' }

export const NO_INPUT: FlightInput = { pitch: 0, bank: 0, roll: 0, flap: false, flapPressed: false, boost: false }

const BELLY = 0.32
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _q = new THREE.Quaternion()

/**
 * Voo de ave simplificado, mas físico: sustentação e arrasto crescem com a velocidade do ar ao
 * quadrado, o ângulo de ataque define o coeficiente (com estol), o planeio tende a uma velocidade
 * de equilíbrio, curvas inclinadas viram a trajetória, e bater asas custa fôlego.
 * Orientação: frente = -Z local, ordem de Euler YXZ (guinada, arfagem, rolagem).
 */
export class FlightModel {
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly forward = new THREE.Vector3(0, 0, -1)
  readonly up = new THREE.Vector3(0, 1, 0)
  readonly right = new THREE.Vector3(1, 0, 0)
  yaw = 0
  pitch = 0
  roll = 0
  stamina = CONFIG.stamina.max
  grounded = false
  perched = false
  stalled = false
  cruise = true
  /** Ajuda opcional para manter atitude e velocidade mais estáveis; ativa por padrão. */
  assisted = true
  profile: FlightProfile = getBirdSpecies(DEFAULT_BIRD_ID).flight
  /** Fase da batida (0–1); 0 = parado. A descida da asa ocupa os primeiros 45%. */
  flapPhase = 0
  flapping = false
  boosting = false
  airspeed = 0
  /** Ângulo de ataque (rad) e velocidade vertical do ar sentida (m/s). */
  aoa = 0
  airLift = 0
  agl = 0
  /** Intensidade de carga aerodinâmica (G) para a câmera/HUD. */
  gLoad = 1
  /** Segundos desde o último contato com o solo. */
  airborneTime = 0

  private readonly air = new THREE.Vector3()
  private readonly rel = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly acc = new THREE.Vector3()
  private readonly lift = new THREE.Vector3()
  private readonly flapHeading = new THREE.Vector3()
  private stallLatch = false

  setProfile(profile: FlightProfile): void {
    this.profile = profile
  }

  reset(x: number, y: number, z: number, yaw: number, speed = CONFIG.flight.cruiseSpeed * this.profile.cruiseSpeed): void {
    this.pos.set(x, y, z)
    this.yaw = yaw
    this.pitch = 0
    this.roll = 0
    this.updateBasis()
    this.vel.copy(this.forward).multiplyScalar(speed)
    this.stamina = CONFIG.stamina.max
    this.grounded = false
    this.perched = false
    this.stalled = false
    this.flapPhase = 0
    this.flapping = false
    this.airborneTime = 0
    this.stallLatch = false
  }

  get speed(): number {
    return this.vel.length()
  }

  /** Pouso assistido em um poleiro selecionado; bater asas volta ao voo. */
  landOnPerch(position: THREE.Vector3, yaw: number, events: FlightEvent[]): void {
    this.pos.copy(position)
    this.yaw = yaw
    this.pitch = 0
    this.roll = 0
    this.vel.set(0, 0, 0)
    this.grounded = true
    this.perched = true
    this.stalled = false
    this.flapPhase = 0
    this.flapping = false
    this.boosting = false
    this.airspeed = 0
    this.airLift = 0
    this.gLoad = 1
    this.updateBasis()
    events.push({ type: 'perch' })
  }

  get groundSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z)
  }

  get heading(): number {
    // 0 = Norte (-Z), 90 = Leste (+X).
    return (THREE.MathUtils.radToDeg(Math.atan2(this.forward.x, -this.forward.z)) + 360) % 360
  }

  updateBasis(): void {
    _e.set(this.pitch, this.yaw, this.roll, 'YXZ')
    _q.setFromEuler(_e)
    this.forward.set(0, 0, -1).applyQuaternion(_q)
    this.up.set(0, 1, 0).applyQuaternion(_q)
    this.right.set(1, 0, 0).applyQuaternion(_q)
  }

  step(dt: number, inp: FlightInput, env: FlightEnv, events: FlightEvent[]): void {
    const F = CONFIG.flight
    const S = CONFIG.stamina
    this.updateBasis()
    const surface = env.surface(this.pos.x, this.pos.z)
    this.agl = this.pos.y - surface

    if (this.grounded) {
      if (this.perched) this.stepPerch(dt, inp, events)
      else this.stepGround(dt, inp, surface, events)
      return
    }
    this.airborneTime += dt

    env.wind(this.air, this.pos.x, this.pos.y, this.pos.z)
    this.rel.copy(this.vel).sub(this.air)
    const s = this.rel.length()
    this.airspeed = s
    this.dir.copy(this.rel).divideScalar(Math.max(s, 0.5))

    // --- Aerodinâmica ---------------------------------------------------------------------
    const rho = clamp(1 - (this.pos.y - 280) / 360, 0.4, 1)
    const q = F.liftK * rho * s * s
    const alpha = -Math.asin(clamp(this.dir.dot(this.up), -1, 1))
    this.aoa = alpha
    const absA = Math.abs(alpha)
    const clMax = F.liftSlope * F.stallAngle
    let cl: number
    if (absA <= F.stallAngle) cl = F.liftSlope * alpha
    else cl = Math.sign(alpha) * clMax * Math.max(0.42, 1 - (absA - F.stallAngle) * 4.5)
    const wasStalled = this.stalled
    this.stalled = absA > F.stallAngle && s > 1.5
    if (this.stalled && !wasStalled && !this.stallLatch) {
      events.push({ type: 'stall' })
      this.stallLatch = true
    }
    if (!this.stalled && absA < F.stallAngle * 0.7) this.stallLatch = false
    const tuck = clamp(-this.pitch / 0.9, 0, 1) * clamp(s / 20, 0, 1)
    const cd = (F.cd0 * (1 - 0.35 * tuck) + F.inducedK * cl * cl + 1.1 * Math.sin(alpha) ** 2) / this.profile.glide

    this.lift.copy(this.up).addScaledVector(this.dir, -this.up.dot(this.dir))
    if (this.lift.lengthSq() > 1e-6) this.lift.normalize()
    this.acc.set(0, -F.gravity, 0)
    this.acc.addScaledVector(this.lift, q * cl)
    this.acc.addScaledVector(this.dir, -q * cd)
    // Força lateral (derrapagem é amortecida: a ave se alinha à trajetória).
    this.acc.addScaledVector(this.right, -this.rel.dot(this.right) * 1.4)
    this.airLift = q * cl

    // --- Batidas de asa ---------------------------------------------------------------------
    const clearance = this.agl
    const tired = this.stamina <= 0 ? 0.2 : this.stamina < 18 ? 0.55 : 1
    const auto = (this.cruise || this.assisted) && !inp.flap && !inp.boost && this.autoFlap(inp, s, clearance)
    const want = inp.flap || inp.boost || auto
    this.boosting = inp.boost && this.stamina > 2
    const boostMul = this.boosting ? F.boostMult : 1
    if (want || this.flapPhase > 0) {
      const hz = F.flapHz * (this.boosting ? 1.35 : 1) * (auto ? 0.85 : 1)
      const prev = this.flapPhase
      if (prev === 0 && want) events.push({ type: 'flap', power: boostMul })
      this.flapPhase += hz * dt
      if (this.flapPhase >= 1) {
        this.flapPhase -= 1
        if (!want) this.flapPhase = 0
        else events.push({ type: 'flap', power: boostMul })
      }
      this.flapping = this.flapPhase > 0
    } else {
      this.flapping = false
    }
    if (this.flapping) {
      const p = this.flapPhase < 0.45 ? Math.sin((Math.PI * this.flapPhase) / 0.45) : 0
      const low = 1 + clamp((9 - s) / 9, 0, 1) * 1.15
      const strength = p * boostMul * tired * this.profile.flapPower * (auto ? 0.8 : 1)
      // Batidas simétricas não devem virar impulso lateral só porque o corpo está inclinado.
      this.flapHeading.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
      this.acc.addScaledVector(this.flapHeading, F.flapForward * strength)
      this.acc.y += F.flapLift * strength * low
      const drain = (this.boosting ? S.boostDrain : S.flapDrain * (auto ? 0.35 : 1)) * this.profile.staminaUse
      this.stamina -= drain * dt
    } else {
      this.stamina += S.recover * this.profile.recovery * dt
    }
    this.stamina = clamp(this.stamina, 0, S.max)

    // Teto: o ar rarefeito empurra para baixo.
    if (this.pos.y > F.ceiling) this.acc.y -= (this.pos.y - F.ceiling) * 0.6

    this.gLoad = clamp(1 + (q * cl - F.gravity * Math.max(0, this.lift.y)) / F.gravity, -2, 6)

    // --- Integração ------------------------------------------------------------------------
    this.vel.addScaledVector(this.acc, dt)
    const vmax = F.maxSpeed * this.profile.maxSpeed
    const vl = this.vel.length()
    if (vl > vmax) this.vel.multiplyScalar(1 - Math.min(0.9, (1 - vmax / vl) * 6 * dt))
    this.pos.addScaledVector(this.vel, dt)

    // --- Atitude --------------------------------------------------------------------------
    const gammaAir = Math.asin(clamp(this.rel.y / Math.max(s, 0.5), -1, 1))
    const cosBank = Math.max(0.55, Math.cos(this.roll))
    const trim = clamp((F.trimAlpha / cosBank) * clamp(s / F.trimSpeed, 0.25, 1.5), 0.01, F.stallAngle * 0.85)
    if (inp.pitch !== 0) {
      const climbFactor = this.assisted && this.stalled && inp.pitch > 0 ? 0.18 : this.stalled && inp.pitch > 0 ? 0.4 : 1
      this.pitch += inp.pitch * F.pitchRate * dt * climbFactor
    } else {
      const target = this.stalled ? gammaAir - (this.assisted ? 0.14 : 0.05) : gammaAir + trim
      this.pitch += (target - this.pitch) * Math.min(1, (this.assisted ? 2.6 : 1.7) * dt)
    }
    const pitchLimit = this.assisted ? 1.12 : 1.45
    this.pitch = clamp(this.pitch, -pitchLimit, pitchLimit)
    // Estol: o nariz cai.
    if (this.stalled && inp.pitch >= 0) this.pitch -= (this.assisted ? 1.4 : 0.9) * dt

    if (inp.roll !== 0) {
      this.roll += inp.roll * F.rollRate * this.profile.turning * dt
    } else if (inp.bank !== 0) {
      const target = inp.bank * Math.min(1.15, F.maxBank * this.profile.turning)
      this.roll += (target - this.roll) * Math.min(1, (this.assisted ? 4.1 : 3.2) * dt)
    } else {
      this.roll = wrapPi(this.roll)
      this.roll += -this.roll * Math.min(1, (this.assisted ? 3.2 : 1.15) * dt)
    }
    this.roll = wrapPi(this.roll)

    // Guinada acompanha a trajetória horizontal (curva coordenada) + assistência em baixa.
    const hs = Math.hypot(this.vel.x, this.vel.z)
    if (hs > 2) {
      const wanted = Math.atan2(-this.vel.x, -this.vel.z)
      this.yaw += wrapPi(wanted - this.yaw) * Math.min(1, 6 * this.profile.turning * dt)
    }
    const assist = inp.bank * 0.45 * this.profile.turning * (1 - clamp(s / 22, 0, 1)) * dt
    if (assist !== 0) {
      this.yaw += assist
      const c = Math.cos(assist)
      const sn = Math.sin(assist)
      const vx = this.vel.x
      this.vel.x = vx * c + this.vel.z * sn
      this.vel.z = -vx * sn + this.vel.z * c
    }
    this.yaw = wrapPi(this.yaw)

    this.contact(dt, env, events)
    this.updateBasis()
  }

  private autoFlap(inp: FlightInput, s: number, clearance: number): boolean {
    if (this.stamina < 6 || (!this.assisted && inp.pitch < -0.2)) return false
    const F = CONFIG.flight
    if (this.stalled && this.assisted) return true
    if (s < F.cruiseSpeed * this.profile.cruiseSpeed * (this.assisted ? 0.82 : 0.92)) return true
    return this.vel.y < -0.9 && clearance < 180 && s < F.cruiseSpeed * 1.5
  }

  private contact(dt: number, env: FlightEnv, events: FlightEvent[]): void {
    const surface = env.surface(this.pos.x, this.pos.z)
    const floor = surface + BELLY
    if (this.pos.y >= floor) return
    const hs = Math.hypot(this.vel.x, this.vel.z)
    const down = -this.vel.y
    this.pos.y = floor
    if (down > 6.5 || (hs > 11 && this.pitch < -0.55 && down > 3)) {
      events.push({ type: 'crash', impact: Math.max(down, hs * 0.4) })
      this.vel.y = down * 0.22
      this.vel.x *= 0.55
      this.vel.z *= 0.55
      this.stamina = Math.max(0, this.stamina - 14)
      this.pitch = Math.max(this.pitch, 0.2)
    } else if (hs > 9) {
      // Rasante: roça a superfície sem pousar.
      events.push({ type: 'skim', speed: hs })
      this.vel.y = Math.max(this.vel.y, 0)
      this.vel.multiplyScalar(1 - 0.35 * dt)
    } else {
      this.grounded = true
      this.vel.y = 0
      this.flapPhase = 0
      this.flapping = false
      this.stalled = false
      events.push({ type: 'land' })
    }
  }

  private stepPerch(dt: number, inp: FlightInput, events: FlightEvent[]): void {
    this.vel.set(0, 0, 0)
    this.stamina = Math.min(CONFIG.stamina.max, this.stamina + CONFIG.stamina.restRecover * this.profile.recovery * dt)
    this.pitch += (0 - this.pitch) * Math.min(1, 6 * dt)
    this.roll += (0 - this.roll) * Math.min(1, 6 * dt)
    this.flapPhase = 0
    this.flapping = false
    this.boosting = false
    this.stalled = false
    if (inp.flapPressed && this.stamina > 6) {
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      this.perched = false
      this.grounded = false
      this.vel.set(fx * 4.5, 6.2, fz * 4.5)
      this.pos.y += 0.3
      this.pitch = 0.45
      this.stamina -= 8 * this.profile.staminaUse
      this.flapPhase = 0.0001
      this.airborneTime = 0
      events.push({ type: 'takeoff' }, { type: 'flap', power: 1.3 })
    }
    this.updateBasis()
  }

  private stepGround(dt: number, inp: FlightInput, surface: number, events: FlightEvent[]): void {
    this.airspeed = 0
    this.stalled = false
    this.yaw += inp.bank * 1.7 * dt
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const walk = inp.pitch < 0 ? 2.1 : inp.pitch > 0 ? -1.0 : 0
    this.vel.set(fx * walk, 0, fz * walk)
    this.pos.addScaledVector(this.vel, dt)
    this.pos.y = surface + BELLY
    this.pitch += (0 - this.pitch) * Math.min(1, 6 * dt)
    this.roll += (0 - this.roll) * Math.min(1, 6 * dt)
    this.stamina = Math.min(CONFIG.stamina.max, this.stamina + CONFIG.stamina.restRecover * this.profile.recovery * dt)
    this.flapPhase = 0
    this.flapping = false
    if (inp.flapPressed && this.stamina > 6) {
      this.grounded = false
      this.vel.set(fx * 4.5, 6.2, fz * 4.5)
      this.pos.y += 0.3
      this.pitch = 0.45
      this.stamina -= 8 * this.profile.staminaUse
      this.flapPhase = 0.0001
      this.airborneTime = 0
      events.push({ type: 'takeoff' })
      events.push({ type: 'flap', power: 1.3 })
    }
    this.updateBasis()
  }
}
