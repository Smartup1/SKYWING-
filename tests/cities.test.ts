import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Cities } from '../src/game/cities'
import { CITY_SITES, isUrbanAt } from '../src/game/cityLayout'
import { nestSites, seedPositions } from '../src/game/collectibles'

describe('cidades do vale', () => {
  it('constrói três assentamentos identificáveis com muitas edificações instanciadas', () => {
    const cities = new Cities()
    expect(CITY_SITES.map(site => site.name)).toEqual(['Vale Claro', 'Lago Azul', 'Campina'])
    expect(cities.group.name).toBe('procedural-cities')
    expect(cities.buildingCount).toBeGreaterThan(100)
    expect(cities.windowCount).toBeGreaterThan(300)
    expect(cities.facadeDetailCount).toBeGreaterThan(cities.windowCount * 3)
    expect(cities.vehicleCount).toBeGreaterThanOrEqual(45)
    expect(cities.utilityPoleCount).toBeGreaterThan(100)
    expect(cities.wireSpanCount).toBeGreaterThan(50)
    expect(cities.perchCount).toBe(cities.utilityPoleCount)
    expect(cities.group.getObjectByName('utility-poles')).toBeInstanceOf(THREE.InstancedMesh)
    expect(cities.group.getObjectByName('utility-wires')).toBeInstanceOf(THREE.Mesh)
    const asphalt = cities.group.getObjectByName('road-asphalt') as THREE.Mesh
    const roadNormals = asphalt.geometry.getAttribute('normal') as THREE.BufferAttribute
    expect(roadNormals.count).toBeGreaterThan(0)
    expect(roadNormals.getY(0)).toBeGreaterThan(0.5)
    const laneNormals = (cities.group.getObjectByName('road-lane-markings') as THREE.Mesh).geometry.getAttribute('normal') as THREE.BufferAttribute
    expect(laneNormals.getY(0)).toBeGreaterThan(0.5)
    const perch = cities.nearestPerch(new THREE.Vector3(CITY_SITES[0].x, 100, CITY_SITES[0].z), 1000)
    expect(perch).not.toBeNull()
    expect(perch!.position.y).toBeGreaterThan(5)
    expect(perch!.distance).toBeCloseTo(perch!.position.distanceTo(new THREE.Vector3(CITY_SITES[0].x, 100, CITY_SITES[0].z)))
    expect(cities.nearestPerch(new THREE.Vector3(10000, 100, 10000), 1)).toBeNull()
    expect(cities.group.children.length).toBeGreaterThanOrEqual(20)
    const traffic = cities.group.getObjectByName('traffic-car-bodies') as THREE.InstancedMesh
    const before = traffic.instanceMatrix.array.slice()
    cities.update(0.2, 18)
    expect(traffic.instanceMatrix.array).not.toEqual(before)
    cities.update(0.2, 20, new THREE.Vector3(10_000, 80, 10_000))
    expect(traffic.visible).toBe(false)
    cities.update(0.2, 21, new THREE.Vector3(CITY_SITES[0].x, 80, CITY_SITES[0].z))
    expect(traffic.visible).toBe(true)
  })

  it('mantém cidades separadas da floresta de recompensas e preserva a quantidade de sementes', () => {
    for (const site of CITY_SITES) expect(isUrbanAt(site.x, site.z)).toBe(true)
    const seeds = seedPositions(48)
    expect(seeds).toHaveLength(48)
    for (const seed of seeds) expect(isUrbanAt(seed.x, seed.z)).toBe(false)
    for (const nest of nestSites()) expect(isUrbanAt(nest.x, nest.z)).toBe(false)
  })
})
