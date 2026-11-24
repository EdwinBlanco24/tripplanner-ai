import base64
import json
import logging
import os
import queue
import re
from datetime import date, datetime, timedelta, timezone
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
    from business_tools import (
        build_business_tools,
        extract_json_block,
        specialist_text,
        status_for,
        tool_use_started,
    )
except ModuleNotFoundError:
    from app.OrchestratorAgent.sigv4_auth import SigV4Auth
    from app.OrchestratorAgent.business_tools import (
        build_business_tools,
        extract_json_block,
        specialist_text,
        status_for,
        tool_use_started,
    )


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


def _ask_specialist(endpoint: str, request: str) -> str:
    client = create_a2a_client()
    config = ClientConfig(httpx_client=client)

    remote = A2AAgent(
        endpoint=endpoint,
        client_config=config,
    )

    result = remote(request)

    # Texto de TODAS las parts (el especialista transmite cientos de fragmentos). No usar str(result.message):
    # es la repr de un dict y rompe la detección del bloque ```json.
    return specialist_text(result)


def build_specialist_tools(emit_ui) -> list:
    """ask_flights y ask_weather. Si el especialista añade un bloque ```json con
    "flights" / "weather", se emite como evento ui y el texto llega al modelo SIN el bloque."""

    @tool
    def ask_flights(request: str) -> str:
        """Delega en el Flights Agent la búsqueda de vuelos."""

        text = _ask_specialist(FLIGHTS_AGENT_URL, request)
        text, flights = extract_json_block(text, "flights", expect=list)
        if flights:
            emit_ui("flights", {"flights": flights})
        return text

    @tool
    def ask_weather(request: str) -> str:
        """Delega en el Weather Agent la consulta del clima."""

        text = _ask_specialist(WEATHER_AGENT_URL, request)
        text, weather = extract_json_block(text, "weather", expect=(list, dict))
        if weather:
            emit_ui("weather", {"weather": weather})
        return text

    return [ask_flights, ask_weather]


# Colombia no tiene horario de verano: UTC-5 fijo (no depende de tzdata en el runtime).
BOGOTA = timezone(timedelta(hours=-5), "America/Bogota")
WEEKDAYS_ES = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
FORECAST_DAYS = 16  # el pronóstico cubre hoy y los 15 días siguientes
DEFAULT_TRIP_DAYS = 4
MIN_LEAD_DAYS = 7


def today_bogota(now: datetime | None = None) -> date:
    """Fecha de hoy en America/Bogota (el runtime corre en UTC: a las 20:00 de Bogotá ya es mañana allí)."""

    return (now or datetime.now(timezone.utc)).astimezone(BOGOTA).date()


def get_current_date(now: datetime | None = None) -> str:
    """Fecha actual en Bogotá como "YYYY-MM-DD (día de la semana)"; el día lo calcula el código, no el modelo."""

    today = today_bogota(now)
    return f"{today.isoformat()} ({WEEKDAYS_ES[today.weekday()]})"


def suggest_trip_window(today: date, days: int = DEFAULT_TRIP_DAYS) -> tuple[date, date]:
    """Inicio = el jueves más próximo que esté a >= 7 días de hoy; fin = inicio + (días - 1)."""

    earliest = today + timedelta(days=MIN_LEAD_DAYS)
    start = earliest + timedelta(days=(3 - earliest.weekday()) % 7)  # 3 = jueves
    return start, start + timedelta(days=days - 1)


def describe_window(today: date, days: int = DEFAULT_TRIP_DAYS) -> str:
    start, end = suggest_trip_window(today, days)
    inside = end <= today + timedelta(days=FORECAST_DAYS - 1)
    text = (
        f"del {WEEKDAYS_ES[start.weekday()]} {start.isoformat()} al {WEEKDAYS_ES[end.weekday()]} {end.isoformat()} "
        f"({days} días)"
    )
    return text if inside else text + "; OJO: queda fuera del pronóstico, avísalo y ofrece lo que sí hay"


def reference_usd_cop(environ=None) -> str | None:
    """Tasa USD->COP de referencia (REFERENCE_USD_COP) como texto limpio, o None si falta o no es un numero positivo."""
    env = os.environ if environ is None else environ
    raw = str(env.get("REFERENCE_USD_COP", "")).strip()
    try:
        value = float(raw)
    except ValueError:
        return None
    if not (value > 0) or value == float("inf"):
        return None
    return str(int(value)) if value == int(value) else raw


def exchange_rate_rule(rate: str | None) -> str:
    """Texto de la regla de conversion USD->COP que se inserta en el prompt de cada peticion."""
    if rate:
        return (
            f"Para convertir USD a COP usa SIEMPRE la tasa de referencia {rate} COP/USD "
            "y di que es aproximada; no uses otra tasa."
        )
    return (
        "No hay tasa de referencia configurada: NO conviertas entre USD y COP; "
        "muestra cada monto en su moneda original y di que no puedes convertirlo."
    )


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

La fecha actual del sistema (hora de Bogotá) es: {current_date}

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
- Si el clima es de un viaje guardado, pasa al especialista el destino
  COMPLETO tal como está guardado ("Ciudad, País"), sin recortarlo.

Si la solicitud requiere vuelos y clima:
- Utiliza ambos especialistas.
- Consolida sus resultados.
- Presenta una única respuesta clara al usuario.

No inventes información.
Utiliza los resultados proporcionados por los especialistas.

Días de la semana: al presentar clima o itinerarios usa SIEMPRE el campo weekday
de los datos; nunca calcules el día de la semana. Si weekday no viene, no
nombres el día de la semana y muestra solo la fecha.

Planificación sin fechas:

- Si el usuario no da fechas, NO preguntes primero: propón fechas concretas. El
  sistema ya calculó la propuesta por defecto (4 días): {trip_window}. Si pidió
  otra duración, el inicio es el mismo jueves y el fin es inicio + (días - 1).
  Las fechas deben quedar dentro de los 16 días del pronóstico (hoy + 15).
- Dilo explícitamente, por ejemplo "Propongo del jueves X al domingo Y; puedes
  cambiarlas", y en el MISMO turno llama a ask_flights (solo ida, origen a
  destino, con el número de viajeros) y a ask_weather (destino completo
  "Ciudad, País" y esas fechas).
- "Viajo con dos personas más" = 3 viajeros. Si dice "millones de pesos", el
  presupuesto está en COP (5 millones = 5000000).
- Si pide actividades turísticas, menciona brevemente 3 o 4 ideas acordes al
  clima y ofrece crear el viaje y generar el itinerario.
- NO crees el viaje (create_trip) hasta que el usuario lo pida. Mantén las
  reglas de formato breve con interfaz.

Preferencias del usuario:

- Antes de recomendar actividades, generar o modificar un itinerario, o elegir
  entre vuelos, consulta UNA sola vez por conversación las preferencias con la
  tool get_preferences y aplícalas: travelStyles (BEACH playa, CULTURE cultura,
  GASTRONOMY gastronomía, ADVENTURE aventura, NIGHTLIFE vida nocturna, NATURE
  naturaleza) define el tipo de actividades; pace define cuántas actividades por
  día (RELAXED 2, BALANCED 3, INTENSE 4 a 5); flightTime (MORNING, AFTERNOON,
  EVENING; ANY = sin preferencia) prioriza esa franja al elegir vuelos;
  budgetLevel (ECONOMY, STANDARD, PREMIUM) define el tipo de opciones; notes son
  indicaciones libres. Menciona brevemente que las aplicaste ("Como prefieres…").
- Si no hay preferencias guardadas (preferences es null), no inventes ninguna:
  sugiere UNA sola vez configurarlas en "Mis preferencias" y sigue con lo que
  el usuario pidió.
- NO consultes las preferencias para preguntas que no las necesitan (clima suelto,
  listar reservas, ver o borrar un viaje).
- Las preferencias explícitas guardadas prevalecen sobre lo recordado por la
  memoria si se contradicen.

Tasa de cambio:

- {rate_rule}

Formato de respuesta con interfaz:

- Si en este turno se mostró al usuario algún componente (flights, weather,
  trip, trips, itinerary, reservations; es decir, llamaste a ask_flights o
  ask_weather con resultados, o a una tool de negocio con éxito), NO repitas
  esos datos en tablas ni en listas largas. Responde en 2 a 4 frases:
  conclusión, recomendación y siguiente paso propuesto, y menciona la pestaña
  del lienzo donde están los detalles (Vuelos, Clima, Viaje, Itinerario o
  Reservas).
- Incluye siempre los identificadores relevantes (TRP-…, RES-…) cuando crees o
  modifiques algo.
- Usa tablas Markdown solo si el usuario pide explícitamente una comparación y
  no hay componente que la muestre; máximo 4 columnas y cabeceras cortas.
- No uses emojis de banderas (algunos sistemas los muestran como letras, p. ej.
  "BR" o "CO"); escribe el nombre del país.
- Mantén todas las reglas anteriores (weekday de los datos, "Ciudad, País",
  confirmaciones de borrado, reservas SIMULADA, sin datos de tarjeta, UNCERTAIN).

Gestión de viajes, itinerarios y reservas (tools de negocio):

- Cuando el usuario quiera crear o guardar un viaje, usa create_trip con
  título, origen, destino, fechas YYYY-MM-DD, número de viajeros, presupuesto y
  moneda (COP por defecto). Si falta algún dato obligatorio, pídelo antes.
  Guarda origin y destination como "Ciudad, País" con el país en español (p. ej.
  "Cartagena, Colombia"), también al actualizar un viaje con update_trip.
- Para armar el itinerario por días usa create_itinerary (o update_itinerary si
  ya existe), teniendo en cuenta el clima consultado con ask_weather cuando
  esté disponible. Las fechas de los días deben estar dentro del viaje.
- Registra reservas con create_reservation asociadas al tripId del viaje. Son
  SIMULADAS: el estado por defecto es SIMULADA y los tipos son FLIGHT, HOTEL y
  ACTIVITY. Aclara al usuario que no se realiza ningún cobro.
- Para "mis viajes" usa get_trips; para "mis reservas" usa get_reservations; para
  ver un viaje completo usa get_trip.
- Antes de usar delete_trip o delete_reservation pide una confirmación
  explícita al usuario y pasa confirmed=true solo después de que la dé.
- Nunca pidas ni aceptes números de tarjeta, CVV ni otros datos de pago. Si el
  usuario los ofrece, indícale que no son necesarios y que no los envíe.
- Cuando crees un viaje o una reserva, responde siempre con el tripId o el resId
  que devolvió la tool. No inventes identificadores: obtenlos de las tools.
- Si una tool devuelve un error, explícalo con claridad y corrige los datos si
  puedes; no digas que algo se guardó si la tool falló.
- Si una tool de escritura (create_* o update_*) devuelve el error UNCERTAIN, la
  operación pudo haberse completado: ANTES de repetirla consulta con get_trips,
  get_reservations o get_itinerary si el recurso ya existe, y no lo dupliques.
  Si existe, informa al usuario con sus identificadores; si no, reintenta una vez.
- Al crear una reserva FLIGHT a partir de vuelos devueltos por ask_flights,
  copia en details EXACTAMENTE, tal como los devolvió el especialista (sin
  acortar, reformatear ni inventar nada): airline, flightNumber, origin,
  destination, departureTime, arrivalTime y bookingUrl. El precio y la moneda
  del vuelo van en los campos price y currency de la reserva (no dentro de
  details). Omite las claves cuyo valor sea null. Nunca incluyas datos de tarjeta.
"""


def build_agent(
    session_manager: AgentCoreMemorySessionManager,
    user_id: str | None = None,
    emit_ui=None,
) -> Agent:
    """Agente por petición. `user_id` (del JWT) queda capturado en las tools de negocio."""
    now = datetime.now(timezone.utc)
    current_date = get_current_date(now)
    trip_window = describe_window(today_bogota(now))
    rate_rule = exchange_rate_rule(reference_usd_cop())
    if emit_ui is None:
        emit_ui = lambda component, data: None  # noqa: E731

    return Agent(
        name="Trip Planner Orchestrator",
        system_prompt=SYSTEM_PROMPT.format(
            rate_rule=rate_rule,
            current_date=current_date,
            trip_window=trip_window,
        ),
        tools=[
            *build_specialist_tools(emit_ui),
            *build_business_tools(user_id, emit_ui),
        ],
        session_manager=session_manager,
        callback_handler=None,
    )


_SUB_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


def _bearer_token(context) -> str | None:
    """Token Bearer de la cabecera Authorization, si AgentCore la entregó al código.

    El SDK normaliza la clave a "Authorization". Solo llega si el runtime la
    permite en requestHeaderAllowlist.
    """
    headers = getattr(context, "request_headers", None)
    if not isinstance(headers, dict):
        return None
    value = headers.get("Authorization")
    if not isinstance(value, str):
        return None
    scheme, _, token = value.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _jwt_subject(token: str) -> str | None:
    """Claim "sub" del payload del JWT. NO verifica la firma: AgentCore ya la validó (CUSTOM_JWT)."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except ValueError:
        return None
    sub = claims.get("sub") if isinstance(claims, dict) else None
    if isinstance(sub, str) and _SUB_PATTERN.fullmatch(sub):
        return sub
    return None


def _mask(value: str) -> str:
    return value[:8] + "…"


GENERIC_ERROR_MESSAGE = "No pude completar la solicitud. Inténtalo de nuevo en unos momentos."


def _resolve_identity(payload, context) -> tuple[str, str, str, str]:
    """(prompt, actor_id, actor_source, session_id). Lanza ValueError con un mensaje apto para el usuario."""
    prompt = payload.get("prompt", "")

    if not isinstance(prompt, str):
        raise ValueError("prompt debe ser un string")

    if not prompt.strip():
        raise ValueError("El mensaje no puede estar vacío")

    token = _bearer_token(context)
    if token is not None:
        # Con JWT validado por AgentCore, la identidad sale SOLO del token:
        # cualquier actor_id del payload se ignora.
        actor_id = _jwt_subject(token)
        actor_source = "jwt"
        if actor_id is None:
            raise ValueError("El token de autorización no contiene un usuario válido")
    else:
        # Desarrollo local (agentcore dev): sin JWT se conserva la lógica anterior.
        actor_id = payload.get("actor_id", "")
        actor_source = "payload"
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
        "invoke actor=%s actor_source=%s session_id=%s",
        _mask(actor_id.strip()),
        actor_source,
        session_id,
    )

    return prompt, actor_id.strip(), actor_source, session_id


def _drain(ui_queue: "queue.SimpleQueue") -> list[dict]:
    events = []
    while True:
        try:
            events.append(ui_queue.get_nowait())
        except queue.Empty:
            return events


@app.entrypoint
async def invoke(payload, context):
    """Stream TIPADO: cada yield es un dict {"type": status|text|ui|error|done, ...}."""
    try:
        prompt, actor_id, actor_source, session_id = _resolve_identity(payload, context)
    except ValueError as exc:
        # Mensajes de validación propios (sin datos internos): se entregan como evento tipado.
        logger.warning("invoke rechazado: %s", exc)
        yield {"type": "error", "message": str(exc)}
        yield {"type": "done"}
        return

    # Las tools de negocio solo reciben usuario cuando la identidad viene de un JWT validado:
    # con DEFAULT_ACTOR_ID o actor_id del payload (desarrollo local) no se toca la base real.
    user_id = actor_id if actor_source == "jwt" else None

    ui_queue: "queue.SimpleQueue" = queue.SimpleQueue()

    def emit_ui(component: str, data) -> None:
        ui_queue.put({"type": "ui", "component": component, "data": data})

    session_manager = None
    announced: set[str] = set()
    failed = False
    try:
        try:
            session_manager = create_memory_session_manager(
                session_id=session_id,
                actor_id=actor_id,
            )
            agent = build_agent(session_manager, user_id=user_id, emit_ui=emit_ui)

            async for event in agent.stream_async(prompt):
                started = tool_use_started(event)
                if started is not None and started[0] not in announced:
                    announced.add(started[0])
                    agent_name, message = status_for(started[1])
                    yield {"type": "status", "agent": agent_name, "message": message}

                if isinstance(event, dict) and isinstance(event.get("data"), str) and event["data"]:
                    yield {"type": "text", "delta": event["data"]}

                for ui_event in _drain(ui_queue):
                    yield ui_event
        except Exception as exc:  # noqa: BLE001 - nunca se exponen detalles internos al cliente
            failed = True
            logger.error("stream_failed error=%s", type(exc).__name__, exc_info=True)

        for ui_event in _drain(ui_queue):
            yield ui_event
        if failed:
            yield {"type": "error", "message": GENERIC_ERROR_MESSAGE}
        yield {"type": "done"}
    finally:
        if session_manager is not None:
            session_manager.close()


if __name__ == "__main__":
    app.run()