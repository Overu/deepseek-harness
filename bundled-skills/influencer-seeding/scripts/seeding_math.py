#!/usr/bin/env python3
"""Explicit-denominator planning arithmetic. stdin/stdout only; no file writes."""
import json
import statistics
import sys
from decimal import Decimal, InvalidOperation


def number(value, name, positive=False):
    if value is None or isinstance(value, bool):
        raise ValueError(f"{name}: numeric value required")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{name}: invalid number") from None
    if not result.is_finite() or result < 0 or result > Decimal('1e18'):
        raise ValueError(f"{name}: finite nonnegative number <= 1e18 required")
    if positive and result == 0:
        raise ValueError(f"{name}: must be positive")
    return result


def label(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name}: nonempty label required")
    return value.strip()


def basis(data):
    if data.get('basis') not in {'observed', 'hypothesis'}:
        raise ValueError('basis: observed or hypothesis required')
    return {'basis': data['basis'], 'source_ref': label(data.get('source_ref'), 'source_ref')}


def calculate(data):
    if not isinstance(data, dict):
        raise ValueError('input must be an object')
    op = data.get('operation')
    if op == 'budget':
        total = number(data.get('total'), 'total')
        items = data.get('items')
        if not isinstance(items, list) or not items:
            raise ValueError('items: nonempty list required')
        rows, names = [], set()
        assigned = Decimal(0)
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('each item must be an object')
            name = label(item.get('name'), 'name')
            if name in names:
                raise ValueError('duplicate cost item name')
            names.add(name)
            qty = item.get('quantity')
            if type(qty) is not int or qty < 0 or qty > 1000000000:
                raise ValueError('quantity: nonnegative integer required')
            cost = number(item.get('unit_cost'), 'unit_cost')
            amount = cost * qty
            assigned += amount
            rows.append({'name': name, 'quantity': qty, 'unit_cost': cost,
                         'amount': amount, **basis(item)})
        if assigned > total:
            raise ValueError('budget exceeded')
        return {'total': total, 'assigned': assigned, 'remaining': total-assigned,
                'items': rows, 'limitation': 'Arithmetic only; fee overlap requires review.'}
    if op == 'paid_impressions':
        spend = number(data.get('spend'), 'spend')
        cpm = number(data.get('cpm'), 'cpm', positive=True)
        return {'metric': 'paid_impressions', 'value': spend/cpm*1000,
                'spend': spend, 'cpm': cpm, 'evidence_type': 'derived', **basis(data)}
    if op == 'rate':
        numerator = number(data.get('numerator'), 'numerator')
        denominator = number(data.get('denominator'), 'denominator', positive=True)
        return {'value': numerator/denominator, 'numerator': numerator,
                'denominator': denominator,
                'denominator_name': label(data.get('denominator_name'), 'denominator_name')}
    if op == 'gross_impressions':
        if data.get('same_definition') is not True or data.get('disjoint_components') is not True:
            raise ValueError('same definition and non-overlapping components must be established')
        organic = None if data.get('organic') is None else number(data['organic'], 'organic')
        paid = None if data.get('paid') is None else number(data['paid'], 'paid')
        value = None if organic is None or paid is None else organic+paid
        return {'metric': 'gross_impressions', 'value': value, 'reach': None,
                'limitation': 'Not deduplicated people; unknown components remain unknown.'}
    if op == 'cohort':
        values = data.get('values')
        if not isinstance(values, list):
            raise ValueError('values must be a list')
        clean = [number(v, 'value') for v in values if v is not None]
        return {'metric': label(data.get('metric'), 'metric'),
                'window': label(data.get('window'), 'window'), 'sample_size': len(clean),
                'missing_count': len(values)-len(clean),
                'median': statistics.median(clean) if clean else None,
                'min': min(clean) if clean else None, 'max': max(clean) if clean else None,
                'limitation': 'Sample description, not an industry benchmark.'}
    raise ValueError('unsupported operation')


def decimal_json(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('nonfinite result')
        return int(value) if value == value.to_integral() else float(value)
    raise TypeError('unsupported output type')


def main():
    try:
        output = calculate(json.load(sys.stdin))
        print(json.dumps(output, ensure_ascii=False, allow_nan=False, default=decimal_json))
        return 0
    except (ValueError, TypeError, KeyError, ArithmeticError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.exit(main())
