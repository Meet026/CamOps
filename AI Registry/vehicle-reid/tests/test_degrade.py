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
