import unittest
from unittest.mock import patch

import numpy as np

import main


class FaceDetectionPolicyTest(unittest.TestCase):
    def setUp(self):
        image = np.zeros((240, 240), dtype=np.uint8)
        self.preprocessed = {
            "equalized": image,
            "gray": image,
            "clahe": image,
            "rgb": np.zeros((240, 240, 3), dtype=np.uint8),
            "bgr": np.zeros((240, 240, 3), dtype=np.uint8),
        }

    @patch.object(main, "generate_response_face_proposals")
    @patch.object(main, "detect_with_mediapipe", return_value=[])
    @patch.object(main, "detect_with_mediapipe_landmarker", return_value=[])
    @patch.object(
        main,
        "detect_with_yunet",
        return_value=[
            {
                "box": (60, 40, 80, 100),
                "rawWeight": None,
                "detector": "yunet",
                "score": 0.92,
                "yunetLandmarks": [],
            }
        ],
    )
    def test_one_primary_candidate_does_not_trigger_fallback(
        self, _yunet, _landmarker, _mediapipe, fallback
    ):
        faces = main.detect_faces(self.preprocessed)

        self.assertEqual(1, len(faces))
        self.assertEqual("yunet", faces[0]["detector"])
        fallback.assert_not_called()

    @patch.object(
        main,
        "generate_response_face_proposals",
        return_value=[
            {
                "box": (55, 35, 90, 110),
                "rawWeight": None,
                "detector": "response_fallback",
                "score": 0.70,
            }
        ],
    )
    @patch.object(main, "detect_with_mediapipe", return_value=[])
    @patch.object(main, "detect_with_mediapipe_landmarker", return_value=[])
    @patch.object(main, "detect_with_yunet", return_value=[])
    def test_fallback_runs_only_when_primary_candidates_are_empty(
        self, _yunet, _landmarker, _mediapipe, fallback
    ):
        faces = main.detect_faces(self.preprocessed)

        self.assertEqual(1, len(faces))
        self.assertEqual("response_fallback", faces[0]["detector"])
        fallback.assert_called_once_with(self.preprocessed)

    @patch.object(main, "generate_response_face_proposals")
    @patch.object(
        main,
        "detect_with_mediapipe",
        return_value=[
            {
                "box": (62, 42, 78, 98),
                "rawWeight": None,
                "detector": "mediapipe",
                "score": 0.94,
            }
        ],
    )
    @patch.object(main, "detect_with_mediapipe_landmarker", return_value=[])
    @patch.object(main, "detect_with_yunet", return_value=[])
    def test_mediapipe_keeps_working_when_yunet_is_unavailable(
        self, _yunet, _landmarker, _mediapipe, fallback
    ):
        faces = main.detect_faces(self.preprocessed)

        self.assertEqual(1, len(faces))
        self.assertEqual("mediapipe", faces[0]["detector"])
        fallback.assert_not_called()


if __name__ == "__main__":
    unittest.main()
