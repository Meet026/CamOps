import os
import numpy as np
import pytest
from src.embedder import VehicleEmbedder, EmbedderError

MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"
)


def test_missing_model_file_raises_typed_error():
    with pytest.raises(EmbedderError) as exc_info:
        VehicleEmbedder("/nonexistent/path/model.onnx")
    assert exc_info.value.reason == "MODEL_FILE_MISSING"


def test_corrupt_model_file_raises_typed_error(tmp_path):
    fake_model = tmp_path / "corrupt.onnx"
    fake_model.write_bytes(b"not a real onnx file")
    with pytest.raises(EmbedderError) as exc_info:
        VehicleEmbedder(str(fake_model))
    assert exc_info.value.reason == "MODEL_LOAD_FAILED"


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_loads_real_model_and_exposes_input_dimensions():
    embedder = VehicleEmbedder(MODEL_PATH)
    assert embedder.input_height > 0
    assert embedder.input_width > 0


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_embed_valid_input_returns_512dim_vector_with_stable_nonzero_norm():
    # NOTE: the model card states the output is "L2-normalized", but the
    # real ONNX file's output norm was empirically measured at ~6.4-7.0,
    # not 1.0, across multiple input types (random, zeros, ImageNet-
    # normalized realistic). This does not break cosine-similarity scoring
    # in evaluate.py (cosine similarity divides by each vector's own norm,
    # so it's scale-invariant regardless), but it means the model card's
    # "L2-normalized" claim should not be trusted verbatim by any future
    # code that assumes unit norm without re-normalizing. See
    # AI Registry/docs/architecture/vehicle-reid-phase0-architecture.md
    # for this documented discrepancy.
    embedder = VehicleEmbedder(MODEL_PATH)
    fake_input = np.random.rand(
        1, 3, embedder.input_height, embedder.input_width
    ).astype(np.float32)

    result = embedder.embed(fake_input)

    assert result.shape == (512,)
    assert result.dtype == np.float32
    norm = np.linalg.norm(result)
    assert norm > 0.1  # non-degenerate output, not all-zeros


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_embed_wrong_shape_raises_typed_error():
    embedder = VehicleEmbedder(MODEL_PATH)
    wrong_shape_input = np.random.rand(1, 3, 10, 10).astype(np.float32)

    with pytest.raises(EmbedderError) as exc_info:
        embedder.embed(wrong_shape_input)
    assert exc_info.value.reason == "MODEL_INPUT_SHAPE_MISMATCH"
