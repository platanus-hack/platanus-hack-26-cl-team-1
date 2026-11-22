# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11"]
# ///
"""Regenerate icons and animation geometry: `uv run scripts/generate-icons.py` (requires rsvg-convert)."""

from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "web" / "public"


def render(source: bytes) -> Image.Image:
    result = subprocess.run(
        ["rsvg-convert", "--width", "1024", "--height", "1024"],
        input=source,
        capture_output=True,
        check=True,
    )
    return Image.open(BytesIO(result.stdout)).convert("RGB")


def main() -> None:
    if not shutil.which("rsvg-convert"):
        raise SystemExit("Install librsvg (rsvg-convert) before generating the web icons.")

    source = (ROOT / "project-logo.svg").read_bytes()
    master = ET.fromstring(source)
    if master.get("viewBox") != "0 0 1000 1000":
        raise SystemExit("Expected a 1000×1000 project-logo.svg master; review the icon framing.")

    # The submission master has generous padding. Frame the same geometry more tightly
    # so the flame and diagonal firebreak stay legible in a 16 px browser tab.
    icon_source = source.replace(b'viewBox="0 0 1000 1000"', b'viewBox="150 120 700 700"', 1)
    if icon_source == source:
        raise SystemExit("Could not update the SVG viewBox; review the icon framing.")

    # Inline SVG animation needs the same editable paths, not a separately redrawn logo.
    def part(part_id: str) -> ET.Element:
        node = master.find(f".//*[@id='{part_id}']")
        if node is None:
            raise SystemExit(f"Missing logo element: {part_id}")
        return node

    cut = part("firebreak").find("{http://www.w3.org/2000/svg}path")
    if cut is None:
        raise SystemExit("Missing firebreak mask path.")
    geometry = {
        "viewBox": ET.fromstring(icon_source).attrib["viewBox"],
        "flamePath": part("flame").attrib["d"],
        "cutPath": cut.attrib["d"],
        "cutWidth": float(cut.attrib["stroke-width"]),
        "symbolTransform": part("symbol").attrib["transform"],
        "color": part("flame").attrib["fill"],
    }
    (ROOT / "web" / "src" / "ui" / "logoGeometry.generated.json").write_text(
        json.dumps(geometry, indent=2) + "\n"
    )

    icons = PUBLIC / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "favicon.svg").write_bytes(icon_source)
    icon = render(icon_source)
    for size in (192, 512):
        icon.resize((size, size), Image.Resampling.LANCZOS).save(icons / f"icon-{size}.png", optimize=True)
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    icon.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # Preserve the master's full safe area for launchers that crop app icons to a mask.
    render(source).resize((512, 512), Image.Resampling.LANCZOS).save(
        icons / "icon-maskable-512.png", optimize=True
    )
    print("Generated logo geometry, SVG/ICO favicons, Apple touch icon, and 192/512 px app icons.")


if __name__ == "__main__":
    main()
