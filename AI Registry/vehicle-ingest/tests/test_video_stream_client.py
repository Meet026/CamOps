import httpx
import pytest

from src.video_stream_client import VideoStreamClient, VideoStreamClientError, StreamCamera


class _FakeTransport(httpx.BaseTransport):
    """A real httpx transport that returns fixed, known responses --
    exercises VideoStreamClient's real HTTP parsing logic end-to-end
    without needing a real video-stream server running for this unit
    test. (Task 5's integration work is what proves this against the
    real, live service.)"""

    def __init__(self, responses: dict):
        self.responses = responses

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        if key not in self.responses:
            raise AssertionError(f"Unexpected request: {key}")
        status, json_body, headers = self.responses[key]
        return httpx.Response(status, json=json_body, headers=headers or {})


def _client_with(responses: dict) -> VideoStreamClient:
    client = VideoStreamClient(base_url="http://test")
    client._http = httpx.Client(transport=_FakeTransport(responses), base_url="http://test")
    return client


def test_list_cameras_parses_real_response_shape():
    client = _client_with({
        ("GET", "/cameras"): (200, {
            "cameras": [
                {"camera_id": "abc-123", "name": "Test Cam", "stream_path": "rtsp://x/y"},
            ]
        }, None),
    })
    cameras = client.list_cameras()
    assert cameras == [StreamCamera(camera_id="abc-123", name="Test Cam", stream_path="rtsp://x/y")]


def test_ensure_stream_running_true_on_200():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (200, {}, None),
    })
    assert client.ensure_stream_running("abc-123") is True


def test_ensure_stream_running_false_on_503():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (503, {"detail": "still starting"}, {"retry-after": "5"}),
    })
    assert client.ensure_stream_running("abc-123") is False


def test_ensure_stream_running_raises_on_404():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (404, {"detail": "no stream_path registered"}, None),
    })
    with pytest.raises(VideoStreamClientError) as exc_info:
        client.ensure_stream_running("abc-123")
    assert exc_info.value.reason == "NOT_FOUND"
