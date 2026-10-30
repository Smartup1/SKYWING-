/**
 * Entrada unificada: teclado, mouse (olhar) e controle. O voo lê eixos suavizados; ações de toque
 * único (pausar, câmera, cruzeiro, bater asas) são consumidas uma vez por pressionamento.
 */
export type Action = 'pause' | 'camera' | 'cruise' | 'flapPressed' | 'land'

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyC', 'KeyF', 'KeyL',
])

const approach = (v: number, target: number, rate: number, dt: number) => {
  const d = target - v
  const step = rate * dt
  return Math.abs(d) <= step ? target : v + Math.sign(d) * step
}

export class Input {
  sensitivity = 0.5
  invertY = false
  method: 'keyboard' | 'gamepad' | 'touch' = 'keyboard'
  /** Eixos suavizados: pitch +1 sobe, bank +1 esquerda, roll +1 rola à esquerda. */
  pitch = 0
  bank = 0
  roll = 0
  flap = false
  boost = false
  /** Quando falso, as teclas de voo são ignoradas (menus). */
  enabled = false
  private readonly keys = new Set<string>()
  private readonly pressed = new Set<Action>()
  private lookX = 0
  private lookY = 0
  private padLookX = 0
  private padLookY = 0
  private padFlap = false
  private padBoost = false
  private padPitch = 0
  private padBank = 0
  private padRoll = 0
  private touchPitch = 0
  private touchBank = 0
  private touchFlap = false
  private touchBoost = false
  private lastPadButtons: boolean[] = []
  private dragging = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    if (navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches) this.method = 'touch'
    window.addEventListener('keydown', e => this.onKey(e, true))
    window.addEventListener('keyup', e => this.onKey(e, false))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.touchPitch = this.touchBank = 0
      this.touchFlap = this.touchBoost = false
    })
    window.addEventListener('mousemove', e => this.onMove(e))
    canvas.addEventListener('mousedown', () => { this.dragging = true })
    window.addEventListener('mouseup', () => { this.dragging = false })
    window.addEventListener('gamepadconnected', () => { this.method = 'gamepad' })
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down) {
      this.method = 'keyboard'
      if (e.code === 'Escape' && !e.repeat) this.pressed.add('pause')
      if (!this.enabled) return
      if (!e.repeat) {
        if (e.code === 'KeyC') this.pressed.add('camera')
        if (e.code === 'KeyF') this.pressed.add('cruise')
        if (e.code === 'KeyL') this.pressed.add('land')
        if (e.code === 'Space') this.pressed.add('flapPressed')
      }
      if (MOVEMENT_KEYS.has(e.code)) e.preventDefault()
      this.keys.add(e.code)
    } else {
      this.keys.delete(e.code)
    }
  }

  private onMove(e: MouseEvent): void {
    if (!this.enabled) return
    if (document.pointerLockElement === this.canvas || this.dragging) {
      this.lookX += e.movementX
      this.lookY += e.movementY
    }
  }

  private held(...codes: string[]): boolean {
    return codes.some(c => this.keys.has(c))
  }

  /** Lê o controle e suaviza os eixos. Chamar uma vez por quadro. */
  update(dt: number): void {
    this.pollPad()
    const sgn = (neg: boolean, pos: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0)
    const live = this.enabled
    let pitchT = live ? sgn(this.held('KeyW', 'ArrowUp'), this.held('KeyS', 'ArrowDown')) : 0
    let bankT = live ? sgn(this.held('KeyD', 'ArrowRight'), this.held('KeyA', 'ArrowLeft')) : 0
    let rollT = live ? sgn(this.held('KeyE'), this.held('KeyQ')) : 0
    if (live && this.padPitch !== 0) pitchT = this.padPitch
    if (live && this.padBank !== 0) bankT = this.padBank
    if (live && this.padRoll !== 0) rollT = this.padRoll
    if (live && this.touchPitch !== 0) pitchT = this.touchPitch
    if (live && this.touchBank !== 0) bankT = this.touchBank
    if (this.invertY) pitchT = -pitchT
    // Ataque rápido, soltura um pouco mais lenta: sensação de controle de ave.
    this.pitch = approach(this.pitch, pitchT, pitchT === 0 ? 7 : 5.5, dt)
    this.bank = approach(this.bank, bankT, bankT === 0 ? 5 : 4.2, dt)
    this.roll = approach(this.roll, rollT, rollT === 0 ? 6 : 8, dt)
    this.flap = live && (this.held('Space') || this.padFlap || this.touchFlap)
    this.boost = live && (this.held('ShiftLeft', 'ShiftRight') || this.padBoost || this.touchBoost)
  }

  /** Manche virtual: pitch +1 sobe; bank +1 curva à esquerda. */
  setTouchAxes(pitch: number, bank: number): void {
    this.touchPitch = Math.max(-1, Math.min(1, pitch))
    this.touchBank = Math.max(-1, Math.min(1, bank))
    if (pitch !== 0 || bank !== 0) this.method = 'touch'
  }

  /** Botões de ação com estado sustentado e disparo de toque único na decolagem. */
  setTouchButton(action: 'flap' | 'boost', down: boolean): void {
    this.method = 'touch'
    if (action === 'flap') {
      this.touchFlap = down
      if (down) this.pressed.add('flapPressed')
    } else this.touchBoost = down
  }

  trigger(action: Action): void {
    this.method = 'touch'
    this.pressed.add(action)
  }

  /** Movimento de olhar acumulado desde a última leitura (radianos). */
  consumeLook(): { x: number; y: number } {
    const k = 0.0016 + this.sensitivity * 0.0044
    const out = { x: this.lookX * k + this.padLookX * 0.035 * (0.5 + this.sensitivity), y: this.lookY * k + this.padLookY * 0.03 * (0.5 + this.sensitivity) }
    this.lookX = 0
    this.lookY = 0
    return out
  }

  consume(action: Action): boolean {
    return this.pressed.delete(action)
  }

  clearPressed(): void {
    this.pressed.clear()
  }

  private pollPad(): void {
    const pad = navigator.getGamepads?.().find(p => p?.connected)
    if (!pad) {
      this.padPitch = this.padBank = this.padRoll = this.padLookX = this.padLookY = 0
      this.padFlap = this.padBoost = false
      return
    }
    const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : v)
    const b = pad.buttons.map(x => x.pressed)
    const edge = (i: number) => b[i] && !this.lastPadButtons[i]
    this.padBank = -dz(pad.axes[0] ?? 0)
    this.padPitch = dz(pad.axes[1] ?? 0)
    this.padLookX = dz(pad.axes[2] ?? 0)
    this.padLookY = dz(pad.axes[3] ?? 0)
    this.padRoll = (b[4] ? 1 : 0) - (b[5] ? 1 : 0)
    this.padFlap = !!b[0]
    this.padBoost = !!b[7] || (pad.buttons[7]?.value ?? 0) > 0.4
    if (edge(0) && this.enabled) this.pressed.add('flapPressed')
    if (edge(3)) this.pressed.add('camera')
    if (edge(2)) this.pressed.add('cruise')
    if (edge(9)) this.pressed.add('pause')
    if (b.some(Boolean) || this.padBank || this.padPitch) this.method = 'gamepad'
    this.lastPadButtons = b
  }

  lockPointer(): void {
    if (document.pointerLockElement === this.canvas) return
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => {})
    } catch {
      /* sem bloqueio de ponteiro: o arrasto do mouse continua funcionando */
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }
}
