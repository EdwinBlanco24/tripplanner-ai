"""Despacho común de las cuatro Lambdas: parseo, enrutado, respuesta y log.

Cada función declara sus tablas `routes` (routeKey de API Gateway) y `actions` (acciones del agente)
que apuntan a las MISMAS funciones de negocio (ADR-02).
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass
from typing import Any, Callable

from . import clock, jsonutil, logs
from .errors import ApiError, NotFound, ValidationError
from .request import ACTION_ALIASES, Request, is_agent_event, parse_event
from .store import ItemAlreadyExists, get_store


@dataclass
class Result:
    status: int
    data: Any = None
    headers: dict | None = None


Handler = Callable[[Request, Any], Result]

_HEADERS = {"Content-Type": "application/json", "Cache-Control": "no-store"}


def _api_response(status: int, body: Any, extra_headers: dict | None = None) -> dict:
    headers = dict(_HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status,
        "headers": headers,
        "isBase64Encoded": False,
        "body": "" if body is None or status == 204 else jsonutil.dumps(body),
    }


def _ok(source: str, result: Result) -> dict:
    if source == "agent":
        return {"ok": True, "statusCode": result.status, "data": jsonutil.to_plain(result.data)}
    return _api_response(result.status, result.data, result.headers)


def _fail(source: str, error: ApiError) -> dict:
    if source == "agent":
        return {"ok": False, "statusCode": error.status, **jsonutil.to_plain(error.to_body())}
    return _api_response(error.status, error.to_body())


def _ensure_profile(store, request: Request) -> None:
    """Primer acceso: crea PROFILE si no existe. Nunca hace fallar la petición."""
    try:
        pk = f"USER#{request.user_id}"
        if store.get_item(pk, "PROFILE") is not None:
            return
        item = {"PK": pk, "SK": "PROFILE", "entityType": "PROFILE", "createdAt": clock.now_iso()}
        email, name = request.claims.get("email"), request.claims.get("name")
        if isinstance(email, str) and email:
            item["email"] = email[:150]
        if isinstance(name, str) and name.strip():
            item["name"] = name.strip()[:80]
        try:
            store.put_item(item, must_not_exist=True)
        except ItemAlreadyExists:
            pass
    except Exception:  # noqa: BLE001 - el perfil es informativo
        logs.log("WARN", "profile_creation_failed")


def handle(event, context, *, routes: dict[str, Handler], actions: dict[str, Handler]) -> dict:
    started = time.perf_counter()
    source = "agent" if is_agent_event(event) else "api"
    action = None
    user_id = None
    status = 500
    error_type = None
    trace = None
    try:
        request = parse_event(event)
        source, action, user_id = request.source, request.action, request.user_id
        if source == "api":
            handler = routes.get(request.action)
            if handler is None:
                raise NotFound("Ruta no encontrada.")
        else:
            action = ACTION_ALIASES.get(request.action, request.action)
            handler = actions.get(action)
            if handler is None:
                raise ValidationError("Acción no soportada por esta función.")
        store = get_store()
        if source == "api":
            _ensure_profile(store, request)
        result = handler(request, store)
        status = result.status
        response = _ok(source, result)
    except ApiError as exc:
        status = exc.status
        response = _fail(source, exc)
    except Exception as exc:  # noqa: BLE001 - cualquier fallo no controlado es un 500 genérico
        error_type = type(exc).__name__
        trace = traceback.format_exc()[-1500:]
        status = 500
        response = _fail(source, ApiError("Error interno. Inténtalo de nuevo más tarde."))
    logs.log(
        "ERROR" if status >= 500 else "INFO",
        "request",
        requestId=getattr(context, "aws_request_id", None),
        source=source,
        action=action if isinstance(action, str) else None,
        status=status,
        latencyMs=int((time.perf_counter() - started) * 1000),
        user=logs.user_hash(user_id),
        errorType=error_type,
        trace=trace,
    )
    return response
