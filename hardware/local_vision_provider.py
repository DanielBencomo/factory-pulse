"""
Factory Pulse — Local Vision Provider Service
============================================
Interface PositionProvider for local overhead cameras or webcams.
Publishes anonymous track coordinates [x,y in 0..1] and confidence to Factory Pulse API.

Usage:
  python local_vision_provider.py --api-url http://localhost:8000/api/events --mode live
"""

import sys
import time
import uuid
import math
import argparse
import requests
from abc import ABC, abstractmethod
from datetime import datetime

class PositionProvider(ABC):
    @abstractmethod
    def get_positions(self) -> list:
        """
        Returns list of dicts:
        [{'track_id': 'TRK-01', 'x': 0.25, 'y': 0.40, 'confidence': 0.95}]
        """
        pass

class SyntheticVisionProvider(PositionProvider):
    """
    Simulated local vision tracker generating smooth trajectories.
    Can be swapped with OpenCV YOLO / ByteTrack implementation.
    """
    def __init__(self):
        self.step = 0
        self.tracks = [
            {"id": "TRK-OP1", "base_x": 0.17, "base_y": 0.38},
            {"id": "TRK-OP2", "base_x": 0.39, "base_y": 0.38},
            {"id": "TRK-OP3", "base_x": 0.61, "base_y": 0.38},
            {"id": "TRK-MAT", "base_x": 0.25, "base_y": 0.70},
        ]

    def get_positions(self) -> list:
        self.step += 1
        positions = []
        for t in self.tracks:
            # Slight natural motion around station
            dx = math.sin(self.step * 0.2 + hash(t["id"])) * 0.02
            dy = math.cos(self.step * 0.15 + hash(t["id"])) * 0.02
            positions.append({
                "track_id": t["id"],
                "x": round(min(0.98, max(0.02, t["base_x"] + dx)), 4),
                "y": round(min(0.98, max(0.02, t["base_y"] + dy)), 4),
                "confidence": 0.96,
                "source": "opencv_local_vision"
            })
        return positions

def main():
    parser = argparse.ArgumentParser(description="Factory Pulse Vision Provider")
    parser.add_argument("--api-url", default="http://localhost:8000/api/events", help="Events ingestion endpoint")
    parser.add_argument("--device-id", default="cam-overhead-line1", help="Device ID")
    parser.add_argument("--mode", default="live", help="Event mode (live|demo)")
    parser.add_argument("--interval", type=float, default=1.0, help="Publish interval in seconds")
    args = parser.parse_args()

    provider = SyntheticVisionProvider()
    print(f"[Vision Provider] Publicando posiciones hacia {args.api_url} cada {args.interval}s...")

    while True:
        try:
            positions = provider.get_positions()
            for pos in positions:
                event = {
                    "event_id": f"vis-{pos['track_id']}-{uuid.uuid4().hex[:8]}",
                    "device_id": args.device_id,
                    "source_id": "vision_service",
                    "occurred_at": datetime.utcnow().isoformat(),
                    "type": "position",
                    "payload": pos,
                    "quality": 1.0,
                    "mode": args.mode
                }
                res = requests.post(args.api_url, json=event, timeout=2.0)
                if res.status_code not in [200, 201]:
                    print(f"Warn: Ingest responded with status {res.status_code}")
            time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n[Vision Provider] Detenido por el usuario.")
            break
        except Exception as e:
            print(f"Error publicando posiciones: {e}")
            time.sleep(2.0)

if __name__ == "__main__":
    main()
