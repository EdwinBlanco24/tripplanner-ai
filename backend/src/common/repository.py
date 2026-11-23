"""Claves de la tabla única y ayudantes de lectura (docs/02-modelo-datos.md)."""

from __future__ import annotations

from . import ids
from .errors import NotFound, ValidationError

SK_PROFILE = "PROFILE"
SK_PREFS = "PREFS"
MAX_TRIPS_PER_USER = 100
MAX_RESERVATIONS_PER_TRIP = 50

_INTERNAL = ("PK", "SK", "entityType")


def user_pk(user_id: str) -> str:
    return f"USER#{user_id}"


def trip_sk(trip_id: str) -> str:
    return f"TRIP#{trip_id}"


def itinerary_sk(trip_id: str) -> str:
    return f"TRIP#{trip_id}#ITIN"


def reservation_prefix(trip_id: str) -> str:
    return f"TRIP#{trip_id}#RES#"


def reservation_sk(trip_id: str, res_id: str) -> str:
    return f"TRIP#{trip_id}#RES#{res_id}"


def public(item: dict | None) -> dict | None:
    """Quita los atributos internos de la tabla antes de responder."""
    if item is None:
        return None
    return {k: v for k, v in item.items() if k not in _INTERNAL}


def public_itinerary(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {"tripId": item.get("tripId"), "days": item.get("days", []), "updatedAt": item.get("updatedAt")}


def _required_id(req, name: str, label: str, checker) -> str:
    value = req.path.get(name) if req.source == "api" else (req.body or {}).get(name)
    if value is None or value == "":
        raise ValidationError(f"{name} es obligatorio.", details=[{"field": name, "issue": "required"}])
    if not checker(value):
        # Un identificador mal formado no puede existir: se trata como "no encontrado".
        raise NotFound(f"{label} no existe.")
    return value


def require_trip_id(req) -> str:
    return _required_id(req, "tripId", "El viaje", ids.is_trip_id)


def require_reservation_id(req) -> str:
    return _required_id(req, "resId", "La reserva", ids.is_reservation_id)


def require_confirmation(req) -> None:
    """Los borrados pedidos por el agente exigen payload.confirmed == true."""
    if req.source == "agent" and (req.body or {}).get("confirmed") is not True:
        raise ValidationError(
            "Para borrar se requiere confirmed=true (pide confirmación explícita al usuario).",
            details=[{"field": "confirmed", "issue": "required"}],
        )


def get_trip(store, user_id: str, trip_id: str) -> dict:
    item = store.get_item(user_pk(user_id), trip_sk(trip_id), consistent=True)
    if item is None or item.get("entityType") != "TRIP":
        raise NotFound("El viaje no existe.")
    return item
