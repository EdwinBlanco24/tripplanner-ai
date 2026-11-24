"""Bloque estructurado del clima (S3c): se construye en código a partir del resultado REAL de get_forecast.

Solo biblioteca estándar. El agente anexa a su respuesta un bloque ```json con la clave "weather" que consume
el Orchestrator (evento ui:weather). Forma: {"weather": {"location": "Cartagena, Colombia", "days": [...]}}
con days[] = {date, tempMax, tempMin, condition, rainProbability}.
"""

from __future__ import annotations

import json
import re

MAX_DAYS = 16
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_tool_result(result) -> dict | None:
    """Dict del resultado de una tool MCP: structuredContent primero, si no el texto JSON; None si es error."""
    if not isinstance(result, dict) or result.get("status") == "error":
        return None
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    for block in result.get("content") or []:
        text = block.get("text") if isinstance(block, dict) else None
        if isinstance(text, str):
            try:
                data = json.loads(text)
            except ValueError:
                continue
            if isinstance(data, dict):
                return data
    return None


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def normalize_forecast(data) -> dict | None:
    """{"location","days"} limpio, o None si no hay días válidos."""
    if not isinstance(data, dict):
        return None
    days = []
    for raw in data.get("days") or []:
        if not isinstance(raw, dict):
            continue
        day = raw.get("date")
        if not isinstance(day, str) or not _DATE_RE.fullmatch(day):
            continue
        item = {
            "date": day,
            "tempMax": _num(raw.get("tempMax")),
            "tempMin": _num(raw.get("tempMin")),
            "condition": raw.get("condition") if isinstance(raw.get("condition"), str) else None,
        }
        if isinstance(raw.get("weekday"), str) and raw["weekday"]:
            item["weekday"] = raw["weekday"]
        rain = _num(raw.get("rainProbability"))
        if rain is not None:
            item["rainProbability"] = int(rain)
        days.append(item)
    if not days:
        return None
    location = data.get("location")
    if isinstance(location, dict):
        parts = [p for p in (location.get("name"), location.get("admin1"), location.get("country")) if isinstance(p, str) and p]
        location = ", ".join(dict.fromkeys(parts)) or None
    elif not isinstance(location, str):
        location = None
    return {"location": location, "days": days[:MAX_DAYS]}


def build_weather_block(forecast: dict | None) -> str:
    """'\\n\\n```json\\n{"weather": ...}\\n```' o '' si no hay pronóstico."""
    if not forecast or not forecast.get("days"):
        return ""
    return "\n\n```json\n" + json.dumps({"weather": forecast}, ensure_ascii=False) + "\n```"
