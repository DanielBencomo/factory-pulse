"""
Analítica de línea reconstruida a partir de eventos.

Para cada estación y cada instante de una rejilla regular se decide un estado:

  paro        hay un paro justificado que cubre a la estación (línea, estación o planta)
  ausencia    ningún track de la cámara está dentro de la zona de la estación
  presente    hay alguien, pero la estación no tiene sensor de proceso: no se sabe si produce
  productivo  hay alguien y la máquina reporta marcha o hubo un ciclo reciente
  espera      hay alguien, hay sensor de proceso y no hay marcha ni ciclo
  sin_datos   la cámara no reportó ningún track: no se sabe si hay alguien

"Presente" existe a propósito: estar en la estación no prueba que se produzca
(regla crítica del documento del proyecto), así que sin dato de proceso no se afirma.
"""
from bisect import bisect_right
from math import ceil, hypot
from typing import Any, Dict, List, Optional, Sequence, Tuple

STATES = ["productivo", "espera", "presente", "ausencia", "paro", "sin_datos"]
UNAVAILABLE = ("paro", "sin_datos")  # no cuentan como tiempo disponible

POSITION_MAX_AGE = 10.0   # s: una posición más vieja ya no describe el presente
PRESENCE_MAX_AGE = 30.0   # s: vigencia de un evento de presencia (PIR / CSI)
MACHINE_MAX_AGE = 90.0    # s: vigencia de un evento machine_state
Poly = Sequence[Sequence[float]]


def point_in_polygon(x: float, y: float, poly: Poly) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _bbox(poly: Poly) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def pick_bucket_seconds(window_s: float) -> int:
    for b in (60, 120, 300, 600, 900, 1800, 3600):
        if window_s / b <= 24:
            return b
    return 3600


def _union_seconds(intervals: List[Tuple[float, float]]) -> float:
    total, cur_s, cur_e = 0.0, None, None
    for s, e in sorted(intervals):
        if cur_e is None or s > cur_e:
            if cur_e is not None:
                total += cur_e - cur_s
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e is not None:
        total += cur_e - cur_s
    return total


def compute_line_analytics(
    *,
    t0: float,
    t1: float,
    stations: List[Dict[str, Any]],
    positions: Dict[str, List[Tuple[float, float, float]]],
    machine: Dict[str, List[Tuple[float, str]]],
    cycles: Dict[str, List[Tuple[float, float, bool]]],
    stops: List[Dict[str, Any]],
    line_area: Optional[Poly],
    m_per_x: float,
    m_per_y: float,
    step_s: Optional[float] = None,
    bucket_s: Optional[int] = None,
    presence: Optional[Dict[str, List[Tuple[float, bool]]]] = None,
    zones: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    stations: [{station_id, name, order, ideal_cycle, target_pph, polygon}], ordenadas por flujo
    positions: {track_id: [(t, x, y)]} ordenado por t (x, y normalizados)
    machine: {station_id: [(t, "running"|"idle")]}; cycles: {station_id: [(t, cycle_s, good)]}
    stops: [{start, end, authorized, reason, station_ids: set | None}] (None = toda la línea)
    presence: {station_id: [(t, presente)]} de PIR o CSI; complementa a la cámara
    zones: [{zone_id, name, type, polygon, is_aggregated_only}] para el tiempo por zona
    Tiempos en segundos epoch.
    """
    window = max(1.0, t1 - t0)
    step = step_s or max(5.0, window / 720)
    bucket = bucket_s or pick_bucket_seconds(window)
    n = int(window // step)
    nb = int(ceil(window / bucket))

    track_times = {k: [p[0] for p in v] for k, v in positions.items()}
    mach_times = {k: [m[0] for m in v] for k, v in machine.items()}
    cyc_times = {k: [c[0] for c in v] for k, v in cycles.items()}
    boxes = {s["station_id"]: _bbox(s["polygon"]) for s in stations}
    has_process = {
        s["station_id"]: bool(mach_times.get(s["station_id"])) or bool(cyc_times.get(s["station_id"])) for s in stations
    }
    auth_stops = [st for st in stops if st.get("authorized", True)]
    presence = presence or {}
    pres_times = {k: [p[0] for p in v] for k, v in presence.items()}
    zones = zones or []
    zone_boxes = {z["zone_id"]: _bbox(z["polygon"]) for z in zones}
    zone_person_s = {z["zone_id"]: 0.0 for z in zones}
    zone_occupied_s = {z["zone_id"]: 0.0 for z in zones}
    zone_visits = {z["zone_id"]: 0 for z in zones}
    inside_prev: Dict[Tuple[str, str], bool] = {}

    seconds = {s["station_id"]: {k: 0.0 for k in STATES} for s in stations}
    segments: Dict[str, List[List[Any]]] = {s["station_id"]: [] for s in stations}

    for k in range(n):
        t = t0 + (k + 0.5) * step
        # posición vigente de cada track
        live_pts = []
        live_ids = []
        for trk, times in track_times.items():
            i = bisect_right(times, t) - 1
            if i >= 0 and t - times[i] <= POSITION_MAX_AGE:
                _, x, y = positions[trk][i]
                live_pts.append((x, y))
                live_ids.append(trk)

        # Tiempo por zona (persona·segundo, ocupación y entradas)
        for z in zones:
            zid = z["zone_id"]
            zx0, zy0, zx1, zy1 = zone_boxes[zid]
            count = 0
            for trk, (x, y) in zip(live_ids, live_pts):
                inside = zx0 <= x <= zx1 and zy0 <= y <= zy1 and point_in_polygon(x, y, z["polygon"])
                if inside:
                    count += 1
                    if not inside_prev.get((trk, zid)):
                        zone_visits[zid] += 1
                inside_prev[(trk, zid)] = inside
            zone_person_s[zid] += step * count
            if count:
                zone_occupied_s[zid] += step

        for s in stations:
            sid = s["station_id"]
            if any(st["start"] <= t < st["end"] and (st["station_ids"] is None or sid in st["station_ids"]) for st in auth_stops):
                state = "paro"
            else:
                # Presencia por PIR/CSI vigente (si la estación tiene uno)
                pt = pres_times.get(sid, [])
                pi = bisect_right(pt, t) - 1
                pres_known = pi >= 0 and t - pt[pi] <= PRESENCE_MAX_AGE
                x0, y0, x1, y1 = boxes[sid]
                in_zone = any(x0 <= x <= x1 and y0 <= y <= y1 and point_in_polygon(x, y, s["polygon"]) for x, y in live_pts)
                present = in_zone or (pres_known and presence[sid][pi][1])
                if not live_pts and not pres_known:
                    # Ni cámara ni sensor de presencia reportando: no es ausencia, es falta de datos.
                    state = "sin_datos"
                elif not present:
                    state = "ausencia"
                elif not has_process[sid]:
                    state = "presente"
                else:
                    running = False
                    mt = mach_times.get(sid, [])
                    i = bisect_right(mt, t) - 1
                    if i >= 0 and t - mt[i] <= MACHINE_MAX_AGE:
                        running = machine[sid][i][1] == "running"
                    if not running:
                        ct = cyc_times.get(sid, [])
                        j = bisect_right(ct, t) - 1
                        running = j >= 0 and t - ct[j] <= max(2 * s["ideal_cycle"], 60.0)
                    state = "productivo" if running else "espera"

            seconds[sid][state] += step
            seg = segments[sid]
            start_ms = int((t0 + k * step) * 1000)
            end_ms = int((t0 + (k + 1) * step) * 1000)
            if seg and seg[-1][2] == state and seg[-1][1] == start_ms:
                seg[-1][1] = end_ms
            else:
                seg.append([start_ms, end_ms, state])

    # Piezas por intervalo
    hours = window / 3600
    output_by_bucket: Dict[str, List[int]] = {}
    per_station = []
    for s in stations:
        sid = s["station_id"]
        counts = [0] * nb
        cyc = [c for c in cycles.get(sid, []) if t0 <= c[0] <= t1]
        for c in cyc:
            counts[min(nb - 1, int((c[0] - t0) // bucket))] += 1
        output_by_bucket[sid] = counts
        pieces = len(cyc)
        good = sum(1 for c in cyc if c[2])
        # El ritmo se mide sobre el tiempo en que la estación pudo producir.
        available_h = sum(v for k, v in seconds[sid].items() if k not in UNAVAILABLE) / 3600
        per_station.append({
            "station_id": sid,
            "name": s["name"],
            "order": s["order"],
            "seconds": {k: round(v, 1) for k, v in seconds[sid].items()},
            "has_process_data": has_process[sid],
            "pieces": pieces,
            "good_pct": round(100 * good / pieces, 1) if pieces else None,
            "pieces_per_hour": round(pieces / available_h, 1) if available_h > 0.01 else 0,
            "available_s": round(available_h * 3600, 1),
            "target_pph": s["target_pph"],
            "avg_cycle_s": round(sum(c[1] for c in cyc) / pieces, 1) if pieces else None,
            "ideal_cycle_s": s["ideal_cycle"],
        })

    # Distancia caminada dentro del área de la línea
    distance_by_bucket: Dict[str, List[float]] = {}
    if line_area:
        ax0, ay0, ax1, ay1 = _bbox(line_area)

        def inside(x, y):
            return ax0 <= x <= ax1 and ay0 <= y <= ay1 and point_in_polygon(x, y, line_area)

        for trk, pts in positions.items():
            acc = [0.0] * nb
            prev = None
            for p in pts:
                if not (t0 <= p[0] <= t1):
                    prev = p
                    continue
                if prev and p[0] - prev[0] <= POSITION_MAX_AGE and inside(p[1], p[2]) and inside(prev[1], prev[2]):
                    acc[min(nb - 1, int((p[0] - t0) // bucket))] += hypot((p[1] - prev[1]) * m_per_x, (p[2] - prev[2]) * m_per_y)
                prev = p
            if any(acc):
                distance_by_bucket[trk] = [round(a, 1) for a in acc]

    # Paros: Pareto por causa y tiempo total (unión, sin doble conteo)
    pareto: Dict[str, Dict[str, float]] = {}
    clipped = []
    for st in stops:
        s_, e_ = max(st["start"], t0), min(st["end"], t1)
        if e_ <= s_:
            continue
        clipped.append((s_, e_))
        r = pareto.setdefault(st["reason"], {"minutes": 0.0, "count": 0})
        r["minutes"] += (e_ - s_) / 60
        r["count"] += 1
    stops_pareto = sorted(
        ({"reason": k, "minutes": round(v["minutes"], 1), "count": int(v["count"])} for k, v in pareto.items()),
        key=lambda r: -r["minutes"],
    )

    totals = {k: sum(seconds[s["station_id"]][k] for s in stations) for k in STATES}
    available = sum(v for k, v in totals.items() if k not in UNAVAILABLE)
    last = per_station[-1] if per_station else None
    # Solo compite por "cuello de botella" quien tuvo tiempo real para producir.
    measured = [p for p in per_station if p["has_process_data"] and p["available_s"] >= 60]
    bottleneck = min(measured, key=lambda p: p["pieces_per_hour"]) if measured else None

    return {
        "window": {"start_ms": int(t0 * 1000), "end_ms": int(t1 * 1000), "step_s": step, "bucket_s": bucket},
        "states": STATES,
        "summary": {
            "seconds": {k: round(v, 1) for k, v in totals.items()},
            "available_s": round(available, 1),
            "pct_of_available": {k: (round(100 * totals[k] / available, 1) if available else 0.0) for k in STATES if k not in UNAVAILABLE},
            "stops_minutes": round(_union_seconds(clipped) / 60, 1),
            "line_output": last["pieces"] if last else 0,
            "line_output_target": round((last["target_pph"] * last["available_s"] / 3600) if last else 0, 1),
            "bottleneck_station_id": bottleneck["station_id"] if bottleneck else None,
            "distance_m": round(sum(sum(v) for v in distance_by_bucket.values()), 1),
            "has_position_data": any(positions.values()),
            "has_process_data": any(p["has_process_data"] for p in per_station),
        },
        "stations": per_station,
        "timeline": [{"station_id": s["station_id"], "segments": segments[s["station_id"]]} for s in stations],
        "buckets_ms": [int((t0 + i * bucket) * 1000) for i in range(nb)],
        "output_by_bucket": output_by_bucket,
        "line_output_by_bucket": output_by_bucket[last["station_id"]] if last else [],
        "line_target_per_bucket": round((last["target_pph"] if last else 0) * bucket / 3600, 2),
        "distance_by_bucket": distance_by_bucket,
        "stops_pareto": stops_pareto,
        "zone_dwell": sorted(
            (
                {
                    "zone_id": z["zone_id"], "name": z["name"], "type": z["type"],
                    "person_s": round(zone_person_s[z["zone_id"]], 1),
                    "occupied_s": round(zone_occupied_s[z["zone_id"]], 1),
                    # en zonas privadas solo se reporta el agregado, sin conteo de entradas
                    "visits": None if z.get("is_aggregated_only") else zone_visits[z["zone_id"]],
                    "is_aggregated_only": bool(z.get("is_aggregated_only")),
                }
                for z in zones
            ),
            key=lambda r: -r["person_s"],
        ),
    }
