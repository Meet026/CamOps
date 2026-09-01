"""
Loads the pretrained ONNX vehicle Re-ID model and runs inference.

Model-level failures (missing file, corrupt file) are fail-fast: they
raise immediately from the constructor, since a broken model makes every
downstream embedding meaningless. Per-image failures (wrong shape) are
raised per-call so the CLI layer can catch them and skip just that image.
"""
import os
import onnxruntime as ort
import numpy as np


class EmbedderError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


class VehicleEmbedder:
    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            raise EmbedderError(
                "MODEL_FILE_MISSING", f"Model file not found: {model_path}"
            )

        try:
            self._session = ort.InferenceSession(
                model_path, providers=["CPUExecutionProvider"]
            )
        except Exception as e:
            raise EmbedderError(
                "MODEL_LOAD_FAILED", f"ONNX Runtime failed to load model: {e}"
            )

        input_meta = self._session.get_inputs()[0]
        self._input_name = input_meta.name
        # Shape is typically [N, C, H, W]. Some dims may be symbolic (e.g. a
        # string like "batch" or "height") rather than fixed ints, if the
        # model was exported with dynamic axes. We read the actual declared
        # H/W rather than hardcoding a guessed resolution (the model card
        # did not specify exact resize dimensions) — falling back to the
        # common ViT-B/16 default of 224 only when a dimension is symbolic.
        shape = input_meta.shape
        self.input_height = self._resolve_dim(shape[2], default=224)
        self.input_width = self._resolve_dim(shape[3], default=224)

    @staticmethod
    def _resolve_dim(value, default: int) -> int:
        if isinstance(value, int):
            return value
        return default

    def embed(self, image_array: np.ndarray) -> np.ndarray:
        expected_shape = (1, 3, self.input_height, self.input_width)
        if image_array.shape != expected_shape:
            raise EmbedderError(
                "MODEL_INPUT_SHAPE_MISMATCH",
                f"Expected shape {expected_shape}, got {image_array.shape}",
            )

        outputs = self._session.run(None, {self._input_name: image_array})
        embedding = outputs[0][0]  # unwrap batch dimension
        return embedding.astype(np.float32)
