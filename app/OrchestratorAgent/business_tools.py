"""Tools de negocio del OrchestratorAgent (canal 2) y ayudantes del stream tipado.

Las tools invocan las Lambdas de negocio (docs/04-tools-agentes.md, ADR-03) con lambda:InvokeFunction.
El usuario NO es parámetro de ninguna tool: `build_business_tools` crea las tools como closures que
capturan el `user_id` ya extraído del JWT, así el modelo no puede elegir otro usuario.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Callable

from strands import tool

logger = logging.getLogger("orchestrator_agent.business")

REGION = os.environ.get("AWS_REGION") or "us-east-2"
_USER_ID_RE = re.compile(r"^[A-Za-z0-9_.:@-]{1,128}$")

# Variable de entorno con el ARN de cada Lambda.
FUNCTION_ENV = {
    "trips": "TRIPS_FUNCTION_ARN",
    "itineraries": "ITINERARIES_FUNCTION_ARN",
    "reservations": "RESERVATIONS_FUNCTION_ARN",
    "preferences": "PREFERENCES_FUNCTION_ARN",
}

# Mensaje de estado (en español) al empezar a usar cada tool: (agent, message).
TOOL_STATUS = {
    "ask_flights": ("flights", "Consultando el agente de vuelos…"),
    "ask_weather": ("weather", "Consultando el agente de clima…"),
    "create_trip": ("business", "Guardando tu viaje…"),
    "get_trips": ("business", "Consultando tus viajes…"),
    "get_trip": ("business", "Consultando el viaje…"),
    "update_trip": ("business", "Actualizando tu viaje…"),
    "delete_trip": ("business", "Eliminando el viaje…"),
    "create_itinerary": ("business", "Guardando el itinerario…"),
    "get_itinerary": ("business", "Consultando el itinerario…"),
    "update_itinerary": ("business", "Actualizando el itinerario…"),
    "create_reservation": ("business", "Registrando la reserva…"),
    "get_reservations": ("business", "Consultando tus reservas…"),
    "get_reservation": ("business", "Consultando la reserva…"),
    "update_reservation": ("business", "Actualizando la reserva…"),
    "delete_reservation": ("business", "Eliminando la reserva…"),
    "get_preferences": ("business", "Consultando tus preferencias…"),
    "update_preferences": ("business", "Guardando tus preferencias…"),
}
DEFAULT_STATUS = ("orchestrator", "Procesando tu solicitud…")


def status_for(tool_name: str) -> tuple[str, str]:
    return TOOL_STATUS.get(tool_name, DEFAULT_STATUS)


# --------------------------------------------------------------------------- ayudantes del stream
def tool_use_started(event) -> tuple[str, str] | None:
    """(toolUseId, name) si el evento de stream_async marca el inicio de un toolUse."""
    if not isinstance(event, dict):
        return None
    current = event.get("current_tool_use")
    if isinstance(current, dict) and current.get("toolUseId") and current.get("name"):
        return str(current["toolUseId"]), str(current["name"])
    raw = event.get("event")
    if isinstance(raw, dict):
        start = ((raw.get("contentBlockStart") or {}).get("start") or {}).get("toolUse")
        if isinstance(start, dict) and start.get("toolUseId") and start.get("name"):
            return str(start["toolUseId"]), str(start["name"])
    return None


_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)\s*```", re.DOTALL)


def extract_json_block(text: str, key: str, *, expect=list, max_items: int = 10):
    """Extrae los bloques ```json con la clave `key` (cuyo valor es del tipo `expect`).

    Devuelve (texto_sin_los_bloques, valor) o (texto_original, None) si no hay ningún bloque válido.
    Se quitan TODOS los bloques válidos y manda el ÚLTIMO (el que el especialista anexa en código va al final,
    así que prevalece sobre uno que el modelo hubiera escrito). Si el valor es una lista se descartan los
    elementos que no sean objetos y se limita a `max_items`.
    """
    if not isinstance(text, str):
        return text, None
    valid = []
    for match in _FENCE_RE.finditer(text):
        try:
            obj = json.loads(match.group(1))
        except ValueError:
            continue
        if isinstance(obj, dict) and key in obj and isinstance(obj[key], expect):
            valid.append((match, obj[key]))
    if not valid:
        return text, None
    value = valid[-1][1]
    if isinstance(value, list):
        value = [item for item in value if isinstance(item, dict)][:max_items]
    cleaned = text
    for match, _ in reversed(valid):
        cleaned = cleaned[: match.start()] + cleaned[match.end():]
    return re.sub(r"\n{3,}", "\n\n", cleaned.strip()), value


def specialist_text(result) -> str:
    """Texto completo de la respuesta de un especialista A2A (AgentResult).

    El especialista transmite su respuesta en cientos de fragmentos (una part por fragmento): hay que unir el texto
    de TODOS los bloques de contenido. `str(result.message)` devolvía la repr de un dict (con \\n escapados y la
    respuesta partida en bloques), y por eso el bloque ```json de vuelos nunca se detectaba.
    """
    message = getattr(result, "message", None)
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        return "".join(block["text"] for block in content if isinstance(block, dict) and isinstance(block.get("text"), str))
    return str(result)


def mask_user(user_id: str | None) -> str:
    return (user_id[:8] + "…") if isinstance(user_id, str) and user_id else "—"


# --------------------------------------------------------------------------- invocación de Lambdas
def _error(code: str, message: str, details: list | None = None) -> dict:
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return {"ok": False, "error": error}


def _compact(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


# Timeout de las Lambdas de negocio (backend/template.yaml, Globals.Function.Timeout = 10 s).
# La lectura espera ese tiempo + 5 s de margen. SIN reintentos: un create_* repetido tras un
# timeout de lectura podría duplicar el recurso (las Lambdas no son idempotentes).
LAMBDA_TIMEOUT_SECONDS = 10
CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = LAMBDA_TIMEOUT_SECONDS + 5

try:  # errores tras los cuales la escritura pudo haberse completado
    from botocore.exceptions import ConnectionClosedError, ReadTimeoutError

    _UNCERTAIN_ERRORS: tuple = (ReadTimeoutError, ConnectionClosedError)
except ImportError:  # pragma: no cover - botocore siempre viene con boto3
    _UNCERTAIN_ERRORS = ()

UNCERTAIN_MESSAGE = "La operación pudo haberse completado; consulta antes de reintentar"


def _is_write(action: str) -> bool:
    return action.startswith(("create_", "update_"))


def _default_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "lambda",
        region_name=REGION,
        config=Config(
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            read_timeout=READ_TIMEOUT_SECONDS,
            retries={"total_max_attempts": 1, "mode": "standard"},
        ),
    )


def _lambda_ui(action: str, payload: dict, data: dict) -> tuple[str, Any] | None:
    """Componente de UI y datos para un resultado ok, o None si la acción no genera UI."""
    if action in ("create_trip", "update_trip"):
        return "trip", {"trip": data["trip"]}
    if action == "get_trip":
        return "trip", data  # trip + itinerary + reservations
    if action == "get_trips":
        return "trips", {"trips": data["trips"]}
    if action in ("create_itinerary", "update_itinerary", "get_itinerary"):
        return "itinerary", data["itinerary"]
    if action == "get_reservations":
        ui = {"change": "listed", "reservations": data["reservations"]}
        if payload.get("tripId"):
            ui["tripId"] = payload["tripId"]
        return "reservations", ui
    if action in ("create_reservation", "update_reservation", "get_reservation"):
        item = data["reservation"]
        change = {"create_reservation": "created", "update_reservation": "updated"}.get(action, "listed")
        return "reservations", {"tripId": item.get("tripId"), "change": change, "reservations": [item]}
    if action == "delete_reservation":
        return "reservations", {"tripId": data.get("tripId"), "change": "deleted", "resId": data.get("resId"), "reservations": []}
    if action in ("get_preferences", "update_preferences"):
        return "preferences", {"preferences": data["preferences"]}
    return None  # delete_trip: sin UI


def build_business_tools(user_id: str | None, emit_ui: Callable[[str, Any], None], *, client=None) -> list:
    """Crea las 15 tools de negocio ligadas a `user_id` (closure; el modelo no lo ve ni lo elige)."""
    authenticated = isinstance(user_id, str) and _USER_ID_RE.fullmatch(user_id) is not None
    holder = {"client": client}

    def get_client():
        if holder["client"] is None:
            holder["client"] = _default_client()
        return holder["client"]

    def run(function: str, action: str, payload: dict | None = None) -> str:
        started = time.perf_counter()
        payload = {k: v for k, v in (payload or {}).items() if v is not None}
        result: dict
        if not authenticated:
            result = _error("UNAUTHENTICATED", "Requiere usuario autenticado.")
        else:
            arn = os.environ.get(FUNCTION_ENV[function], "").strip()
            if not arn:
                result = _error("NOT_CONFIGURED", "El servicio de datos no está configurado.")
            else:
                result = _call(get_client(), arn, action, payload)
        if result["ok"]:
            try:
                ui = _lambda_ui(action, payload, result["data"])
                if ui is not None:
                    emit_ui(ui[0], ui[1])
            except Exception:  # noqa: BLE001 - la UI nunca debe romper la tool
                logger.warning("business_tool_ui_failed action=%s", action)
        logger.info(
            "business_tool action=%s ms=%d ok=%s code=%s user=%s",
            action, int((time.perf_counter() - started) * 1000), result["ok"],
            None if result["ok"] else result["error"]["code"], mask_user(user_id),
        )
        return _compact(result)

    def _call(lambda_client, arn: str, action: str, payload: dict) -> dict:
        event = {"source": "agent", "action": action, "userId": user_id, "payload": payload}
        try:
            response = lambda_client.invoke(
                FunctionName=arn, InvocationType="RequestResponse", Payload=json.dumps(event).encode("utf-8")
            )
            if response.get("FunctionError"):
                logger.warning("business_lambda_function_error action=%s", action)
                if _is_write(action):  # p. ej. timeout de la Lambda a mitad de la escritura
                    return _error("UNCERTAIN", UNCERTAIN_MESSAGE)
                return _error("SERVICE_ERROR", "El servicio de datos falló. Inténtalo de nuevo.")
            body = json.loads(response["Payload"].read())
        except Exception as exc:  # noqa: BLE001 - red, permisos, timeouts: nunca se exponen al modelo
            logger.warning("business_lambda_unavailable action=%s error=%s", action, type(exc).__name__)
            if _is_write(action) and isinstance(exc, _UNCERTAIN_ERRORS):
                return _error("UNCERTAIN", UNCERTAIN_MESSAGE)
            return _error("SERVICE_UNAVAILABLE", "No se pudo contactar el servicio de datos. Inténtalo de nuevo.")
        if not isinstance(body, dict) or "ok" not in body:
            return _error("SERVICE_ERROR", "El servicio de datos respondió algo inesperado.")
        if body["ok"]:
            return {"ok": True, "data": body.get("data")}
        err = body.get("error") if isinstance(body.get("error"), dict) else {}
        details = [d for d in (err.get("details") or []) if isinstance(d, dict)][:5]
        return _error(str(err.get("code") or "ERROR"), str(err.get("message") or "La operación no se pudo completar."), details)

    def require_confirmation(confirmed: bool) -> str | None:
        if confirmed is not True:
            return _compact(_error(
                "CONFIRMATION_REQUIRED",
                "Pide confirmación explícita al usuario antes de borrar y repite la llamada con confirmed=true.",
            ))
        return None

    # ------------------------------------------------------------------ viajes
    @tool
    def create_trip(
        title: str, origin: str, destination: str, start_date: str, end_date: str,
        travelers: int, budget: float, currency: str = "COP", notes: str | None = None,
    ) -> str:
        """Crea y guarda un viaje del usuario. Devuelve el viaje con su tripId (TRP-xxxxxxxx).

        Args:
            title: Título corto del viaje (1 a 120 caracteres).
            origin: Ciudad o código IATA de origen (2 a 80 caracteres).
            destination: Ciudad o código IATA de destino (2 a 80 caracteres).
            start_date: Fecha de inicio YYYY-MM-DD; debe ser hoy o futura.
            end_date: Fecha de fin YYYY-MM-DD; igual o posterior al inicio (máximo 90 días de viaje).
            travelers: Número de viajeros, de 1 a 20.
            budget: Presupuesto total, mayor que 0 (máximo 2 decimales).
            currency: Moneda del presupuesto, COP (por defecto) o USD.
            notes: Notas opcionales (hasta 1000 caracteres).
        """
        return run("trips", "create_trip", {
            "title": title, "origin": origin, "destination": destination, "startDate": start_date,
            "endDate": end_date, "travelers": travelers, "budget": budget, "currency": currency, "notes": notes,
        })

    @tool
    def get_trips(status: str | None = None) -> str:
        """Lista los viajes guardados del usuario, ordenados por fecha de inicio.

        Args:
            status: Filtro opcional: PLANNED (planeados) o CANCELLED (cancelados).
        """
        return run("trips", "get_trips", {"status": status})

    @tool
    def get_trip(trip_id: str) -> str:
        """Obtiene un viaje con su itinerario y sus reservas.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx), obtenido de get_trips o create_trip.
        """
        return run("trips", "get_trip", {"tripId": trip_id})

    @tool
    def update_trip(
        trip_id: str, title: str | None = None, origin: str | None = None, destination: str | None = None,
        start_date: str | None = None, end_date: str | None = None, travelers: int | None = None,
        budget: float | None = None, currency: str | None = None, notes: str | None = None,
        status: str | None = None,
    ) -> str:
        """Cambia solo los campos indicados de un viaje. Para cancelarlo usa status=CANCELLED.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            title: Nuevo título (opcional).
            origin: Nuevo origen (opcional).
            destination: Nuevo destino (opcional).
            start_date: Nueva fecha de inicio YYYY-MM-DD (opcional).
            end_date: Nueva fecha de fin YYYY-MM-DD (opcional).
            travelers: Nuevo número de viajeros, 1 a 20 (opcional).
            budget: Nuevo presupuesto mayor que 0 (opcional).
            currency: COP o USD (opcional).
            notes: Nuevas notas; una cadena vacía las borra (opcional).
            status: PLANNED o CANCELLED (opcional).
        """
        return run("trips", "update_trip", {
            "tripId": trip_id, "title": title, "origin": origin, "destination": destination,
            "startDate": start_date, "endDate": end_date, "travelers": travelers, "budget": budget,
            "currency": currency, "notes": notes, "status": status,
        })

    @tool
    def delete_trip(trip_id: str, confirmed: bool = False) -> str:
        """Borra un viaje con su itinerario y todas sus reservas. Acción irreversible.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            confirmed: Pasa true SOLO después de que el usuario haya confirmado de forma explícita el borrado.
        """
        return require_confirmation(confirmed) or run("trips", "delete_trip", {"tripId": trip_id, "confirmed": True})

    # ------------------------------------------------------------------ itinerario
    @tool
    def create_itinerary(trip_id: str, days: list[dict]) -> str:
        """Crea el itinerario día a día de un viaje (falla con CONFLICT si ya tiene uno: usa update_itinerary).

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            days: Lista de 1 a 30 días dentro de las fechas del viaje. Cada día es un objeto con:
                date (YYYY-MM-DD, única), weather (opcional: tempMax, tempMin en °C, condition, rainProbability 0-100)
                e items (lista de hasta 30 con time HH:MM, title, type entre flight|hotel|activity|meal|transfer|other,
                y opcionalmente location y notes).
        """
        return run("itineraries", "create_itinerary", {"tripId": trip_id, "days": days})

    @tool
    def get_itinerary(trip_id: str) -> str:
        """Obtiene el itinerario de un viaje.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
        """
        return run("itineraries", "get_itinerary", {"tripId": trip_id})

    @tool
    def update_itinerary(trip_id: str, days: list[dict]) -> str:
        """Reemplaza por completo el itinerario de un viaje que ya tiene uno.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            days: Lista completa de días con el mismo formato que create_itinerary.
        """
        return run("itineraries", "update_itinerary", {"tripId": trip_id, "days": days})

    # ------------------------------------------------------------------ reservas (simuladas)
    @tool
    def create_reservation(
        trip_id: str, type: str, provider: str, details: dict, price: float, currency: str = "COP",
        status: str = "SIMULADA",
    ) -> str:
        """Registra una reserva SIMULADA (no se cobra ni se contacta al proveedor). Nunca pidas datos de tarjeta.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            type: FLIGHT, HOTEL o ACTIVITY.
            provider: Aerolínea, hotel u operador (hasta 80 caracteres).
            details: Para FLIGHT: flightNumber, origin, destination y departureTime (obligatorios); opcionales
                airline, arrivalTime y bookingUrl (https). Para HOTEL: hotelName, checkIn y checkOut (YYYY-MM-DD).
                Para ACTIVITY: activityName y date (YYYY-MM-DD); opcional time (HH:MM). Todos los valores son texto de hasta 200 caracteres.
            price: Precio, 0 o mayor (máximo 2 decimales).
            currency: COP (por defecto) o USD.
            status: SIMULADA (por defecto), PENDIENTE o CONFIRMADA.
        """
        return run("reservations", "create_reservation", {
            "tripId": trip_id, "type": type, "provider": provider, "details": details,
            "price": price, "currency": currency, "status": status,
        })

    @tool
    def get_reservations(trip_id: str | None = None) -> str:
        """Lista las reservas del usuario, o solo las de un viaje.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx) para filtrar; omítelo para listar todas.
        """
        return run("reservations", "get_reservations", {"tripId": trip_id})

    @tool
    def get_reservation(trip_id: str, res_id: str) -> str:
        """Obtiene una reserva.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            res_id: Identificador de la reserva (RES-xxxxxxxx).
        """
        return run("reservations", "get_reservation", {"tripId": trip_id, "resId": res_id})

    @tool
    def update_reservation(
        trip_id: str, res_id: str, status: str | None = None, provider: str | None = None,
        details: dict | None = None, price: float | None = None, currency: str | None = None,
    ) -> str:
        """Cambia solo los campos indicados de una reserva (el tipo no se puede cambiar).

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            res_id: Identificador de la reserva (RES-xxxxxxxx).
            status: SIMULADA, PENDIENTE o CONFIRMADA (opcional).
            provider: Nuevo proveedor (opcional).
            details: Detalles completos nuevos (reemplazan a los anteriores; mismo formato que create_reservation).
            price: Nuevo precio (opcional).
            currency: COP o USD (opcional).
        """
        return run("reservations", "update_reservation", {
            "tripId": trip_id, "resId": res_id, "status": status, "provider": provider,
            "details": details, "price": price, "currency": currency,
        })

    @tool
    def delete_reservation(trip_id: str, res_id: str, confirmed: bool = False) -> str:
        """Elimina una reserva. Acción irreversible.

        Args:
            trip_id: Identificador del viaje (TRP-xxxxxxxx).
            res_id: Identificador de la reserva (RES-xxxxxxxx).
            confirmed: Pasa true SOLO después de que el usuario haya confirmado de forma explícita el borrado.
        """
        return require_confirmation(confirmed) or run(
            "reservations", "delete_reservation", {"tripId": trip_id, "resId": res_id, "confirmed": True}
        )

    # ------------------------------------------------------------------ preferencias
    @tool
    def get_preferences() -> str:
        """Obtiene las preferencias guardadas del usuario: estilos de viaje, ritmo, horario de vuelo, nivel de presupuesto y notas."""
        return run("preferences", "get_preferences", {})

    @tool
    def update_preferences(
        travel_styles: list[str] | None = None, pace: str | None = None, flight_time: str | None = None,
        budget_level: str | None = None, notes: str | None = None,
    ) -> str:
        """Guarda las preferencias del usuario. REEMPLAZA todas: incluye también las que ya tenía y quiere conservar.

        Args:
            travel_styles: Hasta 6 de BEACH, CULTURE, GASTRONOMY, ADVENTURE, NIGHTLIFE, NATURE.
            pace: RELAXED, BALANCED o INTENSE.
            flight_time: ANY, MORNING, AFTERNOON o EVENING.
            budget_level: ECONOMY, STANDARD o PREMIUM.
            notes: Texto libre de hasta 200 caracteres (nunca datos de tarjeta).
        """
        return run("preferences", "update_preferences", {
            "travelStyles": travel_styles, "pace": pace, "flightTime": flight_time,
            "budgetLevel": budget_level, "notes": notes,
        })

    return [
        create_trip, get_trips, get_trip, update_trip, delete_trip,
        create_itinerary, get_itinerary, update_itinerary,
        create_reservation, get_reservations, get_reservation, update_reservation, delete_reservation,
        get_preferences, update_preferences,
    ]
