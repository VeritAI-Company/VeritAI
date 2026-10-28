from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import transforms
from torchvision.models import efficientnet_b4


BASE_DIR = Path(__file__).resolve().parent
CHECKPOINT_PATH = Path(
    os.getenv("VERITAI_CNN_CHECKPOINT", str(BASE_DIR / "checkpoints" / "cnn_model.pt"))
)
MAX_IMAGE_WIDTH = int(os.getenv("VERITAI_MAX_IMAGE_WIDTH", "1280"))
FAKE_THRESHOLD = float(os.getenv("VERITAI_CNN_FAKE_THRESHOLD", "0.5"))
# train_colab.py: class 0=real, class 1=fake
REAL_CLASS_INDEX = 0
FAKE_CLASS_INDEX = 1
# Service-aligned training zip (crop_all --pipeline service) includes __full.jpg by default.
INCLUDE_FULL_VIEW = os.getenv("VERITAI_CNN_INCLUDE_FULL_VIEW", "1").strip().lower() in {
    "1",
    "true",
    "yes",
}
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
# 히트맵 방식: gradcam(기본, 14x14) 또는 cam(예전 방식, 7x7)
HEATMAP_METHOD = os.getenv("VERITAI_HEATMAP_METHOD", "gradcam").strip().lower()
# Grad-CAM에 쓸 EfficientNet-B4 특징 블록 번호. 5번 블록 출력은 224 입력 기준 14x14다.
GRADCAM_LAYER_INDEX = int(os.getenv("VERITAI_GRADCAM_LAYER", "5"))


def cam_to_grid(cam: np.ndarray, fake_prob: float) -> List[List[float]]:
    """히트맵 숫자 표. 가장 강한 칸을 1로 맞춘 뒤 그 영역의 조작 확률을 곱한다.
    조작 확률이 낮은 영역은 히트맵도 약하게 나온다. 값 범위 0~1."""
    cam = np.nan_to_num(np.maximum(np.asarray(cam, dtype=np.float64), 0.0))
    peak = float(cam.max()) if cam.size else 0.0
    if peak <= 0.0:
        grid = np.zeros_like(cam)
    else:
        grid = cam / peak * max(0.0, min(1.0, float(fake_prob)))
    return np.round(grid, 3).tolist()


def cam_to_color_image(cam: np.ndarray, width: int, height: int) -> np.ndarray:
    """예전 클라이언트용 heatmapBase64 그림. 영역 안에서 가장 강한 칸을 빨강으로 맞춘 JET 컬러맵."""
    cam = np.nan_to_num(np.maximum(np.asarray(cam, dtype=np.float32), 0.0))
    peak = float(cam.max()) if cam.size else 0.0
    relative = cam / peak if peak > 0.0 else np.zeros_like(cam)
    gray = np.uint8(np.clip(relative, 0.0, 1.0) * 255)
    resized = cv2.resize(gray, (max(1, width), max(1, height)), interpolation=cv2.INTER_CUBIC)
    return cv2.applyColorMap(resized, cv2.COLORMAP_JET)


@dataclass(frozen=True)
class CnnView:
    name: str
    bgr: np.ndarray
    bbox: Optional[Dict[str, int]] = None


class DeepfakeDetector(nn.Module):
    """Same checkpoint structure used by colab/train_colab.py."""

    def __init__(self, num_classes: int = 2, dropout: float = 0.3) -> None:
        super().__init__()
        backbone = efficientnet_b4(weights=None)
        in_features = backbone.classifier[1].in_features
        backbone.classifier = nn.Sequential(
            nn.Dropout(p=dropout, inplace=True),
            nn.Linear(in_features, num_classes),
        )
        self.model = backbone

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)


def normalize_bgr_width(bgr: np.ndarray, max_width: int = MAX_IMAGE_WIDTH) -> np.ndarray:
    if bgr is None or bgr.size == 0:
        return bgr
    h, w = bgr.shape[:2]
    if w <= max_width:
        return bgr
    ratio = max_width / float(w)
    return cv2.resize(bgr, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA)


def normalize_bbox(source: Dict[str, Any]) -> Optional[Dict[str, int]]:
    if "bbox" in source and isinstance(source["bbox"], dict):
        bbox = source["bbox"]
        return {
            "x": int(bbox.get("x", 0)),
            "y": int(bbox.get("y", 0)),
            "w": int(bbox.get("w", 0)),
            "h": int(bbox.get("h", 0)),
        }
    if "box" in source:
        x, y, w, h = source["box"]
        return {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
    return None


def crop_bgr_from_bbox(bgr: np.ndarray, bbox: Dict[str, int]) -> Optional[np.ndarray]:
    x = int(bbox.get("x", 0))
    y = int(bbox.get("y", 0))
    w = int(bbox.get("w", 0))
    h = int(bbox.get("h", 0))
    if w <= 0 or h <= 0:
        return None
    image_h, image_w = bgr.shape[:2]
    x = max(0, min(x, image_w - 1))
    y = max(0, min(y, image_h - 1))
    w = max(1, min(w, image_w - x))
    h = max(1, min(h, image_h - y))
    crop = bgr[y : y + h, x : x + w]
    if crop.size == 0:
        return None
    return crop


def build_cnn_views_bgr(bgr: np.ndarray, faces: Sequence[Dict[str, Any]]) -> List[CnnView]:
    """
    CNN inputs aligned with POST /predict (crop_all --pipeline service).

    - face_N: build_face_output() bbox on MAX_IMAGE_WIDTH resized image
    - full: included when VERITAI_CNN_INCLUDE_FULL_VIEW=1 (default; matches service zip)
    """
    full = normalize_bgr_width(bgr)
    views: List[CnnView] = []
    if INCLUDE_FULL_VIEW:
        views.append(CnnView("full", full))
    for index, face in enumerate(faces):
        bbox = normalize_bbox(face)
        if bbox is None:
            continue
        crop = crop_bgr_from_bbox(full, bbox)
        if crop is None:
            continue
        views.append(
            CnnView(
                f"face_{index + 1}",
                crop,
                bbox,
            )
        )
    return views


class CnnRuntime:
    def __init__(
        self,
        checkpoint_path: Path = CHECKPOINT_PATH,
        *,
        device: Optional[str] = None,
        threshold: float = FAKE_THRESHOLD,
    ) -> None:
        self.checkpoint_path = Path(checkpoint_path)
        self.threshold = threshold
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.transform = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
            ]
        )
        self.model: Optional[DeepfakeDetector] = None
        self.load_error: Optional[str] = None
        self._inference_lock = threading.Lock()
        self._load()

    @property
    def loaded(self) -> bool:
        return self.model is not None

    def _load(self) -> None:
        if not self.checkpoint_path.is_file():
            self.load_error = f"checkpoint not found: {self.checkpoint_path}"
            return
        try:
            payload = torch.load(self.checkpoint_path, map_location=self.device)
            if isinstance(payload, dict) and "model" in payload:
                payload = payload["model"]
            elif isinstance(payload, dict) and "state_dict" in payload:
                payload = payload["state_dict"]
            model = DeepfakeDetector().to(self.device)
            model.load_state_dict(payload, strict=True)
            model.eval()
            # 가중치는 학습하지 않으므로 기울기를 계산하지 않는다 (Grad-CAM은 입력 쪽 기울기만 쓴다)
            for param in model.parameters():
                param.requires_grad_(False)
            self.model = model
            self.load_error = None
        except Exception as exc:
            self.model = None
            self.load_error = str(exc)

    def _tensor_from_bgr(self, bgr: np.ndarray) -> torch.Tensor:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        return self.transform(Image.fromarray(rgb))

    @torch.no_grad()
    def _forward_cam(self, batch: torch.Tensor) -> Tuple[np.ndarray, Optional[torch.Tensor]]:
        """예전 방식 CAM. 마지막 특징층(7x7)과 fake 분류 가중치로 계산한다."""
        captured: Dict[str, torch.Tensor] = {}

        def capture_features(_module, _inputs, output):
            captured["value"] = output.detach()

        hook = self.model.model.features.register_forward_hook(capture_features)
        try:
            logits = self.model(batch)
        finally:
            hook.remove()
        probs = torch.softmax(logits, dim=1)[:, FAKE_CLASS_INDEX].cpu().numpy()
        try:
            fc_weights = self.model.model.classifier[1].weight[FAKE_CLASS_INDEX]
            cam_batch = torch.relu(torch.einsum("bchw,c->bhw", captured["value"], fc_weights))
        except Exception:
            cam_batch = None
        return probs, cam_batch

    def _forward_gradcam(self, batch: torch.Tensor) -> Tuple[np.ndarray, torch.Tensor]:
        """Grad-CAM. 특징 블록(GRADCAM_LAYER_INDEX) 출력에 fake 점수의 기울기를 채널별 평균으로 곱해 더한다.
        torchvision EfficientNet의 forward(features -> avgpool -> flatten -> classifier)를 그대로 나눠 실행하므로
        판정 확률은 self.model(batch)와 같다. 기울기는 그 블록 뒤쪽만 계산한다.
        모델은 eval 상태라 배치 안의 이미지끼리 서로 영향을 주지 않는다."""
        net = self.model.model
        split = GRADCAM_LAYER_INDEX + 1
        if not 0 < split < len(net.features):
            raise ValueError(f"invalid VERITAI_GRADCAM_LAYER: {GRADCAM_LAYER_INDEX}")
        with torch.no_grad():
            front = net.features[:split](batch)
        activation = front.detach().requires_grad_(True)
        with torch.enable_grad():
            x = net.features[split:](activation)
            x = torch.flatten(net.avgpool(x), 1)
            logits = net.classifier(x)
            (gradient,) = torch.autograd.grad(logits[:, FAKE_CLASS_INDEX].sum(), activation)
        probs = torch.softmax(logits.detach(), dim=1)[:, FAKE_CLASS_INDEX].cpu().numpy()
        weights = gradient.mean(dim=(2, 3), keepdim=True)
        cam_batch = torch.relu((weights * activation.detach()).sum(dim=1))
        return probs, cam_batch

    def predict_views(self, views: Sequence[CnnView]) -> Dict[str, Any]:
        if not self.loaded or self.model is None:
            return {
                "modelLoaded": False,
                "checkpoint": str(self.checkpoint_path),
                "error": self.load_error,
                "fakeProbability": 0.0,
                "isDeepfake": False,
                "views": [],
            }
        valid_views = [view for view in views if view.bgr is not None and view.bgr.size > 0]
        if not valid_views:
            return {
                "modelLoaded": True,
                "checkpoint": str(self.checkpoint_path),
                "fakeProbability": 0.0,
                "isDeepfake": False,
                "views": [],
            }
        heatmap_method = "cam"
        heatmap_error = None
        with self._inference_lock:
            batch = torch.stack([self._tensor_from_bgr(view.bgr) for view in valid_views]).to(self.device)
            if HEATMAP_METHOD == "gradcam":
                try:
                    probs, cam_batch = self._forward_gradcam(batch)
                    heatmap_method = "gradcam"
                except Exception as exc:
                    # Grad-CAM이 실패해도 판정은 그대로 하고, 예전 CAM으로 히트맵을 만든다
                    heatmap_error = f"gradcam failed: {exc}"
                    probs, cam_batch = self._forward_cam(batch)
            else:
                probs, cam_batch = self._forward_cam(batch)

        view_results = []
        best_prob = 0.0
        best_index = None
        cams = []
        for idx, (view, prob) in enumerate(zip(valid_views, probs)):
            fake_prob = float(prob)
            if fake_prob > best_prob:
                best_prob = fake_prob
                best_index = idx
            cam = cam_batch[idx].cpu().numpy() if cam_batch is not None else None
            cams.append(cam)
            view_results.append({
                "name": view.name,
                "fakeProbability": round(fake_prob, 6),
                "bbox": view.bbox,
                # 영역별 히트맵 숫자 표 (조작 확률을 곱한 값, 0~1)
                "cam": cam_to_grid(cam, fake_prob) if cam is not None else None,
            })

        best_heatmap = None
        heatmap_view = None
        if best_index is not None:
            heatmap_view = valid_views[best_index].name
            if cams[best_index] is not None:
                h, w = valid_views[best_index].bgr.shape[:2]
                best_heatmap = cam_to_color_image(cams[best_index], w, h)

        result = {
            "modelLoaded": True,
            "checkpoint": str(self.checkpoint_path),
            "fakeProbability": round(float(best_prob), 6),
            "isDeepfake": bool(best_prob >= self.threshold),
            "threshold": self.threshold,
            "views": view_results,
            # 확률이 가장 높은 영역 이름 (예: "full", "face_2"). heatmapBase64도 이 영역 기준이다
            "heatmapView": heatmap_view,
            "heatmapMethod": heatmap_method if cam_batch is not None else None,
            "heatmap_array": best_heatmap,
        }
        if heatmap_error:
            result["heatmapError"] = heatmap_error
        return result

    def predict_image_faces(self, bgr: np.ndarray, faces: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        return self.predict_views(build_cnn_views_bgr(bgr, faces))

    @torch.no_grad()
    def warm_up(self) -> bool:
        if not self.loaded or self.model is None:
            return False
        with self._inference_lock:
            sample = torch.zeros((1, 3, 224, 224), device=self.device)
            self.model(sample)
        return True


_RUNTIME: Optional[CnnRuntime] = None
_RUNTIME_LOCK = threading.Lock()


def get_runtime() -> CnnRuntime:
    global _RUNTIME
    if _RUNTIME is None:
        with _RUNTIME_LOCK:
            if _RUNTIME is None:
                _RUNTIME = CnnRuntime()
    return _RUNTIME


def predict_image_faces(bgr: np.ndarray, faces: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    return get_runtime().predict_image_faces(bgr, faces)


def warmup_runtime() -> bool:
    return get_runtime().warm_up()
