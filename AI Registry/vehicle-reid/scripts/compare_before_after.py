#!/usr/bin/env python3
"""
Runs Phase 0's evaluation tools (src.cli's aggregate report) against BOTH
the original pretrained model and the Phase 1 fine-tuned model, on the
same VRIC evaluation data, and writes a single before/after comparison.

The underlying tool (src.cli.run) is used UNCHANGED from Phase 0 — this
script only orchestrates calling it twice and combining the results, per
the design spec's explicit requirement to reuse, not rebuild, the
evaluation methodology (see
../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 6).
"""
import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.cli import run as run_cli_evaluation


def compare(data_dir: str, original_model_path: str, finetuned_model_path: str, output_dir: str) -> str:
    os.makedirs(output_dir, exist_ok=True)

    original_report_dir = os.path.join(output_dir, "original")
    finetuned_report_dir = os.path.join(output_dir, "finetuned")

    original_md, _ = run_cli_evaluation(data_dir, original_model_path, original_report_dir)
    finetuned_md, _ = run_cli_evaluation(data_dir, finetuned_model_path, finetuned_report_dir)

    comparison_path = os.path.join(output_dir, "before_after_comparison.md")
    with open(comparison_path, "w") as out:
        out.write("# Phase 1 — Before/After Comparison\n\n")
        out.write(f"Evaluation data: `{data_dir}` (VRIC — never trained on by either model)\n\n")
        out.write("## Before (Phase 0 baseline model)\n\n")
        out.write(open(original_md).read())
        out.write("\n\n## After (Phase 1 fine-tuned model)\n\n")
        out.write(open(finetuned_md).read())

    return comparison_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"))
    parser.add_argument("--original-model", default=os.path.join(os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"))
    parser.add_argument("--finetuned-model", required=True)
    parser.add_argument("--output", default=os.path.join(os.path.dirname(__file__), "..", "reports"))
    args = parser.parse_args()

    output_dir = os.path.join(args.output, f"before_after_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    result_path = compare(args.data, args.original_model, args.finetuned_model, output_dir)
    print(f"Comparison written to: {result_path}")
