from typing import Dict, Any, Optional

def calculate_station_productivity(
    operating_time_seconds: float,
    adjusted_planned_seconds: float,
    parts_produced_good: Optional[int] = None,
    parts_produced_total: Optional[int] = None,
    ideal_cycle_seconds: Optional[float] = None
) -> Dict[str, Any]:
    """
    Strict calculation of availability and partial / complete OEE.
    Does NOT call an incomplete metric 'OEE'.
    If good pieces count, total count, or ideal cycle time are absent:
      - Marks status as 'partial'
      - Sets metric name as 'Disponibilidad / Productividad Parcial'
      - Explicitly explains the formula and denominator.
    """
    if adjusted_planned_seconds <= 0:
        return {
            "status": "insufficient_time",
            "metric_name": "Disponibilidad no calculable (Tiempo planificado ajustado = 0)",
            "availability": 0.0,
            "performance": None,
            "quality": None,
            "oee": None,
            "formula": "Tiempo Operativo / Tiempo Planificado Ajustado",
            "numerator_sec": operating_time_seconds,
            "denominator_sec": adjusted_planned_seconds,
            "is_full_oee": False
        }

    # Availability = Operating Time / Adjusted Planned Time
    availability = min(1.0, max(0.0, operating_time_seconds / adjusted_planned_seconds))

    # Check if we have complete data for Performance & Quality
    has_performance = (
        parts_produced_total is not None and
        parts_produced_total >= 0 and
        ideal_cycle_seconds is not None and
        ideal_cycle_seconds > 0 and
        operating_time_seconds > 0
    )

    has_quality = (
        parts_produced_good is not None and
        parts_produced_total is not None and
        parts_produced_total > 0 and
        parts_produced_good <= parts_produced_total
    )

    if has_performance and has_quality:
        performance = min(1.0, max(0.0, (parts_produced_total * ideal_cycle_seconds) / operating_time_seconds))
        quality = min(1.0, max(0.0, parts_produced_good / parts_produced_total))
        oee = availability * performance * quality
        return {
            "status": "complete_oee",
            "metric_name": "OEE (Efectividad Global de Equipos)",
            "availability": round(availability * 100, 2),
            "performance": round(performance * 100, 2),
            "quality": round(quality * 100, 2),
            "oee": round(oee * 100, 2),
            "formula": "Disponibilidad (T_op/T_plan_adj) x Rendimiento (Total*Ideal/T_op) x Calidad (Buenas/Total)",
            "numerator_sec": operating_time_seconds,
            "denominator_sec": adjusted_planned_seconds,
            "is_full_oee": True
        }
    else:
        # Partial metrics
        missing = []
        if not has_performance:
            missing.append("conteo de piezas producidas / tiempo de ciclo ideal")
        if not has_quality:
            missing.append("clasificación de piezas buenas vs defectos")

        return {
            "status": "partial_availability",
            "metric_name": "Disponibilidad Operativa Parcial",
            "availability": round(availability * 100, 2),
            "performance": None,
            "quality": None,
            "oee": None,
            "formula": "Tiempo Productivo / Tiempo Planificado Ajustado (Sin paro autorizado)",
            "numerator_sec": operating_time_seconds,
            "denominator_sec": adjusted_planned_seconds,
            "is_full_oee": False,
            "missing_for_oee": missing,
            "note": f"Para calcular OEE completo se requiere telemetría de: {', '.join(missing)}."
        }
