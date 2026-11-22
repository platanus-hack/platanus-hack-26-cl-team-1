// Every parameter of the line-building model, with its source or marked "supuesto" (assumption), in the same
// shape as the firefighting model (engine/brigade/model.ts). MODEL.md explains how they are used.
import type { FirefightParam } from '../brigade/model'
import { FUEL } from '../types'

const p = (value: number, unit: string, labelEs: string, source: string | null): FirefightParam => ({ value, unit, labelEs, source })

/** Broyles (2011), Table 2: sustained line production of a 20-person Type I crew, direct attack, in chains per
 *  hour (1 chain = 20.1168 m). Measured on real fires; lower than the handbook rates it replaces. */
const BROYLES = 'Broyles, G. (2011), Fireline Production Rates, USDA Forest Service, San Dimas Technology & Development Center, 1151 1805-SDTDC, tabla 2 (cuadrilla tipo I de 20 personas, ataque directo, ritmo sostenido): https://www.fs.usda.gov/t-d/pubs/pdf/11511805.pdf'
const CHAIN_M = 20.1168
const chainsPerHour = (ch: number) => (ch * CHAIN_M) / 60

export const LINE_MODEL = {
  /** Line built per minute by one 20-person crew, by fuel (m/min). Grass and crops: fuel models 1-2,
   *  17 chains/h. Matorral: chaparral, fuel model 4, 6.6 chains/h (the slower of the two brush rows). Forest
   *  and plantations: timber, fuel models 8-10, 10.5 chains/h. */
  buildMPerMin: {
    [FUEL.GRASS]: p(chainsPerHour(17), 'm/min', 'Avance de una cuadrilla en pastizal', BROYLES),
    [FUEL.CROP]: p(chainsPerHour(17), 'm/min', 'Avance de una cuadrilla en cultivo', BROYLES),
    [FUEL.SHRUB]: p(chainsPerHour(6.6), 'm/min', 'Avance de una cuadrilla en matorral', BROYLES),
    [FUEL.FOREST]: p(chainsPerHour(10.5), 'm/min', 'Avance de una cuadrilla en bosque o plantación', BROYLES),
  },
  /** Crews building line at the same time. */
  crews: p(6, 'cuadrillas', 'Cuadrillas que construyen línea a la vez', null),
  /** A cell must be finished this long before the fire arrives (time for the crew to leave). */
  marginMin: p(30, 'min', 'Margen entre terminar la línea y la llegada del fuego', null),
  /** Speed off the road, from the nearest street to the line. */
  offRoadKmh: p(3, 'km/h', 'Velocidad fuera de camino hasta la línea', null),
} as const
