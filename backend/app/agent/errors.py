"""Map Anthropic SDK exceptions to Spanish `error` events (AgentErrorCode)."""
from __future__ import annotations

from dataclasses import dataclass

import anthropic

NO_API_KEY_MESSAGE = (
    "El asistente todavía no está configurado: falta la clave de la API de Anthropic. "
    "Crea el archivo backend/.env con la línea ANTHROPIC_API_KEY=tu-clave "
    "(puedes copiar backend/.env.example) y reinicia el servidor."
)


class IncompleteStreamError(Exception):
    """The upstream stream ended without a stop reason (no message_stop)."""


@dataclass(frozen=True)
class AgentError:
    code: str
    message: str
    retryable: bool


def _detail(exc: anthropic.APIStatusError) -> str:
    body = exc.body
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return err["message"][:300]
    return str(exc.message)[:300]


def _error_type(exc: anthropic.APIStatusError) -> str | None:
    """`error.type` of the body (`overloaded_error`, `rate_limit_error`, …)."""
    t = getattr(exc, "type", None)
    if isinstance(t, str):
        return t
    body = exc.body
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and isinstance(err.get("type"), str):
            return err["type"]
    return None


AUTH = AgentError(
    "auth",
    "La clave de la API de Anthropic no es válida o no tiene permisos. Revisa ANTHROPIC_API_KEY en backend/.env.",
    False,
)
RATE_LIMITED = AgentError("rate_limited", "Hay demasiadas consultas en este momento. Espera unos segundos y reintenta.", True)
OVERLOADED = AgentError("overloaded", "Claude está con mucha demanda ahora mismo. Reintenta en un momento.", True)


def _bad_request(exc: anthropic.APIStatusError) -> AgentError:
    return AgentError("invalid_request", f"La conversación no se pudo procesar ({_detail(exc)}). Prueba con una conversación nueva.", False)


def map_exception(exc: BaseException) -> AgentError:
    """Most-specific first: typed status errors, then connection errors, then the rest."""
    if isinstance(exc, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        return AUTH
    if isinstance(exc, anthropic.RateLimitError):
        return RATE_LIMITED
    if isinstance(exc, anthropic.OverloadedError):
        return OVERLOADED
    if isinstance(exc, anthropic.BadRequestError):
        return _bad_request(exc)
    if isinstance(exc, (anthropic.NotFoundError, anthropic.UnprocessableEntityError, anthropic.ContentTooLargeError)):
        return AgentError("invalid_request", f"La solicitud al asistente no es válida ({_detail(exc)}).", False)
    if isinstance(exc, anthropic.APIStatusError):
        # A mid-stream SSE `error` event arrives on an HTTP 200 response: the SDK raises a bare
        # APIStatusError(status_code=200), so classify it by the body's error type.
        etype = _error_type(exc)
        if etype == "overloaded_error":
            return OVERLOADED
        if etype == "rate_limit_error":
            return RATE_LIMITED
        if etype in ("authentication_error", "permission_error"):
            return AUTH
        if etype == "invalid_request_error":
            return _bad_request(exc)
        if etype in ("api_error", "timeout_error") or (exc.status_code < 400 and etype is None):
            return AgentError("upstream", "El servicio de Claude tuvo un problema mientras respondía. Reintenta en un momento.", True)
        retry = exc.status_code >= 500 or exc.status_code in (408, 409)
        return AgentError("upstream", f"El servicio de Claude respondió con un error ({exc.status_code}). Reintenta en un momento.", retry)
    if isinstance(exc, anthropic.APITimeoutError):
        return AgentError("upstream", "Claude tardó demasiado en responder. Reintenta.", True)
    if isinstance(exc, anthropic.APIConnectionError):
        return AgentError("upstream", "No pude conectarme con Claude. Revisa la conexión a internet del servidor y reintenta.", True)
    if isinstance(exc, IncompleteStreamError):
        return AgentError("upstream", "La respuesta de Claude llegó incompleta. Reintenta.", True)
    if isinstance(exc, ValueError):
        # Eager input streaming: the SDK raises ValueError from the stream iterator on tool
        # input JSON it cannot parse at all. There is no tool_use id to answer → re-issue.
        return AgentError("upstream", "La respuesta de Claude llegó incompleta. Reintenta.", True)
    return AgentError("internal", "Ocurrió un error inesperado en el servidor del asistente. Reintenta.", True)
