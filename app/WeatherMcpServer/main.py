"""WeatherMcpServer: servidor MCP (Streamable HTTP, stateless) con el clima de Open-Meteo. Sin API keys.

Contrato de AgentCore Runtime para protocol=MCP: escuchar en 0.0.0.0:8000, ruta /mcp, HTTP sin estado
(FastMCP(host="0.0.0.0", stateless_http=True) y mcp.run(transport="streamable-http")). La autenticación de entrada es
AWS_IAM (SigV4): la hace el servicio antes de llegar aquí.

Tools:
  get_forecast(city, start_date, end_date, country_code?)  pronóstico diario (hasta 16 días, dentro del horizonte)
  get_current_weather(city, country_code?)                 temperatura actual y condición
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta, timezone

import httpx
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("weather_mcp")
logger.setLevel(logging.INFO)
if not logging.getLogger().handlers and not logger.handlers:
    logger.addHandler(logging.StreamHandler())

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HTTP_TIMEOUT_SECONDS = 10
MAX_RANGE_DAYS = 16          # Open-Meteo entrega hasta 16 días de pronóstico
MAX_CITY_LENGTH = 100

# AgentCore exige el puerto 8000; MCP_PORT existe solo para ejecutar el servidor en local sin chocar con otro.
mcp = FastMCP("WeatherMcpServer", host="0.0.0.0", port=int(os.environ.get("MCP_PORT", "8000")), stateless_http=True)

# Código WMO (weather_code de Open-Meteo) -> condición en español.
WEATHER_CODES = {
    0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
    45: "Niebla", 48: "Niebla con escarcha",
    51: "Llovizna ligera", 53: "Llovizna moderada", 55: "Llovizna intensa",
    56: "Llovizna helada ligera", 57: "Llovizna helada intensa",
    61: "Lluvia ligera", 63: "Lluvia moderada", 65: "Lluvia fuerte",
    66: "Lluvia helada ligera", 67: "Lluvia helada fuerte",
    71: "Nevada ligera", 73: "Nevada moderada", 75: "Nevada fuerte", 77: "Granizo fino",
    80: "Chubascos ligeros", 81: "Chubascos moderados", 82: "Chubascos violentos",
    85: "Chubascos de nieve ligeros", 86: "Chubascos de nieve fuertes",
    95: "Tormenta eléctrica", 96: "Tormenta con granizo ligero", 99: "Tormenta con granizo fuerte",
}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COUNTRY_RE = re.compile(r"^[A-Za-z]{2}$")


def condition_for(code) -> str:
    return WEATHER_CODES.get(code, "Condición desconocida") if isinstance(code, int) and not isinstance(code, bool) else "Condición desconocida"


def _parse_date(value: str, field: str) -> date:
    if not isinstance(value, str) or not _DATE_RE.fullmatch(value):
        raise ValueError(f"{field} debe tener formato YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} no es una fecha válida.") from None


def validate_range(start_date: str, end_date: str, today: date | None = None) -> tuple[date, date]:
    """Valida el rango pedido: formato, orden, máximo 16 días y dentro del horizonte de pronóstico."""
    today = today or datetime.now(timezone.utc).date()
    start, end = _parse_date(start_date, "start_date"), _parse_date(end_date, "end_date")
    if end < start:
        raise ValueError("end_date no puede ser anterior a start_date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"El rango no puede superar {MAX_RANGE_DAYS} días.")
    if start < today - timedelta(days=1):
        raise ValueError("start_date no puede ser una fecha pasada: solo hay pronóstico para hoy y los próximos días.")
    if end > today + timedelta(days=MAX_RANGE_DAYS - 1):
        raise ValueError(
            f"Solo hay pronóstico hasta {today + timedelta(days=MAX_RANGE_DAYS - 1)} "
            f"({MAX_RANGE_DAYS} días desde hoy); end_date queda fuera del horizonte."
        )
    return start, end


def _clean_city(city: str) -> str:
    if not isinstance(city, str) or not city.strip():
        raise ValueError("city es obligatorio.")
    city = city.strip()
    if len(city) > MAX_CITY_LENGTH:
        raise ValueError(f"city no puede superar {MAX_CITY_LENGTH} caracteres.")
    return city


async def _get_json(client: httpx.AsyncClient, url: str, params: dict) -> dict:
    try:
        response = await client.get(url, params=params)
    except httpx.TimeoutException:
        raise ValueError("El servicio de clima (Open-Meteo) no respondió a tiempo. Inténtalo de nuevo.") from None
    except httpx.HTTPError:
        raise ValueError("No se pudo contactar con el servicio de clima (Open-Meteo).") from None
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code >= 400 or (isinstance(data, dict) and data.get("error")):
        reason = data.get("reason") if isinstance(data, dict) else None
        logger.warning("open_meteo_error status=%s reason=%s", response.status_code, str(reason)[:200])
        raise ValueError(f"Open-Meteo rechazó la consulta: {reason}" if reason else "Open-Meteo no pudo atender la consulta.")
    return data


async def geocode(client: httpx.AsyncClient, city: str, country_code: str | None = None) -> dict:
    params = {"name": _clean_city(city), "count": 1, "language": "es", "format": "json"}
    if country_code:
        if not _COUNTRY_RE.fullmatch(country_code):
            raise ValueError("country_code debe ser un código ISO de 2 letras (p. ej. CO).")
        params["countryCode"] = country_code.upper()
    data = await _get_json(client, GEOCODING_URL, params)
    results = data.get("results") or []
    if not results:
        raise ValueError(f"No se encontró la ciudad «{city.strip()[:60]}». Prueba con otro nombre o añade country_code.")
    top = results[0]
    return {"name": top.get("name"), "country": top.get("country"), "lat": top.get("latitude"), "lon": top.get("longitude")}


def _number(value):
    return round(value, 1) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def build_days(daily: dict) -> list[dict]:
    dates = daily.get("time") or []
    days = []
    for i, day in enumerate(dates):
        def at(key):
            values = daily.get(key) or []
            return values[i] if i < len(values) else None
        rain = at("precipitation_probability_max")
        days.append({
            "date": day,
            "tempMax": _number(at("temperature_2m_max")),
            "tempMin": _number(at("temperature_2m_min")),
            "rainProbability": int(rain) if isinstance(rain, (int, float)) and not isinstance(rain, bool) else None,
            "condition": condition_for(at("weather_code")),
        })
    return days


async def forecast(client: httpx.AsyncClient, city: str, start_date: str, end_date: str,
                   country_code: str | None = None, today: date | None = None) -> dict:
    start, end = validate_range(start_date, end_date, today)
    location = await geocode(client, city, country_code)
    data = await _get_json(client, FORECAST_URL, {
        "latitude": location["lat"], "longitude": location["lon"], "timezone": "auto",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
    })
    days = build_days(data.get("daily") or {})
    if not days:
        raise ValueError("Open-Meteo no devolvió datos de pronóstico para ese rango.")
    return {"location": location, "days": days}


async def current_weather(client: httpx.AsyncClient, city: str, country_code: str | None = None) -> dict:
    location = await geocode(client, city, country_code)
    data = await _get_json(client, FORECAST_URL, {
        "latitude": location["lat"], "longitude": location["lon"], "timezone": "auto",
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    })
    current = data.get("current") or {}
    if current.get("temperature_2m") is None:
        raise ValueError("Open-Meteo no devolvió el clima actual.")
    return {
        "location": location,
        "current": {
            "time": current.get("time"),
            "temperature": _number(current.get("temperature_2m")),
            "apparentTemperature": _number(current.get("apparent_temperature")),
            "humidity": current.get("relative_humidity_2m"),
            "windSpeedKmh": _number(current.get("wind_speed_10m")),
            "condition": condition_for(current.get("weather_code")),
        },
    }


@mcp.tool()
async def get_forecast(city: str, start_date: str, end_date: str, country_code: str | None = None) -> dict:
    """Pronóstico diario del clima de una ciudad entre dos fechas (YYYY-MM-DD, hasta 16 días desde hoy).

    Devuelve la ubicación encontrada y, por día: date, tempMax y tempMin (°C), rainProbability (%) y condition (español).
    Args:
        city: Nombre de la ciudad (p. ej. Cartagena).
        start_date: Primer día, YYYY-MM-DD (hoy o futuro).
        end_date: Último día, YYYY-MM-DD (rango máximo de 16 días).
        country_code: Código ISO de 2 letras para desambiguar ciudades homónimas (p. ej. CO).
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        result = await forecast(client, city, start_date, end_date, country_code)
    logger.info("tools/call get_forecast days=%d", len(result["days"]))
    return result


@mcp.tool()
async def get_current_weather(city: str, country_code: str | None = None) -> dict:
    """Temperatura actual, sensación térmica, humedad, viento y condición de una ciudad.

    Args:
        city: Nombre de la ciudad (p. ej. Cartagena).
        country_code: Código ISO de 2 letras para desambiguar ciudades homónimas (p. ej. CO).
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        result = await current_weather(client, city, country_code)
    logger.info("tools/call get_current_weather")
    return result


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
