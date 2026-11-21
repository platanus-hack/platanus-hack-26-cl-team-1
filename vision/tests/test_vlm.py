import json

import httpx
import numpy as np

from vision.vlm import VlmJudge
from vision.vlm_prompt import StepInfo, build_messages, make_crop, parse_verdict

STEP = StepInfo(
    4, "Coloca el LED rojo", "Pata larga en e7.", [{"pieza": "el LED rojo", "pata": "ánodo", "hueco": "e7"}], []
)


def test_parse_strict_and_fenced():
    v = parse_verdict('{"estado":"error","tipo":"led_reversed","componente":"LED","mensaje":"Ojo."}')
    assert v.error and v.tipo == "led_reversed"
    v = parse_verdict('```json\n{"estado":"ok","tipo":"ninguno","componente":"LED","mensaje":"Bien ahí."}\n```')
    assert v.ok
    assert parse_verdict("no sé") is None
    assert parse_verdict('{"estado":"quizás","tipo":"ninguno"}') is None


def test_self_contradicting_answers_become_uncertain():
    v = parse_verdict('{"estado":"ok","tipo":"led_reversed","componente":"LED","mensaje":"Ojo"}')
    assert v.estado == "incierto" and not v.ok and not v.error
    v = parse_verdict('{"estado":"error","tipo":"ninguno","componente":"LED","mensaje":"?"}')
    assert v.estado == "incierto"


def test_messages_carry_two_images_and_the_step():
    msgs = build_messages(STEP, "corrida 1 columna", "AAA", "BBB")
    content = msgs[1]["content"]
    assert [c["type"] for c in content] == ["image_url", "image_url", "text"]
    assert '"hueco": "e7"' in content[2]["text"] and "corrida 1 columna" in content[2]["text"]


def test_crop_draws_holes_and_upscales():
    img = np.zeros((480, 640, 3), np.uint8)
    crop = make_crop(img, {"e7": (300.0, 200.0), "e8": (308.0, 200.0)}, pitch_px=8.0)
    assert crop.shape[0] > 64 and crop.max() > 0  # something drawn


async def test_judge_parses_server_reply_and_times_out():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["response_format"]["type"] == "json_schema"
        content = '{"estado":"error","tipo":"wrong_hole","componente":"R1","mensaje":"Ojo, corrida."}'
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    j = VlmJudge("http://vllm", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    r = await j.judge(STEP, None, "A", "B")
    assert r.verdict.tipo == "wrong_hole" and r.error is None

    async def slow(request):
        import asyncio

        await asyncio.sleep(1)
        return httpx.Response(200, json={})

    j = VlmJudge("http://vllm", timeout_s=0.05, client=httpx.AsyncClient(transport=httpx.MockTransport(slow)))
    r = await j.judge(STEP, None, "A", "B")
    assert r.verdict is None and r.error == "timeout"
