"""O5 - Prueba aislada: initialize + tools/list contra el endpoint MCP de Smithery.
No imprime la API key. No forma parte del despliegue."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

load_dotenv(Path(__file__).parent / ".env.local")
url = os.environ["TRAVEL_MCP_URL"]
key = os.environ["SMITHERY_API_KEY"]

print(f"URL: {url}")
print(f"Longitud de la key: {len(key)}")

client = MCPClient(lambda: streamablehttp_client(
    url, headers={"Authorization": f"Bearer {key}"}
))

with client:                           # initialize
    tools = client.list_tools_sync()   # tools/list
    print(f"\nTools descubiertas: {len(tools)}")
    for t in tools:
        print("\n" + "=" * 70)
        print(f"NOMBRE: {t.tool_name}")
        print(json.dumps(t.tool_spec, indent=2, ensure_ascii=False))
