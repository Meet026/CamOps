"""
Vehicle detector: wraps YOLO11n (Ultralytics official pretrained checkpoint)
to find and crop vehicles from a frame.

Model choice: YOLO11n — verified via research before picking (not assumed):
- Official Ultralytics package, auto-downloads a reliable pretrained
  checkpoint on first use (no Baidu-Pan-style dead end, unlike Phase 0's
  original PVEN pick).
- Trained on COCO, which already includes the exact vehicle classes we
  need (car, truck, bus, motorcycle) — no fine-tuning needed, unlike
  Phase 1's Re-ID model, which genuinely required it.
- "n" (nano) variant chosen for CPU inference speed, since this machine
  has no GPU (same constraint established in Phase 0).

Class filtering is done by NAME lookup against the model's own
model.names mapping, not hardcoded COCO class indices — the exact index
values are an implementation detail of how the checkpoint was exported;
looking them up by name is what's actually robust to a different
checkpoint or version being swapped in later.
"""
from dataclasses import dataclass

from PIL import Image
from ultralytics import YOLO

VEHICLE_CLASS_NAMES = {"car", "motorcycle", "bus", "truck"}


class DetectorError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


@dataclass
class VehicleDetection:
    crop: Image.Image
    class_name: str
    confidence: float
    box_xyxy: tuple  # (x1, y1, x2, y2) in original image pixel coordinates


class VehicleDetector:
    def __init__(self, model_name: str = "yolo11n.pt", confidence_threshold: float = 0.4):
        try:
            self._model = YOLO(model_name)
        except Exception as e:
            raise DetectorError(
                "MODEL_LOAD_FAILED", f"Failed to load YOLO model '{model_name}': {e}"
            )

        self._vehicle_class_ids = {
            class_id
            for class_id, name in self._model.names.items()
            if name in VEHICLE_CLASS_NAMES
        }
        if not self._vehicle_class_ids:
            raise DetectorError(
                "NO_VEHICLE_CLASSES_FOUND",
                f"None of {VEHICLE_CLASS_NAMES} found in model.names: {self._model.names}. "
                f"This model may not be COCO-trained as expected.",
            )

        self.confidence_threshold = confidence_threshold

    def detect(self, image_path: str) -> list:
        """
        Runs detection on a single image file, returns a list of
        VehicleDetection — one per vehicle found above the confidence
        threshold, already cropped from the original image. Returns an
        empty list if no vehicles are found (not an error — a frame with
        no vehicles is a valid, expected outcome, not a failure).
        """
        try:
            results = self._model.predict(
                source=image_path,
                conf=self.confidence_threshold,
                classes=list(self._vehicle_class_ids),
                verbose=False,
            )
        except Exception as e:
            raise DetectorError(
                "INFERENCE_FAILED", f"Detection failed on {image_path}: {e}"
            )

        if not results:
            return []

        result = results[0]
        try:
            original_image = Image.open(image_path).convert("RGB")
        except Exception as e:
            raise DetectorError(
                "IMAGE_LOAD_FAILED", f"Could not open {image_path} for cropping: {e}"
            )

        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            class_name = self._model.names[class_id]
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]

            crop = original_image.crop((x1, y1, x2, y2))
            detections.append(
                VehicleDetection(
                    crop=crop,
                    class_name=class_name,
                    confidence=confidence,
                    box_xyxy=(x1, y1, x2, y2),
                )
            )

        return detections
