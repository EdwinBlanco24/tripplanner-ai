"""Prueba S3c (Parte B): WeatherMcpServer local contra Open-Meteo REAL.

Arranca app/WeatherMcpServer/main.py en un subproceso (puerto libre, FASTMCP_PORT), se conecta con MCPClient
por Streamable HTTP a http://127.0.0.1:PORT/mcp (como lo hara AgentCore, sin SigV4 en local), lista las tools
y llama get_forecast (Cartagena, hoy+3 a hoy+6) y get_current_weather. Despues construye el bloque ```json
del WeatherAgent con ese resultado real y lo imprime. Al terminar cierra el servidor.

    python s3c_weather_mcp_local_test.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from datetime import date, timedelta

from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "WeatherMcpServer"))
AGENT_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "WeatherAgent"))
sys.path.insert(0, AGENT_DIR)
import weather_blocks  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_port(port: int, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.3)
    return False


def main() -> int:
    port = free_port()
    env = dict(os.environ, MCP_PORT=str(port))
    # El log del servidor va a un archivo temporal: con una tuberia sin leer (4 KB en Windows) el servidor se bloquea al escribir.
    server_log = tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace")
    command = [sys.executable, "-u", "main.py"]
    if os.environ.get("S3C_OTEL") == "1":
        # Mismo arranque que AgentCore (entryPoint = ['opentelemetry-instrument', 'main.py']).
        exe = os.path.join(os.path.dirname(sys.executable), "opentelemetry-instrument.exe" if os.name == "nt" else "opentelemetry-instrument")
        if not os.path.exists(exe):
            print("FALTA el ejecutable opentelemetry-instrument:", exe)
            return 3
        command = [exe, sys.executable, "-u", "main.py"]
        print("Arranque con OpenTelemetry:", os.path.basename(exe), "python -u main.py")
    proc = subprocess.Popen(command, cwd=SERVER_DIR, env=env,
                            stdout=server_log, stderr=subprocess.STDOUT)
    try:
        if not wait_port(port):
            server_log.seek(0)
            print("El servidor no arranco. Salida:\n", server_log.read())
            return 1
        print(f"Servidor MCP arriba en 127.0.0.1:{port}")
        url = f"http://127.0.0.1:{port}/mcp"
        client = MCPClient(lambda: streamablehttp_client(url))
        with client:
            tools = client.list_tools_sync()
            print("tools/list ->", [t.tool_name for t in tools])
            for t in tools:
                print("  schema", t.tool_name, json.dumps(t.mcp_tool.inputSchema, ensure_ascii=False))

            today = date.today()
            args = {"city": "Cartagena", "start_date": (today + timedelta(days=3)).isoformat(),
                    "end_date": (today + timedelta(days=6)).isoformat(), "country_code": "CO"}
            res = client.call_tool_sync("t1", "get_forecast", args)
            print("\nget_forecast status:", res.get("status"))
            data = weather_blocks.parse_tool_result(res)
            print(json.dumps(data, ensure_ascii=False, indent=1))

            res2 = client.call_tool_sync("t2", "get_current_weather", {"city": "Cartagena", "country_code": "CO"})
            print("\nget_current_weather status:", res2.get("status"))
            print(json.dumps(weather_blocks.parse_tool_result(res2), ensure_ascii=False, indent=1))

            bad = client.call_tool_sync("t3", "get_forecast", {"city": "Cartagena", "start_date": "2020-01-01", "end_date": "2020-01-02"},
                                        read_timeout_seconds=timedelta(seconds=20))
            print("\nfecha pasada -> status:", bad.get("status"), "|", (bad.get("content") or [{}])[0].get("text"))
            nocity = client.call_tool_sync("t4", "get_current_weather", {"city": "Zzzxqwvk Ciudadinexistente"},
                                           read_timeout_seconds=timedelta(seconds=20))
            print("ciudad inexistente -> status:", nocity.get("status"), "|", (nocity.get("content") or [{}])[0].get("text"))

        block = weather_blocks.build_weather_block(weather_blocks.normalize_forecast(data))
        print("\nBloque que anexaria WeatherAgent:" + block)
        return 0 if res.get("status") == "success" and res2.get("status") == "success" else 2
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("\nServidor detenido.")


if __name__ == "__main__":
    raise SystemExit(main())

