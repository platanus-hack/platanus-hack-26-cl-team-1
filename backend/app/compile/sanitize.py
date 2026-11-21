"""Screening of untrusted sketch text before it reaches gcc.

The sketch is compiled verbatim, so without this a request could make the compiler read ANY
file the worker can read and echo it in the compile log (``#include "/proc/self/environ"``,
``#include "../../../.env"``) or embed it in the downloadable binary (``asm(".incbin …")``).
Code generated from blocks only ever includes plain library headers (``#include <Servo.h>``),
so the rules are strict on purpose. This is defense in depth: the compiler also runs without
secrets in its environment (``cli.child_env``) and the docker worker has no API keys.
"""
from __future__ import annotations

import re

#: gcc treats NUL and a UTF-8 BOM like whitespace at the start of a line.
_WS = r"[ \t\f\v\x00﻿]"
_DIRECTIVE_RE = re.compile(rf"^{_WS}*(?:#|%:|\?\?=){_WS}*(?P<rest>.*)$")
_IDENT_RE = re.compile(r"[A-Za-z_]\w*")
_INCLUDE_DIRECTIVES = frozenset({"include", "include_next", "import", "embed"})
_HEADER_RE = re.compile(r'^(?:<(?P<a>[^<>\n]*)>|"(?P<q>[^"\n]*)")')
#: Library header names: relative, no '..', no drive letters / backslashes / comment markers.
_SAFE_HEADER_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.+\-]*(?:/[A-Za-z0-9_][A-Za-z0-9_.+\-]*)*$")
_INLINE_COMMENT_RE = re.compile(r"/\*.*?\*/")
_SPLICE_RE = re.compile(r"\\[ \t\f\v]*\n")
_ASM_RE = re.compile(r"\b_*asm_*\b", re.IGNORECASE)
_INCBIN_RE = re.compile(r"incbin", re.IGNORECASE)
_PASTE_RE = re.compile(r"##|%:%:")
_RAW_PREFIXES = frozenset({"R", "u8R", "uR", "UR", "LR"})
_RAW_DELIM_RE = re.compile(r'([^ ()\\\t\v\f\n"]{0,16})\(')

MSG_INCLUDE = (
    "El programa incluye un archivo no permitido ({target}). En el servidor de compilación solo se "
    "pueden usar bibliotecas por su nombre, por ejemplo #include <Servo.h>."
)
MSG_DIRECTIVE = (
    "El programa tiene una directiva #include que el servidor de compilación no acepta. "
    "Escríbela como #include <Biblioteca.h>."
)
MSG_ASM = (
    "El programa usa ensamblador en línea (asm/.incbin), que el servidor de compilación no permite."
)
MSG_PASTE = "El programa usa el pegado de símbolos del preprocesador (##), que el servidor de compilación no permite."


def _normalize(code: str) -> str:
    """Translation phases 1-2: unify line endings and join backslash-newline splices."""
    text = code.replace("\r\n", "\n").replace("\r", "\n")
    return _SPLICE_RE.sub("", text)


def _code_only(text: str) -> str:
    """Remove comments (→ one space, like gcc) and the contents of string/char literals."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c == "/" and text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
            continue
        if c in "\"'":
            k = i
            while k > 0 and (text[k - 1].isalnum() or text[k - 1] == "_"):
                k -= 1
            prefix = text[k:i]
            if c == "'" and prefix[:1].isdigit():  # C++14 digit separator (1'000)
                out.append(c)
                i += 1
                continue
            if c == '"' and prefix in _RAW_PREFIXES:
                m = _RAW_DELIM_RE.match(text, i + 1)
                if m:
                    end = text.find(")" + m.group(1) + '"', m.end())
                    i = n if end < 0 else end + len(m.group(1)) + 2
                    out.append('""')
                    continue
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i = j + 1 if j < n and text[j] == c else j
            out.append(c + c)
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _directive_candidates(text: str):
    """Every physical line, plus what follows each '*/' on it (a comment may end right before a directive).

    Deliberately independent of any comment/literal tracking: a line that looks like a directive
    is checked even if it sits inside a comment or a raw string (false positives are harmless).
    """
    for line in text.split("\n"):
        yield _INLINE_COMMENT_RE.sub(" ", line)
        for m in re.finditer(r"\*/", line):
            yield _INLINE_COMMENT_RE.sub(" ", line[m.end():])


def _check_directives(text: str) -> str | None:
    for cand in _directive_candidates(text):
        m = _DIRECTIVE_RE.match(cand)
        if not m:
            continue
        rest = m.group("rest")
        if rest.startswith("/*"):  # a comment that spans lines inside the directive head
            return MSG_DIRECTIVE
        name = _IDENT_RE.match(rest)
        if not name or name.group() not in _INCLUDE_DIRECTIVES:
            continue
        operand = rest[name.end():].strip(" \t\f\v\x00")
        hm = _HEADER_RE.match(operand)
        if not hm:  # computed include (#include MACRO) or garbage
            return MSG_DIRECTIVE
        target = hm.group("a") if hm.group("a") is not None else hm.group("q")
        if not _SAFE_HEADER_RE.match(target) or ".." in target.split("/"):
            return MSG_INCLUDE.format(target=target.strip() or "vacío")
    return None


def unsafe_sketch_reason(code: str) -> str | None:
    """Spanish reason why this sketch must not be compiled on the server, or None when it is fine."""
    text = _normalize(code)
    reason = _check_directives(text)
    if reason:
        return reason
    if _ASM_RE.search(text) or _INCBIN_RE.search(text):
        return MSG_ASM
    if _PASTE_RE.search(_code_only(text)):
        return MSG_PASTE
    return None
