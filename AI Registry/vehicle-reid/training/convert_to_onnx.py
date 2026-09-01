"""
Converts a trained CLIP-ReID PyTorch checkpoint to ONNX, matching the
input/output contract src/embedder.py (Phase 0) already expects:
NCHW float32 input, 512-dim float32 output. Run this after Colab training
completes, before the fine-tuned model can be used by any of Phase 0's
existing evaluation tools.

IMPORTANT — real output shape, verified against the actual model code
(CLIP-ReID/model/make_model_clipreid.py forward(), ~line 107-153): in
normal eval mode the model returns a concatenated 1280-dim feature
(768-dim image_feature + 512-dim image_feature_proj for ViT-B-16) — NOT
512-dim. To keep matching Phase 0's tested embedder.py/evaluate.py
(512-dim, unmodified — per this project's constraint to avoid touching
frozen Phase 0 code), this script wraps the real model to call it with
`get_image=True`, which returns ONLY the 512-dim projected feature
(image_features_proj[:, 0] for ViT-B-16 — see forward(), line ~113-118).
This is a legitimate, complete embedding on its own, not a truncation of
"the real one" — CLIP-ReID's own get_image path is designed for exactly
this use case (feature extraction for retrieval/similarity).

The real CLIP-ReID model is constructed via
CLIP-ReID/model/make_model_clipreid.py's make_model(cfg, num_class,
camera_num, view_num) — a multi-argument factory, not a bare zero-arg
constructor. model_factory here is expected to be a zero-argument closure
that already has those real arguments bound in (e.g.
`lambda: make_model(cfg, num_class=500, camera_num=174, view_num=1)`),
so this script stays agnostic to CLIP-ReID's specific construction
signature and is testable with a plain dummy model.
"""
import torch
import torch.nn as nn


class _GetImageFeatureWrapper(nn.Module):
    """
    Wraps a CLIP-ReID model so ONNX export sees a plain single-input,
    single-output forward — torch.onnx.export can't trace a model whose
    forward() takes a get_image=True keyword flag directly, so this
    wrapper fixes that flag at trace time.
    """

    def __init__(self, base_model):
        super().__init__()
        self.base_model = base_model

    def forward(self, x):
        return self.base_model(x, get_image=True)


def convert_checkpoint_to_onnx(
    checkpoint_path: str,
    output_path: str,
    input_height: int,
    input_width: int,
    model_factory,
) -> str:
    """
    model_factory: a zero-argument callable returning an uninitialized
    model instance matching the checkpoint's architecture.

    Real bug found and fixed here (2026-09-01, from an actual Colab
    export failure): CLIP-ReID's real make_model() (see
    CLIP-ReID/model/make_model_clipreid.py) hardcodes
    `clip_model.to("cuda")` during construction — so model_factory()
    already returns a model with SOME parameters forced onto the GPU,
    even before we load any checkpoint weights. Loading the checkpoint
    with map_location="cpu" then put the loaded weights on CPU, leaving
    the model with a mix of cuda: and cpu: tensors — which crashed
    torch.onnx.export with "Unhandled FakeTensor Device Propagation ...
    found two different devices cuda:0, cpu". This bug never surfaced in
    this file's own tests because those use a tiny plain dummy model with
    no internal .to("cuda") call, so they never exercised this
    real-model-specific behavior — a genuine test coverage gap, not a
    false negative to hide.

    Fix: force the ENTIRE model (including whatever make_model() already
    put on cuda) onto one single, explicit device before export, so
    there's no per-submodule device inconsistency for the exporter to trip
    over.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    base_model = model_factory()
    base_model.to(device)

    state_dict = torch.load(checkpoint_path, map_location=device)
    base_model.load_state_dict(state_dict)
    base_model.eval()

    wrapped_model = _GetImageFeatureWrapper(base_model)
    wrapped_model.to(device)
    wrapped_model.eval()

    dummy_input = torch.randn(1, 3, input_height, input_width, device=device)

    torch.onnx.export(
        wrapped_model,
        dummy_input,
        output_path,
        input_names=["input"],
        output_names=["output"],
        opset_version=17,
        dynamic_axes=None,  # fixed batch size of 1, matching embedder.py's usage
    )

    return output_path
