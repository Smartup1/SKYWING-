/**
 * Geração determinística das cidades: edificações, poleiros de pouso, praças, árvores, postes e
 * faixas de tráfego. Nada aqui depende de three.js ou do DOM — o mesmo resultado alimenta a malha
 * (cities.ts), a colisão do voo (CityColliders) e os testes.
 */
import { CITY_SITES, type CitySite } from './cityLayout'
import { hash2, heightAt, surfaceAt } from './terrain'

export type BuildingKind = 'house' | 'shop' | 'block' | 'tower' | 'church'

/** Segundo volume: recuo no alto de uma torre ou campanário de igreja. */
export type Upper = {
  /** Deslocamento no referencial da edificação. */
  ox: number
  oz: number
  width: number
  depth: number
  /** Se `fromGround`, altura total a partir do chão; senão, altura acima do volume principal. */
  height: number
  fromGround: boolean
  spire: boolean
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
  /** Telhado em pirâmide (casas, igreja) ou laje plana (comércio, prédios, torre). */
  pitched: boolean
  roofHeight: number
  color: number
  roofColor: number
  upper?: Upper
  /** Altura da antena no topo (0 = sem antena). */
  antenna: number
}

/** Poleiro: laje plana marcada para pouso, com bônus. */
export type Perch = { id: number; site: number; x: number; y: number; z: number; radius: number }
export type Plaza = { site: number; x: number; z: number; rotation: number; size: number }
export type TreeSpot = { x: number; z: number; ground: number; scale: number; tone: number }
export type LampSpot = { x: number; z: number; ground: number }
export type Lane = { site: number; ax: number; az: number; bx: number; bz: number; length: number; heights: Float32Array }

export type CityData = {
  buildings: Building[]
  perches: Perch[]
  plazas: Plaza[]
  trees: TreeSpot[]
  lamps: LampSpot[]
  lanes: Lane[]
}

export const LANE_STEP = 8

export function localToWorld(site: CitySite, x: number, z: number): [number, number] {
  const a = site.seed * 0.017
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [site.x + x * c + z * s, site.z - x * s + z * c]
}

const BODY_COLORS = [0xd0c8b7, 0xd9d3c5, 0xb9c5c3, 0xd5c0a1, 0xc5b8a6, 0xaebdc4]
const HOUSE_COLORS = [0xe8d8b8, 0xd9a98a, 0xc6d3a8, 0xa9c4d6, 0xe3c0c0, 0xf0e2a8, 0xd8d0c4]
const ROOF_COLORS = [0x834c39, 0x6b4140, 0xa05e42, 0x544f4a, 0x3c5555]
const FLAT_ROOF_COLORS = [0x6a6d70, 0x7a7770, 0x585d62, 0x8a8478]

const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]

export function generateCity(sites: readonly CitySite[] = CITY_SITES): CityData {
  const data: CityData = { buildings: [], perches: [], plazas: [], trees: [], lamps: [], lanes: [] }
  for (const [si, site] of sites.entries()) generateSite(data, site, si)
  return data
}

function generateSite(data: CityData, site: CitySite, si: number): void {
  const cx = Math.floor(site.columns / 2)
  const cz = Math.floor(site.rows / 2)
  const plazaCell = site.kind === 'city' ? [cx - 2, cz] : [cx, cz]
  const churchCell = site.kind === 'city' ? [cx + 2, cz - 1] : [cx + 1, cz]
  const maxFoot = site.spacing - 11
  const rot0 = site.seed * 0.017
  const first = data.buildings.length

  for (let c = 0; c < site.columns; c += 1) {
    for (let r = 0; r < site.rows; r += 1) {
      const lx = (c - (site.columns - 1) / 2) * site.spacing + (hash2(c, r, site.seed + 1) - 0.5) * 3
      const lz = (r - (site.rows - 1) / 2) * site.spacing + (hash2(c, r, site.seed + 2) - 0.5) * 3
      const [x, z] = localToWorld(site, lx, lz)
      const ground = heightAt(x, z)
      if (c === plazaCell[0] && r === plazaCell[1]) {
        if (ground > 1) data.plazas.push({ site: si, x, z, rotation: rot0, size: site.spacing - 9 })
        continue
      }
      if (ground < 0.8) continue
      const isTower = site.kind === 'city' && c === cx && r === cz
      const isChurch = c === churchCell[0] && r === churchCell[1]
      if (!isTower && !isChurch && hash2(c, r, site.seed) < (site.kind === 'city' ? 0.1 : 0.15)) continue
      const ring = Math.hypot(lx, lz) / site.radius
      const h = (k: number) => hash2(c, r, site.seed + k)

      let kind: BuildingKind
      if (isTower) kind = 'tower'
      else if (isChurch) kind = 'church'
      else if (site.kind === 'city') kind = ring < 0.72 ? (h(9) < 0.3 ? 'shop' : 'block') : h(9) < 0.4 ? 'shop' : 'house'
      else kind = ring < 0.5 ? (h(9) < 0.55 ? 'shop' : 'house') : 'house'

      let width: number
      let depth: number
      let height: number
      switch (kind) {
        case 'tower':
          width = maxFoot
          depth = maxFoot
          height = 40 + h(3) * 6
          break
        case 'church':
          width = Math.min(9, maxFoot)
          depth = Math.min(15, maxFoot)
          height = 9
          break
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
        default:
          width = 7 + h(4) * 3.2
          depth = 7 + h(5) * 3.5
          height = 5 + h(3) * 3.6
      }
      const pitched = kind === 'house' || kind === 'church'
      const roofHeight = kind === 'church' ? 5 : pitched ? 2.6 + h(10) * 1.6 : 0.4
      const b: Building = {
        site: si,
        kind,
        x,
        z,
        ground,
        width,
        depth,
        height,
        rotation: rot0 + (h(6) - 0.5) * 0.1,
        pitched,
        roofHeight,
        color: kind === 'house' ? pick(HOUSE_COLORS, h(7)) : kind === 'church' ? 0xefe8d8 : pick(BODY_COLORS, h(7)),
        roofColor: pitched ? (kind === 'church' ? 0x8a3f33 : pick(ROOF_COLORS, h(8))) : pick(FLAT_ROOF_COLORS, h(8)),
        antenna: 0,
      }
      if (kind === 'tower') {
        b.upper = { ox: 0, oz: 0, width: width * 0.6, depth: depth * 0.6, height: 14 + h(11) * 8, fromGround: false, spire: false }
        b.antenna = 8 + h(12) * 4
      } else if (kind === 'church') {
        b.upper = { ox: 0, oz: depth / 2 - 2.6, width: 5, depth: 5, height: 22, fromGround: true, spire: true }
      } else if (kind === 'block' && ring < 0.42 && h(13) < 0.35) {
        b.antenna = 4 + h(14) * 4
      }
      data.buildings.push(b)
    }
  }

  generatePerches(data, site, si, first)
  generateStreets(data, site, si)
  generatePlazaTrees(data, si)
}

function generatePerches(data: CityData, site: CitySite, si: number, first: number): void {
  const want = site.kind === 'city' ? 6 : 3
  const candidates: { b: Building; y: number; radius: number; key: number }[] = []
  for (let i = first; i < data.buildings.length; i += 1) {
    const b = data.buildings[i]
    if (b.pitched || b.height < 6) continue
    const up = b.upper
    const top = b.ground + b.height + (up && !up.fromGround ? up.height : 0)
    const radius = (up && !up.fromGround ? Math.min(up.width, up.depth) : Math.min(b.width, b.depth)) / 2 - 1
    if (radius < 2.2) continue
    // A torre central e prédios altos aparecem primeiro; o resto vem em ordem espalhada.
    const key = b.kind === 'tower' ? -1 : hash2(i, si, 555)
    const px = up && !up.fromGround ? b.x + up.ox * Math.cos(b.rotation) + up.oz * Math.sin(b.rotation) : b.x
    const pz = up && !up.fromGround ? b.z - up.ox * Math.sin(b.rotation) + up.oz * Math.cos(b.rotation) : b.z
    candidates.push({ b: { ...b, x: px, z: pz }, y: top, radius, key })
  }
  candidates.sort((a, b) => a.key - b.key)
  const chosen: Perch[] = []
  for (const cand of candidates) {
    if (chosen.length >= want) break
    if (chosen.some(p => Math.hypot(p.x - cand.b.x, p.z - cand.b.z) < 55)) continue
    chosen.push({ id: data.perches.length + chosen.length, site: si, x: cand.b.x, y: cand.y, z: cand.b.z, radius: Math.min(5, cand.radius) })
  }
  data.perches.push(...chosen)
}

function generateStreets(data: CityData, site: CitySite, si: number): void {
  const ex = (site.columns * site.spacing) / 2
  const ez = (site.rows * site.spacing) / 2
  const sp = site.spacing
  const addTree = (lx: number, lz: number, seed: number) => {
    const [x, z] = localToWorld(site, lx, lz)
    const ground = heightAt(x, z)
    if (ground < 1) return
    data.trees.push({ x, z, ground, scale: 0.8 + hash2(seed, si, 601) * 0.7, tone: hash2(seed, si, 602) })
  }
  let n = 0
  // Linhas verticais (x constante) e horizontais (z constante): árvores nas calçadas e postes a meio de quarteirão.
  for (let c = 0; c <= site.columns; c += 1) {
    const lx = (c - site.columns / 2) * sp
    for (let t = sp * 0.5; t < 2 * ez; t += 12) {
      const m = t % sp
      if (m < 6 || m > sp - 6) continue
      n += 1
      const lz = t - ez
      if (hash2(n, c, 603 + si) < 0.5) addTree(lx + (hash2(n, 1, 604) < 0.5 ? -3.3 : 3.3), lz, n)
      if (Math.abs(m - sp / 2) < 6 && c % 2 === 0) pushLamp(data, site, lx + 3.4, lz)
    }
  }
  for (let r = 0; r <= site.rows; r += 1) {
    const lz = (r - site.rows / 2) * sp
    for (let t = sp * 0.5; t < 2 * ex; t += 12) {
      const m = t % sp
      if (m < 6 || m > sp - 6) continue
      n += 1
      const lx = t - ex
      if (hash2(n, r, 605 + si) < 0.5) addTree(lx, lz + (hash2(n, 2, 606) < 0.5 ? -3.3 : 3.3), n)
      if (Math.abs(m - sp / 2) < 6 && r % 2 === 1) pushLamp(data, site, lx, lz + 3.4)
    }
  }
  // Faixas de tráfego (mão dupla) para os carros que circulam.
  for (let c = 0; c <= site.columns; c += 1) {
    const lx = (c - site.columns / 2) * sp
    pushLane(data, site, si, [lx - 1.4, -ez], [lx - 1.4, ez])
    pushLane(data, site, si, [lx + 1.4, ez], [lx + 1.4, -ez])
  }
  for (let r = 0; r <= site.rows; r += 1) {
    const lz = (r - site.rows / 2) * sp
    pushLane(data, site, si, [-ex, lz + 1.4], [ex, lz + 1.4])
    pushLane(data, site, si, [ex, lz - 1.4], [-ex, lz - 1.4])
  }
}

function pushLamp(data: CityData, site: CitySite, lx: number, lz: number): void {
  const [x, z] = localToWorld(site, lx, lz)
  const ground = heightAt(x, z)
  if (ground > 1) data.lamps.push({ x, z, ground })
}

function pushLane(data: CityData, site: CitySite, si: number, a: [number, number], b: [number, number]): void {
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
  data.lanes.push({ site: si, ax, az, bx, bz, length, heights })
}

function generatePlazaTrees(data: CityData, si: number): void {
  for (const plaza of data.plazas) {
    if (plaza.site !== si) continue
    const c = Math.cos(plaza.rotation)
    const s = Math.sin(plaza.rotation)
    const half = plaza.size / 2 - 2.2
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        if (i === 0 && j === 0) continue
        const lx = i * half
        const lz = j * half
        const x = plaza.x + lx * c + lz * s
        const z = plaza.z - lx * s + lz * c
        data.trees.push({ x, z, ground: heightAt(x, z), scale: 1 + hash2(i + 5, j + 5, 611) * 0.5, tone: hash2(i, j, 612) })
      }
    }
  }
}

// --- Colisão ----------------------------------------------------------------------------------

type Solid = { cx: number; cz: number; hw: number; hd: number; c: number; s: number; base: number; top: number }

export type WallHit = { nx: number; nz: number; depth: number; top: number }

const CELL = 24

/** Caixas orientadas das edificações em uma grade espacial: telhados para pouso e paredes para batidas. */
export class CityColliders {
  private readonly cells = new Map<number, Solid[]>()
  readonly count: number

  constructor(buildings: readonly Building[]) {
    let n = 0
    for (const b of buildings) {
      const c = Math.cos(b.rotation)
      const s = Math.sin(b.rotation)
      this.add({ cx: b.x, cz: b.z, hw: b.width / 2, hd: b.depth / 2, c, s, base: b.ground - 4, top: b.ground + b.height + (b.pitched ? b.roofHeight * 0.35 : 0.2) })
      n += 1
      if (b.upper) {
        const u = b.upper
        const ux = b.x + u.ox * c + u.oz * s
        const uz = b.z - u.ox * s + u.oz * c
        const base = u.fromGround ? b.ground - 4 : b.ground + b.height - 0.5
        const top = (u.fromGround ? b.ground : b.ground + b.height) + u.height + (u.spire ? 4 : 0)
        this.add({ cx: ux, cz: uz, hw: u.width / 2, hd: u.depth / 2, c, s, base, top })
        n += 1
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

  /** Altura do telhado mais alto sob (x, z), ou -Infinity se não há edificação ali. */
  roofAt(x: number, z: number): number {
    const list = this.near(x, z)
    if (!list) return -Infinity
    let best = -Infinity
    for (const b of list) {
      const dx = x - b.cx
      const dz = z - b.cz
      const lx = dx * b.c - dz * b.s
      const lz = dx * b.s + dz * b.c
      if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd && b.top > best) best = b.top
    }
    return best
  }

  /**
   * Se o ponto (com folga `margin`) está dentro de alguma edificação abaixo do topo, devolve a
   * normal horizontal de saída (mundo) e a profundidade da penetração.
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
