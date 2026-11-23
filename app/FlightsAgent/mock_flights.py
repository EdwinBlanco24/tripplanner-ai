"""Datos SIMULADOS de vuelos, solo para desarrollo y pruebas.

main.py usa esta tool unicamente si FLIGHTS_USE_MOCK == "1" (opt-in explicito).
Por defecto el agente obtiene vuelos reales desde el servidor MCP remoto.
"""

from datetime import datetime

from strands import tool


@tool
def search_flights(
    origin: str,
    destination: str,
    date: str,
) -> list[dict]:
    """Busca vuelos entre dos ciudades para una fecha futura determinada."""

    requested_date = datetime.strptime(date, "%Y-%m-%d").date()
    today = datetime.now().date()

    if requested_date < today:
        raise ValueError(
            f"La fecha solicitada {requested_date} no puede ser anterior "
            f"a la fecha actual {today}."
        )

    return [
        {
            "flight": "AV9821",
            "origin": origin,
            "destination": destination,
            "date": requested_date.isoformat(),
            "depart": "07:15",
            "price_usd": 89,
        },
        {
            "flight": "LA4410",
            "origin": origin,
            "destination": destination,
            "date": requested_date.isoformat(),
            "depart": "12:40",
            "price_usd": 76,
        },
        {
            "flight": "AV9835",
            "origin": origin,
            "destination": destination,
            "date": requested_date.isoformat(),
            "depart": "18:05",
            "price_usd": 102,
        },
    ]
