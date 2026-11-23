"""O6c - Agente Strands con la tool MCP renombrada (sin punto) para Bedrock."""
import inspect
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

base = Path(__file__).parent
load_dotenv(base / ".env.local")
url = os.environ["TRAVEL_MCP_URL"]
key = os.environ["SMITHERY_API_KEY"]

ORIGINAL = "kiwi-flights.search-flight"
NUEVO = "kiwi_search_flight"

firma = inspect.signature(MCPAgentTool.__init__)
print(f"MCPAgentTool.__init__{firma}")
TIENE_OVERRIDE = "name_override" in firma.parameters


class MCPToolRenombrada(MCPAgentTool):
    """Solo cambia el nombre visible para el LLM; la llamada MCP usa el original."""

    def __init__(self, base_tool, nuevo):
        super().__init__(base_tool.mcp_tool, base_tool.mcp_client)
        self._nuevo = nuevo

    @property
    def tool_name(self):
        return self._nuevo

    @property
    def tool_spec(self):
        spec = dict(super().tool_spec)
        spec["name"] = self._nuevo
        return spec


def renombrar(t, nuevo):
    if TIENE_OVERRIDE:
        print("Metodo: name_override nativo de Strands")
        return MCPAgentTool(t.mcp_tool, t.mcp_client, name_override=nuevo)
    print("Metodo: subclase MCPToolRenombrada")
    return MCPToolRenombrada(t, nuevo)


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
    original = next(t for t in todas if t.tool_name == ORIGINAL)
    tool = renombrar(original, NUEVO)
    print(f"Nombre visible para el LLM: {tool.tool_name} | spec.name: {tool.tool_spec['name']}")
    print(f"Nombre real en el servidor MCP: {tool.mcp_tool.name}")

    agent = Agent(system_prompt=SYSTEM_PROMPT, tools=[tool], callback_handler=None)
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
