import unittest

import numpy as np

import cnn


class CnnInputPolicyTest(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((200, 200, 3), dtype=np.uint8)

    def test_face_crops_exclude_full_view(self):
        views = cnn.build_cnn_views_bgr(
            self.image,
            [{"bbox": {"x": 20, "y": 30, "w": 80, "h": 90}, "quality": {"label": "good"}}],
        )

        self.assertEqual(["face_1"], [view.name for view in views])

    def test_full_view_is_used_when_no_validated_face_exists(self):
        views = cnn.build_cnn_views_bgr(self.image, [])

        self.assertEqual(["full"], [view.name for view in views])

    def test_poor_faces_are_excluded_and_full_view_is_used(self):
        views = cnn.build_cnn_views_bgr(
            self.image,
            [{"bbox": {"x": 20, "y": 30, "w": 80, "h": 90}, "quality": {"label": "poor"}}],
        )

        self.assertEqual(["full"], [view.name for view in views])


class CnnAggregationPolicyTest(unittest.TestCase):
    def test_high_single_face_probability_is_protected(self):
        result = cnn.aggregate_view_probabilities(
            [
                {"name": "face_1", "fakeProbability": 0.10},
                {"name": "face_2", "fakeProbability": 0.84},
                {"name": "face_3", "fakeProbability": 0.08},
            ]
        )

        self.assertTrue(result["isDeepfake"])
        self.assertEqual(0.84, result["fakeProbability"])
        self.assertEqual("high_single_face_probability", result["decisionReason"])
        self.assertEqual("face_2", result["winningView"])

    def test_sub_guard_outlier_uses_average_and_stays_real(self):
        result = cnn.aggregate_view_probabilities(
            [
                {"name": "face_1", "fakeProbability": 0.05},
                {"name": "face_2", "fakeProbability": 0.75},
                {"name": "face_3", "fakeProbability": 0.05},
                {"name": "face_4", "fakeProbability": 0.05},
                {"name": "face_5", "fakeProbability": 0.05},
                {"name": "face_6", "fakeProbability": 0.05},
            ]
        )

        self.assertFalse(result["isDeepfake"])
        self.assertEqual(0.166667, result["fakeProbability"])
        self.assertEqual("below_combined_thresholds", result["decisionReason"])

    def test_high_face_average_marks_image_as_deepfake(self):
        result = cnn.aggregate_view_probabilities(
            [
                {"name": "face_1", "fakeProbability": 0.55},
                {"name": "face_2", "fakeProbability": 0.65},
            ]
        )

        self.assertTrue(result["isDeepfake"])
        self.assertEqual(0.60, result["fakeProbability"])
        self.assertEqual("high_average_face_probability", result["decisionReason"])

    def test_full_image_is_evaluated_separately(self):
        result = cnn.aggregate_view_probabilities(
            [{"name": "full", "fakeProbability": 0.61}]
        )

        self.assertEqual("full_fallback", result["analysisScope"])
        self.assertEqual("full_image_only", result["aggregationMethod"])
        self.assertTrue(result["isDeepfake"])


if __name__ == "__main__":
    unittest.main()
