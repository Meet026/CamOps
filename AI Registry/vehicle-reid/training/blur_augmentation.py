"""
Training-time blur augmentation, reusing Phase 0's tested blur logic
(src/degrade.py) rather than reimplementing it. Applied with a given
probability per image during training, directly targeting the motion-blur
fragility diagnosed in Phase 0 (see
../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 1.3, "Failure mode 1").
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.degrade import apply_degradation


class RandomBlurAugmentation:
    def __init__(self, probability: float = 0.3):
        self.probability = probability

    def __call__(self, image):
        if random.random() < self.probability:
            return apply_degradation(image, "blur")
        return image
