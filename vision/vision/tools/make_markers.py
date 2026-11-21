"""Printable calibration mat (A4 landscape PDF, real size).

    uv run python -m vision.tools.make_markers [--out out/tapete-aruco.pdf]

Prints 4 ArUco markers (DICT_4X4_50, ids 0-3, 20 mm) around the outlines of the
Arduino Uno and the half-size breadboard. Stick the breadboard on its outline,
tape the sheet to the table and never move the camera afterwards.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from vision import mat

DPI = 300
PAGE_W_MM, PAGE_H_MM = 297.0, 210.0
# Mat frame (mm) → page (mm): centre the mat's bounding box, a bit higher to leave room for the notes.
OFF_X = (PAGE_W_MM - (mat.MAT_MAX_X - mat.MAT_MIN_X)) / 2 - mat.MAT_MIN_X
OFF_Y = (PAGE_H_MM - 30 - (mat.MAT_MAX_Y - mat.MAT_MIN_Y)) / 2 - mat.MAT_MIN_Y


def mm2px(v: float) -> int:
    return round(v / 25.4 * DPI)


def _font(size_mm: float) -> ImageFont.ImageFont:
    size = mm2px(size_mm)
    for name in ("DejaVuSans.ttf", "Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def render_mat() -> Image.Image:
    page = Image.new("L", (mm2px(PAGE_W_MM), mm2px(PAGE_H_MM)), 255)
    d = ImageDraw.Draw(page)

    def P(x: float, y: float) -> tuple[int, int]:
        return mm2px(x + OFF_X), mm2px(y + OFF_Y)

    aruco = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, mat.ARUCO_DICT))
    side = mm2px(mat.MARKER_MM)
    for m in mat.MARKERS.values():
        img = cv2.aruco.generateImageMarker(aruco, m.id, side)
        x0, y0 = P(m.cx - mat.MARKER_MM / 2, m.cy - mat.MARKER_MM / 2)
        page.paste(Image.fromarray(img), (x0, y0))
        d.text(P(m.cx - 2, m.cy + mat.MARKER_MM / 2 + 1), str(m.id), fill=0, font=_font(3))

    line = mm2px(0.4)
    # Breadboard outline + the four corner holes (a1, a30, j1, j30) used for click calibration.
    d.rectangle([P(0, 0), P(mat.BB_W_MM, mat.BB_H_MM)], outline=0, width=line)
    d.text(P(2, mat.BB_H_MM + 1.5), "Protoboard 400 puntos (pegar aquí)", fill=0, font=_font(3))
    for hole in ("a1", "a30", "j1", "j30"):
        gx, gy = mat.hole_grid(hole)  # type: ignore[misc]
        cx, cy = gx * mat.GRID_MM, gy * mat.GRID_MM
        d.line([P(cx - 1.5, cy), P(cx + 1.5, cy)], fill=0, width=line)
        d.line([P(cx, cy - 1.5), P(cx, cy + 1.5)], fill=0, width=line)
    # Uno outline
    d.rectangle(
        [P(mat.UNO_X_MM, mat.UNO_Y_MM), P(mat.UNO_X_MM + mat.UNO_W_MM, mat.UNO_Y_MM + mat.UNO_H_MM)],
        outline=0,
        width=line,
    )
    d.text(P(mat.UNO_X_MM + 2, mat.UNO_H_MM + 1.5), "Arduino Uno (pines digitales arriba)", fill=0, font=_font(3))

    # Scale bar + instructions
    bx, by = 20.0, PAGE_H_MM - 22
    d.rectangle([mm2px(bx), mm2px(by), mm2px(bx + 50), mm2px(by + 2)], fill=0)
    d.text((mm2px(bx), mm2px(by + 3)), "50 mm", fill=0, font=_font(3))
    notes = (
        "Circuito Vivo — tapete de calibración del Modo Armado (ArUco DICT_4X4_50, ids 0–3, 20 mm).\n"
        "Imprimir al 100 % (tamaño real, sin 'ajustar a la página'). La barra negra debe medir 50 mm.\n"
        "Pega la protoboard sobre su contorno y el tapete a la mesa. No muevas la cámara después de calibrar."
    )
    d.multiline_text((mm2px(bx + 60), mm2px(by - 1)), notes, fill=0, font=_font(2.8), spacing=mm2px(1))
    return page


def main(argv: list[str] | None = None) -> Path:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="out/tapete-aruco.pdf")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    page = render_mat()
    page.save(out, "PDF", resolution=DPI)
    page.save(out.with_suffix(".png"), dpi=(DPI, DPI))
    # Sanity check: every marker must be detectable in the rendered page.
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, mat.ARUCO_DICT)))
    _, ids, _ = det.detectMarkers(np.array(page))
    found = sorted(int(i) for i in ids.flatten()) if ids is not None else []
    if found != [0, 1, 2, 3]:
        raise SystemExit(f"Marcadores detectados en el render: {found} (se esperaban 0-3)")
    print(f"OK {out} ({PAGE_W_MM:.0f}x{PAGE_H_MM:.0f} mm, {DPI} dpi), marcadores {found}")
    return out


if __name__ == "__main__":
    main()
