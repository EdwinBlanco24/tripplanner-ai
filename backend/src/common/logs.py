"""Log estructurado en JSON. Nunca recibe tokens, cuerpos ni datos personales."""

from __future__ import annotations

import hashlib
import json
import sys

_sink = None  # las pruebas lo reemplazan con set_sink()


def set_sink(sink) -> None:
    global _sink
    _sink = sink


def user_hash(user_id: str | None) -> str | None:
    if not user_id:
        return None
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:12]


def log(level: str, event: str, **fields) -> None:
    record = {"level": level, "event": event}
    record.update({k: v for k, v in fields.items() if v is not None})
    if _sink is not None:
        _sink(record)
        return
    sys.stdout.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
