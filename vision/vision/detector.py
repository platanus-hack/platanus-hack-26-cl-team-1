"""YOLO detections → breadboard grid placement → estimated leg holes.

Boxes are projected into breadboard grid units with the registration homography; the
part's centre in grid units is what the state machine compares with the expected legs
(robust to the box size). Leg holes are estimated from the part geometry (catalog pin
offsets) around that centre — for the debug overlay and the VLM prompt.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .registration import Registration, grid_to_hole

log = logging.getLogger(__name__)

COMPONENT_CLASSES = {"led_red", "led_green", "led_yellow", "resistor", "button", "potentiometer", "buzzer"}

# Leg offsets from the part centre, in grid units, for the usual horizontal placement
# (shared/parts/*.json pin coordinates, centred).
_LEG_OFFSETS: dict[str, list[tuple[float, float]]] = {
    "led": [(-0.5, 0.0), (0.5, 0.0)],
    "button": [(-1.0, -1.5), (1.0, -1.5), (-1.0, 1.5), (1.0, 1.5)],
    "buzzer": [(-1.5, 0.0), (1.5, 0.0)],
    "potentiometer": [(-2.0, 0.0), (0.0, 0.0), (2.0, 0.0)],
}


@dataclass
class Det:
    cls: str
    conf: float
    box: tuple[float, float, float, float]  # x1 y1 x2 y2, frame px (OpenCV convention)

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.box
        return (x1 + x2) / 2, (y1 + y2) / 2


@dataclass
class Placed:
    det: Det
    grid_center: tuple[float, float] | None = None
    grid_box: tuple[float, float, float, float] | None = None  # gx1 gy1 gx2 gy2
    holes: list[str] = field(default_factory=list)
    color: str | None = None  # wire_end colour (HSV)

    @property
    def cls(self) -> str:
        return self.det.cls

    def to_msg(self) -> dict:
        """Debug payload (canvas convention: +0.5 px)."""
        x1, y1, x2, y2 = self.det.box
        d = {
            "cls": self.cls,
            "conf": round(self.det.conf, 3),
            "box": [round(x1 + 0.5, 1), round(y1 + 0.5, 1), round(x2 + 0.5, 1), round(y2 + 0.5, 1)],
        }
        if self.holes:
            d["holes"] = self.holes
        if self.color:
            d["color"] = self.color
        return d


def _family(cls: str) -> str:
    return "led" if cls.startswith("led_") else cls


def place(dets: list[Det], reg: Registration) -> list[Placed]:
    H = reg.H
    if H is None:
        return [Placed(d) for d in dets]
    Hinv = np.linalg.inv(H)
    out: list[Placed] = []
    for d in dets:
        x1, y1, x2, y2 = d.box
        quad = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [(x1 + x2) / 2, (y1 + y2) / 2]], dtype=np.float64)
        g = cv2.perspectiveTransform(quad[None], Hinv)[0]
        gx1, gy1 = g[:4].min(0)
        gx2, gy2 = g[:4].max(0)
        p = Placed(d, (float(g[4, 0]), float(g[4, 1])), (float(gx1), float(gy1), float(gx2), float(gy2)))
        p.holes = estimate_holes(p)
        out.append(p)
    return out


def estimate_holes(p: Placed) -> list[str]:
    if p.grid_center is None or p.grid_box is None:
        return []
    cx, cy = p.grid_center
    fam = _family(p.cls)
    if fam == "wire_end":
        h = grid_to_hole(cx, cy, tol=0.6)
        return [h] if h else []
    if fam == "resistor":
        gx1, gy1, gx2, gy2 = p.grid_box
        if gx2 - gx1 >= gy2 - gy1:  # lying along a row: legs at the two ends
            pts = [(gx1 + 0.4, cy), (gx2 - 0.4, cy)]
        else:
            pts = [(cx, gy1 + 0.4), (cx, gy2 - 0.4)]
    elif fam in _LEG_OFFSETS:
        pts = [(cx + dx, cy + dy) for dx, dy in _LEG_OFFSETS[fam]]
    else:
        return []
    holes = [grid_to_hole(x, y, tol=0.6) for x, y in pts]
    return [h for h in holes if h]


# HSV ranges (OpenCV: H 0-179). Order matters: achromatic first.
def wire_color(img: np.ndarray, box: tuple[float, float, float, float]) -> str | None:
    """Dominant jumper colour around a wire_end box (the plug housing is often black: look at the
    saturated pixels of the box grown 60 %)."""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = box
    gx, gy = (x2 - x1) * 0.3, (y2 - y1) * 0.3
    xa, ya, xb, yb = int(max(0, x1 - gx)), int(max(0, y1 - gy)), int(min(w, x2 + gx)), int(min(h, y2 + gy))
    if xb - xa < 2 or yb - ya < 2:
        return None
    hsv = cv2.cvtColor(img[ya:yb, xa:xb], cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.int32)
    s, v = hsv[:, 1], hsv[:, 2]
    colored = hsv[(s > 90) & (v > 60)]
    if len(colored) >= 0.12 * len(hsv):
        hue = float(np.median(colored[:, 0]))
        if hue < 8 or hue >= 165:
            return "red"
        if hue < 20:
            return "orange"
        if hue < 35:
            return "yellow"
        if hue < 85:
            return "green"
        if hue < 128:
            return "blue"
        return "purple"
    dark = np.mean(v < 60)
    bright = np.mean((v > 190) & (s < 40))
    if dark > 0.35:
        return "black"
    if bright > 0.35:
        return "white"
    return None


class Detector:
    """Ultralytics YOLO from CV_YOLO: the fine-tuned weights (or, explicitly, a YOLO-World file)."""

    def __init__(self, weights: str | Path | None = None, conf: float = 0.35, imgsz: int = 640) -> None:
        from ultralytics import YOLO, YOLOWorld  # GPU extra

        weights = weights or os.environ.get("CV_YOLO")
        if not weights:
            # Zero-shot YOLO-World found nothing on real breadboard photos: without fine-tuned weights
            # the live session is better off judging part/wire steps with the VLM alone.
            raise RuntimeError("CV_YOLO no está definido (pesos fine-tuned de YOLO)")
        weights = str(weights)
        self.conf = conf
        self.imgsz = imgsz
        self.zero_shot = "world" in Path(weights).name
        if self.zero_shot:
            from .classes import CLASSES, PROMPTS  # written by the F4 tooling

            self.model = YOLOWorld(weights)
            self.model.set_classes([PROMPTS[c] for c in CLASSES])
            self.names = list(CLASSES)
        else:
            self.model = YOLO(weights)
            self.names = [self.model.names[i] for i in sorted(self.model.names)]
        self.weights = weights
        self(np.zeros((480, 640, 3), np.uint8))  # warm-up
        log.info("detector %s (%s)", weights, "zero-shot" if self.zero_shot else "fine-tuned")

    def __call__(self, img: np.ndarray) -> list[Det]:
        r = self.model.predict(img, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        out: list[Det] = []
        if r.boxes is None:
            return out
        xyxy = r.boxes.xyxy.cpu().numpy()
        cls = r.boxes.cls.cpu().numpy().astype(int)
        conf = r.boxes.conf.cpu().numpy()
        for b, c, p in zip(xyxy, cls, conf, strict=True):
            # ultralytics boxes use pixel edges; registration uses OpenCV pixel centres
            out.append(Det(self.names[c], float(p), (b[0] - 0.5, b[1] - 0.5, b[2] - 0.5, b[3] - 0.5)))
        return out
