"""The demo's session cap (deploy/session_cap.py, D-015): slots, release on close, hello timeout."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "deploy"))
from session_cap import BUSY_REASON, SLOW_REASON, SessionCap


async def echo(scope, receive, send) -> None:
    """Like run_session: accept, then wait for messages; WebSocketDisconnect ends it."""
    ws = WebSocket(scope, receive, send)
    await ws.accept()
    try:
        while True:
            await ws.send_text(await ws.receive_text())
    except WebSocketDisconnect:
        pass


def client(limit: int = 1, hello_timeout_s: float = 5.0) -> tuple[TestClient, SessionCap]:
    cap = SessionCap(echo, limit, hello_timeout_s=hello_timeout_s)
    return TestClient(cap), cap


def test_over_the_cap_is_refused_with_1013_and_a_slot_frees_on_close() -> None:
    tc, cap = client(limit=1)
    with tc.websocket_connect("/ws/session") as first:
        first.send_text("hello")
        assert first.receive_text() == "hello"
        assert cap.open == 1
        with tc.websocket_connect("/ws/session") as second:
            second.send_text("hello")
            with pytest.raises(WebSocketDisconnect) as refused:
                second.receive_text()
            assert (refused.value.code, refused.value.reason) == (1013, BUSY_REASON)
    assert cap.open == 0
    with tc.websocket_connect("/ws/session") as third:
        third.send_text("hello")
        assert third.receive_text() == "hello"


def test_a_socket_that_never_says_hello_holds_no_slot_and_is_closed() -> None:
    tc, cap = client(limit=1, hello_timeout_s=0.2)
    with tc.websocket_connect("/ws/session") as idle:
        assert cap.open == 0
        with pytest.raises(WebSocketDisconnect) as closed:
            idle.receive_text()
        assert (closed.value.code, closed.value.reason) == (1008, SLOW_REASON)
    assert cap.open == 0


def test_other_paths_pass_through_uncapped() -> None:
    tc, cap = client(limit=1)
    with tc.websocket_connect("/ws/session") as first, tc.websocket_connect("/other") as other:
        first.send_text("a")
        other.send_text("b")
        assert (first.receive_text(), other.receive_text()) == ("a", "b")
    assert cap.open == 0


def test_bad_limits_are_rejected() -> None:
    with pytest.raises(ValueError):
        SessionCap(echo, 0)
    with pytest.raises(ValueError):
        SessionCap(echo, 1, hello_timeout_s=0)
