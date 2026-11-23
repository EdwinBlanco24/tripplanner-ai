"""Prueba S3c (Parte A): MCP oficial de Kiwi, directo y SIN autenticación.

initialize + tools/list + tools/call search-flight (BOG -> CTG, 04/12/2026, USD) contra https://mcp.kiwi.com con
MCPClient + streamablehttp_client SIN cabeceras. Después ejecuta sobre el resultado REAL la lógica que usa FlightsAgent
para construir el bloque ```json de vuelos e imprime ese JSON.

    python s3c_kiwi_direct_test.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "app", "FlightsAgent")))

import flight_blocks  # noqa: E402
from mcp.client.streamable_http import streamablehttp_client  # noqa: E402
from strands.tools.mcp import MCPClient  # noqa: E402

URL = "https://mcp.kiwi.com"
ARGS = {"flyFrom": "BOG", "flyTo": "CTG", "departureDate": "04/12/2026", "currency": "USD", "adults": 1}


def main() -> int:
    client = MCPClient(lambda: streamablehttp_client(URL, timeout=timedelta(seconds=30), sse_read_timeout=timedelta(seconds=60)),
                       startup_timeout=30)
    with client:  # initialize
        print(f"initialize OK ({URL}, sin cabeceras de autenticación)")
        tools = client.list_tools_sync()
        print("tools/list:", [t.tool_name for t in tools])

        started = time.perf_counter()
        result = client.call_tool_sync(tool_use_id="s3c-kiwi-1", name="search-flight", arguments=ARGS,
                                       read_timeout_seconds=timedelta(seconds=60))
        print(f"tools/call search-flight: status={result.get('status')} en {int((time.perf_counter() - started) * 1000)} ms "
              f"| structuredContent={'sí' if result.get('structuredContent') else 'no'}")

    data = flight_blocks.parse_tool_result(result)
    if data is None:
        print("No se pudo interpretar el resultado:", json.dumps(result, ensure_ascii=False)[:500])
        return 1
    print(f"resultsCount={data.get('resultsCount')} currency={data.get('currency')} error={data.get('error')} "
          f"query={data.get('query')!r}")

    print("\n--- 3 primeros itinerarios (resultado crudo, resumido) ---")
    for it in (data.get("itineraries") or [])[:3]:
        out = it.get("outbound") or {}
        segs = " + ".join(str(s.get("flightNumber")) for s in out.get("segments", []))
        print(f"  {it.get('priceFormatted'):>9}  {out.get('departureTime')} -> {out.get('arrivalTime')}  escalas={out.get('stops')}  {segs}  {it.get('bookingUrl')}")

    print("\n--- Lógica de FlightsAgent sobre ese resultado real ---")
    flights = flight_blocks.normalize_result(data)
    print(f"normalizados: {len(flights)} de {len(data.get('itineraries') or [])}")
    simulated_text = " ".join(f["flightNumber"] for f in flights[7:10] if f.get("flightNumber"))  # el modelo 'menciona' 3 vuelos
    chosen = flight_blocks.select_flights(flights, simulated_text)
    print(f"seleccionados por el texto simulado ({simulated_text!r}): {[f['flightNumber'] for f in chosen]}")
    cheapest = flight_blocks.select_flights(flights, "")
    print(f"seleccionados por precio (sin mención en el texto): {[(f['flightNumber'], f['price']) for f in cheapest]}")
    block = flight_blocks.build_flights_block(cheapest)
    print("\nBloque que se anexaría a la respuesta:")
    print(block.strip())
    parsed = json.loads(block.split("```json\n", 1)[1].rsplit("\n```", 1)[0])
    assert 1 <= len(parsed["flights"]) <= 5
    required = {"airline", "flightNumber", "origin", "destination", "departureTime", "arrivalTime", "durationMinutes",
                "stops", "price", "currency", "bookingUrl"}
    assert all(set(f) == required for f in parsed["flights"])
    print("\nEsquema verificado: las 11 claves en cada vuelo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
