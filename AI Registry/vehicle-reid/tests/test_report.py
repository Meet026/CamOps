import json
import os
import tempfile
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
