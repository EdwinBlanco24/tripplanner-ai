"""Normaliza los dos tipos de evento que reciben las Lambdas (ADR-02).

* Evento de API Gateway HTTP API (payload 2.0): el userId SOLO sale de
  requestContext.authorizer.jwt.claims.sub (ya validado por el autorizador JWT).
* Evento directo de la tool del agente: {"source":"agent","action":...,"userId":...,"payload":{...}}.
  Solo el rol del OrchestratorAgent tiene lambda:InvokeFunction sobre las funciones.

El userId nunca se lee del cuerpo ni de la ruta.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field
from typing import Any

from . import jsonutil
from .errors import Unauthorized, ValidationError

MAX_BODY_BYTES = 256 * 1024
_USER_ID_RE = re.compile(r"^[A-Za-z0-9_.:@-]{1,128}$")

# Nombres de acción del diseño original (docs/04-tools-agentes.md) -> nombres canónicos.
ACTION_ALIASES = {
    "createTrip": "create_trip", "listTrips": "get_trips", "getTrip": "get_trip",
    "updateTrip": "update_trip", "deleteTrip": "delete_trip",
    "createItinerary": "create_itinerary", "getItinerary": "get_itinerary", "updateItinerary": "update_itinerary",
    "createReservation": "create_reservation", "listReservations": "get_reservations",
    "getReservation": "get_reservation", "updateReservation": "update_reservation",
    "deleteReservation": "delete_reservation",
    "getPreferences": "get_preferences", "updatePreferences": "update_preferences",
}


@dataclass
class Request:
    source: str                      # "api" | "agent"
    user_id: str
    action: str                      # routeKey (api) o nombre de acción (agent)
    path: dict = field(default_factory=dict)
    query: dict = field(default_factory=dict)
    body: Any = None                 # JSON del cuerpo (api) o payload (agent)
    claims: dict = field(default_factory=dict)

    def fields(self) -> Any:
        """Campos de negocio del cuerpo. En eventos de agente se excluyen los identificadores de destino."""
        if self.source == "agent" and isinstance(self.body, dict):
            return {k: v for k, v in self.body.items() if k not in ("tripId", "resId")}
        return self.body

    def param(self, name: str):
        """Parámetro de consulta (api) o campo del payload (agent)."""
        if self.source == "agent":
            return (self.body or {}).get(name) if isinstance(self.body, dict) else None
        return self.query.get(name)


def is_agent_event(event) -> bool:
    return isinstance(event, dict) and event.get("source") == "agent" and "routeKey" not in event


def _valid_user_id(value) -> bool:
    return isinstance(value, str) and _USER_ID_RE.fullmatch(value) is not None


def _parse_body(event: dict, method: str):
    if method not in ("POST", "PUT"):
        return None
    raw = event.get("body")
    if raw is None or raw == "":
        return None
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            raise ValidationError("El cuerpo no es válido.") from None
    if not isinstance(raw, str):
        raise ValidationError("El cuerpo no es un JSON válido.")
    if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
        raise ValidationError("El cuerpo supera el máximo de 256 KB.")
    try:
        return jsonutil.loads(raw)
    except (ValueError, RecursionError):
        raise ValidationError("El cuerpo no es un JSON válido.") from None


def _parse_api(event: dict) -> Request:
    route_key = event.get("routeKey")
    if not isinstance(route_key, str) or " " not in route_key:
        raise ValidationError("Evento de API inválido.")
    claims = (((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    sub = claims.get("sub") if isinstance(claims, dict) else None
    if not _valid_user_id(sub):
        raise Unauthorized("Se requiere autenticación.")
    method = route_key.split(" ", 1)[0]
    return Request(
        source="api",
        user_id=sub,
        action=route_key,
        path=event.get("pathParameters") or {},
        query=event.get("queryStringParameters") or {},
        body=_parse_body(event, method),
        claims=claims,
    )


def _parse_agent(event: dict) -> Request:
    user_id = event.get("userId")
    if not _valid_user_id(user_id):
        raise Unauthorized("Se requiere el usuario autenticado.")
    action = event.get("action")
    if not isinstance(action, str) or not action:
        raise ValidationError("Falta la acción solicitada.")
    payload = event.get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ValidationError("payload debe ser un objeto.")
    return Request(source="agent", user_id=user_id, action=action, body=payload)


def parse_event(event) -> Request:
    if not isinstance(event, dict):
        raise ValidationError("Evento no soportado.")
    if "routeKey" in event and "requestContext" in event:
        return _parse_api(event)
    if is_agent_event(event):
        return _parse_agent(event)
    raise ValidationError("Evento no soportado.")
