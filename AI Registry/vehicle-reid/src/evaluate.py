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
    notes: list = field(default_factory=list)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def evaluate_embeddings(items: list) -> EvaluationResult:
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
