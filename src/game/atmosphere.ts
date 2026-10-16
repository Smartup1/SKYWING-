import * as THREE from 'three'
import { CONFIG } from './config'
import { fbm, gradientAt, hash2, heightAt, noise2, smoothstep, WATER_LEVEL } from './terrain'

export type Thermal = { x: number; z: number; radius: number; strength: number; phase: number }

/** Colunas de ar quente sobre campos secos e claros, fixas e determinísticas. */
export function buildThermals(): Thermal[] {
  const out: Thermal[] = []
  const cell = 280
  for (let i = -5; i <= 5; i += 1) {
    for (let j = -5; j <= 5; j += 1) {
      if (hash2(i, j, 71) < 0.45) continue
      const x = (i + 0.2 + hash2(i, j, 72) * 0.6) * cell
      const z = (j + 0.2 + hash2(i, j, 73) * 0.6) * cell
      const h = heightAt(x, z)
      if (h < 4 || h > 90 || Math.hypot(x, z) > 1250) continue
      out.push({ x, z, radius: 42 + hash2(i, j, 74) * 34, strength: 0.7 + hash2(i, j, 75) * 0.6, phase: hash2(i, j, 76) * 6.28 })
    }
  }
  return out
}

const grad = { x: 0, z: 0 }

/**
 * Massa de ar: vento base, rajadas, correntes ascendentes de encosta, térmicas e um vento de
 * fronteira que devolve o pássaro ao vale. Tudo é função pura de posição e tempo.
 */
export class Atmosphere {
  readonly thermals = buildThermals()
  time = 0
  /** Direção (rad) e intensidade (m/s) do vento horizontal, para o HUD. */
  windAngle = 0
  windSpeed = 0

  update(dt: number): void {
    this.time += dt
    const t = this.time
    this.windAngle = 0.7 + 0.35 * Math.sin(t * 0.011) + 0.2 * Math.sin(t * 0.0037 + 1)
    this.windSpeed = CONFIG.wind.speed * (0.85 + 0.35 * noise2(t * 0.02, 3.3))
  }

  /** Velocidade do ar (m/s) no ponto dado. */
  sample(out: THREE.Vector3, x: number, y: number, z: number): void {
    const t = this.time
    const gust = 1 + CONFIG.wind.gust * noise2(t * 0.35 + x * 0.004, z * 0.004 + 9)
    const w = this.windSpeed * gust
    const dx = Math.cos(this.windAngle)
    const dz = Math.sin(this.windAngle)
    out.set(dx * w, 0, dz * w)
    const ground = Math.max(heightAt(x, z), WATER_LEVEL)
    const agl = y - ground
    // Sustentação de encosta: o vento sobe a barlavento e desce a sotavento.
    if (agl < 110) {
      gradientAt(grad, x, z)
      const ridge = (grad.x * dx + grad.z * dz) * w * CONFIG.wind.ridgeLift * 3
      out.y += THREE.MathUtils.clamp(ridge, -2.5, 5.5) * (1 - smoothstep(30, 110, agl))
    }
    // Térmicas.
    for (const th of this.thermals) {
      const ddx = x - th.x
      const ddz = z - th.z
      const d2 = ddx * ddx + ddz * ddz
      const r = th.radius
      if (d2 > r * r * 2.2) continue
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.3 + th.phase)
      const heightProfile = smoothstep(14, 50, agl) * (1 - smoothstep(250, 340, agl))
      const core = Math.max(0, 1 - d2 / (r * r))
      const lift = CONFIG.wind.thermalStrength * th.strength * pulse * core * Math.sqrt(core)
      const sink = d2 > r * r ? -0.9 * (1 - (Math.sqrt(d2) - r) / (r * 0.48)) : 0
      out.y += (lift + sink * 0.3) * heightProfile
    }
    // Vento de fronteira.
    const rr = Math.hypot(x, z)
    if (rr > CONFIG.world.softRadius) {
      const k = (rr - CONFIG.world.softRadius) / (CONFIG.world.hardRadius - CONFIG.world.softRadius)
      const push = 16 * Math.min(1.4, k * k + k * 0.3)
      out.x += (-x / rr) * push
      out.z += (-z / rr) * push
    }
  }

  /** Intensidade de térmica (0–1) mais próxima; usado em HUD e áudio. */
  thermalAt(x: number, z: number): Thermal | null {
    let best: Thermal | null = null
    let bestK = 0
    for (const th of this.thermals) {
      const k = 1 - Math.hypot(x - th.x, z - th.z) / th.radius
      if (k > bestK) {
        bestK = k
        best = th
      }
    }
    return best
  }
}

/** Ruído de baixa frequência para variações lentas (nuvens, cor do céu). */
export const slowNoise = (t: number, seed: number) => fbm(t * 0.01, seed, 2, seed | 0)
