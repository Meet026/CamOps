import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
import torch
import torch.nn as nn
import onnxruntime as ort
import numpy as np
from convert_to_onnx import convert_checkpoint_to_onnx


class DummyCLIPReIDModel(nn.Module):
    """
    Stands in for the real CLIP-ReID model's shape contract: takes NCHW
    input, and when called with get_image=True (matching the real model's
    forward() signature), returns a 512-dim embedding. This is what
    convert_checkpoint_to_onnx's _GetImageFeatureWrapper actually calls,
    so the dummy must accept the same keyword argument the real model does.
    """
    def __init__(self):
        super().__init__()
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc = nn.Linear(3, 512)

    def forward(self, x, get_image=False, get_text=False, label=None, cam_label=None, view_label=None):
        pooled = self.pool(x).squeeze(-1).squeeze(-1)  # (N, 3)
        return self.fc(pooled)  # (N, 512) — same shape whether get_image is True or not, for this dummy


def test_converts_and_produces_loadable_onnx_model(tmp_path):
    model = DummyCLIPReIDModel()
    checkpoint_path = str(tmp_path / "dummy_checkpoint.pth")
    torch.save(model.state_dict(), checkpoint_path)

    output_path = str(tmp_path / "converted.onnx")
    result_path = convert_checkpoint_to_onnx(
        checkpoint_path, output_path, input_height=224, input_width=224,
        model_factory=DummyCLIPReIDModel,
    )

    assert result_path == output_path
    assert os.path.exists(output_path)

    session = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
    dummy_input = np.random.rand(1, 3, 224, 224).astype(np.float32)
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: dummy_input})
    assert outputs[0].shape == (1, 512)


def test_output_matches_pytorch_get_image_call(tmp_path):
    """Confirms the ONNX export actually calls get_image=True, not the
    default forward path — this is the specific real-world bug this test
    guards against, since the two paths can diverge in the real model."""
    model = DummyCLIPReIDModel()
    checkpoint_path = str(tmp_path / "dummy_checkpoint.pth")
    torch.save(model.state_dict(), checkpoint_path)

    output_path = str(tmp_path / "converted.onnx")
    convert_checkpoint_to_onnx(
        checkpoint_path, output_path, input_height=64, input_width=64,
        model_factory=DummyCLIPReIDModel,
    )

    fixed_input = torch.ones(1, 3, 64, 64)
    model.eval()
    with torch.no_grad():
        expected = model(fixed_input, get_image=True).numpy()

    session = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    actual = session.run(None, {input_name: fixed_input.numpy()})[0]

    np.testing.assert_allclose(expected, actual, rtol=1e-4, atol=1e-5)
