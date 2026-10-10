import importlib
import os
from unittest.mock import MagicMock, patch

from httpx import ASGITransport, AsyncClient
import pytest

from src.main import app


@pytest.mark.asyncio
async def test_health_endpoint_reports_ok():
    # The lifespan (which loads real YOLO/ONNX models) is intentionally
    # NOT triggered here -- this test only exercises routing, matching
    # how vehicle-detection's own test_api.py keeps unit tests fast by
    # not loading real heavy models. Model-loading itself is exercised
    # for real in the manual verification step below (Step 6), against
    # the live service.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("src.main._camera_cycle_task", None):
            response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_camera_allowlist_unset_means_no_filtering(monkeypatch):
    monkeypatch.delenv("VEHICLE_INGEST_CAMERA_IDS", raising=False)
    import src.main as main_module
    importlib.reload(main_module)
    assert main_module.CAMERA_ALLOWLIST is None


def test_camera_allowlist_parses_comma_separated_ids(monkeypatch):
    monkeypatch.setenv("VEHICLE_INGEST_CAMERA_IDS", "cam-1, cam-2 ,cam-3")
    import src.main as main_module
    importlib.reload(main_module)
    assert main_module.CAMERA_ALLOWLIST == {"cam-1", "cam-2", "cam-3"}
    # Clean up: reload once more with the env var unset so later tests in
    # this same process don't inherit this test's monkeypatched module state.
    monkeypatch.delenv("VEHICLE_INGEST_CAMERA_IDS", raising=False)
    importlib.reload(main_module)


@pytest.mark.asyncio
async def test_health_reports_wanted_alerts_status_when_running():
    import src.main as main_module
    alerter = MagicMock()
    alerter.status.return_value = {"plates": 3, "alerts_created": 1, "last_refresh": None,
                                   "last_error": None, "last_alert_error": None}
    transport = ASGITransport(app=main_module.app)
    with patch.object(main_module, "_wanted_alerter", alerter):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            body = (await client.get("/health")).json()
    assert body["wanted_alerts"]["plates"] == 3


@pytest.mark.asyncio
async def test_health_says_wanted_alerts_are_disabled_when_not_started():
    import src.main as main_module
    transport = ASGITransport(app=main_module.app)
    with patch.object(main_module, "_wanted_alerter", None):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            body = (await client.get("/health")).json()
    assert body["wanted_alerts"] == "disabled"
