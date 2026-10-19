import asyncio
import io
import time
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from starlette.datastructures import UploadFile

import main


RESPONSE_FIELDS = {
    "isDeepfake",
    "confidence",
    "faceCount",
    "watermarkDetected",
    "modelVersion",
    "analysisMode",
    "analysisInput",
    "timings",
    "processingTimeMs",
    "message",
    "faces",
    "cnn",
    "debugImages",
    "heatmapBase64",
}


def upload(contents=b"valid-image"):
    return UploadFile(filename="capture.jpg", file=io.BytesIO(contents))


def fake_pipeline(_image, _analysis_mode, delay=0.0):
    if delay:
        time.sleep(delay)
    return (
        np.zeros((8, 8, 3), dtype=np.uint8),
        [],
        {},
        {
            "modelLoaded": False,
            "fakeProbability": 0.0,
            "isDeepfake": False,
            "views": [],
        },
        {},
        1,
        0,
        0,
        1,
    )


class InferenceConcurrencyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.INFERENCE_CAPACITY = main.InferenceCapacity(1, 2)

    async def test_invalid_image_response_contract_is_unchanged(self):
        response = await main.predict(upload(b"not-an-image"), "face_crop_only")

        self.assertEqual(
            set(response),
            RESPONSE_FIELDS - {"cnn", "heatmapBase64"},
        )
        self.assertEqual(response["analysisMode"], "face_crop_only")
        self.assertEqual(response["faceCount"], 0)

    async def test_valid_response_contract_is_unchanged(self):
        with patch.object(main, "decode_image", return_value=np.zeros((8, 8, 3), dtype=np.uint8)), patch.object(
            main,
            "run_analysis_pipeline",
            side_effect=fake_pipeline,
        ):
            response = await main.predict(upload(), "full_image")

        self.assertEqual(set(response), RESPONSE_FIELDS)
        self.assertEqual(response["analysisMode"], "full_image")
        self.assertEqual(response["debugImages"], {})

    async def test_cpu_pipeline_does_not_block_event_loop(self):
        with patch.object(main, "decode_image", return_value=np.zeros((8, 8, 3), dtype=np.uint8)), patch.object(
            main,
            "run_analysis_pipeline",
            side_effect=lambda image, mode: fake_pipeline(image, mode, delay=0.15),
        ):
            prediction = asyncio.create_task(main.predict(upload(), "full_image"))
            started = time.perf_counter()
            await asyncio.sleep(0.02)
            heartbeat_delay = time.perf_counter() - started
            await prediction

        self.assertLess(heartbeat_delay, 0.08)

    async def test_zero_waiting_capacity_rejects_overload(self):
        main.INFERENCE_CAPACITY = main.InferenceCapacity(1, 0)
        with patch.object(main, "decode_image", return_value=np.zeros((8, 8, 3), dtype=np.uint8)), patch.object(
            main,
            "run_analysis_pipeline",
            side_effect=lambda image, mode: fake_pipeline(image, mode, delay=0.15),
        ):
            first = asyncio.create_task(main.predict(upload(), "full_image"))
            await asyncio.sleep(0.02)
            with self.assertRaises(HTTPException) as raised:
                await main.predict(upload(), "full_image")
            await first

        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
