"""roads.json: undirected street graph from OSM (Overpass), see RoadsFile in web/src/engine/types.ts.

Graph nodes sit at way ends and at OSM nodes shared by 2+ ways (or repeated inside one way); one edge
per stretch between consecutive graph nodes along a way, with haversine length, road class and the
polyline. Connected components with fewer than MIN_COMPONENT_NODES nodes are dropped.
"""

from __future__ import annotations

import json
from collections import Counter

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from . import grid, overpass

# ROAD enum in types.ts
MOTORWAY, PRIMARY, SECONDARY, TERTIARY, LOCAL, PATH = range(6)
ROAD_CLASS = {
    "motorway": MOTORWAY,
    "motorway_link": MOTORWAY,
    "trunk": MOTORWAY,
    "trunk_link": MOTORWAY,
    "primary": PRIMARY,
    "primary_link": PRIMARY,
    "secondary": SECONDARY,
    "secondary_link": SECONDARY,
    "tertiary": TERTIARY,
    "tertiary_link": TERTIARY,
    "residential": LOCAL,
    "unclassified": LOCAL,
    "living_street": LOCAL,
    "service": LOCAL,
    "road": LOCAL,
    "busway": LOCAL,
    "track": PATH,
    "path": PATH,
    "footway": PATH,
    "steps": PATH,
    "pedestrian": PATH,
    "cycleway": PATH,
    "bridleway": PATH,
    "corridor": PATH,
}
# highway=* values that are not usable ways (not built, closed, or not a way at all). Excluded on purpose.
EXCLUDED = {
    "proposed",
    "construction",
    "abandoned",
    "disused",
    "razed",
    "platform",
    "bus_stop",
    "elevator",
    "raceway",
    "rest_area",
    "services",
    "emergency_bay",
    "bus_guideway",
    "planned",
    "no",
    "crossing",
    "traffic_signals",
    "street_lamp",
    "turning_circle",
    "escape",
}
MIN_COMPONENT_NODES = 20
GEOM_DECIMALS = 6
MAX_BYTES = 10_000_000  # size target for roads.json; above it, polylines are simplified
SIMPLIFY_TOL_M = 1.0  # Douglas-Peucker tolerance used only when the file would exceed MAX_BYTES


def simplify(pts: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on [lon, lat] points (local metric approximation); keeps both ends."""
    if len(pts) <= 2:
        return pts
    a = np.asarray(pts, dtype=np.float64)
    k = np.cos(np.radians(a[0, 1])) * 111320.0
    xy = np.column_stack([(a[:, 0] - a[0, 0]) * k, (a[:, 1] - a[0, 1]) * 111320.0])
    keep = np.zeros(len(a), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = xy[i], xy[j]
        d = q - p
        seg = np.hypot(*d)
        rel = xy[i + 1 : j] - p
        if seg == 0:
            dist = np.hypot(rel[:, 0], rel[:, 1])
        else:
            dist = np.abs(d[0] * rel[:, 1] - d[1] * rel[:, 0]) / seg
        m = int(np.argmax(dist))
        if dist[m] > tol_m:
            keep[i + 1 + m] = True
            stack.append((i, i + 1 + m))
            stack.append((i + 1 + m, j))
    return [pts[i] for i in np.flatnonzero(keep)]


def build_graph(ways: list[tuple[list[int], int]], coords: dict[int, tuple[float, float]]):
    """Pure graph construction (unit-tested).

    ways: (osm node ids in order, road class) per way. coords: osm node id -> (lon, lat).
    Returns (nodes [[lon, lat]], edges [[u, v, lengthM, cls]], geoms [[[lon, lat], ...]]), with
    components smaller than MIN_COMPONENT_NODES removed and node indices compacted.
    """
    use = Counter()
    for ids, _ in ways:
        for nid in ids:
            use[nid] += 1
    graph_id: dict[int, int] = {}
    node_ll: list[tuple[float, float]] = []

    def gid(nid: int) -> int:
        if nid not in graph_id:
            graph_id[nid] = len(node_ll)
            node_ll.append(coords[nid])
        return graph_id[nid]

    edges: list[tuple[int, int, float, int]] = []
    geoms: list[list[tuple[float, float]]] = []
    for ids, cls in ways:
        # Drop consecutive duplicates (zero-length segments).
        ids = [n for i, n in enumerate(ids) if i == 0 or n != ids[i - 1]]
        if len(ids) < 2:
            continue
        start = 0
        for i in range(1, len(ids)):
            if i == len(ids) - 1 or use[ids[i]] >= 2:
                seg = ids[start : i + 1]
                pts = np.array([coords[n] for n in seg])
                length = float(grid.haversine_m(pts[:-1, 0], pts[:-1, 1], pts[1:, 0], pts[1:, 1]).sum())
                u, v = gid(seg[0]), gid(seg[-1])
                if u != v or length > 0:
                    edges.append((u, v, length, cls))
                    geoms.append([coords[n] for n in seg])  # plain floats: same rounding as nodes
                start = i

    n = len(node_ll)
    if n == 0:
        return [], [], []
    e = np.array([(u, v) for u, v, _, _ in edges], dtype=np.int64).reshape(-1, 2)
    adj = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    ncomp, label = connected_components(adj, directed=False)
    size = np.bincount(label, minlength=ncomp)
    keep_node = size[label] >= MIN_COMPONENT_NODES
    remap = np.full(n, -1, dtype=np.int64)
    remap[keep_node] = np.arange(int(keep_node.sum()))
    nodes = [node_ll[i] for i in range(n) if keep_node[i]]
    out_edges, out_geoms = [], []
    for (u, v, length, cls), g in zip(edges, geoms):
        if keep_node[u]:  # an edge's two ends are always in the same component
            out_edges.append((int(remap[u]), int(remap[v]), length, cls))
            out_geoms.append(g)
    return nodes, out_edges, out_geoms


def split_runs(node_ids: list[int], keep: set[int]) -> list[list[int]]:
    """Pure (unit-tested): the maximal runs (2+ nodes) of consecutive node ids that are in `keep`."""
    runs, cur = [], []
    for nid in node_ids:
        if nid in keep:
            cur.append(nid)
        else:
            if len(cur) >= 2:
                runs.append(cur)
            cur = []
    if len(cur) >= 2:
        runs.append(cur)
    return runs


def load_osm():
    w, s, e, n = grid.bbox()
    q = f"[out:json][timeout:600];way[highway]({s},{w},{n},{e});out body;>;out skel qt;"
    data = overpass.query(q, grid.CACHE_DIR / "overpass_highways.json")
    coords = {el["id"]: (el["lon"], el["lat"]) for el in data["elements"] if el["type"] == "node"}
    # Overpass returns whole ways, also their nodes outside the bbox. Ways are clipped to the grid (cut
    # into the runs of consecutive in-grid nodes) so every graph node has a cell.
    ids = np.fromiter(coords, dtype=np.int64, count=len(coords))
    ll = np.array([coords[i] for i in ids]).reshape(-1, 2)
    in_grid = set(ids[grid.cell_index(ll[:, 0], ll[:, 1]) >= 0].tolist())
    ways, skipped = [], Counter()
    for el in data["elements"]:
        if el["type"] != "way":
            continue
        hw = el.get("tags", {}).get("highway")
        cls = ROAD_CLASS.get(hw)
        if cls is None:
            skipped[hw] += 1
            continue
        missing = [nid for nid in el["nodes"] if nid not in coords]
        if missing:
            raise RuntimeError(f"way {el['id']} references {len(missing)} nodes absent from the Overpass result")
        ways.extend((run, cls) for run in split_runs(el["nodes"], in_grid))
    unknown = {k: v for k, v in skipped.items() if k not in EXCLUDED}
    print(
        f"  way pieces in the grid: {len(ways)}; skipped by design: { {k: v for k, v in skipped.items() if k in EXCLUDED} }"
    )
    if unknown:
        print(f"  !! skipped unmapped highway values (not in ROAD_CLASS or EXCLUDED): {unknown}")
    return ways, coords


def bake() -> dict:
    ways, coords = load_osm()
    nodes, edges, geoms = build_graph(ways, coords)
    d = GEOM_DECIMALS
    vertices_in = sum(len(g) for g in geoms)

    def encode(gs) -> str:
        return json.dumps(
            {
                "nodes": [[round(lon, d), round(lat, d)] for lon, lat in nodes],
                "edges": [[u, v, round(length, 1), cls] for u, v, length, cls in edges],
                "geoms": [[[round(lon, d), round(lat, d)] for lon, lat in g] for g in gs],
            },
            separators=(",", ":"),
        )

    text = encode(geoms)
    simplified = len(text) > MAX_BYTES
    if simplified:
        geoms = [simplify(g, SIMPLIFY_TOL_M) for g in geoms]
        text = encode(geoms)
    path = grid.OUT_DIR / "roads.json"
    path.write_text(text)
    hist = Counter(cls for *_, cls in edges)
    names = ["MOTORWAY", "PRIMARY", "SECONDARY", "TERTIARY", "LOCAL", "PATH"]
    km = {names[c]: 0.0 for c in range(6)}
    for _, _, length, cls in edges:
        km[names[cls]] += length / 1000
    return {
        "nodes": len(nodes),
        "edges": len(edges),
        "edges_by_class": {names[c]: hist.get(c, 0) for c in range(6)},
        "km_by_class": {k: round(v, 1) for k, v in km.items()},
        "bytes": path.stat().st_size,
        "geometry_vertices": f"{sum(len(g) for g in geoms)} of {vertices_in}"
        + (f" (Douglas-Peucker {SIMPLIFY_TOL_M} m, file was over {MAX_BYTES} B)" if simplified else ""),
    }
