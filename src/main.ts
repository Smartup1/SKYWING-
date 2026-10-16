import './styles/main.css'
import { Assets } from './engine/assets'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { Game } from './game/game'
import { Ui } from './ui/ui'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const root = document.getElementById('ui')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const i18n = new I18n()
  const input = new Input(canvas)
  const audio = new Audio()
  const assets = new Assets()
  let game: Game | undefined
  let loop: GameLoop | undefined

  const applySettings = (d: SaveData, patch?: Partial<SaveData>) => {
    input.sensitivity = d.sensitivity
    input.invertY = d.invertY
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    if (game) {
      game.rig.reducedMotion = d.reducedMotion
      game.flight.cruise = d.cruise
      game.flight.assisted = d.flightAssist
      if (patch?.quality) game.applyQuality(d.quality)
    }
  }

  const startFlight = () => {
    if (!game || game.state === 'loading') return
    audio.unlock()
    audio.startMusic()
    save.update({ introSeen: true })
    game.startFlight()
    ui.show('hud')
    if (loop) {
      loop.paused = false
      loop.resetAccumulator()
    }
    input.lockPointer()
  }
  const pause = () => {
    if (!game || game.state !== 'playing') return
    game.setState('paused')
    if (loop) loop.paused = true
    ui.refreshPauseStats()
    ui.show('pause')
    input.unlockPointer()
  }
  const resume = () => {
    if (!game || game.state !== 'paused') return
    game.setState('playing')
    ui.show('hud')
    if (loop) {
      loop.paused = false
      loop.resetAccumulator()
    }
    input.lockPointer()
  }

  const ui = new Ui(root, i18n, save, audio, input, {
    play: startFlight,
    resume,
    restart: startFlight,
    quit: () => {
      if (!game) return
      game.setState('title')
      game.resetFlight(false)
      if (loop) {
        loop.paused = false
        loop.resetAccumulator()
      }
      ui.refreshTitle()
      ui.show('title')
      input.unlockPointer()
    },
    settings: patch => {
      save.update(patch)
      applySettings(save.data, patch)
    },
    selectBird: id => {
      game?.setBirdSpecies(id)
      ui.refreshBirds()
      ui.refreshTitle()
    },
    journal: () => game?.journal() ?? [],
    stats: () => ({
      seconds: game?.run.seconds ?? 0,
      distance: game?.run.distance ?? 0,
      maxAlt: game?.run.maxAltitude ?? 0,
      maxSpeed: game?.run.maxSpeed ?? 0,
      seeds: game?.run.seeds ?? 0,
      goal: game?.run.seedsGoal ?? 0,
    }),
  })
  ui.show('boot')
  ui.setBoot(0.02, i18n.t('loading'))
  applySettings(save.data)

  const [{ Game: GameClass }, { Renderer, suggestQuality }] = await Promise.all([
    import('./game/game'),
    import('./engine/renderer'),
    document.fonts.ready,
  ])
  if (firstRun) save.update({ quality: suggestQuality() })
  const renderer = new Renderer(canvas, save.data.quality)
  game = new GameClass(renderer, input, audio, save, i18n, assets, ui)
  applySettings(save.data)
  game.onStateChange = state => {
    if (state === 'title') input.unlockPointer()
  }
  await game.init((p, label) => ui.setBoot(p, label))

  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([import('../scripts/manus-tuning/adapter.js'), import('./game/tuning')])
    await registerGameTuning(tuning)
  }

  const g = game
  loop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      if (loop?.paused) input.update(0)
      if (input.consume('pause')) {
        const sub = ui.screen === 'settings' || ui.screen === 'controls' || ui.screen === 'journal' || ui.screen === 'birds'
        if (g.state === 'playing') pause()
        else if (g.state === 'paused' && ui.screen === 'pause') resume()
        else if (sub) ui.back()
      }
      g.render(alpha, frameSeconds)
    },
  })
  loop.start()
  ui.refreshTitle()
  ui.show('title')

  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || e.repeat) return
    const sub = ui.screen === 'settings' || ui.screen === 'controls' || ui.screen === 'journal' || ui.screen === 'birds'
    if (g.state === 'playing') {
      e.preventDefault()
      input.consume('pause')
      pause()
    } else if (g.state === 'paused' && ui.screen === 'pause') {
      e.preventDefault()
      input.consume('pause')
      resume()
    } else if (sub) {
      e.preventDefault()
      input.consume('pause')
      ui.back()
    }
  })
  document.addEventListener('pointerlockchange', () => {
    // O navegador solta o mouse ao apertar Esc sem entregar a tecla: tratamos como pausa.
    if (!document.pointerLockElement && g.state === 'playing' && input.method === 'keyboard') {
      pause()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  canvas.addEventListener('click', () => {
    if (g.state === 'playing') input.lockPointer()
  })
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, audio }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  const webgl = /webgl/i.test(String((err as Error)?.message ?? err))
  if (el) {
    const i18n = new I18n()
    el.innerHTML = `<div class="fatal" role="alert"><div class="fatal-inner"><img class="fatal-mark" src="./favicon.svg" alt="" /><p>${i18n.t(webgl ? 'fatal_webgl' : 'fatal')}</p><button class="btn primary" type="button">${i18n.t('retry')}</button></div></div>`
    el.querySelector('button')?.addEventListener('click', () => location.reload())
  }
})
