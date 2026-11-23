"""Identificadores de negocio: prefijo + 8 caracteres hexadecimales aleatorios seguros."""

from __future__ import annotations

import re
import secrets

TRIP_ID_RE = re.compile(r"^TRP-[0-9a-f]{8}$")
RES_ID_RE = re.compile(r"^RES-[0-9a-f]{8}$")


def new_trip_id() -> str:
    return "TRP-" + secrets.token_hex(4)


def new_reservation_id() -> str:
    return "RES-" + secrets.token_hex(4)


def is_trip_id(value) -> bool:
    return isinstance(value, str) and TRIP_ID_RE.fullmatch(value) is not None


def is_reservation_id(value) -> bool:
    return isinstance(value, str) and RES_ID_RE.fullmatch(value) is not None
