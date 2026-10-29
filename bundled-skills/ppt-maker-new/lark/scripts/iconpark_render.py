#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline icon rendering for sml_to_pptx.

Strategy (local-first):
  1. Look up a pre-rendered black-on-transparent PNG in <assets>/icons/ keyed by
     the SML iconType ("iconpark/Charts/chart-line.svg"). These are shipped
     with the runtime skill; no icon pre-rendering step is required.
  2. Recolor the black glyph to the requested fill color with PIL — no SVG
     renderer needed at runtime.
  3. Optional fallback: only with PPT_ICON_ALLOW_NETWORK=1, fetch the SVG source
     from bytedance/IconPark on GitHub and render it with PyMuPDF (fitz).
  4. Last resort: return None and let the caller draw a placeholder circle.

The IconPark SVG sources are MIT-licensed and stable in the bytedance/IconPark
repo under packages/svg/src/icons/<PascalCase>.ts.
"""
from __future__ import annotations

import os
import re
import sys
import threading
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from pptx.dml.color import RGBColor

_TEMPLATE_ATTR_RE = re.compile(r"'([^']*)'")
_REMOTE_MISSES: set[str] = set()
_REMOTE_MISSES_LOCK = threading.Lock()


def clear_remote_miss_cache() -> None:
    """Clear process-local negative cache (primarily for tests/long-running tools)."""
    with _REMOTE_MISSES_LOCK:
        _REMOTE_MISSES.clear()


def icon_cache_name(icon_type: str) -> str:
    return icon_type.replace("/", "__") + ".png"


def cached_icon_path(icon_type: str, assets_dir: Optional[Path]) -> Optional[Path]:
    if not assets_dir:
        return None
    p = assets_dir / "icons" / icon_cache_name(icon_type)
    return p if p.is_file() else None


def _colorize(path: Path, rgb: RGBColor, size_px: int, out: Path) -> Optional[Path]:
    try:
        from PIL import Image
    except ImportError:
        return None
    with Image.open(str(path)) as im:
        im = im.convert("RGBA")
        # IconPark glyphs are dark (#333-ish) on transparent; recolor every
        # opaque pixel to the requested color, preserving alpha.
        alpha = im.getchannel("A")
        solid = Image.new("RGBA", im.size, (rgb[0], rgb[1], rgb[2], 255))
        im = Image.composite(solid, im, alpha)
        if size_px and abs(size_px - im.width) > 2:
            im = im.resize((size_px, size_px), Image.LANCZOS)
        im.save(str(out))
    return out


def _extract_svg(ts_source: str, color_hex: str) -> str:
    """Pull the concatenated SVG literal out of an IconPark .ts wrapper.

    The .ts body is a JS expression that concatenates string literals with
    interleaved props references, e.g. '<svg width="' + props.size + '"...>'.
    After substituting concrete values for every props.* reference, the body
    is a pure string-concatenation expression, which we evaluate under a
    whitelist guard (only string literals, '+', whitespace and props.*).
    """
    props = type(
        "Props",
        (),
        {
            "size": "48",
            "colors": [color_hex] * 4,
            "strokeWidth": "4",
            "strokeLinecap": "round",
            "strokeLinejoin": "round",
        },
    )()
    m = re.search(r"\(props: ISvgIconProps\)\s*=>\s*\(([\s\S]*?)\)\s*\);", ts_source)
    if not m:
        return ""
    body = m.group(1).strip()
    # Guard: after removing string literals and props references, only '+'
    # and whitespace may remain — nothing else may be evaluated.
    stripped = re.sub(r"'((?:[^'\\]|\\.)*)'", "", body)
    stripped = re.sub(r"props\.\w+(?:\[\d+\])?", "", stripped)
    if re.search(r"[^\s+]", stripped):
        return ""
    try:
        svg = eval("(" + body + ")", {"props": props})  # noqa: S307 - whitelist-guarded
    except Exception:
        return ""
    if "<svg" not in svg or "</svg>" not in svg:
        return ""
    return svg


def _substitute_svg_props(svg: str, color_hex: str) -> str:
    svg = re.sub(r"props\.size", "48", svg)
    svg = re.sub(r"props\.colors\[(\d+)\]", lambda m: color_hex, svg)
    svg = re.sub(r"props\.strokeWidth", "4", svg)
    svg = re.sub(r"props\.strokeLinecap", "round", svg)
    svg = re.sub(r"props\.strokeLinejoin", "round", svg)
    svg = re.sub(r"props\.colors", color_hex, svg)
    return svg


def _ts_name(icon_type: str) -> str:
    base = icon_type.rsplit("/", 1)[-1].removesuffix(".svg")
    parts = re.split(r"[-_]", base)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def fetch_render_svg(icon_type: str, rgb: RGBColor, out: Path, timeout: float = 8.0) -> Optional[Path]:
    """Best-effort network fallback: fetch the .ts, render via PyMuPDF."""
    import urllib.request

    name = _ts_name(icon_type)
    if not name:
        return None
    url = f"https://raw.githubusercontent.com/bytedance/IconPark/master/packages/svg/src/icons/{name}.ts"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "lark-slides-pro"})
        ts = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8")
    except Exception:
        return None
    svg = _extract_svg(ts, "#%02X%02X%02X" % (rgb[0], rgb[1], rgb[2]))
    if "<svg" not in svg:
        return None
    try:
        import fitz
        doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
        pix = doc[0].get_pixmap(dpi=192, alpha=True)
        pix.save(str(out))
        return out
    except Exception:
        return None


def packaged_icon_path(icon_type: str) -> Optional[Path]:
    """Shared by offline search and export; assets root, not assets/icons/icons."""
    return cached_icon_path(icon_type, Path(__file__).resolve().parent.parent / "assets")


def icon_renderer(icon_type: str, size_px: int, color: RGBColor, assets_dir: Optional[Path]) -> Optional[str]:
    """SML converter entry point: return a PNG path or None (caller draws
    a placeholder). Colorize from the shipped black cache when available."""
    cache_dir = None
    if assets_dir is not None:
        cache_dir = assets_dir / "icons"
        cache_dir.mkdir(parents=True, exist_ok=True)
        colorized = cache_dir / (icon_cache_name(icon_type).removesuffix(".png") + f".{size_px}.{color[0]:02X}{color[1]:02X}{color[2]:02X}.png")
        if colorized.exists():
            return str(colorized)
    cached = cached_icon_path(icon_type, assets_dir) or packaged_icon_path(icon_type)
    if cached is not None:
        try:
            if cache_dir is not None:
                out = _colorize(cached, color, size_px, colorized)
                if out is not None:
                    return str(out)
        except Exception:
            pass
    # network fallback (cached into the authoring dir for next time)
    if cache_dir is not None and os.environ.get("PPT_ICON_ALLOW_NETWORK") == "1":
        with _REMOTE_MISSES_LOCK:
            known_missing = icon_type in _REMOTE_MISSES
        if known_missing:
            return None
        if fetch_render_svg(icon_type, color, colorized):
            return str(colorized)
        with _REMOTE_MISSES_LOCK:
            _REMOTE_MISSES.add(icon_type)
    return None


if __name__ == "__main__":
    # minimal self-check
    from pptx.dml.color import RGBColor as C

    icon_type = sys.argv[1] if len(sys.argv) > 1 else "iconpark/Charts/chart-line.svg"
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/icon_test_out")
    out_dir.mkdir(parents=True, exist_ok=True)
    p = icon_renderer(icon_type, 48, C(37, 99, 235), out_dir)
    print("render:", p)
