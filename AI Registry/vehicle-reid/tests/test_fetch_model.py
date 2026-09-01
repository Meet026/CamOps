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
