"""Validaciones de negocio (docs/03-api.md sección 2). Funciones puras: no tocan la base ni el reloj.

Todas devuelven datos limpios (texto recortado, importes en Decimal) o lanzan ValidationError con
la lista de problemas en `details`.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from . import ids
from .errors import ValidationError
from .jsonutil import dumps

# --- Catálogos ----------------------------------------------------------------------------
TRIP_STATUSES = ("PLANNED", "CANCELLED")
CURRENCIES = ("COP", "USD")
RESERVATION_TYPES = ("FLIGHT", "HOTEL", "ACTIVITY")
RESERVATION_STATUSES = ("SIMULADA", "PENDIENTE", "CONFIRMADA")
ITEM_TYPES = ("flight", "hotel", "activity", "meal", "transfer", "other")
TRAVEL_STYLES = ("BEACH", "CULTURE", "GASTRONOMY", "ADVENTURE", "NIGHTLIFE", "NATURE")
PACES = ("RELAXED", "BALANCED", "INTENSE")
FLIGHT_TIMES = ("ANY", "MORNING", "AFTERNOON", "EVENING")
BUDGET_LEVELS = ("ECONOMY", "STANDARD", "PREMIUM")

# --- Límites --------------------------------------------------------------------------------
MAX_TRIP_DAYS = 90
MAX_ITINERARY_DAYS = 30
MAX_ITEMS_PER_DAY = 30
MAX_TRAVEL_STYLES = len(TRAVEL_STYLES)
MAX_PREFERENCE_NOTES = 200
MAX_DETAILS_BYTES = 4096
MAX_DETAIL_VALUE = 200  # docs/03-api.md: valores de details <= 200, salvo bookingUrl
MAX_BOOKING_URL = 2048  # los enlaces de reserva de proveedores como Kiwi superan los 200 caracteres
MAX_MONEY = Decimal("100000000")

# Campos que se ignoran si llegan (los fija el servidor).
READ_ONLY = frozenset({"tripId", "resId", "createdBy", "createdAt", "updatedAt"})

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_CTRL_MULTILINE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_BAD = object()  # marca de "valor inválido ya registrado en el Collector"

TRIP_CREATE_KEYS = ("title", "origin", "destination", "startDate", "endDate", "travelers", "budget", "currency", "notes")
TRIP_REQUIRED = ("title", "origin", "destination", "startDate", "endDate", "travelers", "budget", "currency")
TRIP_UPDATE_KEYS = TRIP_CREATE_KEYS + ("status",)

DETAILS_KEYS = {
    "FLIGHT": ("airline", "flightNumber", "departureTime", "arrivalTime", "origin", "destination", "bookingUrl"),
    "HOTEL": ("hotelName", "checkIn", "checkOut"),
    "ACTIVITY": ("activityName", "date", "time"),
}
DETAILS_REQUIRED = {
    "FLIGHT": ("flightNumber", "origin", "destination", "departureTime"),
    "HOTEL": ("hotelName", "checkIn", "checkOut"),
    "ACTIVITY": ("activityName", "date"),
}

# --- Datos de pago: prohibidos ---------------------------------------------------------------
_PAYMENT_EXACT = frozenset({
    "pan", "cc", "ccnumber", "cvv", "cvv2", "cvc", "cvc2", "cid", "securitycode", "expirydate",
    "expirationdate", "expmonth", "expyear", "creditcard", "debitcard", "cardholder", "cardnumber",
})


def reject_payment_fields(value, _depth: int = 0) -> None:
    """Rechaza (400) cualquier clave que parezca un dato de tarjeta, en cualquier nivel."""
    if _depth > 10:
        raise ValidationError("La estructura enviada es demasiado profunda.")
    if isinstance(value, dict):
        for key, inner in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if (normalized in _PAYMENT_EXACT or normalized.startswith("card") or "cvv" in normalized
                    or "cvc" in normalized or "creditcard" in normalized or "debitcard" in normalized):
                raise ValidationError(
                    "No se aceptan datos de tarjetas ni de pago.",
                    details=[{"field": str(key)[:40], "issue": "payment_data_not_allowed"}],
                )
            reject_payment_fields(inner, _depth + 1)
    elif isinstance(value, list):
        for inner in value:
            reject_payment_fields(inner, _depth + 1)


# --- Infraestructura de validación --------------------------------------------------------------
class Collector:
    def __init__(self) -> None:
        self.details: list[dict] = []
        self._first: str | None = None

    def add(self, field: str, issue: str, message: str) -> None:
        if len(self.details) < 20:
            self.details.append({"field": field, "issue": issue})
        if self._first is None:
            self._first = message

    def raise_if_any(self) -> None:
        if self.details:
            raise ValidationError(self._first or "Datos inválidos.", details=self.details)


def _object(body, what: str = "El cuerpo") -> dict:
    if not isinstance(body, dict):
        raise ValidationError(f"{what} debe ser un objeto JSON.")
    return body


def _check_keys(c: Collector, body: dict, allowed) -> None:
    for key in body:
        if key in READ_ONLY or key in allowed:
            continue
        c.add(str(key)[:40], "unknown_field", f"Campo no permitido: {str(key)[:40]}.")


def _text(c: Collector, field: str, value, *, max_len: int, min_len: int = 1, multiline: bool = False):
    if not isinstance(value, str):
        c.add(field, "not_a_string", f"{field} debe ser texto.")
        return _BAD
    text = value.strip()
    if (_CTRL_MULTILINE if multiline else _CTRL).search(text):
        c.add(field, "control_characters", f"{field} contiene caracteres no permitidos.")
        return _BAD
    if len(text) < min_len:
        c.add(field, "required" if min_len == 1 else "too_short",
              f"{field} es obligatorio." if min_len == 1 else f"{field} debe tener al menos {min_len} caracteres.")
        return _BAD
    if len(text) > max_len:
        c.add(field, "too_long", f"{field} no puede superar {max_len} caracteres.")
        return _BAD
    return text


def _decimal(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):  # los eventos de agente llegan ya parseados por Lambda
        return Decimal(repr(value)) if value == value and value not in (float("inf"), float("-inf")) else None
    return None


def _int(c: Collector, field: str, value, *, lo: int, hi: int):
    d = _decimal(value)
    if d is None or d != d.to_integral_value():
        c.add(field, "not_an_integer", f"{field} debe ser un número entero.")
        return _BAD
    n = int(d)
    if not lo <= n <= hi:
        c.add(field, "out_of_range", f"{field} debe estar entre {lo} y {hi}.")
        return _BAD
    return n


def _money(c: Collector, field: str, value, *, allow_zero: bool):
    d = _decimal(value)
    if d is None:
        c.add(field, "not_a_number", f"{field} debe ser un número.")
        return _BAD
    if d.as_tuple().exponent < -2:
        c.add(field, "too_many_decimals", f"{field} admite como máximo 2 decimales.")
        return _BAD
    if d < 0 or (d == 0 and not allow_zero):
        c.add(field, "not_positive", f"{field} debe ser mayor que 0." if not allow_zero else f"{field} no puede ser negativo.")
        return _BAD
    if d > MAX_MONEY:
        c.add(field, "too_large", f"{field} no puede superar {MAX_MONEY:,.0f}.")
        return _BAD
    return d


def _number_in_range(c: Collector, field: str, value, lo: int, hi: int):
    d = _decimal(value)
    if d is None or not (lo <= d <= hi) or d.as_tuple().exponent < -2:
        c.add(field, "out_of_range", f"{field} debe ser un número entre {lo} y {hi}.")
        return _BAD
    return d


def parse_date(value) -> date | None:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _date(c: Collector, field: str, value):
    parsed = parse_date(value)
    if parsed is None:
        c.add(field, "invalid_date", f"{field} debe ser una fecha válida con formato YYYY-MM-DD.")
        return _BAD
    return parsed


def _enum(c: Collector, field: str, value, allowed):
    if not isinstance(value, str) or value not in allowed:
        c.add(field, "invalid_value", f"{field} debe ser uno de: {', '.join(allowed)}.")
        return _BAD
    return value


# --- Viajes ------------------------------------------------------------------------------------
def _trip_field(c: Collector, name: str, value):
    if name == "title":
        return _text(c, name, value, max_len=120)
    if name in ("origin", "destination"):
        return _text(c, name, value, max_len=80, min_len=2)
    if name in ("startDate", "endDate"):
        return _date(c, name, value)
    if name == "travelers":
        return _int(c, name, value, lo=1, hi=20)
    if name == "budget":
        return _money(c, name, value, allow_zero=False)
    if name == "currency":
        return _enum(c, name, value, CURRENCIES)
    if name == "notes":
        return _text(c, name, value, max_len=1000, min_len=0, multiline=True)
    if name == "status":
        return _enum(c, name, value, TRIP_STATUSES)
    raise AssertionError(name)


def _check_trip_dates(c: Collector, start: date | None, end: date | None, today: date, start_changed: bool) -> None:
    if start is not None and start_changed and start < today:
        c.add("startDate", "not_future", "startDate debe ser hoy o una fecha futura.")
    if start is not None and end is not None:
        if end < start:
            c.add("endDate", "before_startDate", "endDate debe ser igual o posterior a startDate.")
        elif (end - start).days > MAX_TRIP_DAYS:
            c.add("endDate", "too_long", f"El viaje no puede durar más de {MAX_TRIP_DAYS} días.")


def validate_trip_create(body, today: date) -> dict:
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    _check_keys(c, body, TRIP_CREATE_KEYS)
    out: dict = {}
    for name in TRIP_REQUIRED:
        if name not in body or body[name] is None:
            c.add(name, "required", f"{name} es obligatorio.")
            continue
        cleaned = _trip_field(c, name, body[name])
        if cleaned is not _BAD:
            out[name] = cleaned
    if body.get("notes") is not None:
        notes = _trip_field(c, "notes", body["notes"])
        if notes is not _BAD and notes:
            out["notes"] = notes
    _check_trip_dates(c, out.get("startDate"), out.get("endDate"), today, start_changed=True)
    c.raise_if_any()
    out["startDate"] = out["startDate"].isoformat()
    out["endDate"] = out["endDate"].isoformat()
    return out


def validate_trip_update(body, existing: dict, today: date) -> dict:
    """Actualización parcial: devuelve solo los campos que cambian (None = borrar el atributo)."""
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    _check_keys(c, body, TRIP_UPDATE_KEYS)
    provided = [k for k in TRIP_UPDATE_KEYS if k in body]
    if not provided and not c.details:
        c.add("body", "empty", "No hay campos para actualizar.")
    changes: dict = {}
    for name in provided:
        value = body[name]
        if name == "notes" and value is None:
            changes["notes"] = None
            continue
        if value is None:
            c.add(name, "required", f"{name} no puede ser nulo.")
            continue
        cleaned = _trip_field(c, name, value)
        if cleaned is _BAD:
            continue
        changes[name] = (cleaned or None) if name == "notes" else cleaned
    old_start, old_end = parse_date(existing.get("startDate")), parse_date(existing.get("endDate"))
    new_start = changes.get("startDate", old_start)
    new_end = changes.get("endDate", old_end)
    if "startDate" in changes or "endDate" in changes:
        _check_trip_dates(c, new_start, new_end, today, start_changed="startDate" in changes and new_start != old_start)
    c.raise_if_any()
    for name in ("startDate", "endDate"):
        if name in changes:
            changes[name] = changes[name].isoformat()
    return changes


def validate_trip_status_filter(value) -> str:
    if not isinstance(value, str) or value not in TRIP_STATUSES:
        raise ValidationError(f"status debe ser uno de: {', '.join(TRIP_STATUSES)}.",
                              details=[{"field": "status", "issue": "invalid_value"}])
    return value


def validate_trip_id_filter(value) -> str:
    if not ids.is_trip_id(value):
        raise ValidationError("tripId no tiene un formato válido.", details=[{"field": "tripId", "issue": "invalid_format"}])
    return value


# --- Itinerario --------------------------------------------------------------------------------
def _validate_weather(c: Collector, prefix: str, weather) -> dict | None:
    if not isinstance(weather, dict):
        c.add(prefix, "not_an_object", f"{prefix} debe ser un objeto.")
        return None
    for key in weather:
        if key not in ("tempMax", "tempMin", "condition", "rainProbability"):
            c.add(f"{prefix}.{str(key)[:40]}", "unknown_field", f"Campo no permitido: {prefix}.{str(key)[:40]}.")
    out: dict = {}
    for key, lo, hi in (("tempMax", -90, 60), ("tempMin", -90, 60), ("rainProbability", 0, 100)):
        if weather.get(key) is not None:
            n = _number_in_range(c, f"{prefix}.{key}", weather[key], lo, hi)
            if n is not _BAD:
                out[key] = n
    if weather.get("condition") is not None:
        cond = _text(c, f"{prefix}.condition", weather["condition"], max_len=80)
        if cond is not _BAD:
            out["condition"] = cond
    return out


def _validate_item(c: Collector, prefix: str, item) -> dict | None:
    if not isinstance(item, dict):
        c.add(prefix, "not_an_object", f"{prefix} debe ser un objeto.")
        return None
    for key in item:
        if key not in ("time", "title", "type", "location", "notes"):
            c.add(f"{prefix}.{str(key)[:40]}", "unknown_field", f"Campo no permitido: {prefix}.{str(key)[:40]}.")
    out: dict = {}
    time_value = item.get("time")
    if not isinstance(time_value, str) or not TIME_RE.fullmatch(time_value):
        c.add(f"{prefix}.time", "invalid_time", f"{prefix}.time debe tener formato HH:MM.")
    else:
        out["time"] = time_value
    if item.get("title") is None:
        c.add(f"{prefix}.title", "required", f"{prefix}.title es obligatorio.")
    else:
        title = _text(c, f"{prefix}.title", item["title"], max_len=120)
        if title is not _BAD:
            out["title"] = title
    if item.get("type") is None:
        c.add(f"{prefix}.type", "required", f"{prefix}.type es obligatorio.")
    else:
        item_type = _enum(c, f"{prefix}.type", item["type"], ITEM_TYPES)
        if item_type is not _BAD:
            out["type"] = item_type
    for key, limit in (("location", 120), ("notes", 500)):
        if item.get(key) not in (None, ""):
            text = _text(c, f"{prefix}.{key}", item[key], max_len=limit, multiline=(key == "notes"))
            if text is not _BAD:
                out[key] = text
    return out


def validate_itinerary(body, trip: dict) -> list[dict]:
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    for key in body:
        if key not in READ_ONLY and key != "days":
            c.add(str(key)[:40], "unknown_field", f"Campo no permitido: {str(key)[:40]}.")
    days = body.get("days")
    if not isinstance(days, list) or not 1 <= len(days) <= MAX_ITINERARY_DAYS:
        c.add("days", "invalid_length", f"days debe ser una lista de 1 a {MAX_ITINERARY_DAYS} días.")
        c.raise_if_any()
    start, end = parse_date(trip.get("startDate")), parse_date(trip.get("endDate"))
    seen: set[date] = set()
    out: list[dict] = []
    for i, day in enumerate(days):
        prefix = f"days[{i}]"
        if not isinstance(day, dict):
            c.add(prefix, "not_an_object", f"{prefix} debe ser un objeto.")
            continue
        for key in day:
            if key not in ("date", "weather", "items"):
                c.add(f"{prefix}.{str(key)[:40]}", "unknown_field", f"Campo no permitido: {prefix}.{str(key)[:40]}.")
        parsed = _date(c, f"{prefix}.date", day.get("date"))
        clean_day: dict = {}
        if parsed is not _BAD:
            if parsed in seen:
                c.add(f"{prefix}.date", "duplicate_date", f"{prefix}.date está repetida.")
            elif start and end and not start <= parsed <= end:
                c.add(f"{prefix}.date", "outside_trip", f"{prefix}.date debe estar entre {start} y {end}.")
            seen.add(parsed)
            clean_day["date"] = parsed.isoformat()
        if day.get("weather") is not None:
            weather = _validate_weather(c, f"{prefix}.weather", day["weather"])
            if weather:
                clean_day["weather"] = weather
        items = day.get("items", [])
        if items is None:
            items = []
        if not isinstance(items, list) or len(items) > MAX_ITEMS_PER_DAY:
            c.add(f"{prefix}.items", "invalid_length", f"{prefix}.items debe ser una lista de hasta {MAX_ITEMS_PER_DAY} elementos.")
            items = []
        clean_day["items"] = [x for x in (_validate_item(c, f"{prefix}.items[{j}]", it) for j, it in enumerate(items)) if x is not None]
        out.append(clean_day)
    c.raise_if_any()
    out.sort(key=lambda d: d["date"])
    return out


# --- Reservas ----------------------------------------------------------------------------------
def _validate_details(c: Collector, rtype: str, details) -> dict | None:
    if not isinstance(details, dict):
        c.add("details", "not_an_object", "details debe ser un objeto.")
        return None
    allowed = DETAILS_KEYS[rtype]
    out: dict = {}
    for key, value in details.items():
        if key not in allowed:
            c.add(f"details.{str(key)[:40]}", "unknown_field", f"Campo no permitido en details: {str(key)[:40]}.")
            continue
        field = f"details.{key}"
        text = _text(c, field, value, max_len=MAX_BOOKING_URL if key == "bookingUrl" else MAX_DETAIL_VALUE)
        if text is _BAD:
            continue
        if key == "bookingUrl" and (not text.lower().startswith("https://") or any(ch.isspace() for ch in text)):
            c.add(field, "invalid_url", "details.bookingUrl debe ser una URL que empiece por https://.")
            continue
        if key in ("checkIn", "checkOut", "date") and parse_date(text) is None:
            c.add(field, "invalid_date", f"{field} debe tener formato YYYY-MM-DD.")
            continue
        if key == "time" and not TIME_RE.fullmatch(text):
            c.add(field, "invalid_time", f"{field} debe tener formato HH:MM.")
            continue
        out[key] = text
    for key in DETAILS_REQUIRED[rtype]:
        if key not in out and f"details.{key}" not in {d["field"] for d in c.details}:
            c.add(f"details.{key}", "required", f"details.{key} es obligatorio para {rtype}.")
    if rtype == "HOTEL" and "checkIn" in out and "checkOut" in out and parse_date(out["checkOut"]) < parse_date(out["checkIn"]):
        c.add("details.checkOut", "before_checkIn", "details.checkOut debe ser igual o posterior a checkIn.")
    if len(dumps(out).encode("utf-8")) > MAX_DETAILS_BYTES:
        c.add("details", "too_large", f"details no puede superar {MAX_DETAILS_BYTES} bytes.")
    return out


def validate_reservation_create(body) -> dict:
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    _check_keys(c, body, ("type", "status", "provider", "details", "price", "currency"))
    for name in ("type", "provider", "details", "price", "currency"):
        if body.get(name) is None:
            c.add(name, "required", f"{name} es obligatorio.")
    out: dict = {}
    rtype = _enum(c, "type", body["type"], RESERVATION_TYPES) if body.get("type") is not None else _BAD
    if rtype is not _BAD:
        out["type"] = rtype
    status = body.get("status")
    out["status"] = "SIMULADA" if status is None else _enum(c, "status", status, RESERVATION_STATUSES)
    if out["status"] is _BAD:
        del out["status"]
    if body.get("provider") is not None:
        provider = _text(c, "provider", body["provider"], max_len=80)
        if provider is not _BAD:
            out["provider"] = provider
    if body.get("price") is not None:
        price = _money(c, "price", body["price"], allow_zero=True)
        if price is not _BAD:
            out["price"] = price
    if body.get("currency") is not None:
        currency = _enum(c, "currency", body["currency"], CURRENCIES)
        if currency is not _BAD:
            out["currency"] = currency
    if rtype is not _BAD and body.get("details") is not None:
        details = _validate_details(c, rtype, body["details"])
        if details is not None:
            out["details"] = details
    c.raise_if_any()
    return out


def validate_reservation_update(body, existing: dict) -> dict:
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    _check_keys(c, body, ("type", "status", "provider", "details", "price", "currency"))
    if "type" in body and body["type"] != existing.get("type"):
        c.add("type", "immutable", "El tipo de la reserva no se puede cambiar.")
    provided = [k for k in ("status", "provider", "details", "price", "currency") if k in body]
    if not provided and not c.details:
        c.add("body", "empty", "No hay campos para actualizar.")
    changes: dict = {}
    for name in provided:
        value = body[name]
        if value is None:
            c.add(name, "required", f"{name} no puede ser nulo.")
            continue
        if name == "status":
            cleaned = _enum(c, name, value, RESERVATION_STATUSES)
        elif name == "provider":
            cleaned = _text(c, name, value, max_len=80)
        elif name == "price":
            cleaned = _money(c, name, value, allow_zero=True)
        elif name == "currency":
            cleaned = _enum(c, name, value, CURRENCIES)
        else:
            cleaned = _validate_details(c, existing["type"], value)
            cleaned = _BAD if cleaned is None else cleaned
        if cleaned is not _BAD:
            changes[name] = cleaned
    c.raise_if_any()
    return changes


# --- Preferencias -----------------------------------------------------------------------------
PREFERENCE_KEYS = ("travelStyles", "pace", "flightTime", "budgetLevel", "notes")
_CARD_LIKE = re.compile(r"(?:\d[ -]?){13,19}")


def validate_preferences(body) -> dict:
    """Esquema de preferencias (reemplazo completo; todos los campos son opcionales).

    travelStyles: 0-6 estilos distintos; pace, flightTime y budgetLevel: enums; notes: texto libre <= 200
    sin datos de pago (ni claves de tarjeta ni algo que parezca un numero de tarjeta).
    """
    body = _object(body)
    reject_payment_fields(body)
    c = Collector()
    _check_keys(c, body, PREFERENCE_KEYS)
    out: dict = {}
    styles = body.get("travelStyles")
    if styles is not None:
        if not isinstance(styles, list) or len(styles) > MAX_TRAVEL_STYLES:
            c.add("travelStyles", "invalid_length", f"travelStyles debe ser una lista de hasta {MAX_TRAVEL_STYLES} estilos.")
        else:
            cleaned = [_enum(c, f"travelStyles[{i}]", x, TRAVEL_STYLES) for i, x in enumerate(styles)]
            if all(x is not _BAD for x in cleaned):
                out["travelStyles"] = list(dict.fromkeys(cleaned))  # sin repetidos, conserva el orden
    for name, allowed in (("pace", PACES), ("flightTime", FLIGHT_TIMES), ("budgetLevel", BUDGET_LEVELS)):
        if body.get(name) is not None:
            value = _enum(c, name, body[name], allowed)
            if value is not _BAD:
                out[name] = value
    if body.get("notes") not in (None, ""):
        value = _text(c, "notes", body["notes"], max_len=MAX_PREFERENCE_NOTES)
        if value is not _BAD and _CARD_LIKE.search(value):
            c.add("notes", "payment_data_not_allowed", "No se aceptan datos de tarjetas ni de pago.")
        elif value is not _BAD:
            out["notes"] = value
    c.raise_if_any()
    return out
