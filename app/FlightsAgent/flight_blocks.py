"""Bloque estructurado de vuelos construido EN CÓDIGO a partir del resultado real de la tool MCP de Kiwi.

El modelo ya no escribe el JSON (podía omitirlo o alterarlo): FlightsAgent captura el resultado de
`kiwi_search_flight`, lo normaliza y lo anexa al final de la respuesta A2A en un bloque ```json.
Módulo puro (solo librería estándar): fácil de probar sin red.

Esquema de cada vuelo:
  airline, flightNumber, origin, destination, departureTime (ISO local YYYY-MM-DDTHH:MM), arrivalTime,
  durationMinutes, stops, price (número), currency, bookingUrl
"""

from __future__ import annotations

import json
from typing import Any

MAX_FLIGHTS = 5


def parse_tool_result(result: Any) -> dict | None:
    """Datos JSON de un ToolResult de Strands (structuredContent o texto JSON). None si es un error o no es JSON."""
    if not isinstance(result, dict) or result.get("status") == "error" or result.get("isError"):
        return None
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    for block in result.get("content") or []:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            try:
                data = json.loads(block["text"])
            except ValueError:
                continue
            if isinstance(data, dict):
                return data
        if isinstance(block, dict) and isinstance(block.get("json"), dict):
            return block["json"]
    return None


def _minute(value: Any) -> str | None:
    """'2026-12-04T18:15:00' -> '2026-12-04T18:15' (hora local, sin segundos ni zona)."""
    if not isinstance(value, str) or len(value) < 16:
        return None
    return value[:16]


def _join_unique(values: list[str], separator: str) -> str | None:
    unique = list(dict.fromkeys(v for v in values if v))
    return separator.join(unique) if unique else None


def normalize_itinerary(itinerary: Any, currency: str | None) -> dict | None:
    """Un itinerario de Kiwi (ida) -> vuelo normalizado. None si no tiene lo mínimo (ida, precio y enlace)."""
    if not isinstance(itinerary, dict):
        return None
    outbound = itinerary.get("outbound")
    if not isinstance(outbound, dict):
        return None
    segments = [s for s in outbound.get("segments") or [] if isinstance(s, dict)]
    price = itinerary.get("price")
    if isinstance(price, bool) or not isinstance(price, (int, float)):
        return None
    duration = outbound.get("durationSeconds", itinerary.get("totalDurationSeconds"))
    stops = outbound.get("stops")
    return {
        "airline": _join_unique([s.get("carrierName") or s.get("carrier") for s in segments], " / "),
        "flightNumber": _join_unique([s.get("flightNumber") for s in segments], "+"),
        "origin": outbound.get("from"),
        "destination": outbound.get("to"),
        "departureTime": _minute(outbound.get("departureTime")),
        "arrivalTime": _minute(outbound.get("arrivalTime")),
        "durationMinutes": round(duration / 60) if isinstance(duration, (int, float)) and not isinstance(duration, bool) else None,
        "stops": stops if isinstance(stops, int) and not isinstance(stops, bool) else max(len(segments) - 1, 0),
        "price": int(price) if float(price).is_integer() else price,
        "currency": currency,
        "bookingUrl": itinerary.get("bookingUrl") if isinstance(itinerary.get("bookingUrl"), str) else None,
    }


def normalize_result(data: Any) -> list[dict]:
    """Todos los vuelos normalizados de un resultado de search-flight."""
    if not isinstance(data, dict) or data.get("error"):
        return []
    currency = data.get("currency") if isinstance(data.get("currency"), str) else None
    flights = (normalize_itinerary(it, currency) for it in data.get("itineraries") or [])
    return [f for f in flights if f is not None]


def select_flights(flights: list[dict], model_text: str = "", limit: int = MAX_FLIGHTS) -> list[dict]:
    """Hasta `limit` vuelos, en el orden en que el texto del modelo los menciona (por flightNumber).

    Si el texto no menciona ninguno (o no hay texto), los `limit` más baratos. Sin duplicados (mismo enlace o vuelo).
    """
    unique: list[dict] = []
    seen: set = set()
    for flight in flights:
        key = flight.get("bookingUrl") or (flight.get("flightNumber"), flight.get("departureTime"))
        if key not in seen:
            seen.add(key)
            unique.append(flight)

    positions = []
    for flight in unique:
        number = flight.get("flightNumber")
        index = model_text.find(number) if number and model_text else -1
        if index >= 0:
            positions.append((index, flight))
    if positions:
        return [f for _, f in sorted(positions, key=lambda p: p[0])][:limit]
    return sorted(unique, key=lambda f: (f["price"] is None, f.get("price") or 0))[:limit]


def build_flights_block(flights: list[dict]) -> str:
    """Texto a anexar a la respuesta: un único bloque ```json con {"flights": [...]}. Vacío si no hay vuelos."""
    if not flights:
        return ""
    return "\n\n```json\n" + json.dumps({"flights": flights}, ensure_ascii=False) + "\n```"
