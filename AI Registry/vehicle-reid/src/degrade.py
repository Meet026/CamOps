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
