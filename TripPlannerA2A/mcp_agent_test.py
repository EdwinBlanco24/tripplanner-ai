"""O6b - Agente Strands minimo con SOLO la tool MCP search-flight (filtrada)."""
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient

base = Path(__file__).parent
load_dotenv(base / ".env.local")
url = os.environ["TRAVEL_MCP_URL"]
key = os.environ["SMITHERY_API_KEY"]
PERMITIDAS = {"kiwi-flights.search-flight"}

SYSTEM_PROMPT = (
    "Eres un agente de vuelos. Usa la tool de busqueda de vuelos para obtener datos reales. "
    "La tool exige departureDate en formato dd/mm/yyyy. "
    "Si el usuario prefiere salir por la manana, usa dtime_from=5 y dtime_to=11. "
    "Usa currency=USD. Nunca inventes vuelos; si la tool falla, dilo. "
    "Responde en espanol con hora de salida, numero de vuelo, aerolinea y precio."
)

client = MCPClient(lambda: streamablehttp_client(
    url, headers={"Authorization": f"Bearer {key}"}
))

with client:
    todas = client.list_tools_sync()
    tools = [t for t in todas if t.tool_name in PERMITIDAS]
    print(f"Tools MCP descubiertas: {len(todas)} -> entregadas al agente: {[t.tool_name for t in tools]}")

    agent = Agent(system_prompt=SYSTEM_PROMPT, tools=tools, callback_handler=None)
    print(f"Modelo: {agent.model.config.get('model_id')}")

    t0 = time.perf_counter()
    try:
        result = agent("Busco vuelo de Bogota a Cartagena el 2026-11-20. Prefiero salir por la manana.")
    except Exception as e:
        print(f"\nERROR {type(e).__name__}: {e}")
        raise SystemExit(1)
    print(f"Latencia total del agente: {int((time.perf_counter() - t0) * 1000)} ms")

    print("\n--- Llamadas a tools que hizo el LLM ---")
    for msg in agent.messages:
        for block in msg.get("content", []):
            if "toolUse" in block:
                tu = block["toolUse"]
                print(f"tool: {tu['name']}")
                print(f"input: {json.dumps(tu['input'], ensure_ascii=False)}")
            if "toolResult" in block:
                print(f"toolResult status: {block['toolResult'].get('status')}")

    print("\n--- Respuesta final del agente ---")
    print(str(result))
