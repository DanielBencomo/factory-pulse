import unittest
from types import SimpleNamespace
from unittest.mock import patch

from hardware.local_vision_provider import (
    YoloByteTracker,
    build_parser,
    parse_source,
    point_in_polygon,
    redact_source,
)


class VisionProviderHelpersTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
