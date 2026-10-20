import * as THREE from 'three'

// ============================================================================
// Tipos públicos
// ============================================================================

export type SkyPhase =
  | 'night'        // sol < -18°
  | 'astronomical' // -18° a -12°
  | 'nautical'     // -12° a -6°
  | 'blueHour'     // -6° a -0.5°
  | 'goldenHour'   // -0.5° a 6°
  | 'day'          // > 6°

export type SkyState = {
  // ---- Sol / lua ----
  sunDir: THREE.Vector3
  moonDir: THREE.Vector3
  sunSin: number
  moonSin: number
  sunAltitudeDeg: number
  sunAzimuthDeg: number
  moonPhase: number           // 0 = nova, 0.5 = cheia, 1 = nova
  moonIllum: number           // 0..1 fração iluminada
  sunAngularRadius: number    // rad (~0.0047, real é 0.27°)
  sunGlowSize: number         // rad (~0.5, halo difuso)

  // ---- Céu ----
  zenith: THREE.Color
  horizon: THREE.Color
  horizonGlow: THREE.Color    // brilho extra laranja perto do sol
  earthShadow: THREE.Color    // sombra da Terra (crepúsculo)
  beltOfVenus: THREE.Color    // banda rosa-púrpura anti-solar

  // ---- Sol ----
  sunColor: THREE.Color
  sunGlow: THREE.Color        // cor do halo/corona

  // ---- Atmosfera / neblina ----
  fog: THREE.Color
  fogDensity: number
  hazeTint: THREE.Color

  // ---- Iluminação ----
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  ambientTint: THREE.Color
  sunIntensity: number
  hemiIntensity: number
  moonIntensity: number
  moonColor: THREE.Color

  // ---- Nuvens ----
  cloudLit: THREE.Color
  cloudDark: THREE.Color
  cloudShadow: THREE.Color
  cloudShadowOffset: THREE.Vector2
  cloudCover: number          // 0..1
  cloudAltitude: number       // metros
  cloudOpacity: number        // 0..1
  cloudShadowStrength: number // 0..1

  // ---- Noite ----
  starDensity: number         // 0..1
  starBrightness: number      // 0..1
  milkyWay: number            // 0..1
  lightPollution: number      // 0..1

  // ---- Pós-processamento ----
  exposure: number
  whiteBalance: THREE.Color
  saturation: number
  contrast: number
  bloomIntensity: number
  bloomThreshold: number
  vignette: number

  // ---- Derivados ----
  daylight: number
  night: number
  twilight: number
  phase: SkyPhase
}

export type SkyOptions = {
  /** Latitude em graus. Padrão: 20 (tropical, LA-like). Negativo = sul. */
  latitude?: number
  /** Dia do ano (1–365). Padrão: 81 (equinócio, 6h/18h exatos). */
  dayOfYear?: number
  /** Poluição luminosa 0..1. Padrão: 0.15. */
  cityGlow?: number
}

const DEFAULT_OPTS: Required<SkyOptions> = {
  latitude: 20,
  dayOfYear: 81,
  cityGlow: 0.15,
}

// ============================================================================
// Helpers
// ============================================================================

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

const _a = new THREE.Color()
const _b = new THREE.Color()

const mixArr = (
  out: THREE.Color,
  a: readonly number[],
  b: readonly number[],
  t: number,
): THREE.Color => {
  out.setRGB(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    THREE.LinearSRGBColorSpace,
  )
  return out
}

const setLinear = (out: THREE.Color, r: number, g: number, b: number): THREE.Color =>
  out.setRGB(r, g, b, THREE.LinearSRGBColorSpace)

// ============================================================================
// Astronomia: posição solar real
// ============================================================================

/**
 * Declinação solar em radianos para um dado dia do ano (1–365).
 * Aproximação de Cooper (1989).
 */
function solarDeclination(dayOfYear: number): number {
  return (23.44 * DEG2RAD) * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365)
}

/**
 * Calcula o vetor direção do sol (apontando do observador para o sol) em coords Three.js:
 *   +X = leste, +Y = zênite, -Z = norte
 * Retorna o seno da altitude.
 */
function computeSunDir(
  latitudeDeg: number,
  dayOfYear: number,
  hour: number,
  out: THREE.Vector3,
): number {
  const latRad = latitudeDeg * DEG2RAD
  const dec = solarDeclination(dayOfYear)
  const H = ((hour - 12) * Math.PI) / 12 // ângulo horário

  const sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(H)
  const cosAlt = Math.sqrt(Math.max(0, 1 - sinAlt * sinAlt))

  const az = Math.atan2(
    -Math.sin(H) * Math.cos(dec),
    Math.sin(dec) * Math.cos(latRad) - Math.cos(dec) * Math.sin(latRad) * Math.cos(H),
  )

  out.set(
    Math.sin(az) * cosAlt,
    sinAlt,
    -Math.cos(az) * cosAlt,
  )
  return sinAlt
}

/** Hora local do nascer do sol para a latitude/dia dados. -1 se não houver. */
function sunriseHour(latDeg: number, dayOfYear: number): number {
  const latRad = latDeg * DEG2RAD
  const dec = solarDeclination(dayOfYear)
  const cosH = -Math.tan(latRad) * Math.tan(dec)
  if (cosH > 1 || cosH < -1) return -1
  const H = Math.acos(cosH) * (12 / Math.PI)
  return 12 - H
}

/** Hora local do pôr-do-sol. -1 se não houver. */
function sunsetHour(latDeg: number, dayOfYear: number): number {
  const sr = sunriseHour(latDeg, dayOfYear)
  return sr < 0 ? -1 : 24 - sr
}

/**
 * Direção da lua: segue a mesma eclíptica do sol, mas com elongação = fase * 2π.
 * Nova (fase 0): junto ao sol. Cheia (fase 0.5): oposta ao sol.
 */
function computeMoonDir(
  latDeg: number,
  dayOfYear: number,
  hour: number,
  lunarPhase: number,
  out: THREE.Vector3,
): number {
  const elongation = lunarPhase * Math.PI * 2
  const H = ((hour - 12) * Math.PI) / 12 - elongation // HA da lua = HA do sol - elongação
  const latRad = latDeg * DEG2RAD
  const dec = solarDeclination(dayOfYear)

  const sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(H)
  const cosAlt = Math.sqrt(Math.max(0, 1 - sinAlt * sinAlt))
  const az = Math.atan2(
    -Math.sin(H) * Math.cos(dec),
    Math.sin(dec) * Math.cos(latRad) - Math.cos(dec) * Math.sin(latRad) * Math.cos(H),
  )
  out.set(Math.sin(az) * cosAlt, sinAlt, -Math.cos(az) * cosAlt)
  return sinAlt
}

// ============================================================================
// Tabela de stops por seno da elevação solar
// ============================================================================
// Colors em RGB linear. Valores de céu podem passar de 1 (HDR-friendly para bloom).
// A coluna `glow` é o brilho extra ao redor do sol (halo atmosférico).
type Stop = {
  s: number
  zenith: [number, number, number]
  horizon: [number, number, number]
  glow: [number, number, number]  // horizonGlow perto do sol
  bv: [number, number, number]     // belt of Venus (anti-solar)
  sun: [number, number, number]
  sunGlow: [number, number, number]
  sunInt: number
  hemi: number
  exp: number
}

const STOPS: Stop[] = [
  // ============ NOITE PROFUNDA ============
  { s: -1.0,
    zenith:  [0.0025, 0.0040, 0.0120],
    horizon: [0.0080, 0.0100, 0.0220],
    glow:    [0.0000, 0.0000, 0.0000],
    bv:      [0.0000, 0.0000, 0.0000],
    sun:     [0.20, 0.22, 0.30], sunGlow: [0.02, 0.03, 0.06],
    sunInt: 0, hemi: 0.22, exp: 1.45 },
  // ============ FIM DO CREPÚSCULO ASTRONÔMICO ============
  { s: -0.50,
    zenith:  [0.0050, 0.0100, 0.0350],
    horizon: [0.0250, 0.0280, 0.0600],
    glow:    [0.0200, 0.0100, 0.0100],
    bv:      [0.0100, 0.0050, 0.0150],
    sun:     [0.30, 0.22, 0.25], sunGlow: [0.05, 0.04, 0.06],
    sunInt: 0, hemi: 0.28, exp: 1.38 },
  // ============ TWILIGHT ASTRONÔMICO ============
  { s: -0.30,
    zenith:  [0.0120, 0.0250, 0.0700],
    horizon: [0.0800, 0.0700, 0.1300],
    glow:    [0.1500, 0.0600, 0.0400],
    bv:      [0.0500, 0.0300, 0.0700],
    sun:     [0.50, 0.28, 0.20], sunGlow: [0.15, 0.08, 0.06],
    sunInt: 0.02, hemi: 0.34, exp: 1.30 },
  // ============ NAUTICAL TWILIGHT ============
  { s: -0.18,
    zenith:  [0.0250, 0.0500, 0.1400],
    horizon: [0.1800, 0.1400, 0.2000],
    glow:    [0.5000, 0.2000, 0.1000],
    bv:      [0.1800, 0.1000, 0.1800],
    sun:     [0.70, 0.32, 0.16], sunGlow: [0.35, 0.15, 0.08],
    sunInt: 0.10, hemi: 0.40, exp: 1.24 },
  // ============ INÍCIO DO BLUE HOUR ============
  { s: -0.10,
    zenith:  [0.0500, 0.1000, 0.2500],
    horizon: [0.3500, 0.2400, 0.2800],
    glow:    [0.9000, 0.3500, 0.1500],
    bv:      [0.3200, 0.1800, 0.2800],
    sun:     [0.90, 0.38, 0.16], sunGlow: [0.55, 0.25, 0.12],
    sunInt: 0.40, hemi: 0.46, exp: 1.16 },
  // ============ BLUE HOUR / MAGENTA PEAK ============
  { s: -0.035,
    zenith:  [0.0700, 0.1400, 0.3600],
    horizon: [0.5500, 0.3200, 0.3200],
    glow:    [1.1000, 0.4500, 0.1800],
    bv:      [0.5000, 0.2800, 0.3600],
    sun:     [1.00, 0.44, 0.16], sunGlow: [0.75, 0.35, 0.15],
    sunInt: 0.75, hemi: 0.52, exp: 1.10 },
  // ============ NASCER / PÔR DO SOL (horizonte) ============
  { s: 0.0,
    zenith:  [0.0900, 0.1900, 0.4800],
    horizon: [0.9500, 0.4500, 0.2200],
    glow:    [1.3000, 0.5500, 0.2000],
    bv:      [0.4200, 0.3000, 0.3800],
    sun:     [1.00, 0.48, 0.18], sunGlow: [1.00, 0.50, 0.20],
    sunInt: 1.20, hemi: 0.58, exp: 1.05 },
  // ============ GOLDEN HOUR ============
  { s: 0.05,
    zenith:  [0.1100, 0.2200, 0.5500],
    horizon: [1.0000, 0.6200, 0.3500],
    glow:    [1.2000, 0.7500, 0.3500],
    bv:      [0.3000, 0.2600, 0.4000],
    sun:     [1.00, 0.64, 0.28], sunGlow: [1.00, 0.65, 0.30],
    sunInt: 1.90, hemi: 0.68, exp: 1.00 },
  // ============ MANHÃ / TARDE DOURADA ============
  { s: 0.15,
    zenith:  [0.1000, 0.2500, 0.6000],
    horizon: [0.8500, 0.7200, 0.6000],
    glow:    [1.0000, 0.8500, 0.5500],
    bv:      [0.2200, 0.2200, 0.3600],
    sun:     [1.00, 0.80, 0.55], sunGlow: [0.95, 0.80, 0.60],
    sunInt: 2.50, hemi: 0.78, exp: 0.98 },
  // ============ MEIO DA MANHÃ ============
  { s: 0.35,
    zenith:  [0.0900, 0.2600, 0.6500],
    horizon: [0.6500, 0.7400, 0.8800],
    glow:    [0.9000, 0.8800, 0.8000],
    bv:      [0.1800, 0.2000, 0.3200],
    sun:     [1.00, 0.90, 0.78], sunGlow: [0.90, 0.85, 0.75],
    sunInt: 3.00, hemi: 0.86, exp: 0.95 },
  // ============ MANHÃ TARDIA ============
  { s: 0.60,
    zenith:  [0.0700, 0.2200, 0.6200],
    horizon: [0.5500, 0.7200, 0.9200],
    glow:    [0.8500, 0.8800, 0.9500],
    bv:      [0.1600, 0.1900, 0.3000],
    sun:     [1.00, 0.94, 0.86], sunGlow: [0.90, 0.90, 0.85],
    sunInt: 3.30, hemi: 0.90, exp: 0.92 },
  // ============ MEIO-DIA ============
  { s: 0.95,
    zenith:  [0.0600, 0.2000, 0.5800],
    horizon: [0.5200, 0.7000, 0.9400],
    glow:    [0.8000, 0.8500, 0.9500],
    bv:      [0.1500, 0.1800, 0.2900],
    sun:     [1.00, 0.96, 0.90], sunGlow: [0.90, 0.92, 0.88],
    sunInt: 3.50, hemi: 0.95, exp: 0.90 },
]

// ============================================================================
// Estado inicial
// ============================================================================

export const createSkyState = (): SkyState => ({
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, -1, 0),
  sunSin: 1,
  moonSin: 0,
  sunAltitudeDeg: 90,
  sunAzimuthDeg: 0,
  moonPhase: 0,
  moonIllum: 0,
  sunAngularRadius: 0.0047,
  sunGlowSize: 0.55,

  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  horizonGlow: new THREE.Color(),
  earthShadow: new THREE.Color(),
  beltOfVenus: new THREE.Color(),

  sunColor: new THREE.Color(),
  sunGlow: new THREE.Color(),

  fog: new THREE.Color(),
  fogDensity: 0.002,
  hazeTint: new THREE.Color(),

  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  ambientTint: new THREE.Color(),
  sunIntensity: 0,
  hemiIntensity: 0.5,
  moonIntensity: 0,
  moonColor: new THREE.Color(),

  cloudLit: new THREE.Color(),
  cloudDark: new THREE.Color(),
  cloudShadow: new THREE.Color(),
  cloudShadowOffset: new THREE.Vector2(0, 0),
  cloudCover: 0.35,
  cloudAltitude: 1500,
  cloudOpacity: 0.85,
  cloudShadowStrength: 0.25,

  starDensity: 0,
  starBrightness: 1,
  milkyWay: 0,
  lightPollution: 0,

  exposure: 1,
  whiteBalance: new THREE.Color(1, 1, 1),
  saturation: 1,
  contrast: 1,
  bloomIntensity: 0.3,
  bloomThreshold: 0.9,
  vignette: 0.15,

  daylight: 1,
  night: 0,
  twilight: 0,
  phase: 'day',
})

// ============================================================================
// Função principal
// ============================================================================

/**
 * Calcula o estado completo do céu para uma hora decimal (0–24).
 *
 * @example
 * const sky = createSkyState()
 * skyAt(18.2, sky) // pôr-do-sol dramático
 */
export function skyAt(hour: number, out: SkyState, opts: SkyOptions = {}): SkyState {
  const latitude = opts.latitude ?? DEFAULT_OPTS.latitude
  const dayOfYear = opts.dayOfYear ?? DEFAULT_OPTS.dayOfYear
  const cityGlow = opts.cityGlow ?? DEFAULT_OPTS.cityGlow

  const h = ((hour % 24) + 24) % 24

  // ---- Sol ----
  out.sunSin = computeSunDir(latitude, dayOfYear, h, out.sunDir)
  out.sunAltitudeDeg = Math.asin(clamp(out.sunSin, -1, 1)) * RAD2DEG
  out.sunAzimuthDeg = Math.atan2(out.sunDir.x, -out.sunDir.z) * RAD2DEG

  // ---- Lua ----
  // Ciclo lunar simplificado (29.53 dias)
  const lunarCycle = 29.530588
  // Fase 0 = nova, 0.5 = cheia; deslocamento para começar nova em dayOfYear=0
  out.moonPhase = (((dayOfYear / lunarCycle) % 1) + 1) % 1
  out.moonIllum = (1 - Math.cos(out.moonPhase * Math.PI * 2)) / 2
  out.moonSin = computeMoonDir(latitude, dayOfYear, h, out.moonPhase, out.moonDir)

  // ---- Interpolação dos stops ----
  const s = out.sunSin
  let i = 0
  while (i < STOPS.length - 2 && s > STOPS[i + 1].s) i += 1
  const A = STOPS[i]
  const B = STOPS[i + 1]
  const t = clamp((s - A.s) / (B.s - A.s), 0, 1)
  // Smoothstep para transições mais naturais
  const ts = t * t * (3 - 2 * t)

  mixArr(out.zenith, A.zenith, B.zenith, ts)
  mixArr(out.horizon, A.horizon, B.horizon, ts)
  mixArr(out.horizonGlow, A.glow, B.glow, ts)
  mixArr(out.beltOfVenus, A.bv, B.bv, ts)
  mixArr(out.sunColor, A.sun, B.sun, ts)
  mixArr(out.sunGlow, A.sunGlow, B.sunGlow, ts)

  out.sunIntensity = lerp(A.sunInt, B.sunInt, ts)
  out.hemiIntensity = lerp(A.hemi, B.hemi, ts)
  out.exposure = lerp(A.exp, B.exp, ts)

  // ---- Fase ----
  const alt = out.sunAltitudeDeg
  if (alt < -18) out.phase = 'night'
  else if (alt < -12) out.phase = 'astronomical'
  else if (alt < -6) out.phase = 'nautical'
  else if (alt < -0.5) out.phase = 'blueHour'
  else if (alt < 6) out.phase = 'goldenHour'
  else out.phase = 'day'

  // ---- Fatores derivados ----
  out.daylight = sstep(-0.05, 0.30, s)
  out.night = 1 - sstep(-0.32, -0.02, s)
  out.twilight = (1 - out.daylight) * (1 - out.night)

  // Fator "pôr-do-sol" — 1 no crepúsculo, 0 ao meio-dia
  const sunsetFactor = 1 - sstep(0.10, 0.50, s)

  // ---- Belt of Venus (banda anti-solar ao crepúsculo) ----
  // Só existe no crepúsculo civil, decai para 0 fora dele
  const bvStrength = sstep(-0.18, -0.02, s) * (1 - sstep(0.02, 0.15, s))
  out.beltOfVenus.multiplyScalar(bvStrength * 1.4)

  // ---- Earth shadow (sombra da Terra abaixo do horizonte) ----
  setLinear(out.earthShadow, 0.04, 0.03, 0.06).multiplyScalar(sstep(-0.15, 0.0, s) * (1 - sstep(0.02, 0.12, s)))

  // ---- Fog ----
  out.fog.copy(out.horizon).lerp(out.sunColor, 0.12 + sunsetFactor * 0.28)
  // Density: alta no crepúsculo e à noite, baixa ao meio-dia
  out.fogDensity = 0.0012 + 0.0018 * sunsetFactor + 0.0010 * out.night
  out.hazeTint.copy(out.horizon).lerp(out.sunColor, 0.35).lerp(_a.setRGB(0.5, 0.55, 0.7, THREE.LinearSRGBColorSpace), out.night * 0.4)

  // ---- Hemisphere light ----
  out.hemiSky.copy(out.zenith).lerp(out.horizon, 0.60).multiplyScalar(1.35)
  // Noite: puxa para azul profundo
  out.hemiSky.lerp(setLinear(_a, 0.10, 0.16, 0.35), out.night * 0.70)
  setLinear(out.hemiGround, 0.14, 0.12, 0.08).multiplyScalar(0.25 + out.daylight * 0.75)
  out.ambientTint.copy(out.hemiSky).multiplyScalar(0.5)

  // ---- Lua ----
  const moonUp = Math.max(0, out.moonSin)
  out.moonIntensity = 0.75 * out.night * moonUp * out.moonIllum
  setLinear(out.moonColor, 0.85, 0.90, 1.00)

  // ---- Nuvens ----
  // Nuvens iluminadas pelo sol, sombreadas pelo céu oposto
  out.cloudLit.copy(out.sunColor).lerp(setLinear(_a, 1, 1, 1), 0.40)
    .multiplyScalar(0.12 + 0.88 * out.daylight)
  out.cloudDark.copy(out.horizon).lerp(out.zenith, 0.40)
    .multiplyScalar(0.12 + out.daylight * 0.88)
  // Nuvens à noite: ligeiramente azuladas
  out.cloudDark.lerp(setLinear(_a, 0.04, 0.05, 0.12), out.night * 0.55)
  out.cloudShadow.copy(out.cloudDark).multiplyScalar(0.55)
  // Sombra das nuvens projetada no chão, deslocada na direção do sol
  const shadowOffsetDist = 800
  const shadowScale = out.sunDir.y > 0.1 ? shadowOffsetDist / out.sunDir.y : 0
  out.cloudShadowOffset.set(
    -out.sunDir.x * shadowScale * 0.15,
    -out.sunDir.z * shadowScale * 0.15,
  )
  out.cloudShadowStrength = 0.35 * out.daylight * (1 - sstep(0.65, 0.95, out.sunDir.y))
  out.cloudAltitude = 1500
  out.cloudOpacity = 0.85
  // Cobertura de nuvens: nós controlamos via campo separado,
  // mas deixamos um default coerente (pode ser sobrescrito externamente)
  out.cloudCover = 0.35

  // ---- Estrelas e Via Láctea ----
  out.starDensity = (1 - out.daylight) * (1 - out.cloudCover * 0.85) * (1 - out.lightPollution)
  out.starBrightness = 0.85 + 0.15 * out.night
  out.milkyWay = 0.55 * out.starDensity * (1 - out.lightPollution * 0.8)

  // ---- Poluição luminosa (noite urbana) ----
  out.lightPollution = cityGlow * out.night
  if (out.lightPollution > 0.01) {
    // Laranja quente no horizonte (sódio/lâmpadas)
    setLinear(_a, 0.18, 0.09, 0.03)
    out.horizon.lerp(_a, out.lightPollution * 0.55)
    out.fog.lerp(_a, out.lightPollution * 0.40)
    out.hemiSky.lerp(setLinear(_a, 0.20, 0.13, 0.08), out.lightPollution * 0.25)
    // Reduz estrelas perto do horizonte
    out.starDensity *= 1 - out.lightPollution * 0.55
  }

  // ---- Pós-processamento (look GTA) ----
  // White balance: quente no golden hour, frio no blue hour, neutro ao meio-dia
  if (out.phase === 'goldenHour') {
    setLinear(out.whiteBalance, 1.06, 1.00, 0.93) // shift quente
  } else if (out.phase === 'blueHour' || out.phase === 'nautical') {
    setLinear(out.whiteBalance, 0.94, 0.98, 1.07) // shift frio/azul
  } else if (out.phase === 'astronomical' || out.phase === 'night') {
    setLinear(out.whiteBalance, 0.92, 0.96, 1.10) // noite azulada
  } else {
    setLinear(out.whiteBalance, 1.00, 1.00, 1.00)
  }

  // Saturação: mais dramática no crepúsculo (GTA)
  out.saturation = 1.00 + 0.22 * out.twilight + 0.08 * out.night
  // Contraste: um pouco mais duro ao dia (sol pleno), suave à noite
  out.contrast = 1.04 + 0.10 * out.daylight + 0.04 * (1 - out.daylight)

  // Bloom: mais forte ao entardecer e à noite
  out.bloomIntensity =
    0.30
    + 0.35 * out.twilight
    + 0.40 * out.night
    + (out.phase === 'goldenHour' ? 0.15 : 0)
  out.bloomThreshold = 0.92 - 0.18 * out.night - 0.06 * out.twilight

  // Vinheta: sutil durante o dia, forte à noite
  out.vignette = 0.12 + 0.10 * out.night + 0.05 * out.twilight

  return out
}

// ============================================================================
// Helpers de modo
// ============================================================================

/**
 * Hora do dia para cada modo de tempo; "auto" avança com o relógio.
 * Os modos "goldenHour" e "blueHour" são novos e usam astronomia real.
 */
export function hourForMode(
  mode: string,
  autoHour: number,
  opts: SkyOptions = {},
): number {
  const latitude = opts.latitude ?? DEFAULT_OPTS.latitude
  const dayOfYear = opts.dayOfYear ?? DEFAULT_OPTS.dayOfYear

  switch (mode) {
    case 'dawn': {
      const sr = sunriseHour(latitude, dayOfYear)
      return sr >= 0 ? sr + 0.35 : 6.35
    }
    case 'noon':
      return 12.2
    case 'dusk': {
      const ss = sunsetHour(latitude, dayOfYear)
      return ss >= 0 ? ss - 0.35 : 17.45
    }
    case 'night':
      return 23.0
    case 'goldenHour': {
      const ss = sunsetHour(latitude, dayOfYear)
      return ss >= 0 ? ss - 1.20 : 16.80
    }
    case 'blueHour': {
      const ss = sunsetHour(latitude, dayOfYear)
      return ss >= 0 ? ss + 0.30 : 18.30
    }
    default:
      return autoHour
  }
}
