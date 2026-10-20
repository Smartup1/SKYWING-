/**
 * Pontuação com combo: sementes e pousos encadeados dentro da janela sobem o multiplicador (até ×5);
 * ser pego por um gavião quebra o combo. Lógica pura, fácil de testar.
 */
export const COMBO_WINDOW = 12
export const MAX_MULTIPLIER = 5

export class Score {
  points = 0
  /** Ações encadeadas na janela atual. */
  chain = 0
  comboTimer = 0

  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.chain / 2))
  }

  /** Fração (0–1) da janela de combo restante, para a barra do HUD. */
  get comboLeft(): number {
    return this.chain > 0 ? Math.max(0, Math.min(1, this.comboTimer / COMBO_WINDOW)) : 0
  }

  /** Soma `base` × multiplicador. Ações `chained` alimentam o combo. Devolve os pontos ganhos. */
  award(base: number, chained = false): number {
    const gained = Math.round(base * this.multiplier)
    this.points += gained
    if (chained) {
      this.chain += 1
      this.comboTimer = COMBO_WINDOW
    }
    return gained
  }

  breakCombo(): void {
    this.chain = 0
    this.comboTimer = 0
  }

  penalty(points: number): void {
    this.points = Math.max(0, this.points - points)
  }

  update(dt: number): void {
    if (this.chain <= 0) return
    this.comboTimer -= dt
    if (this.comboTimer <= 0) this.breakCombo()
  }

  reset(): void {
    this.points = 0
    this.breakCombo()
  }
}
