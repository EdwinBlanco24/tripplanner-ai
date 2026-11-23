"""Reloj. Las pruebas reemplazan `utcnow` para fijar la fecha."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

# Colombia no usa horario de verano: UTC-5 fijo (no depende de tzdata en la Lambda).
BOGOTA = timezone(timedelta(hours=-5))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def today_bogota() -> date:
    return utcnow().astimezone(BOGOTA).date()
