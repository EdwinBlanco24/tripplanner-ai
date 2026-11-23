"""O5b - Esquema compacto de las tools MCP + volcado completo a JSON."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

base = Path(__file__).parent
load_dotenv(base / ".env.local")
url = os.environ["TRAVEL_MCP_URL"]
key = os.environ["SMITHERY_API_KEY"]

client = MCPClient(lambda: streamablehttp_client(
    url, headers={"Authorization": f"Bearer {key}"}
))


def tipo(p):
    if "type" in p:
        return p["type"]
    if "$ref" in p:
        return "ref:" + p["$ref"].split("/")[-1]
    partes = []
    for x in p.get("anyOf", []):
        partes.append(x.get("type") or ("ref:" + x.get("$ref", "?").split("/")[-1]))
    return "|".join(partes)


def imprimir_props(props, req):
    for name, p in props.items():
        marca = "*" if name in req else " "
        extra = f" enum={p['enum']}" if "enum" in p else ""
        desc = (p.get("description") or "").replace("\n", " ")[:120]
        print(f" {marca} {name:30} {tipo(p):24} default={p.get('default')!r}{extra}")
        if desc:
            print(f"     -> {desc}")


with client:
    tools = client.list_tools_sync()
    todo = [t.tool_spec for t in tools]
    (base / "mcp_tools_full.json").write_text(
        json.dumps(todo, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Tools descubiertas: {len(tools)}")
    for t in tools:
        print(f"  - {t.tool_name}")

    for t in tools:
        if t.tool_name.endswith("search-flight"):
            schema = t.tool_spec["inputSchema"]["json"]
            req = set(schema.get("required", []))
            print(f"\n=== INPUT de {t.tool_name}  (* = obligatorio) ===")
            imprimir_props(schema["properties"], req)
            for dname, d in schema.get("$defs", {}).items():
                print(f"\n--- $defs.{dname} ---")
                imprimir_props(d.get("properties", {}), set(d.get("required", [])))

print("\nEsquema completo guardado en mcp_tools_full.json")
