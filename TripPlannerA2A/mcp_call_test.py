"""O6 - tools/call real a kiwi-flights.search-flight: misma ruta, dos fechas."""
import json
import os
import time
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

base = Path(__file__).parent
load_dotenv(base / ".env.local")
url = os.environ["TRAVEL_MCP_URL"]
key = os.environ["SMITHERY_API_KEY"]

TOOL = "kiwi-flights.search-flight"
ORIGEN, DESTINO = "BOG", "CTG"
FECHAS = ["20/11/2026", "04/12/2026"]

client = MCPClient(lambda: streamablehttp_client(
    url, headers={"Authorization": f"Bearer {key}"}
))


def extraer_datos(res):
    if res.get("structuredContent"):
        return res["structuredContent"]
    for c in res.get("content", []):
        if "text" in c:
            try:
                return json.loads(c["text"])
            except json.JSONDecodeError:
                return {"texto": c["text"]}
    return {}


with client:
    for i, fecha in enumerate(FECHAS, start=1):
        args = {"flyFrom": ORIGEN, "flyTo": DESTINO, "departureDate": fecha,
                "currency": "USD", "adults": 1}
        t0 = time.perf_counter()
        res = client.call_tool_sync(
            tool_use_id=f"o6-{i}", name=TOOL, arguments=args,
            read_timeout_seconds=timedelta(seconds=60))
        ms = int((time.perf_counter() - t0) * 1000)

        datos = extraer_datos(res)
        nombre = f"o6_result_{fecha.replace('/', '-')}.json"
        (base / nombre).write_text(
            json.dumps({"args": args, "status": res.get("status"), "latencia_ms": ms,
                        "datos": datos}, indent=2, ensure_ascii=False), encoding="utf-8")

        print("\n" + "=" * 78)
        print(f"{ORIGEN} -> {DESTINO}  fecha {fecha}  status={res.get('status')}  latencia={ms} ms")
        print(f"resultsCount={datos.get('resultsCount')}  currency={datos.get('currency')}  "
              f"error={datos.get('error')}  -> guardado en {nombre}")
        for it in (datos.get("itineraries") or [])[:6]:
            ob = it.get("outbound") or {}
            vuelos = " + ".join(
                f"{s.get('carrierName')} {s.get('carrier')}{s.get('flightNumber')}"
                for s in ob.get("segments", []))
            print(f"  sale {str(ob.get('departureTime'))[:16]}  llega {str(ob.get('arrivalTime'))[11:16]}  "
                  f"{' > '.join(ob.get('route', []))}  stops={ob.get('stops')}  "
                  f"{vuelos}  {it.get('priceFormatted')}")
        if not datos.get("itineraries"):
            print("  (sin itinerarios; revisa el JSON guardado)")
            print("  contenido:", json.dumps(res.get("content"), ensure_ascii=False)[:600])
