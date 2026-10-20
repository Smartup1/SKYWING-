import { DEFAULT_BIRD_ID, isBirdSpeciesId, type BirdSpeciesId } from '../game/birdSpecies'

/** Persistência local mínima: preferências e descobertas. Falhas de armazenamento são ignoradas. */
export type Quality = 'low' | 'medium' | 'high'
export type TimeMode = 'auto' | 'dawn' | 'noon' | 'dusk' | 'night'
export const SAVE_KEY = 'skywing.save.v1'
export const TIME_MODES: TimeMode[] = ['auto', 'dawn', 'noon', 'dusk', 'night']

export type SaveData = {
  version: 1
  musicVolume: number
  sfxVolume: number
  muted: boolean
  quality: Quality
  sensitivity: number
  invertY: boolean
  reducedMotion: boolean
  timeMode: TimeMode
  cruise: boolean
  flightAssist: boolean
  /** Gavião caçador (perseguições) ligado. */
  hawks: boolean
  birdId: BirdSpeciesId
  discoveries: string[]
  totalSeeds: number
  flightSeconds: number
  bestSeeds: number
  bestScore: number
  introSeen: boolean
}

export const defaultSave = (): SaveData => ({
  version: 1,
  musicVolume: 0.35,
  sfxVolume: 0.8,
  muted: false,
  quality: 'high',
  sensitivity: 0.5,
  invertY: false,
  reducedMotion: false,
  timeMode: 'auto',
  cruise: true,
  flightAssist: true,
  hawks: true,
  birdId: DEFAULT_BIRD_ID,
  discoveries: [],
  totalSeeds: 0,
  flightSeconds: 0,
  bestSeeds: 0,
  bestScore: 0,
  introSeen: false,
})

const clamp01 = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
const nonNeg = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return base
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
  const p = parsed as Record<string, unknown>
  if (p.version !== 1) return base
  return {
    version: 1,
    musicVolume: clamp01(p.musicVolume, base.musicVolume),
    sfxVolume: clamp01(p.sfxVolume, base.sfxVolume),
    muted: p.muted === true,
    quality: p.quality === 'low' || p.quality === 'medium' || p.quality === 'high' ? p.quality : base.quality,
    sensitivity: clamp01(p.sensitivity, base.sensitivity),
    invertY: p.invertY === true,
    reducedMotion: p.reducedMotion === true,
    timeMode: TIME_MODES.includes(p.timeMode as TimeMode) ? (p.timeMode as TimeMode) : base.timeMode,
    cruise: p.cruise !== false,
    flightAssist: p.flightAssist !== false,
    hawks: p.hawks !== false,
    birdId: isBirdSpeciesId(p.birdId) ? p.birdId : base.birdId,
    discoveries: Array.isArray(p.discoveries) ? p.discoveries.filter((d): d is string => typeof d === 'string').slice(0, 32) : [],
    totalSeeds: nonNeg(p.totalSeeds),
    flightSeconds: nonNeg(p.flightSeconds),
    bestSeeds: nonNeg(p.bestSeeds),
    bestScore: nonNeg(p.bestScore),
    introSeen: p.introSeen === true,
  }
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export class SaveStore {
  data: SaveData
  constructor(private readonly storage: Storage | undefined = safeStorage()) {
    let raw: string | null = null
    try {
      raw = storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }
  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      /* armazenamento indisponível: segue só em memória */
    }
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
