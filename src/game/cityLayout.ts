export type CitySite = {
  id: string
  name: string
  x: number
  z: number
  radius: number
  seed: number
  columns: number
  rows: number
  spacing: number
  kind: 'city' | 'town'
}

/** Núcleos no vale plano, afastados do lago e das cristas mais íngremes. */
export const CITY_SITES: readonly CitySite[] = [
  { id: 'vale-claro', name: 'Vale Claro', x: 350, z: 150, radius: 225, seed: 41, columns: 11, rows: 9, spacing: 24, kind: 'city' },
  { id: 'lago-azul', name: 'Lago Azul', x: 450, z: 500, radius: 130, seed: 73, columns: 7, rows: 6, spacing: 22, kind: 'town' },
  { id: 'campina', name: 'Campina', x: -500, z: 550, radius: 155, seed: 109, columns: 7, rows: 7, spacing: 23, kind: 'town' },
]

/** Margem para ruas, praças e afastamento da vegetação procedural. */
export function isUrbanAt(x: number, z: number): boolean {
  return CITY_SITES.some(site => Math.hypot(x - site.x, z - site.z) < site.radius + 38)
}
