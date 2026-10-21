/**
 * Terreno procedural puro e determinístico: a mesma função alimenta a malha, a colisão com o solo,
 * a vegetação, o vento de encosta e as térmicas. Nada aqui depende de three.js ou do DOM.
 */
export const WATER_LEVEL = 0
export const LAKE = { x: -190, z: 270, rx: 330, rz: 250 }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Hash inteiro estável em [0, 1). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Ruído de valor suave em [-1, 1]. */
export function noise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return mix(mix(a, b, ux), mix(c, d, ux), uz) * 2 - 1
}

export function fbm(x: number, z: number, octaves: number, seed = 0): number {
  let amp = 0.5
  let f = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    // Rotação leve por oitava para esconder o alinhamento aos eixos do ruído de valor.
    const rx = x * f * 0.9553 - z * f * 0.2955 + i * 11.3
    const rz = x * f * 0.2955 + z * f * 0.9553 - i * 7.1
    sum += amp * noise2(rx, rz, seed + i * 17)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

const ridged = (x: number, z: number, octaves: number, seed: number) => {
  let amp = 0.55
  let f = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(noise2(x * f + i * 5.7, z * f - i * 3.3, seed + i * 31))
    sum += amp * n * n
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return sum / norm
}

/** Curva do rio (x em função de z). */
export const riverX = (z: number) => -330 + 240 * Math.sin(z * 0.0016 + 0.5) + 90 * Math.sin(z * 0.0041)

/** Altura do terreno em metros (nível da água = 0). */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const wx = x + 120 * fbm(x * 0.0007 + 3.1, z * 0.0007, 2, 5)
  const wz = z + 120 * fbm(x * 0.0007, z * 0.0007 + 8.4, 2, 9)
  const continental = fbm(wx * 0.0011, wz * 0.0011, 4, 1)
  let h = continental * 30 + 20
  // Vale calmo no centro, montanhas ao redor.
  const valley = smoothstep(120, 900, r)
  h = mix(h * 0.5, h, valley)
  const mask = smoothstep(650, 1500, r) * (0.55 + 0.45 * smoothstep(-0.2, 0.5, fbm(x * 0.0009 + 20, z * 0.0009, 2, 3)))
  const peaks = ridged(wx * 0.0017 + 7, wz * 0.0017, 5, 11)
  h += Math.pow(peaks, 1.5) * 300 * mask + 70 * mask
  // Lago.
  const dl = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz)
  const lake = 1 - smoothstep(0.55, 1.12, dl)
  h = mix(h, -9 + 3 * fbm(x * 0.01, z * 0.01, 2, 21), lake * lake * (3 - 2 * lake))
  // Rio.
  const dr = Math.abs(x - riverX(z)) + 20 * noise2(z * 0.008, 0, 4)
  const river = (1 - smoothstep(10, 52, dr)) * (1 - smoothstep(1100, 1450, Math.abs(z)))
  h = mix(h, -3.2, river * river * (3 - 2 * river) * 0.96)
  // Relevo fino (colinas pequenas, grama alta, pedras).
  h += 2.4 * fbm(x * 0.021, z * 0.021, 3, 31) + 0.35 * fbm(x * 0.1, z * 0.1, 2, 41)
  return h
}

/** Superfície sobre a qual o pássaro pousa: terreno ou água. */
export const surfaceAt = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL)

export function slopeAt(x: number, z: number, d = 2.5): number {
  const gx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d)
  const gz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d)
  return Math.hypot(gx, gz)
}

export function gradientAt(out: { x: number; z: number }, x: number, z: number, d = 6): void {
  out.x = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d)
  out.z = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d)
}

/** Cor linear do solo por altitude, declive e umidade. */
export function groundColor(x: number, z: number, h: number, slope: number, out: [number, number, number]): void {
  const moisture = fbm(x * 0.0035 + 40, z * 0.0035, 3, 7) * 0.5 + 0.5
  const patch = fbm(x * 0.03, z * 0.03, 2, 13) * 0.5 + 0.5
  // Gramado: do verde-vivo ao capim seco.
  let r = mix(0.2, 0.085, moisture) * (0.8 + 0.4 * patch)
  let g = mix(0.17, 0.2, moisture) * (0.8 + 0.4 * patch)
  let b = mix(0.04, 0.03, moisture)
  // Margem: areia molhada.
  const shore = 1 - smoothstep(0.4, 2.8, h)
  r = mix(r, 0.37, shore)
  g = mix(g, 0.3, shore)
  b = mix(b, 0.16, shore)
  // Fundo: lodo azulado e escuro.
  const deep = smoothstep(0.5, 7, -h)
  r = mix(r, 0.015, deep)
  g = mix(g, 0.07, deep)
  b = mix(b, 0.095, deep)
  // Rocha nas encostas e cumes.
  const rock = Math.max(smoothstep(0.5, 0.95, slope), smoothstep(110, 190, h) * 0.7)
  const rs = 0.8 + 0.4 * fbm(x * 0.05, z * 0.05, 2, 3)
  r = mix(r, 0.2 * rs, rock)
  g = mix(g, 0.18 * rs, rock)
  b = mix(b, 0.16 * rs, rock)
  // Neve nos picos.
  const snow = smoothstep(215, 262, h + 14 * fbm(x * 0.01, z * 0.01, 2, 8)) * (1 - smoothstep(1.0, 1.7, slope))
  r = mix(r, 0.85, snow)
  g = mix(g, 0.87, snow)
  b = mix(b, 0.92, snow)
  out[0] = r
  out[1] = g
  out[2] = b
}

/** Densidade de floresta em [0, 1] (0 = campo aberto). */
export function forestDensity(x: number, z: number, h: number, slope: number): number {
  if (h < 1.6 || slope > 0.62 || h > 150) return 0
  const clump = fbm(x * 0.0042 + 100, z * 0.0042, 3, 55)
  const edge = smoothstep(-0.12, 0.22, clump)
  const fade = 1 - smoothstep(110, 150, h)
  return edge * fade
}

/** Proporção de coníferas (altitudes maiores) em [0, 1]. */
export const coniferShare = (h: number, x: number, z: number) =>
  clamp(smoothstep(35, 110, h) * 0.9 + 0.35 * (fbm(x * 0.01, z * 0.01, 2, 91) * 0.5 + 0.5) - 0.2, 0, 1)

/** Cumes mais altos encontrados numa grade grossa (para o ponto de interesse "pico"). */
export function findSummit(): { x: number; z: number; h: number } {
  let best = { x: 0, z: 0, h: -Infinity }
  for (let x = -1300; x <= 1300; x += 40) {
    for (let z = -1300; z <= 1300; z += 40) {
      const h = heightAt(x, z)
      if (h > best.h) best = { x, z, h }
    }
  }
  return best
}
