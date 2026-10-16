import { describe, expect, it } from 'vitest'
import { BIRD_SPECIES, isBirdSpeciesId, type BirdSpeciesId } from '../src/game/birdSpecies'

describe('espécies de aves', () => {
  it('oferece cinco aves únicas com perfis de voo completos e distintos', () => {
    expect(BIRD_SPECIES).toHaveLength(5)
    expect(new Set(BIRD_SPECIES.map(bird => bird.id)).size).toBe(5)
    for (const bird of BIRD_SPECIES) {
      expect(isBirdSpeciesId(bird.id)).toBe(true)
      expect(bird.name.length).toBeGreaterThan(2)
      for (const value of Object.values(bird.flight)) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThan(0)
      }
    }
    expect(BIRD_SPECIES.some(bird => bird.flight.maxSpeed > 1.2)).toBe(true)
    expect(BIRD_SPECIES.some(bird => bird.flight.recovery > 1.4)).toBe(true)
    expect(isBirdSpeciesId('inexistente')).toBe(false)
  })

  it('mantém os identificadores tipados como escolhas suportadas', () => {
    const selected: BirdSpeciesId = 'andorinha'
    expect(BIRD_SPECIES.find(bird => bird.id === selected)?.flight.maxSpeed).toBeGreaterThan(1)
  })
})
