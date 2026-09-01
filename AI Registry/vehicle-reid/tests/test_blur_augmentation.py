import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
from PIL import Image
from blur_augmentation import RandomBlurAugmentation


def _make_test_image():
    arr = np.zeros((100, 100, 3), dtype=np.uint8)
    arr[::5, :, :] = 255
    arr[:, ::5, :] = 255
    return Image.fromarray(arr, mode="RGB")


def test_probability_zero_never_blurs():
    aug = RandomBlurAugmentation(probability=0.0)
    original = _make_test_image()
    result = aug(original)
    original_arr = np.asarray(original, dtype=np.float32)
    result_arr = np.asarray(result, dtype=np.float32)
    assert np.array_equal(original_arr, result_arr)


def test_probability_one_always_blurs():
    aug = RandomBlurAugmentation(probability=1.0)
    original = _make_test_image()
    result = aug(original)
    original_arr = np.asarray(original, dtype=np.float32)
    result_arr = np.asarray(result.resize(original.size), dtype=np.float32)
    difference = np.mean(np.abs(original_arr - result_arr))
    assert difference > 1.0  # meaningfully blurred, matches degrade.py's own blur test
