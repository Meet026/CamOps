# Vehicle Re-ID Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT CONSTRAINT — READ BEFORE STARTING:** Never run `git init`, `git add`, or `git commit`. The user manages all version control themselves and reviews changes before committing. Every task ends with "stop — do not commit" instead of a commit step.
>
> **VERIFICATION STYLE — READ BEFORE STARTING:** Do not write separate report/brief markdown files per task. Implement each task's code, run the real test/verify commands for what that task touched, and report results inline. Do not re-run the entire test suite after every small task — run the tests scoped to what you just changed. One full regression pass (`pytest tests/ -v`) happens once, at the very end (the Final Task), not after each task.

**Goal:** Build a local-CPU CLI tool that loads a pretrained vehicle re-identification model (ONNX, CLIP-ReID, VeRi-776-trained), embeds a small set of clean + deliberately-degraded vehicle images, computes a same-vehicle-vs-different-vehicle similarity baseline, and produces a structured report — while handling every edge case (bad input images, model/runtime failures, degraded conditions, dataset/comparison edge cases) without crashing or silently producing wrong results.

**Architecture:** A standalone Python project at `AI Registry/vehicle-reid/`, structured as one file per responsibility (`preprocessing.py`, `embedder.py`, `degrade.py`, `evaluate.py`, `report.py`, `cli.py`). No dependency on `model1-service`. ONNX Runtime with `CPUExecutionProvider` runs the pretrained model; Pillow handles image I/O and degradation; NumPy handles the similarity math. Every module fails in a typed, reportable way — never a raw crash, never a silently wrong number — per the spec's error-handling philosophy (fail-fast for model-level problems, skip-and-continue for per-image problems).

**Tech Stack:** Python 3.12, `onnxruntime` (CPU), `Pillow`, `numpy`, `pytest`, `huggingface_hub` (to fetch the model checkpoint).

**Spec:** `../specs/2026-08-29-vehicle-reid-phase0-design.md`

## Global Constraints

- Never run `git init`/`git add`/`git commit`. No report files per task — inline verification only, one full regression (`pytest tests/ -v`) at the end.
- Model: `occurra/vehicle_vit_clip_reid` from Hugging Face (ONNX, CLIP-ReID, VeRi-776-trained, 512-dim L2-normalized output). Do not substitute a different model — this was verified and chosen deliberately in the spec (torchreid has no vehicle Re-ID support; PVEN is Baidu-Pan-only and was rejected).
- Compute target: local CPU only (`CPUExecutionProvider`). No GPU code paths, no Colab.
- Test data: a subset of the real **VeRi-776** dataset (identity-grouped, real multi-angle photos of the same vehicles) — never generic stock photos, which can't provide multiple angles of one specific vehicle.
- Degraded variants (`blur`, `low_light`, `heavy_crop`, `tiny_resolution`) are generated programmatically from the clean VeRi-776 subset — never sourced from elsewhere.
- True extreme camera-angle variation is explicitly **out of scope** — do not attempt to simulate it; the report must state this as a known, honest gap.
- Error handling: every failure gets a typed reason string (e.g. `CORRUPT_FILE`, `MODEL_INPUT_SHAPE_MISMATCH`) — never a bare stack trace surfacing in report output. Model-file-level failures (missing/corrupt/unloadable ONNX file) are fail-fast at startup, once. Per-image failures are skip-and-continue — one bad file never blocks the rest of the run.
- Low similarity score on a degraded image is a **result**, not an error — it must appear in the report as data, never be dropped or treated as a failure.
- Project uses `pyproject.toml` for dependencies (not a bare `requirements.txt`).
- `models/`, `data/degraded/`, and `reports/` are gitignored (regeneratable/output, not source). `data/clean/` (the VeRi-776 subset) IS committed, since it's the actual test fixture the whole tool depends on and is small (~20-30 images).

---

## File Structure

```
AI Registry/vehicle-reid/
├── pyproject.toml
├── .gitignore
├── README.md
├── src/
│   ├── __init__.py
│   ├── preprocessing.py   — image loading, validation, model-input transform
│   ├── embedder.py        — ONNX model load + inference
│   ├── degrade.py         — clean → degraded image variant generation
│   ├── evaluate.py        — same/different-vehicle similarity scoring
│   ├── report.py          — Markdown + JSON report generation
│   └── cli.py             — entry point wiring everything together
├── scripts/
│   └── fetch_model.py     — one-time download of the ONNX checkpoint
├── models/                 (gitignored — created by fetch_model.py)
├── data/
│   ├── clean/              (committed — VeRi-776 subset, by vehicle_id)
│   └── degraded/           (gitignored — generated by degrade.py)
├── reports/                (gitignored — CLI output)
└── tests/
    ├── __init__.py
    ├── conftest.py         — shared pytest fixtures (tiny fake images, etc.)
    ├── test_preprocessing.py
    ├── test_embedder.py
    ├── test_degrade.py
    ├── test_evaluate.py
    ├── test_report.py
    └── test_cli_end_to_end.py
```

---

## Task 1: Project Scaffold + Model Fetch Script

**Files:**
- Create: `AI Registry/vehicle-reid/pyproject.toml`
- Create: `AI Registry/vehicle-reid/.gitignore`
- Create: `AI Registry/vehicle-reid/src/__init__.py`
- Create: `AI Registry/vehicle-reid/scripts/fetch_model.py`
- Create: `AI Registry/vehicle-reid/tests/__init__.py`
- Test: `AI Registry/vehicle-reid/tests/test_fetch_model.py`

**Interfaces:**
- Produces: `scripts/fetch_model.py`'s `fetch_model(dest_dir: str) -> str` — downloads the ONNX checkpoint into `dest_dir`, returns the full path to the `.onnx` file. Later tasks (`embedder.py`) load the model from this returned path.

- [ ] **Step 1: Create the project scaffold files**

`AI Registry/vehicle-reid/pyproject.toml`:
```toml
[project]
name = "vehicle-reid-phase0"
version = "0.1.0"
description = "Phase 0 proof-of-concept: pretrained vehicle re-identification baseline"
requires-python = ">=3.12"
dependencies = [
    "onnxruntime>=1.18",
    "Pillow>=10.4",
    "numpy>=1.26",
    "huggingface_hub>=0.24",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`AI Registry/vehicle-reid/.gitignore`:
```
models/
data/degraded/
reports/
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
```

`AI Registry/vehicle-reid/src/__init__.py`: empty file.
`AI Registry/vehicle-reid/tests/__init__.py`: empty file.

- [ ] **Step 2: Write the failing test for fetch_model**

```python
# AI Registry/vehicle-reid/tests/test_fetch_model.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from fetch_model import fetch_model


def test_fetch_model_returns_path_to_onnx_file(tmp_path):
    dest_dir = str(tmp_path / "models")
    result_path = fetch_model(dest_dir)

    assert os.path.exists(result_path)
    assert result_path.endswith(".onnx")


def test_fetch_model_is_idempotent_does_not_redownload(tmp_path):
    dest_dir = str(tmp_path / "models")
    first_path = fetch_model(dest_dir)
    first_mtime = os.path.getmtime(first_path)

    second_path = fetch_model(dest_dir)
    second_mtime = os.path.getmtime(second_path)

    assert first_path == second_path
    assert first_mtime == second_mtime
```

**Note for implementer:** these two tests make a real network call to Hugging Face (no mocking) — this is intentional for Phase 0, since the whole point of this task is confirming the real model is genuinely downloadable. If there is no network access in the execution environment, mark both tests `@pytest.mark.skip(reason="requires network access")` and proceed to Step 3 anyway — the implementation must still be written correctly.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd "AI Registry/vehicle-reid" && python3 -m pip install -e ".[dev]" && pytest tests/test_fetch_model.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fetch_model'` (file doesn't exist yet)

- [ ] **Step 4: Implement fetch_model.py**

```python
# AI Registry/vehicle-reid/scripts/fetch_model.py
"""
Downloads the Phase 0 pretrained vehicle Re-ID checkpoint from Hugging Face.

Model: occurra/vehicle_vit_clip_reid (ONNX, CLIP-ReID, VeRi-776-trained).
See AI Registry/docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md
section 2 for why this model was chosen over the research doc's original
torchreid/PVEN pick (both were verified non-viable).
"""
import os
from huggingface_hub import hf_hub_download

MODEL_REPO = "occurra/vehicle_vit_clip_reid"
MODEL_FILENAME = "vehicle_vit_clip_reid.onnx"


def fetch_model(dest_dir: str) -> str:
    """
    Downloads the ONNX checkpoint into dest_dir if not already present.
    Returns the full path to the .onnx file. Idempotent — re-running with
    the same dest_dir does not re-download.
    """
    os.makedirs(dest_dir, exist_ok=True)
    local_path = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=MODEL_FILENAME,
        local_dir=dest_dir,
    )
    return local_path


if __name__ == "__main__":
    default_dest = os.path.join(os.path.dirname(__file__), "..", "models")
    path = fetch_model(default_dest)
    print(f"Model ready at: {path}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/test_fetch_model.py -v`
Expected: PASS (or SKIPPED if network access was unavailable and you added the skip marker in Step 2)

- [ ] **Step 6: Actually fetch the model for use in later tasks**

Run: `python3 scripts/fetch_model.py`
Expected output: `Model ready at: AI Registry/vehicle-reid/models/vehicle_vit_clip_reid.onnx`

This model file is needed by Task 2 onward — if this step fails (network unavailable, repo access issue), stop and report the exact error before continuing; do not proceed to Task 2 without a working model file.

- [ ] **Step 7: Stop — do not commit**

---

## Task 2: Model Input Inspection + Embedder Core

**Files:**
- Create: `AI Registry/vehicle-reid/src/embedder.py`
- Test: `AI Registry/vehicle-reid/tests/test_embedder.py`

**Interfaces:**
- Consumes: the `.onnx` file path from Task 1's `fetch_model()` (or a hardcoded `models/vehicle_vit_clip_reid.onnx` relative path — same file).
- Produces:
  - `embedder.py`'s `EmbedderError(Exception)` — raised for all model-level failures, carries a `.reason: str` attribute (one of `"MODEL_FILE_MISSING"`, `"MODEL_LOAD_FAILED"`, `"MODEL_INPUT_SHAPE_MISMATCH"`).
  - `embedder.py`'s `VehicleEmbedder` class:
    - `VehicleEmbedder(model_path: str)` — constructor; raises `EmbedderError("MODEL_FILE_MISSING")` if the file doesn't exist, `EmbedderError("MODEL_LOAD_FAILED")` if ONNX Runtime can't load it. On success, exposes `self.input_height: int` and `self.input_width: int` read from the model's actual declared input shape (never hardcoded — see Step 4 rationale).
    - `.embed(image_array: numpy.ndarray) -> numpy.ndarray` — takes a preprocessed `(1, 3, H, W)` float32 NCHW array, returns a `(512,)` float32 L2-normalized embedding. Raises `EmbedderError("MODEL_INPUT_SHAPE_MISMATCH")` if `image_array`'s shape doesn't match `(1, 3, self.input_height, self.input_width)`.

- [ ] **Step 1: Write the failing tests**

```python
# AI Registry/vehicle-reid/tests/test_embedder.py
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
def test_embed_valid_input_returns_512dim_normalized_vector():
    embedder = VehicleEmbedder(MODEL_PATH)
    fake_input = np.random.rand(
        1, 3, embedder.input_height, embedder.input_width
    ).astype(np.float32)

    result = embedder.embed(fake_input)

    assert result.shape == (512,)
    assert result.dtype == np.float32
    norm = np.linalg.norm(result)
    assert abs(norm - 1.0) < 0.01  # L2-normalized


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_embed_wrong_shape_raises_typed_error():
    embedder = VehicleEmbedder(MODEL_PATH)
    wrong_shape_input = np.random.rand(1, 3, 10, 10).astype(np.float32)

    with pytest.raises(EmbedderError) as exc_info:
        embedder.embed(wrong_shape_input)
    assert exc_info.value.reason == "MODEL_INPUT_SHAPE_MISMATCH"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_embedder.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.embedder'`

- [ ] **Step 3: Implement embedder.py**

```python
# AI Registry/vehicle-reid/src/embedder.py
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
        # Shape is typically [N, C, H, W] or ['batch', 3, H, W]. We read the
        # actual declared H/W rather than hardcoding a guessed resolution
        # (the model card did not specify exact resize dimensions).
        shape = input_meta.shape
        self.input_height = int(shape[2])
        self.input_width = int(shape[3])

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_embedder.py -v`
Expected: PASS for the two error-handling tests unconditionally. The three model-dependent tests PASS if `models/vehicle_vit_clip_reid.onnx` exists (from Task 1 Step 6), otherwise SKIPPED.

**If a model-dependent test fails (not skipped) with a shape-related error:** the model's declared input shape may use symbolic dimensions (e.g. `"height"` string instead of an int) rather than fixed integers. If so, stop and report the exact `input_meta.shape` value you observed — this needs a small fix to `embedder.py`'s shape-reading logic (e.g. falling back to a known default like 224 when a dimension is symbolic) before continuing, and that fix should be based on what the model actually reports, not a guess.

- [ ] **Step 5: Stop — do not commit**

---

## Task 3: Image Preprocessing + Validation

**Files:**
- Create: `AI Registry/vehicle-reid/src/preprocessing.py`
- Test: `AI Registry/vehicle-reid/tests/test_preprocessing.py`
- Create: `AI Registry/vehicle-reid/tests/conftest.py`

**Interfaces:**
- Consumes: `embedder.input_height` / `embedder.input_width` (from Task 2) as the target resize dimensions.
- Produces:
  - `preprocessing.py`'s `PreprocessingError(Exception)` — carries `.reason: str` (one of `"CORRUPT_FILE"`, `"UNREADABLE_FORMAT"`, `"EMPTY_FILE"`).
  - `preprocessing.py`'s `load_and_validate(file_path: str) -> PIL.Image.Image` — opens and validates an image file, converts to RGB if needed (logs a note via return value, see below), raises `PreprocessingError` with the appropriate reason for bad files. Returns a valid PIL Image in RGB mode on success.
  - `preprocessing.py`'s `to_model_input(image: PIL.Image.Image, target_height: int, target_width: int) -> numpy.ndarray` — resizes, converts to CHW float32, applies ImageNet normalization (mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`, RGB order — the values conventionally meant by "ImageNet normalization" as stated on the model card), adds the batch dimension. Returns a `(1, 3, target_height, target_width)` array ready for `VehicleEmbedder.embed()`.

- [ ] **Step 1: Write the failing tests + shared fixtures**

```python
# AI Registry/vehicle-reid/tests/conftest.py
import os
import pytest
from PIL import Image
import numpy as np


@pytest.fixture
def valid_rgb_image_path(tmp_path):
    path = tmp_path / "valid.jpg"
    img = Image.fromarray(
        (np.random.rand(100, 150, 3) * 255).astype(np.uint8), mode="RGB"
    )
    img.save(path)
    return str(path)


@pytest.fixture
def grayscale_image_path(tmp_path):
    path = tmp_path / "grayscale.jpg"
    img = Image.fromarray(
        (np.random.rand(100, 150) * 255).astype(np.uint8), mode="L"
    )
    img.save(path)
    return str(path)


@pytest.fixture
def cmyk_image_path(tmp_path):
    path = tmp_path / "cmyk.tif"
    img = Image.fromarray(
        (np.random.rand(100, 150, 4) * 255).astype(np.uint8), mode="CMYK"
    )
    img.save(path)
    return str(path)


@pytest.fixture
def empty_file_path(tmp_path):
    path = tmp_path / "empty.jpg"
    path.write_bytes(b"")
    return str(path)


@pytest.fixture
def corrupt_file_path(tmp_path):
    path = tmp_path / "corrupt.jpg"
    path.write_bytes(b"this is not a real jpeg file, just garbage bytes")
    return str(path)


@pytest.fixture
def non_image_file_path(tmp_path):
    path = tmp_path / "readme.txt"
    path.write_text("this is a text file, not an image")
    return str(path)
```

```python
# AI Registry/vehicle-reid/tests/test_preprocessing.py
import os
import numpy as np
from PIL import Image
import pytest
from src.preprocessing import load_and_validate, to_model_input, PreprocessingError


def test_load_valid_rgb_image_succeeds(valid_rgb_image_path):
    img = load_and_validate(valid_rgb_image_path)
    assert img.mode == "RGB"


def test_load_grayscale_image_converts_to_rgb(grayscale_image_path):
    img = load_and_validate(grayscale_image_path)
    assert img.mode == "RGB"


def test_load_cmyk_image_converts_to_rgb(cmyk_image_path):
    img = load_and_validate(cmyk_image_path)
    assert img.mode == "RGB"


def test_load_empty_file_raises_typed_error(empty_file_path):
    with pytest.raises(PreprocessingError) as exc_info:
        load_and_validate(empty_file_path)
    assert exc_info.value.reason == "EMPTY_FILE"


def test_load_corrupt_file_raises_typed_error(corrupt_file_path):
    with pytest.raises(PreprocessingError) as exc_info:
        load_and_validate(corrupt_file_path)
    assert exc_info.value.reason == "CORRUPT_FILE"


def test_load_non_image_file_raises_typed_error(non_image_file_path):
    with pytest.raises(PreprocessingError) as exc_info:
        load_and_validate(non_image_file_path)
    assert exc_info.value.reason == "UNREADABLE_FORMAT"


def test_load_missing_file_raises_typed_error():
    with pytest.raises(PreprocessingError) as exc_info:
        load_and_validate("/nonexistent/image.jpg")
    assert exc_info.value.reason == "CORRUPT_FILE"


def test_to_model_input_produces_correct_shape(valid_rgb_image_path):
    img = load_and_validate(valid_rgb_image_path)
    result = to_model_input(img, target_height=224, target_width=224)

    assert result.shape == (1, 3, 224, 224)
    assert result.dtype == np.float32


def test_to_model_input_applies_normalization_not_raw_pixels(valid_rgb_image_path):
    img = load_and_validate(valid_rgb_image_path)
    result = to_model_input(img, target_height=224, target_width=224)

    # Raw pixel values are 0-255; ImageNet-normalized values are roughly
    # in [-2.5, 2.5]. If normalization was skipped, this assertion catches it.
    assert result.max() <= 3.0
    assert result.min() >= -3.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_preprocessing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.preprocessing'`

- [ ] **Step 3: Implement preprocessing.py**

```python
# AI Registry/vehicle-reid/src/preprocessing.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_preprocessing.py -v`
Expected: PASS — all 9 tests

- [ ] **Step 5: Stop — do not commit**

---

## Task 4: Degraded Image Variant Generation

**Files:**
- Create: `AI Registry/vehicle-reid/src/degrade.py`
- Test: `AI Registry/vehicle-reid/tests/test_degrade.py`

**Interfaces:**
- Consumes: `preprocessing.load_and_validate()` (Task 3) to load the source image before degrading it.
- Produces: `degrade.py`'s `DEGRADATION_CONDITIONS: list[str]` = `["blur", "low_light", "heavy_crop", "tiny_resolution"]`, and `degrade.py`'s `apply_degradation(image: PIL.Image.Image, condition: str) -> PIL.Image.Image` — returns a new degraded PIL Image; raises `ValueError` for an unrecognized condition name (a programmer error, not a data error, so a plain exception is correct here rather than a typed reason).

- [ ] **Step 1: Write the failing tests**

```python
# AI Registry/vehicle-reid/tests/test_degrade.py
import numpy as np
from PIL import Image
import pytest
from src.degrade import apply_degradation, DEGRADATION_CONDITIONS


@pytest.fixture
def source_image():
    # A structured (non-random) image so blur/crop effects are measurable —
    # a checkerboard pattern has clear high-frequency detail to blur away.
    arr = np.zeros((200, 300, 3), dtype=np.uint8)
    arr[::10, :, :] = 255
    arr[:, ::10, :] = 255
    return Image.fromarray(arr, mode="RGB")


def test_all_declared_conditions_are_supported(source_image):
    for condition in DEGRADATION_CONDITIONS:
        result = apply_degradation(source_image, condition)
        assert isinstance(result, Image.Image)


def test_unrecognized_condition_raises_value_error(source_image):
    with pytest.raises(ValueError):
        apply_degradation(source_image, "not_a_real_condition")


def test_blur_actually_changes_pixel_data(source_image):
    result = apply_degradation(source_image, "blur")
    original_arr = np.asarray(source_image, dtype=np.float32)
    result_arr = np.asarray(result.resize(source_image.size), dtype=np.float32)
    difference = np.mean(np.abs(original_arr - result_arr))
    assert difference > 1.0  # meaningfully different, not a no-op


def test_low_light_reduces_average_brightness(source_image):
    result = apply_degradation(source_image, "low_light")
    original_brightness = np.mean(np.asarray(source_image, dtype=np.float32))
    result_brightness = np.mean(np.asarray(result, dtype=np.float32))
    assert result_brightness < original_brightness


def test_heavy_crop_reduces_image_area(source_image):
    result = apply_degradation(source_image, "heavy_crop")
    original_area = source_image.size[0] * source_image.size[1]
    result_area = result.size[0] * result.size[1]
    assert result_area < original_area


def test_tiny_resolution_reduces_effective_detail(source_image):
    result = apply_degradation(source_image, "tiny_resolution")
    # Effective detail loss: downscale-then-upscale should measurably blur
    # out the checkerboard pattern even though final dimensions match.
    result_same_size = result.resize(source_image.size)
    original_arr = np.asarray(source_image, dtype=np.float32)
    result_arr = np.asarray(result_same_size, dtype=np.float32)
    difference = np.mean(np.abs(original_arr - result_arr))
    assert difference > 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_degrade.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.degrade'`

- [ ] **Step 3: Implement degrade.py**

```python
# AI Registry/vehicle-reid/src/degrade.py
"""
Generates deliberately degraded variants of clean vehicle images to test
the Re-ID model under real-world-like conditions. Degradation severity
values below were chosen to be clearly visible/measurable, not subtle —
Phase 0's goal is an honest stress-test, not a marginal one.

True extreme camera-angle variation is NOT simulated here — it cannot be
produced from a single existing photo without a 3D model or a genuinely
different real photo, and faking it with a crude 2D transform would
misrepresent what was actually tested. This is a documented, honest gap
(see spec section 4), not an oversight.
"""
from PIL import Image, ImageFilter, ImageEnhance

DEGRADATION_CONDITIONS = ["blur", "low_light", "heavy_crop", "tiny_resolution"]


def apply_degradation(image: Image.Image, condition: str) -> Image.Image:
    if condition == "blur":
        return image.filter(ImageFilter.GaussianBlur(radius=6))

    if condition == "low_light":
        enhancer = ImageEnhance.Brightness(image)
        darkened = enhancer.enhance(0.35)  # 35% of original brightness
        contrast_enhancer = ImageEnhance.Contrast(darkened)
        return contrast_enhancer.enhance(0.7)

    if condition == "heavy_crop":
        width, height = image.size
        # Crop to the bottom-right 50% — simulates a vehicle partially out
        # of frame, cutting through the middle of the subject.
        return image.crop((width // 2, height // 2, width, height))

    if condition == "tiny_resolution":
        width, height = image.size
        tiny_width, tiny_height = max(1, width // 8), max(1, height // 8)
        downscaled = image.resize((tiny_width, tiny_height), Image.BILINEAR)
        return downscaled.resize((width, height), Image.BILINEAR)

    raise ValueError(
        f"Unrecognized degradation condition: {condition!r}. "
        f"Valid conditions: {DEGRADATION_CONDITIONS}"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_degrade.py -v`
Expected: PASS — all 7 tests

- [ ] **Step 5: Stop — do not commit**

---

## Task 5: VeRi-776 Test Subset Acquisition

**Files:**
- Create: `AI Registry/vehicle-reid/scripts/prepare_test_data.py`
- Create: `AI Registry/vehicle-reid/data/clean/` (populated with real images)
- Test: `AI Registry/vehicle-reid/tests/test_prepare_test_data.py`

**Interfaces:**
- Produces: `data/clean/<vehicle_id>/<image_name>.jpg` — real VeRi-776 images, grouped by vehicle identity, at least 3 distinct vehicles with 2+ images each (needed for same-vehicle pairs) plus at least 2 additional single-image vehicles (needed for different-vehicle pairs). This populated folder is what `evaluate.py` (Task 6) and `cli.py` (Task 7) read as their test fixture.

- [ ] **Step 1: Write the failing test that validates the acquired dataset's structure**

```python
# AI Registry/vehicle-reid/tests/test_prepare_test_data.py
import os
import pytest

CLEAN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "clean")


@pytest.mark.skipif(
    not os.path.isdir(CLEAN_DATA_DIR) or not os.listdir(CLEAN_DATA_DIR),
    reason="data/clean/ not populated yet — run scripts/prepare_test_data.py first",
)
def test_at_least_five_vehicle_identities_present():
    vehicle_dirs = [
        d for d in os.listdir(CLEAN_DATA_DIR)
        if os.path.isdir(os.path.join(CLEAN_DATA_DIR, d))
    ]
    assert len(vehicle_dirs) >= 5


@pytest.mark.skipif(
    not os.path.isdir(CLEAN_DATA_DIR) or not os.listdir(CLEAN_DATA_DIR),
    reason="data/clean/ not populated yet — run scripts/prepare_test_data.py first",
)
def test_at_least_three_vehicles_have_multiple_images():
    vehicle_dirs = [
        d for d in os.listdir(CLEAN_DATA_DIR)
        if os.path.isdir(os.path.join(CLEAN_DATA_DIR, d))
    ]
    multi_image_count = sum(
        1
        for d in vehicle_dirs
        if len(os.listdir(os.path.join(CLEAN_DATA_DIR, d))) >= 2
    )
    assert multi_image_count >= 3


@pytest.mark.skipif(
    not os.path.isdir(CLEAN_DATA_DIR) or not os.listdir(CLEAN_DATA_DIR),
    reason="data/clean/ not populated yet — run scripts/prepare_test_data.py first",
)
def test_every_image_file_is_actually_a_valid_image():
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from src.preprocessing import load_and_validate

    for vehicle_dir in os.listdir(CLEAN_DATA_DIR):
        full_dir = os.path.join(CLEAN_DATA_DIR, vehicle_dir)
        if not os.path.isdir(full_dir):
            continue
        for image_name in os.listdir(full_dir):
            image_path = os.path.join(full_dir, image_name)
            load_and_validate(image_path)  # raises if invalid
```

- [ ] **Step 2: Run the test to confirm it's currently skipped (no data yet)**

Run: `pytest tests/test_prepare_test_data.py -v`
Expected: SKIPPED (all 3 tests) — confirms the test correctly detects the empty state

- [ ] **Step 3: Write prepare_test_data.py**

```python
# AI Registry/vehicle-reid/scripts/prepare_test_data.py
"""
Populates data/clean/ with a small subset of the VeRi-776 dataset, grouped
by vehicle identity, for Phase 0's same-vehicle-vs-different-vehicle test.

VeRi-776 is not redistributed via a simple pip/huggingface_hub download —
the canonical source requires requesting access from the dataset authors
(https://github.com/JDAI-CV/VeRidataset). This script does NOT attempt to
auto-download it; that would either fail silently or require credentials
this environment doesn't have.

Instead, this script expects the user to have already placed a raw VeRi-776
"image_query" or "image_test" folder (however they obtained it) at the path
given by --source, and reorganizes a small subset of it into this project's
data/clean/<vehicle_id>/ layout. VeRi-776 filenames encode the vehicle ID as
the first 4 digits (e.g. "0002_c002_00030600_0.jpg" -> vehicle_id "0002"),
which is what this script parses to do the grouping.
"""
import argparse
import os
import shutil
from collections import defaultdict

MIN_VEHICLES = 5
MIN_MULTI_IMAGE_VEHICLES = 3
IMAGES_PER_MULTI_VEHICLE = 3
IMAGES_PER_SINGLE_VEHICLE = 1


def parse_vehicle_id(filename: str) -> str:
    # VeRi-776 filenames: "<vehicle_id>_<camera_id>_<frame>_<index>.jpg"
    return filename.split("_")[0]


def build_subset(source_dir: str, dest_dir: str) -> None:
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(
            f"Source VeRi-776 folder not found: {source_dir}\n"
            f"Download VeRi-776 from https://github.com/JDAI-CV/VeRidataset "
            f"(requires requesting access from the dataset authors) and pass "
            f"its image folder as --source."
        )

    by_vehicle = defaultdict(list)
    for filename in os.listdir(source_dir):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        vehicle_id = parse_vehicle_id(filename)
        by_vehicle[vehicle_id].append(filename)

    multi_image_ids = [vid for vid, files in by_vehicle.items() if len(files) >= 2]
    single_image_ids = [vid for vid, files in by_vehicle.items() if len(files) == 1]

    if len(multi_image_ids) < MIN_MULTI_IMAGE_VEHICLES:
        raise ValueError(
            f"Source folder only has {len(multi_image_ids)} vehicles with "
            f"multiple images; need at least {MIN_MULTI_IMAGE_VEHICLES}."
        )

    os.makedirs(dest_dir, exist_ok=True)
    selected_multi = multi_image_ids[:MIN_MULTI_IMAGE_VEHICLES]
    selected_single = single_image_ids[: max(0, MIN_VEHICLES - len(selected_multi))]

    for vehicle_id in selected_multi:
        vehicle_dest = os.path.join(dest_dir, vehicle_id)
        os.makedirs(vehicle_dest, exist_ok=True)
        for filename in by_vehicle[vehicle_id][:IMAGES_PER_MULTI_VEHICLE]:
            shutil.copy(
                os.path.join(source_dir, filename),
                os.path.join(vehicle_dest, filename),
            )

    for vehicle_id in selected_single:
        vehicle_dest = os.path.join(dest_dir, vehicle_id)
        os.makedirs(vehicle_dest, exist_ok=True)
        for filename in by_vehicle[vehicle_id][:IMAGES_PER_SINGLE_VEHICLE]:
            shutil.copy(
                os.path.join(source_dir, filename),
                os.path.join(vehicle_dest, filename),
            )

    print(
        f"Prepared {len(selected_multi) + len(selected_single)} vehicle "
        f"identities ({len(selected_multi)} multi-image, "
        f"{len(selected_single)} single-image) at {dest_dir}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", required=True, help="Path to a raw VeRi-776 image folder"
    )
    parser.add_argument(
        "--dest",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"),
        help="Destination folder (default: data/clean/)",
    )
    args = parser.parse_args()
    build_subset(args.source, args.dest)
```

- [ ] **Step 4: Run prepare_test_data.py against a real VeRi-776 source**

This step requires a real VeRi-776 image folder, which is gated behind a
dataset access request (see the script's own docstring). **Stop here and
tell the project owner:**

> "VeRi-776 requires requesting dataset access from https://github.com/JDAI-CV/VeRidataset (or an equivalent mirror) before I can populate `data/clean/`. Please obtain the dataset (or point me to a folder you've already downloaded) and tell me the path, then I'll run: `python3 scripts/prepare_test_data.py --source <your-path>`"

Do not fabricate placeholder images to fill this gap — the spec explicitly
requires real VeRi-776 photos with genuine multi-angle same-vehicle
groupings, which synthetic images cannot provide.

Once a real source path is available, run:
`python3 scripts/prepare_test_data.py --source <path>`
Expected output: `Prepared N vehicle identities (...) at .../data/clean`

- [ ] **Step 5: Run the dataset-structure tests to verify they now pass**

Run: `pytest tests/test_prepare_test_data.py -v`
Expected: PASS — all 3 tests (no longer skipped)

- [ ] **Step 6: Stop — do not commit**

---

## Task 6: Similarity Evaluation

**Files:**
- Create: `AI Registry/vehicle-reid/src/evaluate.py`
- Test: `AI Registry/vehicle-reid/tests/test_evaluate.py`

**Interfaces:**
- Consumes: a list of `(vehicle_id: str, embedding: numpy.ndarray)` tuples (produced by wiring together Tasks 2-4 in Task 7's CLI).
- Produces:
  - `evaluate.py`'s `EvaluationResult` — a plain dataclass with fields `same_vehicle_mean: float | None`, `different_vehicle_mean: float | None`, `separation_gap: float | None`, `same_vehicle_pair_count: int`, `different_vehicle_pair_count: int`, `notes: list[str]` (human-readable explanations for any `None` field, e.g. `"Cannot compute same_vehicle_mean: no vehicle has more than 1 image"`).
  - `evaluate.py`'s `evaluate_embeddings(items: list[tuple[str, numpy.ndarray]]) -> EvaluationResult` — computes cosine similarity for every pair, splits into same-vehicle/different-vehicle groups, returns the result. Never raises — insufficient data produces `None` fields + explanatory `notes`, not an exception, since "cannot compute X" is a valid, reportable outcome per the spec's error-handling philosophy.

- [ ] **Step 1: Write the failing tests**

```python
# AI Registry/vehicle-reid/tests/test_evaluate.py
import numpy as np
from src.evaluate import evaluate_embeddings


def make_embedding(seed: int) -> np.ndarray:
    rng = np.random.RandomState(seed)
    vec = rng.rand(512).astype(np.float32)
    return vec / np.linalg.norm(vec)


def test_typical_case_computes_both_means_and_gap():
    items = [
        ("car_a", make_embedding(1)),
        ("car_a", make_embedding(1)),  # near-identical embedding, same vehicle
        ("car_b", make_embedding(99)),
        ("car_c", make_embedding(200)),
    ]
    result = evaluate_embeddings(items)

    assert result.same_vehicle_mean is not None
    assert result.different_vehicle_mean is not None
    assert result.separation_gap is not None
    assert result.same_vehicle_pair_count == 1
    assert result.different_vehicle_pair_count > 0


def test_single_image_total_reports_none_with_note():
    items = [("car_a", make_embedding(1))]
    result = evaluate_embeddings(items)

    assert result.same_vehicle_mean is None
    assert result.different_vehicle_mean is None
    assert len(result.notes) >= 1


def test_all_same_vehicle_has_no_different_vehicle_pairs():
    items = [
        ("car_a", make_embedding(1)),
        ("car_a", make_embedding(2)),
        ("car_a", make_embedding(3)),
    ]
    result = evaluate_embeddings(items)

    assert result.same_vehicle_mean is not None
    assert result.different_vehicle_mean is None
    assert result.different_vehicle_pair_count == 0
    assert any("different" in note.lower() for note in result.notes)


def test_all_different_vehicles_has_no_same_vehicle_pairs():
    items = [
        ("car_a", make_embedding(1)),
        ("car_b", make_embedding(2)),
        ("car_c", make_embedding(3)),
    ]
    result = evaluate_embeddings(items)

    assert result.same_vehicle_mean is None
    assert result.different_vehicle_mean is not None
    assert result.same_vehicle_pair_count == 0
    assert any("same" in note.lower() for note in result.notes)


def test_empty_input_reports_none_with_note():
    result = evaluate_embeddings([])

    assert result.same_vehicle_mean is None
    assert result.different_vehicle_mean is None
    assert len(result.notes) >= 1


def test_duplicate_identical_embeddings_scores_maximum_similarity():
    embedding = make_embedding(42)
    items = [
        ("car_a", embedding),
        ("car_a", embedding.copy()),
        ("car_b", make_embedding(7)),
    ]
    result = evaluate_embeddings(items)

    assert result.same_vehicle_mean > 0.99  # identical vectors -> cosine sim ~1.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_evaluate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.evaluate'`

- [ ] **Step 3: Implement evaluate.py**

```python
# AI Registry/vehicle-reid/src/evaluate.py
"""
Computes the same-vehicle-vs-different-vehicle cosine similarity baseline.

Insufficient data (e.g. only one image total, or every image belonging to
the same vehicle) never raises an exception — it's a valid, reportable
outcome ("cannot compute X because Y"), consistent with the spec's
principle that a missing result is data, not a crash.
"""
from dataclasses import dataclass, field
from itertools import combinations
import numpy as np


@dataclass
class EvaluationResult:
    same_vehicle_mean: float | None = None
    different_vehicle_mean: float | None = None
    separation_gap: float | None = None
    same_vehicle_pair_count: int = 0
    different_vehicle_pair_count: int = 0
    notes: list[str] = field(default_factory=list)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def evaluate_embeddings(items: list[tuple[str, np.ndarray]]) -> EvaluationResult:
    result = EvaluationResult()

    if len(items) < 2:
        result.notes.append(
            f"Cannot compute any similarity: need at least 2 images, got {len(items)}."
        )
        return result

    same_vehicle_scores = []
    different_vehicle_scores = []

    for (vehicle_a, embedding_a), (vehicle_b, embedding_b) in combinations(items, 2):
        score = _cosine_similarity(embedding_a, embedding_b)
        if vehicle_a == vehicle_b:
            same_vehicle_scores.append(score)
        else:
            different_vehicle_scores.append(score)

    result.same_vehicle_pair_count = len(same_vehicle_scores)
    result.different_vehicle_pair_count = len(different_vehicle_scores)

    if same_vehicle_scores:
        result.same_vehicle_mean = float(np.mean(same_vehicle_scores))
    else:
        result.notes.append(
            "Cannot compute same_vehicle_mean: no vehicle has more than 1 image "
            "in this dataset (no same-vehicle pairs available)."
        )

    if different_vehicle_scores:
        result.different_vehicle_mean = float(np.mean(different_vehicle_scores))
    else:
        result.notes.append(
            "Cannot compute different_vehicle_mean: all images belong to the "
            "same vehicle (no different-vehicle pairs available)."
        )

    if result.same_vehicle_mean is not None and result.different_vehicle_mean is not None:
        result.separation_gap = result.same_vehicle_mean - result.different_vehicle_mean

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_evaluate.py -v`
Expected: PASS — all 7 tests

- [ ] **Step 5: Stop — do not commit**

---

## Task 7: Report Generation

**Files:**
- Create: `AI Registry/vehicle-reid/src/report.py`
- Test: `AI Registry/vehicle-reid/tests/test_report.py`

**Interfaces:**
- Consumes: `evaluate.EvaluationResult` (Task 6, one per condition), plus a list of skipped-file records `(file_path: str, reason: str)` (produced by the CLI in Task 8 when `preprocessing`/`embedder` raise typed errors).
- Produces: `report.py`'s `generate_report(results_by_condition: dict[str, EvaluationResult], skipped_files: list[tuple[str, str]], output_dir: str) -> tuple[str, str]` — writes `report.md` and `report.json` into `output_dir`, returns their two paths.

- [ ] **Step 1: Write the failing tests**

```python
# AI Registry/vehicle-reid/tests/test_report.py
import json
import os
from src.evaluate import EvaluationResult
from src.report import generate_report


def test_generates_both_markdown_and_json_files(tmp_path):
    results = {
        "clean": EvaluationResult(
            same_vehicle_mean=0.85,
            different_vehicle_mean=0.40,
            separation_gap=0.45,
            same_vehicle_pair_count=3,
            different_vehicle_pair_count=10,
        )
    }
    skipped = [("bad_image.jpg", "CORRUPT_FILE")]

    md_path, json_path = generate_report(results, skipped, str(tmp_path))

    assert os.path.exists(md_path)
    assert os.path.exists(json_path)
    assert md_path.endswith(".md")
    assert json_path.endswith(".json")


def test_markdown_report_includes_all_conditions_and_skipped_files(tmp_path):
    results = {
        "clean": EvaluationResult(same_vehicle_mean=0.85, different_vehicle_mean=0.40, separation_gap=0.45),
        "blur": EvaluationResult(same_vehicle_mean=0.70, different_vehicle_mean=0.42, separation_gap=0.28),
    }
    skipped = [("corrupt.jpg", "CORRUPT_FILE"), ("tiny.jpg", "EMPTY_FILE")]

    md_path, _ = generate_report(results, skipped, str(tmp_path))
    content = open(md_path).read()

    assert "clean" in content
    assert "blur" in content
    assert "corrupt.jpg" in content
    assert "CORRUPT_FILE" in content
    assert "tiny.jpg" in content


def test_markdown_report_states_known_limitations():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        md_path, _ = generate_report({}, [], tmp_dir)
        content = open(md_path).read()
        assert "extreme" in content.lower() or "angle" in content.lower()


def test_json_report_is_valid_and_matches_markdown_data(tmp_path):
    results = {
        "clean": EvaluationResult(same_vehicle_mean=0.85, different_vehicle_mean=0.40, separation_gap=0.45),
    }
    skipped = []

    _, json_path = generate_report(results, skipped, str(tmp_path))
    data = json.load(open(json_path))

    assert data["conditions"]["clean"]["same_vehicle_mean"] == 0.85
    assert data["conditions"]["clean"]["different_vehicle_mean"] == 0.40


def test_report_handles_condition_with_none_values_gracefully(tmp_path):
    results = {
        "clean": EvaluationResult(notes=["Cannot compute any similarity: need at least 2 images, got 1."]),
    }
    md_path, json_path = generate_report(results, [], str(tmp_path))

    content = open(md_path).read()
    assert "Cannot compute" in content
    data = json.load(open(json_path))
    assert data["conditions"]["clean"]["same_vehicle_mean"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_report.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.report'`

- [ ] **Step 3: Implement report.py**

```python
# AI Registry/vehicle-reid/src/report.py
"""
Generates the Phase 0 output report in both human-readable Markdown and
machine-readable JSON. Every condition's results appear, even ones where
computation was impossible (None values + notes) — a missing result is
reportable data, not something to hide.
"""
import json
import os
from dataclasses import asdict
from src.evaluate import EvaluationResult

KNOWN_LIMITATIONS = (
    "- **Extreme camera-angle variation is not tested.** It cannot be "
    "synthesized from a single existing photo without a 3D model or a "
    "genuinely different real photo; simulating it with a crude 2D "
    "transform would misrepresent what was actually tested. This is a "
    "documented gap for Phase 0, not an oversight — see the design spec, "
    "section 4."
)


def _format_condition_section(name: str, result: EvaluationResult) -> str:
    lines = [f"### Condition: `{name}`", ""]
    if result.same_vehicle_mean is not None:
        lines.append(f"- Same-vehicle mean similarity: **{result.same_vehicle_mean:.4f}** ({result.same_vehicle_pair_count} pairs)")
    if result.different_vehicle_mean is not None:
        lines.append(f"- Different-vehicle mean similarity: **{result.different_vehicle_mean:.4f}** ({result.different_vehicle_pair_count} pairs)")
    if result.separation_gap is not None:
        lines.append(f"- Separation gap: **{result.separation_gap:.4f}**")
    for note in result.notes:
        lines.append(f"- ⚠️ {note}")
    lines.append("")
    return "\n".join(lines)


def generate_report(
    results_by_condition: dict, skipped_files: list, output_dir: str
) -> tuple:
    os.makedirs(output_dir, exist_ok=True)
    md_path = os.path.join(output_dir, "report.md")
    json_path = os.path.join(output_dir, "report.json")

    md_lines = [
        "# Vehicle Re-ID Phase 0 — Baseline Report",
        "",
        "## Results by Condition",
        "",
    ]
    for condition_name, result in results_by_condition.items():
        md_lines.append(_format_condition_section(condition_name, result))

    md_lines.extend(["## Skipped Files", ""])
    if skipped_files:
        for file_path, reason in skipped_files:
            md_lines.append(f"- `{file_path}` — {reason}")
    else:
        md_lines.append("_None — every input file was processed successfully._")
    md_lines.append("")

    md_lines.extend(["## Known Limitations", "", KNOWN_LIMITATIONS, ""])

    with open(md_path, "w") as f:
        f.write("\n".join(md_lines))

    json_data = {
        "conditions": {
            name: asdict(result) for name, result in results_by_condition.items()
        },
        "skipped_files": [
            {"file": path, "reason": reason} for path, reason in skipped_files
        ],
    }
    with open(json_path, "w") as f:
        json.dump(json_data, f, indent=2)

    return md_path, json_path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_report.py -v`
Expected: PASS — all 5 tests

- [ ] **Step 5: Stop — do not commit**

---

## Task 8: CLI Entry Point (Full Wiring) + End-to-End Test

**Files:**
- Create: `AI Registry/vehicle-reid/src/cli.py`
- Test: `AI Registry/vehicle-reid/tests/test_cli_end_to_end.py`
- Create: `AI Registry/vehicle-reid/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-7 — `fetch_model.fetch_model`, `embedder.VehicleEmbedder`/`EmbedderError`, `preprocessing.load_and_validate`/`to_model_input`/`PreprocessingError`, `degrade.apply_degradation`/`DEGRADATION_CONDITIONS`, `evaluate.evaluate_embeddings`, `report.generate_report`.
- Produces: `cli.py`'s `run(clean_data_dir: str, model_path: str, output_dir: str) -> tuple[str, str]` — the full pipeline as one callable function (also exposed as a `python3 -m src.cli` command-line entry point), returns the `(md_report_path, json_report_path)` tuple.

- [ ] **Step 1: Write the end-to-end test using a tiny fixture dataset (not the real VeRi-776 data)**

```python
# AI Registry/vehicle-reid/tests/test_cli_end_to_end.py
import os
import json
import numpy as np
from PIL import Image
import pytest
from src.cli import run

MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"
)


def _make_fixture_dataset(base_dir):
    """Creates a tiny fake clean/ dataset: 2 vehicles with 2 images each,
    1 vehicle with 1 image, plus one deliberately corrupt file to prove
    the run doesn't crash on bad input."""
    clean_dir = os.path.join(base_dir, "clean")

    for vehicle_id, count in [("v001", 2), ("v002", 2), ("v003", 1)]:
        vehicle_dir = os.path.join(clean_dir, vehicle_id)
        os.makedirs(vehicle_dir, exist_ok=True)
        for i in range(count):
            arr = (np.random.rand(120, 160, 3) * 255).astype(np.uint8)
            Image.fromarray(arr, mode="RGB").save(
                os.path.join(vehicle_dir, f"img_{i}.jpg")
            )

    corrupt_dir = os.path.join(clean_dir, "v004")
    os.makedirs(corrupt_dir, exist_ok=True)
    with open(os.path.join(corrupt_dir, "broken.jpg"), "wb") as f:
        f.write(b"not a real image")

    return clean_dir


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_full_run_produces_report_with_all_expected_sections(tmp_path):
    clean_dir = _make_fixture_dataset(str(tmp_path))
    output_dir = str(tmp_path / "reports")

    md_path, json_path = run(clean_dir, MODEL_PATH, output_dir)

    assert os.path.exists(md_path)
    assert os.path.exists(json_path)

    md_content = open(md_path).read()
    assert "clean" in md_content
    assert "blur" in md_content
    assert "low_light" in md_content
    assert "heavy_crop" in md_content
    assert "tiny_resolution" in md_content
    assert "broken.jpg" in md_content  # the corrupt file must be reported, not silently dropped
    assert "Known Limitations" in md_content

    data = json.load(open(json_path))
    assert "clean" in data["conditions"]
    assert len(data["skipped_files"]) >= 1


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_run_does_not_crash_on_missing_model(tmp_path):
    clean_dir = _make_fixture_dataset(str(tmp_path))
    output_dir = str(tmp_path / "reports")

    with pytest.raises(Exception):
        run(clean_dir, "/nonexistent/model.onnx", output_dir)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_cli_end_to_end.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.cli'`

- [ ] **Step 3: Implement cli.py**

```python
# AI Registry/vehicle-reid/src/cli.py
"""
Phase 0 CLI entry point: wires preprocessing -> degradation -> embedding ->
evaluation -> reporting into one full run across every clean image and
every degraded condition.

Model-level failures (missing/corrupt ONNX file) are fail-fast: VehicleEmbedder's
constructor raises immediately and this function does not catch it, since a
broken model makes every downstream result meaningless. Per-image failures
(corrupt file, wrong format, etc.) ARE caught here and recorded as skipped
files — one bad image never stops the run.
"""
import os
import sys

from src.embedder import VehicleEmbedder, EmbedderError
from src.preprocessing import load_and_validate, to_model_input, PreprocessingError
from src.degrade import apply_degradation, DEGRADATION_CONDITIONS
from src.evaluate import evaluate_embeddings
from src.report import generate_report


def _collect_image_paths(clean_data_dir: str) -> list:
    """Returns [(vehicle_id, file_path), ...] for every file under clean_data_dir."""
    items = []
    for vehicle_id in sorted(os.listdir(clean_data_dir)):
        vehicle_dir = os.path.join(clean_data_dir, vehicle_id)
        if not os.path.isdir(vehicle_dir):
            continue
        for filename in sorted(os.listdir(vehicle_dir)):
            items.append((vehicle_id, os.path.join(vehicle_dir, filename)))
    return items


def _embed_all(image_paths, embedder, condition, skipped_files):
    """
    Loads, optionally degrades, and embeds every (vehicle_id, file_path) pair.
    Any PreprocessingError or EmbedderError on a SPECIFIC image is caught,
    recorded in skipped_files, and that image is skipped — never crashes
    the whole run.
    """
    embeddings = []
    for vehicle_id, file_path in image_paths:
        try:
            image = load_and_validate(file_path)
            if condition != "clean":
                image = apply_degradation(image, condition)
            model_input = to_model_input(image, embedder.input_height, embedder.input_width)
            embedding = embedder.embed(model_input)
            embeddings.append((vehicle_id, embedding))
        except PreprocessingError as e:
            skipped_files.append((f"{file_path} [{condition}]", e.reason))
        except EmbedderError as e:
            skipped_files.append((f"{file_path} [{condition}]", e.reason))
    return embeddings


def run(clean_data_dir: str, model_path: str, output_dir: str) -> tuple:
    # Fail-fast: a broken model makes every result meaningless, so this
    # is NOT wrapped in try/except — it propagates immediately.
    embedder = VehicleEmbedder(model_path)

    image_paths = _collect_image_paths(clean_data_dir)
    skipped_files = []

    results_by_condition = {}

    clean_embeddings = _embed_all(image_paths, embedder, "clean", skipped_files)
    results_by_condition["clean"] = evaluate_embeddings(clean_embeddings)

    for condition in DEGRADATION_CONDITIONS:
        condition_embeddings = _embed_all(image_paths, embedder, condition, skipped_files)
        results_by_condition[condition] = evaluate_embeddings(condition_embeddings)

    return generate_report(results_by_condition, skipped_files, output_dir)


if __name__ == "__main__":
    import argparse
    from datetime import datetime

    parser = argparse.ArgumentParser(description="Vehicle Re-ID Phase 0 baseline runner")
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"))
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"))
    parser.add_argument("--output", default=os.path.join(os.path.dirname(__file__), "..", "reports"))
    args = parser.parse_args()

    run_output_dir = os.path.join(args.output, datetime.now().strftime("%Y%m%d_%H%M%S"))
    md_path, json_path = run(args.data, args.model, run_output_dir)
    print(f"Report written to:\n  {md_path}\n  {json_path}")
```

**Note on the `datetime.now()` call above:** this is fine here — it runs only in the CLI's real-world entry point (`if __name__ == "__main__"`), never inside a test or inside `run()` itself, so it introduces no test flakiness.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_cli_end_to_end.py -v`
Expected: PASS (or SKIPPED if the model hasn't been fetched yet — re-run after Task 1 Step 6 completes)

- [ ] **Step 5: Write README.md**

```markdown
# Vehicle Re-ID — Phase 0

Proof-of-concept: measures how a pretrained vehicle re-identification
model (CLIP-ReID, VeRi-776-trained, ONNX) performs on a small set of
real vehicle photos, under both clean and deliberately degraded
conditions (blur, low light, heavy crop, tiny resolution).

See `../docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md`
for the full design rationale, and `../Ai Idea Research.md` for why this
direction was chosen over facial recognition or generic ANPR.

## Setup

```bash
python3 -m pip install -e ".[dev]"
python3 scripts/fetch_model.py
```

Then obtain a VeRi-776 image folder (requires requesting access from
https://github.com/JDAI-CV/VeRidataset) and run:

```bash
python3 scripts/prepare_test_data.py --source /path/to/veri776/images
```

## Running

```bash
python3 -m src.cli
```

Report lands in `reports/<timestamp>/report.md` and `report.json`.

## Testing

```bash
pytest tests/ -v
```

Tests that need the real model or real VeRi-776 data are automatically
skipped if those aren't present yet — this is expected on a fresh clone
before running the setup steps above.
```

- [ ] **Step 6: Stop — do not commit**

---

## Final Task: Full Regression + Known-Gaps Summary

**Files:** none created — verification only.

- [ ] **Step 1: Run the complete test suite**

Run: `cd "AI Registry/vehicle-reid" && pytest tests/ -v`
Expected: every test either PASSES or is SKIPPED with a clear reason (missing model file or missing VeRi-776 data) — zero FAILED, zero ERROR.

- [ ] **Step 2: If the model and real VeRi-776 data are both available, run the real CLI end-to-end**

Run: `python3 -m src.cli`
Expected: a report is produced; open `report.md` and confirm every condition (`clean`, `blur`, `low_light`, `heavy_crop`, `tiny_resolution`) has either real numbers or a clear "cannot compute" note — never a blank/missing section.

- [ ] **Step 3: Write the architecture and QA docs (per spec section 9)**

Create `AI Registry/docs/architecture/vehicle-reid-phase0-architecture.md`,
summarizing what was actually built (not aspirational — mirror
`model1-service/docs/architecture/*.md`'s style of documenting the real,
verified system): the file structure from this plan, the data flow from
Task 8's `run()` function, and the model decision from spec section 2.

Create `AI Registry/docs/testing/phase0-qa.md`, summarizing what was
actually tested (mirror `model1-service/docs/testing/*-qa.md`'s style):
list every test file, what each covers, and the final pass/skip counts
from Step 1 above. State plainly which tests were skipped and why — do
not present skipped tests as passed.

- [ ] **Step 4: Report the final state plainly**

Summarize, without hedging:
- Which tests passed vs. were skipped, and exactly why anything was skipped (missing model / missing VeRi-776 data — name which).
- Whether a real end-to-end report was actually generated, or whether Task 5 (VeRi-776 acquisition) is still blocked on the project owner obtaining dataset access.
- The known, documented gap: extreme camera-angle variation is untested (by design, not oversight — see spec section 4).

- [ ] **Step 5: Stop — do not commit.** All code, tests, docs, and the (if generated) sample report are left for the project owner to review and commit themselves.
