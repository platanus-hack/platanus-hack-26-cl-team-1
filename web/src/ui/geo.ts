// Minimal GeoJSON types (the project does not ship @types/geojson; MapLibre accepts these shapes).
import type { GeoJSONSource } from 'maplibre-gl'

export type Position = [number, number] | number[]
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
export type LineString = Extract<Geometry, { type: 'LineString' }>
export interface Feature {
  type: 'Feature'
  id?: number
  geometry: Geometry
  properties: Record<string, unknown>
}
export interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}
export type SetDataArg = Parameters<GeoJSONSource['setData']>[0]
