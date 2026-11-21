import asyncio

from vision.protocol import encode_audio
from vision.speaker import Speaker


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def make(synth=None):
    sent: list[dict] = []
    binary: list[bytes] = []

    async def sj(m):
        sent.append(m)

    async def sb(b):
        binary.append(b)

    clock = Clock()
    sp = Speaker(sj, sb, synth, clock=clock)
    return sp, sent, binary, clock


async def test_one_clip_every_4s_and_errors_first():
    sp, sent, _, clock = make()
    sp.say("Paso 2: coloca la resistencia.")
    sp.say("Paso 3: coloca el LED.")
    assert await sp.flush_once()
    assert not await sp.flush_once()  # gap not elapsed
    sp.say("Ojo, el LED está al revés.", "error")
    clock.t += 4.1
    assert await sp.flush_once()
    clock.t += 4.1
    assert await sp.flush_once()
    assert [m["text"] for m in sent] == [
        "Paso 2: coloca la resistencia.",
        "Ojo, el LED está al revés.",
        "Paso 3: coloca el LED.",
    ]
    assert sent[1]["priority"] == "error"


async def test_long_clip_delays_the_next_one():
    sp, sent, _, clock = make()
    sp.say("x" * 120)  # ~7.8 s of speech
    await sp.flush_once()
    sp.say("siguiente")
    clock.t += 5
    assert not await sp.flush_once()
    clock.t += 4
    assert await sp.flush_once()


async def test_no_repeat_within_15s():
    sp, sent, _, clock = make()
    assert sp.say("Ojo, el LED está al revés.", "error")
    assert sp.say("Ojo, el LED está al revés.", "error") is None  # already pending
    await sp.flush_once()
    clock.t += 10
    assert sp.say("Ojo, el LED está al revés.", "error") is None
    clock.t += 6
    assert sp.say("Ojo, el LED está al revés.", "error")


async def test_cancel_pending_and_already_sent():
    sp, sent, _, clock = make()
    sp.say("Ojo, resistencia corrida.", "error", key="issue:r1")
    await sp.cancel("issue:r1")
    assert sp.pending == []
    sp.say("Ojo, LED al revés.", "error", key="issue:led1")
    await sp.flush_once()
    clip = sent[-1]["id"]
    await sp.cancel("issue:led1")
    assert sent[-1] == {"type": "cancel_say", "id": clip}


async def test_audio_follows_say_and_mute_skips_tts():
    sp, sent, binary, clock = make(synth=lambda text: b"RIFF" + b"\0" * 48_040)
    sp.say("Hola")
    await sp.flush_once()
    assert sent[0]["audio"] is True
    assert binary == [encode_audio(sent[0]["id"], b"RIFF" + b"\0" * 48_040)]
    sp.muted = True
    clock.t += 5
    sp.say("Chao")
    await sp.flush_once()
    assert sent[1]["audio"] is False and len(binary) == 1


async def test_run_loop_emits_in_background():
    sent = []

    async def sj(m):
        sent.append(m)

    async def sb(b):
        pass

    sp = Speaker(sj, sb, None, min_gap=0.05)
    task = asyncio.create_task(sp.run())
    sp.say("uno")
    sp.say("dos")
    await asyncio.sleep(1.0)  # 2nd clip waits for the 1st to end (~0.2 s) + 0.6 s
    task.cancel()
    assert [m["text"] for m in sent] == ["uno", "dos"]
