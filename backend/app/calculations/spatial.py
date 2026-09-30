"""Analítica espacial anónima derivada de posiciones y conteos por zona.

Las métricas de este módulo describen flujo, ocupación y movimiento observado.
Nunca convierten quietud en improductividad y nunca devuelven track IDs.
"""

from bisect import bisect_right
from collections import Counter
from math import hypot, log2
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.calculations.analytics import point_in_polygon


PositionSample = Tuple[float, float, float, Optional[float]]  # t, x, y, speed_m_s
OccupancySample = Tuple[float, int, Mapping[str, int]]  # t, total, zone counts
Poly = Sequence[Sequence[float]]

POSITION_MAX_AGE_S = 10.0
OCCUPANCY_MAX_AGE_S = 12.0
MOTION_THRESHOLD_M_S = 0.15
MAX_PLAUSIBLE_SPEED_M_S = 4.5
MIN_DISTANCE_M = 0.08


def polygon_area_m2(poly: Poly, width_m: float, height_m: float) -> float:
    if len(poly) < 3:
        return 0.0
    scaled = [(float(x) * width_m, float(y) * height_m) for x, y in poly]
    return abs(
        sum(
            scaled[i][0] * scaled[(i + 1) % len(scaled)][1]
            - scaled[(i + 1) % len(scaled)][0] * scaled[i][1]
            for i in range(len(scaled))
        )
    ) / 2


def _inside_scope(x: float, y: float, scope_poly: Optional[Poly]) -> bool:
    return scope_poly is None or point_in_polygon(x, y, scope_poly)


def _motion_state(speed: Optional[float]) -> str:
    if speed is None or speed < 0 or speed > MAX_PLAUSIBLE_SPEED_M_S:
        return "unknown"
    return "stationary" if speed < MOTION_THRESHOLD_M_S else "moving"


def _derive_missing_speeds(
    positions: Mapping[str, List[PositionSample]], width_m: float, height_m: float
) -> Dict[str, List[PositionSample]]:
    out: Dict[str, List[PositionSample]] = {}
    for track, samples in positions.items():
        ordered = sorted(samples, key=lambda p: p[0])
        enriched: List[PositionSample] = []
        previous: Optional[PositionSample] = None
        for t, x, y, speed in ordered:
            derived = speed
            if derived is None and previous is not None:
                dt = t - previous[0]
                if 0.15 <= dt <= POSITION_MAX_AGE_S:
                    derived = hypot((x - previous[1]) * width_m, (y - previous[2]) * height_m) / dt
            enriched.append((t, x, y, derived))
            previous = (t, x, y, speed)
        out[track] = enriched
    return out


def _longest_streak(values: List[int], threshold: int, step_s: float) -> float:
    longest = current = 0
    for value in values:
        if value >= threshold:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return round(longest * step_s, 1)


def compute_spatial_summary(
    *,
    t0: float,
    t1: float,
    zones: List[Dict[str, Any]],
    positions: Mapping[str, List[PositionSample]],
    occupancy: Mapping[str, List[OccupancySample]],
    width_m: float,
    height_m: float,
    scope_poly: Optional[Poly] = None,
    use_occupancy_total: bool = False,
    step_s: Optional[float] = None,
) -> Dict[str, Any]:
    """Build privacy-safe spatial metrics for one plant/line/station/zone scope."""
    window_s = max(1.0, t1 - t0)
    step = float(step_s or max(1.0, window_s / 1800.0))
    sample_count = max(1, int(window_s / step))
    zones = sorted(
        zones,
        key=lambda z: ({"work": 0, "storage": 1, "transit": 2}.get(z.get("type"), 3), z.get("zone_id", "")),
    )
    zone_ids = {str(z["zone_id"]) for z in zones}
    zone_by_id = {str(z["zone_id"]): z for z in zones}
    private_ids = {str(z["zone_id"]) for z in zones if z.get("is_aggregated_only")}

    enriched = _derive_missing_speeds(positions, width_m, height_m)
    track_times = {track: [p[0] for p in samples] for track, samples in enriched.items()}
    occupancy_sorted = {source: sorted(samples, key=lambda p: p[0]) for source, samples in occupancy.items()}
    occupancy_times = {source: [p[0] for p in samples] for source, samples in occupancy_sorted.items()}

    zone_person_s = Counter({zid: 0.0 for zid in zone_ids})
    zone_occupied_s = Counter({zid: 0.0 for zid in zone_ids})
    zone_stationary_s = Counter({zid: 0.0 for zid in zone_ids})
    zone_moving_s = Counter({zid: 0.0 for zid in zone_ids})
    zone_unknown_s = Counter({zid: 0.0 for zid in zone_ids})
    zone_visits = Counter({zid: 0 for zid in zone_ids})
    zone_series: Dict[str, List[int]] = {zid: [] for zid in zone_ids}
    zone_last_count = Counter({zid: 0 for zid in zone_ids})
    transitions: Counter[Tuple[str, str]] = Counter()
    last_zone: Dict[str, Optional[str]] = {}
    last_seen: Dict[str, float] = {}
    sequences: Dict[str, List[str]] = {}
    backtracks = 0

    observed_samples = 0
    scope_person_s = 0.0
    stationary_s = moving_s = unknown_s = 0.0
    scope_series: List[int] = []
    last_observed_at: Optional[float] = None
    current_people = 0

    for sample_idx in range(sample_count):
        t = min(t1, t0 + (sample_idx + 0.5) * step)
        track_counts = Counter()
        track_states: Dict[str, Counter[str]] = {zid: Counter() for zid in zone_ids}
        live_tracks: Dict[str, Tuple[float, float, Optional[float], Optional[str]]] = {}

        for track, times in track_times.items():
            idx = bisect_right(times, t) - 1
            if idx < 0 or t - times[idx] > POSITION_MAX_AGE_S:
                continue
            _, x, y, speed = enriched[track][idx]
            if not _inside_scope(x, y, scope_poly):
                continue
            zone_id = next(
                (str(z["zone_id"]) for z in zones if point_in_polygon(x, y, z["polygon"])),
                None,
            )
            live_tracks[track] = (x, y, speed, zone_id)
            if zone_id:
                track_counts[zone_id] += 1
                track_states[zone_id][_motion_state(speed)] += 1

        aggregate_counts: Counter[str] = Counter()
        aggregate_total = 0
        aggregate_fresh = False
        for source, times in occupancy_times.items():
            idx = bisect_right(times, t) - 1
            if idx < 0 or t - times[idx] > OCCUPANCY_MAX_AGE_S:
                continue
            aggregate_fresh = True
            _, total, counts = occupancy_sorted[source][idx]
            aggregate_total += max(0, int(total))
            for zone_id, count in counts.items():
                if str(zone_id) in zone_ids:
                    aggregate_counts[str(zone_id)] += max(0, int(count))

        observed = aggregate_fresh or bool(live_tracks)
        if not observed:
            for zid in zone_ids:
                zone_series[zid].append(0)
            scope_series.append(0)
            continue

        observed_samples += 1
        last_observed_at = t
        counts = aggregate_counts if aggregate_fresh else track_counts
        if aggregate_fresh:
            scope_count = aggregate_total if use_occupancy_total else sum(counts.values())
        else:
            scope_count = len(live_tracks)
        current_people = scope_count
        scope_series.append(scope_count)
        scope_person_s += scope_count * step

        for zid in zone_ids:
            count = max(0, int(counts.get(zid, 0)))
            zone_last_count[zid] = count
            zone_series[zid].append(count)
            zone_person_s[zid] += count * step
            if count:
                zone_occupied_s[zid] += step

            state_counts = track_states[zid]
            stationary = min(count, int(state_counts.get("stationary", 0)))
            moving = min(max(0, count - stationary), int(state_counts.get("moving", 0)))
            unknown = max(0, count - stationary - moving)
            if zid in private_ids:
                stationary, moving, unknown = 0, 0, count
            zone_stationary_s[zid] += stationary * step
            zone_moving_s[zid] += moving * step
            zone_unknown_s[zid] += unknown * step

        # El reparto global incluye tracks fuera de una zona dibujada. Cuando el
        # conteo agregado y los tracks no coinciden, la diferencia queda como
        # movimiento desconocido en vez de inventar una clasificación.
        global_states = Counter(
            "unknown" if zone_id in private_ids else _motion_state(speed)
            for _x, _y, speed, zone_id in live_tracks.values()
        )
        sample_stationary = min(scope_count, int(global_states.get("stationary", 0)))
        sample_moving = min(max(0, scope_count - sample_stationary), int(global_states.get("moving", 0)))
        sample_unknown = max(0, scope_count - sample_stationary - sample_moving)
        stationary_s += sample_stationary * step
        moving_s += sample_moving * step
        unknown_s += sample_unknown * step

        # Visitas y rutas se agregan, nunca se publican secuencias o IDs.
        for track, (_x, _y, _speed, zid) in live_tracks.items():
            if t - last_seen.get(track, t) > OCCUPANCY_MAX_AGE_S * 2:
                last_zone[track] = None
                sequences[track] = []
            # Una zona sensible corta la secuencia. Así nunca se publica una
            # transición aparente A→B que en realidad atravesó esa zona.
            if zid in private_ids:
                last_zone[track] = None
                sequences[track] = []
                last_seen[track] = t
                continue
            previous = last_zone.get(track)
            if zid and zid != previous:
                if zid not in private_ids:
                    zone_visits[zid] += 1
                if previous and previous not in private_ids and zid not in private_ids:
                    transitions[(previous, zid)] += 1
                    seq = sequences.setdefault(track, [])
                    if len(seq) >= 2 and seq[-2] == zid:
                        backtracks += 1
                    seq.append(zid)
                    sequences[track] = seq[-20:]
                elif zid not in private_ids:
                    sequences[track] = [zid]
                last_zone[track] = zid
            last_seen[track] = t

    observed_s = min(window_s, observed_samples * step)
    coverage_pct = round(100 * observed_s / window_s, 1)

    # Distancia agregada: filtra jitter, teletransportes, zonas privadas y huecos.
    distance_m = 0.0
    for samples in enriched.values():
        previous: Optional[PositionSample] = None
        for point in samples:
            t, x, y, _speed = point
            if not (t0 <= t <= t1):
                previous = point
                continue
            if previous is not None:
                pt, px, py, _ = previous
                dt = t - pt
                private = any(point_in_polygon(x, y, zone_by_id[zid]["polygon"]) for zid in private_ids)
                previous_private = any(point_in_polygon(px, py, zone_by_id[zid]["polygon"]) for zid in private_ids)
                if (
                    0 < dt <= POSITION_MAX_AGE_S
                    and _inside_scope(x, y, scope_poly)
                    and _inside_scope(px, py, scope_poly)
                    and not private
                    and not previous_private
                ):
                    distance = hypot((x - px) * width_m, (y - py) * height_m)
                    if distance >= MIN_DISTANCE_M and distance / dt <= MAX_PLAUSIBLE_SPEED_M_S:
                        distance_m += distance
            previous = point

    zone_rows: List[Dict[str, Any]] = []
    total_excess_person_s = 0.0
    total_congested_s = 0.0
    peak_density = 0.0
    for zone in zones:
        zid = str(zone["zone_id"])
        person_s = float(zone_person_s[zid])
        area_m2 = polygon_area_m2(zone["polygon"], width_m, height_m)
        peak = max(zone_series[zid], default=0)
        capacity = zone.get("max_capacity")
        excess_person_s = 0.0
        congested_s = 0.0
        if capacity is not None and int(capacity) >= 0:
            excess_person_s = sum(max(0, count - int(capacity)) * step for count in zone_series[zid])
            congested_s = sum(step for count in zone_series[zid] if count > int(capacity))
        total_excess_person_s += excess_person_s
        total_congested_s += congested_s
        peak_density = max(peak_density, peak / area_m2 if area_m2 > 0 else 0)
        denom = person_s or 1.0
        threshold = int(capacity) + 1 if capacity is not None and peak > int(capacity) else max(1, peak)
        zone_rows.append({
            "zone_id": zid,
            "name": zone.get("name", zid),
            "type": zone.get("type", "work"),
            "line_id": zone.get("line_id"),
            "current_count": int(zone_last_count[zid]),
            "average_occupancy": round(person_s / observed_s, 2) if observed_s else 0.0,
            "peak_occupancy": peak,
            "person_minutes": round(person_s / 60, 2),
            "occupied_pct": round(100 * zone_occupied_s[zid] / observed_s, 1) if observed_s else 0.0,
            "stationary_pct": round(100 * zone_stationary_s[zid] / denom, 1),
            "moving_pct": round(100 * zone_moving_s[zid] / denom, 1),
            "unknown_motion_pct": round(100 * zone_unknown_s[zid] / denom, 1),
            "visits": None if zid in private_ids else int(zone_visits[zid]),
            "visits_per_hour": None if zid in private_ids or observed_s == 0 else round(zone_visits[zid] * 3600 / observed_s, 1),
            "area_m2": round(area_m2, 2),
            "peak_density_person_m2": round(peak / area_m2, 3) if area_m2 > 0 else 0.0,
            "max_capacity": capacity,
            "congested_seconds": round(congested_s, 1),
            "excess_person_minutes": round(excess_person_s / 60, 2),
            "sustained_peak_seconds": _longest_streak(zone_series[zid], threshold, step) if peak else 0.0,
            "is_aggregated_only": bool(zone.get("is_aggregated_only")),
        })

    zone_rows.sort(key=lambda z: (-z["person_minutes"], z["name"]))
    top_dwell = zone_rows[0] if zone_rows and zone_rows[0]["person_minutes"] > 0 else None
    congestion_candidates = [z for z in zone_rows if z["peak_occupancy"] > 0]
    max_congestion = max(
        congestion_candidates,
        key=lambda z: (
            z["peak_occupancy"] > (z["max_capacity"] if z["max_capacity"] is not None else 10**9),
            z["excess_person_minutes"],
            z["peak_density_person_m2"],
            z["peak_occupancy"],
        ),
        default=None,
    )

    transition_rows = [
        {
            "from_zone_id": origin,
            "from_name": zone_by_id[origin].get("name", origin),
            "to_zone_id": destination,
            "to_name": zone_by_id[destination].get("name", destination),
            "count": count,
        }
        for (origin, destination), count in transitions.most_common(20)
    ]
    total_transitions = sum(transitions.values())
    top_route_share = round(100 * transition_rows[0]["count"] / total_transitions, 1) if transition_rows and total_transitions else 0.0
    if len(transitions) > 1 and total_transitions:
        entropy = -sum((count / total_transitions) * log2(count / total_transitions) for count in transitions.values())
        entropy_pct = round(100 * entropy / log2(len(transitions)), 1)
    else:
        entropy_pct = 0.0
    public_zones = [z for z in zone_rows if not z["is_aggregated_only"]]
    active_public = sum(1 for z in public_zones if z["person_minutes"] > 0)

    freshness_age = None if last_observed_at is None else max(0.0, t1 - last_observed_at)
    is_fresh = freshness_age is not None and freshness_age <= OCCUPANCY_MAX_AGE_S
    if not is_fresh:
        for zone in zone_rows:
            zone["current_count"] = None
    summary: Dict[str, Any] = {
        "current_people": current_people if is_fresh else None,
        "average_occupancy": round(scope_person_s / observed_s, 2) if observed_s else 0.0,
        "peak_occupancy": max(scope_series, default=0),
        "observed_person_minutes": round(scope_person_s / 60, 2),
        "stationary_pct": round(100 * stationary_s / scope_person_s, 1) if scope_person_s else 0.0,
        "moving_pct": round(100 * moving_s / scope_person_s, 1) if scope_person_s else 0.0,
        "unknown_motion_pct": round(100 * unknown_s / scope_person_s, 1) if scope_person_s else 0.0,
        "coverage_pct": coverage_pct,
        "fresh": is_fresh,
        "last_observation_age_seconds": round(freshness_age, 1) if freshness_age is not None else None,
        "top_dwell_zone": None if top_dwell is None else {
            "zone_id": top_dwell["zone_id"], "name": top_dwell["name"], "person_minutes": top_dwell["person_minutes"]
        },
        "max_congestion": None if max_congestion is None else {
            "zone_id": max_congestion["zone_id"],
            "name": max_congestion["name"],
            "people": max_congestion["peak_occupancy"],
            "capacity": max_congestion["max_capacity"],
            "sustained_seconds": max_congestion["sustained_peak_seconds"],
            "over_capacity": max_congestion["max_capacity"] is not None
            and max_congestion["peak_occupancy"] > max_congestion["max_capacity"],
        },
        "distance_m": round(distance_m, 1),
        "distance_per_person_hour_m": round(distance_m / (scope_person_s / 3600), 1) if scope_person_s >= 60 else None,
        "total_transitions": total_transitions,
        "route_concentration_pct": top_route_share,
        "transition_entropy_pct": entropy_pct,
        "backtrack_ratio_pct": round(100 * backtracks / total_transitions, 1) if total_transitions else 0.0,
        "zone_utilization_pct": round(100 * active_public / len(public_zones), 1) if public_zones else 0.0,
        "congestion_excess_person_minutes": round(total_excess_person_s / 60, 2),
        "congested_seconds": round(total_congested_s, 1),
        "peak_density_person_m2": round(peak_density, 3),
    }
    return {
        "step_s": round(step, 3),
        "summary": summary,
        "zones": zone_rows,
        "transitions": transition_rows,
    }


def build_spatial_insights(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Produce explainable observations; suggestions are checks, not causal claims."""
    summary = result["summary"]
    zones = result["zones"]
    insights: List[Dict[str, Any]] = []

    def add(
        insight_id: str,
        tone: str,
        priority: int,
        title: str,
        observation: str,
        evidence: str,
        suggestion: str,
        *,
        scope_id: Optional[str] = None,
        layer: str = "zones",
    ) -> None:
        insights.append({
            "id": insight_id,
            "tone": tone,
            "priority": priority,
            "title": title,
            "observation": observation,
            "evidence": evidence,
            "suggestion": suggestion,
            "scope_type": "zone" if scope_id else "plant",
            "scope_id": scope_id,
            "layer": layer,
        })

    if summary["coverage_pct"] < 40:
        add(
            "coverage-critical", "attention", 100, "Cobertura espacial insuficiente",
            "No hay observaciones suficientes para interpretar la ventana con confianza.",
            f"Cobertura válida: {summary['coverage_pct']:.0f}%.",
            "Revisar la cámara, el proveedor de visión y la conexión con el backend antes de tomar decisiones.",
        )
    elif summary["coverage_pct"] < 80:
        add(
            "coverage-partial", "attention", 80, "Cobertura parcial",
            "Una parte de la ventana quedó sin información espacial reciente.",
            f"Cobertura válida: {summary['coverage_pct']:.0f}%.",
            "Confirmar continuidad del stream y considerar la cobertura al comparar periodos.",
        )

    congested = [z for z in zones if z["max_capacity"] is not None and z["peak_occupancy"] > z["max_capacity"]]
    if congested:
        zone = max(congested, key=lambda z: (z["excess_person_minutes"], z["peak_occupancy"]))
        add(
            f"capacity-{zone['zone_id']}", "attention", 95, f"Capacidad superada en {zone['name']}",
            "La ocupación rebasó la capacidad configurada durante la ventana.",
            f"Pico {zone['peak_occupancy']} personas; capacidad {zone['max_capacity']}; {zone['congested_seconds']:.0f} s sobre el límite.",
            "Validar si existe una espera, cruce de flujos o restricción de seguridad; no atribuir una causa sin observar el proceso.",
            scope_id=zone["zone_id"], layer="dwell",
        )

    stationary_support = [
        z for z in zones
        if z["type"] in ("transit", "storage") and z["person_minutes"] >= 1 and z["stationary_pct"] >= 55
    ]
    if stationary_support:
        zone = max(stationary_support, key=lambda z: z["stationary_pct"] * z["person_minutes"])
        add(
            f"stationary-{zone['zone_id']}", "attention", 75, f"Quietud observada en {zone['name']}",
            "Se concentró permanencia con baja velocidad en una zona de apoyo o tránsito.",
            f"{zone['stationary_pct']:.0f}% del tiempo-persona observado; {zone['person_minutes']:.1f} persona·min.",
            "Revisar abastecimiento, señalización, búsqueda de material o diseño del paso. La quietud por sí sola no indica improductividad.",
            scope_id=zone["zone_id"], layer="dwell",
        )

    repeated_storage = [z for z in zones if z["type"] == "storage" and (z["visits"] or 0) >= 5]
    if repeated_storage:
        zone = max(repeated_storage, key=lambda z: z["visits"] or 0)
        add(
            f"visits-{zone['zone_id']}", "attention", 70, f"Visitas repetidas a {zone['name']}",
            "La zona recibió múltiples entradas en la ventana seleccionada.",
            f"{zone['visits']} entradas; {zone['visits_per_hour']:.1f} por hora observada.",
            "Comparar con consumo de materiales y secuencia de trabajo para evaluar un posible punto de suministro más cercano.",
            scope_id=zone["zone_id"], layer="routes",
        )

    if summary["total_transitions"] >= 6 and summary["backtrack_ratio_pct"] >= 25:
        add(
            "backtracking", "attention", 68, "Retornos frecuentes entre zonas",
            "Una proporción relevante de los cambios de zona regresó al origen inmediato.",
            f"{summary['backtrack_ratio_pct']:.0f}% de {summary['total_transitions']} transiciones fueron A→B→A.",
            "Revisar secuencia, ubicación de herramientas/materiales y excepciones del proceso antes de proponer un cambio de layout.",
            layer="routes",
        )

    if summary.get("top_dwell_zone"):
        top = summary["top_dwell_zone"]
        add(
            f"top-dwell-{top['zone_id']}", "info", 45, f"Mayor permanencia: {top['name']}",
            "Esta zona concentró el mayor tiempo-persona de la ventana.",
            f"{top['person_minutes']:.1f} persona·min acumulados.",
            "Comparar con el propósito de la zona, el turno anterior y la producción obtenida.",
            scope_id=top["zone_id"], layer="dwell",
        )

    if summary["coverage_pct"] >= 80 and not congested:
        add(
            "capacity-ok", "good", 20, "Sin sobrecapacidad configurada",
            "No se detectaron zonas por encima de sus límites definidos.",
            f"Cobertura válida: {summary['coverage_pct']:.0f}%.",
            "Mantener la observación y comparar contra otros turnos antes de establecer una línea base.",
            layer="zones",
        )

    return sorted(insights, key=lambda item: (-item["priority"], item["title"]))[:6]
