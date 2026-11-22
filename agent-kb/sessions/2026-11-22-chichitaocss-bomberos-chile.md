# 2026-11-22 — bomberos-chile

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/bomberos-chile-dataset`
- **Goal:** the location of every fire company in Chile, with truck fleets (count and models), assumed as
  precisely as possible where they cannot be found quickly; input for building new scenarios from scratch.

## Done
- Sources found (research agents, one per macro-zone + national): the JNB *Catastro Nacional de Cuarteles 2025* on
  Geoportal de Chile (1,271 cuarteles, WGS 84, public download), a 2024 bomberos.cl compañía list (Itrend, CC BY 4.0,
  public ArcGIS copy), the IDE Chile WFS layers of about 2017 (older, not used), OSM (938 fire stations), and the
  JNB Memoria 2025 *Registro Nacional de Material Mayor* (4,476 active vehicles by region and type, p. 34; checked
  row by row against the PDF text).
- `pipeline/steps/bomberos.py` + `bake_bomberos.py` (`make bomberos`) → `web/public/data/national/bomberos_cl.json`:
  1,256 compañías in 314 cuerpos (JNB: 1,262 / 314) with region, comuna, residents within 2.5 km, urbano / rural,
  and 4,496 vehicles (kind, code, make, model, year, source).
- Fleets: `pipeline/bomberos/fleets.json` (396 entries from 293 sources: 330 compañías with 615 documented
  vehicles, 150 of them complete fleets). The rest is allocated per region and type so totals equal the register;
  models drawn from documented models and JNB bulk purchases weighted by their share of the register. Six entries
  per zone (48) were re-checked against their sources by separate agents: 46 confirmed, 2 dropped.
- Contract: `VEHICLE_KIND`, `VEHICLE_KIND_UNIT`, `NationalStation`, `NationalStationsFile` in `types.ts`;
  `parseNationalStations`, `unitsOfVehicles`, `stationsInBox`, `loadNationalStations` in `src/data/load.ts`.
- Tests: `pipeline/tests/test_bomberos.py` (parsing, allocation, point in polygon, dBase reader, the shipped file
  equals the register per region and type) and `web/src/data/national.test.ts` (parser, `stationsInBox`, the 29
  `brigades.json` stations match the national file within 1.5 km).
- Independent review (3 lenses, each finding re-checked by a skeptic): 15 confirmed and fixed. The merge counted no
  dropped rows (two Tarapacá compañías lost to a key collision and a cuerpo alias), shipped the same cuartel under two
  cuerpos (Calera de Tango 1ª = San Bernardo 10ª, Hualaihué 3ª = Chaitén 3ª), parsed `CB-4 1` as a 41ª, kept a
  closed cuartel, and broke ties with unnumbered OSM stations; Pozo Almonte was labelled Tocopilla (geoBoundaries);
  `stationsInBox` called partly estimated fleets sourced; the population window shrank to the south; some reused
  model texts carried notes or the wrong kind. All fixed with tests; the bake now prints every rule's count.
- Preview (not committed): `tmp/bomberos-chile.html`, a dot map and the per-region table.

## Decisions
- D-030 (national fire-company dataset; trucks matched to the JNB register per region).

## Open / blocked
- Estimated trucks match the register per region and type, not per compañía: not an inventory.
- Documented vehicles exceed the register in the Metropolitana (15 ladders) and Biobío (2 ladders, 3 hazmat): the
  register's ladder count fell from 131 to 84 between 2024 and 2025, probably a reclassification.
- Puerto Montt 10ª and 11ª (2026 news) are not in either location source yet. Aysén has 36 stations against 29
  compañías in the JNB count (likely brigadas). Calera de Tango (RM) is only in the 2024 list.
- Calera de Tango 2ª (2024 list only; the cuerpo is in neither the catastro nor the JNB count) is kept; San Fabián de
  Alico (Ñuble, new) has no coordinates.

## Next
- Wire `loadNationalStations` + `stationsInBox` into the scenario builder (each cuerpo needs a dispatch time).
- Ask the cuerpos for real inventories (backlog), and add them to `fleets.json` with `complete: true`.
