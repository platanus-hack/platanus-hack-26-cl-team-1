# Curated inputs for `national/bomberos_cl.json`

Read by `steps/bomberos.py` (`make bomberos`). Both files are curated by hand, not downloaded by the bake.

## `registro_material_mayor_2025.json`

The Junta Nacional de Bomberos *Registro Nacional de Material Mayor* 2025: vehicles in active service per region
and type (Memoria Anual 2025, p. 34), plus cuerpos and compañías per region (p. 33). Transcribed from the PDF;
`load_register()` checks that every row sums to its total and the totals to 4,476. The bake makes every
region's documented + estimated vehicles of each type equal this table.

## `fleets.json`

Compañías whose specialty and/or trucks could be documented, compiled on 2026-11-22 by research agents, one per
macro-zone, reading cuerpo and company websites ("material mayor", "carros"), Spanish Wikipedia and press notes
on truck deliveries. Rules they followed: nothing without a source opened that day; `null` where a field is
unknown. Six entries per zone were then re-checked against their cited page by a separate agent: 48 checked, 46
confirmed; the 2 refuted (Talcahuano 5ª, Punta Arenas 3ª) were dropped.

- `companies[]`: `cuerpo` (official name or one `resolve_cuerpo` maps to it), `number`, `name`, `specialty`,
  `complete` (the source lists the company's whole fleet; false for a single delivery note, a news item, or a
  page that shows only some units), `source`, and `vehicles[]` (`code` as the cuerpo writes it, `kind` from
  `VEHICLE_KIND` in `web/src/engine/types.ts`, `make`, `model`, `year`, `source`). Entries with no vehicles only
  document the specialty.
- `procurement[]`: JNB bulk purchases with make, model and count (Magirus 2017; the 2024 deliveries by body
  builder). They weight the make/model drawn for estimated vehicles.
- `reference[]`: national totals shown with the data (Memoria 2025).

Kind mapping used while curating: `Q` (porta escalas) and `M` / `MX` (aerial) are `escala`; `S` ambulance; `X` /
`K` command (`mando`); `T` / `J` / `L` transport; `BT` / `Z` water tender (`aljibe`); `BR` / `RB` `bomba_rescate`;
`H` / `HX` `hazmat`; codes vary by cuerpo, so a source's own description wins over the code.

To add a company: append an entry with its source, run `make bomberos`, and check that the bake reports no
unmatched entries.
