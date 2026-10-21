<<<<<<< HEAD
import * as THREE from 'three'
=======
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad
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

<<<<<<< HEAD
  it('posiciona os edifícios no mapa e deixa as ruas com a face superior visível', () => {
    const cities = new Cities()
    const body = cities.group.children.find((child): child is THREE.InstancedMesh => (child as THREE.InstancedMesh).isInstancedMesh)
    expect(body).toBeDefined()
    const matrix = new THREE.Matrix4()
    body!.getMatrixAt(0, matrix)
    expect(matrix.elements[12]).toBeCloseTo(cities.data.buildings[0].x)
    expect(matrix.elements[14]).toBeCloseTo(cities.data.buildings[0].z)

    const asphalt = cities.group.getObjectByName('city-asphalt') as THREE.Mesh
    expect(asphalt).toBeDefined()
    expect(asphalt.geometry.getAttribute('normal').getY(0)).toBeGreaterThan(0)
  })

=======
>>>>>>> 795b639e012abf732208c865466f8376e73b67ad
  it('mantém cidades separadas da floresta de recompensas e preserva a quantidade de sementes', () => {
    for (const site of CITY_SITES) expect(isUrbanAt(site.x, site.z)).toBe(true)
    const seeds = seedPositions(48)
    expect(seeds).toHaveLength(48)
    for (const seed of seeds) expect(isUrbanAt(seed.x, seed.z)).toBe(false)
    for (const nest of nestSites()) expect(isUrbanAt(nest.x, nest.z)).toBe(false)
  })
})
