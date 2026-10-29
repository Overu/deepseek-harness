#!/usr/bin/env python3
"""Common-system-font preflight with optional cached fontTools inspection."""
from __future__ import annotations

import os
import re
import sys
import json
import hashlib
from functools import lru_cache
from pathlib import Path


FONT_KEYS = ("zh_display", "zh_body", "latin_display", "latin_body")
COMMON_ZH = ('Microsoft YaHei', 'Microsoft YaHei UI', '微软雅黑', 'PingFang SC', '苹方-简', 'Hiragino Sans GB', 'DengXian', '等线', 'SimHei', '黑体', 'SimSun', '宋体', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei')
COMMON_LATIN = ('Arial', 'Calibri', 'Aptos', 'Helvetica', 'Helvetica Neue', 'Liberation Sans', 'DejaVu Sans')
WEIGHT_SUFFIX = re.compile(
    r"(?:[- _](?:thin|extralight|ultralight|light|regular|medium|semibold|demibold|bold|extrabold|black|italic|oblique|w[0-9]))+$",
    re.IGNORECASE,
)


def _font_dirs() -> list[Path]:
    directories: list[Path] = []
    if sys.platform == "darwin":
        directories.extend((Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library/Fonts"))
    elif os.name == "nt":
        root = Path(os.environ.get("SystemRoot", "C:/Windows"))
        directories.append(root / "Fonts")
        local = os.environ.get('LOCALAPPDATA')
        if local:
            directories.append(Path(local) / 'Microsoft/Windows/Fonts')
    else:
        directories.extend((Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts"))
    return directories


@lru_cache(maxsize=1)
def default_font_family():
    """Same common installed family selection used by planning; no ornamental default."""
    fonts, _ = resolve_font_contract({})
    # A legacy standalone conversion may have no inspectable CJK installation.
    # Keep a common portable name, but doctor/preflight reports missing coverage.
    return fonts.get('zh_body') or fonts.get('latin_body') or 'Arial'


@lru_cache(maxsize=1)
def available_font_families() -> frozenset[str]:
    """Actual family names, never filenames; name-table scans are cached."""
    index = _font_index(tuple(str(p) for p in _font_dirs())) or {}
    return frozenset(face[2] for faces in index.values() for face in faces)


def _lookup(installed: set[str] | frozenset[str], candidate: str) -> str | None:
    normalized = {item.casefold(): item for item in installed}
    if exact := normalized.get(candidate.casefold()):
        return exact
    canonical = lambda value: "".join(character for character in value.casefold() if character.isalnum())
    wanted = canonical(candidate)
    if wanted and any(canonical(item) == wanted for item in installed):
        # Use the requested family spelling; installed values may be filename
        # stems such as PlayfairDisplay rather than Office family labels.
        return candidate
    return None


def font_is_available(family: str, installed: set[str] | frozenset[str] | None = None) -> bool | None:
    available = available_font_families() if installed is None else frozenset(installed)
    if _lookup(available, family) is not None:
        return True
    if installed is not None:
        return False
    index = _font_index(tuple(str(p) for p in _font_dirs()))
    return None if index is None else bool(_selected_faces(family))


@lru_cache(maxsize=8)
def _font_index(directories):
    """Read name tables once per process; never load every glyph table."""
    try:
        from fontTools.ttLib import TTFont, TTCollection
    except ImportError:
        return None
    files = []
    for directory in directories:
        for path in Path(directory).rglob('*'):
            if path.suffix.lower() in {'.ttf','.otf','.ttc','.otc'}:
                try:
                    st = path.stat()
                    files.append((str(path), st.st_size, st.st_mtime_ns))
                except OSError:
                    continue
    signature = hashlib.sha256(json.dumps(sorted(files)).encode()).hexdigest()
    cache_path = Path(os.environ['PPT_FONT_INDEX_CACHE']) if os.environ.get('PPT_FONT_INDEX_CACHE') else None
    if cache_path:
        try:
            cached = json.loads(cache_path.read_text(encoding='utf-8'))
            if cached.get('version') == 2 and cached.get('signature') == signature:
                return cached['index']
        except (OSError, ValueError, KeyError, TypeError):
            pass
    index = {}
    for directory in directories:
        for path in Path(directory).rglob('*'):
            if path.suffix.lower() not in {'.ttf','.otf','.ttc','.otc'}:
                continue
            resource = None
            try:
                resource = TTCollection(path,lazy=True) if path.suffix.lower() in {'.ttc','.otc'} else TTFont(path,lazy=True)
                fonts = resource.fonts if hasattr(resource,'fonts') else [resource]
                for face_no,font in enumerate(fonts):
                    names = {n.toUnicode() for n in font['name'].names if n.nameID in {1,16}}
                    for name in names:
                        key = ''.join(c for c in name.casefold() if c.isalnum())
                        index.setdefault(key,[]).append((str(path),face_no,name))
            except Exception:
                # Unsupported or unreadable files are unknown, never proof of coverage.
                continue
            finally:
                if resource is not None:
                    resource.close()
    if cache_path:
        try:
            from stage_runtime import atomic_write_json
            atomic_write_json(cache_path, {'version':2,'signature':signature,'index':index})
        except OSError:
            pass
    return index


def _selected_faces(family):
    key = ''.join(c for c in family.casefold() if c.isalnum())
    return list(dict.fromkeys((face[0],face[1]) for face in
        (_font_index(tuple(str(p) for p in _font_dirs())) or {}).get(key, [])))


@lru_cache(maxsize=64)
def _font_glyphs(path, face_no):
    try:
        from fontTools.ttLib import TTFont
        with TTFont(path,fontNumber=face_no,lazy=True) as font:
            return frozenset((font.getBestCmap() or {}).keys())
    except Exception:
        return None


def font_covers_text(family, text):
    """True/False from actual cmap; None means no inspectable matching face."""
    required = {ord(c) for c in text if not c.isspace()}
    if not required:
        return True
    maps = [_font_glyphs(*face) for face in _selected_faces(family)]
    known = [glyphs for glyphs in maps if glyphs is not None]
    if any(required <= glyphs for glyphs in known):
        return True
    return False if known and len(known) == len(maps) else None


def font_supports_cjk(family: str) -> bool | None:
    return font_covers_text(family, '中文')


def _fallback(key: str, installed: set[str] | frozenset[str], *, inspect=True) -> str:
    candidates = COMMON_ZH if key.startswith('zh_') else COMMON_LATIN
    choices = [name for candidate in candidates if (name := _lookup(installed, candidate))]
    unverified = []
    for name in choices:
        coverage = font_covers_text(name, '中文') if inspect and key.startswith('zh_') else True
        if coverage is True:
            return name
        if coverage is None:
            unverified.append(name)
    if unverified:
        return unverified[0]  # Known common family; glyph coverage is unknown, not missing.
    return ""  # Unresolved, never a guessed installed family.


def resolve_font_contract(
    requested: dict | None, *, installed: set[str] | frozenset[str] | None = None,
    allow_custom: bool = False,
) -> tuple[dict[str, str], list[dict]]:
    """Resolve four contract fonts to exact installed family names."""
    available = available_font_families() if installed is None else frozenset(installed)
    requested = requested or {}
    resolved: dict[str, str] = {}
    issues: list[dict] = []
    unknown = installed is None and _font_index(tuple(str(p) for p in _font_dirs())) is None
    for key in FONT_KEYS:
        raw = str(requested.get(key) or "").strip()
        invalid_stack = "," in raw
        if invalid_stack:
            issues.append({
                "code": "font_stack_not_supported", "slot": key, "requested": raw,
                "message": "PowerPoint fontFamily must be one exact family, not a CSS fallback list",
            })
        found = None if invalid_stack or not raw else _lookup(available, raw)
        if not found and raw and not invalid_stack and installed is None and _selected_faces(raw):
            found = raw
        exact = found
        if found is not None and key.startswith("zh_") and font_supports_cjk(raw) is False:
            issues.append({
                "code": "font_missing_cjk_coverage", "slot": key, "requested": raw,
                "message": "font cmap does not cover the CJK preflight sample",
            })
            exact = None
        if raw and found is None and not unknown:
            issues.append({
                "code": "font_not_installed", "slot": key, "requested": raw,
                "message": "requested font is not installed on the authoring host",
            })
        common = _lookup(frozenset(COMMON_ZH if key.startswith('zh_') else COMMON_LATIN), raw) is not None
        if raw and not common and not allow_custom:
            exact = None
            issues.append({'code':'font_common_family_substitution','slot':key,'requested':raw,
                           'message':'Use common system fonts; no arbitrary decorative-family fallback'})
        unresolved_request = raw if unknown and not invalid_stack and (common or allow_custom) else ''
        resolved[key] = exact or unresolved_request or _fallback(key, available, inspect=installed is None)
        if unknown and not resolved[key]:
            resolved[key] = ('PingFang SC' if sys.platform == 'darwin' else 'Microsoft YaHei' if os.name == 'nt' else 'Noto Sans CJK SC') if key.startswith('zh_') else 'Arial'
        if unknown or (installed is None and resolved[key] and key.startswith('zh_') and font_supports_cjk(resolved[key]) is None):
            issues.append({'code':'font_coverage_unverified','slot':key,'requested':raw,
                           'message':'Font metadata inspection unavailable; family/coverage unverified'})
        elif not resolved[key]:
            issues.append({'code':'font_dependency_unresolved','slot':key,'requested':raw,
                           'message':'No verified installed fallback; resolve local fonts before rendering'})
    return resolved, issues


def preflight_contract(fonts):
    """Read-only dependency check; do not spend model calls fixing local fonts."""
    errors = []
    for slot, family in (fonts or {}).items():
        if slot not in FONT_KEYS:
            continue
        if not family or font_is_available(str(family)) is False:
            errors.append({'code':'font_not_installed','slot':slot,'font':family,
                           'message':'Select an installed common system font before model rendering'})
        elif slot.startswith('zh_') and font_supports_cjk(str(family)) is False:
            errors.append({'code':'font_missing_cjk_coverage','slot':slot,'font':family,
                           'message':'Selected Chinese font lacks CJK coverage'})
    return errors
