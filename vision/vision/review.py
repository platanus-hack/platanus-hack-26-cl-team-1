"""Keyboard-first reviewer for the auto-labelled YOLO dataset (F4), served by the vision server.

    app.include_router(review.router)   →   https://<tunnel>/review

Dataset: `<CV_DATA>/yolo/labeled` (layout in `yolo_io`). Images are addressed by their path relative to
`images/` (e.g. `?path=<session>/<file>.jpg`), validated so nothing outside the dataset is reachable.
"""

from __future__ import annotations

import threading
from pathlib import Path, PurePosixPath
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from .classes import CLASS_SPECS, NC
from .yolo_io import (
    DELETED,
    IMAGE_EXTS,
    REVIEWED,
    Box,
    class_counts,
    data_dir,
    format_yolo,
    iter_images,
    label_path,
    parse_yolo,
    read_label_counts,
    read_set,
    write_atomic,
    write_set,
)

PAGE = Path(__file__).parent / "static" / "review.html"
_lock = threading.Lock()  # sync endpoints run in a thread pool; guards reviewed.json / deleted.json


def dataset_root() -> Path:
    return data_dir() / "yolo" / "labeled"


Root = Annotated[Path, Depends(dataset_root)]
RelPath = Annotated[str, Query(alias="path", max_length=300)]


class BoxIn(BaseModel):
    cls: int = Field(ge=0, lt=NC)
    x1: float
    y1: float
    x2: float
    y2: float


class LabelsIn(BaseModel):
    boxes: list[BoxIn] = Field(max_length=500)
    reviewed: bool | None = None  # None: leave the reviewed flag as is


class ReviewedIn(BaseModel):
    reviewed: bool = True


def safe_image(root: Path, path: str) -> tuple[str, Path]:
    """Validate a client path ('<session>/<file>.jpg') → (normalised key, absolute image path)."""
    rel = PurePosixPath(path)
    if (
        not path
        or "\\" in path
        or "\x00" in path
        or rel.is_absolute()
        or any(part in ("", ".", "..") or part.startswith("~") for part in rel.parts)
        or rel.suffix.lower() not in IMAGE_EXTS
    ):
        raise HTTPException(400, "Ruta inválida")
    img = root / "images" / rel
    if not img.is_file():
        raise HTTPException(404, "Imagen no encontrada")
    return rel.as_posix(), img


def image_size(img: Path) -> tuple[int, int]:
    with Image.open(img) as im:
        return im.size


def set_flag(root: Path, name: str, key: str, on: bool) -> None:
    with _lock:
        items = read_set(root / name)
        if (key in items) != on:
            items.symmetric_difference_update({key})
            write_set(root / name, items)


router = APIRouter(prefix="/review", tags=["review"])


@router.get("", include_in_schema=False)
@router.get("/", include_in_schema=False)
def page() -> FileResponse:
    return FileResponse(PAGE, media_type="text/html", headers={"Cache-Control": "no-cache"})


@router.get("/api/images")
def list_images(root: Root) -> dict:
    """Every image with its reviewed flag and per-class box counts, plus the class table for the UI."""
    images_dir = root / "images"
    reviewed = read_set(root / REVIEWED)
    items = []
    for img in iter_images(images_dir):
        key = img.relative_to(images_dir).as_posix()
        items.append({"path": key, "reviewed": key in reviewed, "counts": read_label_counts(label_path(root, key))})
    return {
        "root": str(root),
        "classes": [{"id": i, "name": c.name, "es": c.es, "color": c.color} for i, c in enumerate(CLASS_SPECS)],
        "images": items,
    }


@router.get("/api/image")
def get_image(root: Root, path: RelPath) -> FileResponse:
    _, img = safe_image(root, path)
    return FileResponse(img, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/api/labels")
def get_labels(root: Root, path: RelPath) -> dict:
    key, img = safe_image(root, path)
    w, h = image_size(img)
    lbl = label_path(root, key)
    boxes = parse_yolo(lbl.read_text(), w, h) if lbl.is_file() else []
    return {
        "path": key,
        "width": w,
        "height": h,
        "boxes": [{"cls": b.cls, **{k: round(getattr(b, k), 1) for k in ("x1", "y1", "x2", "y2")}} for b in boxes],
        "reviewed": key in read_set(root / REVIEWED),
    }


@router.put("/api/labels")
def put_labels(root: Root, path: RelPath, body: LabelsIn) -> dict:
    key, img = safe_image(root, path)
    w, h = image_size(img)
    boxes = [b for b in (Box(x.cls, x.x1, x.y1, x.x2, x.y2).clamped(w, h) for x in body.boxes) if b]
    write_atomic(label_path(root, key), format_yolo(boxes, w, h))
    if body.reviewed is not None:
        set_flag(root, REVIEWED, key, body.reviewed)
    return {"path": key, "counts": class_counts(boxes), "reviewed": key in read_set(root / REVIEWED)}


@router.post("/api/reviewed")
def mark_reviewed(root: Root, path: RelPath, body: ReviewedIn) -> dict:
    key, _ = safe_image(root, path)
    set_flag(root, REVIEWED, key, body.reviewed)
    return {"path": key, "reviewed": body.reviewed}


@router.delete("/api/image")
def delete_image(root: Root, path: RelPath) -> dict:
    """Delete an image and its label; it is remembered in deleted.json so autolabel won't bring it back."""
    key, img = safe_image(root, path)
    img.unlink()
    label_path(root, key).unlink(missing_ok=True)
    set_flag(root, REVIEWED, key, False)
    set_flag(root, DELETED, key, True)
    return {"path": key, "deleted": True}
