"""
Factory Pulse — proveedor de visión local
=========================================
Publica posiciones anónimas de personas [x, y en 0..1 respecto a la nave] en la API.

Fuentes:
  --source synthetic   trayectorias simuladas (sin cámara)
  --source webcam      cámara de laptop / USB con OpenCV (fondo + centroides)
  --source <archivo>   un video grabado, para ensayar

Calibración (una vez por montaje de cámara):
  python local_vision_provider.py --source webcam --calibrate calib.json --plant 10x6
  Haz clic en las 4 esquinas del área en este orden: sup-izq, sup-der, inf-der, inf-izq.
  Se guarda la homografía imagen → nave. Después:
  python local_vision_provider.py --source webcam --calib calib.json --api http://IP:8000

Requiere: pip install requests opencv-python numpy   (opencv solo para webcam/video)

Nota: la detección por sustracción de fondo sirve para una demostración controlada
(cámara fija, fondo estable). Para planta se sustituye por un detector de personas
(p. ej. YOLO + ByteTrack) manteniendo el mismo contrato de eventos.
"""

import argparse
import json
import math
import sys
import time
import uuid
from abc import ABC, abstractmethod

import requests


class PositionProvider(ABC):
    @abstractmethod
    def get_positions(self) -> list:
        """[{'track_id': 'CAM-1', 'x': 0.25, 'y': 0.40, 'confidence': 0.9}]"""


class SyntheticVisionProvider(PositionProvider):
    """Trayectorias suaves alrededor de puntos fijos, para probar sin cámara."""

    def __init__(self):
        self.step = 0
        self.tracks = [
            {"id": "CAM-1", "base_x": 0.20, "base_y": 0.40},
            {"id": "CAM-2", "base_x": 0.50, "base_y": 0.40},
        ]

    def get_positions(self) -> list:
        self.step += 1
        out = []
        for i, t in enumerate(self.tracks):
            dx = math.sin(self.step * 0.2 + i) * 0.03
            dy = math.cos(self.step * 0.15 + i) * 0.03
            out.append({"track_id": t["id"], "x": round(t["base_x"] + dx, 4), "y": round(t["base_y"] + dy, 4), "confidence": 0.9})
        return out


class OpenCVProvider(PositionProvider):
    """
    Personas como manchas en movimiento (MOG2) + seguimiento por centroide más cercano.
    El punto que se proyecta a la nave es el pie de la mancha (borde inferior), que es
    lo que toca el piso en una vista inclinada.
    """

    def __init__(self, source, calib_path=None, min_area=1500, max_jump=0.12, show=True):
        import cv2
        import numpy as np

        self.cv2, self.np = cv2, np
        self.cap = cv2.VideoCapture(0 if source == "webcam" else source)
        if not self.cap.isOpened():
            raise RuntimeError(f"No se pudo abrir la fuente de video: {source}")
        self.bg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
        self.min_area = min_area
        self.max_jump = max_jump  # salto máximo (normalizado) para considerar que es el mismo track
        self.show = show
        self.H = None
        if calib_path:
            with open(calib_path, encoding="utf-8") as f:
                self.H = np.array(json.load(f)["homography"], dtype="float64")
        self.tracks = {}  # id → (x, y, last_seen)
        self.next_id = 1

    def _to_plant(self, u, v, w, h):
        if self.H is None:
            return u / w, v / h  # sin calibrar: coordenadas de imagen normalizadas
        p = self.H @ self.np.array([u, v, 1.0])
        return float(p[0] / p[2]), float(p[1] / p[2])

    def get_positions(self) -> list:
        cv2 = self.cv2
        ok, frame = self.cap.read()
        if not ok:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # video: vuelve a empezar
            return []
        h, w = frame.shape[:2]
        mask = self.bg.apply(frame)
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)  # descarta sombras (127)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        mask = cv2.dilate(mask, None, iterations=2)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections = []
        for c in contours:
            if cv2.contourArea(c) < self.min_area:
                continue
            x, y, bw, bh = cv2.boundingRect(c)
            px, py = self._to_plant(x + bw / 2, y + bh, w, h)
            if -0.05 <= px <= 1.05 and -0.05 <= py <= 1.05:
                detections.append((min(1, max(0, px)), min(1, max(0, py)), (x, y, bw, bh)))

        now = time.time()
        assigned, out = set(), []
        for px, py, box in detections:
            best, best_d = None, self.max_jump
            for tid, (tx, ty, _) in self.tracks.items():
                d = math.hypot(px - tx, py - ty)
                if tid not in assigned and d < best_d:
                    best, best_d = tid, d
            if best is None:
                best = f"CAM-{self.next_id}"
                self.next_id += 1
            assigned.add(best)
            self.tracks[best] = (px, py, now)
            out.append({"track_id": best, "x": round(px, 4), "y": round(py, 4), "confidence": 0.8})
            if self.show:
                x, y, bw, bh = box
                cv2.rectangle(frame, (x, y), (x + bw, y + bh), (40, 120, 220), 2)
                cv2.putText(frame, best, (x, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 120, 220), 1)
        # olvida tracks que no se ven hace 3 s (IDs efímeros y anónimos)
        self.tracks = {k: v for k, v in self.tracks.items() if now - v[2] < 3.0}

        if self.show:
            cv2.imshow("Factory Pulse · visión (q para salir)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                raise KeyboardInterrupt
        return out


def calibrate(source, out_path, plant):
    """Clic en las 4 esquinas del área (sup-izq, sup-der, inf-der, inf-izq) → homografía a 0..1."""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(0 if source == "webcam" else source)
    ok, frame = cap.read()
    if not ok:
        sys.exit("No se pudo leer un cuadro de la cámara")
    pts = []

    def on_click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 4:
            pts.append([x, y])

    cv2.namedWindow("calibrar")
    cv2.setMouseCallback("calibrar", on_click)
    labels = ["sup-izq", "sup-der", "inf-der", "inf-izq"]
    while len(pts) < 4:
        view = frame.copy()
        for i, p in enumerate(pts):
            cv2.circle(view, tuple(p), 6, (20, 80, 200), -1)
            cv2.putText(view, labels[i], (p[0] + 8, p[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 80, 200), 1)
        cv2.putText(view, f"Clic en: {labels[len(pts)]}", (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 80, 200), 2)
        cv2.imshow("calibrar", view)
        if cv2.waitKey(30) & 0xFF == 27:
            sys.exit("Calibración cancelada")
    cv2.destroyAllWindows()
    dst = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype="float32")
    H = cv2.getPerspectiveTransform(np.array(pts, dtype="float32"), dst)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"image_points": pts, "plant": plant, "homography": H.tolist()}, f, indent=2)
    print(f"Calibración guardada en {out_path}. Las 4 esquinas deben coincidir con las de la nave en la app.")


def main():
    ap = argparse.ArgumentParser(description="Factory Pulse · proveedor de visión")
    ap.add_argument("--api", default="http://localhost:8000", help="Base del servidor Factory Pulse")
    ap.add_argument("--api-url", default=None, help="(compatibilidad) URL completa de /api/events")
    ap.add_argument("--device-id", default="cam-overhead-1")
    ap.add_argument("--mode", default="live", choices=["live", "demo"])
    ap.add_argument("--source", default="synthetic", help="synthetic | webcam | ruta de video")
    ap.add_argument("--calib", default=None, help="archivo de calibración (homografía)")
    ap.add_argument("--calibrate", default=None, help="genera la calibración en este archivo y termina")
    ap.add_argument("--plant", default="", help="medidas de la nave, p. ej. 10x6 (solo informativo)")
    ap.add_argument("--interval", type=float, default=0.5, help="segundos entre publicaciones")
    ap.add_argument("--no-display", action="store_true")
    args = ap.parse_args()

    if args.calibrate:
        calibrate(args.source, args.calibrate, args.plant)
        return

    base = args.api.rstrip("/")
    events_url = args.api_url or f"{base}/api/events/batch"
    heartbeat_url = f"{base}/api/devices/{args.device_id}/heartbeat"
    provider = (
        SyntheticVisionProvider()
        if args.source == "synthetic"
        else OpenCVProvider(args.source, args.calib, show=not args.no_display)
    )
    if args.source != "synthetic" and not args.calib:
        print("Aviso: sin --calib las coordenadas son de la imagen, no de la nave.")
    print(f"[visión] publicando en {events_url} cada {args.interval}s (Ctrl+C para salir)")

    last_hb = 0.0
    while True:
        try:
            t0 = time.time()
            positions = provider.get_positions()
            if positions:
                batch = [
                    {
                        "event_id": f"vis-{p['track_id']}-{uuid.uuid4().hex[:8]}",
                        "device_id": args.device_id,
                        "source_id": "vision_local",
                        "type": "position",
                        "payload": {**p, "source": "vision_local"},
                        "quality": p.get("confidence", 1.0),
                        "mode": args.mode,
                    }
                    for p in positions
                ]
                if events_url.endswith("/batch"):
                    requests.post(events_url, json=batch, timeout=2.0)
                else:
                    for ev in batch:
                        requests.post(events_url, json=ev, timeout=2.0)
            if t0 - last_hb > 10:
                requests.post(heartbeat_url, json={"firmware": "vision-local-1.1"}, timeout=2.0)
                last_hb = t0
            time.sleep(max(0.0, args.interval - (time.time() - t0)))
        except KeyboardInterrupt:
            print("\n[visión] detenido")
            break
        except requests.RequestException as e:
            print(f"[visión] sin conexión con el servidor: {e}")
            time.sleep(2.0)


if __name__ == "__main__":
    main()
