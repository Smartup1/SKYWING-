import { describe, expect, it } from 'vitest'
import { createRun, DISCOVERY_IDS, discover } from '../src/game/rules'

describe('conquistas das araras', () => {
  const macaws = ['arara-azul', 'arara-vermelha', 'arara-amarela'] as const

  it('registra as três cores no catálogo de descobertas', () => {
    expect(DISCOVERY_IDS.filter(id => id.startsWith('arara-'))).toEqual([...macaws])
  })

  it('concede cada conquista uma vez e a conserva ao restaurar o progresso', () => {
    for (const id of macaws) {
      const run = createRun()
      expect(discover(run, id)).toBe(true)
      expect(discover(run, id)).toBe(false)
      const restored = createRun([id])
      expect(restored.discoveries.has(id)).toBe(true)
      expect(discover(restored, id)).toBe(false)
    }
  })
})
