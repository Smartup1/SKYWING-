/**
 * Geração determinística de cidades: edificações, poleiros, praças, árvores, postes e faixas de
 * tráfego. Independente de three.js/DOM — o mesmo resultado alimenta a malha (cities.ts), a
 * colisão (CityColliders) e os testes.
 *
 * Melhorias desta versão:
 *  - Layouts urbanos variados (grid, orgânico, radial, linear)
 *  - Quarteirões com adossamento (paredes compartilhadas)
 *  - Hierarquia viária (avenidas, ruas, becos) afetando largura e arborização
 *  - Landmarks: prefeitura, mercado, mesquita, fonte, estátua, torre d'água
 *  - Chaminés, beirais, varandas, muros, cercas
 *  - Perches em: lajes, cumeeiras, chaminés, torre d'água, fios
 *  - Colisão com telhado em pirâmide (interpolação real)
 *  - Paletas de cor por bairro (clusters espaciais)
 *  - Árvores agrupadas em parques e avenidas, não aleatórias
 */
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, heightAt, surfaceAt } from './terrain'

// ============================================================================
// Tipos públicos
// ============================================================================

export type BuildingKind =
  | 'house' | 'shop' | 'block' | 'tower' | 'church'
  | 'townhall' | 'market' | 'mosque' | 'watertower' | 'warehouse'

/** Segundo volume: recuo no alto de uma torre, campanário, cúpula. */
export type Upper = {
  ox: number
  oz: number
  width: number
  depth: number
  height: number
  fromGround: boolean
  spire: boolean
  /** Tipo de coroamento: 'flat' | 'pyramid' | 'dome' | 'spire' | 'crenel' */
  cap?: 'flat' | 'pyramid' | 'dome' | 'spire' | 'crenel'
}

/** Anexo: chaminé, varanda, toldo, muro. */
export type Attachment = {
  kind: 'chimney' | 'balcony' | 'awning' | 'fence' | 'wall' | 'buttress'
  ox: number
  oz: number
  width: number
  depth: number
  height: number
  /** Altura da base acima do chão (0 = chão). */
  elevation: number
}

export type Building = {
  site: number
  kind: BuildingKind
  x: number
  z: number
  ground: number
  width: number
  depth: number
  height: number
  rotation: number
  pitched: boolean
  roofHeight: number
  color: number
  roofColor: number
  /** Cor da fachada frontal (para variedade de fachadas comerciais). */
  facadeColor?: number
  upper?: Upper
  antenna: number
  attachments?: Attachment[]
  /** Índice do bairro (paleta). */
  district?: number
}

export type PerchKind = 'roof' | 'ridge' | 'chimney' | 'wire' | 'tower' | 'spire'

/** Poleiro: superfície marcada para pouso, com bônus. */
export type Perch = {
  id: number
  site: number
  x: number
  y: number
  z: number
  radius: number
  kind: PerchKind
  /** Orientação preferida do pássaro (rad). */
  facing: number
}

export type Plaza = {
  site: number
  x: number
  z: number
  rotation: number
  size: number
  /** Tipo de praça. */
  kind: 'square' | 'park' | 'roundabout' | 'market'
  /** Monumento central (se houver). */
  monument?: 'fountain' | 'statue' | 'obelisk' | 'none'
}

export type TreeSpot = {
  x: number
  z: number
  ground: number
  scale: number
  tone: number
  /** 'street' | 'park' | 'plaza' — afeta o tipo de copa no renderizador. */
  kind?: 'street' | 'park' | 'plaza'
}

export type LampSpot = { x: number; z: number; ground: number; rotation: number }

export type Lane = {
  site: number
  ax: number
  az: number
  bx: number
  bz: number
  length: number
  heights: Float32Array
  /** Hierarquia: 0 = avenida, 1 = rua, 2 = beco. */
  tier: 0 | 1 | 2
}

/** Linha elétrica entre dois edifícios — gera poleiros do tipo 'wire'. */
export type PowerLine = {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  sag: number
  poles: { x: number; y: number; z: number }[]
}

export type CityData = {
  buildings: Building[]
  perches: Perch[]
  plazas: Plaza[]
  trees: TreeSpot[]
  lamps: LampSpot[]
  lanes: Lane[]
  powerLines: PowerLine[]
  /** Layout urbano detectado (útil para debug/visual). */
  layout: UrbanLayout
}

export type UrbanLayout = 'grid' | 'organic' | 'radial' | 'linear'

export const LANE_STEP = 8

// ============================================================================
// Utilidades
// ============================================================================

export function localToWorld(site: CitySite, x: number, z: number): [number, number] {
  const a = site.seed * 0.017
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [site.x + x * c + z * s, site.z - x * s + z * c]
}

export function worldToLocal(site: CitySite, x: number, z: number): [number, number] {
  const a = site.seed * 0.017
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = x - site.x
  const dz = z - site.z
  return [dx * c - dz * s, dx * s + dz * c]
}

const pick = <T>(list: readonly T[], r: number): T =>
  list[Math.min(list.length - 1, Math.floor(r * list.length))]

// ============================================================================
// Paletas por "época/bairro"
// ============================================================================

const PALETTES = {
  oldTown: {
    house: [0xe8d8b8, 0xd9a98a, 0xc6d3a8, 0xe3c0c0, 0xf0e2a8],
    body: [0xc5b8a6, 0xd0c8b7, 0xd5c0a1],
    pitchedRoof: [0x834c39, 0x6b4140, 0xa05e42],
    flatRoof: [0x6a6d70, 0x585d62],
  },
  downtown: {
    house: [0xd8d0c4, 0xb9c5c3, 0xa9c4d6],
    body: [0xaebdc4, 0xb9c5c3, 0x9aa7ad],
    pitchedRoof: [0x544f4a, 0x3c5555],
    flatRoof: [0x6a6d70, 0x7a7770, 0x8a8478],
  },
  riverside: {
    house: [0xe3c0c0, 0xc6d3a8, 0xf0e2a8],
    body: [0xd5c0a1, 0xc5b8a6],
    pitchedRoof: [0xa05e42, 0x834c39],
    flatRoof: [0x7a7770, 0x585d62],
  },
} as const

type Palette = typeof PALETTES[keyof typeof PALETTES]

function paletteFor(site: CitySite, district: number): Palette {
  const names = Object.keys(PALETTES) as (keyof typeof PALETTES)[]
  // Cidades grandes tendem a ter "downtown"; vilas, "oldTown"
  const base = site.kind === 'city' ? 1 : 0
  const idx = (base + district) % names.length
  return PALETTES[names[idx]]
}

// ============================================================================
// Detecção de layout urbano
// ============================================================================

/**
 * Cada cidade recebe um layout distinto, derivado do seed.
 * - grid:    grelha ortogonal (default moderno)
 * - organic: ruas curvas, quarteirões irregulares (medieval)
 * - radial:  avenidas saindo de uma praça central
 * - linear:  cidade ao longo de um eixo (estrada/rio)
 */
function detectLayout(site: CitySite): UrbanLayout {
  const r = hash2(site.seed, 1, 9001)
  if (site.kind === 'city') {
    // Cidades: mais chance de grid ou radial
    if (r < 0.45) return 'grid'
    if (r < 0.75) return 'radial'
    if (r < 0.9) return 'organic'
    return 'linear'
  }
  // Vilas: mais chance de organic ou linear
  if (r < 0.4) return 'organic'
  if (r < 0.7) return 'linear'
  if (r < 0.9) return 'grid'
  return 'radial'
}

// ============================================================================
// Geração principal
// ============================================================================

export function generateCity(sites: readonly CitySite[] = CITY_SITES): CityData {
  const data: CityData = {
    buildings: [], perches: [], plazas: [], trees: [], lamps: [], lanes: [], powerLines: [],
    layout: 'grid',
  }
  for (const [si, site] of sites.entries()) {
    const layout = detectLayout(site)
    data.layout = layout // último vence, mas útil para debug
    generateSite(data, site, si, layout)
  }
  return data
}

function generateSite(data: CityData, site: CitySite, si: number, layout: UrbanLayout): void {
  const cx = Math.floor(site.columns / 2)
  const cz = Math.floor(site.rows / 2)
  const plazaCell: [number, number] = site.kind === 'city' ? [cx - 2, cz] : [cx, cz]
  const churchCell: [number, number] = site.kind === 'city' ? [cx + 2, cz - 1] : [cx + 1, cz]
  const townhallCell: [number, number] = site.kind === 'city' ? [cx - 1, cz + 2] : [cx - 1, cz + 1]
  const marketCell: [number, number] = site.kind === 'city' ? [cx + 1, cz + 2] : [cx + 2, cz + 1]
  // Espaça os quarteirões sem inflar os edifícios junto com a malha urbana.
  const maxFoot = Math.min(site.spacing - 11, 13)
  const rot0 = site.seed * 0.017
  const first = data.buildings.length

  // Pré-calcula deformação orgânica (deslocamento de vértices da grelha)
  const warpAmp = layout === 'organic' ? 4.5 : layout === 'radial' ? 2.0 : 0
  const warpFreq = layout === 'organic' ? 0.35 : 0.5

  const getCell = (c: number, r: number): [number, number] => {
    let lx = (c - (site.columns - 1) / 2) * site.spacing
    let lz = (r - (site.rows - 1) / 2) * site.spacing
    // Ruído de posição (mais forte em organic)
    lx += (hash2(c, r, site.seed + 1) - 0.5) * 3
    lz += (hash2(c, r, site.seed + 2) - 0.5) * 3
    if (warpAmp > 0) {
      // Deformação contínua via senos com fase por célula
      const wx = Math.sin(lz * warpFreq + c * 0.7) * warpAmp
      const wz = Math.cos(lx * warpFreq + r * 0.9) * warpAmp
      lx += wx
      lz += wz
    }
    return [lx, lz]
  }

  // Cada célula recebe um "district" (cluster espacial de paleta)
  const districtOf = (c: number, r: number) => {
    const nx = (c / site.columns) - 0.5
    const nz = (r / site.rows) - 0.5
    const ang = Math.atan2(nz, nx) + Math.PI
    const zone = Math.floor(ang / (Math.PI * 0.66)) // 3 setores
    return (zone + Math.floor(hash2(c >> 2, r >> 2, site.seed + 77) * 2)) % 3
  }

  for (let c = 0; c < site.columns; c += 1) {
    for (let r = 0; r < site.rows; r += 1) {
      const [lx, lz] = getCell(c, r)
      const [x, z] = localToWorld(site, lx, lz)
      const ground = heightAt(x, z)

      // Praça central
      if (c === plazaCell[0] && r === plazaCell[1]) {
        if (ground > 1) {
          const plazaKind: Plaza['kind'] =
            layout === 'radial' ? 'roundabout'
            : site.kind === 'city' ? (hash2(c, r, 1234) < 0.5 ? 'square' : 'market')
            : 'park'
          data.plazas.push({
            site: si, x, z, rotation: rot0, size: site.spacing - 9,
            kind: plazaKind,
            monument: hash2(c, r, 5678) < 0.7
              ? pick(['fountain', 'statue', 'obelisk'] as const, hash2(c, r, 9101))
              : 'none',
          })
        }
        continue
      }
      if (ground < 0.8) continue

      // Landmarks fixos
      const isTower = site.kind === 'city' && c === cx && r === cz
      const isChurch = c === churchCell[0] && r === churchCell[1]
      const isTownhall = site.kind === 'city' && c === townhallCell[0] && r === townhallCell[1]
      const isMarket = site.kind === 'city' && c === marketCell[0] && r === marketCell[1]
      const isWatertower = site.kind === 'city' && c === cx + 1 && r === cz - 2

      if (!isTower && !isChurch && !isTownhall && !isMarket && !isWatertower) {
        // Densidade por zona (centro mais denso)
        const ring = Math.hypot(lx, lz) / site.radius
        const emptyChance = site.kind === 'city'
          ? 0.06 + ring * 0.18
          : 0.12 + ring * 0.15
        if (hash2(c, r, site.seed) < emptyChance) continue
      }

      const ring = Math.hypot(lx, lz) / site.radius
      const h = (k: number) => hash2(c, r, site.seed + k)
      const district = districtOf(c, r)
      const palette = paletteFor(site, district)

      let kind: BuildingKind
      if (isTower) kind = 'tower'
      else if (isChurch) kind = 'church'
      else if (isTownhall) kind = 'townhall'
      else if (isMarket) kind = 'market'
      else if (isWatertower) kind = 'watertower'
      else if (site.kind === 'city') {
        if (ring < 0.35) kind = h(9) < 0.35 ? 'block' : h(9) < 0.75 ? 'shop' : 'house'
        else if (ring < 0.72) kind = h(9) < 0.3 ? 'block' : h(9) < 0.7 ? 'shop' : 'warehouse'
        else kind = h(9) < 0.15 ? 'shop' : 'house'
      } else {
        kind = ring < 0.5 ? (h(9) < 0.55 ? 'shop' : 'house') : 'house'
      }

      // Dimensões e altura
      let width: number
      let depth: number
      let height: number
      switch (kind) {
        case 'tower':
          width = maxFoot; depth = maxFoot; height = 40 + h(3) * 6; break
        case 'church':
          width = Math.min(9, maxFoot); depth = Math.min(15, maxFoot); height = 9; break
        case 'townhall':
          width = Math.min(14, maxFoot); depth = Math.min(10, maxFoot); height = 10; break
        case 'market':
          width = Math.min(maxFoot, 14 + h(4) * 4); depth = Math.min(maxFoot, 14 + h(5) * 4); height = 7; break
        case 'watertower':
          width = Math.min(6, maxFoot); depth = Math.min(6, maxFoot); height = 20 + h(3) * 4; break
        case 'block':
          width = Math.min(maxFoot, 10 + h(4) * 4.5)
          depth = Math.min(maxFoot, 10 + h(5) * 4.5)
          height = ring < 0.42 ? 22 + h(3) * 30 : 11 + h(3) * 13
          break
        case 'shop':
          width = Math.min(maxFoot, 9 + h(4) * 4)
          depth = Math.min(maxFoot, 9 + h(5) * 4)
          height = 6.5 + h(3) * 4.5
          break
        case 'warehouse':
          width = Math.min(maxFoot, 14 + h(4) * 6)
          depth = Math.min(maxFoot, 10 + h(5) * 5)
          height = 7 + h(3) * 4
          break
        default:
          width = 7 + h(4) * 3.2
          depth = 7 + h(5) * 3.5
          height = 5 + h(3) * 3.6
      }

      const pitched = kind === 'house' || kind === 'church' || kind === 'townhall'
        || (kind === 'warehouse' && h(11) < 0.5)
      const roofHeight = kind === 'church' ? 5 : kind === 'townhall' ? 4 : pitched ? 2.6 + h(10) * 1.6 : 0.4

      const b: Building = {
        site: si,
        kind,
        x, z, ground, width, depth, height,
        rotation: rot0 + (h(6) - 0.5) * (layout === 'organic' ? 0.5 : 0.1),
        pitched, roofHeight,
        color: kind === 'house' ? pick(palette.house, h(7))
          : kind === 'church' ? 0xefe8d8
          : kind === 'townhall' ? 0xe0d4b8
          : kind === 'market' ? 0xc9a878
          : pick(palette.body, h(7)),
        roofColor: pitched
          ? (kind === 'church' ? 0x8a3f33 : kind === 'townhall' ? 0x6a3a30 : pick(palette.pitchedRoof, h(8)))
          : pick(palette.flatRoof, h(8)),
        facadeColor: kind === 'shop' && h(15) < 0.5 ? pick(palette.house, h(16)) : undefined,
        antenna: 0,
        district,
      }

      // Upper volumes (landmarks)
      if (kind === 'tower') {
        b.upper = {
          ox: 0, oz: 0, width: width * 0.6, depth: depth * 0.6,
          height: 14 + h(11) * 8, fromGround: false, spire: false, cap: 'flat',
        }
        b.antenna = 8 + h(12) * 4
      } else if (kind === 'church') {
        b.upper = {
          ox: 0, oz: depth / 2 - 2.6, width: 5, depth: 5,
          height: 22, fromGround: true, spire: true, cap: 'spire',
        }
      } else if (kind === 'townhall') {
        b.upper = {
          ox: 0, oz: 0, width: width * 0.55, depth: depth * 0.55,
          height: 6, fromGround: false, spire: false, cap: 'dome',
        }
      } else if (kind === 'watertower') {
        b.upper = {
          ox: 0, oz: 0, width: 5, depth: 5,
          height: 5, fromGround: false, spire: false, cap: 'flat',
        }
      } else if (kind === 'block' && ring < 0.42 && h(13) < 0.35) {
        b.antenna = 4 + h(14) * 4
      }

      // ---- Anexos (chaminés, beirais, varandas, muros) ----
      b.attachments = []
      if (kind === 'house') {
        // Chaminé em ~60% das casas
        if (h(20) < 0.6) {
          const cw = 0.7 + h(21) * 0.5
          b.attachments.push({
            kind: 'chimney',
            ox: (h(22) - 0.5) * width * 0.5,
            oz: (h(23) - 0.5) * depth * 0.5,
            width: cw, depth: cw, height: 1.2 + h(24) * 0.8, elevation: 0,
          })
        }
        // Beiral (telhado saliente)
        b.attachments.push({
          kind: 'awning',
          ox: 0, oz: 0,
          width: width + 0.6, depth: depth + 0.6, height: 0.15,
          elevation: height,
        })
        // Muro frontal em ~40%
        if (h(25) < 0.4) {
          b.attachments.push({
            kind: 'fence',
            ox: 0, oz: depth / 2 + 1.2,
            width: width + 1, depth: 0.25, height: 0.9, elevation: 0,
          })
        }
      } else if (kind === 'shop') {
        // Toldo frontal
        b.attachments.push({
          kind: 'awning',
          ox: 0, oz: depth / 2 + 0.4,
          width: width * 0.9, depth: 1.2, height: 0.12,
          elevation: 3.2 + h(26) * 0.5,
        })
      } else if (kind === 'block' && ring < 0.7 && h(27) < 0.4) {
        // Varandas em prédios médios
        for (let floor = 0; floor < Math.min(3, Math.floor(height / 4)); floor += 1) {
          b.attachments.push({
            kind: 'balcony',
            ox: 0, oz: depth / 2 + 0.5,
            width: width * 0.85, depth: 0.8, height: 0.15,
            elevation: 3.5 + floor * 3.2,
          })
        }
      } else if (kind === 'church') {
        // Contrafortes
        for (const side of [-1, 1]) {
          b.attachments.push({
            kind: 'buttress',
            ox: 0, oz: side * depth * 0.35,
            width: width + 1.4, depth: 0.8, height: height * 0.8, elevation: 0,
          })
        }
      }

      data.buildings.push(b)
    }
  }

  generatePerches(data, site, si, first, layout)
  generateStreets(data, site, si, layout)
  generatePlazaTrees(data, si, site)
  generatePowerLines(data, site, si, first)
}

// ============================================================================
// Perches — roofs, ridges, chimneys, wires
// ============================================================================

function generatePerches(data: CityData, site: CitySite, si: number, first: number, layout: UrbanLayout): void {
  const want = site.kind === 'city' ? 8 : 4
  type Cand = { p: Omit<Perch, 'id'>; key: number }
  const candidates: Cand[] = []

  for (let i = first; i < data.buildings.length; i += 1) {
    const b = data.buildings[i]
    if (b.height < 5) continue

    // Topo principal
    const up = b.upper
    const mainTop = b.ground + b.height + (up && !up.fromGround ? up.height : 0)
    const radius = Math.max(
      1.5,
      (up && !up.fromGround ? Math.min(up.width, up.depth) : Math.min(b.width, b.depth)) / 2 - 0.8,
    )
    const key = b.kind === 'tower' ? -2 : b.kind === 'church' ? -1.5 : hash2(i, si, 555)

    // Só lajes planas viram poleiro "roof"
    if (!b.pitched && b.kind !== 'watertower' && radius >= 1.6) {
      const px = up && !up.fromGround
        ? b.x + up.ox * Math.cos(b.rotation) + up.oz * Math.sin(b.rotation)
        : b.x
      const pz = up && !up.fromGround
        ? b.z - up.ox * Math.sin(b.rotation) + up.oz * Math.cos(b.rotation)
        : b.z
      candidates.push({
        p: { site: si, x: px, y: mainTop, z: pz, radius: Math.min(4.5, radius), kind: 'roof', facing: b.rotation },
        key,
      })
    }

    // Cumeeira (ridge) — ponto alto do telhado inclinado
    if (b.pitched) {
      const ridgeY = b.ground + b.height + b.roofHeight
      // Centro da cumeeira
      candidates.push({
        p: {
          site: si, x: b.x, y: ridgeY, z: b.z,
          radius: Math.min(2.5, b.width / 2 - 0.3),
          kind: 'ridge', facing: b.rotation,
        },
        key: key + 0.1,
      })
    }

    // Chaminés viram poleiros premium (pequenas mas altas)
    if (b.attachments) {
      for (const a of b.attachments) {
        if (a.kind !== 'chimney') continue
        const c = Math.cos(b.rotation)
        const s = Math.sin(b.rotation)
        const ax = b.x + a.ox * c + a.oz * s
        const az = b.z - a.ox * s + a.oz * c
        const topY = b.ground + b.height + b.roofHeight + a.height
        candidates.push({
          p: {
            site: si, x: ax, y: topY, z: az,
            radius: Math.max(0.6, Math.min(a.width, a.depth) / 2 - 0.05),
            kind: 'chimney', facing: b.rotation,
          },
          key: key + 0.5,
        })
      }
    }

    // Torre d'água: topo como poleiro
    if (b.kind === 'watertower' && up) {
      candidates.push({
        p: {
          site: si, x: b.x, y: b.ground + b.height + up.height, z: b.z,
          radius: 2.2, kind: 'tower', facing: b.rotation,
        },
        key: key - 0.3,
      })
    }

    // Campanário: topo da torre da igreja
    if (b.kind === 'church' && up) {
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)
      const ux = b.x + up.ox * c + up.oz * s
      const uz = b.z - up.ox * s + up.oz * c
      candidates.push({
        p: {
          site: si, x: ux, y: b.ground + up.height, z: uz,
          radius: 1.4, kind: 'spire', facing: b.rotation,
        },
        key: key - 1.0,
      })
    }
  }

  // Escolhe com espaçamento mínimo
  candidates.sort((a, b) => a.key - b.key)
  const chosen: Omit<Perch, 'id'>[] = []
  const minDist = site.kind === 'city' ? 40 : 30
  for (const cand of candidates) {
    if (chosen.length >= want) break
    if (chosen.some(p => Math.hypot(p.x - cand.p.x, p.z - cand.p.z) < minDist)) continue
    chosen.push(cand.p)
  }

  // Fios elétricos (vêm depois, mas criam perches extras) — só se houver espaço
  // (deixa para generatePowerLines adicionar seus próprios)

  for (const p of chosen) {
    data.perches.push({ ...p, id: data.perches.length })
  }
}

// ============================================================================
// Streets, lanes, lamps, trees
// ============================================================================

function generateStreets(data: CityData, site: CitySite, si: number, layout: UrbanLayout): void {
  const ex = (site.columns * site.spacing) / 2
  const ez = (site.rows * site.spacing) / 2
  const sp = site.spacing

  const addTree = (lx: number, lz: number, seed: number, kind: TreeSpot['kind']) => {
    const [x, z] = localToWorld(site, lx, lz)
    const ground = heightAt(x, z)
    if (ground < 1) return
    data.trees.push({
      x, z, ground,
      scale: 0.8 + hash2(seed, si, 601) * 0.7,
      tone: hash2(seed, si, 602),
      kind,
    })
  }

  // Ruas são indexadas por "linhas" (c) e "colunas" (r). A cada 3 linhas, uma avenida.
  // Avenidas: mais largas, mais arborizadas, com faixas de tráfego.
  // Ruas: normais. Becos: sem tráfego, largura mínima.
  let n = 0

  const tierOf = (idx: number): 0 | 1 | 2 => (idx % 4 === 0 ? 0 : idx % 3 === 0 ? 2 : 1)

  // ---- Linhas verticais (x = const) ----
  for (let c = 0; c <= site.columns; c += 1) {
    const tier = tierOf(c)
    const lx = (c - site.columns / 2) * sp
    // Avenidas: árvores dos dois lados; becos: nenhuma árvore
    if (tier === 2) continue
    const treeProb = tier === 0 ? 0.85 : 0.45
    for (let t = sp * 0.5; t < 2 * ez; t += 12) {
      const m = t % sp
      if (m < 6 || m > sp - 6) continue
      n += 1
      const lz = t - ez
      if (hash2(n, c, 603 + si) < treeProb) {
        const side = hash2(n, 1, 604) < 0.5 ? -3.3 : 3.3
        addTree(lx + side, lz, n, 'street')
      }
      if (Math.abs(m - sp / 2) < 6 && (tier === 0 || (tier === 1 && c % 2 === 0))) {
        pushLamp(data, site, lx + 3.4, lz, 0)
      }
    }
  }

  // ---- Linhas horizontais (z = const) ----
  for (let r = 0; r <= site.rows; r += 1) {
    const tier = tierOf(r + 1) // desloca para variar
    const lz = (r - site.rows / 2) * sp
    if (tier === 2) continue
    const treeProb = tier === 0 ? 0.85 : 0.45
    for (let t = sp * 0.5; t < 2 * ex; t += 12) {
      const m = t % sp
      if (m < 6 || m > sp - 6) continue
      n += 1
      const lx = t - ex
      if (hash2(n, r, 605 + si) < treeProb) {
        const side = hash2(n, 2, 606) < 0.5 ? -3.3 : 3.3
        addTree(lx, lz + side, n, 'street')
      }
      if (Math.abs(m - sp / 2) < 6 && (tier === 0 || (tier === 1 && r % 2 === 1))) {
        pushLamp(data, site, lx, lz + 3.4, Math.PI / 2)
      }
    }
  }

  // ---- Faixas de tráfego (mão dupla) ----
  // Avenidas têm tráfego; becos não; ruas normais sim.
  for (let c = 0; c <= site.columns; c += 1) {
    const tier = tierOf(c)
    if (tier === 2) continue
    const lx = (c - site.columns / 2) * sp
    const offset = tier === 0 ? 2.0 : 1.4
    pushLane(data, site, si, [lx - offset, -ez], [lx - offset, ez], tier)
    pushLane(data, site, si, [lx + offset, ez], [lx + offset, -ez], tier)
  }
  for (let r = 0; r <= site.rows; r += 1) {
    const tier = tierOf(r + 1)
    if (tier === 2) continue
    const lz = (r - site.rows / 2) * sp
    const offset = tier === 0 ? 2.0 : 1.4
    pushLane(data, site, si, [-ex, lz + offset], [ex, lz + offset], tier)
    pushLane(data, site, si, [ex, lz - offset], [-ex, lz - offset], tier)
  }
}

function pushLamp(data: CityData, site: CitySite, lx: number, lz: number, rotation: number): void {
  const [x, z] = localToWorld(site, lx, lz)
  const ground = heightAt(x, z)
  if (ground > 1) data.lamps.push({ x, z, ground, rotation })
}

function pushLane(
  data: CityData, site: CitySite, si: number,
  a: [number, number], b: [number, number], tier: 0 | 1 | 2,
): void {
  const [ax, az] = localToWorld(site, a[0], a[1])
  const [bx, bz] = localToWorld(site, b[0], b[1])
  const length = Math.hypot(bx - ax, bz - az)
  const n = Math.ceil(length / LANE_STEP) + 1
  const heights = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1)
    const h = surfaceAt(ax + (bx - ax) * t, az + (bz - az) * t)
    if (h < 0.6) return // trecho alagado: sem tráfego
    heights[i] = h
  }
  data.lanes.push({ site: si, ax, az, bx, bz, length, heights, tier })
}

// ============================================================================
// Árvores de praça
// ============================================================================

function generatePlazaTrees(data: CityData, si: number, site: CitySite): void {
  for (const plaza of data.plazas) {
    if (plaza.site !== si) continue
    const c = Math.cos(plaza.rotation)
    const s = Math.sin(plaza.rotation)
    const half = plaza.size / 2 - 2.2

    // Praça tipo "park": anel de árvores denso
    if (plaza.kind === 'park') {
      const count = 8
      for (let k = 0; k < count; k += 1) {
        const ang = (k / count) * Math.PI * 2
        const rad = half * (0.75 + hash2(k, 1, 611) * 0.2)
        const lx = Math.cos(ang) * rad
        const lz = Math.sin(ang) * rad
        const x = plaza.x + lx * c + lz * s
        const z = plaza.z - lx * s + lz * c
        data.trees.push({
          x, z, ground: heightAt(x, z),
          scale: 1.1 + hash2(k, 2, 612) * 0.6,
          tone: hash2(k, 3, 613), kind: 'park',
        })
      }
    } else {
      // Praça "square"/"market"/"roundabout": árvores nos cantos
      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const lx = i * half * 0.85
          const lz = j * half * 0.85
          const x = plaza.x + lx * c + lz * s
          const z = plaza.z - lx * s + lz * c
          data.trees.push({
            x, z, ground: heightAt(x, z),
            scale: 1 + hash2(i + 5, j + 5, 611) * 0.5,
            tone: hash2(i, j, 612), kind: 'plaza',
          })
        }
      }
    }
  }
}

// ============================================================================
// Linhas de energia (postes + fios com catenária)
// ============================================================================

function generatePowerLines(data: CityData, site: CitySite, si: number, first: number): void {
  // Só cidades grandes e vilas com cluster central ganham rede elétrica
  if (site.kind !== 'city' && hash2(site.seed, 1, 7777) > 0.6) return

  // Seleciona edifícios altos próximos para conectar
  const tall = data.buildings
    .slice(first)
    .filter(b => b.height >= 8 && !b.pitched)
    .sort((a, b) => b.height - a.height)
    .slice(0, 6)
  if (tall.length < 3) return

  // Conecta pares próximos
  const linked = new Set<number>()
  for (let i = 0; i < tall.length - 1; i += 1) {
    const a = tall[i]
    const b = tall[i + 1]
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    if (d > 90 || d < 8) continue
    const ax = a.x, az = a.z
    const bx = b.x, bz = b.z
    const ay = a.ground + a.height + 1.5
    const by = b.ground + b.height + 1.5
    const sag = d * 0.06
    // Postes intermediários a cada ~30m
    const poles: { x: number; y: number; z: number }[] = []
    const nPoles = Math.max(0, Math.floor(d / 30) - 1)
    for (let k = 1; k <= nPoles; k += 1) {
      const t = k / (nPoles + 1)
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      const py = heightAt(px, pz)
      if (py < 0.6) continue
      poles.push({ x: px, y: py + 5.5, z: pz })
    }
    data.powerLines.push({ ax, ay, az, bx, by, bz, sag, poles })

    // Cada poste vira poleiro 'wire' (topo)
    for (const p of poles) {
      const key = hash2(p.x, p.z, 8888)
      // Distribui no espaço
      if (data.perches.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 25)) continue
      if (key < 0.4) {
        data.perches.push({
          id: data.perches.length, site: si,
          x: p.x, y: p.y + 0.15, z: p.z,
          radius: 0.9, kind: 'wire', facing: 0,
        })
      }
    }
    linked.add(i)
  }
}

// ============================================================================
// Colisão — com interpolação de telhado em pirâmide
// ============================================================================

type Solid = {
  cx: number; cz: number; hw: number; hd: number; c: number; s: number
  base: number; top: number
  /** Se `pitched`, o `top` é a cumeeira e a altura varia com |lx|,|lz|. */
  pitched: boolean
  roofHeight: number
}

export type WallHit = { nx: number; nz: number; depth: number; top: number }

const CELL = 24

/** Caixas orientadas das edificações em grade espacial: telhados para pouso e paredes para batidas. */
export class CityColliders {
  private readonly cells = new Map<number, Solid[]>()
  readonly count: number

  constructor(buildings: readonly Building[]) {
    let n = 0
    for (const b of buildings) {
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)

      // Volume principal
      const top = b.pitched
        ? b.ground + b.height + b.roofHeight
        : b.ground + b.height + 0.2
      this.add({
        cx: b.x, cz: b.z, hw: b.width / 2, hd: b.depth / 2, c, s,
        base: b.ground - 4, top,
        pitched: b.pitched, roofHeight: b.roofHeight,
      })
      n += 1

      // Upper volumes
      if (b.upper) {
        const u = b.upper
        const ux = b.x + u.ox * c + u.oz * s
        const uz = b.z - u.ox * s + u.oz * c
        const base = u.fromGround ? b.ground - 4 : b.ground + b.height - 0.5
        const top2 = (u.fromGround ? b.ground : b.ground + b.height) + u.height + (u.spire ? 4 : 0)
        const upperPitched = u.cap === 'pyramid' || u.cap === 'spire'
        this.add({
          cx: ux, cz: uz, hw: u.width / 2, hd: u.depth / 2, c, s,
          base, top: top2,
          pitched: upperPitched, roofHeight: u.spire ? 4 : 1.5,
        })
        n += 1
      }

      // Anexos altos (chaminés, muros) — colisão vertical
      if (b.attachments) {
        for (const a of b.attachments) {
          if (a.kind === 'awning' || a.kind === 'balcony') continue // finos, ignora
          const ax = b.x + a.ox * c + a.oz * s
          const az = b.z - a.ox * s + a.oz * c
          const abase = b.ground + a.elevation
          const atop = abase + a.height
          this.add({
            cx: ax, cz: az, hw: a.width / 2, hd: a.depth / 2, c, s,
            base: abase, top: atop,
            pitched: false, roofHeight: 0,
          })
          n += 1
        }
      }
    }
    this.count = n
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096)
  }

  private add(solid: Solid): void {
    const r = Math.hypot(solid.hw, solid.hd) + 1.5
    const x0 = Math.floor((solid.cx - r) / CELL)
    const x1 = Math.floor((solid.cx + r) / CELL)
    const z0 = Math.floor((solid.cz - r) / CELL)
    const z1 = Math.floor((solid.cz + r) / CELL)
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const k = this.key(ix, iz)
        const list = this.cells.get(k)
        if (list) list.push(solid)
        else this.cells.set(k, [solid])
      }
    }
  }

  private near(x: number, z: number): Solid[] | undefined {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)))
  }

  /**
   * Altura do telhado mais alto sob (x, z), ou -Infinity se não há edificação ali.
   * Para telhados em pirâmide, interpola linearmente das bordas até a cumeeira.
   */
  roofAt(x: number, z: number): number {
    const list = this.near(x, z)
    if (!list) return -Infinity
    let best = -Infinity
    for (const b of list) {
      const dx = x - b.cx
      const dz = z - b.cz
      const lx = dx * b.c - dz * b.s
      const lz = dx * b.s + dz * b.c
      if (Math.abs(lx) > b.hw || Math.abs(lz) > b.hd) continue
      let top = b.top
      if (b.pitched && b.roofHeight > 0) {
        // Fração da distância até a borda (0 = centro, 1 = borda)
        const u = Math.abs(lx) / b.hw
        const v = Math.abs(lz) / b.hd
        const edgeFrac = Math.max(u, v)
        // Pirâmide: base na borda, cumeeira no centro
        const eave = b.top - b.roofHeight
        top = b.top - b.roofHeight * edgeFrac
        // Sanity: nunca abaixo do eave
        if (top < eave) top = eave
      }
      if (top > best) best = top
    }
    return best
  }

  /**
   * Se o ponto (com folga `margin`) está dentro de alguma edificação abaixo do topo,
   * devolve a normal horizontal de saída (mundo) e a profundidade da penetração.
   */
  push(x: number, y: number, z: number, margin: number, out: WallHit): boolean {
    const list = this.near(x, z)
    if (!list) return false
    for (const b of list) {
      if (y >= b.top || y < b.base) continue
      const dx = x - b.cx
      const dz = z - b.cz
      const lx = dx * b.c - dz * b.s
      const lz = dx * b.s + dz * b.c
      const px = b.hw + margin - Math.abs(lx)
      const pz = b.hd + margin - Math.abs(lz)
      if (px <= 0 || pz <= 0) continue
      // Se o ponto está acima do eave mas o telhado é pirâmide, pode estar fora
      if (b.pitched && b.roofHeight > 0) {
        const u = Math.abs(lx) / b.hw
        const v = Math.abs(lz) / b.hd
        const edgeFrac = Math.max(u, v)
        const localTop = b.top - b.roofHeight * edgeFrac
        if (y > localTop) continue
      }
      let nxl = 0
      let nzl = 0
      if (px < pz) {
        nxl = lx >= 0 ? 1 : -1
        out.depth = px
      } else {
        nzl = lz >= 0 ? 1 : -1
        out.depth = pz
      }
      out.nx = nxl * b.c + nzl * b.s
      out.nz = -nxl * b.s + nzl * b.c
      out.top = b.top
      return true
    }
    return false
  }
}
