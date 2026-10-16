import { CONFIG } from './config'

export const NEST_COUNT = 6
export type DiscoveryId = `nest${number}` | 'summit' | 'skim' | 'flock' | 'thermal'
export const DISCOVERY_IDS: DiscoveryId[] = [
  ...Array.from({ length: NEST_COUNT }, (_, i) => `nest${i}` as DiscoveryId),
  'summit', 'skim', 'flock', 'thermal',
]

export type RunState = {
  seeds: number
  seedsGoal: number
  discoveries: Set<DiscoveryId>
  seconds: number
  distance: number
  maxAltitude: number
  maxSpeed: number
  /** Segundos voando junto de um bando. */
  flockSeconds: number
  /** Ganho de altitude acumulado dentro de uma térmica. */
  thermalGain: number
}

export function createRun(known: Iterable<DiscoveryId> = []): RunState {
  return {
    seeds: 0,
    seedsGoal: CONFIG.seeds.count,
    discoveries: new Set(known),
    seconds: 0,
    distance: 0,
    maxAltitude: 0,
    maxSpeed: 0,
    flockSeconds: 0,
    thermalGain: 0,
  }
}

/** Registra uma descoberta; devolve true apenas na primeira vez. */
export function discover(run: RunState, id: DiscoveryId): boolean {
  if (run.discoveries.has(id)) return false
  run.discoveries.add(id)
  return true
}

export const discoveryProgress = (run: RunState) => run.discoveries.size
export const DISCOVERY_TOTAL = DISCOVERY_IDS.length

/** Hora decimal (0–24) em "HH:MM". */
export function formatClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const hh = Math.floor(h)
  const mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const POINTS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']
/** Rumo em graus (0 = Norte, 90 = Leste) para a rosa dos ventos em português. */
export function compassName(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

export const kmh = (ms: number) => Math.round(ms * 3.6)
