import { describe, expect, it } from 'vitest'
import { FlightModel, NO_INPUT, type FlightEnv, type FlightInput } from '../src/game/flight'
import { getBirdSpecies } from '../src/game/birdSpecies'

const env: FlightEnv = {
  surface: () => 0,
  wind: out => { out.set(0, 0, 0) },
}
const pressed = (patch: Partial<FlightInput>): FlightInput => ({ ...NO_INPUT, ...patch })

describe('FlightModel', () => {
  it('desacelera até um pouso suave e repousa no plano do solo', () => {
    const bird = new FlightModel()
    const events: Parameters<FlightModel['step']>[3] = []
    bird.reset(0, 1.2, 0, 0, 4)
    for (let i = 0; i < 240 && !bird.grounded; i += 1) bird.step(1 / 60, NO_INPUT, env, events)
    expect(bird.grounded).toBe(true)
    expect(bird.pos.y).toBeCloseTo(0.32, 6)
    expect(events.some(e => e.type === 'land')).toBe(true)
    expect(events.some(e => e.type === 'crash')).toBe(false)
  })

  it('decola ao bater asas quando está pousado', () => {
    const bird = new FlightModel()
    const events: Parameters<FlightModel['step']>[3] = []
    bird.reset(0, 1.2, 0, 0, 4)
    for (let i = 0; i < 240 && !bird.grounded; i += 1) bird.step(1 / 60, NO_INPUT, env, events)
    expect(bird.grounded).toBe(true)
    events.length = 0
    bird.step(1 / 60, pressed({ flap: true, flapPressed: true }), env, events)
    expect(bird.grounded).toBe(false)
    expect(bird.pos.y).toBeGreaterThan(0.32)
    expect(bird.vel.y).toBeGreaterThan(5)
    expect(events.some(e => e.type === 'takeoff')).toBe(true)
  })

  it('gasta mais fôlego em batidas manuais do que em planeio', () => {
    const glider = new FlightModel()
    const flapper = new FlightModel()
    glider.reset(0, 80, 0, 0, 12)
    flapper.reset(0, 80, 0, 0, 12)
    const events: Parameters<FlightModel['step']>[3] = []
    for (let i = 0; i < 60; i += 1) {
      glider.step(1 / 60, NO_INPUT, env, events)
      flapper.step(1 / 60, pressed({ flap: true }), env, events)
    }
    expect(flapper.stamina).toBeLessThan(glider.stamina - 4)
    expect(flapper.pos.y).toBeGreaterThan(-100)
  })

  it('assistência mantém a batida automática em baixa velocidade quando o cruzeiro está desligado', () => {
    const assisted = new FlightModel()
    const manual = new FlightModel()
    assisted.cruise = false
    manual.cruise = false
    manual.assisted = false
    assisted.reset(0, 100, 0, 0, 6)
    manual.reset(0, 100, 0, 0, 6)
    assisted.step(1 / 60, NO_INPUT, env, [])
    manual.step(1 / 60, NO_INPUT, env, [])
    expect(assisted.flapping).toBe(true)
    expect(manual.flapping).toBe(false)
  })

  it('aplica recuperação de fôlego maior à coruja que à andorinha', () => {
    const owl = new FlightModel()
    const swallow = new FlightModel()
    owl.setProfile(getBirdSpecies('coruja').flight)
    swallow.setProfile(getBirdSpecies('andorinha').flight)
    for (const bird of [owl, swallow]) {
      bird.assisted = false
      bird.cruise = false
      bird.reset(0, 140, 0, 0, 30)
      bird.stamina = 20
      for (let i = 0; i < 60; i += 1) bird.step(1 / 60, NO_INPUT, env, [])
    }
    expect(owl.stamina).toBeGreaterThan(swallow.stamina + 0.2)
  })
})
