import os
import unittest

import cv2
import numpy as np

import main


IMAGE_PATHS = [
    value
    for value in os.getenv("VERITAI_REGRESSION_IMAGES", "").split(os.pathsep)
    if value
]


@unittest.skipUnless(
    len(IMAGE_PATHS) == 6 and all(os.path.isfile(path) for path in IMAGE_PATHS),
    "Set VERITAI_REGRESSION_IMAGES to the six semicolon-separated validation images.",
)
class AttachedImageRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.images = [cv2.imread(path) for path in IMAGE_PATHS]
        if any(image is None for image in cls.images):
            raise RuntimeError("One or more regression images could not be decoded.")

    @staticmethod
    def _tile(image, size=320, inner=280):
        height, width = image.shape[:2]
        scale = min(inner / float(width), inner / float(height))
        resized = cv2.resize(
            image,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
        )
        canvas = np.full((size, size, 3), 245, dtype=np.uint8)
        y = (size - resized.shape[0]) // 2
        x = (size - resized.shape[1]) // 2
        canvas[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
        return canvas

    @classmethod
    def _grid(cls, images):
        tiles = [cls._tile(image) for image in images]
        rows = [cv2.hconcat(tiles[index : index + 3]) for index in range(0, 6, 3)]
        return cv2.vconcat(rows)

    def test_single_real_and_synthetic_portraits(self):
        observed = []
        for image in self.images:
            _, faces, _, result, *_ = main.run_analysis_pipeline(image, "face_crop_only")
            self.assertEqual(1, len(faces))
            self.assertEqual("faces", result["analysisScope"])
            observed.append(result["isDeepfake"])

        self.assertEqual([False, False, False, True, True, True], observed)

    def test_non_face_image_uses_full_image_fallback(self):
        non_face = np.zeros((256, 256, 3), dtype=np.uint8)

        _, faces, _, result, *_ = main.run_analysis_pipeline(non_face, "face_crop_only")

        self.assertEqual([], faces)
        self.assertEqual("full_fallback", result["analysisScope"])
        self.assertEqual("full_image_only", result["aggregationMethod"])

    def test_multi_real_portraits_use_face_average(self):
        image = self._grid([
            self.images[0],
            self.images[1],
            self.images[2],
            self.images[0],
            self.images[1],
            self.images[2],
        ])

        _, faces, _, result, *_ = main.run_analysis_pipeline(image, "face_crop_only")

        self.assertGreaterEqual(len(faces), 5)
        self.assertEqual("faces", result["analysisScope"])
        self.assertEqual("face_average_with_high_max_guard", result["aggregationMethod"])
        self.assertFalse(result["isDeepfake"])

    def test_five_real_and_one_synthetic_portrait_trigger_high_max_guard(self):
        image = self._grid([
            self.images[0],
            self.images[1],
            self.images[2],
            self.images[0],
            self.images[1],
            self.images[3],
        ])

        _, faces, _, result, *_ = main.run_analysis_pipeline(image, "face_crop_only")

        self.assertGreaterEqual(len(faces), 5)
        self.assertTrue(result["isDeepfake"])
        self.assertGreaterEqual(result["maxProbability"], 0.80)
        self.assertEqual("high_single_face_probability", result["decisionReason"])

    def test_occluded_and_small_face_candidates_are_not_replaced_by_fallback(self):
        source = self.images[0]
        preprocessed = main.preprocess_image(source)
        original = main.detect_faces(preprocessed)
        self.assertTrue(original)
        x, y, width, height = original[0]["box"]

        occluded = source.copy()
        cv2.rectangle(
            occluded,
            (max(0, x), max(0, y + int(height * 0.62))),
            (min(occluded.shape[1] - 1, x + width), min(occluded.shape[0] - 1, y + height)),
            (40, 40, 40),
            thickness=-1,
        )
        occluded_faces = main.detect_faces(main.preprocess_image(occluded))
        self.assertTrue(occluded_faces)
        self.assertNotEqual("response_fallback", occluded_faces[0]["detector"])

        small_canvas = self._tile(source, size=512, inner=150)
        small_faces = main.detect_faces(main.preprocess_image(small_canvas))
        self.assertTrue(small_faces)
        self.assertNotEqual("response_fallback", small_faces[0]["detector"])

    def test_perspective_distorted_face_uses_modern_detector(self):
        source = self.images[1]
        height, width = source.shape[:2]
        source_points = np.float32(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
        )
        destination_points = np.float32(
            [
                [int(width * 0.18), int(height * 0.04)],
                [int(width * 0.86), 0],
                [int(width * 0.72), height - 1],
                [int(width * 0.18), int(height * 0.96)],
            ]
        )
        transformed = cv2.warpPerspective(
            source,
            cv2.getPerspectiveTransform(source_points, destination_points),
            (width, height),
            borderValue=(245, 245, 245),
        )

        faces = main.detect_faces(main.preprocess_image(transformed))

        self.assertTrue(faces)
        self.assertNotEqual("response_fallback", faces[0]["detector"])


if __name__ == "__main__":
    unittest.main()
