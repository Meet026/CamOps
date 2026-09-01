"""
Image loading, validation, and model-input transformation.

Every bad-input case (corrupt file, wrong format, empty file, missing
file) raises a typed PreprocessingError rather than letting PIL's raw
exception propagate — this is what lets the CLI layer catch, log, and
skip individual bad files without crashing the whole run.
"""
import os
import numpy as np
from PIL import Image, UnidentifiedImageError

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class PreprocessingError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


def load_and_validate(file_path: str) -> Image.Image:
    if not os.path.exists(file_path):
        raise PreprocessingError("CORRUPT_FILE", f"File does not exist: {file_path}")

    if os.path.getsize(file_path) == 0:
        raise PreprocessingError("EMPTY_FILE", f"File is empty: {file_path}")

    try:
        img = Image.open(file_path)
        img.load()  # force full decode now, not lazily later
    except UnidentifiedImageError:
        raise PreprocessingError(
            "UNREADABLE_FORMAT", f"Not a recognized image format: {file_path}"
        )
    except Exception as e:
        raise PreprocessingError(
            "CORRUPT_FILE", f"Failed to decode image: {file_path} ({e})"
        )

    if img.mode != "RGB":
        img = img.convert("RGB")

    return img


def to_model_input(image: Image.Image, target_height: int, target_width: int) -> np.ndarray:
    resized = image.resize((target_width, target_height))
    array = np.asarray(resized, dtype=np.float32) / 255.0  # HWC, [0, 1]
    normalized = (array - IMAGENET_MEAN) / IMAGENET_STD
    chw = np.transpose(normalized, (2, 0, 1))  # HWC -> CHW
    batched = np.expand_dims(chw, axis=0)  # add batch dim
    return batched.astype(np.float32)
