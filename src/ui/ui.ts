import type { Audio } from '../engine/audio'
import type { I18n, Key } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore, TimeMode } from '../engine/save'
import { TIME_MODES } from '../engine/save'
import type { HudData, UiBridge } from '../game/game'
import { CITY_SITES } from '../game/cityLayout'
import { DISCOVERY_IDS, formatDuration, NEST_COUNT, type DiscoveryId } from '../game/rules'
import { BIRD_SPECIES, getBirdSpecies, type BirdSpeciesId } from '../game/birdSpecies'

export type ScreenId = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'controls' | 'journal' | 'birds'

export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
  selectBird(id: BirdSpeciesId): void
  journal(): { id: DiscoveryId; found: boolean }[]
  stats(): { seconds: number; distance: number; maxAlt: number; maxSpeed: number; seeds: number; goal: number; score: number; best: number }
}

const ICONS = {
  seed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c3.5 3 6 6.2 6 10a6 6 0 0 1-12 0c0-3.800 2.500-7 6-10Z" fill="currentColor"/></svg>',
  nest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11h18c0 5-3.500 8-9 8s-9-3-9-8Zm4-4a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm6 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0Z" fill="currentColor"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 19 20l-7-4-7 4Z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.500 4.500 4.500L19 7.500" fill="none" stroke="currentColor" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

const DISC_ICON: Record<string, string> = { city: 'M4 20V9l4-2v13M10 20V4l5 2v14M17 20v-8l3 1v7M3 20h18', hawk: 'M2 6c4 0 7 3 10 9 3-6 6-9 10-9-3 2-5 5-6 8l-4 6-4-6c-1-3-3-6-6-8Z', dodge: 'M4 18c5 0 9-3 10-9M14 9l-4 1m4-1 1 4M20 5l-3 3', perfect: 'M12 3l2.600 5.600 6.100.700-4.500 4.200 1.200 6L12 16.600 6.600 19.500l1.200-6L3.300 9.300l6.100-.700Z', summit: 'M3 19 9 8l4 6 3-4 5 9Z', skim: 'M3 15c3-3 6 3 9 0s6 3 9 0M3 19c3-3 6 3 9 0s6 3 9 0', flock: 'M2 8c3 0 5 2 6 4 1-2 3-4 6-4M10 15c2 0 4 1 5 3 1-2 3-3 5-3', thermal: 'M12 22V8m0 0-5 5m5-5 5 5M8 4h8' }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

export class Ui implements UiBridge {
  screen: ScreenId = 'boot'
  private readonly screens = new Map<ScreenId, HTMLElement>()
  private previous: ScreenId = 'title'
  private readonly hudEls: Record<string, HTMLElement> = {}
  private readonly birdCards: HTMLButtonElement[] = []
  private readonly toasts = el('div', 'toasts')
  private readonly hintEl = el('div', 'hint')
  private readonly banner = el('div', 'banner')
  private readonly camLabel = el('div', 'cam-label')
  private hintTimer = 0
  private bannerTimer = 0
  private camTimer = 0
  private lastHud = new Map<string, string>()
  private bootFill!: HTMLElement
  private bootLabel!: HTMLElement
  private bootPct!: HTMLElement
  private tip!: HTMLElement
  private clickPrompt!: HTMLElement

  constructor(
    private readonly root: HTMLElement,
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.buildBoot()
    this.buildTitle()
    this.buildBirds()
    this.buildHud()
    this.buildPause()
    this.buildSettings()
    this.buildControls()
    this.buildJournal()
    root.append(this.toasts, this.hintEl, this.banner, this.camLabel)
    this.hintEl.setAttribute('role', 'status')
    this.toasts.setAttribute('aria-live', 'polite')
    root.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('button, input, select, label')) this.audio.click()
    })
  }

  private t(key: Key, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars)
  }

  private screenEl(id: ScreenId, cls = ''): HTMLElement {
    const s = el('section', `screen ${cls}`)
    s.dataset.screen = id
    s.setAttribute('aria-hidden', 'true')
    this.screens.set(id, s)
    this.root.append(s)
    return s
  }

  show(id: ScreenId): void {
    if (this.screen !== id && (id === 'settings' || id === 'controls' || id === 'journal' || id === 'birds')) {
      if (this.screen === 'title' || this.screen === 'pause') this.previous = this.screen
    }
    this.screen = id
    for (const [key, node] of this.screens) {
      const active = key === id || (id === 'pause' && false)
      // O HUD fica visível atrás do menu de pausa.
      const withHud = key === 'hud' && (id === 'pause' || id === 'settings' || id === 'controls' || id === 'journal') && this.previous === 'pause'
      node.classList.toggle('is-active', active || withHud)
      node.setAttribute('aria-hidden', String(!(active || withHud)))
    }
    this.root.dataset.active = id
    const first = this.screens.get(id)?.querySelector<HTMLElement>('[data-autofocus]')
    first?.focus({ preventScroll: true })
  }

  back(): void {
    this.show(this.previous)
  }

  // --- Carregamento -------------------------------------------------------------------------

  private buildBoot(): void {
    const s = this.screenEl('boot', 'center')
    s.append(el('div', 'logo', `<img class="boot-mark" src="./favicon.svg" alt="" /><span class="logo-text">${this.t('title')}</span>`))
    const bar = el('div', 'bar')
    this.bootFill = el('div', 'bar-fill')
    bar.append(this.bootFill)
    this.bootLabel = el('p', 'boot-label', this.t('loading'))
    this.bootPct = el('span', 'boot-pct', '0%')
    this.tip = el('p', 'tip', this.randomTip())
    s.append(bar, this.bootLabel, this.bootPct, this.tip)
  }

  private randomTip(): string {
    const keys: Key[] = ['tip_1', 'tip_2', 'tip_3', 'tip_4', 'tip_5', 'tip_6', 'tip_7', 'tip_8', 'tip_9']
    return this.t(keys[Math.floor(Math.random() * keys.length)])
  }

  setBoot(p: number, label?: string): void {
    this.bootFill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`
    this.bootPct.textContent = `${Math.round(p * 100)}%`
    if (label) this.bootLabel.textContent = label
  }

  // --- Início --------------------------------------------------------------------------------

  private button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`)
    b.type = 'button'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  private buildTitle(): void {
    const s = this.screenEl('title', 'left')
    const panel = el('div', 'title-panel')
    panel.append(
      el('div', 'logo', `<span class="logo-text">${this.t('title')}</span><span class="logo-sub">${this.t('subtitle')}</span>`),
      el('p', 'tagline', this.t('tagline')),
    )
    const play = this.button(this.save.data.totalSeeds > 0 ? this.t('continue') : this.t('play'), () => this.actions.play(), 'primary')
    play.dataset.autofocus = ''
    play.id = 'play-btn'
    const menu = el('div', 'menu')
    menu.append(
      play,
      this.button(this.t('choose_bird'), () => { this.refreshBirds(); this.show('birds') }),
      this.button(this.t('journal'), () => { this.refreshJournal(); this.show('journal') }),
      this.button(this.t('controls'), () => this.show('controls')),
      this.button(this.t('settings'), () => this.show('settings')),
    )
    panel.append(menu)
    const foot = el('p', 'foot', '')
    foot.id = 'title-foot'
    panel.append(foot, el('p', 'version', this.t('version')))
    s.append(panel)
    this.refreshTitle()
  }

  private buildBirds(): void {
    const screen = this.screenEl('birds', 'center dim')
    const panel = el('div', 'panel wide bird-panel')
    const heading = el('h2', '', this.t('birds_title'))
    heading.tabIndex = -1
    heading.dataset.autofocus = ''
    panel.append(heading, el('p', 'bird-intro', this.t('birds_desc')))
    const grid = el('div', 'bird-grid')
    for (const species of BIRD_SPECIES) {
      const card = this.button('', () => this.actions.selectBird(species.id), 'bird-card')
      card.dataset.bird = species.id
      card.setAttribute('aria-pressed', 'false')
      card.title = species.description
      const swatch = el('span', 'bird-swatch')
      swatch.style.backgroundColor = species.swatch
      const copy = el('span', 'bird-copy')
      const name = el('strong')
      name.textContent = species.name
      const subtitle = el('small')
      subtitle.textContent = species.subtitle
      const stats = el('small', 'bird-stats')
      stats.textContent = `${this.t('bird_speed')} ${Math.round(species.flight.maxSpeed * 100)}% · ${this.t('bird_recovery')} ${Math.round(species.flight.recovery * 100)}%`
      const trait = el('b', 'bird-trait')
      trait.textContent = species.trait
      card.setAttribute('aria-label', `${species.name}. ${species.subtitle}. ${species.description} ${stats.textContent}. ${species.trait}.`)
      copy.append(name, subtitle, stats, trait)
      card.append(swatch, copy)
      grid.append(card)
      this.birdCards.push(card)
    }
    const back = this.button(this.t('back'), () => this.back(), 'primary')
    panel.append(grid, back)
    screen.append(panel)
    this.refreshBirds()
  }

  refreshBirds(): void {
    for (const card of this.birdCards) {
      const selected = card.dataset.bird === this.save.data.birdId
      card.classList.toggle('selected', selected)
      card.setAttribute('aria-pressed', String(selected))
    }
  }

  refreshTitle(): void {
    const d = this.save.data
    const foot = document.getElementById('title-foot')
    if (foot) {
      const progress = d.totalSeeds > 0 ? ` · ${this.t('stats_total_seeds')}: ${d.totalSeeds} · ${this.t('journal')}: ${d.discoveries.length}/${DISCOVERY_IDS.length}` : ''
      foot.textContent = `${this.t('bird_selected')}: ${getBirdSpecies(d.birdId).name}${progress}`
    }
    const play = document.getElementById('play-btn')
    if (play) play.textContent = d.totalSeeds > 0 || d.introSeen ? this.t('continue') : this.t('play')
  }

  // --- HUD ----------------------------------------------------------------------------------

  private buildHud(): void {
    const s = this.screenEl('hud', 'hud')
    const mk = (cls: string, html: string) => {
      const e = el('div', cls, html)
      s.append(e)
      return e
    }
    mk('hud-score', `
      <div class="score-chip"><small>${this.t('hud_score')}</small><b data-h="score">0</b><span class="combo" data-h="combo"></span><div class="combo-track"><div class="combo-fill" data-h="comboFill"></div></div><small class="best">${this.t('hud_best')} <i data-h="best">0</i></small></div>
      <div class="mission-chip"><small>${this.t('hud_mission')}</small><span data-h="missionText"></span><div class="mission-track"><div class="mission-fill" data-h="missionFill"></div></div></div>`)
    mk('hud-tl', `
      <div class="chip seeds">${ICONS.seed}<b data-h="seeds">0</b><span>/<i data-h="seedsGoal">0</i></span><small>${this.t('hud_seeds')}</small></div>
      <div class="chip disc">${ICONS.nest}<b data-h="disc">0</b><span>/<i data-h="discTotal">0</i></span><small>${this.t('hud_discoveries')}</small></div>`)
    mk('hud-tc', `
      <div class="compass"><b data-h="compass">N</b><span data-h="heading">0°</span></div>
      <div class="clock" data-h="clock">12:00</div>`)
    mk('hud-tr', `
      <div class="wind"><div class="wind-arrow" data-h="windArrow">${ICONS.arrow}</div><div><b data-h="windSpeed">0</b><small> km/h</small><br><small>${this.t('hud_wind')}</small></div></div>`)
    mk('hud-vario', `<div class="vario"><div class="vario-track"><div class="vario-fill" data-h="varioFill"></div></div><b data-h="vario">0.0</b><small>m/s</small></div>`)
    mk('hud-bl', `
      <div class="stamina"><small>${this.t('hud_stamina')}</small><div class="stamina-track"><div class="stamina-fill" data-h="stamina"></div></div></div>
      <div class="cruise" data-h="cruise"></div>`)
    mk('hud-bc', `
      <div class="seed-arrow" data-h="seedPointer"><div class="seed-arrow-icon" data-h="seedArrow">${ICONS.arrow}</div><span data-h="seedText"></span></div>
      <div class="instruments">
        <div><b data-h="speed">0</b><small>km/h</small></div>
        <div class="alt"><b data-h="alt">0</b><small>m · ${this.t('hud_agl').toLowerCase()} <i data-h="agl">0</i> m</small></div>
      </div>`)
    mk('hud-hawk', `<div class="hawk-ind hidden" data-h="hawkInd"><div class="hawk-arrow" data-h="hawkArrow">${ICONS.arrow}</div><b data-h="hawkText"></b><small data-h="hawkDist"></small></div>`)
    mk('hud-perch', `<div class="perch-ind hidden" data-h="perchInd"><div class="perch-arrow" data-h="perchArrow">${ICONS.arrow}</div><span data-h="perchText"></span></div>`)
    mk('hud-land', `<div class="land-ind hidden" data-h="landInd">${this.t('hud_landing')}</div>`)
    mk('hud-warn', '<div class="warn" data-h="warn"></div>')
    mk('hud-vignette', '')
    this.clickPrompt = mk('click-prompt', this.t('click_to_fly'))
    for (const node of s.querySelectorAll<HTMLElement>('[data-h]')) this.hudEls[node.dataset.h!] = node
  }

  private setText(key: string, value: string): void {
    if (this.lastHud.get(key) === value) return
    this.lastHud.set(key, value)
    const e = this.hudEls[key]
    if (e) e.textContent = value
  }

  private setStyle(key: string, prop: 'transform' | 'height' | 'width', value: string): void {
    const id = `${key}:${prop}`
    if (this.lastHud.get(id) === value) return
    this.lastHud.set(id, value)
    const e = this.hudEls[key]
    if (e) e.style[prop] = value
  }

  hud(d: HudData): void {
    this.setText('seeds', String(d.seeds))
    this.setText('seedsGoal', String(d.seedsGoal))
    this.setText('disc', String(d.discoveries))
    this.setText('discTotal', String(d.discoveryTotal))
    this.setText('compass', d.compass)
    this.setText('heading', `${String(Math.round(d.heading) % 360).padStart(3, '0')}°`)
    this.setText('clock', d.clock)
    this.setText('windSpeed', String(d.windSpeedKmh))
    this.setStyle('windArrow', 'transform', `rotate(${(d.windRel * 180) / Math.PI}deg)`)
    this.setText('vario', `${d.vario >= 0 ? '+' : ''}${d.vario.toFixed(1)}`)
    const v = Math.max(-6, Math.min(6, d.vario))
    this.hudEls.varioFill.classList.toggle('neg', v < 0)
    this.setStyle('varioFill', 'height', `${Math.abs(v) / 6 * 50}%`)
    this.setStyle('stamina', 'transform', `scaleX(${Math.max(0, d.stamina)})`)
    this.hudEls.stamina.classList.toggle('low', d.stamina < 0.18)
    this.setText('cruise', d.grounded ? this.t('state_landed') : d.cruise ? this.t('hud_cruise_on') : this.t('hud_cruise_off'))
    this.hudEls.cruise.classList.toggle('on', d.cruise && !d.grounded)
    this.setText('speed', String(d.speedKmh))
    this.setText('alt', String(d.altitude))
    this.setText('agl', String(d.agl))
    this.hudEls.speed.parentElement?.classList.toggle('boost', d.boosting)
    if (d.nearestSeed && !d.grounded) {
      this.hudEls.seedPointer.classList.remove('hidden')
      this.setStyle('seedArrow', 'transform', `rotate(${(d.nearestSeed.bearing * 180) / Math.PI}deg)`)
      this.setText('seedText', this.t('hud_nearest_seed', { meters: d.nearestSeed.meters }))
      this.hudEls.seedPointer.classList.toggle('near', d.nearestSeed.meters < 60)
    } else {
      this.hudEls.seedPointer.classList.add('hidden')
    }
    this.setText('score', d.score.toLocaleString('pt-BR'))
    this.setText('best', d.best.toLocaleString('pt-BR'))
    this.setText('combo', d.combo > 1 ? `×${d.combo}` : '')
    this.setStyle('comboFill', 'transform', `scaleX(${d.comboLeft})`)
    this.hudEls.comboFill.parentElement?.classList.toggle('hidden', d.comboLeft <= 0)
    this.setText('missionText', d.mission.text)
    this.setStyle('missionFill', 'transform', `scaleX(${Math.min(1, d.mission.progress / d.mission.target)})`)
    if (d.hawk) {
      this.hudEls.hawkInd.classList.remove('hidden')
      this.hudEls.hawkInd.classList.toggle('stoop', d.hawk.phase === 'stoop')
      this.setStyle('hawkArrow', 'transform', `rotate(${(d.hawk.bearing * 180) / Math.PI}deg)`)
      this.setText('hawkText', this.t(`hud_hawk_${d.hawk.phase}` as Key))
      this.setText('hawkDist', `${d.hawk.meters} m`)
    } else this.hudEls.hawkInd.classList.add('hidden')
    if (d.perch) {
      this.hudEls.perchInd.classList.remove('hidden')
      this.setStyle('perchArrow', 'transform', `rotate(${(d.perch.bearing * 180) / Math.PI}deg)`)
      this.setText('perchText', this.t('hud_perch', { name: d.perch.name, meters: d.perch.meters }))
      this.hudEls.perchInd.classList.toggle('near', d.perch.meters < 90)
    } else this.hudEls.perchInd.classList.add('hidden')
    this.hudEls.landInd.classList.toggle('hidden', !d.landing)
    this.root.classList.toggle('is-hunted', !!d.hawk && d.hawk.phase === 'stoop' && d.hawk.danger > 0.45)
    this.root.classList.toggle('is-hit', d.hit)
    const w = d.warnings[0]
    const text = w === 'hawk' ? this.t('warn_hawk') : w === 'stall' ? this.t('warn_stall') : w === 'edge' ? this.t('warn_edge') : w === 'tired' ? this.t('warn_tired') : w === 'ceiling' ? this.t('warn_ceiling') : ''
    this.setText('warn', text)
    this.hudEls.warn.classList.toggle('show', !!text)
    this.root.classList.toggle('is-tired', d.stamina < 0.12)
    const locked = !!document.pointerLockElement
    this.clickPrompt.classList.toggle('show', !locked && this.input.method === 'keyboard' && this.screen === 'hud' && false)
  }

  // --- Avisos -------------------------------------------------------------------------------

  toast(text: string, tone: 'good' | 'warn' | 'info' = 'info'): void {
    const t = el('div', `toast ${tone}`, text.replace(/[<>&]/g, ''))
    this.toasts.append(t)
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove()
    window.setTimeout(() => t.classList.add('out'), 2300)
    window.setTimeout(() => t.remove(), 2900)
  }

  hint(text: string): void {
    this.hintEl.textContent = text
    this.hintEl.classList.add('show')
    window.clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('show'), 6500)
  }

  discovered(id: DiscoveryId): void {
    const name = this.discName(id)
    const desc = id.startsWith('nest') ? this.t('toast_nest') : id.startsWith('city') ? this.t('toast_city') : id === 'dodge' ? this.t('toast_dodge_disc') : id === 'perfect' ? this.t('toast_perfect') : this.t(`toast_${id}` as Key)
    this.banner.innerHTML = `<small>${this.t('journal')}</small><b>${name}</b><span>${desc}</span>`
    this.banner.classList.add('show')
    window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 4800)
  }

  cameraLabel(text: string): void {
    this.camLabel.textContent = text
    this.camLabel.classList.add('show')
    window.clearTimeout(this.camTimer)
    this.camTimer = window.setTimeout(() => this.camLabel.classList.remove('show'), 1600)
  }

  frame(_dt: number): void {
    /* reservado para animações de interface dependentes de quadro */
  }

  // --- Pausa --------------------------------------------------------------------------------

  private buildPause(): void {
    const s = this.screenEl('pause', 'center dim')
    const panel = el('div', 'panel')
    panel.append(el('h2', '', this.t('paused')))
    const stats = el('div', 'stats')
    stats.id = 'pause-stats'
    panel.append(stats)
    const resume = this.button(this.t('resume'), () => this.actions.resume(), 'primary')
    resume.dataset.autofocus = ''
    const menu = el('div', 'menu')
    menu.append(
      resume,
      this.button(this.t('journal'), () => { this.refreshJournal(); this.show('journal') }),
      this.button(this.t('controls'), () => this.show('controls')),
      this.button(this.t('settings'), () => this.show('settings')),
      this.button(this.t('restart'), () => this.actions.restart()),
      this.button(this.t('quit'), () => this.actions.quit()),
    )
    panel.append(menu)
    s.append(panel)
  }

  refreshPauseStats(): void {
    const st = this.actions.stats()
    const node = document.getElementById('pause-stats')
    if (!node) return
    node.innerHTML = `
      <div><small>${this.t('stats_score')}</small><b>${st.score.toLocaleString('pt-BR')}</b></div>
      <div><small>${this.t('hud_best')}</small><b>${st.best.toLocaleString('pt-BR')}</b></div>
      <div><small>${this.t('hud_seeds')}</small><b>${st.seeds}/${st.goal}</b></div>
      <div><small>${this.t('stats_time')}</small><b>${formatDuration(st.seconds)}</b></div>
      <div><small>${this.t('stats_distance')}</small><b>${(st.distance / 1000).toFixed(1)} km</b></div>
      <div><small>${this.t('stats_max_alt')}</small><b>${Math.round(st.maxAlt)} m</b></div>`
  }

  // --- Configurações ------------------------------------------------------------------------

  private buildSettings(): void {
    const s = this.screenEl('settings', 'center dim')
    const panel = el('div', 'panel wide')
    panel.append(el('h2', '', this.t('settings')))
    const grid = el('div', 'form')
    const d = this.save.data
    const range = (label: Key, value: number, min: number, max: number, step: number, apply: (v: number) => Partial<SaveData>) => {
      const row = el('label', 'row')
      row.append(el('span', '', this.t(label)))
      const input = el('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(value)
      input.addEventListener('input', () => this.actions.settings(apply(Number(input.value))))
      row.append(input)
      grid.append(row)
      return input
    }
    const toggle = (label: Key, value: boolean, apply: (v: boolean) => Partial<SaveData>) => {
      const row = el('label', 'row')
      row.append(el('span', '', this.t(label)))
      const input = el('input')
      input.type = 'checkbox'
      input.checked = value
      input.className = 'switch'
      input.addEventListener('change', () => this.actions.settings(apply(input.checked)))
      row.append(input)
      grid.append(row)
      return input
    }
    const select = <T extends string>(label: Key, value: T, options: [T, Key][], apply: (v: T) => Partial<SaveData>) => {
      const row = el('label', 'row')
      row.append(el('span', '', this.t(label)))
      const sel = el('select')
      for (const [v, k] of options) {
        const o = el('option')
        o.value = v
        o.textContent = this.t(k)
        sel.append(o)
      }
      sel.value = value
      sel.addEventListener('change', () => this.actions.settings(apply(sel.value as T)))
      row.append(sel)
      grid.append(row)
      return sel
    }
    range('set_music', d.musicVolume, 0, 1, 0.05, v => ({ musicVolume: v }))
    range('set_sfx', d.sfxVolume, 0, 1, 0.05, v => ({ sfxVolume: v }))
    toggle('set_mute', d.muted, v => ({ muted: v }))
    range('set_sens', d.sensitivity, 0, 1, 0.05, v => ({ sensitivity: v }))
    toggle('set_invert', d.invertY, v => ({ invertY: v }))
    toggle('set_motion', d.reducedMotion, v => ({ reducedMotion: v }))
    toggle('set_cruise', d.cruise, v => ({ cruise: v }))
    toggle('set_flight_assist', d.flightAssist, v => ({ flightAssist: v }))
    toggle('set_hawks', d.hawks, v => ({ hawks: v }))
    select<Quality>('set_quality', d.quality, [['low', 'q_low'], ['medium', 'q_medium'], ['high', 'q_high']], v => ({ quality: v }))
    select<TimeMode>('set_time', d.timeMode, TIME_MODES.map(m => [m, `t_${m}` as Key]), v => ({ timeMode: v }))
    panel.append(grid)
    const back = this.button(this.t('back'), () => this.back(), 'primary')
    back.dataset.autofocus = ''
    panel.append(back)
    s.append(panel)
  }

  // --- Controles ----------------------------------------------------------------------------

  private buildControls(): void {
    const s = this.screenEl('controls', 'center dim')
    const panel = el('div', 'panel wide')
    panel.append(el('h2', '', this.t('controls')))
    const rows: [Key, Key][] = [
      ['ctrl_pitch', 'key_pitch'], ['ctrl_turn', 'key_turn'], ['ctrl_roll', 'key_roll'], ['ctrl_flap', 'key_flap'],
      ['ctrl_boost', 'key_boost'], ['ctrl_land', 'key_land'], ['ctrl_look', 'key_look'], ['ctrl_camera', 'key_camera'], ['ctrl_cruise', 'key_cruise'], ['ctrl_pause', 'key_pause'],
    ]
    const table = el('div', 'keys')
    for (const [a, k] of rows) table.append(el('div', 'key-row', `<span>${this.t(a)}</span><kbd>${this.t(k)}</kbd>`))
    panel.append(table)
    for (const k of ['tip_1', 'tip_7', 'tip_8'] as Key[]) panel.append(el('p', 'tip-line', this.t(k)))
    const back = this.button(this.t('back'), () => this.back(), 'primary')
    back.dataset.autofocus = ''
    panel.append(back)
    s.append(panel)
  }

  // --- Diário -------------------------------------------------------------------------------

  private discName(id: DiscoveryId): string {
    if (id.startsWith('nest')) return this.t('disc_nest', { n: Number(id.slice(4)) + 1 })
    if (id.startsWith('city')) return this.t('disc_city', { name: CITY_SITES[Number(id.slice(4))]?.name ?? '' })
    return this.t(`disc_${id}` as Key)
  }

  private discDesc(id: DiscoveryId): string {
    if (id.startsWith('city')) return this.t('disc_desc_city', { name: CITY_SITES[Number(id.slice(4))]?.name ?? '' })
    return id.startsWith('nest') ? this.t('disc_desc_nest') : this.t(`disc_desc_${id}` as Key)
  }

  private buildJournal(): void {
    const s = this.screenEl('journal', 'center dim')
    const panel = el('div', 'panel wide')
    panel.append(el('h2', '', this.t('journal')))
    const list = el('div', 'journal')
    list.id = 'journal-list'
    panel.append(list)
    const back = this.button(this.t('back'), () => this.back(), 'primary')
    back.dataset.autofocus = ''
    panel.append(back)
    s.append(panel)
  }

  refreshJournal(): void {
    const list = document.getElementById('journal-list')
    if (!list) return
    const entries = this.actions.journal()
    const known = new Set(this.save.data.discoveries)
    list.innerHTML = ''
    for (const e of entries) {
      const found = e.found || known.has(e.id)
      const isNest = e.id.startsWith('nest')
      const path = DISC_ICON[e.id.startsWith('city') ? 'city' : e.id]
      const icon = isNest ? ICONS.nest : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
      const row = el('div', `journal-row${found ? ' found' : ''}`, `${icon}<div><b>${found || !isNest ? this.discName(e.id) : this.discName(e.id)}</b><span>${this.discDesc(e.id)}</span></div><i>${found ? ICONS.check : ''}</i>`)
      list.append(row)
    }
    void NEST_COUNT
  }

  /** Mostra o aviso para clicar na tela e capturar o mouse. */
  showClickPrompt(show: boolean): void {
    this.clickPrompt?.classList.toggle('show', show)
  }

  syncSettingsControls(): void {
    /* os controles refletem o estado salvo na criação; recriar não é necessário */
  }
}
