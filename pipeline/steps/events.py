"""The events the pipeline can bake: one grid, clock and set of source parameters per fire.

`bake.py --event <id>` calls grid.select(id); every step then reads the grid from the `grid` module
attributes and its event-specific parameters from `grid.EVENT` (an Event below). Nothing here downloads
anything. Every event uses the same global sources (Copernicus DEM, ESA WorldCover, Overture, OSM, Open-Meteo,
Sentinel-2, NASA FIRMS, GOES) so that the events are comparable; an official perimeter, where one exists, is
used for validation only.

Times in the data files are LOCAL wall-clock ISO strings; `utc_offset_h` is the fixed offset of the event's
time zone over the whole baked window (tests/test_steps.py checks it against `timezone` with zoneinfo).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

OVERTURE_RELEASE = "2026-11-18.0"  # latest in the bucket at bake time; older releases are not kept there

BASE_OUTPUTS = (
    "grid.json",
    "elevation.bin",
    "fuel.bin",
    "buildings.bin",
    "roads.json",
    "weather.json",
    "scar.bin",
    "firms.json",
    "goes.json",
    "ignitions.json",
)


@dataclass(frozen=True)
class Event:
    id: str
    # Grid (GridMeta in web/src/engine/types.ts). Row 0 = north edge; dLon = cell_m / (111320 cos ref_lat).
    lat_max: float
    lon_min: float
    rows: int
    cols: int
    ref_lat: float  # latitude (degrees, unsigned) used for dLon: the centre of the grid
    t0: str  # clock origin, local ISO with offset
    timezone: str  # IANA zone of the local times
    utc_offset_h: int  # its offset over the whole baked window
    out_subdir: str  # under web/public/data/ ("" = the directory itself)
    cache_subdir: str  # under pipeline/.cache/ ("" = the directory itself)
    # Sources
    dem_tiles: tuple[str, ...]  # Copernicus GLO-30 1x1 degree tiles (lower-left corner names)
    worldcover_tiles: tuple[str, ...]  # ESA WorldCover 3x3 degree tiles (lower-left corner names)
    s2_pre: str  # Sentinel-2 L2A scene (Earth Search id): pre-fire, also the NDVI scene of steps/wui.py
    s2_post: str  # Sentinel-2 L2A scene: post-fire
    s2_window_pad_m: int  # margin around the grid when reading the Sentinel-2 window (clipped to the tile)
    scar_offset: float  # added to DN * 0.0001 to get the reflectance used for the scar (see steps/scar.py)
    scar_max_negative_share: float  # the bake stops if more valid pixels than this come out negative
    scar_firms_days: tuple[str, ...]  # local dates of the VIIRS detections that keep a scar patch
    firms_country: str  # FIRMS yearly country archive file name part
    firms_year: int
    firms_first: str  # local times kept in firms.json, "YYYY-MM-DDTHH:MM" (inclusive)
    firms_last: str
    goes_bucket: str  # NOAA bucket on AWS
    goes_satellite: str  # `satellite` field of goes.json
    goes_first_utc: datetime  # first and last hour (UTC, inclusive) of full-disk scans
    goes_last_utc: datetime
    weather_lat: float
    weather_lon: float
    weather_first_day: str  # local dates requested from Open-Meteo (inclusive)
    weather_last_day: str
    weather_summary: tuple[str, str]  # local window (inclusive) summarised in the bake log
    sources: dict[str, str]  # grid.json "sources" (the "Fuentes" panel), in display order
    ignitions: tuple[dict, ...] | None  # fixed presets; None = derived from the first VIIRS pass (Viña)
    population: bool  # bake population_{home,work}.bin (Chile only: the national product)
    perimeter: dict | None = field(default=None)  # official final perimeter (validation only), see perimeter.py
    dins: dict | None = field(default=None)  # CAL FIRE damage inspection points (validation only), see dins.py

    @property
    def outputs(self) -> tuple[str, ...]:
        out = BASE_OUTPUTS
        if self.population:
            out += (
                "population_home.bin",
                "population_work.bin",
                "national/population_cl.json",
                "national/population_cl.bin",
            )
        if self.perimeter:
            out += ("perimeter.bin",)
        if self.dins:
            out += ("dins.json",)
        return out


_COPERNICUS_DEM = (
    "Copernicus DEM GLO-30 (ESA / Airbus), tiles {tiles} vía AWS Open Data "
    "(https://registry.opendata.aws/copernicus-dem/). © DLR e.V. 2010-2014 y © Airbus Defence and Space "
    "GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y ESA."
)
_WORLDCOVER = (
    "ESA WorldCover 10 m 2021 v200 (https://esa-worldcover.org/), "
    "© ESA WorldCover project 2021 / Contiene datos Copernicus Sentinel modificados (2021), CC BY 4.0. "
    "Clase mayoritaria por celda de 60 m. Zonas urbanas divididas en interfaz (casas entre vegetación: "
    ">= 40 % de vegetación en 180 m, según WorldCover y NDVI de Sentinel-2 del {ndvi_date}, previo al incendio) "
    "y ciudad consolidada (el resto)."
)
_OVERTURE = (
    f"Overture Maps Foundation, buildings, release {OVERTURE_RELEASE} "
    "(https://overturemaps.org/), ODbL 1.0 (incluye OpenStreetMap y huellas derivadas de Microsoft y "
    "Google). Huellas actuales, no necesariamente las de {month}."
)
_OSM = (
    "© OpenStreetMap contributors, vía Overpass API (https://www.openstreetmap.org/copyright), "
    "ODbL 1.0. Red actual, no necesariamente la de {month}."
)
_OPEN_METEO = (
    "Open-Meteo Historical Weather API (reanalysis based on ECMWF ERA5 / ERA5-Land), punto {lat:.2f}, {lon:.2f}, "
    "horario local {tz}. https://open-meteo.com/ (CC BY 4.0)"
)
_GOES = (
    "NOAA {sat} ABI L2 Fire Detection and Characterization (ABI-L2-FDCF), disco completo cada 10 min, "
    "píxel ~2 km, vía NOAA Open Data Dissemination en AWS (https://registry.opendata.aws/noaa-goes/). "
    "Datos públicos de NOAA. Solo se usa para medir el ritmo del fuego simulado."
)

VINA_2024 = Event(
    id="vina-2024",
    lat_max=-32.965,
    lon_min=-71.625,
    rows=464,
    cols=529,
    ref_lat=33.09,
    t0="2024-02-02T12:00:00-03:00",
    timezone="America/Santiago",
    utc_offset_h=-3,  # Chile summer time (CLST) in February 2024
    out_subdir="",
    cache_subdir="",
    dem_tiles=("S34_00_W072_00", "S33_00_W072_00"),
    worldcover_tiles=("S36W072", "S33W072"),  # the grid straddles lat -33
    s2_pre="S2B_19HBD_20240118_0_L2A",
    s2_post="S2A_19HBD_20240212_0_L2A",
    s2_window_pad_m=200,
    # Shipped convention, kept so Viña's scar and everything calibrated on it stay unchanged: both COGs are
    # already offset-free, so -0.1 makes 15.6 % (pre) and 19.6 % (post) of the valid pixels negative.
    scar_offset=-0.1,
    scar_max_negative_share=0.25,
    scar_firms_days=("2024-02-02", "2024-02-03"),
    firms_country="Chile",
    firms_year=2024,
    firms_first="2024-02-02T00:00",
    firms_last="2024-02-04T23:59",
    goes_bucket="noaa-goes16",
    goes_satellite="GOES-16 ABI",
    goes_first_utc=datetime(2024, 2, 2, 15),  # 2 Feb 12:00 local
    goes_last_utc=datetime(2024, 2, 3, 6),  # 3 Feb 03:00-04:00 local (last hour included)
    weather_lat=-33.10,
    weather_lon=-71.49,
    weather_first_day="2024-02-02",
    weather_last_day="2024-02-03",
    weather_summary=("2024-02-02T12:00", "2024-02-02T20:00"),
    sources={
        "Relieve": _COPERNICUS_DEM.format(tiles="S33/S34 W072"),
        "Cobertura de suelo / combustible": _WORLDCOVER.format(ndvi_date="18-01-2024"),
        "Edificaciones": _OVERTURE.format(month="febrero de 2024"),
        "Calles": _OSM.format(month="febrero de 2024"),
        "Meteorología": _OPEN_METEO.format(lat=-33.10, lon=-71.49, tz="America/Santiago"),
        "Cicatriz del incendio": (
            "Copernicus Sentinel-2 L2A (ESA), escenas S2B 2024-01-18 y S2A 2024-02-12, tile 19HBD, vía Element84 "
            "Earth Search (https://earth-search.aws.element84.com/v1). dNBR > 0.27 (0.15 en zonas urbanas). Huella "
            "final del evento (2-4 feb). Contiene datos Copernicus Sentinel modificados (2024), licencia abierta "
            "Copernicus."
        ),
        "Detecciones satelitales de fuego": (
            "NASA FIRMS (Fire Information for Resource Management System), detecciones VIIRS S-NPP / NOAA-20 375 m "
            "y MODIS 1 km, archivo por país (Chile 2024). https://firms.modaps.eosdis.nasa.gov/ "
            "(datos NASA, uso libre con atribución)"
        ),
        "Detecciones de fuego GOES-16 (cada 10 min)": _GOES.format(sat="GOES-16"),
        "Focos predefinidos": "Ubicaciones aproximadas según primeras detecciones satelitales (NASA FIRMS VIIRS); "
        "hora del foco Las Tablas según reportes de prensa (CIPER, Cooperativa). No son datos oficiales.",
    },
    ignitions=None,
    population=True,
)

EATON_CALFIRE_URL = "https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire"
EATON_DINS_URL = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/DINS_2025_Eaton_Public_View/FeatureServer/0"
)
EATON_PERIMETER_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0"
)

EATON_2025 = Event(
    id="eaton-2025",
    # Final perimeter: lon -118.162..-118.013, lat 34.162..34.238. Margins: N 3.6 km, W 3.5 km, E 3.0 km
    # (the east edge is the east edge of Sentinel-2 tile 11SLT at the grid's north edge), S 6.3 km to take
    # in Pasadena (evacuation destinations).
    lat_max=34.27,
    lon_min=-118.20,
    rows=306,
    cols=337,
    ref_lat=34.1875,
    t0="2025-01-07T18:00:00-08:00",
    timezone="America/Los_Angeles",
    utc_offset_h=-8,  # PST, no DST change in January
    out_subdir="eaton-2025",
    cache_subdir="eaton-2025",
    dem_tiles=("N34_00_W119_00", "N34_00_W118_00"),  # the grid straddles lon -118
    worldcover_tiles=("N33W120",),
    s2_pre="S2A_11SLT_20250102_0_L2A",  # 5 days before ignition, 0 % invalid pixels over the grid
    s2_post="S2C_11SLT_20250221_0_L2A",  # first scene after containment (31 Jan) with 0 % invalid over the grid
    s2_window_pad_m=60,
    # True surface reflectance: both COGs are offset-free (0 % negative pixels with 0.0; with -0.1, 48 % and 27 %
    # would be). The post scene's STAC flag says `boa_offset_applied: false`, but its pixels show it is not.
    scar_offset=0.0,
    scar_max_negative_share=0.01,
    scar_firms_days=("2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10"),
    firms_country="United_States",
    firms_year=2025,
    firms_first="2025-01-07T16:00",  # same start as the GOES window; leaves out 2 unrelated pre-dawn detections
    firms_last="2025-01-10T23:59",
    goes_bucket="noaa-goes18",  # GOES-West
    goes_satellite="GOES-18 ABI",
    goes_first_utc=datetime(2025, 1, 8, 0),  # 7 Jan 16:00 local
    goes_last_utc=datetime(2025, 1, 9, 8),  # 9 Jan 00:00-01:00 local (last hour included)
    weather_lat=34.19,
    weather_lon=-118.12,
    weather_first_day="2025-01-07",
    weather_last_day="2025-01-09",
    weather_summary=("2025-01-07T18:00", "2025-01-08T12:00"),
    sources={
        "Relieve": _COPERNICUS_DEM.format(tiles="N34 W119/W118"),
        "Cobertura de suelo / combustible": _WORLDCOVER.format(ndvi_date="02-01-2025"),
        "Edificaciones": _OVERTURE.format(month="enero de 2025")
        + " Parte de las casas destruidas puede faltar o estar reconstruida.",
        "Calles": _OSM.format(month="enero de 2025"),
        "Meteorología": _OPEN_METEO.format(lat=34.19, lon=-118.12, tz="America/Los_Angeles")
        + ". Reanálisis de baja resolución: suaviza los extremos locales del viento (ráfagas).",
        "Cicatriz del incendio": (
            "Copernicus Sentinel-2 L2A (ESA), escenas S2A_11SLT_20250102 (pre) y S2C_11SLT_20250221 (post, tras la "
            "contención del 31-01-2025), tile 11SLT, vía Element84 Earth Search "
            "(https://earth-search.aws.element84.com/v1). Mismos umbrales que Viña del Mar: dNBR > 0.27 (0.15 en "
            "zonas urbanas). Huella final del evento. Contiene datos Copernicus Sentinel modificados (2025), licencia "
            "abierta Copernicus."
        ),
        "Detecciones satelitales de fuego": (
            "NASA FIRMS (Fire Information for Resource Management System), detecciones VIIRS S-NPP / NOAA-20 375 m "
            "y MODIS 1 km, archivo por país (Estados Unidos 2025), 7-10 ene 2025. "
            "https://firms.modaps.eosdis.nasa.gov/ (datos NASA, uso libre con atribución)"
        ),
        "Detecciones de fuego GOES-18 (cada 10 min)": _GOES.format(sat="GOES-18 (GOES-West)"),
        "Focos predefinidos": "Hora y coordenadas de inicio según la página oficial del incendio de CAL FIRE "
        f"({EATON_CALFIRE_URL}).",
        "Perímetro oficial (solo validación)": "Perímetro final del incendio Eaton (2025-CALAC-009087, 14.021 acres), "
        f"NIFC / WFIGS Interagency Fire Perimeters ({EATON_PERIMETER_URL}), datos públicos. No lo usa el simulador: "
        "solo sirve para comparar.",
        "Daños en estructuras (solo validación)": "CAL FIRE Damage Inspection (DINS), incendio Eaton 2025: una "
        f"inspección por estructura con su clase de daño ({EATON_DINS_URL}), datos públicos. No lo usa el "
        "simulador: solo sirve para comparar.",
    },
    ignitions=(
        {
            "id": "eaton-calfire",
            "label": "Inicio del incendio Eaton (CAL FIRE)",
            "lon": -118.069155,
            "lat": 34.203483,
            "timeLocal": "2025-01-07T18:18",
            "source": "CAL FIRE, página oficial del incidente Eaton Fire: inicio el 07-01-2025 a las 18:18, "
            f"coordenadas 34.203483, -118.069155 ({EATON_CALFIRE_URL}).",
        },
    ),
    population=False,
    perimeter={
        "url": EATON_PERIMETER_URL,
        "unique_fire_id": "2025-CALAC-009087",
        "category": "Wildfire Final Fire Perimeter",
    },
    dins={"url": EATON_DINS_URL},
)

EVENTS = {e.id: e for e in (VINA_2024, EATON_2025)}
DEFAULT = VINA_2024.id
