import logging
import os
from datetime import datetime
from uuid import uuid4

import httpx
from a2a.client import ClientConfig
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from strands import Agent, tool
from strands.agent.a2a_agent import A2AAgent

try:
    from sigv4_auth import SigV4Auth
except ModuleNotFoundError:
    from app.OrchestratorAgent.sigv4_auth import SigV4Auth


logger = logging.getLogger("orchestrator_agent")
logger.setLevel(logging.INFO)
if not logging.getLogger().handlers and not logger.handlers:
    logger.addHandler(logging.StreamHandler())



class _AsyncModeNoticeFilter(logging.Filter):
    """Oculta solo el aviso informativo de async_mode del SessionManager.

    Este agente siempre se invoca por la ruta async (stream_async), así que
    el aviso no corresponde a un problema real.
    """

    _NOTICE = "AgentCoreMemorySessionManager async_mode=True: the agent must be invoked"

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.getMessage().startswith(self._NOTICE)


logging.getLogger(
    "bedrock_agentcore.memory.integrations.strands.session_manager"
).addFilter(_AsyncModeNoticeFilter())

app = BedrockAgentCoreApp()

TRIP_MEMORY_ID = os.getenv("MEMORY_TRIPPLANNERMEMORY_ID")


FLIGHTS_AGENT_URL = (
    "https://bedrock-agentcore.us-east-2.amazonaws.com/"
    "runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-2%3A458934380591"
    "%3Aruntime%2FTripPlannerA2A_FlightsAgent-5W5efEFbNx/invocations/"
)

WEATHER_AGENT_URL = (
    "https://bedrock-agentcore.us-east-2.amazonaws.com/"
    "runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-2%3A458934380591"
    "%3Aruntime%2FTripPlannerA2A_WeatherAgent-CvtJPlH0zR/invocations/"
)


def create_a2a_client() -> httpx.AsyncClient:
    session_id = str(uuid4())

    return httpx.AsyncClient(
        auth=SigV4Auth(
            service="bedrock-agentcore",
            region="us-east-2",
        ),
        headers={
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
        timeout=300,
    )


@tool
def ask_flights(request: str) -> str:
    """Delega en el Flights Agent la búsqueda de vuelos."""

    client = create_a2a_client()
    config = ClientConfig(httpx_client=client)

    remote = A2AAgent(
        endpoint=FLIGHTS_AGENT_URL,
        client_config=config,
    )

    result = remote(request)

    return str(result.message)


@tool
def ask_weather(request: str) -> str:
    """Delega en el Weather Agent la consulta del clima."""

    client = create_a2a_client()
    config = ClientConfig(httpx_client=client)

    remote = A2AAgent(
        endpoint=WEATHER_AGENT_URL,
        client_config=config,
    )

    result = remote(request)

    return str(result.message)


def get_current_date() -> str:
    """Obtiene la fecha actual del sistema en formato YYYY-MM-DD."""

    return datetime.now().date().isoformat()


def create_memory_session_manager(
    session_id: str,
    actor_id: str,
) -> AgentCoreMemorySessionManager:
    """Crea el SessionManager conectado a AgentCore Memory."""

    if not TRIP_MEMORY_ID:
        raise RuntimeError(
            "No está definida la variable de entorno "
            "MEMORY_TRIPPLANNERMEMORY_ID"
        )

    retrieval_config = {
        f"/preferences/{actor_id}/": RetrievalConfig(
            top_k=5,
            relevance_score=0.2,
        ),
        f"/summaries/{actor_id}/{session_id}/": RetrievalConfig(
            top_k=5,
            relevance_score=0.2,
        ),
        f"/facts/{actor_id}/": RetrievalConfig(
            top_k=5,
            relevance_score=0.2,
        ),
    }

    config = AgentCoreMemoryConfig(
        memory_id=TRIP_MEMORY_ID,
        session_id=session_id,
        actor_id=actor_id,
        retrieval_config=retrieval_config,
        async_mode=True,
    )

    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name="us-east-2",
    )


SYSTEM_PROMPT = """
Eres un planificador de viajes y coordinador de especialistas mediante A2A.

La fecha actual del sistema es: {current_date}

Reglas obligatorias para las fechas:

- Nunca solicites vuelos o clima para una fecha anterior a la fecha actual.
- Cuando el usuario utilice expresiones relativas como:
  "hoy", "mañana", "este fin de semana",
  "el próximo fin de semana", "la próxima semana"
  u otras similares, debes interpretarlas tomando
  como referencia la fecha actual del sistema.
- Para solicitudes futuras, utiliza fechas concretas en formato
  YYYY-MM-DD al invocar a los especialistas.
- No inventes años ni utilices fechas históricas cuando el usuario
  está solicitando una fecha futura.
- Si una fecha solicitada por el usuario ya pasó, solicita una
  aclaración o utiliza una fecha futura solamente si la expresión
  utilizada por el usuario es relativa y permite determinarla.

Cuando el usuario solicite información sobre vuelos:
- Utiliza ask_flights.

Cuando el usuario solicite información sobre clima:
- Utiliza ask_weather.

Si la solicitud requiere vuelos y clima:
- Utiliza ambos especialistas.
- Consolida sus resultados.
- Presenta una única respuesta clara al usuario.

No inventes información.
Utiliza los resultados proporcionados por los especialistas.
"""


def build_agent(
    session_manager: AgentCoreMemorySessionManager,
) -> Agent:
    current_date = get_current_date()

    return Agent(
        name="Trip Planner Orchestrator",
        system_prompt=SYSTEM_PROMPT.format(
            current_date=current_date
        ),
        tools=[
            ask_flights,
            ask_weather,
        ],
        session_manager=session_manager,
        callback_handler=None,
    )


@app.entrypoint
async def invoke(payload, context):
    prompt = payload.get("prompt", "")
    actor_id = payload.get("actor_id", "")
    actor_source = "payload"

    if not isinstance(prompt, str):
        raise ValueError("prompt debe ser un string")

    if not isinstance(actor_id, str) or not actor_id.strip():
        actor_id = os.environ.get("DEFAULT_ACTOR_ID", "").strip()
        actor_source = "DEFAULT_ACTOR_ID"

    if not actor_id:
        raise ValueError("actor_id debe ser un string no vacío")

    session_id = getattr(context, "session_id", None)

    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError(
            "No se recibió un session_id válido desde AgentCore"
        )

    logger.info(
        "invoke actor_id=%s actor_source=%s session_id=%s",
        actor_id.strip(),
        actor_source,
        session_id,
    )

    session_manager = create_memory_session_manager(
        session_id=session_id,
        actor_id=actor_id.strip(),
    )

    agent = build_agent(
        session_manager=session_manager,
    )

    try:
        async for event in agent.stream_async(prompt):
            if isinstance(event, dict) and isinstance(event.get("data"), str):
                yield event["data"]
    finally:
        session_manager.close()


if __name__ == "__main__":
    app.run()