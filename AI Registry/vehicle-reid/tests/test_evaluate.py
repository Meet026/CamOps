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
