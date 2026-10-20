import * as THREE from 'three'
import type { Assets } from '../engine/assets'
import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { QUALITY_PRESETS } from '../engine/renderer'
import type { Quality, SaveStore } from '../engine/save'
import { Atmosphere } from './atmosphere'
import { Bird } from './bird'
import { Cities } from './cities'
import { CITY_SITES, citySiteAt } from './cityLayout'
import { HawkDirector, type EscapeReason, type PlayerView } from './hawks'
import { MissionBoard, type Mission, type MissionEvent } from './missions'
import { Score } from './score'
import { CameraRig, type CamMode } from './cameraRig'
import { Collectibles } from './collectibles'
import { CONFIG } from './config'
import { getBirdSpecies, type BirdSpeciesId } from './birdSpecies'
import { createSkyState, hourForMode, skyAt } from './daylight'
import { Fauna } from './fauna'
import { FlightModel, type FlightEnv, type FlightEvent, type FlightInput } from './flight'
import { Forest } from './forest'
import { Fx } from './fx'
import { compassName, createRun, discover, DISCOVERY_IDS, formatClock, kmh, NEST_COUNT, type DiscoveryId, type RunState } from './rules'
import { Clouds, Sky } from './sky'
import { heightAt, LAKE, surfaceAt, WATER_LEVEL } from './terrain'
import { TerrainManager, Water } from './terrainMesh'
import { tuning } from './tuning'

export type Warning = 'hawk' | 'stall' | 'edge' | 'tired' | 'ceiling'

export type HudData = {
  speedKmh: number
  altitude: number
  agl: number
  stamina: number
  seeds: number
  seedsGoal: number
  discoveries: number
  discoveryTotal: number
  windRel: number
  windSpeedKmh: number
  vario: number
  heading: number
  compass: string
  clock: string
  cruise: boolean
  grounded: boolean
  camera: CamMode
  nearestSeed: { meters: number; bearing: number; pitch: number } | null
  warnings: Warning[]
  boosting: boolean
  score: number
  best: number
  combo: number
  comboLeft: number
  mission: { text: string; progress: number; target: number }
  hawk: { phase: 'stalk' | 'stoop' | 'recover'; meters: number; bearing: number; pitch: number; danger: number } | null
  perch: { meters: number; bearing: number; name: string } | null
  landing: boolean
  hit: boolean
}

export interface UiBridge {
  toast(text: string, tone?: 'good' | 'warn' | 'info'): void
  hint(text: string): void
  hud(data: HudData): void
  discovered(id: DiscoveryId): void
}

export type GameState = 'loading' | 'title' | 'playing' | 'paused'

const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const START = { x: LAKE.x + 40, z: LAKE.z - 330, yaw: Math.PI }

export class Game {
  readonly scene = new THREE.Scene()
  readonly rig = new CameraRig()
  readonly atm = new Atmosphere()
  readonly flight = new FlightModel()
  bird: Bird
  state: GameState = 'loading'
  run: RunState
  hour: number
  private readonly sky = createSkyState()
  private readonly skyDome = new Sky()
  private terrain!: TerrainManager
  private water!: Water
  private cities!: Cities
  private forest!: Forest
  private clouds!: Clouds
  private collectibles!: Collectibles
  private fauna!: Fauna
  private fx!: Fx
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3)
  private readonly moon = new THREE.DirectionalLight(0x8fa6ff, 0.3)
  private readonly hemi = new THREE.HemisphereLight(0xaad0ff, 0x5a4a30, 0.8)
  private readonly fog = new THREE.FogExp2(0xaaccee, 0.00042)
  private readonly drift = new THREE.Vector2()
  private readonly airVel = new THREE.Vector3()
  private readonly tmpV = new THREE.Vector3()
  private readonly prevPos = new THREE.Vector3()
  private readonly currPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly currQuat = new THREE.Quaternion()
  private readonly renderQuat = new THREE.Quaternion()
  private readonly renderPos = new THREE.Vector3()
  private readonly events: FlightEvent[] = []
  private quality: Quality
  private time = 0
  private hudTimer = 0
  private vario = 0
  private skimTime = 0
  private thermalIdle = 0
  private hintsShown = new Set<string>()
  private skimFxTimer = 0
  private crashCooldown = 0
  readonly score = new Score()
  readonly missions = new MissionBoard(CITY_SITES.length)
  private hawks!: HawkDirector
  private readonly visitedPerches = new Set<number>()
  private readonly citiesSeen = new Set<number>()
  private lastSite = -1
  private hitFlash = 0
  private readonly env: FlightEnv = {
    surface: surfaceAt,
    wind: (out, x, y, z) => this.atm.sample(out, x, y, z),
    roof: (x, z) => (this.cities ? this.cities.colliders.roofAt(x, z) : -Infinity),
    wall: (x, y, z, m, out) => (this.cities ? this.cities.colliders.push(x, y, z, m, out) : false),
  }
  onStateChange?: (s: GameState) => void

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly save: SaveStore,
    private readonly i18n: I18n,
    private readonly assets: Assets,
    private readonly ui: UiBridge,
  ) {
    this.quality = save.data.quality
    this.bird = new Bird(getBirdSpecies(save.data.birdId))
    this.flight.setProfile(this.bird.species.flight)
    this.flight.assisted = save.data.flightAssist
    this.hour = CONFIG.time.startHour
    this.run = createRun(save.data.discoveries as DiscoveryId[])
    this.scene.fog = this.fog
    this.scene.add(this.skyDome.mesh)
    this.scene.add(this.sun, this.sun.target, this.moon, this.hemi)
    this.scene.add(this.bird.group)
    this.rig.reducedMotion = save.data.reducedMotion
    this.input.sensitivity = save.data.sensitivity
    this.input.invertY = save.data.invertY
    this.flight.cruise = save.data.cruise
    this.missions.allowHawk = save.data.hawks
    this.missions.reset()
  }

  /** Constrói o mundo inteiro em etapas, informando progresso (0–1) e a legenda atual. */
  async init(onProgress: (p: number, label: string) => void): Promise<void> {
    const t = (key: Parameters<I18n['t']>[0]) => this.i18n.t(key)
    this.terrain = new TerrainManager()
    this.scene.add(this.terrain.group)
    this.water = new Water()
    this.scene.add(this.water.mesh)

    onProgress(0.02, t('loading_terrain'))
    await this.terrain.buildAll(START.x, START.z, p => onProgress(0.02 + p * 0.28, t('loading_terrain')))
    await this.water.bake(p => onProgress(0.3 + p * 0.1, t('loading_terrain')))

    this.cities = new Cities()
    this.scene.add(this.cities.group)

    this.forest = new Forest()
    this.scene.add(this.forest.group)
    await this.forest.load(this.assets, p => onProgress(0.4 + p * 0.35, t('loading_trees')))
    this.forest.forceRebuild(START.x, START.z, this.densityFor(this.quality))

    onProgress(0.78, t('loading_life'))
    this.clouds = new Clouds(this.atm.thermals)
    this.scene.add(this.clouds.points)
    this.collectibles = new Collectibles(this.forest, {
      onSeed: p => this.onSeed(p),
      onNest: (i, p) => this.onNest(i, p),
      onSummit: p => this.onSummit(p),
    })
    this.scene.add(this.collectibles.group)
    this.collectibles.resetSeeds(CONFIG.seeds.count)
    this.collectibles.restoreFound(
      [...this.run.discoveries].filter(d => d.startsWith('nest')).map(d => Number(d.slice(4))),
      this.run.discoveries.has('summit'),
    )
    this.fauna = new Fauna(this.atm, {
      onCall: (pan, kind) => {
        const n = kind === 'scatter' ? 5 : 3
        for (let i = 0; i < n; i += 1) window.setTimeout(() => this.audio.flockCall(pan + (Math.random() - 0.5) * 0.4), i * 90)
      },
    })
    this.scene.add(this.fauna.mesh)
    this.hawks = new HawkDirector(
      this.fauna.hunter,
      { ground: surfaceAt, roof: (x, z) => this.cities.colliders.roofAt(x, z) },
      {
        warn: pan => this.onHawkWarn(pan),
        stoop: pan => this.audio.hawkScreech(pan, true),
        dodge: () => this.onDodge(),
        hit: dir => this.onHawkHit(dir),
        escaped: reason => this.onHawkEscaped(reason),
      },
    )
    this.hawks.enabled = this.save.data.hawks
    this.fx = new Fx(this.atm.thermals)
    this.scene.add(this.fx.group)

    this.applyQuality(this.quality)
    this.resetFlight(false)
    this.applySky(0)
    onProgress(0.94, t('loading_life'))
    // Pré-compila shaders para evitar engasgo no primeiro quadro.
    this.rig.update(0.016, this.camTarget(), { x: 0, y: 0 }, this.renderer.canvas.clientWidth, this.renderer.canvas.clientHeight, true)
    this.renderer.gl.compile(this.scene, this.rig.camera)
    onProgress(1, t('loading'))
    this.setState('title')
  }

  private densityFor(q: Quality): number {
    return q === 'low' ? 0.55 : q === 'medium' ? 0.85 : 1
  }

  applyQuality(q: Quality): void {
    this.quality = q
    this.renderer.applyQuality(q)
    const preset = QUALITY_PRESETS[q]
    this.sun.castShadow = preset.shadows
    this.sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
    const sc = this.sun.shadow.camera
    sc.left = -80
    sc.right = 80
    sc.top = 80
    sc.bottom = -80
    sc.near = 20
    sc.far = 800
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.5
    this.forest?.setShadows(preset.shadows)
    if (this.forest) {
      this.forest.nearTreeRadius = q === 'low' ? 55 : q === 'medium' ? 75 : 90
      this.forest.farRadius = q === 'low' ? 700 : q === 'medium' ? 850 : 950
      this.forest.forceRebuild(this.flight.pos.x, this.flight.pos.z, this.densityFor(q))
    }
    this.bird.group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = preset.shadows
    })
  }

  setState(s: GameState): void {
    this.state = s
    this.input.enabled = s === 'playing'
    if (s !== 'playing') this.input.clearPressed()
    this.onStateChange?.(s)
  }

  /** Posiciona o pássaro no ponto de partida e reinicia a contagem do voo. */
  resetFlight(newRun: boolean): void {
    if (newRun) {
      tuning.activate('run')
      const known = this.save.data.discoveries as DiscoveryId[]
      this.run = createRun(known)
      this.collectibles.resetSeeds(CONFIG.seeds.count)
      this.collectibles.restoreFound(
        known.filter(d => d.startsWith('nest')).map(d => Number(d.slice(4))),
        known.includes('summit'),
      )
      this.run.seedsGoal = this.collectibles.total
    } else {
      this.run.seedsGoal = this.collectibles.total
    }
    const y = surfaceAt(START.x, START.z) + 60
    this.flight.reset(START.x, y, START.z, START.yaw, CONFIG.flight.cruiseSpeed * this.flight.profile.cruiseSpeed + 1)
    this.flight.stamina = CONFIG.stamina.max
    this.syncPrev()
    this.rig.snap()
    this.skimTime = 0
    this.thermalIdle = 0
    if (newRun || this.state !== 'playing') {
      this.score.reset()
      this.visitedPerches.clear()
      this.citiesSeen.clear()
      this.lastSite = -1
      this.hitFlash = 0
      this.missions.allowHawk = this.save.data.hawks
      this.missions.reset()
      this.cities?.setVisited([])
      this.hawks?.reset()
    }
  }

  private syncPrev(): void {
    this.prevPos.copy(this.flight.pos)
    this.currPos.copy(this.flight.pos)
    _euler.set(this.flight.pitch, this.flight.yaw, this.flight.roll, 'YXZ')
    this.currQuat.setFromEuler(_euler)
    this.prevQuat.copy(this.currQuat)
  }

  // --- Simulação em passo fixo ----------------------------------------------------------------

  step(dt: number): void {
    if (this.state === 'loading' || this.state === 'paused') return
    this.time += dt
    this.atm.update(dt)
    this.input.update(dt)
    this.advanceClock(dt)
    this.prevPos.copy(this.currPos)
    this.prevQuat.copy(this.currQuat)
    const inp = this.state === 'title' ? this.attractInput() : this.playerInput()
    this.events.length = 0
    this.flight.step(dt, inp, this.env, this.events)
    this.currPos.copy(this.flight.pos)
    _euler.set(this.flight.pitch, this.flight.yaw, this.flight.roll, 'YXZ')
    this.currQuat.setFromEuler(_euler)
    this.handleFlightEvents()
    this.fauna.update(dt, this.time, this.flight.pos, this.flight.vel, this.flight.forward)
    if (this.state === 'playing') {
      this.gameplay(dt)
      this.updateHawks(dt)
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt)
  }

  private playerInput(): FlightInput {
    return {
      pitch: this.input.pitch,
      bank: this.input.bank,
      roll: this.input.roll,
      flap: this.input.flap,
      flapPressed: this.input.consume('flapPressed'),
      boost: this.input.boost,
      land: this.input.land,
    }
  }

  /** Piloto automático da tela inicial: círculo suave sobre o lago. */
  private attractInput(): FlightInput {
    const f = this.flight
    const dx = f.pos.x - LAKE.x
    const dz = f.pos.z - LAKE.z
    const r = Math.hypot(dx, dz)
    const theta = Math.atan2(dz, dx)
    // Tangente anti-horária no plano XZ, corrigida para manter o raio de ~260 m.
    const ang = theta + Math.PI / 2 - THREE.MathUtils.clamp((260 - r) / 260, -0.8, 0.8) * 0.9
    const wantedYaw = Math.atan2(-Math.cos(ang), -Math.sin(ang))
    const diff = Math.atan2(Math.sin(wantedYaw - f.yaw), Math.cos(wantedYaw - f.yaw))
    const targetAlt = surfaceAt(f.pos.x, f.pos.z) + 62
    const pitch = THREE.MathUtils.clamp((targetAlt - f.pos.y) * 0.02 - f.vel.y * 0.05, -0.5, 0.5)
    return { pitch, bank: THREE.MathUtils.clamp(diff * 1.6, -0.7, 0.7), roll: 0, flap: false, flapPressed: false, boost: false }
  }

  private advanceClock(dt: number): void {
    const hoursPerSecond = 24 / (CONFIG.time.dayMinutes * 60)
    this.hourAuto += dt * hoursPerSecond
    this.hourAuto %= 24
  }

  private hourAuto = CONFIG.time.startHour

  private handleFlightEvents(): void {
    const f = this.flight
    const overWater = heightAt(f.pos.x, f.pos.z) < WATER_LEVEL - 0.1
    for (const e of this.events) {
      switch (e.type) {
        case 'flap':
          this.audio.flap(e.power)
          break
        case 'takeoff':
          this.fx.burst(this.tmpV.copy(f.pos).setY(f.pos.y - 0.2), 'dust', 0.8)
          this.fx.burst(f.pos, 'feather', 0.3)
          break
        case 'bump':
          this.audio.bump()
          this.fx.burst(f.pos, 'feather', 0.4)
          break
        case 'land':
          this.audio.land()
          if (overWater) {
            this.audio.splash()
            this.fx.burst(f.pos, 'spray', 1.2)
          } else {
            this.fx.burst(f.pos, 'dust', 0.8)
          }
          if (this.state === 'playing') this.onLanded(e.hs, e.down)
          break
        case 'crash':
          this.audio.crash()
          this.fx.burst(f.pos, 'feather', 1.4)
          this.fx.burst(f.pos, overWater ? 'spray' : 'dust', 1.2)
          if (overWater) this.audio.splash()
          if (this.state === 'playing' && this.crashCooldown <= 0) {
            this.ui.toast(this.i18n.t('toast_crash'), 'warn')
            this.crashCooldown = 2
          }
          break
        case 'skim':
          this.skimTrail(overWater, e.speed)
          break
        case 'stall':
          this.audio.stall()
          break
      }
    }
    this.crashCooldown -= 1 / 60
  }

  private skimTrail(overWater: boolean, speed: number): void {
    this.skimFxTimer -= 1 / 60
    if (this.skimFxTimer > 0) return
    this.skimFxTimer = 0.07
    const p = this.tmpV.copy(this.flight.pos)
    p.y = surfaceAt(p.x, p.z) + 0.1
    this.fx.trail(p, this.flight.vel, overWater ? 'spray' : 'dust')
    if (overWater && Math.random() < 0.15) this.audio.splash()
    void speed
  }

  private gameplay(dt: number): void {
    const f = this.flight
    this.run.seconds += dt
    this.run.distance += f.vel.length() * dt
    this.run.maxAltitude = Math.max(this.run.maxAltitude, f.pos.y)
    this.run.maxSpeed = Math.max(this.run.maxSpeed, f.vel.length())
    this.collectibles.update(dt, this.viewScale(), f.pos, this.sky.daylight)
    this.atm.sample(this.airVel, f.pos.x, f.pos.y, f.pos.z)
    this.vario += (f.vel.y - this.vario) * Math.min(1, dt * 3)
    this.score.update(dt)
    if (!f.grounded) this.noteMission({ type: 'speed', kmh: kmh(f.vel.length()) })

    // Chegada a uma cidade.
    const site = citySiteAt(f.pos.x, f.pos.z, 0.9)
    if (site !== this.lastSite) {
      this.lastSite = site
      if (site >= 0) this.onEnterCity(site)
    }

    // Rasante no lago.
    const overWater = heightAt(f.pos.x, f.pos.z) < WATER_LEVEL - 0.3
    if (overWater && !f.grounded && f.agl < 4.5 && f.vel.length() > 8) {
      this.skimTime += dt
      this.noteMission({ type: 'skim', seconds: dt })
      if (this.skimTime > 1.4 && discover(this.run, 'skim')) this.onDiscovery('skim')
      if (f.agl < 2.2 && Math.random() < dt * 5) {
        const p = this.tmpV.set(f.pos.x, WATER_LEVEL + 0.05, f.pos.z)
        this.fx.burst(p, 'spray', 0.25, f.vel)
      }
    } else {
      this.skimTime = Math.max(0, this.skimTime - dt * 0.5)
    }

    // Térmica: ganho acumulado dentro de ar ascendente.
    if (this.airVel.y > 1.2 && !f.grounded) {
      this.thermalIdle = 0
      this.run.thermalGain += Math.max(0, f.vel.y) * dt
      if (this.run.thermalGain >= 90 && discover(this.run, 'thermal')) this.onDiscovery('thermal')
      if (!this.hintsShown.has('thermal') && this.airVel.y > 2.2) {
        this.hintsShown.add('thermal')
        this.ui.hint(this.i18n.t('hint_thermal'))
      }
    } else {
      this.thermalIdle += dt
      if (this.thermalIdle > 5) this.run.thermalGain = 0
    }
    if (!this.hintsShown.has('ridge') && this.airVel.y > 1.4 && f.agl < 60) {
      this.hintsShown.add('ridge')
      this.ui.hint(this.i18n.t('hint_ridge'))
    }

    // Voar com o bando.
    if (this.fauna.companions >= 3) {
      this.run.flockSeconds += dt
      if (this.run.flockSeconds >= 6 && discover(this.run, 'flock')) this.onDiscovery('flock')
    } else {
      this.run.flockSeconds = Math.max(0, this.run.flockSeconds - dt * 0.5)
    }

    if (!this.hintsShown.has('landed') && f.grounded) {
      this.hintsShown.add('landed')
      this.ui.hint(this.i18n.t('hint_landed'))
    }
  }

  private onDiscovery(id: DiscoveryId): void {
    this.ui.discovered(id)
    this.save.update({ discoveries: [...this.run.discoveries] })
    this.audio.discover()
  }

  private onSeed(p: THREE.Vector3): void {
    if (this.state !== 'playing') return
    this.run.seeds += 1
    const pts = this.award(100, true)
    this.noteMission({ type: 'seed' })
    this.audio.seed()
    this.fx.burst(p, 'seed', 1)
    this.save.update({ totalSeeds: this.save.data.totalSeeds + 1, bestSeeds: Math.max(this.save.data.bestSeeds, this.run.seeds) })
    this.flight.stamina = Math.min(CONFIG.stamina.max, this.flight.stamina + 6)
    if (this.run.seeds >= this.run.seedsGoal) {
      this.ui.toast(this.i18n.t('hud_all_seeds'), 'good')
      this.audio.discover()
    } else {
      this.ui.toast(this.i18n.t('toast_seed_pts', { n: this.run.seeds, total: this.run.seedsGoal, pts }), 'good')
    }
  }

  private onNest(index: number, p: THREE.Vector3): void {
    if (this.state !== 'playing') return
    const id = `nest${index}` as DiscoveryId
    if (!discover(this.run, id)) return
    this.audio.nestChicks()
    this.fx.burst(p, 'sparkle', 1.4)
    this.onDiscovery(id)
  }

  private onSummit(p: THREE.Vector3): void {
    if (this.state !== 'playing') return
    if (!discover(this.run, 'summit')) return
    this.fx.burst(p, 'sparkle', 2)
    this.onDiscovery('summit')
  }

  // --- Pontos, missões, cidades e pouso ---------------------------------------------------------

  /** Soma pontos e guarda o recorde. */
  private award(base: number, chained = false): number {
    const gained = this.score.award(base, chained)
    if (this.score.points > this.save.data.bestScore) this.save.update({ bestScore: this.score.points })
    return gained
  }

  private noteMission(ev: MissionEvent): void {
    const done = this.missions.note(ev)
    if (!done) return
    const pts = this.award(done.reward)
    this.audio.mission()
    this.ui.toast(this.i18n.t('toast_mission_done', { pts }), 'good')
  }

  missionText(m: Mission): string {
    const city = m.site !== undefined ? CITY_SITES[m.site].name : ''
    switch (m.kind) {
      case 'seeds': return this.i18n.t('mission_seeds', { n: m.target })
      case 'perch': return this.i18n.t('mission_perch', { city })
      case 'city': return this.i18n.t('mission_city', { city })
      case 'escape': return this.i18n.t('mission_escape')
      case 'dodge': return this.i18n.t('mission_dodge')
      case 'speed': return this.i18n.t('mission_speed', { n: m.target })
      default: return this.i18n.t('mission_skim', { n: m.target })
    }
  }

  private onEnterCity(site: number): void {
    const name = CITY_SITES[site].name
    this.ui.toast(this.i18n.t('toast_city_enter', { name }), 'info')
    if (!this.hintsShown.has('perch')) {
      this.hintsShown.add('perch')
      this.ui.hint(this.i18n.t('hint_perch'))
    }
    if (!this.citiesSeen.has(site)) {
      this.citiesSeen.add(site)
      this.award(100)
    }
    this.noteMission({ type: 'city', site })
  }

  /** Poleiro sob o pássaro recém-pousado (mesma altura e dentro do anel). */
  private perchUnder() {
    const f = this.flight
    for (const p of this.cities.perches) {
      if (Math.hypot(f.pos.x - p.x, f.pos.z - p.z) <= p.radius + 1.2 && Math.abs(f.floorY - p.y) < 0.8) return p
    }
    return null
  }

  private onLanded(hs: number, down: number): void {
    const f = this.flight
    const perfect = down < 2.4 && hs < 8
    const perch = this.perchUnder()
    if (perch) {
      f.stamina = CONFIG.stamina.max
      this.fx.burst(this.tmpV.set(perch.x, perch.y + 0.5, perch.z), 'sparkle', 1.2)
      if (!this.visitedPerches.has(perch.id)) {
        this.visitedPerches.add(perch.id)
        this.cities.setVisited(this.visitedPerches)
        const pts = this.award(500, true)
        this.audio.perch()
        this.ui.toast(this.i18n.t('toast_perch', { city: CITY_SITES[perch.site].name, pts }), 'good')
        this.noteMission({ type: 'perch', site: perch.site })
        const id = `city${perch.site}` as DiscoveryId
        if (discover(this.run, id)) this.onDiscovery(id)
      } else {
        this.ui.toast(this.i18n.t('toast_perch_again'), 'info')
      }
    } else if (!perfect) {
      this.ui.toast(this.i18n.t('toast_land'), 'info')
    }
    if (perfect) {
      const pts = this.award(perch ? 250 : 150)
      this.ui.toast(this.i18n.t('toast_land_perfect', { pts }), 'good')
      if (discover(this.run, 'perfect')) this.onDiscovery('perfect')
    }
  }

  // --- Gavião caçador ---------------------------------------------------------------------------

  setHawks(enabled: boolean): void {
    if (this.hawks) this.hawks.enabled = enabled
    this.missions.allowHawk = enabled
    if (!enabled && (this.missions.current.kind === 'escape' || this.missions.current.kind === 'dodge')) this.missions.reset()
  }

  private updateHawks(dt: number): void {
    const f = this.flight
    const site = citySiteAt(f.pos.x, f.pos.z, 1)
    const view: PlayerView = {
      pos: f.pos,
      vel: f.vel,
      forward: f.forward,
      grounded: f.grounded,
      agl: f.agl,
      withFlock: this.fauna.companions >= 3,
      sheltered: f.grounded && site >= 0,
      inCover: site >= 0 && f.agl < 14,
      assisted: f.assisted,
    }
    this.hawks.update(dt, view)
  }

  private onHawkWarn(pan: number): void {
    this.audio.hawkScreech(pan)
    this.ui.toast(this.i18n.t('toast_hawk_warn'), 'warn')
    if (!this.hintsShown.has('hawk')) {
      this.hintsShown.add('hawk')
      this.ui.hint(this.i18n.t('hint_hawk'))
    }
  }

  private onDodge(): void {
    this.audio.dodge()
    const pts = this.award(400, true)
    this.ui.toast(this.i18n.t('toast_dodge', { pts }), 'good')
    this.noteMission({ type: 'dodge' })
    if (discover(this.run, 'dodge')) this.onDiscovery('dodge')
  }

  private onHawkHit(dir: THREE.Vector3): void {
    this.audio.crash()
    this.audio.hawkScreech(0, true)
    this.fx.burst(this.flight.pos, 'feather', 2)
    this.flight.knock(dir.x, dir.z, 6)
    this.score.breakCombo()
    this.score.penalty(150)
    this.hitFlash = 0.8
    this.ui.toast(this.i18n.t('toast_hawk_hit'), 'warn')
  }

  private onHawkEscaped(reason: EscapeReason): void {
    const pts = this.award(800, true)
    this.audio.discover()
    this.ui.toast(this.i18n.t(`toast_escape_${reason}` as 'toast_escape_timeout', { pts }), 'good')
    this.noteMission({ type: 'escape' })
    if (discover(this.run, 'hawk')) this.onDiscovery('hawk')
  }

  // --- Render --------------------------------------------------------------------------------

  private viewScale(): number {
    const h = this.renderer.gl.domElement.height
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov) / 2))
  }

  private camTarget() {
    return {
      pos: this.renderPos,
      quat: this.renderQuat,
      yaw: this.flight.yaw,
      pitch: this.flight.pitch,
      roll: this.flight.roll,
      speed: this.flight.vel.length(),
      grounded: this.flight.grounded,
    }
  }

  private applySky(dt: number): void {
    const hour = hourForMode(this.save.data.timeMode, this.hourAuto)
    this.hour = hour
    void dt
    skyAt(hour, this.sky)
    const s = this.sky
    this.fog.color.copy(s.fog)
    this.fog.density = 0.00036 + 0.00018 * (1 - s.daylight) + 0.00012 * Math.max(0, 1 - Math.abs(s.sunSin) * 6)
    this.scene.background = s.fog
    this.hemi.color.copy(s.hemiSky)
    this.hemi.groundColor.copy(s.hemiGround)
    this.hemi.intensity = s.hemiIntensity
    this.sun.color.copy(s.sunColor)
    this.sun.intensity = s.sunIntensity
    this.sun.visible = s.sunSin > 0.015
    this.moon.intensity = s.moonIntensity
    this.moon.visible = s.moonIntensity > 0.01
    this.renderer.gl.toneMappingExposure = s.exposure
  }

  render(alpha: number, frameSeconds: number): void {
    if (this.state === 'loading') return
    const dt = Math.min(frameSeconds, 0.1)
    // Ações de uma batida (câmera, cruzeiro) — só durante o voo.
    if (this.state === 'playing') {
      if (this.input.consume('camera')) {
        const mode = this.rig.next()
        this.ui.toast(this.i18n.t(`cam_${mode}` as 'cam_chase'), 'info')
      }
      if (this.input.consume('cruise')) {
        this.flight.cruise = !this.flight.cruise
        this.save.update({ cruise: this.flight.cruise })
        this.ui.toast(this.i18n.t(this.flight.cruise ? 'hud_cruise_on' : 'hud_cruise_off'), 'info')
      }
    }
    this.renderPos.lerpVectors(this.prevPos, this.currPos, alpha)
    this.renderQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha)
    this.bird.group.position.copy(this.renderPos)
    this.bird.group.quaternion.copy(this.renderQuat)
    const f = this.flight
    this.atm.sample(this.airVel, f.pos.x, f.pos.y, f.pos.z)
    const soaring = !f.flapping && this.airVel.y > 1.3
    this.bird.update(dt, {
      flapPhase: f.flapPhase,
      flapping: f.flapping,
      speed: f.vel.length(),
      pitch: f.pitch,
      roll: f.roll,
      bank: this.state === 'playing' ? this.input.bank : 0,
      stalled: f.stalled,
      grounded: f.grounded,
      soaring,
      boosting: f.boosting,
      walking: f.grounded && f.vel.lengthSq() > 0.04,
    })
    const eye = this.rig.mode === 'eye' && this.state === 'playing'
    this.bird.body.visible = !eye
    this.bird.head.visible = !eye

    this.applySky(dt)
    const look = this.state === 'playing' ? this.input.consumeLook() : { x: 0, y: 0 }
    if (this.state === 'title') {
      if (this.rig.mode !== 'orbit') this.rig.setMode('orbit')
      this.rig.shift = 0.16
    } else {
      this.rig.shift = 0
    }
    const cw = this.renderer.canvas.clientWidth || window.innerWidth
    const ch = this.renderer.canvas.clientHeight || window.innerHeight
    this.rig.update(dt, this.camTarget(), look, cw, ch, this.state === 'title')
    const cam = this.rig.camera

    // Luz do sol e sombras acompanham o pássaro.
    const snap = 2
    this.sun.target.position.set(Math.round(this.renderPos.x / snap) * snap, Math.round(this.renderPos.y / snap) * snap, Math.round(this.renderPos.z / snap) * snap)
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sky.sunDir, 380)
    this.moon.position.copy(cam.position).addScaledVector(this.sky.moonDir, 100)
    this.moon.target.position.copy(cam.position)
    this.scene.add(this.moon.target)

    // Mundo vivo.
    const agl = Math.max(0, cam.position.y - surfaceAt(cam.position.x, cam.position.z))
    this.drift.set(this.atm.windSpeed * Math.cos(this.atm.windAngle) * this.atm.time * 0.6, this.atm.windSpeed * Math.sin(this.atm.windAngle) * this.atm.time * 0.6)
    this.skyDome.update(this.sky, cam.position, this.time)
    this.clouds.update(this.sky, cam, this.drift, this.renderer.gl.domElement.height)
    this.terrain.update(cam.position.x, cam.position.z, 3)
    this.water.update(this.sky, cam.position, this.time)
    this.cities.update(this.sky.daylight, dt, this.time)
    this.forest.update(cam.position.x, cam.position.z, agl, dt, this.sky, this.time, this.densityFor(this.quality))
    this.collectibles.update(0, this.viewScale(), this.renderPos, this.sky.daylight)
    const wind = this.tmpV.set(this.atm.windSpeed * Math.cos(this.atm.windAngle), 0, this.atm.windSpeed * Math.sin(this.atm.windAngle))
    this.fx.update(dt, cam, this.renderer.gl.domElement.height, this.sky, this.time, wind, f.vel, this.state === 'playing' ? f.vel.length() : 0)

    this.updateAudio(dt)
    if (this.state === 'playing') {
      this.hudTimer -= dt
      if (this.hudTimer <= 0) {
        this.hudTimer = 1 / 15
        this.ui.hud(this.buildHud())
      }
    }
    this.renderer.render(this.scene, cam)
  }

  private updateAudio(dt: number): void {
    const f = this.flight
    const th = this.atm.thermalAt(f.pos.x, f.pos.z)
    this.audio.update(dt, {
      speed: f.vel.length(),
      agl: f.agl,
      altitude: f.pos.y,
      overWater: heightAt(f.pos.x, f.pos.z) < WATER_LEVEL ? 1 : 0,
      thermal: th ? Math.max(0, Math.min(1, this.airVel.y / 4)) : 0,
      daylight: this.sky.daylight,
      night: this.sky.night,
      flapping: f.flapping,
      grounded: f.grounded,
    })
  }

  private buildHud(): HudData {
    const f = this.flight
    const near = this.collectibles.nearestSeed(f.pos)
    let nearestSeed: HudData['nearestSeed'] = null
    if (near) {
      const dirYaw = Math.atan2(-near.dir.x, -near.dir.z)
      const rel = Math.atan2(Math.sin(dirYaw - f.yaw), Math.cos(dirYaw - f.yaw))
      nearestSeed = { meters: Math.round(near.dist), bearing: rel, pitch: Math.asin(near.dir.y) }
    }
    const warnings: Warning[] = []
    if (this.hawks.phase === 'stoop') warnings.push('hawk')
    if (f.stalled && !f.grounded) warnings.push('stall')
    if (Math.hypot(f.pos.x, f.pos.z) > CONFIG.world.softRadius) warnings.push('edge')
    if (f.stamina < 18 && !f.grounded) warnings.push('tired')
    if (f.pos.y > CONFIG.flight.ceiling - 12) warnings.push('ceiling')
    let hawk: HudData['hawk'] = null
    if (this.hawks.phase !== 'idle' && this.fauna.hunter.active) {
      const d = this.tmpV.copy(this.fauna.hunter.pos).sub(f.pos)
      const meters = d.length()
      const dirYaw = Math.atan2(-d.x, -d.z)
      hawk = {
        phase: this.hawks.phase,
        meters: Math.round(meters),
        bearing: Math.atan2(Math.sin(dirYaw - f.yaw), Math.cos(dirYaw - f.yaw)),
        pitch: Math.asin(THREE.MathUtils.clamp(d.y / Math.max(meters, 1), -1, 1)),
        danger: this.hawks.danger,
      }
    }
    let perch: HudData['perch'] = null
    const np = this.cities.nearestPerch(f.pos.x, f.pos.y, f.pos.z)
    if (np && np.dist < 450 && !f.grounded) {
      const dirYaw = Math.atan2(-(np.perch.x - f.pos.x), -(np.perch.z - f.pos.z))
      perch = {
        meters: Math.round(np.dist),
        bearing: Math.atan2(Math.sin(dirYaw - f.yaw), Math.cos(dirYaw - f.yaw)),
        name: CITY_SITES[np.perch.site].name,
      }
    }
    const windToward = Math.atan2(Math.cos(this.atm.windAngle), -Math.sin(this.atm.windAngle))
    return {
      speedKmh: kmh(f.vel.length()),
      altitude: Math.round(f.pos.y),
      agl: Math.max(0, Math.round(f.agl)),
      stamina: f.stamina / CONFIG.stamina.max,
      seeds: this.run.seeds,
      seedsGoal: this.run.seedsGoal,
      discoveries: this.run.discoveries.size,
      discoveryTotal: DISCOVERY_IDS.length,
      windRel: Math.atan2(Math.sin(windToward - f.yaw), Math.cos(windToward - f.yaw)),
      windSpeedKmh: kmh(this.atm.windSpeed),
      vario: this.vario,
      heading: f.heading,
      compass: compassName(f.heading),
      clock: formatClock(this.hour),
      cruise: f.cruise,
      grounded: f.grounded,
      camera: this.rig.mode,
      nearestSeed,
      warnings,
      boosting: f.boosting,
      score: this.score.points,
      best: Math.max(this.save.data.bestScore, this.score.points),
      combo: this.score.multiplier,
      comboLeft: this.score.comboLeft,
      mission: { text: this.missionText(this.missions.current), progress: Math.min(this.missions.current.progress, this.missions.current.target), target: this.missions.current.target },
      hawk,
      perch,
      landing: f.landing,
      hit: this.hitFlash > 0,
    }
  }

  /** Lista de descobertas para o diário. */
  journal(): { id: DiscoveryId; found: boolean }[] {
    return DISCOVERY_IDS.map(id => ({ id, found: this.run.discoveries.has(id) }))
  }

  setCameraMode(m: CamMode): void {
    this.rig.setMode(m)
  }

  setBirdSpecies(id: BirdSpeciesId): void {
    if (this.bird.species.id === id) return
    this.scene.remove(this.bird.group)
    this.bird.dispose()
    this.bird = new Bird(getBirdSpecies(id))
    this.flight.setProfile(this.bird.species.flight)
    this.scene.add(this.bird.group)
    this.save.update({ birdId: id })
    this.resetFlight(false)
  }

  startFlight(): void {
    this.resetFlight(true)
    this.rig.setMode('chase')
    this.rig.snap()
    this.setState('playing')
    this.ui.hint(this.i18n.t('hint_first'))
  }

  nestCount(): number {
    return NEST_COUNT
  }

  /** Estado resumido para testes automáticos de fumaça. */
  debugState() {
    return {
      state: this.state,
      pos: this.flight.pos.toArray(),
      speed: this.flight.vel.length(),
      seeds: this.run.seeds,
      fauna: this.fauna?.count ?? 0,
      birdSpecies: this.bird.species.id,
      flightAssist: this.flight.assisted,
      cityBuildings: this.cities?.buildingCount ?? 0,
      perches: this.cities?.perches.length ?? 0,
      hawkPhase: this.hawks?.phase ?? 'idle',
      score: this.score.points,
      mission: this.missions.current.kind,
    }
  }
}
