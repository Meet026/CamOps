"""
Real HTTP client for video-stream's existing API (AI Registry/video-stream
-- see its docs/PRD.md Section 6 for the full, authoritative contract).
vehicle-ingest calls exactly the two endpoints a browser would call:
GET /cameras (the picker's data source) and
GET /stream/{camera_id}/index.m3u8 (starts/confirms the camera's ffmpeg is
running). No new endpoint is added to video-stream for this -- see this
project's spec, Section 6.
"""
from dataclasses import dataclass

import httpx


class VideoStreamClientError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


@dataclass(frozen=True)
class StreamCamera:
    camera_id: str
    name: str
    stream_path: str


class VideoStreamClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8100"):
        self._http = httpx.Client(base_url=base_url, timeout=10.0)

    def list_cameras(self) -> list[StreamCamera]:
        try:
            response = self._http.get("/cameras")
        except httpx.HTTPError as e:
            raise VideoStreamClientError("REQUEST_FAILED", f"GET /cameras failed: {e}")

        if response.status_code != 200:
            raise VideoStreamClientError(
                "UNEXPECTED_STATUS", f"GET /cameras returned {response.status_code}"
            )

        body = response.json()
        return [
            StreamCamera(
                camera_id=c["camera_id"], name=c["name"], stream_path=c["stream_path"]
            )
            for c in body["cameras"]
        ]

    def ensure_stream_running(self, camera_id: str) -> bool:
        """
        Returns True once the camera's playlist is ready (a real 200 --
        video-stream's ffmpeg has written a first segment). Returns False
        on a 503 -- video-stream's own documented, expected "still
        starting" state (see its PRD Section 6) -- the caller should
        retry later, not treat this as an error. Raises
        VideoStreamClientError for every other status (404/500/502),
        which ARE real errors per video-stream's own contract.
        """
        try:
            response = self._http.get(f"/stream/{camera_id}/index.m3u8")
        except httpx.HTTPError as e:
            raise VideoStreamClientError("REQUEST_FAILED", f"GET playlist failed: {e}")

        if response.status_code == 200:
            return True
        if response.status_code == 503:
            return False
        if response.status_code == 404:
            raise VideoStreamClientError(
                "NOT_FOUND", f"Camera {camera_id} has no stream_path registered"
            )
        raise VideoStreamClientError(
            "UNEXPECTED_STATUS", f"GET playlist for {camera_id} returned {response.status_code}"
        )

    def close(self) -> None:
        self._http.close()
