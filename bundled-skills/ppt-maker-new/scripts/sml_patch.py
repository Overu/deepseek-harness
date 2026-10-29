#!/usr/bin/env python3
"""Apply exact, model-authored SML mutations with fail-closed transactions."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET
from functools import lru_cache
import sys

from ppt_contract import PATCH_LIMITS, PATCH_OPERATION_FIELDS
from stage_runtime import atomic_write_text
from quality_policy import partition


SML_NS = "https://www.larkoffice.com/sml/2.0"
ET.register_namespace("", SML_NS)


class PatchRejected(ValueError):
    """The patch is unsafe, stale, ambiguous, or outside the allowed DSL."""


@dataclass(frozen=True)
class PatchResult:
    committed: bool
    operation_count: int
    errors: list[dict] = field(default_factory=list)
    reason: str | None = None
    warnings: list[dict] = field(default_factory=list)
    candidate_xml: str | None = None


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sml_sha256(sml: str) -> str:
    return hashlib.sha256(sml.encode("utf-8")).hexdigest()


def blueprint_sha256(page: dict) -> str:
    return hashlib.sha256(_canonical_json(page)).hexdigest()


def _local_name(tag: str) -> str:
    return tag.split("}")[-1]


@lru_cache(maxsize=1)
def _schema_attributes():
    backend = Path(__file__).resolve().parents[1] / 'lark'
    sys.path.insert(0, str(backend / 'scripts'))
    from sxsd_validator import load_tag_attributes
    return load_tag_attributes(backend / 'references/xml/slides_xml_schema_definition.xml')


@lru_cache(maxsize=1)
def _schema_model():
    _schema_attributes()
    from sxsd_validator import load_schema_model
    return load_schema_model(str(Path(__file__).resolve().parents[1] / 'lark/references/xml/slides_xml_schema_definition.xml'))


def _attribute_rules(tag: str):
    from sxsd_validator import attributes_for_element, best_element_rule, concrete_element_rule
    model = _schema_model()
    rule = best_element_rule(tag, model)
    return attributes_for_element(concrete_element_rule(rule, model), model) if rule else {}


def attribute_constraints(tag: str) -> dict:
    model = _schema_model()
    fields = {f for values in allowed_operations(tag).values() for f in values}
    result = {}
    for name, attribute in _attribute_rules(tag).items():
        if name not in fields:
            continue
        result[name] = {'type': attribute.type_name, 'required': attribute.required}
        rule = model.simple_types.get(attribute.type_name)
        if rule:
            if rule.enums:
                result[name]['enum'] = list(rule.enums)
            if rule.bounds:
                result[name]['bounds'] = {key: str(value) for key, value in rule.bounds}
    return result


@lru_cache(maxsize=1)
def generation_schema_excerpt() -> str:
    """Compact exact scalar contracts from the same XSD used by lint/patches."""
    model = _schema_model()
    rows = {}
    from backend_capabilities import generation_contract
    backend = generation_contract()
    preferred_shapes = set(backend['shape_types'])
    for tag in ('shape','content','img','crop','border'):
        attributes = _schema_attributes().get(tag, set()) & backend['generation_attributes'][tag]
        row = {'attributes':sorted(attributes), 'values':{}}
        for name,attribute in _attribute_rules(tag).items():
            if name not in attributes:
                continue
            rule = model.simple_types.get(attribute.type_name)
            item = {'type':attribute.type_name}
            if rule and rule.enums:
                item.pop('type', None)  # Enum values fully express this scalar contract.
                values = list(rule.enums)
                if tag == 'shape' and name == 'type':
                    values = [v for v in values if v in preferred_shapes]
                if tag == 'crop' and name == 'type':
                    values = [v for v in values if v in backend['image_crop_types']]
                item['allowed_generation_values'] = values
            elif rule:
                if rule.base:
                    item['base'] = rule.base
                if rule.patterns:
                    item['patterns'] = list(rule.patterns)
                if rule.union_members:
                    item['union_members'] = list(rule.union_members)
            if rule and rule.bounds:
                item['bounds'] = {k:str(v) for k,v in rule.bounds}
            row['values'][name] = item
        rows[tag] = row
    rows['local_backend'] = {k:backend[k] for k in ('chart_types','polyline_types')}
    rows['local_backend']['fills'] = 'solid/linear; radial approximates to first stop (warning)'
    from iconpark_tool import load_index
    from iconpark_render import packaged_icon_path
    rows['local_backend']['offline_icon_types'] = sorted(
        entry['iconType'] for entry in load_index()['icons']
        if packaged_icon_path(entry['iconType']) is not None)
    return ('Executable XSD excerpt; listed shape/chart/connector types preserve local PPTX semantics:\n'
            +json.dumps(rows,ensure_ascii=False,separators=(',',':')))


def allowed_operations(tag: str, parent_tag: str | None = None) -> dict:
    attrs = _schema_attributes().get(tag, set())
    result = {op: sorted(fields & attrs) for op, fields in PATCH_OPERATION_FIELDS.items()
              if op != 'set_z_order' and fields & attrs}
    if tag != 'crop':
        result.pop('set_crop', None)
    # An operation name is not a way around geometry move/resize limits.
    if tag != 'border' and 'set_style' in result:
        result['set_style'] = [f for f in result['set_style'] if f != 'width']
        if not result['set_style']:
            del result['set_style']
    # Only drawing objects can be reordered, never style/schema children.
    if parent_tag == 'data' and tag in {'shape', 'img', 'line', 'table', 'chart', 'icon'}:
        result['set_z_order'] = ['index']
    return result


def preserve_text_sha256(sml: str) -> str:
    root = ET.fromstring(sml)
    paragraphs = ["".join(node.itertext()) for node in root.iter() if _local_name(node.tag) == "p"]
    # Drawing order may change; paragraph contents and multiplicity may not.
    return hashlib.sha256(_canonical_json(sorted(paragraphs))).hexdigest()


def preserve_assets_sha256(sml: str) -> str:
    root = ET.fromstring(sml)
    sources = [node.attrib.get("src", "") for node in root.iter() if _local_name(node.tag) == "img"]
    return hashlib.sha256(_canonical_json(sorted(sources))).hexdigest()


def element_fingerprint(element: ET.Element, stable_path: str = "") -> str:
    payload = {
        "tag": _local_name(element.tag), "stable_path": stable_path,
        "attributes": dict(sorted(element.attrib.items())),
        "text": "".join(element.itertext()),
    }
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def _walk_paths(root: ET.Element) -> list[tuple[str, ET.Element, ET.Element | None]]:
    rows: list[tuple[str, ET.Element, ET.Element | None]] = []

    def visit(node: ET.Element, path: str, parent: ET.Element | None) -> None:
        rows.append((path, node, parent))
        counts: dict[str, int] = {}
        for child in list(node):
            name = _local_name(child.tag)
            counts[name] = counts.get(name, 0) + 1
            visit(child, f"{path}/{name}[{counts[name]}]", node)

    visit(root, f"{_local_name(root.tag)}[1]", None)
    return rows


def build_element_inventory(sml: str) -> list[dict]:
    root = ET.fromstring(sml)
    backend=str(Path(__file__).resolve().parents[1]/'lark/scripts')
    if backend not in sys.path: sys.path.insert(0,backend)
    from xml_lint import extract_elements
    bleed_ids={e.get('_source_id') for e in extract_elements(sml) if e.get('_background_bleed')}
    inventory = []
    for path, element, _parent in _walk_paths(root):
        object_id = "obj-" + hashlib.sha256(
            f"{path}\0{_local_name(element.tag)}".encode("utf-8")
        ).hexdigest()[:12]
        inventory.append({
            "object_id": object_id,
            "stable_path": path,
            "element_fingerprint": element_fingerprint(element, path),
            "tag": _local_name(element.tag),
            "attributes": dict(element.attrib),
            "allowed_operations": allowed_operations(_local_name(element.tag),
                _local_name(_parent.tag) if _parent is not None else None),
            "attribute_constraints": attribute_constraints(_local_name(element.tag)),
            "mutation_bounds": geometry_bounds(element.attrib,bleed=element.get('id') in bleed_ids) if _local_name(element.tag) != 'border' else {},
            "coupled_geometry_constraints": ["positive finite dimensions", "visible canvas intersection", "empty background decoration behind meaningful content"] if element.get('id') in bleed_ids else ["topLeftX >= 0", "topLeftY >= 0", "width > 0", "height > 0",
                "topLeftX + width <= 960", "topLeftY + height <= 540"] if 'set_geometry' in allowed_operations(_local_name(element.tag)) else [],
            "z_order": {'index':list(_parent).index(element), 'min':0, 'max':len(_parent)-1}
                if _parent is not None and 'set_z_order' in allowed_operations(_local_name(element.tag), _local_name(_parent.tag)) else None,
        })
    return inventory


def prompt_element_inventory(sml: str) -> dict:
    """Lossless model-facing projection; executor inventory remains authoritative.

    Profiles are keyed by their full values, not just tag: parent-dependent
    operations and decorative-bleed constraints must remain distinct.
    """
    profiles, identities, objects = {}, {}, []
    shared = {'allowed_operations', 'attribute_constraints', 'coupled_geometry_constraints'}
    for row in build_element_inventory(sml):
        if not row['allowed_operations']:
            continue
        rules = {key: row[key] for key in sorted(shared)}
        identity = json.dumps(rules, sort_keys=True, ensure_ascii=False)
        if identity not in identities:
            ref = f'r{len(profiles) + 1}'
            identities[identity] = ref
            profiles[ref] = rules
        objects.append(dict({k: v for k, v in row.items()
                             if k not in shared | {'stable_path', 'element_fingerprint'}},
                            rules=identities[identity]))
    return {'rule_profiles': profiles, 'objects': objects}


def geometry_bounds(attributes: dict, *, bleed=False) -> dict:
    result = {}
    for key in ('topLeftX','topLeftY','width','height'):
        if key not in attributes:
            continue
        try:
            value = float(attributes[key])
        except (TypeError,ValueError):
            continue
        extent = 960 if key in {'topLeftX','width'} else 540
        result[key] = {'min':0 if key.startswith('topLeft') else 0.001,'max':extent}
    if bleed:
        for key in ('topLeftX','topLeftY'):
            if key in result: result[key]['min']=-result[key]['max']
        return result
    # Project the original +/- limits onto the canvas-feasible intervals. These
    # ranges are not independent: the coupled sums in the inventory also apply.
    for position, size, extent in (('topLeftX','width',960), ('topLeftY','height',540)):
        if position in result:
            result[position]['min'] = max(0, result[position]['min'])
            result[position]['max'] = min(result[position]['max'], extent-result.get(size, {}).get('min',0))
        if size in result:
            result[size]['max'] = min(result[size]['max'], extent-result.get(position, {}).get('min',0))
    return result


def _validated_operations(patch: dict, *, allow_empty: bool = False) -> list[dict]:
    """Reject malformed nested model output before traversing its fields."""
    if not isinstance(patch, dict):
        raise PatchRejected("patch must be an object")
    operations = patch.get("operations")
    if not isinstance(operations, list) or (not operations and not allow_empty):
        raise PatchRejected("patch operations must be a non-empty array")
    for operation in operations:
        if not isinstance(operation, dict):
            raise PatchRejected("each patch operation must be an object")
        if not isinstance(operation.get("target"), dict):
            raise PatchRejected("patch target must be an object")
    return operations


def validate_patch_envelope(
    patch: dict, sml: str, page: dict, *, expected_run_id: str | None = None,
    expected_defect_ids: list[str] | None = None,
) -> None:
    operations = _validated_operations(patch)
    if patch.get("patch_schema_version") != "1":
        raise PatchRejected("unsupported patch schema version")
    if not str(patch.get("run_id") or "").strip():
        raise PatchRejected("patch run_id is required")
    if expected_run_id is not None and patch.get("run_id") != expected_run_id:
        raise PatchRejected("patch run_id does not match the active render run")
    if expected_defect_ids is not None and sorted(patch.get("defect_ids") or []) != sorted(expected_defect_ids):
        raise PatchRejected("patch defect_ids do not match the requested defect set")
    if int(patch.get("page_no") or 0) != int(page.get("no") or 0):
        raise PatchRejected("patch page_no does not match blueprint page")
    if patch.get("base_sml_hash") != sml_sha256(sml):
        raise PatchRejected("patch base SML hash is stale")
    if patch.get("blueprint_hash") != blueprint_sha256(page):
        raise PatchRejected("patch blueprint hash does not match")
    if patch.get("preserve_text_hash") != preserve_text_sha256(sml):
        raise PatchRejected("patch text preservation hash does not match")
    if patch.get("preserve_assets_hash") != preserve_assets_sha256(sml):
        raise PatchRejected("patch asset preservation hash does not match")
    round_number = int(patch.get("round") or 0)
    if round_number < 1 or round_number > int(PATCH_LIMITS["max_rounds"]):
        raise PatchRejected("patch round exceeds the allowed limit")
    from ppt_contract import PATCH_PROTOCOL_MAX_OPERATIONS
    if len(operations) > PATCH_PROTOCOL_MAX_OPERATIONS:
        raise PatchRejected("patch operation count exceeds the allowed limit")
    targets = {
        str((operation.get("target") or {}).get("object_id") or "") for operation in operations
    }
    if "" in targets:
        raise PatchRejected("patch target count exceeds the allowed limit")
    operation_ids: set[str] = set()
    for operation in operations:
        operation_id = str(operation.get("op_id") or "").strip()
        if not operation_id or operation_id in operation_ids:
            raise PatchRejected("patch operation IDs must be non-empty and unique")
        operation_ids.add(operation_id)
        op_type = str(operation.get("op_type") or "")
        allowed = PATCH_OPERATION_FIELDS.get(op_type)
        if allowed is None:
            raise PatchRejected(f"unsupported patch operation {op_type!r}")
        before = operation.get("before")
        after = operation.get("after")
        if not isinstance(before, dict) or not isinstance(after, dict) or set(before) != set(after):
            raise PatchRejected("patch before/after fields must be matching objects")
        if not before or not set(before).issubset(allowed):
            raise PatchRejected(f"patch contains fields outside {op_type}")


def bind_patch_response(response: dict, sml: str, page: dict, *, run_id: str,
                        round_number: int, defect_ids: list[str]) -> dict:
    """Bind only mechanical request identity; exact SOL mutation values stay untouched.

    Explicit legacy echoes remain assertions, never silently corrected. Capture sml
    BEFORE the model call; apply_patch_transaction rechecks against the on-disk base.
    """
    import copy
    _validated_operations(response, allow_empty=True)
    expected = {'patch_schema_version': '1', 'run_id': run_id, 'page_no': int(page['no']),
                'base_sml_hash': sml_sha256(sml), 'blueprint_hash': blueprint_sha256(page),
                'preserve_text_hash': preserve_text_sha256(sml),
                'preserve_assets_hash': preserve_assets_sha256(sml),
                'round': round_number, 'defect_ids': defect_ids}
    result = copy.deepcopy(response)
    for key, value in expected.items():
        if key in result and result[key] != value:
            raise PatchRejected(f'patch {key} does not match the bound request')
        result[key] = value
    inventory = {r['object_id']: r for r in build_element_inventory(sml)}
    for operation in result.get('operations', []):
        target = operation.get('target') or {}
        row = inventory.get(target.get('object_id'))
        if row:
            for key in ('stable_path', 'element_fingerprint'):
                if key in target and target[key] != row[key]:
                    raise PatchRejected('patch target identity does not match the bound request')
                target[key] = row[key]
    return result


def _as_float(value: object, label: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise PatchRejected(f"{label} must be numeric") from exc


def _same_attribute_value(element, field, current, expected):
    """Compare numeric preconditions by XSD value, never rewrite either input."""
    if current == (None if expected is None else str(expected)):
        return True
    if current is None or expected is None or isinstance(expected, bool):
        return False
    from decimal import Decimal, InvalidOperation
    from sxsd_validator import scalar_value_for_type
    rule = _attribute_rules(_local_name(element.tag)).get(field)
    if rule is None:
        return False
    try:
        value = scalar_value_for_type(rule.type_name, current, _schema_model())
        proposed = Decimal(str(expected))
        return isinstance(value, Decimal) and proposed.is_finite() and value == proposed
    except (ValueError, TypeError, InvalidOperation):
        return False


def _enforce_geometry_limits(before: dict, after: dict) -> None:
    import math
    for field, value in after.items():
        number = _as_float(value, field)
        if not math.isfinite(number) or (field in {'width','height'} and number <= 0):
            raise PatchRejected(f'{field} must be finite with valid sign')


def apply_patch_transaction(
    source: Path, patch: dict, page: dict,
    *, validate_fn: Callable[[str], list[dict]], expected_run_id: str | None = None,
    expected_defect_ids: list[str] | None = None,
) -> PatchResult:
    """Apply all operations in memory and atomically replace only a valid result."""
    original = source.read_text(encoding="utf-8")
    validate_patch_envelope(
        patch, original, page, expected_run_id=expected_run_id,
        expected_defect_ids=expected_defect_ids,
    )
    root = ET.fromstring(original)
    rows = _walk_paths(root)
    original_attributes = {element: dict(element.attrib) for _, element, _ in rows}
    geometry_targets = set()
    targets: dict[tuple[str, str, str], tuple[ET.Element, ET.Element | None]] = {}
    for path, element, parent in rows:
        object_id = "obj-" + hashlib.sha256(
            f"{path}\0{_local_name(element.tag)}".encode("utf-8")
        ).hexdigest()[:12]
        targets[(object_id, path, element_fingerprint(element, path))] = (element, parent)

    for operation in patch["operations"]:
        target = operation["target"]
        key = (
            str(target.get("object_id") or ""), str(target.get("stable_path") or ""),
            str(target.get("element_fingerprint") or ""),
        )
        match = targets.get(key)
        if match is None:
            raise PatchRejected("patch target identity is stale or ambiguous")
        element, parent = match
        before = operation["before"]
        after = operation["after"]
        op_type = operation["op_type"]
        legal = allowed_operations(_local_name(element.tag),
                                  _local_name(parent.tag) if parent is not None else None)
        if not set(after).issubset(legal.get(op_type, [])):
            raise PatchRejected(f'patch fields are illegal on target <{_local_name(element.tag)}> for {op_type}')
        if op_type == "set_z_order":
            if parent is None:
                raise PatchRejected("root element cannot be reordered")
            siblings = list(parent)
            current_index = siblings.index(element)
            old_index, new_index = before['index'], after['index']
            if type(old_index) is not int or type(new_index) is not int:
                raise PatchRejected('z-order index must be a JSON integer')
            if old_index != current_index:
                raise PatchRejected("z-order precondition does not match")
            if new_index < 0 or new_index >= len(siblings):
                raise PatchRejected("z-order index is outside sibling bounds")
            parent.remove(element)
            parent.insert(new_index, element)
            continue
        for field, expected in before.items():
            current = element.attrib.get(field)
            if not _same_attribute_value(element, field, current, expected):
                raise PatchRejected(f"patch precondition for {field} does not match")
        if op_type == "set_geometry":
            geometry_targets.add(element)
            _enforce_geometry_limits(before, after)
            # Repeated operations must remain inside the request's original
            # envelope; individually legal deltas must not ratchet beyond it.
            baseline = {field: original_attributes[element].get(field) for field in before}
            _enforce_geometry_limits(baseline, after)
        for field, value in after.items():
            from sxsd_validator import value_error_for_type
            rule = _attribute_rules(_local_name(element.tag)).get(field)
            if rule and ((value is None and rule.required) or (value is not None and
                    value_error_for_type(rule.type_name, str(value), _schema_model()))):
                raise PatchRejected(f'patch value for {field} violates target schema type {rule.type_name}')
            if value is None:
                element.attrib.pop(field, None)
            else:
                element.set(field, str(value))

    # Validate the final transaction, not transient intermediate positions. A
    # model may pair a move with a resize, but independent valid deltas cannot
    # combine into a canvas-invalid final state (rotation is checked by lint).
    for element in geometry_targets:
        fields = ('topLeftX','topLeftY','width','height')
        if all(field in element.attrib for field in fields):
            x,y,w,h = (_as_float(element.get(field),field) for field in fields)
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > 960 or y+h > 540:
                # The shared linter owns the explicit background-bleed exception.
                # Full-page validation still rejects semantic/foreground overflow.
                backend = str(Path(__file__).resolve().parents[1]/'lark/scripts')
                if backend not in sys.path: sys.path.insert(0,backend)
                from xml_lint import extract_elements
                parsed=extract_elements(ET.tostring(root,encoding='unicode'))
                matching=[e for e in parsed if e.get('_source_id') == element.get('id')]
                allowed=bool(element.get('id') and len(matching)==1 and matching[0].get('_background_bleed')
                             and w>0 and h>0 and x<960 and y<540 and x+w>0 and y+h>0)
                if not allowed:
                    raise PatchRejected('final geometry violates coupled canvas bounds')
    candidate = ET.tostring(root, encoding="unicode") + "\n"
    if preserve_text_sha256(candidate) != patch["preserve_text_hash"]:
        raise PatchRejected("patch attempted to change preserved text")
    if preserve_assets_sha256(candidate) != patch["preserve_assets_hash"]:
        raise PatchRejected("patch attempted to change preserved assets")
    errors, warnings = partition(validate_fn(candidate) or [])
    if errors:
        return PatchResult(
            committed=False, operation_count=len(patch["operations"]), errors=errors,
            reason="post_patch_validation_failed", warnings=warnings, candidate_xml=candidate,
        )
    atomic_write_text(source, candidate)
    return PatchResult(committed=True, operation_count=len(patch["operations"]), warnings=warnings)
