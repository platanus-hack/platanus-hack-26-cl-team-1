"""Toolchain facts per board, read from shared/boards/<id>.json (BoardProfile.toolchain)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from ..settings import settings

#: Boards the compile service accepts (BoardId in frontend/src/contracts/model.ts).
BOARD_IDS: tuple[str, ...] = ("uno", "esp32c6")

#: Friendly download names (the browser shows them in the downloads bar).
_DOWNLOAD_EXT = {".hex": "hex", ".bin": "bin"}


@dataclass(frozen=True)
class BoardToolchain:
    id: str
    name: str
    fqbn: str  # full FQBN incl. options, e.g. 'esp32:esp32:esp32c6:CDCOnBoot=cdc'
    core: str  # 'arduino:avr' | 'esp32:esp32'
    min_core_version: str
    libraries: tuple[str, ...]
    artifact_suffix: str  # '.ino.hex' | '.ino.merged.bin'
    #: Headers that belong to each library (used to explain a missing #include).
    library_headers: dict[str, str] = field(default_factory=dict)

    @property
    def fallback_suffix(self) -> str | None:
        """Second-best artifact when the preferred one is missing (ESP32: app-only .bin at 0x10000)."""
        return ".ino.bin" if self.artifact_suffix == ".ino.merged.bin" else None

    def download_name(self, artifact_name: str) -> str:
        ext = Path(artifact_name).suffix
        stem = f"circuito-vivo-{self.id}"
        if self.fallback_suffix and artifact_name.endswith(self.fallback_suffix) and not artifact_name.endswith(self.artifact_suffix):
            stem += "-app-0x10000"
        return f"{stem}.{_DOWNLOAD_EXT.get(ext, ext.lstrip('.') or 'bin')}"


def _board_file(board_id: str) -> Path:
    return Path(settings.shared_dir) / "boards" / f"{board_id}.json"


@lru_cache(maxsize=None)
def get_toolchain(board_id: str) -> BoardToolchain:
    if board_id not in BOARD_IDS:
        raise KeyError(board_id)
    data = json.loads(_board_file(board_id).read_text(encoding="utf-8"))
    tc = data.get("toolchain") or {}
    fqbn = data["fqbn"]
    if tc.get("fqbnOptions"):
        fqbn = f"{fqbn}:{tc['fqbnOptions']}"
    libraries = tuple(lib["name"] for lib in tc.get("libraries", []) if lib.get("name"))
    headers: dict[str, str] = {name: f"{name}.h" for name in libraries}
    servo = data.get("libraries") or {}
    if servo.get("servoLib") and servo.get("servoInclude"):
        headers[servo["servoLib"]] = servo["servoInclude"]
    return BoardToolchain(
        id=board_id,
        name=data.get("name", board_id),
        fqbn=fqbn,
        core=tc.get("core", ":".join(data["fqbn"].split(":")[:2])),
        min_core_version=tc.get("minCoreVersion", "0"),
        libraries=libraries,
        artifact_suffix=tc.get("artifactSuffix", ".ino.hex"),
        library_headers=headers,
    )


def all_toolchains() -> list[BoardToolchain]:
    out = []
    for board_id in BOARD_IDS:
        try:
            out.append(get_toolchain(board_id))
        except (OSError, KeyError, ValueError):
            continue
    return out
