import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

from hardware.local_vision_provider import (
    EventPublisher,
    FloorCalibration,
    VideoSource,
    YoloByteTracker,
    build_parser,
    parse_source,
    point_in_polygon,
    redact_source,
)


class VisionProviderHelpersTest(unittest.TestCase):
    def test_rtsp_frame_is_downscaled_to_configured_bounds(self):
        source = VideoSource.__new__(VideoSource)
        source.cv2 = cv2
        source.width = 960
        source.height = 960
        frame = np.zeros((1440, 1440, 3), dtype=np.uint8)

        resized = source._fit_frame(frame)

        self.assertEqual(resized.shape, (960, 960, 3))

    def test_capture_keeps_only_newest_frame_for_consumer(self):
        class FastCapture:
            def __init__(self, owner):
                self.owner = owner
                self.index = 0

            def read(self):
                self.index += 1
                frame = np.full((4, 4, 3), self.index, dtype=np.uint8)
                if self.index == 3:
                    self.owner._reader_stop.set()
                return True, frame

        source = VideoSource.__new__(VideoSource)
        source.cv2 = cv2
        source.width = 4
        source.height = 4
        source._reader_stop = threading.Event()
        source._frame_condition = threading.Condition()
        source._latest_frame = None
        source._frame_sequence = 0
        source._delivered_sequence = 0
        source._is_file = False
        source.cap = FastCapture(source)

        source._capture_latest()
        latest = source.read()

        self.assertEqual(source._frame_sequence, 3)
        self.assertEqual(int(latest[0, 0, 0]), 3)
    def test_successful_heartbeat_marks_backend_available_without_people(self):
        publisher = EventPublisher("http://127.0.0.1:8000", "camera-test")

        def heartbeat(_session):
            publisher._stop.set()

        with patch.object(publisher, "_configure_mode", return_value=True):
            with patch.object(publisher, "_post_heartbeat", side_effect=heartbeat):
                with patch("hardware.local_vision_provider.requests.Session", return_value=object()):
                    publisher._run()

        self.assertIsNotNone(publisher.last_ok_at)

    def test_live_source_retries_when_unavailable_at_startup(self):
        with patch.object(VideoSource, "open", side_effect=[RuntimeError("offline"), None]) as opened:
            with patch("hardware.local_vision_provider.time.sleep") as sleep:
                source = VideoSource("rtsp://127.0.0.1:8554/live", reconnect_attempts=0)
        self.assertEqual(opened.call_count, 2)
        sleep.assert_called_once_with(0.5)
        source.close()

    def test_probe_source_stops_after_one_failed_open(self):
        with patch.object(VideoSource, "open", side_effect=RuntimeError("offline")) as opened:
            with self.assertRaisesRegex(RuntimeError, "offline"):
                VideoSource("rtsp://127.0.0.1:8554/live", reconnect_attempts=1)
        opened.assert_called_once()

    def test_source_aliases_and_camera_index(self):
        self.assertEqual(parse_source("webcam"), 0)
        self.assertEqual(parse_source(" 2 "), 2)
        self.assertEqual(parse_source("clip.mp4"), "clip.mp4")

    def test_rtsp_credentials_are_redacted(self):
        source = "rtsp://operator:secret@192.168.1.20:8554/live"
        rendered = redact_source(source)
        self.assertNotIn("operator", rendered)
        self.assertNotIn("secret", rendered)
        self.assertEqual(rendered, "rtsp://***:***@192.168.1.20:8554/live")

    def test_polygon_membership(self):
        polygon = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        self.assertTrue(point_in_polygon(0.5, 0.5, polygon))
        self.assertFalse(point_in_polygon(0.95, 0.5, polygon))

    def test_cli_accepts_rtsp_and_tcp(self):
        args = build_parser().parse_args(
            ["--source", "rtsp://192.168.1.20:8554/live", "--rtsp-transport", "tcp"]
        )
        self.assertEqual(args.rtsp_transport, "tcp")
        self.assertTrue(args.source.startswith("rtsp://"))

    def test_yolo_adapter_requests_person_only_and_uses_bottom_center(self):
        class Tensor:
            def __init__(self, value):
                self.value = value

            def int(self):
                return self

            def cpu(self):
                return self

            def tolist(self):
                return self.value

        class Boxes:
            xyxy = Tensor([[10.0, 20.0, 50.0, 100.0]])
            conf = Tensor([0.91])
            id = Tensor([7])

            def __len__(self):
                return 1

        boxes = Boxes()

        class FakeYOLO:
            last_kwargs = None

            def __init__(self, _model):
                pass

            def track(self, **kwargs):
                FakeYOLO.last_kwargs = kwargs
                return [SimpleNamespace(boxes=boxes)]

        module = SimpleNamespace(YOLO=FakeYOLO)
        with patch.dict("sys.modules", {"ultralytics": module}):
            tracker = YoloByteTracker("fake.pt", "bytetrack.yaml", 0.35, 0.55, 640, "cpu", "CAM")
            detections = tracker.detect(object())

        self.assertEqual(FakeYOLO.last_kwargs["classes"], [0])
        self.assertTrue(FakeYOLO.last_kwargs["persist"])
        self.assertEqual(detections[0].track_id, "CAM-P7")
        self.assertEqual((detections[0].foot_x, detections[0].foot_y), (30.0, 100.0))

    def test_yolo_detection_is_visible_before_bytetrack_assigns_an_id(self):
        class Tensor:
            def __init__(self, value):
                self.value = value

            def cpu(self):
                return self

            def tolist(self):
                return self.value

        class Boxes:
            xyxy = Tensor([[10.0, 20.0, 50.0, 100.0]])
            conf = Tensor([0.87])
            id = None

            def __len__(self):
                return 1

        class FakeYOLO:
            def __init__(self, _model):
                pass

            def track(self, **_kwargs):
                return [SimpleNamespace(boxes=Boxes())]

        with patch.dict("sys.modules", {"ultralytics": SimpleNamespace(YOLO=FakeYOLO)}):
            tracker = YoloByteTracker("fake.pt", "bytetrack.yaml", 0.25, 0.55, 960, "cpu", "CAM")
            detections = tracker.detect(object())

        self.assertEqual(len(detections), 1)
        self.assertFalse(detections[0].confirmed)
        self.assertTrue(detections[0].track_id.startswith("CAM-pending-"))

    def test_normalized_mapping_roundtrip(self):
        calibration = FloorCalibration("hardware/calibration.synthetic.json")
        camera = [[0.12, 0.23], [0.75, 0.81]]
        floor = calibration.map_normalized_points(camera, "camera_to_floor", 1280, 720)
        restored = calibration.map_normalized_points(floor, "floor_to_camera", 1280, 720)
        np.testing.assert_allclose(restored, camera, atol=1e-3)

    def test_mapping_requires_homography(self):
        calibration = FloorCalibration()
        with self.assertRaisesRegex(ValueError, "homografía"):
            calibration.map_normalized_points([[0.5, 0.5]], "camera_to_floor", 1280, 720)

    def test_occupancy_bundle_contains_no_track_identifier(self):
        captured = {}

        class Response:
            def raise_for_status(self):
                return None

        class Session:
            def post(self, _url, **kwargs):
                captured.update(kwargs)
                return Response()

        publisher = EventPublisher("http://127.0.0.1:8000", "camera-test")
        publisher._post_measurements(
            Session(),
            [],
            [{"zone_id": "__plant__", "count": 2, "counts": {"zone-private": 2}}],
        )
        event = captured["json"][0]
        self.assertEqual(event["type"], "zone_occupancy")
        self.assertNotIn("track_id", event["payload"])
        self.assertEqual(event["payload"]["counts"]["zone-private"], 2)


if __name__ == "__main__":
    unittest.main()
