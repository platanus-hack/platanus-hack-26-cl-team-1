import asyncio
import json

import httpx
import pytest
from contracts import Priority, SayRequest

from app.settings import Settings, VoiceMode
from app.voice.elevenlabs import MP3_BYTES_PER_S, ElevenLabsVoice, normalize
from app.voice.factory import make_voice
from app.voice.queue import TAIL_MS, VoiceQueue

NEXT = SayRequest(text="Ahora pon la rueda.")
OTHER = SayRequest(text="Ahora monta el servo.")
OOPS = SayRequest(text="Ojo, el servo quedó al revés.", priority=Priority.URGENT)
ONE_SECOND_OF_MP3 = b"\0" * MP3_BYTES_PER_S


def speak(queue, request, now_ms, audio=ONE_SECOND_OF_MP3, say_id="s1"):
    assert queue.offer(request, now_ms) == request
    queue.spoken(say_id, request, now_ms, audio)


# ── queue ────────────────────────────────────────────────────────────────────


def test_normal_line_waits_for_the_gap_and_the_newest_wins():
    queue = VoiceQueue(min_gap_ms=4000)
    speak(queue, NEXT, 0)
    assert queue.offer(OTHER, 1000) is None
    assert queue.offer(SayRequest(text="Ahora conecta el sensor."), 2000) is None
    assert queue.due(3999) is None
    assert queue.due(4000).text == "Ahora conecta el sensor."
    assert queue.due(5000) is None  # nothing left


def test_a_line_spoken_directly_drops_an_older_waiting_line():
    """Review finding on PR #22: B waited, C was spoken when the queue freed up, then B played after C."""
    queue = VoiceQueue(min_gap_ms=4000)
    speak(queue, NEXT, 0)
    assert queue.offer(OTHER, 1000) is None  # waits
    newer = SayRequest(text="Ahora conecta el sensor.")
    assert queue.offer(newer, 5200) == newer
    assert queue.due(20_000) is None


def test_urgent_line_drops_the_waiting_instruction():
    queue = VoiceQueue(min_gap_ms=4000)
    speak(queue, NEXT, 0)
    assert queue.offer(OTHER, 1000) is None
    assert queue.offer(OOPS, 1500) == OOPS
    assert queue.due(20_000) is None


def test_line_waits_until_the_previous_one_ended():
    queue = VoiceQueue(min_gap_ms=1000)
    speak(queue, NEXT, 0, audio=ONE_SECOND_OF_MP3 * 3)  # 3 s of audio
    assert queue.offer(OTHER, 2000) is None
    assert queue.due(3000 + TAIL_MS - 1) is None
    assert queue.due(3000 + TAIL_MS) == OTHER


def test_urgent_line_jumps_the_gap():
    queue = VoiceQueue(min_gap_ms=4000)
    speak(queue, NEXT, 0)
    assert queue.offer(OOPS, 500) == OOPS


def test_same_line_is_not_repeated_within_the_window():
    queue = VoiceQueue(min_gap_ms=0, repeat_window_ms=15_000)
    speak(queue, NEXT, 0)
    assert queue.offer(NEXT, 10_000) is None
    assert queue.offer(NEXT, 15_000) == NEXT


def test_fixed_mistake_is_cancelled_only_while_it_may_be_playing():
    queue = VoiceQueue()
    speak(queue, OOPS, 0, say_id="s7")  # 1 s of audio
    assert queue.mistake_fixed(500) == "s7"
    assert queue.mistake_fixed(600) is None  # already forgotten
    speak(queue, SayRequest(text="Ojo, otra cosa.", priority=Priority.URGENT), 10_000, say_id="s8")
    assert queue.mistake_fixed(12_000) is None  # it ended


def test_reset_forgets_history():
    queue = VoiceQueue()
    speak(queue, NEXT, 0)
    queue.reset()
    assert queue.offer(NEXT, 100) == NEXT


# ── ElevenLabs ───────────────────────────────────────────────────────────────


def test_elevenlabs_sends_the_request_and_returns_mp3():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers["xi-api-key"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"ID3mp3")

    voice = ElevenLabsVoice("k", "voice1", transport=httpx.MockTransport(handler))
    audio = asyncio.run(voice.synthesize(SayRequest(text="Conecta el café a GND.")))

    assert audio == b"ID3mp3"
    assert seen["url"].startswith("https://api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3")
    assert seen["key"] == "k"
    assert seen["body"] == {
        "text": "Conecta el café a tierra.",
        "model_id": "eleven_flash_v2_5",
        "language_code": "es",
    }


@pytest.mark.parametrize("status", [401, 500])
def test_elevenlabs_failure_falls_back_to_browser_speech(status, caplog):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, text="nope"))
    voice = ElevenLabsVoice("k", "voice1", transport=transport)
    assert asyncio.run(voice.synthesize(NEXT)) is None
    assert f"elevenlabs {status}" in caplog.text


def test_elevenlabs_without_a_key_fails_at_startup(tmp_path):
    settings = Settings(
        tasks_dir=tmp_path, perception="scripted", scripted_every_ms=1, scripted_mistake=None,
        voice=VoiceMode.ELEVENLABS, cors_origins=(), elevenlabs_voice_id="voice1",
    )  # fmt: skip
    with pytest.raises(ValueError, match="ELEVENLABS_API_KEY"):
        make_voice(settings)


def test_normalize_spells_symbols():
    assert normalize("Conecta  5V → GND") == "Conecta 5 voltios a tierra"
