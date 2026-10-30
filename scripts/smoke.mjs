// Smoke test end-to-end do SKYWING: compilar antes (`pnpm build`), abrir em Chromium, validar
// idioma/carregamento/voo, flap, câmeras, pausa, menus, retomada e reinício. Capturas em ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser
let guard
const errors = []
const cleanup = () => {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FALHOU — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('servidor de Preview não iniciou')
}
async function openGame() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'pt-BR' })
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 60_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.documentElement.lang !== 'pt-BR') throw new Error('idioma do jogo não está em pt-BR')
    if (document.title !== 'SKYWING: Vida Selvagem') throw new Error(`título inesperado: ${document.title}`)
    for (const selector of ['.logo-text', '.tagline']) {
      const family = getComputedStyle(document.querySelector(selector)).fontFamily
      if (!family.startsWith('"ManusCC0"') && !family.startsWith('ManusCC0,')) throw new Error(`fonte inesperada: ${family}`)
    }
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'ManusCC0' && face.status === 'loaded')) {
      throw new Error('fonte ManusCC0 não carregou')
    }
  })
  return page
}
const gameState = page => page.evaluate(() => {
  const g = window.__game.game
  return {
    state: g.state,
    pos: g.flight.pos.toArray(),
    speed: g.flight.speed,
    stamina: g.flight.stamina,
    seconds: g.run.seconds,
    camera: g.rig.mode,
    seeds: g.run.seeds,
    discoveries: g.run.discoveries.size,
    birdSpecies: g.bird.species.id,
    flightAssist: g.flight.assisted,
    cityBuildings: g.debugState().cityBuildings,
    cityVehicles: g.cities.vehicleCount,
    fauna: g.debugState().fauna,
    cityPoles: g.debugState().cityPoles,
    cityWireSpans: g.debugState().cityWireSpans,
    landingPerches: g.debugState().landingPerches,
    macaws: g.debugState().macaws,
    macawsDiscovered: g.debugState().macawsDiscovered,
  }
})
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  guard = setTimeout(() => { void fail('tempo limite excedido') }, 180_000)
  await waitForServer()
  const launchArgs = ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl']
  browser = await chromium.launch({ args: launchArgs }).catch(() => chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: launchArgs }))
  const page = await openGame()
  check(await page.title() === 'SKYWING: Vida Selvagem', 'título da página incorreto')
  const initial = await gameState(page)
  check(initial.cityBuildings >= 100, `cidades não foram construídas (${initial.cityBuildings} prédios)`)
  check(initial.cityVehicles >= 45, `tráfego urbano insuficiente (${initial.cityVehicles} carros)`)
  check(initial.cityPoles > 100, `rede elétrica urbana insuficiente (${initial.cityPoles} postes)`)
  check(initial.cityWireSpans > 50, `fios urbanos insuficientes (${initial.cityWireSpans} vãos)`)
  check(initial.landingPerches === initial.cityPoles, 'nem todos os postes oferecem um ponto de pouso')
  check(initial.macaws === 3, `deveria haver três espécies de araras (${initial.macaws})`)
  check(initial.macawsDiscovered === 0, 'a tela inicial concedeu uma conquista de arara sem o jogador voar')
  check(initial.fauna >= 190, `bandos insuficientes no lago, rio e cidades (${initial.fauna} aves)`)
  check(initial.flightAssist === true, 'assistência de voo não inicia ativada por padrão')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/01-title.png` })

  // As cinco espécies têm vantagens distintas, são selecionáveis e persistem no save.
  await page.getByRole('button', { name: 'Escolher ave' }).click()
  check(await page.locator('[data-screen="birds"] h2').isVisible(), 'título do seletor ficou oculto ao focar a tela')
  const birdCards = page.locator('[data-screen="birds"] [data-bird]')
  check(await birdCards.count() === 5, `deveria haver cinco espécies selecionáveis (${await birdCards.count()})`)
  await page.screenshot({ path: `${out}/02-birds.png` })
  for (const id of ['bem-te-vi', 'andorinha', 'arara', 'coruja', 'sabia', 'andorinha']) {
    const card = page.locator(`[data-screen="birds"] [data-bird="${id}"]`)
    await card.click()
    check(await card.getAttribute('aria-pressed') === 'true', `a espécie ${id} não foi marcada como selecionada`)
    check((await gameState(page)).birdSpecies === id, `o jogo não aplicou a espécie ${id}`)
  }
  const swallowProfile = await page.evaluate(() => window.__game.game.bird.species.flight)
  check(swallowProfile.maxSpeed > 1.2, 'a andorinha não tem vantagem de velocidade')
  await page.locator('[data-screen="birds"] button').last().click()
  check(await page.locator('#ui').getAttribute('data-active') === 'title', 'Voltar no seletor de aves não retornou ao título')

  // Controles e configurações permanecem navegáveis pelo teclado/mouse e em pt-BR.
  await page.getByRole('button', { name: 'Controles' }).click()
  check(await page.locator('#ui').getAttribute('data-active') === 'controls', 'tela de controles não abriu')
  await page.screenshot({ path: `${out}/02-controls.png` })
  await page.getByRole('button', { name: 'Voltar' }).click()
  await page.getByRole('button', { name: 'Configurações' }).click()
  check(await page.locator('#ui').getAttribute('data-active') === 'settings', 'configurações não abriram')
  const quality = page.locator('[data-screen="settings"] select').first()
  await quality.selectOption('low')
  check(await page.evaluate(() => window.__game.save.data.quality) === 'low', 'qualidade baixa não foi aplicada/salva')
  await quality.selectOption('high')
  const assist = page.locator('[data-screen="settings"] .row').filter({ hasText: 'Assistência de voo (mais fácil)' }).locator('input')
  await assist.uncheck()
  check(await page.evaluate(() => window.__game.game.flight.assisted) === false, 'desligar a assistência não foi aplicado')
  check(await page.evaluate(() => window.__game.save.data.flightAssist) === false, 'assistência desligada não foi salva')
  await assist.check()
  check(await page.evaluate(() => window.__game.game.flight.assisted) === true, 'ligar a assistência não foi aplicado')
  await page.screenshot({ path: `${out}/03-settings.png` })
  await page.getByRole('button', { name: 'Voltar' }).click()
  await page.getByRole('button', { name: 'Diário de voo' }).click()
  check(await page.locator('#ui').getAttribute('data-active') === 'journal', 'diário não abriu')
  await page.screenshot({ path: `${out}/04-journal.png` })
  await page.getByRole('button', { name: 'Voltar' }).click()

  // Início e planeio observável.
  await page.locator('#play-btn').click()
  await page.waitForFunction(() => window.__game?.game?.state === 'playing')
  const before = await gameState(page)
  await page.waitForFunction(
    seconds => window.__game?.game?.run?.seconds > seconds + 0.4,
    before.seconds,
    { timeout: 15_000, polling: 250 },
  )
  const after = await gameState(page)
  const moved = Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2])
  check(after.state === 'playing', `deveria estar voando, estado: ${after.state}`)
  check(after.seconds > before.seconds + 0.4, 'relógio do voo não avançou')
  check(moved > 2, `o pássaro mal se deslocou (${moved.toFixed(1)} m)`)
  check(after.speed > 4, `velocidade baixa durante planeio (${after.speed.toFixed(1)} m/s)`)
  await page.screenshot({ path: `${out}/05-flight.png` })

  // Bater asas deve consumir fôlego quando o piloto segura Espaço.
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.__game.game.flight.cruise === false, { timeout: 5_000 })
  check(await page.evaluate(() => window.__game.game.flight.cruise) === false, 'F não desligou o cruzeiro automático')
  const rested = await gameState(page)
  await page.keyboard.down('Space')
  try {
    await page.waitForFunction(previous => window.__game.game.flight.stamina < previous - 0.4, rested.stamina, { timeout: 6_000 })
  } finally {
    await page.keyboard.up('Space')
  }
  const flapped = await gameState(page)
  check(rested.stamina - flapped.stamina > 0.4, 'bater asas não consumiu fôlego')
  await page.screenshot({ path: `${out}/06-flap.png` })

  // C percorre câmeras; pausa congela a simulação e o submenu volta à pausa.
  const previousCamera = (await gameState(page)).camera
  await page.keyboard.press('c')
  await page.waitForFunction(() => window.__game.game.rig.mode !== 'chase', { timeout: 5_000 })
  const nextCamera = (await gameState(page)).camera
  check(previousCamera !== nextCamera, 'tecla C não trocou a câmera')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active', { timeout: 5_000 })
  await page.screenshot({ path: `${out}/07-pause.png` })
  await page.waitForTimeout(350)
  const frozen = await gameState(page)
  await page.waitForTimeout(600)
  const stillFrozen = await gameState(page)
  check(frozen.state === 'paused' && stillFrozen.state === 'paused', 'Escape não pausou o voo')
  check(Math.abs(stillFrozen.seconds - frozen.seconds) < 1e-9, 'simulação avançou durante a pausa')
  await page.getByRole('button', { name: 'Configurações' }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check(await page.locator('#ui').getAttribute('data-active') === 'pause', 'Escape no submenu retomou o voo em vez de voltar à pausa')
  check((await gameState(page)).state === 'paused', 'voo deixou de estar pausado ao sair de Configurações')

  await page.getByRole('button', { name: 'Retomar voo' }).click()
  await page.waitForFunction(() => window.__game.game.state === 'playing')
  check((await gameState(page)).state === 'playing', 'Retomar voo não retomou')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.getByRole('button', { name: 'Reiniciar voo' }).click()
  await page.waitForFunction(() => window.__game.game.state === 'playing')
  check((await gameState(page)).seconds < 0.2, 'reiniciar não criou uma corrida nova')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.getByRole('button', { name: 'Voltar ao início' }).click()
  await page.waitForFunction(() => window.__game.game.state === 'title')
  check((await pageState(page)) === 'title', 'Voltar ao início não abriu o título')
  await page.screenshot({ path: `${out}/08-title-again.png` })
  await page.close()

  // Touch em retrato e paisagem, incluindo manche, ações, pausa e qualidade móvel.
  const mobileErrors = []
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  mobile.on('console', m => m.type() === 'error' && mobileErrors.push(m.text()))
  mobile.on('pageerror', e => mobileErrors.push(String(e)))
  await mobile.goto(url)
  await mobile.waitForSelector('[data-screen="title"].is-active', { timeout: 60_000 })
  const mobileSetup = await mobile.evaluate(() => ({
    method: window.__game.input.method,
    quality: window.__game.save.data.quality,
    coarse: matchMedia('(pointer: coarse)').matches,
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    titleFits: document.querySelector('.title-panel').getBoundingClientRect().right <= innerWidth + 1,
  }))
  check(mobileSetup.method === 'touch' && mobileSetup.coarse, `entrada touch não ativada (${mobileSetup.method}/${mobileSetup.coarse})`)
  check(mobileSetup.quality === 'low', `preset mobile não reduziu qualidade (${mobileSetup.quality})`)
  check(mobileSetup.viewport.includes('viewport-fit=cover') && mobileSetup.titleFits, 'viewport/área segura do título móvel incorretos')
  await mobile.getByRole('button', { name: 'Escolher ave' }).click({ force: true })
  check(await mobile.locator('[data-screen="birds"] [data-bird]').count() === 5, 'seletor mobile não mostrou as cinco aves')
  await mobile.locator('[data-screen="birds"] button').last().click({ force: true })
  await mobile.locator('#play-btn').click({ force: true })
  await mobile.waitForFunction(() => window.__game.game.state === 'playing')
  check(await mobile.evaluate(() => !document.pointerLockElement && getComputedStyle(document.querySelector('#touch-controls')).display !== 'none'), 'controles touch não apareceram ou pointer lock foi solicitado')
  check(await mobile.locator('#touch-land').count() === 1, 'botão touch de pouso não foi criado')
  await mobile.waitForTimeout(500)
  check(await mobile.locator('#touch-land').evaluate(button => button.hidden), 'Pousar apareceu sem proximidade/velocidade de aproximação')
  const cdp = await mobile.context().newCDPSession(mobile)
  const stick = await mobile.locator('.touch-stick').boundingBox()
  const sx = stick.x + stick.width / 2
  const sy = stick.y + stick.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: sx, y: sy, force: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: sx + 30, y: sy - 30, force: 1 }] })
  await mobile.waitForFunction(() => window.__game.input.pitch > 0.1 && window.__game.input.bank < -0.1, { timeout: 5_000 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await mobile.waitForFunction(() => Math.abs(window.__game.input.pitch) < 0.2 && Math.abs(window.__game.input.bank) < 0.2, { timeout: 5_000 })
  const flap = await mobile.locator('#touch-flap').boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: flap.x + flap.width / 2, y: flap.y + flap.height / 2, force: 1 }] })
  await mobile.waitForFunction(() => window.__game.input.flap, { timeout: 5_000 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await mobile.waitForFunction(() => !window.__game.input.flap, { timeout: 5_000 })
  const cameraBefore = (await gameState(mobile)).camera
  await mobile.locator('#touch-camera').click({ force: true })
  await mobile.waitForFunction(before => window.__game.game.rig.mode !== before, cameraBefore, { timeout: 5_000 })
  check((await gameState(mobile)).camera !== cameraBefore, 'botão touch da câmera não funcionou')
  const cruiseBefore = await mobile.evaluate(() => window.__game.game.flight.cruise)
  await mobile.locator('#touch-cruise').click({ force: true })
  await mobile.waitForFunction(before => window.__game.game.flight.cruise !== before, cruiseBefore, { timeout: 5_000 })
  check(await mobile.evaluate(() => window.__game.game.flight.cruise) !== cruiseBefore, 'botão touch de cruzeiro não funcionou')
  await mobile.locator('#touch-pause').click({ force: true })
  await mobile.waitForSelector('[data-screen="pause"].is-active')
  await mobile.getByRole('button', { name: 'Retomar voo' }).click({ force: true })
  await mobile.waitForFunction(() => window.__game.game.state === 'playing')
  await mobile.setViewportSize({ width: 844, height: 390 })
  const landscapeFits = await mobile.evaluate(() => ['.touch-stick', '.touch-actions'].every(selector => {
    const r = document.querySelector(selector).getBoundingClientRect()
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
  }))
  check(landscapeFits, 'controles touch saíram da viewport em paisagem')
  await mobile.close()
  if (mobileErrors.length) throw new Error(`erros de console/rede no mobile:\n  ${mobileErrors.join('\n  ')}`)

  const broken = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'pt-BR' })
  await broken.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/i.test(String(type))) return null
      return original.call(this, type, ...args)
    }
  })
  await broken.goto(url)
  await broken.waitForSelector('.fatal[role="alert"]', { timeout: 30_000 })
  check(await broken.getByRole('button', { name: 'Tentar novamente' }).count() === 1, 'falha WebGL não ofereceu Retry')
  check((await broken.locator('.fatal').innerText()).includes('WebGL'), 'mensagem de recuperação WebGL não foi localizada')
  await broken.screenshot({ path: `${out}/09-retry.png` })
  await broken.close()

  if (errors.length) throw new Error(`erros de console/rede:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — espécies e atributos, cidades/fauna, assistência, voo, fôlego, câmera, menus, pausa, reinício e retry WebGL; capturas em ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
function pageState(page) {
  return page.evaluate(() => window.__game.game.state)
}
