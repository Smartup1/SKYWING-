import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CityColliders, generateCity } from '../src/game/cityData'
import { FlightModel, NO_INPUT, type FlightEnv, type FlightEvent } from '../src/game/flight'
import { HawkDirector, type HunterBody, type PlayerView } from '../src/game/hawks'
import { MissionBoard } from '../src/game/missions'
import { Score } from '../src/game/score'

const flat: FlightEnv = { surface: () => 0, wind: out => { out.set(0, 0, 0) } }

describe('pouso assistido', () => {
  it('pousa suave segurando L vindo em cruzeiro', () => {
    const f = new FlightModel()
    const ev: FlightEvent[] = []
    f.reset(0, 30, 0, 0, 10.5)
    for (let i = 0; i < 60 * 40 && !f.grounded; i += 1) f.step(1 / 60, { ...NO_INPUT, land: true }, flat, ev)
    expect(f.grounded).toBe(true)
    expect(ev.some(e => e.type === 'crash')).toBe(false)
  })
})

describe('edificações', () => {
  const data = generateCity()
  const col = new CityColliders(data.buildings)
  it('gera poleiros sobre lajes planas e o pássaro pousa no telhado', () => {
    expect(data.perches.length).toBeGreaterThanOrEqual(15)
    const p = data.perches[0]
    expect(col.roofAt(p.x, p.z)).toBeCloseTo(p.y, 0)
    const env: FlightEnv = { ...flat, roof: (x, z) => col.roofAt(x, z), wall: (x, y, z, m, out) => col.push(x, y, z, m, out) }
    const f = new FlightModel()
    const ev: FlightEvent[] = []
    f.reset(p.x, p.y + 1.2, p.z, 0, 2)
    for (let i = 0; i < 60 * 40 && !f.grounded; i += 1) f.step(1 / 60, { ...NO_INPUT, land: true }, env, ev)
    expect(f.grounded).toBe(true)
    expect(f.pos.y).toBeGreaterThan(p.y)
  })
  it('paredes empurram o pássaro para fora', () => {
    const b = data.buildings.find(x => x.height > 15)!
    const env: FlightEnv = { ...flat, roof: (x, z) => col.roofAt(x, z), wall: (x, y, z, m, out) => col.push(x, y, z, m, out) }
    const f = new FlightModel()
    f.reset(b.x - Math.cos(b.rotation) * 40, b.ground + 6, b.z + Math.sin(b.rotation) * 40, 0, 10)
    const target = Math.atan2(-(b.x - f.pos.x), -(b.z - f.pos.z))
    f.yaw = target
    f.vel.set(-Math.sin(target) * 10, 0, -Math.cos(target) * 10)
    for (let i = 0; i < 60 * 8; i += 1) {
      f.step(1 / 60, NO_INPUT, env, [])
      expect(col.push(f.pos.x, f.pos.y, f.pos.z, -0.2, { nx: 0, nz: 0, depth: 0, top: 0 })).toBe(false)
    }
  })
})

describe('gavião caçador', () => {
  const mk = () => {
    const body: HunterBody = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), bank: 0, flap: 0, active: false, fold: 0 }
    const log: string[] = []
    const d = new HawkDirector(body, { ground: () => 0, roof: () => -Infinity }, {
      warn: () => log.push('warn'), stoop: () => log.push('stoop'), dodge: () => log.push('dodge'),
      hit: () => log.push('hit'), escaped: r => log.push(`escape:${r}`),
    }, () => 0.5)
    return { body, log, d }
  }
  const view = (pos: THREE.Vector3, vel: THREE.Vector3, patch: Partial<PlayerView> = {}): PlayerView => ({
    pos, vel, forward: vel.clone().normalize(), grounded: false, agl: 60, withFlock: false, sheltered: false, inCover: false, assisted: false, ...patch,
  })
  it('avista, ataca e acaba em acerto, desvio ou desistência', () => {
    const { log, d } = mk()
    const pos = new THREE.Vector3(0, 80, 0)
    const vel = new THREE.Vector3(0, 0, -10.5)
    for (let t = 0; t < 120; t += 1 / 60) { pos.addScaledVector(vel, 1 / 60); d.update(1 / 60, view(pos, vel)) }
    expect(log).toContain('warn')
    expect(log).toContain('stoop')
    expect(log.some(l => l === 'hit' || l === 'dodge' || l.startsWith('escape'))).toBe(true)
  })
  it('pousar na cidade faz o gavião desistir', () => {
    const { log, d } = mk()
    const pos = new THREE.Vector3(0, 80, 0)
    const vel = new THREE.Vector3(0, 0, -10)
    for (let t = 0; t < 40; t += 1 / 60) d.update(1 / 60, view(pos, vel))
    expect(log).toContain('warn')
    for (let t = 0; t < 6; t += 1 / 60) d.update(1 / 60, view(pos, new THREE.Vector3(), { grounded: true, sheltered: true, agl: 0 }))
    expect(log).toContain('escape:sheltered')
  })
  it('gaviões desligados nunca aparecem', () => {
    const { log, d, body } = mk()
    d.enabled = false
    for (let t = 0; t < 120; t += 1 / 60) d.update(1 / 60, view(new THREE.Vector3(0, 80, 0), new THREE.Vector3(0, 0, -10)))
    expect(log).toEqual([])
    expect(body.active).toBe(false)
  })
})

describe('pontos e missões', () => {
  it('combo sobe o multiplicador e quebra ao expirar', () => {
    const s = new Score()
    for (let i = 0; i < 6; i += 1) s.award(100, true)
    expect(s.multiplier).toBe(4)
    s.update(13)
    expect(s.multiplier).toBe(1)
  })
  it('missão conclui e troca por outra diferente', () => {
    const b = new MissionBoard(5, () => 0)
    const first = b.current.kind
    let done = null
    for (let i = 0; i < 10 && !done; i += 1) done = b.note({ type: 'seed' })
    if (first === 'seeds') { expect(done).not.toBeNull(); expect(b.current.kind).not.toBe('seeds') }
  })
})
