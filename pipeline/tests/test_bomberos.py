"""Unit tests for the fire-company step (no network): name and code parsing, the register allocation, the
point-in-polygon, the dBase reader, and the shipped national/bomberos_cl.json against the JNB register."""

from __future__ import annotations

import json
import struct
from collections import Counter

import numpy as np
import pytest

from steps import bomberos as b


@pytest.mark.parametrize(
    ("name", "want"),
    [
        ("Octava Compañía del Cuerpo de Bomberos de Viña del Mar", 8),
        ("8.ª Compañía de Bomberos", 8),
        ("3° Compañía de Bomberos de Pueblo Seco", 3),
        ("4ta Compañia de Bomberos Santa Rosa", 4),
        ('8va Compañia de Bomberos "Bomba España"', 8),
        ("1ra Compañia", 1),
        ("Décimo Tercera Compañía", 13),
        ("Bomba 12", 12),
        ("Cuartel General del Cuerpo de Bomberos de Til Til", None),
        ("Bomberos Panquehue", None),
    ],
)
def test_parse_number(name, want):
    assert b.parse_number(name) == want


def test_parse_n_compa():
    assert b.parse_n_compa("CB-6") == ([6], False)
    assert b.parse_n_compa("CG-CB-1-2-4") == ([1, 2, 4], True)
    assert b.parse_n_compa("CG-1") == ([], True)
    assert b.parse_n_compa("CB-4 1") == ([4], False)  # the 4ª's second cuartel, not a 41ª
    assert b.parse_n_compa(None) == ([], False)
    with pytest.raises(ValueError):
        b.parse_n_compa("ZZ-1")


def test_region_label_and_mojibake():
    mojibake = "Región del Bío-Bío".encode("utf-8").decode("latin-1")  # how geoBoundaries ships some names
    assert b.demojibake(mojibake) == "Región del Bío-Bío"
    assert b.region_label(b.demojibake(mojibake)) == "Biobío"
    assert b.demojibake("Región de Ñuble") == "Región de Ñuble"  # already fine: unchanged
    assert b.region_label("Aysén del Gral.Ibañez del Campo") == "Aysén"
    assert b.region_label("Región del Libertador General Bernardo O'Higgins") == "O'Higgins"
    assert b.region_label("Región Metropolitana de Santiago") == "Metropolitana"
    with pytest.raises(ValueError):
        b.region_label("Patagonia")


def test_cuerpo_names_resolve_to_the_official_key():
    official = {"conchali", "la granja", "san pedro", "san pedro de la paz", "san vicente de tagua tagua"}
    assert b.resolve_cuerpo(b.cuerpo_key("Cuerpo de Bomberos de Conchalí-Huechuraba"), official) == "conchali"
    assert b.resolve_cuerpo(b.cuerpo_key("La Granja, San Ramón y La Pintana"), official) == "la granja"
    assert b.resolve_cuerpo(b.cuerpo_key("San Pedro de la Paz"), official) == "san pedro de la paz"
    assert b.cuerpo_key("San Vicente de T. T.") == "san vicente de tagua tagua"
    assert b.resolve_cuerpo("lican ray", official | {"licanray"}) == "licanray"
    assert b.resolve_cuerpo("temuco", official) == "temuco"  # unresolved: unchanged, reported by the bake


def test_allocate_is_exact_and_deterministic():
    ids = [f"s{i}" for i in range(7)]
    got = b.allocate(10, ids, [1, 1, 1, 3, 3, 0, 1], "x")
    assert sum(got) == 10
    assert got[5] == 0  # zero weight never gets a vehicle
    assert got[3] >= got[0]
    assert got == b.allocate(10, ids, [1, 1, 1, 3, 3, 0, 1], "x")
    assert b.allocate(0, ids, [1] * 7, "x") == [0] * 7


def _station(i, settlement="rural", specialty="desconocida", vehicles=None, complete=False, people=1000):
    return {
        "id": f"c-{i}",
        "settlement": settlement,
        "specialty": specialty,
        "peopleNearby": people,
        "vehicles": vehicles or [],
        "fleetComplete": complete,
    }


def test_allocate_region_meets_the_register_and_keeps_complete_fleets():
    doc = [{"kind": "bomba"}, {"kind": "escala"}]
    stations = [
        _station(0, "urbano", "escala", doc, complete=True, people=90000),
        _station(1, "urbano", "escala", people=80000),
        _station(2, "urbano", people=70000),
        _station(3),
        _station(4),
    ]
    target = {c: 0 for c in b.REGISTER_KINDS}
    target.update({"bomba": 5, "escala": 3, "forestal": 2, "otros": 4})
    add, over, dry = b.allocate_region(stations, target)
    assert over == {} and dry == []
    assert "c-0" not in add  # complete documented fleet: untouched
    total = Counter()
    for c in add.values():
        total.update(c)
    assert total["bomba"] == 5 - 1 and total["escala"] == 3 - 1
    assert total["forestal"] == 2 and total["otros"] == 4
    assert add["c-1"]["escala"] >= 1  # the escala company gets its ladder first
    assert all(add[i]["escala"] == 0 for i in ("c-3", "c-4"))  # no ladders in rural stations
    assert all(add[f"c-{i}"]["bomba"] >= 1 for i in (2, 3, 4))  # every general company gets water first


def test_allocate_region_reports_documented_excess():
    stations = [_station(0, vehicles=[{"kind": "escala"}] * 3, complete=True), _station(1)]
    target = {c: 0 for c in b.REGISTER_KINDS}
    target.update({"escala": 1, "bomba": 1})
    add, over, _ = b.allocate_region(stations, target)
    assert over == {"escala": 2}
    assert add["c-1"]["bomba"] == 1


def test_assign_area_inside_hole_and_nearest():
    square = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
    }
    other = {"type": "Polygon", "coordinates": [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]}
    feats = [
        {"properties": {"shapeName": "A"}, "geometry": square},
        {"properties": {"shapeName": "B"}, "geometry": other},
    ]
    lon = np.array([3.0, 1.5, 10.5, 9.0])
    lat = np.array([3.0, 1.5, 10.5, 9.5])
    got = b.assign_area(lon, lat, feats)
    assert got[0] == "A" and got[2] == "B"
    assert got[1] == "A"  # inside the hole: nearest vertex, which is A's
    assert got[3] == "B"  # just off B: nearest


def test_read_dbf():
    fields = [("CUERPO", "C", 10), ("LATITUD", "N", 12)]
    header_len = 32 + 32 * len(fields) + 1
    rec_len = 1 + sum(f[2] for f in fields)
    buf = bytearray(struct.pack("<BBBBIHH20x", 3, 26, 1, 1, 2, header_len, rec_len))
    for name, typ, ln in fields:
        buf += struct.pack("<11sc4xB15x", name.encode(), typ.encode(), ln)
    buf += b"\r"
    for cuerpo, lat in (("Viña", "-33.02"), ("Temuco", "")):
        buf += b" " + cuerpo.encode().ljust(10) + lat.encode().rjust(12)
    rows = b.read_dbf(bytes(buf))
    assert rows == [{"CUERPO": "Viña", "LATITUD": -33.02}, {"CUERPO": "Temuco", "LATITUD": None}]


def test_register_file_is_consistent():
    reg = b.load_register()
    assert reg["nationalTotal"] == 4476
    assert sum(r["companias"] for r in reg["regions"].values()) == 1262


def test_shipped_file_matches_the_register_per_region_and_type():
    """Documented + estimated vehicles equal the JNB 2025 register in every region and category, except where
    the documented vehicles alone exceed it (reported by the bake; today: ladders in the Metropolitana)."""
    out = json.loads(b.OUT_FILE.read_text())
    reg = b.load_register()["regions"]
    got: dict[str, Counter] = {r: Counter() for r in reg}
    for s in out["stations"]:
        for v in s["vehicles"]:
            got[s["region"]][b.register_category(v["kind"])] += 1
        assert s["units"] == b.units_of(s["vehicles"])
    for r, row in reg.items():
        for cat in b.REGISTER_KINDS:
            want = row["vehicles"][cat] + (row["vehicles"]["gersa"] if cat == "otros" else 0)
            documented = sum(
                1
                for s in out["stations"]
                if s["region"] == r
                for v in s["vehicles"]
                if v["source"] is not None and b.register_category(v["kind"]) == cat
            )
            assert got[r][cat] == max(want, documented), (r, cat)
    assert out["totals"]["stations"] == len(out["stations"]) > 1200


def test_spanish_case():
    assert b.spanish_case("Viña Del Mar") == "Viña del Mar"
    assert b.spanish_case("ISLA DE PASCUA") == "Isla de Pascua"
    assert b.spanish_case("Los Ángeles") == "Los Ángeles"


def test_clean_model_drops_per_vehicle_notes():
    assert (
        b.clean_model("Spartan Metro Star multipropósito semiurbano (aprobado 2021)")
        == "Spartan Metro Star multipropósito semiurbano"
    )
    assert b.clean_model("Ram 3500 SLT 4x4 (donada por LATAM)") == "Ram 3500 SLT 4x4"
    assert b.clean_model("180E32; entregado jun-2018") == "180E32"
    assert b.clean_model("M2106 (8.000 L)") == "M2106 (8.000 L)"  # a capacity is part of the model
    assert b.clean_model(None) is None


def test_allocate_region_falls_back_to_other_water_units_and_reports_the_rest():
    stations = [_station(i, people=1000 * (5 - i)) for i in range(5)]
    target = {c: 0 for c in b.REGISTER_KINDS}
    target.update({"bomba": 2, "primera_intervencion": 1, "forestal": 1, "otros": 5})
    add, over, dry = b.allocate_region(stations, target)
    assert [add[f"c-{i}"]["bomba"] for i in range(5)] == [1, 1, 0, 0, 0]  # most residents first
    assert add["c-2"]["primera_intervencion"] == 1 and add["c-3"]["forestal"] == 1
    assert dry == ["c-4"]  # the register has no water unit left for it: reported


def _cat(cuerpo, code, lon, lat, status="Operativa"):
    return {"CUERPO": cuerpo, "N_COMPA": code, "LONGITUD": lon, "LATITUD": lat, "ESTADO_CUA": status}


def _arc(cuerpo, n, lon, lat, cut=1300):
    return {"cuerpo": cuerpo, "cutCompania": cut * 100 + n, "longitud": lon, "latitud": lat, "nombre": None}


def test_merge_counts_every_dropped_row_and_never_merges_two_listed_cuerpos():
    catastro = [
        _cat("San Bernardo", "CB-10", -70.7577, -33.6316),
        _cat("Alto Hospicio", "CB-1", -70.10, -20.27),
        _cat("Sierra Gorda", "CB-2", -69.3195, -22.8916),
        _cat("Sierra Gorda", None, -69.70, -23.20),  # uncoded cuartel at the ArcGIS point
        _cat("Puerto Aysén", "CB-8", -72.6, -45.4, status="No operativa"),
    ]
    arc = [
        _arc("Calera de Tango", 1, -70.7579, -33.6313),  # same cuartel as San Bernardo 10ª
        _arc("Alto Hospicio", 1, -70.1057, -20.2965),
        _arc("Santa Rosa de Huantajaya", 1, -70.1001, -20.2701),  # near Alto Hospicio 1ª: must not alias
        _arc("Santa Rosa de Huantajaya", 4, -70.1063, -20.2978),
        _arc("Santa Rosa de Huantajaya", 4, -70.0954, -20.2462),  # second row of the same compañía
        _arc("Sierra Gorda", 2, -69.7001, -23.2001),
    ]
    out, stats = b.merge_companies(catastro, arc, [])
    keys = {(s["cuerpoKey"], s["number"]) for s in out}
    assert ("calera de tango", 1) not in keys and ("san bernardo", 10) in keys
    assert {("alto hospicio", 1), ("santa rosa de huantajaya", 1), ("santa rosa de huantajaya", 4)} <= keys
    assert ("puerto aysen", 8) not in keys
    sg = next(s for s in out if s["cuerpoKey"] == "sierra gorda")
    assert sg["positionFrom"] == "arcgis"  # the uncoded catastro cuartel corroborates the ArcGIS point
    assert stats["arcgis: second row of the same compañía (kept one)"] == 1
    assert stats["catastro only, cuartel not operating: dropped"] == 1
    assert stats["ArcGIS only, same cuartel as a catastro compañía of another cuerpo: dropped"] == [
        "Calera de Tango 1 = San Bernardo 10"
    ]
