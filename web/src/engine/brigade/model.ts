// Every parameter of the firefighting model, with its source or marked "supuesto" (assumption). The UI lists
// the supuestos (ui/BrigadesSection.tsx). MODEL.md explains how they are used.
import { UNIT, type UnitType } from '../types'

export interface FirefightParam {
  value: number
  unit: string
  labelEs: string
  /** null = supuesto (no source found). */
  source: string | null
}

const p = (value: number, unit: string, labelEs: string, source: string | null): FirefightParam => ({ value, unit, labelEs, source })

export const FIREFIGHT_MODEL = {
  /** Water carried, litres, per UnitType. */
  tankL: {
    [UNIT.BOMBA]: p(3000, 'L', 'Estanque carro bomba', null),
    [UNIT.FORESTAL]: p(1500, 'L', 'Estanque carro forestal', null),
    [UNIT.ALJIBE]: p(
      8000,
      'L',
      'Estanque carro aljibe',
      'Junta Nacional de Bomberos, licitación 15-2019 (carros cisterna), preguntas y respuestas: estanque de 8.000 L para el aljibe 4x2 (https://app.bomberos.cl/saweb/src/upload/2019/15/RG_01_PC_13_Preguntas_y_Respuestas_Lic_15_2019_CM_Carros_Cisterna.pdf)',
    ),
    [UNIT.RESCATE]: p(0, 'L', 'Estanque escala / rescate', 'Sin agua propia: "nuestro carro no maneja agua" (10ª Compañía de Valparaíso, BioBioChile, 8 feb 2024)'),
  } as Record<UnitType, FirefightParam>,
  /** Water used while a Bomba or Forestal works (one 38 mm line, defensive). */
  flowLPerMin: p(200, 'L/min', 'Caudal mientras trabaja', null),
  /** Structure protection: urban cells within this distance of the work site (square of cells). */
  bombaRadiusM: p(60, 'm', 'Radio de defensa del carro bomba', null),
  /** Direct attack: wildland cells within this distance of the work site (square of cells). */
  forestalRadiusM: p(120, 'm', 'Radio de ataque del carro forestal', null),
  /** Above this fireline intensity, direct attack at the head by engines is ineffective. 500 Btu/ft/s, flame
   *  length 8 ft (2.4 m): the upper limit of the band where "equipment such as plows, dozers, pumpers" can be
   *  effective, Andrews & Rothermel (1982), Charts for interpreting wildland fire behavior characteristics,
   *  USDA GTR INT-131, Table 1. */
  directAttackMaxKwM: p(1730, 'kW/m', 'Intensidad máxima para ataque directo', 'Andrews & Rothermel (1982), USDA GTR INT-131, tabla 1 (llama de 2,4 m)'),
  /** Households one Escala / rescate unit can take out per hour of work. */
  rescuePerHour: p(6, 'hogares/h', 'Hogares rescatados por hora por carro', null),
  rescueRadiusM: p(300, 'm', 'Radio de rescate', null),
  /** Dispatch sectors: square blocks of this many cells (8 x 60 m = 480 m). */
  sectorCells: 8,
  /** A historical cut applies to MOTORWAY / PRIMARY edges whose midpoint is within this distance of its line. */
  cutSnapM: 90,
} as const
