import * as THREE from 'three'

export type SkyState = {
  sunDir: THREE.Vector3
  moonDir: THREE.Vector3
  /** Seno da elevação do sol (-1..1). */
  sunSin: number
  zenith: THREE.Color
  horizon: THREE.Color
  sunColor: THREE.Color
  fog: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  cloudLit: THREE.Color
  cloudDark: THREE.Color
  sunIntensity: number
  hemiIntensity: number
  moonIntensity: number
  daylight: number
  night: number
  exposure: number
}

export const createSkyState = (): SkyState => ({
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, -1, 0),
  sunSin: 1,
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  sunColor: new THREE.Color(),
  fog: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  cloudLit: new THREE.Color(),
  cloudDark: new THREE.Color(),
  sunIntensity: 0,
  hemiIntensity: 0.5,
  moonIntensity: 0,
  daylight: 1,
  night: 0,
  exposure: 1,
})

type Stop = { s: number; zenith: number[]; horizon: number[]; sun: number[]; sunInt: number; hemi: number; exposure: number }
// Paradas por seno da elevação solar. Cores lineares.
const STOPS: Stop[] = [
  { s: -0.3, zenith: [0.004, 0.008, 0.028], horizon: [0.014, 0.024, 0.055], sun: [0.1, 0.12, 0.25], sunInt: 0, hemi: 0.34, exposure: 1.25 },
  { s: -0.08, zenith: [0.02, 0.03, 0.1], horizon: [0.1, 0.07, 0.12], sun: [0.6, 0.2, 0.15], sunInt: 0, hemi: 0.4, exposure: 1.2 },
  { s: 0.0, zenith: [0.06, 0.1, 0.28], horizon: [0.85, 0.3, 0.14], sun: [1.0, 0.36, 0.14], sunInt: 0.9, hemi: 0.45, exposure: 1.1 },
  { s: 0.12, zenith: [0.09, 0.19, 0.5], horizon: [0.9, 0.52, 0.34], sun: [1.0, 0.6, 0.3], sunInt: 2.2, hemi: 0.6, exposure: 1.0 },
  { s: 0.4, zenith: [0.07, 0.22, 0.62], horizon: [0.58, 0.72, 0.9], sun: [1.0, 0.84, 0.64], sunInt: 3.0, hemi: 0.8, exposure: 0.95 },
  { s: 0.95, zenith: [0.05, 0.18, 0.58], horizon: [0.55, 0.72, 0.93], sun: [1.0, 0.94, 0.84], sunInt: 3.3, hemi: 0.9, exposure: 0.9 },
]

const _a = new THREE.Color()
const _b = new THREE.Color()
const mixArr = (out: THREE.Color, a: number[], b: number[], t: number) => out.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, THREE.LinearSRGBColorSpace)
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Calcula o céu para uma hora decimal (0–24). Nascer do sol às 6h, pôr do sol às 18h. */
export function skyAt(hour: number, out: SkyState): SkyState {
  const a = ((hour - 6) / 12) * Math.PI
  // Nasce a leste (+X), passa ao norte (-Z, hemisfério sul) e se põe a oeste.
  const dir = out.sunDir.set(Math.cos(a), Math.sin(a) * 0.93, -0.33).normalize()
  out.sunSin = dir.y
  out.moonDir.copy(dir).multiplyScalar(-1)
  out.moonDir.z = Math.abs(out.moonDir.z) * -1 - 0.2
  out.moonDir.normalize()

  const s = dir.y
  let i = 0
  while (i < STOPS.length - 2 && s > STOPS[i + 1].s) i += 1
  const A = STOPS[i]
  const B = STOPS[i + 1]
  const t = Math.min(1, Math.max(0, (s - A.s) / (B.s - A.s)))
  mixArr(out.zenith, A.zenith, B.zenith, t)
  mixArr(out.horizon, A.horizon, B.horizon, t)
  mixArr(out.sunColor, A.sun, B.sun, t)
  out.sunIntensity = A.sunInt + (B.sunInt - A.sunInt) * t
  out.hemiIntensity = A.hemi + (B.hemi - A.hemi) * t
  out.exposure = A.exposure + (B.exposure - A.exposure) * t
  out.daylight = sstep(-0.05, 0.3, s)
  out.night = 1 - sstep(-0.32, -0.02, s)
  out.moonIntensity = 0.55 * out.night * Math.max(0, out.moonDir.y)

  out.fog.copy(out.horizon).lerp(_a.copy(out.zenith), 0.12)
  out.hemiSky.copy(out.zenith).lerp(out.horizon, 0.55).multiplyScalar(1.2)
  out.hemiSky.lerp(_b.setRGB(0.1, 0.16, 0.35, THREE.LinearSRGBColorSpace), out.night * 0.7)
  out.hemiGround.setRGB(0.16, 0.13, 0.08, THREE.LinearSRGBColorSpace).multiplyScalar(0.25 + out.daylight * 0.75)
  out.cloudLit.copy(out.sunColor).lerp(_a.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace), 0.35).multiplyScalar(0.07 + 0.93 * out.daylight)
  out.cloudDark.copy(out.horizon).lerp(out.zenith, 0.4).multiplyScalar(0.05 + out.daylight * 0.95)
  return out
}

/** Hora do dia para cada modo de tempo; "auto" avança com o relógio. */
export function hourForMode(mode: string, autoHour: number): number {
  switch (mode) {
    case 'dawn': return 6.35
    case 'noon': return 12.2
    case 'dusk': return 17.45
    case 'night': return 23.0
    default: return autoHour
  }
}
