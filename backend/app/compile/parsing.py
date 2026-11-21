"""Pure parsers for arduino-cli output: diagnostics, sizes and log cleanup."""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any, TypedDict

SKETCH_NAME = "sketch.ino"
MAX_LOG_BYTES = 20 * 1024


class Diagnostic(TypedDict, total=False):
    line: int
    column: int
    severity: str  # 'error' | 'warning'
    message: str


class Sizes(TypedDict, total=False):
    flashBytes: int
    flashMax: int
    ramBytes: int
    ramMax: int


# 'path/to/sketch.ino:12:5: error: expected ';' before '}' token'
_DIAG_RE = re.compile(
    r"^(?:.*[\\/])?(?P<file>[^\\/:\s]+\.ino):(?P<line>\d+):(?:(?P<col>\d+):)?\s*"
    r"(?P<sev>fatal error|error|warning|note):\s*(?P<msg>.*?)\s*$",
    re.MULTILINE,
)
_SUGGEST_RE = re.compile(r"suggested alternative:\s*'([^']+)'")
_MISSING_HEADER_RE = re.compile(r"([\w./+-]+\.h): No such file or directory")

_SKETCH_USES_RE = re.compile(r"Sketch uses (\d+) bytes.*?Maximum is (\d+) bytes", re.IGNORECASE)
_GLOBALS_RE = re.compile(r"Global variables use (\d+) bytes.*?Maximum is (\d+) bytes", re.IGNORECASE)


def _severity(raw: str) -> str | None:
    raw = raw.lower()
    if raw in ("error", "fatal error", "fatal"):
        return "error"
    if raw == "warning":
        return "warning"
    return None


def _with_hint(message: str, note: str) -> str:
    m = _SUGGEST_RE.search(note)
    if m and m.group(1) not in message:
        return f"{message} (¿quisiste decir '{m.group(1)}'?)"
    return message


def _dedupe(diags: Iterable[Diagnostic]) -> list[Diagnostic]:
    seen: set[tuple[Any, ...]] = set()
    out: list[Diagnostic] = []
    for d in diags:
        key = (d.get("line"), d.get("column"), d.get("severity"), d.get("message"))
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def parse_diagnostics(stderr: str, sketch_name: str = SKETCH_NAME) -> list[Diagnostic]:
    """gcc-style diagnostics of the sketch file. Notes are folded into the previous diagnostic as hints."""
    out: list[Diagnostic] = []
    for m in _DIAG_RE.finditer(stderr or ""):
        if m.group("file") != sketch_name:
            continue
        sev = m.group("sev")
        msg = m.group("msg")
        if sev == "note":
            if out:
                out[-1]["message"] = _with_hint(out[-1]["message"], msg)
            continue
        severity = _severity(sev)
        if not severity or not msg:
            continue
        d: Diagnostic = {"line": int(m.group("line")), "severity": severity, "message": msg}
        if m.group("col"):
            d["column"] = int(m.group("col"))
        out.append(d)
    return _dedupe(out)


def parse_json_diagnostics(items: Iterable[Mapping[str, Any]] | None, sketch_name: str = SKETCH_NAME) -> list[Diagnostic]:
    """arduino-cli `builder_result.diagnostics` (structured, >= 1.0)."""
    out: list[Diagnostic] = []
    for item in items or []:
        file = str(item.get("file") or "")
        if not (file == sketch_name or file.endswith("/" + sketch_name) or file.endswith("\\" + sketch_name)):
            continue
        severity = _severity(str(item.get("severity") or ""))
        line = item.get("line")
        if not severity or not isinstance(line, int) or line < 1:
            continue
        message = str(item.get("message") or "").splitlines()[0].strip() if item.get("message") else ""
        if not message:
            continue
        for note in item.get("notes") or []:
            message = _with_hint(message, str(note.get("message") or ""))
        d: Diagnostic = {"line": line, "severity": severity, "message": message}
        col = item.get("column")
        if isinstance(col, int) and col > 0:
            d["column"] = col
        out.append(d)
    return _dedupe(out)


def explain_missing_libraries(diags: list[Diagnostic], library_headers: Mapping[str, str]) -> list[Diagnostic]:
    """Replace 'Foo.h: No such file or directory' with a clear Spanish explanation."""
    by_header = {header: lib for lib, header in library_headers.items()}
    out: list[Diagnostic] = []
    for d in diags:
        m = _MISSING_HEADER_RE.search(d.get("message", ""))
        if m:
            header = m.group(1).split("/")[-1]
            lib = by_header.get(header)
            if lib:
                msg = (
                    f"Falta la biblioteca «{lib}» en el servidor de compilación (no se encontró {header}). "
                    f"Pide a quien administra el servidor que ejecute: arduino-cli lib install \"{lib}\"."
                )
            else:
                msg = f"No se encontró el archivo {header}: esa biblioteca no está instalada en el servidor de compilación."
            d = {**d, "message": msg}
        out.append(d)
    return out


def parse_sizes(builder_result: Mapping[str, Any] | None, compiler_out: str = "") -> Sizes | None:
    """Flash/RAM usage from `executable_sections_size` (text/data), else from the 'Sketch uses…' lines."""
    sizes: Sizes = {}
    for sec in (builder_result or {}).get("executable_sections_size") or []:
        name, size, max_size = sec.get("name"), sec.get("size"), sec.get("max_size")
        if not isinstance(size, int):
            continue
        if name == "text":
            sizes["flashBytes"] = size
            if isinstance(max_size, int):
                sizes["flashMax"] = max_size
        elif name == "data":
            sizes["ramBytes"] = size
            if isinstance(max_size, int) and max_size > 0:
                sizes["ramMax"] = max_size
    if "flashBytes" not in sizes and compiler_out:
        m = _SKETCH_USES_RE.search(compiler_out)
        if m:
            sizes["flashBytes"], sizes["flashMax"] = int(m.group(1)), int(m.group(2))
        g = _GLOBALS_RE.search(compiler_out)
        if g:
            sizes["ramBytes"], sizes["ramMax"] = int(g.group(1)), int(g.group(2))
    if "flashBytes" not in sizes:
        return None
    sizes.setdefault("flashMax", 0)
    return sizes


def clean_log(text: str, strip_prefixes: Iterable[str] = ()) -> str:
    """Hide server paths (job dirs) and trim to MAX_LOG_BYTES keeping the head and the tail."""
    out = text or ""
    for prefix in sorted({p for p in strip_prefixes if p}, key=len, reverse=True):
        out = out.replace(prefix.rstrip("/\\") + "/", "").replace(prefix.rstrip("/\\") + "\\", "")
    out = out.strip()
    return trim_log(out)


def trim_log(text: str, limit: int = MAX_LOG_BYTES) -> str:
    data = text.encode("utf-8")
    if len(data) <= limit:
        return text
    head = int(limit * 0.6)
    tail = limit - head - 64
    cut = len(data) - head - tail
    return (
        data[:head].decode("utf-8", "ignore")
        + f"\n\n… ({cut} bytes omitidos) …\n\n"
        + data[-tail:].decode("utf-8", "ignore")
    )
