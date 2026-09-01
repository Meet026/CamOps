"""
Generates the Phase 0 output report in both human-readable Markdown and
machine-readable JSON. Every condition's results appear, even ones where
computation was impossible (None values + notes) — a missing result is
reportable data, not something to hide.
"""
import json
import os
from dataclasses import asdict

KNOWN_LIMITATIONS = (
    "- **Extreme camera-angle variation is not tested.** It cannot be "
    "synthesized from a single existing photo without a 3D model or a "
    "genuinely different real photo; simulating it with a crude 2D "
    "transform would misrepresent what was actually tested. This is a "
    "documented gap for Phase 0, not an oversight — see the design spec, "
    "section 4."
)


def _format_condition_section(name: str, result) -> str:
    lines = [f"### Condition: `{name}`", ""]
    if result.same_vehicle_mean is not None:
        lines.append(
            f"- Same-vehicle mean similarity: **{result.same_vehicle_mean:.4f}** "
            f"({result.same_vehicle_pair_count} pairs)"
        )
    if result.different_vehicle_mean is not None:
        lines.append(
            f"- Different-vehicle mean similarity: **{result.different_vehicle_mean:.4f}** "
            f"({result.different_vehicle_pair_count} pairs)"
        )
    if result.separation_gap is not None:
        lines.append(f"- Separation gap: **{result.separation_gap:.4f}**")
    for note in result.notes:
        lines.append(f"- ⚠️ {note}")
    lines.append("")
    return "\n".join(lines)


def generate_report(results_by_condition: dict, skipped_files: list, output_dir: str) -> tuple:
    os.makedirs(output_dir, exist_ok=True)
    md_path = os.path.join(output_dir, "report.md")
    json_path = os.path.join(output_dir, "report.json")

    md_lines = [
        "# Vehicle Re-ID Phase 0 — Baseline Report",
        "",
        "## Results by Condition",
        "",
    ]
    for condition_name, result in results_by_condition.items():
        md_lines.append(_format_condition_section(condition_name, result))

    md_lines.extend(["## Skipped Files", ""])
    if skipped_files:
        for file_path, reason in skipped_files:
            md_lines.append(f"- `{file_path}` — {reason}")
    else:
        md_lines.append("_None — every input file was processed successfully._")
    md_lines.append("")

    md_lines.extend(["## Known Limitations", "", KNOWN_LIMITATIONS, ""])

    with open(md_path, "w") as f:
        f.write("\n".join(md_lines))

    json_data = {
        "conditions": {
            name: asdict(result) for name, result in results_by_condition.items()
        },
        "skipped_files": [
            {"file": path, "reason": reason} for path, reason in skipped_files
        ],
    }
    with open(json_path, "w") as f:
        json.dump(json_data, f, indent=2)

    return md_path, json_path
