/**
 * Todo o ajuste fino do simulador fica aqui. Unidades SI (metros, segundos); o pássaro tem ~1 m
 * de comprimento e ~1,7 m de envergadura (ampliado para ficar legível na câmera).
 */
export const DEFAULT_CONFIG = {
  flight: {
    gravity: 9.81,
    /** Aceleração aerodinâmica por (m/s)² por unidade de coeficiente (carga alar). */
    liftK: 0.1474,
    /** Inclinação da curva CL x ângulo de ataque (1/rad). */
    liftSlope: 5.5,
    /** Ângulo de ataque crítico (rad) a partir do qual a asa entra em estol. */
    stallAngle: 0.3,
    cd0: 0.045,
    inducedK: 0.08,
    /** Ângulo de ataque de equilíbrio (rad): define a velocidade de planeio natural. */
    trimAlpha: 0.1,
    /** Velocidade (m/s) em que o ângulo de equilíbrio sustenta o peso. */
    trimSpeed: 11,
    maxSpeed: 42,
    cruiseSpeed: 15.5,
    pitchRate: 1.35,
    rollRate: 2.6,
    maxBank: 0.85,
    flapHz: 3.1,
    flapForward: 12,
    flapLift: 6.5,
    boostMult: 1.75,
    ceiling: 430,
  },
  stamina: {
    max: 150,
    flapDrain: 8,
    boostDrain: 24,
    recover: 12,
    restRecover: 28,
  },
  wind: {
    speed: 3.6,
    gust: 0.45,
    thermalStrength: 4.2,
    ridgeLift: 1.5,
  },
  time: {
    /** Duração de um dia completo, em minutos reais. */
    dayMinutes: 16,
    /** Hora inicial (0–24). */
    startHour: 16.6,
  },
  camera: {
    distance: 4.3,
    height: 1.15,
    follow: 6.5,
    fov: 62,
  },
  world: {
    size: 3072,
    /** Raio a partir do qual o vento empurra o pássaro de volta ao vale. */
    softRadius: 1250,
    hardRadius: 1480,
  },
  seeds: {
    count: 48,
    pickupRadius: 5.5,
  },
} as const

// Em jogo sempre lemos os valores ativos daqui. Os padrões-fonte permanecem imutáveis para o
// Reset e o Save do Tweak; Apply nunca grava no código-fonte nem no localStorage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
