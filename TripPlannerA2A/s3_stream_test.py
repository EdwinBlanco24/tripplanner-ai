"""Prueba manual del stream tipado del OrchestratorAgent (sprint S3b). No se ejecuta en el sprint.

Pide correo y contrasena (getpass), obtiene el access token de Cognito, invoca el Orchestrator
desplegado con Authorization: Bearer y muestra cada evento del stream en una linea legible.
No imprime tokens ni contrasenas.

Uso:
    python s3_stream_test.py --prompt "Quiero ir de Bogota a Cartagena el 4 de diciembre"
    python s3_stream_test.py --prompt "Guardalo como viaje" --session-id s3-test-<uuid>   # continuar sesion
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3
from botocore import UNSIGNED
from botocore.config import Config

REGION = "us-east-2"
CLIENT_ID = "27ri7q3j4etl4nm5ht6oki040r"
RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-2:458934380591:runtime/TripPlannerA2A_OrchestratorAgent-j62sZ9EWux"
URL = (
    f"https://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/"
    f"{urllib.parse.quote(RUNTIME_ARN, safe='')}/invocations?qualifier=DEFAULT"
)


def get_access_token(email: str, password: str) -> str:
    # InitiateAuth es una API publica de Cognito: no necesita credenciales de AWS.
    cognito = boto3.client("cognito-idp", region_name=REGION, config=Config(signature_version=UNSIGNED))
    response = cognito.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=CLIENT_ID,
        AuthParameters={"USERNAME": email, "PASSWORD": password},
    )
    result = response.get("AuthenticationResult")
    if not result:
        raise SystemExit(f"Cognito pidio un paso adicional ({response.get('ChallengeName')}), no soportado aqui.")
    return result["AccessToken"]


def iter_sse_data(response):
    """Itera los valores 'data:' de un stream SSE (un evento por bloque separado por linea en blanco)."""
    lines: list[str] = []
    for raw in response:
        line = raw.decode("utf-8").rstrip("\r\n")
        if line == "":
            if lines:
                yield "\n".join(lines)
                lines = []
        elif line.startswith("data:"):
            lines.append(line[5:].lstrip(" "))
    if lines:
        yield "\n".join(lines)


def describe(event) -> str | None:
    """Linea legible para un evento tipado; None si es texto (se acumula)."""
    kind = event.get("type") if isinstance(event, dict) else None
    if kind == "status":
        return f"[status:{event.get('agent')}] {event.get('message')}"
    if kind == "ui":
        component, data = event.get("component"), event.get("data")
        if component == "flights":
            return f"[ui:flights] {len((data or {}).get('flights', []))} elementos"
        if component == "trip":
            trip = (data or {}).get("trip") or {}
            extra = ""
            if isinstance(data, dict) and "reservations" in data:
                extra = f", reservas={len(data['reservations'])}, itinerario={'si' if data.get('itinerary') else 'no'}"
            return f"[ui:trip] tripId={trip.get('tripId')} titulo={trip.get('title')!r}{extra}"
        if component == "trips":
            return f"[ui:trips] {len((data or {}).get('trips', []))} viajes"
        if component == "itinerary":
            return f"[ui:itinerary] tripId={(data or {}).get('tripId')} dias={len((data or {}).get('days', []))}"
        if component == "reservations":
            items = (data or {}).get("reservations", [])
            ids = ", ".join(r.get("resId", "?") for r in items[:5])
            return f"[ui:reservations] change={(data or {}).get('change')} n={len(items)} {ids}".rstrip()
        if component == "weather":
            return f"[ui:weather] {type((data or {}).get('weather')).__name__}"
        if component == "preferences":
            return f"[ui:preferences] {sorted(((data or {}).get('preferences') or {}).keys())}"
        return f"[ui:{component}]"
    if kind == "error":
        return f"[error] {event.get('message')}"
    if kind == "done":
        return "[done]"
    if kind == "text":
        return None
    return f"[desconocido] {json.dumps(event, ensure_ascii=False)[:200]}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Prueba del stream tipado del Orchestrator")
    parser.add_argument("--prompt", required=True, help="Mensaje para el agente")
    parser.add_argument("--session-id", help="Sesion a continuar (por defecto, una nueva s3-test-<uuid>)")
    args = parser.parse_args()

    email = input("Correo: ").strip()
    password = getpass.getpass("Contrasena: ")
    token = get_access_token(email, password)
    del password

    session_id = args.session_id or f"s3-test-{uuid.uuid4()}"
    if len(session_id) < 33:
        raise SystemExit("El session-id debe tener al menos 33 caracteres.")
    print(f"Sesion: {session_id}")

    request = urllib.request.Request(
        URL,
        data=json.dumps({"prompt": args.prompt}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
    )
    text: list[str] = []
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            print(f"HTTP {response.status} · {response.headers.get('Content-Type')}")
            for data in iter_sse_data(response):
                try:
                    event = json.loads(data)
                except ValueError:
                    print(f"[sin JSON] {data[:200]}")
                    continue
                if isinstance(event, dict) and event.get("type") == "text":
                    text.append(str(event.get("delta", "")))
                    continue
                line = describe(event)
                if line:
                    print(line)
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code} {exc.reason}")
        print(exc.read(2000).decode("utf-8", "replace"))
        return 1
    except urllib.error.URLError as exc:
        print(f"No se pudo conectar: {exc.reason}")
        return 1

    print("\n--- Texto acumulado ---")
    print("".join(text) or "(sin texto)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
