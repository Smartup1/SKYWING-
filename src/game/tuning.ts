import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_RUN'
type Boundary = 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }

const CATEGORY: Record<string, string> = { flight: 'Voo', stamina: 'Fôlego', wind: 'Vento', time: 'Tempo', camera: 'Câmera', seeds: 'Sementes' }
const bindings: Binding[] = []

function number<S extends keyof typeof CONFIG>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: CATEGORY[section] ?? 'Jogo',
    label, description: boundary === 'run' ? 'Vale a partir do próximo voo reiniciado.' : 'Atualiza esta prévia imediatamente.',
    unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : 'LIVE',
    integrity: section === 'camera' || section === 'time' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}

number('flight', 'cruiseSpeed', 'Velocidade de cruzeiro', 7, 16, 0.5, 'm/s')
number('flight', 'flapForward', 'Força de avanço da batida', 4, 30, 0.5, 'm/s²')
number('flight', 'flapLift', 'Força de subida da batida', 2, 20, 0.5, 'm/s²')
number('flight', 'boostMult', 'Multiplicador do impulso', 1, 3, 0.05, '×')
number('flight', 'pitchRate', 'Agilidade de mergulho/subida', 0.6, 2.4, 0.05, 'rad/s')
number('flight', 'rollRate', 'Agilidade de rolagem', 1, 4, 0.1, 'rad/s')
number('flight', 'maxBank', 'Inclinação máxima nas curvas', 0.4, 1.3, 0.05, 'rad')
number('flight', 'maxSpeed', 'Velocidade máxima', 25, 70, 1, 'm/s')
number('stamina', 'max', 'Fôlego máximo', 40, 200, 5, '', 'run')
number('wind', 'speed', 'Vento base', 0, 12, 0.2, 'm/s')
number('wind', 'gust', 'Rajadas', 0, 1.5, 0.05, '')
number('wind', 'thermalStrength', 'Força das térmicas', 0, 8, 0.2, 'm/s')
number('time', 'dayMinutes', 'Duração do dia', 4, 60, 1, 'min')
number('camera', 'fov', 'Campo de visão', 40, 100, 1, '°')
number('camera', 'distance', 'Distância da câmera', 2, 12, 0.1, 'm')
number('camera', 'follow', 'Suavidade de seguimento', 2, 14, 0.5, '')
number('seeds', 'count', 'Quantidade de sementes', 12, 120, 1, '', 'run')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['flight.cruiseSpeed'] <= values['flight.maxSpeed']

export const tuning = {
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Pacote inválido')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Pacote inválido')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Valor inválido')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Incremento inválido')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('A velocidade de cruzeiro não pode passar da máxima')
    // Atribuições simples, confirmadas de forma síncrona antes do próximo passo de simulação.
    requested = candidate
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
  },
}
