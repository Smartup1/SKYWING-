/**
 * Missões rápidas: uma de cada vez, sempre diferente da anterior. Ao concluir, rende pontos e a
 * próxima aparece na hora. Lógica pura (sem DOM nem three.js) com sorteio injetável para testes.
 */
export type MissionKind = 'seeds' | 'perch' | 'city' | 'escape' | 'dodge' | 'speed' | 'skim'

export type Mission = {
  kind: MissionKind
  target: number
  progress: number
  reward: number
  /** Índice da cidade (para `perch` e `city`). */
  site?: number
}

export type MissionEvent =
  | { type: 'seed' }
  | { type: 'perch'; site: number }
  | { type: 'city'; site: number }
  | { type: 'escape' }
  | { type: 'dodge' }
  | { type: 'speed'; kmh: number }
  | { type: 'skim'; seconds: number }

export class MissionBoard {
  current: Mission
  completed = 0
  /** Missões de gavião só aparecem com os gaviões ligados. */
  allowHawk = true
  private last: MissionKind | null = null

  constructor(private readonly siteCount: number, private readonly rng: () => number = Math.random) {
    this.current = this.make()
  }

  private make(): Mission {
    const kinds: MissionKind[] = ['seeds', 'perch', 'city', 'speed', 'skim']
    if (this.allowHawk) kinds.push('escape', 'dodge')
    const options = kinds.filter(k => k !== this.last)
    const kind = options[Math.floor(this.rng() * options.length) % options.length]
    this.last = kind
    const site = Math.floor(this.rng() * this.siteCount) % Math.max(1, this.siteCount)
    switch (kind) {
      case 'seeds': return { kind, target: 5 + Math.floor(this.rng() * 4), progress: 0, reward: 300 }
      case 'perch': return { kind, target: 1, progress: 0, reward: 500, site }
      case 'city': return { kind, target: 1, progress: 0, reward: 250, site }
      case 'escape': return { kind, target: 1, progress: 0, reward: 700 }
      case 'dodge': return { kind, target: 1, progress: 0, reward: 500 }
      case 'speed': return { kind, target: 80 + 10 * Math.floor(this.rng() * 4), progress: 0, reward: 350 }
      default: return { kind: 'skim', target: 3, progress: 0, reward: 350 }
    }
  }

  reset(): void {
    this.completed = 0
    this.last = null
    this.current = this.make()
  }

  /** Registra um evento; devolve a missão concluída (já trocada pela próxima), se houver. */
  note(ev: MissionEvent): Mission | null {
    const m = this.current
    switch (ev.type) {
      case 'seed':
        if (m.kind === 'seeds') m.progress += 1
        break
      case 'perch':
        if (m.kind === 'perch' && m.site === ev.site) m.progress += 1
        break
      case 'city':
        if (m.kind === 'city' && m.site === ev.site) m.progress += 1
        break
      case 'escape':
        if (m.kind === 'escape') m.progress += 1
        break
      case 'dodge':
        if (m.kind === 'dodge') m.progress += 1
        break
      case 'speed':
        if (m.kind === 'speed') m.progress = Math.max(m.progress, ev.kmh)
        break
      case 'skim':
        if (m.kind === 'skim') m.progress += ev.seconds
        break
    }
    if (m.progress < m.target) return null
    this.completed += 1
    this.current = this.make()
    return m
  }
}
