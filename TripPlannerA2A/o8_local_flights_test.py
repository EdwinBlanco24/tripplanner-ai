"""Prueba LOCAL de FlightsAgent contra el MCP remoto (hace llamadas reales).

Lee TripPlannerA2A\\.env.local (SMITHERY_API_KEY, TRAVEL_MCP_URL). No imprime la key.
Importar main.py no arranca MCP ni el servidor A2A: el MCP se inicia al crear
el primer agente.
"""

import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env.local")

sys.path.insert(0, str(HERE.parent / "app" / "FlightsAgent"))

logging.basicConfig(level=logging.WARNING)
logging.getLogger("flights_agent").setLevel(logging.INFO)

from main import create_agent  # noqa: E402

QUERIES = [
    "Vuelos de Bogotá a Cartagena el 2026-11-20. Prefiero salir por la mañana.",
    "Vuelos de Bogotá a Cartagena el 2026-12-04. Prefiero salir por la mañana.",
]


def _scrub(text: str) -> str:
    key = os.environ.get("SMITHERY_API_KEY", "").strip()
    return text.replace(key, "***") if key else text


def print_tool_activity(agent) -> None:
    for message in agent.messages:
        for block in message.get("content", []):
            if "toolUse" in block:
                tool_use = block["toolUse"]
                print(f"  [toolUse] {tool_use['name']} input={json.dumps(tool_use['input'], ensure_ascii=False)}")
            elif "toolResult" in block:
                result = block["toolResult"]
                texts = [c.get("text", "") for c in result.get("content", []) if "text" in c]
                preview = _scrub(" ".join(texts))[:300]
                print(f"  [toolResult] status={result.get('status')} {preview}")


def main() -> None:
    for number, query in enumerate(QUERIES, start=1):
        print(f"\n=== Consulta {number}: {query}")
        agent = create_agent(f"o8-test-{number}")
        result = agent(query)
        print_tool_activity(agent)
        print("--- Respuesta final:")
        print(_scrub(str(result)))


if __name__ == "__main__":
    main()
