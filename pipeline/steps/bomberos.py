"""Fire companies (compañías de bomberos) of all of Chile, with their trucks: national/bomberos_cl.json.

Locations: the Junta Nacional de Bomberos (JNB) Catastro Nacional de Cuarteles 2025 (Geoportal de Chile), merged
with the bomberos.cl compañía list of 2024 (Itrend mirror, CC BY 4.0); uncoded catastro cuarteles and OpenStreetMap
fire stations break ties when the two disagree (merge_companies). Region and comuna from geoBoundaries (gbOpen
ADM1 / ADM3); residents within 2.5 km from the committed national population product.

Trucks ("material mayor"): no open dataset lists them per compañía. pipeline/bomberos/fleets.json holds what could
be documented (each vehicle with the URL it came from). The rest is estimated against the JNB Registro Nacional de
Material Mayor 2025 (pipeline/bomberos/registro_material_mayor_2025.json: vehicles in active service per region
and type): per region and type, the register's count minus the documented vehicles is shared among the compañías
without a complete documented fleet (allocate_region), so every region's totals per type equal the register.
Each estimated vehicle takes a make/model drawn, deterministically per station, from the documented models of its
type and the JNB bulk purchases (see ESTIMATE_NOTE). Counts per engine unit type follow types.ts
(VEHICLE_KIND_UNIT).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict

import numpy as np
import requests

from steps import overpass
from steps.grid import CACHE_DIR, OUT_DIR, PIPELINE_DIR

CACHE = CACHE_DIR / "bomberos"
FLEETS_FILE = PIPELINE_DIR / "bomberos" / "fleets.json"
OUT_FILE = OUT_DIR / "national" / "bomberos_cl.json"
NATIONAL_POP_JSON = OUT_DIR / "national" / "population_cl.json"
NATIONAL_POP_BIN = OUT_DIR / "national" / "population_cl.bin"

QUERY = """[out:json][timeout:300];
area["ISO3166-1"="CL"][admin_level=2]->.cl;
(
  nwr["amenity"="fire_station"](area.cl);
  nwr["emergency"="fire_station"](area.cl);
);
out center tags;"""

CATASTRO_URL = "https://geoportal.cl/bomberos/catalog/download/3f6271ef-787f-3a27-9821-307eebc2eecb"
ARCGIS_URL = "https://services6.arcgis.com/LCdFQd7nnAn5xeUA/arcgis/rest/services/Cuarteles_de_Bomberos/FeatureServer/0"
BOUNDARY_URL = "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/CHL/{a}/geoBoundaries-CHL-{a}_simplified.geojson"

# Vehicle kinds: closed set, mirrored by VEHICLE_KIND in web/src/engine/types.ts. Index = engine UnitType
# (0 Bomba, 1 Forestal, 2 Aljibe, 3 Escala/rescate) or None when the engine does not model the vehicle.
VEHICLE_KIND_UNIT: dict[str, int | None] = {
    "bomba": 0,
    "bomba_rescate": 0,
    "forestal": 1,
    "primera_intervencion": 1,
    "aljibe": 2,
    "escala": 3,
    "rescate": 3,
    "hazmat": None,
    "ambulancia": None,
    "mando": None,
    "transporte": None,
    "otro": None,
}
# JNB register category -> the vehicle kinds it counts. "otros" also takes the register's GERSA (underwater
# rescue) column. Estimated vehicles of a category get its first kind.
REGISTER_KINDS: dict[str, tuple[str, ...]] = {
    "bomba": ("bomba", "bomba_rescate"),
    "forestal": ("forestal",),
    "aljibe": ("aljibe",),
    "escala": ("escala",),
    "rescate": ("rescate",),
    "hazmat": ("hazmat",),
    "primera_intervencion": ("primera_intervencion",),
    "ambulancia": ("ambulancia",),
    "otros": ("otro", "mando", "transporte"),
}
REGISTER_FILE = PIPELINE_DIR / "bomberos" / "registro_material_mayor_2025.json"
UNIT_COUNT = 4
SPECIALTIES = ("agua", "escala", "rescate", "hazmat", "forestal", "mixta", "desconocida")
# Residents within NEARBY_M (2.5 km) of a station above which it is urbano. Chosen so a comuna capital of ~20,000
# people counts as urban and a village of a few thousand as rural (supuesto).
URBAN_PEOPLE = 15000

# Names that are not the volunteer Bomberos (checked against the OSM names in Chile, 2026-11-22).
NOT_BOMBEROS = re.compile(
    r"conaf|ssei|dgac|aeropuerto|aer[oó]dromo|salvamento|codelco|miner|enap|armada|fach|ej[eé]rcito|brigada(?! de bomberos)"
    r"|portuari|puerto (?:de )?(?:san antonio|valpara)|forestal arauco|forestal mininco|cmpc|bomberos? industrial",
    re.IGNORECASE,
)

ORDINAL_WORDS = {
    "primera": 1,
    "segunda": 2,
    "tercera": 3,
    "cuarta": 4,
    "quinta": 5,
    "sexta": 6,
    "septima": 7,
    "setima": 7,
    "octava": 8,
    "novena": 9,
    "decima": 10,
    "undecima": 11,
    "duodecima": 12,
    "decimoprimera": 11,
    "decimosegunda": 12,
    "decimotercera": 13,
    "decimocuarta": 14,
    "decimoquinta": 15,
    "decimosexta": 16,
    "decimoseptima": 17,
    "decimoctava": 18,
    "decimonovena": 19,
    "vigesima": 20,
    "vigesimoprimera": 21,
    "vigesimosegunda": 22,
    "vigesimotercera": 23,
    "vigesimocuarta": 24,
    "vigesimoquinta": 25,
}
PREFIX_WORDS = {"decima": 10, "decimo": 10, "vigesima": 20, "vigesimo": 20}
UNIT_WORDS = {
    "primera": 1,
    "segunda": 2,
    "tercera": 3,
    "cuarta": 4,
    "quinta": 5,
    "sexta": 6,
    "septima": 7,
    "octava": 8,
    "novena": 9,
}


def fold(s: str) -> str:
    """Lower case, no accents, single spaces: the key used to compare names."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower()).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")


def demojibake(s: str) -> str:
    """geoBoundaries ships some CHL names double-encoded (RegiÃ³n): undo it when that is what happened."""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def parse_number(name: str) -> int | None:
    """Company number from an OSM / source name: '8.ª Compañía', '3° Compañía', '4ta Compañia', 'Octava
    Compañía', 'Décimo Tercera Compañía', 'Bomba 12' ... None if the name carries no company number."""
    f = fold(name)
    m = re.search(
        r"\b(\d{1,2})\s*(?:\.|º|°|ª|a|ra|da|ta|ma|va|na|er|ro|do|to|mo|vo|no)?\s*\.?\s*(?:ª|a)?\s*(?:cia|compan)", f
    )
    if m:
        return int(m.group(1))
    m = re.search(r"(?:cia|compania|companía)\.?\s*(?:n[°ºo.]*\s*)?(\d{1,2})\b", f)
    if m:
        return int(m.group(1))
    words = re.findall(r"[a-z]+", f)
    for i, w in enumerate(words):
        if not (w.startswith("compan") or w == "cia"):
            continue
        prev = words[max(0, i - 2) : i]
        if len(prev) == 2 and prev[0] in PREFIX_WORDS and prev[1] in UNIT_WORDS:
            return PREFIX_WORDS[prev[0]] + UNIT_WORDS[prev[1]]
        if prev and prev[-1] in ORDINAL_WORDS:
            return ORDINAL_WORDS[prev[-1]]
    m = re.search(r"\bbomba\s+(?:n[°ºo.]*\s*)?(\d{1,2})\b", f)
    if m:
        return int(m.group(1))
    return None


# ------------------------------------------------------------------------------------------------ geometry


def _ring_contains(ring: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Even-odd ray casting of points (x, y) against one closed ring (n x 2)."""
    xi, yi = ring[:-1, 0], ring[:-1, 1]
    xj, yj = ring[1:, 0], ring[1:, 1]
    inside = np.zeros(len(x), dtype=bool)
    for a, b, c, d in zip(xi, yi, xj, yj, strict=True):
        if b == d:
            continue
        cond = (b > y) != (d > y)
        xcross = (c - a) * (y - b) / (d - b) + a
        inside ^= cond & (x < xcross)
    return inside


def polygons_of(geom: dict) -> list[list[np.ndarray]]:
    if geom["type"] == "Polygon":
        return [[np.asarray(r, dtype=float) for r in geom["coordinates"]]]
    if geom["type"] == "MultiPolygon":
        return [[np.asarray(r, dtype=float) for r in p] for p in geom["coordinates"]]
    raise ValueError(f"unexpected geometry {geom['type']}")


def assign_area(lon: np.ndarray, lat: np.ndarray, features: list[dict]) -> list[str | None]:
    """Name of the boundary feature containing each point; points outside every feature get the nearest one by
    vertex distance (coastal stations just off a simplified coastline)."""
    out: list[str | None] = [None] * len(lon)
    left = np.ones(len(lon), dtype=bool)
    for feat in features:
        name = demojibake(feat["properties"]["shapeName"])
        for poly in polygons_of(feat["geometry"]):
            ring = poly[0]
            bb = (ring[:, 0].min(), ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max())
            cand = np.where(left & (lon >= bb[0]) & (lon <= bb[1]) & (lat >= bb[2]) & (lat <= bb[3]))[0]
            if len(cand) == 0:
                continue
            ins = _ring_contains(ring, lon[cand], lat[cand])
            for hole in poly[1:]:
                ins &= ~_ring_contains(hole, lon[cand], lat[cand])
            for k in cand[ins]:
                out[k] = name
                left[k] = False
    for k in np.where(left)[0]:
        best, best_d = None, math.inf
        for feat in features:
            for poly in polygons_of(feat["geometry"]):
                d = np.min((poly[0][:, 0] - lon[k]) ** 2 + (poly[0][:, 1] - lat[k]) ** 2)
                if d < best_d:
                    best, best_d = demojibake(feat["properties"]["shapeName"]), d
        out[k] = best
    return out


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


REGION_SHORT = {
    "arica y parinacota": "Arica y Parinacota",
    "tarapaca": "Tarapacá",
    "antofagasta": "Antofagasta",
    "atacama": "Atacama",
    "coquimbo": "Coquimbo",
    "valparaiso": "Valparaíso",
    "metropolitana": "Metropolitana",
    "o'higgins": "O'Higgins",
    "maule": "Maule",
    "nuble": "Ñuble",
    "bio-bio": "Biobío",
    "biobio": "Biobío",
    "la araucania": "La Araucanía",
    "araucania": "La Araucanía",
    "los rios": "Los Ríos",
    "los lagos": "Los Lagos",
    "aysen": "Aysén",
    "magallanes": "Magallanes",
}


def region_label(name: str) -> str:
    """geoBoundaries ADM1 name -> the short official name ('Región del Bío-Bío' -> 'Biobío'). Unknown names
    stop the bake."""
    f = fold(name)
    f = re.sub(r"^region (?:de |del )?", "", f)
    for key, short in REGION_SHORT.items():
        if f == key or f.startswith(key + " ") or (key == "o'higgins" and "higgins" in f):
            return short
    raise ValueError(f"unknown region name in geoBoundaries ADM1: {name!r}")


# ------------------------------------------------------------------------------------------------ population


NEARBY_M = 2500.0  # residents counted within this distance of a station (cell centres)


def people_nearby(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Residents of the national population cells whose centre lies within NEARBY_M of each station (~20 km²
    everywhere; a fixed cell window would shrink east-west towards the south)."""
    meta = json.loads(NATIONAL_POP_JSON.read_text())
    buf = NATIONAL_POP_BIN.read_bytes()
    n = meta["n"]
    cell = np.frombuffer(buf, dtype="<u4", count=n, offset=0)
    home = np.frombuffer(buf, dtype="<f4", count=n, offset=4 * n)
    lookup = dict(zip(cell.tolist(), home.tolist(), strict=True))
    cols, rows = meta["cols"], meta["rows"]
    out = np.zeros(len(lon))
    for k in range(len(lon)):
        c0 = int((lon[k] - meta["lonMin"]) / meta["dLon"])
        r0 = int((meta["latMax"] - lat[k]) / meta["dLat"])
        dr = int(math.ceil(NEARBY_M / (meta["dLat"] * 111320.0))) + 1
        dc = int(math.ceil(NEARBY_M / (meta["dLon"] * 111320.0 * math.cos(math.radians(lat[k]))))) + 1
        s = 0.0
        for r in range(r0 - dr, r0 + dr + 1):
            for c in range(c0 - dc, c0 + dc + 1):
                if not (0 <= r < rows and 0 <= c < cols):
                    continue
                clon = meta["lonMin"] + (c + 0.5) * meta["dLon"]
                clat = meta["latMax"] - (r + 0.5) * meta["dLat"]
                if haversine_m(lon[k], lat[k], clon, clat) <= NEARBY_M:
                    s += lookup.get(r * cols + c, 0.0)
        out[k] = s
    return out


# ------------------------------------------------------------------------------------------------ build


def fetch_boundaries() -> tuple[list[dict], list[dict]]:
    CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for a in ("ADM1", "ADM3"):
        p = CACHE / f"CHL_{a}.geojson"
        if not p.exists():
            r = requests.get(BOUNDARY_URL.format(a=a), timeout=300, headers=overpass.HEADERS)
            r.raise_for_status()
            p.write_bytes(r.content)
        out.append(json.loads(p.read_text())["features"])
    if len(out[0]) != 16:
        raise RuntimeError(f"expected 16 regions in geoBoundaries ADM1, got {len(out[0])}")
    for f in out[1]:
        sid = f["properties"]["shapeID"]
        if sid in ADM3_RENAME:
            f["properties"]["shapeName"] = ADM3_RENAME[sid]
    names = Counter(demojibake(f["properties"]["shapeName"]) for f in out[1])
    dup = [n for n, k in names.items() if k > 1]
    if dup:
        raise RuntimeError(f"geoBoundaries ADM3 names are not unique: {dup}")
    return out[0], out[1]


# geoBoundaries gbOpen CHL ADM3 ships Pozo Almonte (Tarapacá, lat -21.6..-19.9) under the name of Tocopilla, and
# has no feature named Pozo Almonte (checked 2026-11-22).
ADM3_RENAME = {"31580391B91621176177599": "Pozo Almonte"}


def read_dbf(buf: bytes, encoding: str = "utf-8") -> list[dict]:
    """Records of a dBase III table (the attributes of a shapefile). Numbers come back as float or None."""
    import struct

    n, header_len, rec_len = struct.unpack("<IHH", buf[4:12])
    fields = []
    o = 32
    while buf[o] != 0x0D:
        name = buf[o : o + 11].split(b"\0")[0].decode(encoding, "replace")
        fields.append((name, chr(buf[o + 11]), buf[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        r = buf[header_len + i * rec_len : header_len + (i + 1) * rec_len]
        if r[:1] == b"*":
            continue
        pos = 1
        row: dict = {}
        for name, typ, ln in fields:
            raw = r[pos : pos + ln].decode(encoding, "replace").strip()
            pos += ln
            if typ in "NF":
                row[name] = float(raw) if raw and raw not in ("*" * len(raw),) else None
            else:
                row[name] = raw or None
        rows.append(row)
    return rows


def parse_n_compa(code: str | None) -> tuple[list[int], bool]:
    """Catastro N_COMPA -> (company numbers, has cuartel general): 'CB-6' -> ([6], False), 'CG-CB-1-2' ->
    ([1, 2], True), 'CG-1' -> ([], True) (a cuerpo's first cuartel general), None -> ([], False). A suffix after a
    space numbers a compañía's second cuartel ('CB-4 1' is the 4ª's other cuartel, not a 41ª). Anything else stops
    the bake."""
    if not code:
        return [], False
    c = code.strip().upper().split()[0]

    def nums(part: str) -> list[int]:
        toks = part.split("-")
        if not all(t.isdigit() for t in toks):
            raise ValueError(f"unknown catastro N_COMPA {code!r}")
        return [int(t) for t in toks]

    if c.startswith("CG-CB-"):
        return nums(c[6:]), True
    if c.startswith("CB-"):
        return nums(c[3:]), False
    if c == "CG" or (c.startswith("CG-") and c[3:].isdigit()):
        return [], True
    raise ValueError(f"unknown catastro N_COMPA {code!r}")


def fetch_catastro() -> list[dict]:
    """JNB Catastro nacional de cuarteles 2025 (Geoportal de Chile): one row per cuartel."""
    import io
    import zipfile

    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "catastro_cuarteles_2025.zip"
    if not p.exists():
        r = requests.get(CATASTRO_URL, timeout=300, headers=overpass.HEADERS)
        r.raise_for_status()
        p.write_bytes(r.content)
    z = zipfile.ZipFile(io.BytesIO(p.read_bytes()))
    dbf = next(n for n in z.namelist() if n.endswith(".dbf"))
    prj = next(n for n in z.namelist() if n.endswith(".prj"))
    if "WGS_1984" not in z.read(prj).decode() and "WGS 84" not in z.read(prj).decode():
        raise RuntimeError(f"catastro: expected WGS 84 coordinates, got {z.read(prj)[:80]!r}")
    rows = read_dbf(z.read(dbf))
    if len(rows) < 1200:
        raise RuntimeError(f"catastro: {len(rows)} cuarteles, expected about 1,271")
    return rows


def fetch_arcgis_companies() -> list[dict]:
    """The 'Cuarteles_de_Bomberos' ArcGIS layer: one point per compañía, with the cuerpo and its CUT code."""
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "arcgis_companias.json"
    if not p.exists():
        feats: list[dict] = []
        off = 0
        while True:
            r = requests.get(
                ARCGIS_URL + "/query",
                params={
                    "where": "1=1",
                    "outFields": "*",
                    "f": "geojson",
                    "outSR": 4326,
                    "resultOffset": off,
                    "resultRecordCount": 1000,
                },
                timeout=120,
                headers=overpass.HEADERS,
            )
            r.raise_for_status()
            fs = r.json().get("features", [])
            feats += fs
            if len(fs) < 1000:
                break
            off += len(fs)
        p.write_text(json.dumps(feats, ensure_ascii=False))
    feats = json.loads(p.read_text())
    if len(feats) < 1100:
        raise RuntimeError(f"arcgis layer: {len(feats)} compañías, expected about 1,165")
    return [f["properties"] for f in feats]


def osm_stations() -> tuple[list[dict], Counter]:
    """OSM fire stations of the volunteer Bomberos (CONAF, airport SSEI, industrial brigades dropped)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    data = overpass.query(QUERY, CACHE / "osm_fire_stations_cl.json")
    dropped: Counter = Counter()
    out = []
    for e in data["elements"]:
        t = e.get("tags", {})
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None or lon is None:
            dropped["no position"] += 1
            continue
        name = (t.get("name") or t.get("official_name") or "").strip() or None
        text = " ".join(x for x in (name, t.get("operator"), t.get("description")) if x)
        if text and NOT_BOMBEROS.search(text) and "bomber" not in fold(text):
            dropped["not Bomberos"] += 1
            continue
        out.append(
            {
                "osm": f"{e['type']}/{e['id']}",
                "name": name,
                "number": parse_number(name) if name else None,
                "lon": float(lon),
                "lat": float(lat),
            }
        )
    return out, dropped


CONNECTORS = {"de", "del", "la", "las", "los", "el", "y", "e"}


def spanish_case(name: str) -> str:
    """'VIÑA DEL MAR' / 'Viña Del Mar' -> 'Viña del Mar' (connectors in lower case, except the first word)."""
    words = name.strip().split()
    return " ".join(
        w.lower() if i and w.lower() in CONNECTORS else w[:1].upper() + w[1:].lower() for i, w in enumerate(words)
    )


def cuerpo_key(c: str) -> str:
    f = fold(c)
    f = re.sub(r"^(?:cuerpo de bomberos|bomberos)\s+(?:de |del )?", "", f)
    f = f.replace("t. t.", "tagua tagua").replace("gral.", "general").replace("sta.", "santa")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", f)).strip()


def resolve_cuerpo(key: str, official: set[str]) -> str:
    """A cuerpo name from a fleet source -> the official key: 'conchali-huechuraba' and 'la granja, san ramon y
    la pintana' are 'conchali' and 'la granja' in the JNB layers. Unresolved names come back unchanged (and then
    match no compañía, which the bake reports)."""
    if key in official:
        return key
    squashed = [o for o in official if o.replace(" ", "") == key.replace(" ", "")]  # 'lican ray' / 'licanray'
    if len(squashed) == 1:
        return squashed[0]
    pref = [o for o in official if key.startswith(o + " ")]
    return max(pref, key=len) if pref else key


def _nearest(lon: float, lat: float, pts: list[dict], number: int | None = None) -> tuple[float, dict | None]:
    best, best_d = None, math.inf
    for q in pts:
        if number is not None and q["number"] not in (None, number):
            continue
        if abs(q["lat"] - lat) > 0.05 or abs(q["lon"] - lon) > 0.06:
            continue
        d = haversine_m(lon, lat, q["lon"], q["lat"])
        if d < best_d:
            best, best_d = q, d
    return best_d, best


def merge_companies(catastro: list[dict], arc: list[dict], osm: list[dict]) -> tuple[list[dict], dict]:
    """One record per compañía, keyed (cuerpo, number). Every row that does not become a compañía is counted in the
    returned stats.

    Position when both layers have the compañía: the 2025 catastro when they agree within 300 m. When they disagree,
    in this order: the point with an OSM station of the same company number within 300 m; the ArcGIS point if the
    catastro point is the cuartel of a compañía of another cuerpo that only the ArcGIS list has, or if an uncoded
    catastro cuartel of the same cuerpo lies within 500 m of it (the catastro has the building without its code);
    the point nearer an OSM station of the same number within 1.5 km; else the catastro. A compañía only in the catastro whose cuartel is
    "No operativa" is dropped. A compañía only in the ArcGIS list (2024) that sits within 300 m of a catastro
    compañía of another cuerpo is the same cuartel filed under an old cuerpo name, and is dropped."""
    stats: Counter = Counter()
    cat_by: dict[tuple[str, int], dict] = {}
    cat_names: dict[str, str] = {}
    arc_names: dict[str, str] = {}
    uncoded: dict[str, list[dict]] = defaultdict(list)
    for r in catastro:
        nums, _ = parse_n_compa(r["N_COMPA"])
        if r["LATITUD"] is None or r["LONGITUD"] is None or not r["CUERPO"]:
            stats["catastro rows without position or cuerpo"] += 1
            continue
        ck = cuerpo_key(r["CUERPO"])
        if not nums:
            uncoded[ck].append({"lon": r["LONGITUD"], "lat": r["LATITUD"]})
            stats["catastro rows without a company code (cuartel general only / no code)"] += 1
            continue
        cat_names.setdefault(ck, spanish_case(r["CUERPO"]))
        operating = (r["ESTADO_CUA"] or "Operativa") == "Operativa"
        for n in nums:
            prev = cat_by.get((ck, n))
            row = {"lon": r["LONGITUD"], "lat": r["LATITUD"], "status": r["ESTADO_CUA"] or "Operativa"}
            if prev is None:
                cat_by[(ck, n)] = row
                continue
            stats["catastro: second cuartel of the same compañía (kept the operating / first one)"] += 1
            if operating and prev["status"] != "Operativa":
                cat_by[(ck, n)] = row
    arc_by: dict[tuple[str, int], dict] = {}
    for p in arc:
        if p.get("latitud") is None or p.get("longitud") is None or not p.get("cuerpo"):
            stats["arcgis rows without position"] += 1
            continue
        n = int(p["cutCompania"]) % 100
        if n == 0:
            stats["arcgis rows without a company number"] += 1
            continue
        ck = cuerpo_key(p["cuerpo"])
        arc_names.setdefault(ck, spanish_case(p["cuerpo"]))
        row = {"lon": p["longitud"], "lat": p["latitud"], "name": p.get("nombre")}
        if (ck, n) in arc_by:
            # The same compañía twice (two cuarteles): keep the one nearer a catastro point of that compañía, else
            # the first.
            stats["arcgis: second row of the same compañía (kept one)"] += 1
            c = cat_by.get((ck, n))
            if c and haversine_m(row["lon"], row["lat"], c["lon"], c["lat"]) < haversine_m(
                arc_by[(ck, n)]["lon"], arc_by[(ck, n)]["lat"], c["lon"], c["lat"]
            ):
                arc_by[(ck, n)] = row
            continue
        arc_by[(ck, n)] = row
    # Cuerpo names that differ between the two layers ('Licán Ray' / 'Licanray'): an ArcGIS cuerpo that is not in
    # the catastro maps to the catastro cuerpo whose company of the same number sits within 2 km, when at least
    # half of its companies vote for it and the target is not itself a cuerpo of the ArcGIS list (two cuerpos of
    # the list never merge).
    arc_cuerpos = {k[0] for k in arc_by}
    cat_cuerpos = {k[0] for k in cat_by}
    votes: dict[str, Counter] = defaultdict(Counter)
    size: Counter = Counter(k[0] for k in arc_by)
    for (ck, n), a in arc_by.items():
        if ck in cat_cuerpos:
            continue
        for (ck2, n2), c in cat_by.items():
            if n2 == n and ck2 not in arc_cuerpos and haversine_m(a["lon"], a["lat"], c["lon"], c["lat"]) < 2000:
                votes[ck][ck2] += 1
    alias = {}
    for ck, v in votes.items():
        target, k = v.most_common(1)[0]
        if 2 * k >= size[ck]:
            alias[ck] = target
    arc_by2: dict[tuple[str, int], dict] = {}
    for (ck, n), a in arc_by.items():
        key = (alias.get(ck, ck), n)
        if key in arc_by2:
            raise RuntimeError(f"two ArcGIS compañías map to {key} after aligning cuerpo names")
        arc_by2[key] = a
    # Display name: the bomberos.cl spelling ("Viña del Mar") when the cuerpo is in that list, else the catastro's.
    names = dict(cat_names)
    for ck, name in arc_names.items():
        names[alias.get(ck, ck)] = name
    stats["cuerpo names aligned between the layers"] = len(alias)

    def osm_same_number(lon: float, lat: float, number: int) -> float:
        d, _ = _nearest(lon, lat, [q for q in osm if q["number"] == number])
        return d

    arc_only = [(k, a) for k, a in arc_by2.items() if k not in cat_by]
    out = []
    for key in sorted(set(cat_by) | set(arc_by2)):
        c, a = cat_by.get(key), arc_by2.get(key)
        if c and a:
            d = haversine_m(c["lon"], c["lat"], a["lon"], a["lat"])
            dc = osm_same_number(c["lon"], c["lat"], key[1])
            da = osm_same_number(a["lon"], a["lat"], key[1])
            if d <= 300:
                pick, src = c, "catastro"
                stats["both, agree within 300 m"] += 1
            elif dc <= 300 and dc < da:
                pick, src = c, "catastro"
                stats["both, disagree: an OSM station of this number is at the catastro point"] += 1
            elif da <= 300 and da < dc:
                pick, src = a, "arcgis"
                stats["both, disagree: an OSM station of this number is at the ArcGIS point"] += 1
            elif any(
                k[0] != key[0] and haversine_m(c["lon"], c["lat"], o["lon"], o["lat"]) <= 300 for k, o in arc_only
            ):
                # The catastro point is the cuartel of another cuerpo's compañía that only the 2024 list has
                # (Santa Rosa de Huantajaya 1ª filed as Alto Hospicio CB-1): this compañía takes its 2024 point.
                pick, src = a, "arcgis"
                stats["both, disagree: catastro point is another cuerpo's compañía, ArcGIS point"] += 1
            elif any(haversine_m(a["lon"], a["lat"], u["lon"], u["lat"]) <= 500 for u in uncoded[key[0]]):
                pick, src = a, "arcgis"
                stats["both, disagree: an uncoded catastro cuartel sides with ArcGIS"] += 1
            elif da < dc and da <= 1500:
                pick, src = a, "arcgis"
                stats["both, disagree: OSM (same number, within 1.5 km) sides with ArcGIS"] += 1
            elif dc < da and dc <= 1500:
                pick, src = c, "catastro"
                stats["both, disagree: OSM (same number, within 1.5 km) sides with the catastro"] += 1
            else:
                pick, src = c, "catastro"
                stats["both, disagree: no OSM station decides, catastro kept"] += 1
            sources = ("catastro", "arcgis")
        elif c:
            if c["status"] == "No operativa":
                stats["catastro only, cuartel not operating: dropped"] += 1
                continue
            pick, src, sources = c, "catastro", ("catastro",)
            stats["catastro only"] += 1
        else:
            pick, src, sources = a, "arcgis", ("arcgis",)
            stats["ArcGIS only"] += 1
        out.append(
            {
                "cuerpoKey": key[0],
                "cuerpo": names[key[0]],
                "number": key[1],
                "lon": round(pick["lon"], 6),
                "lat": round(pick["lat"], 6),
                "positionFrom": src,
                "sources": sources,
                "nickname": (a or {}).get("name"),
            }
        )
    kept = []
    dropped = []
    for s in out:
        twin = next(
            (
                t
                for t in out
                if s["sources"] == ("arcgis",)
                and t["cuerpoKey"] != s["cuerpoKey"]
                and t["positionFrom"] == "catastro"
                and haversine_m(s["lon"], s["lat"], t["lon"], t["lat"]) <= 300
            ),
            None,
        )
        if twin:
            dropped.append(f"{s['cuerpo']} {s['number']} = {twin['cuerpo']} {twin['number']}")
            continue
        kept.append(s)
    out_stats: dict = dict(stats)
    out_stats["ArcGIS only, same cuartel as a catastro compañía of another cuerpo: dropped"] = dropped
    return kept, out_stats


def build_locations() -> tuple[list[dict], dict]:
    catastro = fetch_catastro()
    arc = fetch_arcgis_companies()
    osm, dropped = osm_stations()
    companies, stats = merge_companies(catastro, arc, osm)
    adm1, adm3 = fetch_boundaries()
    lon = np.array([s["lon"] for s in companies])
    lat = np.array([s["lat"] for s in companies])
    regions = assign_area(lon, lat, adm1)
    comunas = assign_area(lon, lat, adm3)
    people = people_nearby(lon, lat)
    for s, reg, com, ppl in zip(companies, regions, comunas, people, strict=True):
        s["region"] = region_label(reg)
        s["comuna"] = com
        s["peopleNearby"] = int(round(ppl))
        s["settlement"] = "urbano" if ppl > URBAN_PEOPLE else "rural"
    stats.update(
        {
            "catastro cuarteles": len(catastro),
            "arcgis compañías": len(arc),
            "osm stations": len(osm),
            "osm dropped": dict(dropped),
        }
    )
    return companies, stats


# ------------------------------------------------------------------------------------------------ fleets


def load_fleets() -> dict:
    """pipeline/bomberos/fleets.json: compañías whose specialty and/or trucks could be documented. An entry with
    vehicles = [] documents only the specialty."""
    j = json.loads(FLEETS_FILE.read_text())
    seen = set()
    for c in j["companies"]:
        key = (cuerpo_key(c["cuerpo"]), c["number"])
        if key in seen:
            raise ValueError(f"{FLEETS_FILE.name}: {c['cuerpo']} {c['number']} appears twice")
        seen.add(key)
        if c["specialty"] not in SPECIALTIES:
            raise ValueError(f"{FLEETS_FILE.name}: unknown specialty {c['specialty']!r}")
        for v in c["vehicles"]:
            if v["kind"] not in VEHICLE_KIND_UNIT:
                raise ValueError(
                    f"{FLEETS_FILE.name}: unknown vehicle kind {v['kind']!r} in {c['cuerpo']} {c['number']}"
                )
            if not v.get("source"):
                raise ValueError(f"{FLEETS_FILE.name}: {c['cuerpo']} {c['number']}: a vehicle has no source")
    return j


def load_register() -> dict:
    """pipeline/bomberos/registro_material_mayor_2025.json, checked: every row sums to its total, the totals to
    the national figure."""
    j = json.loads(REGISTER_FILE.read_text())
    cats = set(REGISTER_KINDS) | {"gersa"}
    total = 0
    for reg, r in j["regions"].items():
        if set(r["vehicles"]) != cats:
            raise ValueError(f"{REGISTER_FILE.name}: {reg} has categories {sorted(r['vehicles'])}")
        if sum(r["vehicles"].values()) != r["total"]:
            raise ValueError(f"{REGISTER_FILE.name}: {reg} rows sum {sum(r['vehicles'].values())} != {r['total']}")
        total += r["total"]
    if total != j["nationalTotal"] or len(j["regions"]) != 16:
        raise ValueError(f"{REGISTER_FILE.name}: {len(j['regions'])} regions, {total} vehicles != {j['nationalTotal']}")
    return j


def units_of(vehicles: list[dict]) -> list[int]:
    u = [0] * UNIT_COUNT
    for v in vehicles:
        t = VEHICLE_KIND_UNIT[v["kind"]]
        if t is not None:
            u[t] += 1
    return u


def _hash01(key: str) -> float:
    """A number in [0, 1) fixed by `key`: the deterministic tie-breaker and draw (same input, same bake)."""
    return int(hashlib.sha256(key.encode()).hexdigest()[:12], 16) / float(16**12)


def _pick(key: str, items: list, weights: list[float]):
    """Deterministic weighted choice keyed by a string."""
    h = _hash01(key)
    tot = sum(weights)
    acc = 0.0
    for it, w in zip(items, weights, strict=True):
        acc += w / tot
        if h < acc:
            return it
    return items[-1]


def allocate(n: int, ids: list[str], weights: list[float], salt: str) -> list[int]:
    """Share n vehicles among stations by weight (largest remainder; ties by a per-station hash)."""
    out = [0] * len(ids)
    tot = sum(weights)
    if n <= 0 or not ids or tot <= 0:
        return out
    quota = [n * w / tot for w in weights]
    for i, q in enumerate(quota):
        out[i] = int(math.floor(q))
    left = n - sum(out)
    order = sorted(range(len(ids)), key=lambda i: (-(quota[i] - out[i]), _hash01(f"{salt}:{ids[i]}")))
    for i in order[:left]:
        out[i] += 1
    return out


# Relative weight of a station for each register category: (urbano, rural). Forestal units, aljibes and first
# intervention units go mostly where there is wildland and no hydrant network; ladders, rescue and hazmat to
# cities (JNB 2025 register: forestal concentrated in Valparaíso, Biobío, Los Lagos, Maule, O'Higgins, Ñuble).
# The ratios are supuestos.
CATEGORY_WEIGHT: dict[str, tuple[float, float]] = {
    "bomba": (1.0, 1.0),
    "forestal": (1.0, 3.0),
    "aljibe": (1.0, 2.0),
    "primera_intervencion": (1.0, 2.0),
    "escala": (1.0, 0.0),
    "rescate": (2.0, 1.0),
    "hazmat": (1.0, 0.0),
    "ambulancia": (1.0, 1.0),
    "otros": (1.0, 1.0),
}
# The specialty that gets the first unit of a category, one per compañía, before the weighted share.
CATEGORY_SPECIALTY = {"escala": "escala", "rescate": "rescate", "hazmat": "hazmat", "forestal": "forestal"}
WATER_KINDS = ("bomba", "bomba_rescate", "forestal", "primera_intervencion")
# Register categories that serve the compañías without a water unit first, in this order.
WATER_FIRST = ("bomba", "primera_intervencion", "forestal")


def register_category(kind: str) -> str:
    for cat, kinds in REGISTER_KINDS.items():
        if kind in kinds:
            return cat
    raise ValueError(f"vehicle kind {kind!r} has no register category")


def allocate_region(
    stations: list[dict], target: dict[str, int]
) -> tuple[dict[str, Counter], dict[str, int], list[str]]:
    """Estimated vehicles per station (id -> Counter of register categories) for one region, so that documented +
    estimated vehicles of every category equal the register. Stations with a complete documented fleet get
    nothing. Returns also the categories where the documented vehicles already exceed the register, and the
    general compañías left without any water unit because the region's register has fewer bombas, first-response
    units and forestales than such compañías."""
    have: Counter = Counter()
    for s in stations:
        for v in s.get("vehicles", []):
            have[register_category(v["kind"])] += 1
    open_ = [s for s in stations if not s.get("fleetComplete")]
    ids = [s["id"] for s in open_]
    add: dict[str, Counter] = {i: Counter() for i in ids}
    over = {}
    # General compañías with no water unit documented: they get the first bomba, most residents first; when the
    # register's bombas run out, the first first-response unit or forestal.
    lacking = [
        s
        for s in open_
        if s.get("specialty", "desconocida") not in ("escala", "rescate", "hazmat")
        and not any(v["kind"] in WATER_KINDS for v in s.get("vehicles", []))
    ]
    lacking.sort(key=lambda s: (-s["peopleNearby"], s["id"]))
    for cat in ("bomba", "primera_intervencion", "forestal", *[c for c in REGISTER_KINDS if c not in WATER_FIRST]):
        n = target[cat] - have[cat]
        if n < 0:
            over[cat] = -n
            continue
        if not open_:
            continue
        spec = CATEGORY_SPECIALTY.get(cat)
        if cat in WATER_FIRST:
            served = lacking[:n]
            for s in served:
                add[s["id"]][cat] += 1
            n -= len(served)
            lacking = lacking[len(served) :]
        if spec:
            first = [
                s
                for s in open_
                if s.get("specialty") == spec
                and add[s["id"]][cat] == 0
                and not any(register_category(v["kind"]) == cat for v in s.get("vehicles", []))
            ]
            first.sort(key=lambda s: (-s["peopleNearby"], s["id"]))
            for s in first[:n]:
                add[s["id"]][cat] += 1
            n -= min(n, len(first))
        wu, wr = CATEGORY_WEIGHT[cat]
        weights = [(wu if s["settlement"] == "urbano" else wr) for s in open_]
        if sum(weights) == 0:
            weights = [1.0] * len(open_)
        for s, k in zip(open_, allocate(n, ids, weights, cat), strict=True):
            add[s["id"]][cat] += k
    return add, over, [s["id"] for s in lacking]


# Notes in a documented model that belong to that one vehicle, not to the model ("aprobado 2021", "donada por
# LATAM", "ex Gates Fire District", "entregado jun-2018"): dropped before the model is reused for an estimate.
VEHICLE_NOTE_WORDS = (
    r"aprob|donad|entreg|reempla|fuera de servicio|nota\b|\bex\b|lleg[oó]|en servicio|adquir|compr|regal"
)
VEHICLE_NOTE = re.compile(VEHICLE_NOTE_WORDS + r"|\b(?:19|20)\d\d\b", re.IGNORECASE)


def clean_model(model: str | None) -> str | None:
    """The model text without per-vehicle notes, for drawing estimated vehicles: parenthesised notes
    (VEHICLE_NOTE, years included) first, then anything after ';', then a trailing note introduced by one of the
    note words ('... nuevo 0 km entregado por GORE')."""
    if not model:
        return None
    m = re.sub(r"\s*\(([^()]*)\)", lambda g: "" if VEHICLE_NOTE.search(g.group(1)) else g.group(0), model)
    m = m.split(";")[0]
    m = re.split(r"\s*,?\s*(?:%s)" % VEHICLE_NOTE_WORDS, m, maxsplit=1, flags=re.IGNORECASE)[0]
    m = re.sub(r"\s+", " ", m).strip(" ,.-(")
    return m or None


# Estimated vehicles of these kinds get no make/model: the register's "otros" are pickups, command, transport and
# logistics of every sort, and no source gives a model for first-response units or ambulances.
NO_MODEL_KINDS = ("otro", "primera_intervencion", "ambulancia")


def model_weights(documented: list[dict], procurement: list[dict], register: dict) -> dict[str, dict]:
    """Draw weights per kind over (make, model). A JNB bulk purchase weighs its share of the national register
    of that type (71 Magirus of 2017 among 1,644 bombas = 4.3 %); the documented models share the rest by their
    frequency."""
    national: Counter = Counter()
    for r in register["regions"].values():
        for cat in REGISTER_KINDS:
            national[cat] += r["vehicles"][cat]
    doc: dict[str, Counter] = defaultdict(Counter)
    for c in documented:
        for v in c["vehicles"]:
            m = clean_model(v["model"])
            if m and v["kind"] not in NO_MODEL_KINDS:
                doc[v["kind"]][(v["make"], m)] += 1
    bought: dict[str, Counter] = defaultdict(Counter)
    for p in procurement:
        bought[p["kind"]][(p["make"], clean_model(p["model"]))] += p["count"]
    out: dict[str, dict] = {}
    for kind in set(doc) | set(bought):
        total = national[register_category(kind)]
        w: dict = {k: n / total for k, n in bought[kind].items()}
        rest = 1.0 - sum(w.values())
        if rest < 0:
            raise ValueError(f"bulk purchases of {kind} exceed the register ({sum(bought[kind].values())} > {total})")
        nd = sum(doc[kind].values())
        for k, n in doc[kind].items():
            w[k] = w.get(k, 0.0) + rest * n / nd
        out[kind] = w
    return out


def _vehicle(station_id: str, kind: str, i: int, models: dict[str, dict]) -> dict:
    mm = models.get(kind)
    make = model = None
    if mm and kind not in NO_MODEL_KINDS:
        items = sorted(mm, key=lambda x: (x[0] or "", x[1] or ""))
        make, model = _pick(f"{station_id}:{kind}:{i}:model", items, [mm[x] for x in items])
    return {"code": None, "kind": kind, "make": make, "model": model, "year": None, "source": None}


ESTIMATE_NOTE = (
    "Supuesto (carros con source null): ninguna fuente abierta publica los carros de cada compañía. Por región y "
    "tipo de carro, el Registro Nacional de Material Mayor 2025 de la Junta Nacional de Bomberos (Memoria 2025, "
    "p. 34, solo en servicio activo) menos los carros documentados se reparte entre las compañías sin flota "
    "documentada completa: primero un carro con agua a cada compañía de agua que no tenga uno (las de más "
    "residentes cerca primero; si se acaban las bombas del registro, una unidad de primera intervención o forestal; "
    "si tampoco quedan, la compañía queda sin carro con agua) y el primer carro de su especialidad a las de escala, rescate y materiales "
    "peligrosos; el resto por peso (forestal x3, aljibe y primera intervención x2 en entorno rural; escala y "
    "materiales peligrosos solo en entorno urbano; rescate x2 en urbano), con un sorteo determinista por compañía. "
    "Así los totales por región y tipo coinciden con el registro. Urbano: más de 15.000 residentes a menos de 2,5 km. "
    "Marca y modelo sorteados entre los modelos documentados del mismo tipo (por frecuencia) y las compras masivas "
    "de la Junta Nacional (cada compra pesa su fracción del registro nacional de ese tipo); sin modelo para «otros», "
    "primera intervención y ambulancias."
)


def bake(baked: str) -> dict:
    """Write national/bomberos_cl.json. `baked` = local date (YYYY-MM-DD) recorded in the file."""
    companies, stats = build_locations()
    fleets = load_fleets()
    by_key = {(c["cuerpoKey"], c["number"]): c for c in companies}
    keys_by_cuerpo = defaultdict(set)
    for c in companies:
        keys_by_cuerpo[c["cuerpoKey"]].add(c["number"])
    unmatched = []
    official = set(keys_by_cuerpo)
    for f in fleets["companies"]:
        key = (resolve_cuerpo(cuerpo_key(f["cuerpo"]), official), f["number"])
        c = by_key.get(key)
        if c is None:
            unmatched.append(f"{f['cuerpo']} {f['number']}")
            continue
        c["specialty"] = f["specialty"]
        if f.get("name"):
            c["nickname"] = f["name"]
        if f["vehicles"]:
            c["vehicles"] = [dict(v) for v in f["vehicles"]]
            c["fleetSource"] = f["source"]
            c["fleetComplete"] = bool(f["complete"])
    documented = [c for c in companies if c.get("fleetSource")]
    register = load_register()
    models = model_weights(documented, fleets["procurement"], register)
    for c in companies:
        c["id"] = f"{slug(c['cuerpo'])}-{c['number']}"
    by_region: dict[str, list[dict]] = defaultdict(list)
    for c in companies:
        by_region[c["region"]].append(c)
    if set(by_region) != set(register["regions"]):
        raise RuntimeError(f"regions differ from the register: {sorted(set(by_region) ^ set(register['regions']))}")
    added: dict[str, Counter] = {}
    over_register = {}
    no_water: list[str] = []
    for reg, lst in by_region.items():
        veh = register["regions"][reg]["vehicles"]
        target = {cat: veh[cat] for cat in REGISTER_KINDS}
        target["otros"] += veh["gersa"]
        add, over, dry = allocate_region(lst, target)
        added.update(add)
        if over:
            over_register[reg] = over
        no_water += dry
    stations = []
    for c in sorted(companies, key=lambda c: (c["region"], c["cuerpo"], c["number"])):
        sid = c["id"]
        specialty = c.get("specialty", "desconocida")
        complete = bool(c.get("fleetComplete"))
        vehicles = list(c.get("vehicles", []))
        fleet_source = c.get("fleetSource")
        for cat, k in sorted(added.get(sid, Counter()).items()):
            kind = REGISTER_KINDS[cat][0]
            vehicles += [_vehicle(sid, kind, i, models) for i in range(k)]
        if not vehicles:
            # Every region's register has more vehicles than compañías; if a compañía still ends up with none,
            # stop rather than ship a company without trucks that the source does not say it lacks.
            raise RuntimeError(f"{sid}: no vehicle after the allocation; the register leaves it without trucks")
        stations.append(
            {
                "id": sid,
                "cuerpo": c["cuerpo"],
                "cuerpoInferred": False,
                "number": c["number"],
                "company": f"{c['number']}ª Compañía"
                + (
                    f" «{c['nickname']}»"
                    if c.get("nickname")
                    and not re.match(
                        r"^(primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima|und[eé]cima|duod[eé]cima|vig[eé]sima)\b",
                        fold(c["nickname"]),
                    )
                    else ""
                ),
                "kind": "compania",
                "specialty": specialty,
                "region": c["region"],
                "comuna": c["comuna"],
                "lon": c["lon"],
                "lat": c["lat"],
                "settlement": c["settlement"],
                "peopleNearby": c["peopleNearby"],
                "locationSource": LOCATION_SOURCE[c["positionFrom"]],
                "vehicles": vehicles,
                "units": units_of(vehicles),
                "fleetSource": fleet_source,
                "fleetComplete": complete,
            }
        )
    ids = Counter(s["id"] for s in stations)
    if any(n > 1 for n in ids.values()):
        raise RuntimeError(f"duplicate station ids: {[k for k, n in ids.items() if n > 1][:5]}")
    units = [sum(s["units"][i] for s in stations) for i in range(UNIT_COUNT)]
    out = {
        "version": 1,
        "baked": baked,
        "totals": {
            "stations": len(stations),
            "documentedFleets": len(documented),
            "vehicles": sum(len(s["vehicles"]) for s in stations),
            "units": units,
        },
        "reference": fleets["reference"],
        "estimateMethod": ESTIMATE_NOTE,
        "sources": SOURCES_TEXT + fleets["sources"],
        "stations": stations,
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    kinds = Counter(v["kind"] for s in stations for v in s["vehicles"])
    return {
        **stats,
        "stations": len(stations),
        "documented fleets": len(documented),
        "complete documented fleets": sum(1 for c in documented if c.get("fleetComplete")),
        "fleet entries not matched to a compañía": unmatched,
        "documented vehicles above the register (region: category: excess)": over_register,
        "general compañías left without a water unit (the register has too few)": no_water,
        "vehicles by kind": dict(kinds),
        "units [B, F, Z, R]": units,
        "bytes": OUT_FILE.stat().st_size,
    }


LOCATION_SOURCE = {
    "catastro": "Catastro Nacional de Cuarteles de Bomberos 2025, Junta Nacional de Cuerpos de Bomberos de Chile "
    "(Geoportal de Chile, IDE Chile)",
    "arcgis": "Compañías de Bomberos de Chile, bomberos.cl, 2024-10-08 (Itrend, Datos para Resiliencia, "
    "doi:10.71578/DGVCQZ, CC BY 4.0)",
}
SOURCES_TEXT = [
    "Ubicaciones: Catastro Nacional de Cuarteles de Bomberos 2025, Junta Nacional de Cuerpos de Bomberos de Chile, "
    "Geoportal de Chile (IDE Chile), " + CATASTRO_URL,
    "Compañías y nombres: Bomberos de Chile vía Itrend, Datos para Resiliencia (doi:10.71578/DGVCQZ, CC BY 4.0), "
    "copia pública " + ARCGIS_URL,
    "Desempate de posiciones: OpenStreetMap amenity=fire_station (© colaboradores de OpenStreetMap, ODbL)",
    "Región y comuna: geoBoundaries gbOpen CHL ADM1 / ADM3 (CC BY 4.0)",
    "Residentes cerca de cada cuartel: national/population_cl (WorldPop 2024, CC BY 4.0)",
]
