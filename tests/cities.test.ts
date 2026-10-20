import { describe, expect, it } from 'vitest'
import { Cities } from '../src/game/cities'
import { CITY_SITES, isUrbanAt } from '../src/game/cityLayout'
import { nestSites, seedPositions } from '../src/game/collectibles'

describe('cidades do vale', () => {
  it('constrói cinco assentamentos identificáveis com muitas edificações instanciadas', () => {
    const cities = new Cities()
    expect(CITY_SITES.map(site => site.name)).toEqual(['Vale Claro', 'Lago Azul', 'Campina', 'Remanso', 'Mirante'])
    expect(cities.group.name).toBe('procedural-cities')
    expect(cities.buildingCount).toBeGreaterThan(100)
    expect(cities.group.children.length).toBeGreaterThanOrEqual(6)
    cities.update(0.2)
  })

  it('mantém cidades separadas da floresta de recompensas e preserva a quantidade de sementes', () => {
    for (const site of CITY_SITES) expect(isUrbanAt(site.x, site.z)).toBe(true)
    const seeds = seedPositions(48)
    expect(seeds).toHaveLength(48)
    for (const seed of seeds) expect(isUrbanAt(seed.x, seed.z)).toBe(false)
    for (const nest of nestSites()) expect(isUrbanAt(nest.x, nest.z)).toBe(false)
  })
})
