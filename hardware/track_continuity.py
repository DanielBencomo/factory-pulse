"""Short, conservative anonymous ID recovery for a single calibrated camera."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from math import dist, isfinite
from typing import Sequence

Point = tuple[float, float]
Polygon = Sequence[Sequence[float]]
RECOVERY_RADIUS_M = 0.8
DEFAULT_RECOVERY_S = 1.5


@dataclass(frozen=True, slots=True)
class Observation:
    raw_id: int | None
    floor_m: Point | None  # None when geometry is invalid or the point is private
    recoverable: bool = False


@dataclass(frozen=True, slots=True)
class Identity:
    number: int
    recovered: bool = False


@dataclass(frozen=True, slots=True)
class _Seen:
    number: int
    at: float
    frame: int
    floor_m: Point
    recoverable: bool


def edge_distance(point: Point, polygon: Polygon) -> float:
    """Minimum distance to a polygon boundary, in the supplied units."""
    x, y = point
    result = float("inf")
    for (ax, ay), (bx, by) in zip(polygon, polygon[1:] + polygon[:1]):
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        fraction = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_sq)) if length_sq else 0.0
        result = min(result, dist(point, (ax + fraction * dx, ay + fraction * dy)))
    return result


def crosses_polygon(a: Point, b: Point, polygon: Polygon) -> bool:
    """Conservative boundary intersection; also treats touching as crossing."""
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def touches(p, q, r):
        eps = 1e-8
        return abs(cross(p, q, r)) <= eps and all(min(p[i], q[i]) - eps <= r[i] <= max(p[i], q[i]) + eps for i in (0, 1))

    for c, d in zip(polygon, polygon[1:] + polygon[:1]):
        if (cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0) or (
            touches(a, b, c) or touches(a, b, d) or touches(c, d, a) or touches(c, d, b)
        ):
            return True
    return False


class TrackingContinuity:
    def __init__(self, recovery_s: float = DEFAULT_RECOVERY_S) -> None:
        if not isfinite(recovery_s) or not 0 <= recovery_s <= 2.0:
            raise ValueError("La ventana de recuperación debe estar entre 0 y 2 s")
        self.recovery_s = recovery_s
        self._seen: dict[int, _Seen] = {}
        self._at: float | None = None
        self._frame = 0
        self.created = 0
        self.recovered = 0
        self.rejected = 0

    def reset(self) -> None:
        # Keep the serial monotonic: old samples in the backend must not acquire
        # the same identity after calibration changes or reconnecting a stream.
        self._seen.clear()
        self._at = None

    def update(
        self, items: Sequence[Observation], *, at: float, max_gap_s: float, max_speed_m_s: float,
        private_polys: Sequence[Polygon] = (),
    ) -> dict[int, Identity]:
        if self._at is not None and not 0 < at - self._at <= max_gap_s:
            self.reset()
        self._at = at
        self._frame += 1
        window_s = min(self.recovery_s, max_gap_s)
        counts = Counter(o.raw_id for o in items if o.raw_id is not None)
        valid = {
            i: o for i, o in enumerate(items)
            if o.raw_id is not None and counts[o.raw_id] == 1 and o.floor_m is not None
        }
        raw = {o.raw_id: i for i, o in valid.items()}
        # Crossing a privacy/coverage boundary or duplicate raw IDs retire a
        # binding, not just pause it. No identity is emitted for those samples.
        for raw_id in counts.keys() - raw.keys():
            self._seen.pop(raw_id, None)

        result: dict[int, Identity] = {}
        fresh_only: set[int] = set()
        for raw_id, prev in list(self._seen.items()):
            age = at - prev.at
            if prev.frame == self._frame - 1 and raw_id in raw:
                index = raw[raw_id]
                point = valid[index].floor_m
                if dist(prev.floor_m, point) <= max_speed_m_s * age and not any(
                    crosses_polygon(prev.floor_m, point, polygon) for polygon in private_polys
                ):
                    result[index] = Identity(prev.number)
                    continue
                # A jump under the same raw ID is not evidence for another
                # recovery candidate either; mark it for a fresh identity.
                self._seen.pop(raw_id)
                fresh_only.add(index)
                continue
            if age > window_s or not prev.recoverable:
                self._seen.pop(raw_id)

        continued = {valid[i].raw_id for i in result}
        nearby: dict[int, list[int]] = {}
        reverse: Counter[int] = Counter()
        for raw_id, prev in self._seen.items():
            if raw_id in continued or window_s == 0:
                continue
            radius = min(RECOVERY_RADIUS_M, max_speed_m_s * (at - prev.at))
            candidates = [
                i for i, o in enumerate(items)
                if o.floor_m is not None and dist(o.floor_m, prev.floor_m) <= radius
            ]
            nearby[raw_id] = candidates
            reverse.update(candidates)

        retired = set()
        for raw_id, candidates in nearby.items():
            if not candidates:
                if raw_id in raw:
                    retired.add(raw_id)
                continue
            if len(candidates) == 1:
                i = candidates[0]
                o = valid.get(i)
                if (
                    o and o.recoverable and reverse[i] == 1 and i not in result and i not in fresh_only
                    and (raw_id not in raw or raw[raw_id] == i)
                ):
                    result[i] = Identity(self._seen[raw_id].number, recovered=True)
                    self.recovered += 1
                    retired.add(raw_id)
                    continue
            # An unresolved competition must not be retried in a later frame
            # after another candidate disappears or has been given a new ID.
            self.rejected += 1
            retired.add(raw_id)
        for raw_id in retired:
            self._seen.pop(raw_id)

        for i, o in valid.items():
            if i not in result:
                self.created += 1
                result[i] = Identity(self.created)
            self._seen[o.raw_id] = _Seen(result[i].number, at, self._frame, o.floor_m, o.recoverable)
        return result
