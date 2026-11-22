# Cortafuego data pipeline

Bakes the static data files the browser simulator reads from `web/public/data/`, one fire event at a time.
The formats, units and enums are defined once in [`web/src/engine/types.ts`](../web/src/engine/types.ts);
this pipeline writes exactly that and re-reads every file at the end to check it against the contract.

```bash
cd pipeline
uv run python bake.py            # Viña del Mar 2024 -> web/public/data/ (~8 s warm; ~3-4 min from scratch)
uv run python bake.py --event eaton-2025  # Eaton 2025 -> web/public/data/eaton-2025/ (~2 min warm, ~11 cold)
uv run python bake.py --refresh  # wipe the event's download cache first and re-download everything
uv run python bake_population.py # national population product + the grid's two layers (~25 s warm, ~80 MB cold)
uv run python population_report.py  # totals and day/night checks quoted in the population MODEL.md
uv run python bake_bomberos.py   # every fire company of Chile with its trucks (national/bomberos_cl.json, ~1 s warm)
uv run pytest                    # unit tests for the non-trivial logic (no network)
```

Needs only `uv` (Python 3.12/3.13 and wheels for numpy, rasterio + GDAL, scipy and duckdb are pulled
automatically). Downloads are cached in `pipeline/.cache/` (gitignored, ~90 MB), so reruns are offline
and give byte-identical outputs (checked: two runs, same checksums; a from-scratch re-download gave
byte-identical rasters, Overture and Sentinel-2 caches; on 2026-11-22 a from-scratch Viña bake, Overpass
and population downloads included, reproduced every committed file byte for byte, before and after the
pipeline was made per-event). From scratch, the slow parts are Overture (~60 s)
and the Overpass street query (~45 s on a free server; one measured run took 650 s in all because two
public Overpass servers were saturated and the client moved on to a mirror). Any failure raises with a clear message: there are no silent fallbacks,
except Overture -> OSM for buildings, which is printed and recorded in the summary.

## Events

Every event-specific value lives in one table, [`steps/events.py`](steps/events.py): the grid, the clock
origin `t0`, the IANA time zone and its UTC offset over the baked window, the output and cache directories,
and the source parameters each step needs (DEM and WorldCover tiles, Sentinel-2 scenes, FIRMS country / year /
dates, GOES satellite and window, weather point and dates, ignition presets, the Spanish `sources` citations of
`grid.json`, whether population is baked, the official perimeter and damage inspections). `bake.py --event <id>` calls
`grid.select(id)`, which re-points the `grid` module attributes; every step reads them as `grid.X` at call time
and its parameters from `grid.EVENT`, so the selection reaches all of them. Importing `steps.grid` selects the
default, `vina-2024`, so `bake_population.py`, `population_report.py` and the tests keep their meaning.

| Event | Output | Download cache | Outputs |
|---|---|---|---|
| `vina-2024` (default) | `web/public/data/` | `pipeline/.cache/` | everything below except the `eaton-2025/` validation files |
| `eaton-2025` | `web/public/data/eaton-2025/` | `pipeline/.cache/eaton-2025/` | the ten base files + `perimeter.bin` + `dins.json`; no population, no brigades (later) |

Both events use the same global sources, so they are comparable; US-only data (the official perimeter, CAL FIRE
damage inspections) is used for validation only. `--refresh` wipes only the selected event's cache (Viña's keeps the other events'
sub-directories).

## Grid

Viña del Mar 2024 (`vina-2024`): `latMax = -32.965`, `lonMin = -71.625`, 60 m cells, `dLat = 60/111320`,
`dLon = 60/(111320 cos 33.09°)`, 464 rows x 529 cols (to about lat -33.215, lon -71.285): Viña del Mar,
Quilpué, Villa Alemana and the Lago Peñuelas reserve. Row 0 is the north edge, row-major.
Clock origin `t0 = 2024-02-02T12:00:00-03:00`.

Eaton 2025 (`eaton-2025`): `latMax = 34.27`, `lonMin = -118.20`, 60 m cells, `dLat = 60/111320`,
`dLon = 60/(111320 cos 34.1875°)` (the grid's centre latitude), 306 rows x 337 cols = 103,122 cells (to about
lat 34.1051, lon -117.9804): Altadena, the San Gabriel foothills burned by the Eaton fire, Sierra Madre and
Pasadena. The official final perimeter (lon -118.162..-118.013, lat 34.162..34.238) has margins of 3.6 km
(north), 3.5 km (west), 3.0 km (east: the grid's east edge is the east edge of Sentinel-2 tile 11SLT at the
grid's north edge) and 6.3 km (south, to take in Pasadena as evacuation destinations). Clock origin
`t0 = 2025-01-07T18:00:00-08:00`; local times are America/Los_Angeles (PST, UTC-8, no DST change in January).
Every grid stays under Viña's 245,456 cells (`grid.MAX_CELLS`).

## Outputs

| File | Content | Source |
|---|---|---|
| `grid.json` | `GridMeta` + `sources` (dataset -> citation, shown on the "Fuentes" panel) | - |
| `elevation.bin` | Float32 per cell, m a.s.l. | Copernicus DEM GLO-30 |
| `fuel.bin` | Uint8 `FUEL` code per cell; built-up split into intermix / consolidated | ESA WorldCover 2021 + Sentinel-2 NDVI of 2024-01-18 + building coverage |
| `buildings.bin` | Float32 `[lon, lat, footprintM2]` per building | Overture Maps buildings |
| `roads.json` | `RoadsFile` street graph | OpenStreetMap (Overpass API) |
| `weather.json` | `WeatherFile`, hourly 2-3 Feb 2024 | Open-Meteo archive (ERA5-based) |
| `scar.bin` | Uint8 per cell: 1 burned, 0 not, 255 no data | Sentinel-2 L2A dNBR |
| `firms.json` | `FirmsPoint[]`, 2-4 Feb 2024 local | NASA FIRMS (VIIRS, MODIS) |
| `goes.json` | `FirmsPoint[]`, GOES-16 fire pixels every 10 min, 2 Feb 12:00 - 3 Feb 04:00 local (scoring only, not loaded by the app) | NOAA GOES-16 ABI L2 FDC |
| `ignitions.json` | `IgnitionPreset[]` | FIRMS first detections + press reports |
| `brigades.json` | `BrigadesFile`: fire companies, trucks, dispatch, reinforcements, road cuts | **Curated by hand** (not baked): OpenStreetMap fire stations + press; see `web/src/engine/brigade/MODEL.md` |
| `population_home.bin` | Float32 residents per cell | WorldPop 2024 (constrained, 100 m) |
| `population_work.bin` | Float32 people per cell if every resident is at work or school | WorldPop 2024 + GHSL GHS-BUILT-V NRES 2025, gravity model |
| `national/population_cl.{json,bin}` | Both layers for all of Chile, 30" (~0.9 km), sparse (`NationalPopulationMeta`) | same |
| `national/bomberos_cl.json` | `NationalStationsFile`: the 1,256 compañías de bomberos of Chile with their trucks (kind, make, model), documented or estimated | JNB Catastro de Cuarteles 2025 + bomberos.cl list + OSM; JNB Registro de Material Mayor 2025; `bomberos/fleets.json` |
| `eaton-2025/perimeter.bin` | Uint8 per cell: 1 inside the official final perimeter, 0 outside (**validation only**, not loaded by the app) | NIFC / WFIGS Interagency Fire Perimeters |
| `eaton-2025/dins.json` | `[lon, lat, damage]` per inspected structure, damage in `none / affected / minor / major / destroyed / inaccessible` (**validation only**) | CAL FIRE Damage Inspection (DINS) |

The table describes Viña's files in `web/public/data/`; Eaton writes the same ten base files (dates, scenes and
satellites in "Eaton 2025" below) plus the two validation files into `web/public/data/eaton-2025/`, and no
population or brigades files. Binary files are little-endian, `rows * cols` values (except `buildings.bin`).

## Method per file

**elevation.bin.** Copernicus GLO-30 COGs on AWS, tiles `S34_00_W072_00` (lat -34..-33) and
`S33_00_W072_00` (lat -33..-32) (bounds verified by reading them). Value = mean of the 30 m DEM pixels
whose centres fall in the cell (4.5 pixels per cell on average). Sea is 0 m. GLO-30 is a surface model
(DSM): tree canopy and large buildings are included in the height.

**fuel.bin, base classes (`steps/fuel.py`).** ESA WorldCover 10 m v200 (2021), tiles `S36W072` and `S33W072`
(the grid straddles lat -33), read by window through GDAL `/vsicurl/`. Majority class of the ~50 pixels per
cell, then: 10 -> FOREST, 20 -> SHRUB, 30 -> GRASS, 40 -> CROP, 50 -> built-up, 60/70/80 -> NONE, 90 -> GRASS,
95 -> FOREST, 100 -> GRASS. This step also computes a roof-coverage split (built-up -> URBAN_DENSE at >= 15 %
footprint coverage, else URBAN_LOW; vegetation cells with >= 25 % roofs -> URBAN_DENSE; roof coverage = sum
of footprint areas of the buildings whose centroid is in the cell / 3600 m2), but that split is no longer
written: the next step replaces it and writes `fuel.bin`. The bake summary prints both histograms.

**fuel.bin, urban split (`steps/wui.py`, shipped since 2026-11-22).** Splitting built-up cells by roof
coverage gave a hillside neighbourhood of houses among vegetated quebradas and a paved city block with the
same coverage the same class, and the fire engine burned dense, flat Quilpué instead of the hillside
neighbourhoods of Viña (see `web/src/engine/fire/MODEL.md` section 6). This step splits them by the
vegetation around them, from pre-fire sources only (the scar and FIRMS are never read by this step):
`green` = max(WorldCover vegetation share of the cell (classes 10, 20, 30, 40, 90, 95, 100), share of its
10 m Sentinel-2 pixels of 2024-01-18 with NDVI > `NDVI_GREEN` = 0.30), averaged over a disk of 180 m
(`GREEN_RADIUS_CELLS` = 3; cells outside the grid are left out of the mean, not padded). Built-up cells
(WorldCover built-up majority, or vegetation majority with roof coverage >= 25 %) become URBAN_LOW
(intermix: embers ignite it) if `green >= INTERMIX_GREEN` = 0.40, else URBAN_DENSE (consolidated: embers do
not ignite it, slow structure-to-structure spread); every other cell keeps its base class. The usual WUI definitions call "intermix" houses among > 50 % wildland vegetation
(SILVIS, https://www.fs.usda.gov/rds/archive/products/RDS-2015-0012-3/_metadata_RDS-2015-0012-3.html; USGS
building-based WUI, https://www.usgs.gov/data/wildland-urban-interface-maps-conterminous-us-based-125-million-building-locations);
40 % is used because `green` is a lower bound of the vegetated share. The green definition, the radius (60-180 m)
and the threshold (30-50 %) were also compared against the scar, as global scalars, among about 20 candidates; the
score is flat over that range (+-20 % on the threshold or a 120 / 240 m radius change Dice by < 0.002). NDVI uses B04/B08 at 10 m read by
window (cached as `.cache/s2_10m_<scene>.npz`) and the scene's 20 m SCL for validity (same invalid classes
as the scar); reflectance = DN x 0.0001 with no extra -0.1, because Earth Search already removed the
baseline-04.00 offset from these COGs (STAC `earthsearch:boa_offset_applied: true`, checked per scene and
re-checked on the pixels: the step stops if more than 1 % of valid pixels come out negative). Cells with no
valid Sentinel-2 pixel (sea, lake, cloud; ~14,600) use the WorldCover share alone. Slope is computed but
not used in the rule: the engine already applies slope to the rate of spread. Feature rasters
(float32, `rows * cols`) are written to `.cache/wui_{vegfrac,bcount,coverage,ndvi_mean,ndvi_green,green_r180,slope_deg}.bin`
for calibration and analysis. All thresholds are constants at the top of `steps/wui.py`.

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

**Today's forecast (not baked).** The "starts today" scenario fetches the same variables at the same point
from the Open-Meteo Forecast API in the visitor's browser (`web/src/data/forecast.ts`), today and tomorrow,
America/Santiago time, and checks it like `weather.json`.

**scar.bin.** Sentinel-2 L2A from the Element84 Earth Search STAC (no auth): pre-fire
`S2B_19HBD_20240118` (0.62 % cloud), post-fire `S2A_19HBD_20240212` (0.06 % cloud); tile 19HBD covers the
whole grid. Reflectance = DN x 0.0001 + the event's `scar_offset`: -0.1 for Viña, the shipped value, kept so
the scar and everything calibrated on it do not change. Earth Search already removed the baseline-04.00 +1000
offset from these COGs (as `steps/wui.py` found), so -0.1 makes 15.6 % (pre) and 19.6 % (post) of Viña's valid
pixels negative and biases dNBR; new events use the true reflectance (offset 0.0), and the bake stops when more
valid pixels than the event's limit come out negative. B08 averaged to the 20 m grid of B12 / SCL.
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

**goes.json (`steps/goes.py`).** GOES-16 ABI L2 Fire Detection and Characterization, full disk
(`ABI-L2-FDCF`, mode 6: one scan every 10 min, ~2 km pixel at nadir, ~2.5-3 km over central Chile), from the
public NOAA bucket `s3://noaa-goes16` read over HTTPS (no key), 96 files (~3.2 MB each) from 2 Feb 15:00 UTC to
3 Feb 06:59 UTC, cached in `.cache/goes/`. The bake stops if any hour lists fewer than 6 scans. Each pixel's
centre is converted from the ABI fixed grid (GDAL transform in metres / perspective point height = scan angle in
radians) to geodetic lon / lat with the GOES-R PUG vol. 3 §5.1.2.8.1 formulas (checked against the PUG worked
example in `tests/test_steps.py`); pixels whose centre is outside the grid are dropped. Fire = `Mask` codes
10-14 and 30-34 (good, saturated, cloud-contaminated, high and medium probability, plain and temporally
filtered); low probability (15, 35) is left out. `timeLocal` = scan start + 5 min (middle of the full-disk
scan), UTC - 3 h. `frp` = `Power` (MW); the algorithm leaves it unset (fill -9) on some fire pixels
(saturated or cloud-contaminated; 233 of the 1,379 pixels of this bake), recorded as 0, which means "not
computed", not a weak fire: the pacing score uses the location only. Same record shape as
`firms.json` (`satellite` = "GOES-16 ABI"). It is used only by `web/src/engine/fire/calibrate.ts` to score the
pace of the simulated fire (`web/src/engine/fire/MODEL.md` section 6); the browser app does not load it.

**ignitions.json.** Documented facts are thin on exact points. Las Tablas / Lago Peñuelas: press reports
(CIPER; Cooperativa, 2 Feb 2024) say a CONAF lookout tower detected it at about 12:06 and that it began
around noon at Fundo Las Tablas, next to the reserve; the point is the upwind (southern) end of the first
VIIRS cluster (14:47) and the time 12:05. Quilpué / Villa Alemana: centroid of the second cluster in the
first VIIRS pass, start 30 min before that detection (14:17). Both are labelled approximate and say why.

**brigades.json** is not written by `bake.py`: it is curated by hand (`make data` leaves it alone) and
validated against the grid on load (`parseBrigades`). Positions are the OpenStreetMap `amenity=fire_station`
nodes/ways of the four cuerpos inside the grid; every count, time and cut carries its source, or `null`, which
the app shows as "supuesto". Sources and assumptions: `web/src/engine/brigade/MODEL.md`.

**national/bomberos_cl.json (`steps/bomberos.py`, `bake_bomberos.py`).** Every fire company of Chile, for
scenarios built anywhere (`stationsInBox` in `web/src/data/load.ts` turns it into `BrigadeStation[]`).
- Companies and positions: the Junta Nacional de Bomberos (JNB) *Catastro Nacional de Cuarteles de Bomberos 2025*
  (Geoportal de Chile; 1,271 cuarteles, `N_COMPA` lists the compañías each one houses) joined with the bomberos.cl
  compañía list of 2024-10-08 (Itrend, *Datos para Resiliencia*, CC BY 4.0, public ArcGIS copy; 1,165 compañías) on
  (cuerpo, number); `merge_companies` documents the rules and the bake prints how often each one applied. 1,256
  compañías result (JNB Memoria 2025: 1,262) in 314 cuerpos (314). The two layers agree within 300 m for 861
  compañías. Where they disagree (234), an OSM station with the same company number sits at the catastro point in
  108 cases and at the 2024 point in 8; an uncoded catastro cuartel (the building without its code) sides with the
  2024 point in 8; 106 have no OSM evidence and keep the catastro point. Catastro-only compañías at a "No operativa"
  cuartel are dropped (1), and 2024-only compañías that sit within 300 m of another cuerpo's catastro compañía are
  the same cuartel under an old cuerpo name and are dropped (6, listed by the bake). Codes like `CB-4 1` are a
  second cuartel of the 4ª. Cuarteles generales without a compañía are left out. Per region the count is within
  ±3 of the JNB's except Valparaíso (−5) and Aysén (+7: 12 catastro codes in no other source, likely brigadas); the
  Metropolitana has one cuerpo more than the JNB (Calera de Tango, only in the 2024 list) and Ñuble one fewer (San
  Fabián de Alico, new, no coordinates).
- Region and comuna: point in polygon on geoBoundaries gbOpen CHL ADM1 / ADM3 (nearest polygon for points just off
  the simplified coast). geoBoundaries names Pozo Almonte's polygon "Tocopilla"; the bake renames it (`ADM3_RENAME`)
  and stops if any comuna name repeats. `settlement` urbano = more than 15,000 residents within 2.5 km (national
  population).
- Trucks: no open dataset lists them per compañía. `bomberos/fleets.json` is curated (396 entries from 293 sources):
  330 compañías with 615 documented vehicles (code, kind, make, model, year, source URL; 150 of them the whole fleet
  from the cuerpo's own pages or Wikipedia), compiled 2026-11-22 from cuerpo websites, Wikipedia, JNB / regional
  reports and press; six entries per zone (48) were re-checked against their sources by a separate agent: 46 confirmed, the
  2 refuted were dropped. The rest is
  estimated against the JNB *Registro Nacional de Material Mayor* 2025 (`bomberos/registro_material_mayor_2025.json`,
  Memoria 2025 p. 34: 4,476 vehicles in active service by region and type): per region and type, the register minus
  the documented vehicles is shared among the compañías without a complete documented fleet, so the region totals
  per type equal the register. Where the documented vehicles alone exceed it the bake prints it and keeps them
  (today 15 ladders in the Metropolitana, 2 ladders and 3 hazmat units in Biobío: 4,496 vehicles in all; the
  register's national ladder count fell from 131 to 84 between 2024 and 2025). Each estimated vehicle has
  `source: null` ("supuesto") and a make/model drawn from the documented models of its type, by frequency, and the
  JNB bulk purchases (Magirus 2017, the 2024 deliveries), each weighing its share of the national register of that
  type; "otros", first-response units and ambulances get no model. Rule details: `ESTIMATE_NOTE` in
  `steps/bomberos.py`, also written into the file. Known gaps: Puerto Montt 10ª and 11ª (2026) are in no location
  source yet. In Arica y Parinacota the register has fewer water units than compañías: the bake lists the 3 left
  without one.

**Population (`steps/population.py`, `bake_population.py`).** Where people are by time of day, for all of
Chile; the time-of-day part runs in the browser (`web/src/engine/population/MODEL.md`).
- Residents: WorldPop 2024, constrained, 3" (`chl_pop_2024_CN_100m_R2025A_v1.tif`, 62 MB).
- Workplaces and schools: GHSL non-residential building volume 2025, 3", twelve 10 x 10 degree tiles (R11-R15 x
  C11-C12, R12_C8 for Rapa Nui, R12_C10 for San Félix). The tile bounds were checked by reading them.
- Residents go to non-residential volume with an origin-constrained gravity model on a 30" grid aligned with
  WorldPop's: kernel exp(-d / 10 km), cut at 30 km, computed by FFT in latitude bands.
- Volume in Argentina, Bolivia and Peru is masked out (geoBoundaries gbOpen ADM0, simplified).
- The national product is committed, so `bake.py` only refines it onto the grid (`population.bake_domain`). The
  refinement splits each national cell over its 3" pixels, then over 6 x 6 sub-pixels binned into 60 m cells,
  which conserves the totals.
- `bake_population.py` re-bakes both. It also rewrites `grid.json`, which is deterministic from constants, to
  carry the new source.

## Eaton 2025 (`--event eaton-2025`)

Same steps and methods as above; only the parameters in `steps/events.py` change. Measured on the bake of
2026-11-22 (11 min from scratch, 7 of them the Overpass street query; 2 min with a warm cache, almost all of it
reading the 198 GOES files).

- **Grid and clock**: see "Grid". The fire's start is 7 Jan 2025 18:18 local; `t0` is 18:00.
- **elevation.bin**: GLO-30 tiles `N34_00_W119_00` and `N34_00_W118_00` (the grid straddles lon -118); 56-1,865 m.
- **fuel.bin**: WorldCover tile `N33W120`; NDVI from `S2A_11SLT_20250102` (5 days before the fire, 0 % invalid
  pixels over the grid). Same WUI rule and thresholds: 21,673 intermix and 11,924 consolidated cells.
- **buildings.bin**: Overture `2026-11-18.0`, 184,603 buildings (11,162 with their centroid inside the official
  perimeter). Older releases are no longer in the bucket, so these are post-fire footprints: some destroyed
  houses may be missing or already rebuilt.
- **roads.json**: current OSM, 62,947 nodes and 84,641 edges after clipping (simplified at 1 m, 9.1 MB).
- **weather.json**: Open-Meteo at 34.19, -118.12 (the archive answers with its grid point 34.20, -118.20),
  America/Los_Angeles, 7-9 Jan 2025 (72 h). 7 Jan 18:00 - 8 Jan 06:00: wind 18-37 km/h from the NNE-NE (10-43°),
  gusts up to 97 km/h; from 07:00 the reanalysis wind drops under 11 km/h. RH 13-35 %, 9-17 °C until noon.
- **scar.bin**: `S2A_11SLT_20250102` (pre) and `S2C_11SLT_20250221` (post: the first scene after containment on
  31 Jan with 0 % invalid pixels over the grid; 1 Feb has 13 % invalid, 6 and 11 Feb are cloudy). Tile 11SLT;
  the read window is clipped to the tile's east edge. Same thresholds (0.27, 0.15 built-up), same patch and
  FIRMS rules (VIIRS of 7-10 Jan), but true surface reflectance (offset 0.0, see the scar paragraph and
  `steps/scar.py`): Viña's -0.1 would make 48 % / 27 % of these pixels negative. Result: 42.5 km2 burned
  (3.4 km2 of it built-up), 99.4 % of it inside the official perimeter, covering 74 % of the perimeter's
  56.9 km2 (Dice 0.85); 97.5 % of the 1,091 VIIRS detections fall within 400 m of the scar. Burned
  neighbourhoods are under-detected, as in Viña (cell rule > 50 % of pixels): 7,042 of the 9,419 structures
  CAL FIRE marks destroyed fall in scar cells.
- **firms.json**: FIRMS yearly archives for the United States 2025 (`..._2025_United_States.csv`, 86 MB in all),
  7 Jan 16:00 - 10 Jan 23:59 local, UTC - 8 h: 1,214 detections. The window starts at 16:00 (as GOES) to leave
  out two detections of 7 Jan 01:45 / 02:07 at the grid's west edge, before the fire.
- **goes.json**: GOES-18 (GOES-West) from `s3://noaa-goes18`, 198 full-disk files (~1 MB each), 8 Jan 00:00 UTC
  to 9 Jan 08:59 UTC = 7 Jan 16:00 - 9 Jan 01:00 local, every hour complete: 1,144 fire pixels, the first at
  18:35 local (101 without FRP).
- **ignitions.json**: one preset, the CAL FIRE incident page's start (7 Jan 2025 18:18) and point
  (34.203483, -118.069155), https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire. Nothing about its cause.
- **perimeter.bin** (`steps/perimeter.py`, validation only): the WFIGS Interagency Fire Perimeters feature
  service, record `2025-CALAC-009087`, category "Wildfire Final Fire Perimeter" (14,021 acres = 56.74 km2),
  rasterised by cell centre: 15,804 cells = 56.89 km2. The bake stops if the perimeter touches the grid edge.
- **dins.json** (`steps/dins.py`, validation only): CAL FIRE DINS public view of the Eaton fire, 18,428 inspected
  structures, all inside the grid: 9,419 destroyed, 70 major, 148 minor, 858 affected, 7,893 no damage,
  40 inaccessible (the service's closed `DAMAGE` domain; any other value stops the bake).

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
- NOAA GOES-16 / GOES-18 ABI L2 FDC: NOAA open data (public domain), NOAA Open Data Dissemination on AWS. https://registry.opendata.aws/noaa-goes/
- Eaton validation only: NIFC / WFIGS Interagency Fire Perimeters (public, US government data),
  https://data-nifc.opendata.arcgis.com/ ; CAL FIRE Damage Inspection (DINS) public view; CAL FIRE incident page
  (start time and point), https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire
- WorldPop 2024 (R2025A v1): CC BY 4.0. https://www.worldpop.org/
- GHSL GHS-BUILT-V R2023A (European Commission, Joint Research Centre): CC BY 4.0.
  https://human-settlement.emergency.copernicus.eu/
- geoBoundaries gbOpen ADM0 (Argentina, Bolivia, Peru): used only as a mask while baking, not redistributed.
  https://www.geoboundaries.org/ ADM1 / ADM3 of Chile: region and comuna names in `national/bomberos_cl.json`, CC BY 4.0.
- Junta Nacional de Cuerpos de Bomberos de Chile: Catastro Nacional de Cuarteles de Bomberos 2025 (Geoportal de
  Chile, IDE Chile; public download, credit to the JNB as the providing institution) and Memoria Anual 2025
  (https://www.bomberos.cl/).
- Compañías de Bomberos de Chile (bomberos.cl, 2024), Itrend Datos para Resiliencia, doi:10.71578/DGVCQZ, CC BY 4.0.
- Documented fleets: the cuerpo, company, Wikipedia and press pages cited per compañía in `bomberos/fleets.json`.

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
- Ignition presets are approximate (see above); they are not official findings. Eaton's is CAL FIRE's
  published start time and point.
- Eaton: the reanalysis point is ~7 km west of Altadena and smooths the downslope wind storm of that night;
  treat its winds and gusts as a baseline, not as what stations in the foothills recorded.
- Fire company trucks are mostly estimated: only the compañías in `bomberos/fleets.json` are documented; the rest
  match the JNB register per region and type but not per compañía. Use them for resource scenarios, not as an
  inventory.
- Population is a model: WorldPop is itself an estimate (19.7 M, against 18.5 M counted by Censo 2024), and
  building volume is a proxy for jobs that under-weights old mixed-use centres (Santiago, Concepción). See
  `web/src/engine/population/MODEL.md`.
