import os
import pytest
from PIL import Image, ImageFile
import numpy as np


@pytest.fixture(autouse=True)
def _reset_pil_load_truncated_images_flag():
    """
    The vendored training/CLIP-ReID/datasets/bases.py sets the GLOBAL,
    process-wide PIL flag ImageFile.LOAD_TRUNCATED_IMAGES = True as an
    import-time side effect. Once any test imports datasets.veriwild (or
    any other datasets.* module), this flag stays flipped for the rest of
    the pytest session — silently changing whether truncated/corrupt JPEGs
    raise an error, breaking Phase 0's test_preprocessing.py tests
    (test_load_corrupt_file_raises_typed_error) whenever they run AFTER a
    test that touched the vendored code. This was a real, reproduced bug
    (test passes in isolation, fails in the full suite) — this autouse
    fixture resets the flag to PIL's real default before and after every
    single test, so no test can leak this global mutation into another.
    """
    original_value = ImageFile.LOAD_TRUNCATED_IMAGES
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    yield
    ImageFile.LOAD_TRUNCATED_IMAGES = original_value


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
    # A REAL jpeg header/start, truncated mid-body — PIL's Image.open()
    # succeeds (the format is recognized), but the full pixel decode in
    # img.load() fails with OSError. This is what genuinely distinguishes
    # CORRUPT_FILE from UNREADABLE_FORMAT (garbage bytes that never even
    # look like an image, tested separately below).
    import io
    import numpy as np
    from PIL import Image as PILImage

    buf = io.BytesIO()
    fake_img = PILImage.fromarray(
        (np.random.rand(200, 200, 3) * 255).astype(np.uint8), mode="RGB"
    )
    fake_img.save(buf, format="JPEG")
    full_bytes = buf.getvalue()
    truncated_bytes = full_bytes[: len(full_bytes) // 2]

    path = tmp_path / "corrupt.jpg"
    path.write_bytes(truncated_bytes)
    return str(path)


@pytest.fixture
def non_image_file_path(tmp_path):
    path = tmp_path / "readme.txt"
    path.write_text("this is a text file, not an image")
    return str(path)
