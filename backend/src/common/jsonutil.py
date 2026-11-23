"""JSON con Decimal: los importes nunca pasan por float al leer el cuerpo."""

from __future__ import annotations

import json
from decimal import Decimal


def _reject_constant(name: str):
    raise ValueError("constante no permitida: " + name)


def loads(text: str):
    return json.loads(text, parse_float=Decimal, parse_constant=_reject_constant)


def _default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    raise TypeError("no serializable: " + type(value).__name__)


def dumps(value) -> str:
    return json.dumps(value, default=_default, ensure_ascii=False, separators=(",", ":"))


def to_plain(value):
    """Convierte Decimal y otros tipos a tipos JSON simples (para la respuesta al agente)."""
    return json.loads(dumps(value))
