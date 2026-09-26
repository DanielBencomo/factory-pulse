from typing import List, Tuple, Dict, Any, Optional
from datetime import datetime

def compute_interval_union(intervals: List[Tuple[datetime, datetime]]) -> List[Tuple[datetime, datetime]]:
    """
    Computes the mathematical union of closed/semi-closed time intervals.
    Merges overlapping or adjacent intervals [A, B] U [C, D] -> [A, max(B, D)] if C <= B.
    Guarantees:
    - Never double-subtracts overlapping stops.
    - Resulting intervals are sorted and strictly disjoint.
    """
    if not intervals:
        return []

    # Sort intervals by start time
    valid_intervals = []
    for start, end in intervals:
        if end >= start:
            valid_intervals.append((start, end))
        else:
            # Handle inverted interval safely
            valid_intervals.append((end, start))

    if not valid_intervals:
        return []

    sorted_intervals = sorted(valid_intervals, key=lambda x: x[0])
    merged: List[Tuple[datetime, datetime]] = []
    
    current_start, current_end = sorted_intervals[0]

    for start, end in sorted_intervals[1:]:
        if start <= current_end:
            # Overlapping or contiguous interval -> extend current interval
            current_end = max(current_end, end)
        else:
            # Disjoint interval -> push previous and start new
            merged.append((current_start, current_end))
            current_start, current_end = start, end

    merged.append((current_start, current_end))
    return merged

def compute_total_union_duration_seconds(intervals: List[Tuple[datetime, datetime]]) -> float:
    """
    Calculates total non-overlapping duration in seconds for a list of intervals.
    """
    merged = compute_interval_union(intervals)
    total_seconds = sum((end - start).total_seconds() for start, end in merged)
    return max(0.0, total_seconds)

def partition_time_universe(
    gross_planned_seconds: float,
    authorized_stop_intervals: List[Tuple[datetime, datetime]],
    productive_raw_seconds: float,
    waiting_raw_seconds: float,
    absent_raw_seconds: float,
    unknown_raw_seconds: float
) -> Dict[str, float]:
    """
    Strict mathematical time partition conserving the universe of time:
    tiempo_planificado_bruto = tiempo_planificado_ajustado + union_paros_autorizados
    tiempo_planificado_ajustado = PRODUCTIVO + ESPERA + AUSENTE + DESCONOCIDO
    
    Prevents leakage, double counting, and guarantees non-negative balances.
    """
    authorized_stops_union_sec = compute_total_union_duration_seconds(authorized_stop_intervals)
    # Clip stops union to gross planned seconds to prevent negative adjusted time
    authorized_stops_union_sec = min(gross_planned_seconds, authorized_stops_union_sec)
    
    adjusted_planned_seconds = max(0.0, gross_planned_seconds - authorized_stops_union_sec)
    
    # Normalize the internal states within adjusted_planned_seconds
    raw_sum = productive_raw_seconds + waiting_raw_seconds + absent_raw_seconds + unknown_raw_seconds
    
    if raw_sum > 0:
        factor = adjusted_planned_seconds / raw_sum if raw_sum > adjusted_planned_seconds else 1.0
        prod = min(adjusted_planned_seconds, productive_raw_seconds * factor)
        wait = min(adjusted_planned_seconds - prod, waiting_raw_seconds * factor)
        absent = min(adjusted_planned_seconds - prod - wait, absent_raw_seconds * factor)
        unknown = max(0.0, adjusted_planned_seconds - prod - wait - absent)
    else:
        # If no telemetry at all, entire adjusted time is DESCONOCIDO
        prod = 0.0
        wait = 0.0
        absent = 0.0
        unknown = adjusted_planned_seconds

    # Conservation check
    reconstructed = prod + wait + absent + unknown
    conservation_error = abs(reconstructed - adjusted_planned_seconds)

    return {
        "gross_planned_seconds": gross_planned_seconds,
        "authorized_stops_union_seconds": authorized_stops_union_sec,
        "adjusted_planned_seconds": adjusted_planned_seconds,
        "productive_seconds": prod,
        "waiting_seconds": wait,
        "absent_seconds": absent,
        "unknown_seconds": unknown,
        "conservation_check_error_seconds": conservation_error
    }
