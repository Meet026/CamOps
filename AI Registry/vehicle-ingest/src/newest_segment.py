"""
Finds the newest .ts segment file video-stream has already written for a
camera, directly on the shared filesystem -- see this project's spec,
Section 3 step 3, for why this reads video-stream's own data directory
directly rather than adding a new endpoint to it.
"""
import os
import re

_SEGMENT_NAME_RE = re.compile(r"^(\d+)\.ts$")


def find_newest_segment(hls_data_dir: str, camera_id: str) -> str | None:
    """
    Returns the absolute path to the highest-numbered N.ts file in
    <hls_data_dir>/<camera_id>/, or None if that directory doesn't exist
    or has no segment files yet -- both real, expected states (a camera
    that video-stream hasn't started yet, or one still waiting on its
    first segment).
    """
    camera_dir = os.path.join(hls_data_dir, camera_id)
    if not os.path.isdir(camera_dir):
        return None

    numbered = []
    for filename in os.listdir(camera_dir):
        match = _SEGMENT_NAME_RE.match(filename)
        if match:
            numbered.append((int(match.group(1)), filename))

    if not numbered:
        return None

    numbered.sort(key=lambda pair: pair[0])
    _, newest_filename = numbered[-1]
    return os.path.join(camera_dir, newest_filename)
