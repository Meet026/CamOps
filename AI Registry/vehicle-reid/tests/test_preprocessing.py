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
