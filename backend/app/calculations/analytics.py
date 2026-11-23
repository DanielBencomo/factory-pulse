"""
Analítica de línea reconstruida a partir de eventos.

Para cada estación y cada instante de una rejilla regular se decide un estado:

  paro        hay un paro justificado que cubre a la estación (línea, estación o planta)
  ausencia    sensor local vigente reporta ausencia y no hay señal positiva
  presente    hay alguien, pero la estación no tiene sensor de proceso: no se sabe si produce
  productivo  hay alguien y la máquina reporta marcha o hubo un ciclo reciente
  espera      hay alguien y un estado vigente indica que la máquina no está en marcha
  sin_datos   no hay evidencia local suficiente de presencia

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
    cycles: Dict[str, List[Tuple[float, Optional[float], Optional[bool], int]]],
    stops: List[Dict[str, Any]],
    line_area: Optional[Poly],
    m_per_x: float,
    m_per_y: float,
    calibrated: bool = True,
    step_s: Optional[float] = None,
    bucket_s: Optional[int] = None,
    presence: Optional[Dict[str, List[Tuple[float, bool]]]] = None,
    zones: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    stations: [{station_id, name, order, ideal_cycle, target_pph, polygon}], ordenadas por flujo
    positions: {track_id: [(t, x, y)]} ordenado por t (x, y normalizados)
    machine: {station_id: [(t, "running"|"idle")]}; cycles: {station_id: [(t, cycle_s, good, quantity)]}
    stops: [{start, end, authorized, reason, station_ids: set | None}] (None = toda la línea)
    presence: {station_id: [(t, presente)]} de PIR o CSI; complementa a la cámara
    zones: [{zone_id, name, type, polygon, is_aggregated_only}] para el tiempo por zona
    Tiempos en segundos epoch.
    """
    window = max(1.0, t1 - t0)
    step = step_s or max(5.0, window / 720)
    bucket = bucket_s or pick_bucket_seconds(window)
    n = ceil(window / step)
    nb = int(ceil(window / bucket))

    track_times = {k: [p[0] for p in v] for k, v in positions.items()}
    mach_times = {k: [m[0] for m in v] for k, v in machine.items()}
    cyc_times = {k: [c[0] for c in v] for k, v in cycles.items()}
    boxes = {s["station_id"]: _bbox(s["polygon"]) for s in stations}
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

    has_presence_data = False
    for k in range(n):
        interval_start = t0 + k * step
        interval_end = min(t1, interval_start + step)
        duration = max(0.0, interval_end - interval_start)
        t = (interval_start + interval_end) / 2
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
            zone_person_s[zid] += duration * count
            if count:
                zone_occupied_s[zid] += duration

        for s in stations:
            sid = s["station_id"]
            if any(st["start"] <= t < st["end"] and (st["station_ids"] is None or sid in st["station_ids"]) for st in auth_stops):
                state = "paro"
            else:
                # Presencia por PIR/CSI vigente (si la estación tiene uno)
                pt = pres_times.get(sid, [])
                pi = bisect_right(pt, t) - 1
                pres_known = pi >= 0 and t - pt[pi] <= PRESENCE_MAX_AGE
                has_presence_data |= pres_known
                x0, y0, x1, y1 = boxes[sid]
                in_zone = any(x0 <= x <= x1 and y0 <= y <= y1 and point_in_polygon(x, y, s["polygon"]) for x, y in live_pts)
                present = in_zone or (pres_known and presence[sid][pi][1])
                if not present:
                    state = "ausencia" if pres_known else "sin_datos"
                else:
                    mt = mach_times.get(sid, [])
                    i = bisect_right(mt, t) - 1
                    machine_state = machine[sid][i][1] if i >= 0 and t - mt[i] <= MACHINE_MAX_AGE else None
                    ct = cyc_times.get(sid, [])
                    j = bisect_right(ct, t) - 1
                    cycle_recent = j >= 0 and t - ct[j] <= max(2 * s["ideal_cycle"], 60.0)
                    if machine_state == "running" or (machine_state is None and cycle_recent):
                        state = "productivo"
                    elif machine_state in ("idle", "fault", "stopped"):
                        state = "espera"
                    else:
                        state = "presente"

            seconds[sid][state] += duration
            seg = segments[sid]
            start_ms = int(interval_start * 1000)
            end_ms = int(interval_end * 1000)
            if seg and seg[-1][2] == state and seg[-1][1] == start_ms:
                seg[-1][1] = end_ms
            else:
                seg.append([start_ms, end_ms, state])

    # Piezas por intervalo
    output_by_bucket: Dict[str, List[Optional[int]]] = {}
    per_station = []
    for s in stations:
        sid = s["station_id"]
        counts: List[Optional[int]] = [None] * nb
        cyc = [c for c in cycles.get(sid, []) if t0 <= c[0] < t1]
        for at, _cycle, _good, quantity in cyc:
            idx = min(nb - 1, int((at - t0) // bucket))
            counts[idx] = (counts[idx] or 0) + quantity
        output_by_bucket[sid] = counts
        pieces = sum(c[3] for c in cyc)
        inspected = sum(c[3] for c in cyc if c[2] is not None)
        good = sum(c[3] for c in cyc if c[2] is True)
        durations = [c[1] for c in cyc if c[1] is not None]
        # La tasa cuenta piezas reportadas sobre los intervalos con proceso clasificado.
        process_s = seconds[sid]["productivo"] + seconds[sid]["espera"]
        available_s = sum(v for k, v in seconds[sid].items() if k not in UNAVAILABLE)
        per_station.append({
            "station_id": sid,
            "name": s["name"],
            "order": s["order"],
            "seconds": {k: round(v, 1) for k, v in seconds[sid].items()},
            "has_process_data": process_s > 0,
            "process_observed_s": round(process_s, 1),
            "pieces": pieces if cyc else None,
            "good_pct": round(100 * good / inspected, 1) if inspected else None,
            "inspected_pieces": inspected,
            "pieces_per_hour": round(pieces * 3600 / window, 1) if cyc else None,
            "available_s": round(available_s, 1),
            "target_pph": s["target_pph"],
            "avg_cycle_s": round(sum(durations) / len(durations), 1) if durations else None,
            "ideal_cycle_s": s["ideal_cycle"],
        })

    # Distancia caminada dentro del área de la línea
    distance_by_bucket: Dict[str, List[float]] = {}
    distance_measurable = False
    if line_area and calibrated:
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
                if prev and t0 <= prev[0] < p[0] and p[0] - prev[0] <= POSITION_MAX_AGE and inside(p[1], p[2]) and inside(prev[1], prev[2]):
                    distance_measurable = True
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
        if st.get('authorized', True):
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
    measured = [p for p in per_station if p["pieces_per_hour"] is not None and p["process_observed_s"] >= 60]
    bottleneck = min(measured, key=lambda p: p["pieces_per_hour"]) if len(measured) >= 2 else None

    return {
        "window": {"start_ms": int(t0 * 1000), "end_ms": int(t1 * 1000), "step_s": step, "bucket_s": bucket},
        "states": STATES,
        "summary": {
            "seconds": {k: round(v, 1) for k, v in totals.items()},
            "available_s": round(available, 1),
            "pct_of_available": {k: (round(100 * totals[k] / available, 1) if available else None) for k in STATES if k not in UNAVAILABLE},
            "stops_minutes": round(_union_seconds(clipped) / 60, 1),
            "line_output": last["pieces"] if last else None,
            "line_output_target": round(last["target_pph"] * window / 3600, 1) if last else None,
            "bottleneck_station_id": bottleneck["station_id"] if bottleneck else None,
            "distance_m": round(sum(sum(v) for v in distance_by_bucket.values()), 1) if distance_measurable else None,
            "has_presence_data": has_presence_data,
            "has_position_data": any(t0 <= p[0] < t1 for v in positions.values() for p in v),
            "coverage_pct": round(100 * (window * len(stations) - totals["sin_datos"]) / (window * len(stations)), 1) if stations else 0.0,
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
