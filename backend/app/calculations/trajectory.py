"""Continuity contract used by the analytics, viewer and vision provider."""
from math import hypot

MAX_GAP_S = 2.0
MAX_SPEED_M_S = 4.5
JITTER_M = 0.08


def trajectory_policy() -> dict[str, float]:
    return {"max_gap_s": MAX_GAP_S, "max_speed_m_s": MAX_SPEED_M_S, "jitter_m": JITTER_M}


def observed_step_m(
    dt: float, dx_m: float, dy_m: float, segment: str | None, previous_segment: str | None,
) -> float | None:
    if segment != previous_segment or not 0 < dt <= MAX_GAP_S:
        return None
    distance = hypot(dx_m, dy_m)
    return distance if distance / dt <= MAX_SPEED_M_S else None


def _cross(a, b, p) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _on_segment(a, b, p) -> bool:
    eps = 1e-9
    return abs(_cross(a, b, p)) <= eps and all(min(a[i], b[i]) - eps <= p[i] <= max(a[i], b[i]) + eps for i in (0, 1))


def in_closed_polygon(point, polygon) -> bool:
    x, y = point
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if _on_segment(a, b, point):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def _crosses_boundary(a, b, polygon, include_touch: bool) -> bool:
    return any(
        (_cross(a, b, c) * _cross(a, b, d) < 0 and _cross(c, d, a) * _cross(c, d, b) < 0)
        or (include_touch and (_on_segment(a, b, c) or _on_segment(a, b, d) or _on_segment(c, d, a) or _on_segment(c, d, b)))
        for c, d in zip(polygon, polygon[1:] + polygon[:1])
    )


def visible_step(a, b, scope, private_polys) -> bool:
    if scope and (
        not in_closed_polygon(a, scope) or not in_closed_polygon(b, scope)
        or _crosses_boundary(a, b, scope, False)
        or not in_closed_polygon(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), scope)
    ):
        return False
    return not any(
        in_closed_polygon(a, polygon) or in_closed_polygon(b, polygon) or _crosses_boundary(a, b, polygon, True)
        for polygon in private_polys
    )
