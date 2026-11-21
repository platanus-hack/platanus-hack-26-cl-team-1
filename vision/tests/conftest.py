import pytest


@pytest.fixture(autouse=True)
def _no_gpu_services(monkeypatch):
    """Tests never load Kokoro/YOLO nor call vLLM."""
    monkeypatch.setenv("CV_TTS", "0")
    monkeypatch.setenv("CV_DETECTOR", "0")
    monkeypatch.setenv("CV_VLM", "0")
