export type RGB = [number, number, number]

export type BirdSpeciesId = 'sabia' | 'bem-te-vi' | 'andorinha' | 'arara' | 'coruja'
export type BirdPalette = {
  back: RGB
  backLight: RGB
  breast: RGB
  belly: RGB
  throat: RGB
  streak: RGB
  wingDark: RGB
  wingMid: RGB
  wingEdge: RGB
  beak: RGB
  eyeRing: RGB
}

/** Multiplicadores simples aplicados pelos mesmos donos de física do voo. */
export type FlightProfile = {
  maxSpeed: number
  cruiseSpeed: number
  turning: number
  flapPower: number
  staminaUse: number
  recovery: number
  glide: number
}

export type BirdSpecies = {
  id: BirdSpeciesId
  name: string
  subtitle: string
  description: string
  trait: string
  swatch: string
  bodyScale: number
  wingSpan: number
  headScale: number
  flight: FlightProfile
  palette: BirdPalette
}

const palette = (values: BirdPalette): BirdPalette => values

export const BIRD_SPECIES: readonly BirdSpecies[] = [
  {
    id: 'sabia', name: 'Sabiá-laranjeira', subtitle: 'Equilibrado',
    description: 'Uma ave versátil para aprender a voar e explorar o vale.',
    trait: 'Equilibrada', swatch: '#d57b35',
    bodyScale: 1, wingSpan: 1, headScale: 1,
    flight: { maxSpeed: 1, cruiseSpeed: 1, turning: 1, flapPower: 1, staminaUse: 1, recovery: 1, glide: 1 },
    palette: palette({
      back: [0.115, 0.085, 0.052], backLight: [0.19, 0.14, 0.085], breast: [0.62, 0.215, 0.045],
      belly: [0.7, 0.4, 0.14], throat: [0.62, 0.5, 0.36], streak: [0.1, 0.07, 0.045],
      wingDark: [0.07, 0.05, 0.035], wingMid: [0.16, 0.115, 0.07], wingEdge: [0.34, 0.25, 0.15],
      beak: [0.8, 0.42, 0.03], eyeRing: [0.85, 0.5, 0.03],
    }),
  },
  {
    id: 'bem-te-vi', name: 'Bem-te-vi', subtitle: 'Manobrável',
    description: 'Responde rápido às curvas e recupera o fôlego com facilidade.',
    trait: 'Curvas +22% · fôlego +15%', swatch: '#e4b83c',
    bodyScale: 1.02, wingSpan: 1.04, headScale: 1.02,
    flight: { maxSpeed: 0.97, cruiseSpeed: 0.98, turning: 1.22, flapPower: 1.02, staminaUse: 0.92, recovery: 1.15, glide: 0.98 },
    palette: palette({
      back: [0.065, 0.055, 0.045], backLight: [0.17, 0.12, 0.065], breast: [0.82, 0.55, 0.055],
      belly: [0.72, 0.59, 0.24], throat: [0.79, 0.72, 0.53], streak: [0.12, 0.08, 0.035],
      wingDark: [0.035, 0.03, 0.025], wingMid: [0.13, 0.105, 0.065], wingEdge: [0.44, 0.32, 0.12],
      beak: [0.35, 0.24, 0.08], eyeRing: [0.85, 0.55, 0.08],
    }),
  },
  {
    id: 'andorinha', name: 'Andorinha', subtitle: 'Velocista',
    description: 'Asas longas para ganhar velocidade e fazer curvas rápidas.',
    trait: 'Velocidade máxima +22%', swatch: '#5087cb',
    bodyScale: 0.9, wingSpan: 1.17, headScale: 0.9,
    flight: { maxSpeed: 1.22, cruiseSpeed: 1.12, turning: 1.14, flapPower: 1.04, staminaUse: 1.04, recovery: 0.98, glide: 1.08 },
    palette: palette({
      back: [0.035, 0.065, 0.16], backLight: [0.07, 0.15, 0.32], breast: [0.56, 0.57, 0.56],
      belly: [0.67, 0.66, 0.62], throat: [0.38, 0.29, 0.27], streak: [0.025, 0.04, 0.09],
      wingDark: [0.02, 0.035, 0.1], wingMid: [0.06, 0.12, 0.25], wingEdge: [0.18, 0.3, 0.5],
      beak: [0.32, 0.22, 0.12], eyeRing: [0.48, 0.36, 0.18],
    }),
  },
  {
    id: 'arara', name: 'Arara-canindé', subtitle: 'Asas fortes',
    description: 'Batidas potentes e bastante energia para subir pelas térmicas.',
    trait: 'Batida +20% · fôlego +25%', swatch: '#35a8dc',
    bodyScale: 1.16, wingSpan: 1.12, headScale: 1.13,
    flight: { maxSpeed: 1.02, cruiseSpeed: 0.98, turning: 0.9, flapPower: 1.2, staminaUse: 0.9, recovery: 1.25, glide: 1.04 },
    palette: palette({
      back: [0.015, 0.12, 0.31], backLight: [0.025, 0.33, 0.65], breast: [0.85, 0.58, 0.045],
      belly: [0.86, 0.7, 0.12], throat: [0.78, 0.72, 0.5], streak: [0.02, 0.08, 0.16],
      wingDark: [0.015, 0.08, 0.22], wingMid: [0.025, 0.21, 0.43], wingEdge: [0.2, 0.5, 0.72],
      beak: [0.17, 0.12, 0.085], eyeRing: [0.85, 0.67, 0.12],
    }),
  },
  {
    id: 'coruja', name: 'Coruja-buraqueira', subtitle: 'Planadora',
    description: 'Planeia por mais tempo e repõe o fôlego depressa quando descansa.',
    trait: 'Planeio +20% · fôlego +42%', swatch: '#c69a63',
    bodyScale: 1.08, wingSpan: 1.08, headScale: 1.18,
    flight: { maxSpeed: 0.9, cruiseSpeed: 0.92, turning: 0.86, flapPower: 0.94, staminaUse: 0.82, recovery: 1.42, glide: 1.2 },
    palette: palette({
      back: [0.19, 0.115, 0.055], backLight: [0.34, 0.23, 0.12], breast: [0.62, 0.39, 0.18],
      belly: [0.74, 0.57, 0.34], throat: [0.8, 0.69, 0.48], streak: [0.14, 0.075, 0.025],
      wingDark: [0.12, 0.075, 0.035], wingMid: [0.24, 0.15, 0.07], wingEdge: [0.52, 0.36, 0.18],
      beak: [0.68, 0.42, 0.045], eyeRing: [0.92, 0.64, 0.08],
    }),
  },
]

export const DEFAULT_BIRD_ID: BirdSpeciesId = 'sabia'
export const isBirdSpeciesId = (value: unknown): value is BirdSpeciesId =>
  typeof value === 'string' && BIRD_SPECIES.some(species => species.id === value)

export function getBirdSpecies(id: BirdSpeciesId | string): BirdSpecies {
  return BIRD_SPECIES.find(species => species.id === id) ?? BIRD_SPECIES[0]
}
