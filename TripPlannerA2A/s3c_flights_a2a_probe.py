"""Sonda S3c (Parte D): llama al FlightsAgent DESPLEGADO por A2A (SigV4) y vuelca la respuesta cruda.

Reutiliza el mismo cliente que el Orchestrator (create_a2a_client / SigV4Auth). Perfil agentic-workshop, us-east-2.
Escribe s3c-flights-a2a-raw-response.json (ignorado por .gitignore) e imprime la estructura y el diagnostico.

    python s3c_flights_a2a_probe.py [--prompt "..."]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys

os.environ.setdefault("AWS_PROFILE", "agentic-workshop")
os.environ.setdefault("AWS_REGION", "us-east-2")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-2")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "app", "OrchestratorAgent")))

import main as orchestrator  # noqa: E402
from a2a.client import ClientConfig  # noqa: E402
from strands.agent.a2a_agent import A2AAgent  # noqa: E402

DEFAULT_PROMPT = "Busca vuelos de Bogotá a Cartagena el 4 de diciembre de 2026 por la mañana para 3 personas"
OUTPUT = os.path.join(HERE, "s3c-flights-a2a-raw-response.json")
FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)\s*```", re.DOTALL)


def dump(obj):
    """Objeto A2A (pydantic) -> JSON."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=True)
    return repr(obj)


def part_summary(part) -> dict:
    root = getattr(part, "root", part)
    text = getattr(root, "text", None)
    return {"kind": getattr(root, "kind", type(root).__name__), "text_len": len(text) if isinstance(text, str) else None,
            "has_fence": bool(isinstance(text, str) and "```" in text), "has_flights_key": bool(isinstance(text, str) and '"flights"' in text)}


async def collect(prompt: str) -> dict:
    client = orchestrator.create_a2a_client()
    remote = A2AAgent(endpoint=orchestrator.FLIGHTS_AGENT_URL, client_config=ClientConfig(httpx_client=client))
    raw_events, result, last_task = [], None, None
    async for event in remote.stream_async(prompt):
        if "result" in event:
            result = event["result"]
            continue
        a2a = event.get("event")
        if isinstance(a2a, tuple):
            task, update = a2a
            last_task = task
            kind = type(update).__name__ if update is not None else "Task(inicial)"
            entry = {"kind": kind, "update": dump(update) if update is not None else None}
        else:
            entry = {"kind": type(a2a).__name__, "message": dump(a2a)}
        raw_events.append(entry)
    await client.aclose()
    return {"events": raw_events, "final_task": dump(last_task) if last_task is not None else None, "result": result}


def all_texts(raw: dict) -> list[tuple[str, str]]:
    """(origen, texto) de cada part de texto presente en eventos y en el task final."""
    found = []
    for i, ev in enumerate(raw["events"]):
        upd = ev.get("update") or ev.get("message") or {}
        for part in (upd.get("artifact", {}) or {}).get("parts", []) or []:
            found.append((f"evento[{i}].artifact", part.get("text", "")))
        for part in ((upd.get("status", {}) or {}).get("message", {}) or {}).get("parts", []) or []:
            found.append((f"evento[{i}].status.message", part.get("text", "")))
        for part in upd.get("parts", []) or []:
            found.append((f"evento[{i}].message", part.get("text", "")))
    task = raw.get("final_task") or {}
    for a, art in enumerate(task.get("artifacts", []) or []):
        for p, part in enumerate(art.get("parts", []) or []):
            found.append((f"final_task.artifacts[{a}].parts[{p}]", part.get("text", "")))
    return found


def flights_blocks(text: str):
    out = []
    for m in FENCE.finditer(text or ""):
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(obj, dict) and "flights" in obj:
            out.append(obj)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    args = parser.parse_args()
    print(f"Llamando a FlightsAgent: {orchestrator.FLIGHTS_AGENT_URL[-60:]}")
    raw = asyncio.run(collect(args.prompt))
    result = raw.pop("result")

    message = result.message if result is not None else None
    content = (message or {}).get("content", [])
    repr_text = str(message)              # lo que hace hoy _ask_specialist
    plain_text = "".join(b.get("text", "") for b in content if isinstance(b, dict))

    saved = dict(raw, result_message=message, str_result_message=repr_text, plain_text_of_content_blocks=plain_text,
                 stop_reason=getattr(result, "stop_reason", None), state=getattr(result, "state", None))
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(saved, handle, ensure_ascii=False, indent=2, default=str)

    print("\n=== Estructura de la respuesta A2A ===")
    kinds = [e["kind"] for e in raw["events"]]
    print("eventos:", len(kinds), "| tipos:", {k: kinds.count(k) for k in dict.fromkeys(kinds)})
    states = [((e.get("update") or {}).get("status") or {}).get("state") for e in raw["events"]]
    print("estados de tarea:", [s for s in states if s])
    for i, e in enumerate(raw["events"]):
        upd = e.get("update") or {}
        art = upd.get("artifact")
        if art:
            print(f"  evento[{i}] artifact id={art.get('artifactId')} nombre={art.get('name')} append={upd.get('append')} "
                  f"last_chunk={upd.get('lastChunk')} parts={[part_summary(type('P', (), {'root': type('R', (), p)()}))['kind'] for p in art.get('parts', [])]}")
    task = raw.get("final_task") or {}
    print("final_task.artifacts:", [(a.get("name"), [(p.get("kind"), len(p.get("text", ""))) for p in a.get("parts", [])]) for a in task.get("artifacts", []) or []])
    print("result.message bloques:", [(list(b.keys()), len(b.get("text", ""))) for b in content if isinstance(b, dict)])
    print("stop_reason:", getattr(result, "stop_reason", None), "| state:", getattr(result, "state", None))

    print("\n=== ¿Existe un bloque ```json con \"flights\"? ===")
    for origin, text in all_texts(raw):
        blocks = flights_blocks(text)
        print(f"  {origin}: len={len(text)} fence={'```' in text} flights_key={chr(34) + 'flights' + chr(34) in text} bloques_validos={len(blocks)}")
    print("  texto plano (concatenando los bloques de content):", "bloques_validos=", len(flights_blocks(plain_text)))
    print("  str(result.message) -> lo que lee _ask_specialist hoy: bloques_validos=", len(flights_blocks(repr_text)),
          "| empieza por:", repr_text[:60].replace("\n", " "))

    print("\n=== Lo que hace hoy el Orchestrator con ese texto ===")
    cleaned, extracted = orchestrator.extract_json_block(repr_text, "flights", expect=list)
    print("extract_json_block(str(result.message)) ->", "None" if extracted is None else f"{len(extracted)} vuelos", "| texto cambia:", cleaned != repr_text)
    print("longitud de str(result.message):", len(repr_text), "| contiene '\\\\n' literal:", "\\n" in repr_text)
    print(f"\nRespuesta cruda guardada en: {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
