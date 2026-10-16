/**
 * Áudio 100% sintetizado (sem arquivos): vento, água, canto de aves, grilos, batidas de asa,
 * efeitos de interface e uma trilha suave. Tudo passa por barramentos de música e efeitos.
 */
export type AmbientState = {
  speed: number
  agl: number
  altitude: number
  overWater: number
  thermal: number
  daylight: number
  night: number
  flapping: boolean
  grounded: boolean
}

const PENTA = [0, 2, 4, 7, 9]
const CHORDS = [
  [57, 64, 67, 71],
  [53, 60, 64, 69],
  [48, 55, 59, 64],
  [55, 62, 67, 71],
]
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12)

export class Audio {
  private ctx?: AudioContext
  private master?: GainNode
  private sfx?: GainNode
  private music?: GainNode
  private noise?: AudioBuffer
  private windGain?: GainNode
  private windFilter?: BiquadFilterNode
  private waterGain?: GainNode
  private cricketGain?: GainNode
  private thermalGain?: GainNode
  private musicVol = 0.35
  private sfxVol = 0.8
  private muted = false
  private musicTimer = 0
  private chordIndex = 0
  private chirpTimer = 2
  private musicOn = false
  private nextChord = 0

  get ready(): boolean {
    return !!this.ctx
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.ratio.value = 3
      this.master = this.ctx.createGain()
      this.sfx = this.ctx.createGain()
      this.music = this.ctx.createGain()
      this.sfx.connect(this.master)
      this.music.connect(this.master)
      this.master.connect(comp).connect(this.ctx.destination)
      this.buildNoise()
      this.buildAmbience()
      this.applyVolumes()
    }
    void this.ctx.resume()
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.musicVol = music
    this.sfxVol = sfx
    this.muted = muted
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.music) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05)
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05)
    this.music.gain.setTargetAtTime(this.musicVol * 0.5, t, 0.05)
  }

  private buildNoise(): void {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22
    }
    this.noise = buf
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource()
    src.buffer = this.noise!
    src.loop = true
    src.loopStart = Math.random()
    src.start()
    return src
  }

  private buildAmbience(): void {
    const ctx = this.ctx!
    // Vento.
    const wind = this.loopNoise()
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.Q.value = 0.55
    this.windFilter.frequency.value = 400
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx!)
    // Água.
    const water = this.loopNoise()
    const wf = ctx.createBiquadFilter()
    wf.type = 'lowpass'
    wf.frequency.value = 900
    this.waterGain = ctx.createGain()
    this.waterGain.gain.value = 0
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.23
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.25
    lfo.connect(lfoGain).connect(this.waterGain.gain)
    lfo.start()
    water.connect(wf).connect(this.waterGain).connect(this.sfx!)
    // Grilos (noite).
    const cricket = ctx.createOscillator()
    cricket.frequency.value = 4300
    const trill = ctx.createOscillator()
    trill.type = 'square'
    trill.frequency.value = 17
    const trillGain = ctx.createGain()
    trillGain.gain.value = 0.5
    const am = ctx.createGain()
    am.gain.value = 0.5
    trill.connect(trillGain).connect(am.gain)
    this.cricketGain = ctx.createGain()
    this.cricketGain.gain.value = 0
    cricket.connect(am).connect(this.cricketGain).connect(this.sfx!)
    cricket.start()
    trill.start()
    // Zumbido suave de térmica.
    const th = this.loopNoise()
    const tf = ctx.createBiquadFilter()
    tf.type = 'lowpass'
    tf.frequency.value = 260
    this.thermalGain = ctx.createGain()
    this.thermalGain.gain.value = 0
    th.connect(tf).connect(this.thermalGain).connect(this.sfx!)
  }

  /** Atualiza as camadas contínuas e agenda cantos/música. Chamar a cada quadro. */
  update(dt: number, s: AmbientState): void {
    const ctx = this.ctx
    if (!ctx || !this.windGain) return
    const t = ctx.currentTime
    const sp = s.grounded ? 0 : s.speed
    this.windGain.gain.setTargetAtTime(Math.min(0.5, 0.02 + (sp / 40) ** 1.6 * 0.6), t, 0.15)
    this.windFilter!.frequency.setTargetAtTime(260 + sp * 55, t, 0.2)
    const near = Math.max(0, 1 - s.agl / 70) * s.overWater
    this.waterGain!.gain.setTargetAtTime(near * 0.22, t, 0.4)
    this.cricketGain!.gain.setTargetAtTime(s.night * Math.max(0, 1 - s.agl / 90) * 0.012, t, 0.8)
    this.thermalGain!.gain.setTargetAtTime(s.thermal * 0.07, t, 0.5)
    // Aves cantando (de dia, perto da copa das árvores).
    this.chirpTimer -= dt
    if (this.chirpTimer <= 0) {
      const density = s.daylight * Math.max(0.15, 1 - s.agl / 160)
      this.chirpTimer = 0.8 + Math.random() * 3.2 / Math.max(0.2, density)
      if (density > 0.1 && Math.random() < density + 0.2) this.chirp((Math.random() * 2 - 1) * 0.9, 0.05 + 0.08 * density)
    }
    if (this.musicOn) {
      this.musicTimer -= dt
      if (this.musicTimer <= 0) this.playChord()
    }
  }

  startMusic(): void {
    if (!this.ctx || this.musicOn) return
    this.musicOn = true
    this.musicTimer = 0
  }

  private playChord(): void {
    const ctx = this.ctx!
    const chord = CHORDS[this.chordIndex++ % CHORDS.length]
    const t0 = ctx.currentTime + 0.05
    const dur = 11
    this.musicTimer = dur - 1.2
    for (const [i, note] of chord.entries()) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.value = mtof(note - 12 * (i === 0 ? 1 : 0))
        o.detune.value = detune
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t0)
        g.gain.linearRampToValueAtTime(0.045, t0 + 3.5)
        g.gain.linearRampToValueAtTime(0, t0 + dur)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = 900
        o.connect(f).connect(g).connect(this.music!)
        o.start(t0)
        o.stop(t0 + dur + 0.1)
      }
    }
    // Notas esparsas de sino.
    const root = chord[0] + 12
    for (let k = 0; k < 3; k += 1) {
      const when = t0 + 1 + k * 3 + Math.random() * 2
      const note = root + PENTA[Math.floor(Math.random() * PENTA.length)] + 12
      this.bell(mtof(note), when, 0.05)
    }
    this.nextChord = t0 + dur
  }

  private bell(freq: number, when: number, vol: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(vol, when + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4)
    o.connect(g).connect(this.music!)
    o.start(when)
    o.stop(when + 2.5)
  }

  private env(bus: AudioNode, vol: number, a: number, d: number, when = 0): GainNode {
    const ctx = this.ctx!
    const g = ctx.createGain()
    const t = ctx.currentTime + when
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
    g.connect(bus)
    return g
  }

  private burst(freq: number, q: number, vol: number, a: number, d: number, type: BiquadFilterType = 'bandpass', pan = 0): void {
    if (!this.ctx || !this.noise) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = pan
    const g = this.env(panner, vol, a, d)
    panner.connect(this.sfx!)
    src.connect(f).connect(g)
    src.start(this.ctx.currentTime, Math.random() * 2)
    src.stop(this.ctx.currentTime + a + d + 0.05)
  }

  /** Batida de asa: sopro grave + estalo leve de penas. */
  flap(power = 1): void {
    this.burst(520 + Math.random() * 120, 0.9, 0.34 * Math.min(1.4, power), 0.04, 0.16)
    this.burst(2400, 1.5, 0.07 * power, 0.01, 0.07)
  }

  chirp(pan = 0, vol = 0.1): void {
    if (!this.ctx) return
    const ctx = this.ctx
    const notes = 2 + Math.floor(Math.random() * 4)
    const base = 2200 + Math.random() * 1800
    const style = Math.random()
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    panner.connect(this.sfx!)
    for (let i = 0; i < notes; i += 1) {
      const t = ctx.currentTime + i * (0.07 + Math.random() * 0.05)
      const o = ctx.createOscillator()
      o.type = 'sine'
      const f0 = base * (1 + (style < 0.5 ? i * 0.07 : -i * 0.05))
      o.frequency.setValueAtTime(f0, t)
      o.frequency.exponentialRampToValueAtTime(f0 * (style < 0.3 ? 1.5 : 0.75), t + 0.07)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(g).connect(panner)
      o.start(t)
      o.stop(t + 0.12)
    }
  }

  seed(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (const [i, n] of [76, 83, 88].entries()) {
      const o = this.ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = mtof(n)
      const g = this.env(this.sfx!, 0.22, 0.008, 0.45, i * 0.06)
      o.connect(g)
      o.start(t + i * 0.06)
      o.stop(t + i * 0.06 + 0.6)
    }
  }

  discover(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (const [i, n] of [64, 71, 76, 83].entries()) {
      const o = this.ctx.createOscillator()
      o.frequency.value = mtof(n)
      const g = this.env(this.sfx!, 0.2, 0.02, 1.4, i * 0.14)
      o.connect(g)
      o.start(t + i * 0.14)
      o.stop(t + i * 0.14 + 1.6)
    }
  }

  nestChicks(): void {
    for (let i = 0; i < 4; i += 1) window.setTimeout(() => this.chirp((Math.random() - 0.5) * 0.4, 0.12), i * 160)
  }

  land(): void {
    this.burst(180, 0.7, 0.3, 0.01, 0.2, 'lowpass')
  }

  crash(): void {
    this.burst(150, 0.7, 0.55, 0.005, 0.4, 'lowpass')
    this.burst(1800, 1, 0.2, 0.005, 0.2)
  }

  splash(): void {
    this.burst(1400, 0.5, 0.3, 0.02, 0.45, 'highpass')
    this.burst(400, 0.8, 0.25, 0.02, 0.4)
  }

  stall(): void {
    this.burst(110, 2, 0.28, 0.1, 0.7, 'lowpass')
  }

  click(): void {
    if (!this.ctx) return
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = 660
    const g = this.env(this.sfx!, 0.1, 0.004, 0.08)
    o.connect(g)
    o.start()
    o.stop(this.ctx.currentTime + 0.12)
  }

  /** Piado do bando passando; pan = -1..1. */
  flockCall(pan: number): void {
    this.chirp(pan, 0.07)
  }

  get currentChordEnd(): number {
    return this.nextChord
  }
}
