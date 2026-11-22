# Cortafuego data pipeline

Bakes the static data files the browser simulator reads from `web/public/data/`. The formats, units
and enums are defined once in [`web/src/engine/types.ts`](../web/src/engine/types.ts); this pipeline
writes exactly that and re-reads every file at the end to check it against the contract.

```bash
cd pipeline
uv run python bake.py            # ~8 s with a warm cache; ~3-4 min from scratch (see below)
uv run python bake.py --refresh  # wipe the download cache first and re-download everything
uv run pytest                    # unit tests for the non-trivial logic (no network)
```

Needs only `uv` (Python 3.12/3.13 and wheels for numpy, rasterio + GDAL, scipy and duckdb are pulled
automatically). Downloads are cached in `pipeline/.cache/` (gitignored, ~60 MB), so reruns are offline
and give byte-identical outputs (checked: two runs, same checksums; a from-scratch re-download gave
byte-identical rasters, Overture and Sentinel-2 caches). From scratch, the slow parts are Overture (~60 s)
and the Overpass street query (~45 s on a free server; one measured run took 650 s in all because two
public Overpass servers were saturated and the client moved on to a mirror). Any failure raises with a clear message: there are no silent fallbacks,
except Overture -> OSM for buildings, which is printed and recorded in the summary.

## Grid

Fixed: `latMax = -32.965`, `lonMin = -71.625`, 60 m cells, `dLat = 60/111320`,
`dLon = 60/(111320 cos 33.09°)`, 464 rows x 529 cols (to about lat -33.215, lon -71.285): Viña del Mar,
Quilpué, Villa Alemana and the Lago Peñuelas reserve. Row 0 is the north edge, row-major.
Clock origin `t0 = 2024-02-02T12:00:00-03:00`.

## Outputs

| File | Content | Source |
|---|---|---|
| `grid.json` | `GridMeta` + `sources` (dataset -> citation, shown on the "Fuentes" panel) | - |
| `elevation.bin` | Float32 per cell, m a.s.l. | Copernicus DEM GLO-30 |
| `fuel.bin` | Uint8 `FUEL` code per cell | ESA WorldCover 2021 + building coverage |
| `buildings.bin` | Float32 `[lon, lat, footprintM2]` per building | Overture Maps buildings |
| `roads.json` | `RoadsFile` street graph | OpenStreetMap (Overpass API) |
| `weather.json` | `WeatherFile`, hourly 2-3 Feb 2024 | Open-Meteo archive (ERA5-based) |
| `scar.bin` | Uint8 per cell: 1 burned, 0 not, 255 no data | Sentinel-2 L2A dNBR |
| `firms.json` | `FirmsPoint[]`, 2-4 Feb 2024 local | NASA FIRMS (VIIRS, MODIS) |
| `ignitions.json` | `IgnitionPreset[]` | FIRMS first detections + press reports |

Binary files are little-endian, `rows * cols` values (except `buildings.bin`).

## Method per file

**elevation.bin.** Copernicus GLO-30 COGs on AWS, tiles `S34_00_W072_00` (lat -34..-33) and
`S33_00_W072_00` (lat -33..-32) (bounds verified by reading them). Value = mean of the 30 m DEM pixels
whose centres fall in the cell (4.5 pixels per cell on average). Sea is 0 m. GLO-30 is a surface model
(DSM): tree canopy and large buildings are included in the height.

**fuel.bin.** ESA WorldCover 10 m v200 (2021), tiles `S36W072` and `S33W072` (the grid straddles lat -33),
read by window through GDAL `/vsicurl/`. Majority class of the ~50 pixels per cell, then:
10 -> FOREST, 20 -> SHRUB, 30 -> GRASS, 40 -> CROP, 50 -> built-up, 60/70/80 -> NONE, 90 -> GRASS,
95 -> FOREST, 100 -> GRASS. Built-up cells become URBAN_DENSE when building footprints cover >= 15 % of the
cell, else URBAN_LOW; vegetation cells with >= 25 % roof coverage also become URBAN_DENSE. Roof
coverage = sum of footprint areas of the buildings whose centroid is in the cell / 3600 m2.

**buildings.bin.** Overture Maps buildings, release `2026-11-18.0` (latest in the bucket at bake time),
read anonymously from `s3://overturemaps-us-west-2/` with DuckDB (httpfs + spatial), filtered on the
`bbox` struct columns (about 65 s). Centroid and area (local equirectangular scale) per footprint;
buildings whose centroid is outside the grid are dropped. Overture merges OSM with Microsoft and Google
ML footprints: in a 5.6 x 4.4 km box over south-east Viña del Mar (lat -33.07..-33.03, lon -71.53..-71.47)
it has ~13,400 buildings against ~1,300 in OSM as of 25 Jan 2024 (Overpass attic query). Fallback (only if Overture fails, printed loudly): current OSM `building=*` ways via
Overpass.

**roads.json.** All `highway=*` ways in the bbox from the Overpass API (`out body; >; out skel qt;`),
clipped to the grid (each way is cut into its runs of consecutive in-grid nodes, so every node has a cell).
Graph nodes at way ends and at OSM nodes shared by 2+ ways; one edge per stretch between consecutive
graph nodes, with haversine length and class: motorway/trunk(+_link) -> MOTORWAY, primary(+_link) ->
PRIMARY, secondary(+_link) -> SECONDARY, tertiary(+_link) -> TERTIARY, residential / unclassified /
living_street / service / road / busway -> LOCAL, track / path / footway / steps / pedestrian / cycleway /
bridleway / corridor -> PATH. Not-usable values (construction, proposed, raceway, services, escape ramps,
...) are excluded by an explicit list and counted in the log; any other unknown value is printed with a
`!!` warning. Connected components with fewer than 20 nodes are dropped. Coordinates rounded to
6 decimals. Because the file was over 10 MB, polylines are simplified with Douglas-Peucker at 1 m
(edge lengths are computed before simplification, from the full geometry).

**weather.json.** Open-Meteo historical archive (ERA5 / ERA5-Land based reanalysis, no key) at
-33.10, -71.49, hourly, local time, 2-3 Feb 2024: temperature, relative humidity, 10 m wind speed,
direction (from) and gusts.

**scar.bin.** Sentinel-2 L2A from the Element84 Earth Search STAC (no auth): pre-fire
`S2B_19HBD_20240118` (0.62 % cloud), post-fire `S2A_19HBD_20240212` (0.06 % cloud); tile 19HBD covers the
whole grid. Reflectance = DN x 0.0001 - 0.1; B08 averaged to the 20 m grid of B12 / SCL.
NBR = (B08 - B12) / (B08 + B12), dNBR = NBR_pre - NBR_post, burned pixel if dNBR > 0.27 (0.15 in
built-up cells: roofs and paving have low pre-fire NBR; away from the fire 99 % of built-up pixels have
dNBR < 0.18). Pixels flagged by SCL in either scene as no data, saturated, cloud shadow, water, cloud or
snow are invalid (SCL "dark area" is kept: fresh scars often fall there). Speckle removed with an area
opening (burned-pixel patches under 9 pixels = 0.36 ha). Cell = 255 if less than half its pixels are
valid (sea, Lago Peñuelas), else 1 if more than half of its valid pixels are burned. Finally only the
8-connected burned patches that come within 400 m (one VIIRS pixel) of a VIIRS detection of 2-3 Feb 2024
are kept; the rest (other changes between the two dates) is dropped and its area printed.
The post-fire scene is 10 days later, so the scar is the final footprint of the whole event (2-4 Feb).

**firms.json.** NASA FIRMS yearly country archive for Chile 2024 (public, no key:
`https://firms.modaps.eosdis.nasa.gov/data/country/{viirs-snpp,viirs-jpss1,modis}/2024/..._2024_Chile.csv`),
downloaded once into `.cache/firms/`. Points in the grid with local date 2-4 Feb 2024, local time =
UTC - 3 h (Chile summer time).

**ignitions.json.** Documented facts are thin on exact points. Las Tablas / Lago Peñuelas: press reports
(CIPER; Cooperativa, 2 Feb 2024) say a CONAF lookout tower detected it at about 12:06 and that it began
around noon at Fundo Las Tablas, next to the reserve; the point is the upwind (southern) end of the first
VIIRS cluster (14:47) and the time 12:05. Quilpué / Villa Alemana: centroid of the second cluster in the
first VIIRS pass, start 30 min before that detection (14:17). Both are labelled approximate and say why.

## Sources and licences

- Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided
  under COPERNICUS by the European Union and ESA; free licence. https://registry.opendata.aws/copernicus-dem/
- ESA WorldCover 10 m 2021 v200: © ESA WorldCover project 2021, contains modified Copernicus Sentinel data
  (2021), CC BY 4.0. https://esa-worldcover.org/
- Overture Maps buildings: ODbL 1.0 (includes OpenStreetMap; Microsoft and Google footprints under their
  open licences). https://overturemaps.org/
- OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright
- Open-Meteo: CC BY 4.0; ERA5 © ECMWF / Copernicus Climate Change Service. https://open-meteo.com/
- Sentinel-2 L2A: contains modified Copernicus Sentinel data (2024). Earth Search by Element 84.
- NASA FIRMS: NASA open data, attribution requested. https://firms.modaps.eosdis.nasa.gov/

## Known limitations

- Buildings and streets are today's (Overture `2026-11-18.0`, current OSM), not February 2024's: some
  burned houses were rebuilt or removed, some streets are new.
- Weather is a single point of a coarse reanalysis (ERA5 ~28 km, ERA5-Land ~9 km): it smooths the local
  extremes of that afternoon (heat, dryness, gusts) and has no terrain effects. Treat it as a baseline
  for the wind / humidity / temperature controls, not as the observed local conditions.
- WorldCover is from 2021 and has no fuel-type detail (eucalyptus vs pine vs native forest are all
  FOREST).
- The burn scar marks only cells where most pixels changed: lightly burned edges and isolated burned
  houses inside unburned blocks are missed; burned built-up area is under-detected (225 ha marked).
- Ignition presets are approximate (see above); they are not official findings.
