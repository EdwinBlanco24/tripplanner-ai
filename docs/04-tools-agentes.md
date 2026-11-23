# TripPlanner AI — Tools de los agentes y contrato del stream (Canal 2)

## 1. Ciclo de una petición agéntica

```text
Usuario ─► Frontend ─► [HTTP streaming + JWT] ─► OrchestratorAgent
                                                      │ 1. AgentCore valida el JWT (CUSTOM_JWT)
                                                      │ 2. El código extrae userId = claim "sub" (nunca el LLM)
                                                      │ 3. El LLM elige: especialista A2A o Tool de negocio
                                                      ├─► ask_flights / ask_weather ─► FlightsAgent / WeatherAgent (SigV4)
                                                      └─► Tool ─► lambda:InvokeFunction ─► Lambda ─► DynamoDB
                                                      │ 4. La Lambda responde {ok, data|error}
                                                      │ 5. El Orchestrator redacta la respuesta y emite eventos
Frontend ◄── eventos JSON (text · status · ui · done) ◄┘
```

Reglas del ciclo:

1. **`userId` fuera del alcance del LLM.** Las tools no declaran ese parámetro. Cada tool se construye por petición con el `userId` ya extraído del token (cierre de variable o `ToolContext`) y lo añade al evento que envía a la Lambda.
2. **Las Lambdas son la autoridad.** Validan todo otra vez (ADR-02); un parámetro mal formado del LLM produce un error estructurado que el modelo puede corregir.
3. **Confirmación de acciones destructivas.** `delete_trip` y `delete_reservation` exigen `confirmed=true`; el *system prompt* obliga al modelo a pedir confirmación explícita al usuario antes de enviarlo. Sin `confirmed=true` la tool devuelve un error sin invocar la Lambda.
4. **Identificadores.** El modelo nunca inventa `tripId`/`resId`: los obtiene de `get_trips` / `get_reservations` o de resultados previos. La Lambda responde `NOT_FOUND` si no existen.
5. **Resultados no confiables.** Textos de MCP o de reservas son datos, no instrucciones.

## 2. Contrato de invocación Orchestrator → Lambda

Evento (invocación síncrona `RequestResponse`):

```json
{ "source": "agent", "action": "create_trip", "userId": "<sub>", "payload": { "...": "..." } }
```

Respuesta de la Lambda:

```json
{ "ok": true,  "data": { "...": "..." } }
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Los códigos de error son los de `03-api.md` (sin el HTTP). Las Lambdas no lanzan excepciones al agente por errores de negocio. Una excepción de infraestructura (`FunctionError`) se traduce en la tool a `{"ok": false, "error": {"code": "INTERNAL_ERROR", ...}}`. Las tools registran en CloudWatch `action`, latencia y resultado, sin `userId` en claro.

## 3. Tools del OrchestratorAgent

Los nombres de las tools son `snake_case` (Bedrock solo admite `[a-zA-Z0-9_-]+`). La columna **Guía** conserva el nombre del enunciado.

| Tool | Guía | Propósito | Parámetros (sin `userId`) | Lambda · `action` |
|---|---|---|---|---|
| `create_trip` | CreateTrip | Crea un viaje a partir de lo hablado | `title`, `origin`, `destination`, `start_date`, `end_date`, `travelers`, `budget`, `currency`, `notes?` | Trips · `create_trip` |
| `get_trips` | GetTrips | Lista los viajes o devuelve uno con itinerario y reservas | `trip_id?` | Trips · `get_trips` (sin `trip_id`) / `get_trip` (con `trip_id`) |
| `update_trip` | UpdateTrip | Cambia campos de un viaje (incluye cancelar con `status`) | `trip_id`, y cualquiera de: `title`, `origin`, `destination`, `start_date`, `end_date`, `travelers`, `budget`, `currency`, `notes`, `status` | Trips · `update_trip` |
| `delete_trip` | (extra) | Borra un viaje con su itinerario y reservas | `trip_id`, `confirmed` | Trips · `delete_trip` |
| `create_itinerary` | CreateItinerary | Crea el itinerario día a día | `trip_id`, `days[]` (`date`, `weather?`, `items[]`) | Itineraries · `create_itinerary` |
| `update_itinerary` | UpdateItinerary | Reemplaza el itinerario con la versión corregida | `trip_id`, `days[]` | Itineraries · `update_itinerary` |
| `create_reservation` | CreateReservation | Registra una reserva **simulada** (vuelo, hotel o actividad) | `trip_id`, `type`, `provider`, `details`, `price`, `currency`, `status?` | Reservations · `create_reservation` |
| `get_reservations` | GetReservations | Lista reservas del usuario o de un viaje | `trip_id?` | Reservations · `get_reservations` |
| `update_reservation` | UpdateReservation | Cambia estado, proveedor, detalles o precio | `trip_id`, `res_id`, y cualquiera de: `status`, `provider`, `details`, `price`, `currency` | Reservations · `update_reservation` |
| `delete_reservation` | (extra) | Elimina una reserva | `trip_id`, `res_id`, `confirmed` | Reservations · `delete_reservation` |

Notas:

- Las tools usan `snake_case` en los parámetros; la tool traduce a `camelCase` en el `payload` (`start_date` → `startDate`).
- `get_trips` unifica listado y detalle para no inflar el número de tools que el modelo debe distinguir.
- Las preferencias (`GET/PUT /preferences`) **no** son tools en esta fase: el usuario las edita en pantalla y AgentCore Memory aporta las inferidas (ADR-06). Si el sprint S3 lo justifica se añadirán `get_preferences` y `update_preferences` con la misma convención.
- Con `createdBy`: toda escritura hecha por una tool lleva `createdBy: "assistant"`.
- Especialistas (ya existentes): `ask_flights(request)` y `ask_weather(request)` por A2A con SigV4. FlightsAgent solo expone `kiwi_search_flight` (lista blanca). El MCP de clima se define en S3.

### 3.1 Acciones de las Lambdas (evento `source: "agent"`)

Los nombres **canónicos** de acción están en `snake_case` y coinciden con los de las tools:

| Lambda | Acciones |
|---|---|
| Trips | `create_trip`, `get_trips`, `get_trip`, `update_trip`, `delete_trip` |
| Itineraries | `create_itinerary`, `get_itinerary`, `update_itinerary` |
| Reservations | `create_reservation`, `get_reservations`, `get_reservation`, `update_reservation`, `delete_reservation` |
| Preferences | `get_preferences`, `update_preferences` (reservadas para uso futuro) |

**Alias.** Las Lambdas también aceptan los nombres camelCase del diseño inicial (`createTrip`, `listTrips`, `getTrip`, `updateTrip`, `deleteTrip`, `createItinerary`, `getItinerary`, `updateItinerary`, `createReservation`, `listReservations`, `getReservation`, `updateReservation`, `deleteReservation`, `getPreferences`, `updatePreferences`) y los traducen al nombre canónico. El código nuevo debe usar siempre `snake_case`.

`get_itinerary` y `get_reservation` existen en las Lambdas por simetría con la API, aunque ninguna tool las expone todavía (el detalle completo sale de `get_trips` con `trip_id`).

**Respuesta de la Lambda al agente** (no es el formato de API Gateway): `{"ok": true, "statusCode": 200, "data": {...}}` o `{"ok": false, "statusCode": 400, "error": {"code", "message", "details"?}}`. Los `delete_*` exigen `payload.confirmed == true` y responden `statusCode` 200 con `data` (`deleted`, ids y, en viajes, `deletedItems`).

### 3.2 Permisos

El rol del runtime del OrchestratorAgent recibe una política por archivo (`additionalPolicies` en `agentcore.json`) con `lambda:InvokeFunction` **solo** sobre los ARN de las cuatro funciones. Los ARN se pasan como variables de entorno (`TRIPS_FUNCTION_ARN`, `ITINERARIES_FUNCTION_ARN`, `RESERVATIONS_FUNCTION_ARN`, `PREFERENCES_FUNCTION_ARN`).

## 4. Contrato del stream hacia el frontend

Cada evento es **un objeto JSON**. Por el transporte de AgentCore llegan como líneas `data: {json}` (SSE) o una línea JSON por evento; el cliente tolera ambos y descarta líneas vacías o de comentario. El contrato de los objetos es el mismo en cualquier caso y no cambia si se usa el plan B del proxy (ADR-07).

| Evento | Forma | Cuándo |
|---|---|---|
| Texto | `{"type":"text","delta":"Encontré 3 opciones…"}` | Fragmento incremental de la respuesta del modelo. El cliente concatena `delta`. |
| Estado | `{"type":"status","agent":"flights","message":"Buscando vuelos BOG → CTG…"}` | Al iniciar una acción larga. `agent` ∈ `orchestrator`, `flights`, `weather`, `trips`, `itinerary`, `reservations`. |
| Interfaz | `{"type":"ui","component":"flights","data":{…}}` | Datos estructurados para renderizar un componente. `component` ∈ `flights`, `weather`, `itinerary`, `trip`, `reservations`. |
| Fin | `{"type":"done"}` | Siempre es el último evento de una respuesta correcta. |

Propuesta adicional (no estaba en el enunciado, **a aprobar**): `{"type":"error","code":"AGENT_ERROR","message":"…"}` seguido de `{"type":"done"}`, para que el frontend distinga un fallo de una respuesta vacía. Sin ella, un error solo se vería como un corte del stream.

Reglas del cliente: ignorar `type` o `component` desconocidos (compatibilidad hacia adelante); no mostrar `ui` si `data` no cumple el esquema; tratar el cierre del stream sin `done` como error.

### 4.1 Forma de `data` por componente

| `component` | `data` | Origen |
|---|---|---|
| `flights` | `{"query":{"origin","destination","date"},"options":[{"airline","flightNumber","departureTime","arrivalTime","stops","price","currency","bookingUrl"}]}` | Resultado de FlightsAgent (hasta 5 opciones) |
| `weather` | `{"location","days":[{"date","tempMax","tempMin","condition","rainProbability"}]}` | Resultado de WeatherAgent |
| `itinerary` | `{"tripId","days":[…]}` (estructura de `02-modelo-datos.md`) | `create_itinerary` / `update_itinerary` / `get_trips` |
| `trip` | `{"trip":{…}}` | `create_trip` / `update_trip` / `get_trips` con `trip_id` |
| `reservations` | `{"tripId"?,"reservations":[{…}]}` | `create_reservation` / `get_reservations` / `update_reservation` |

### 4.2 Cómo se generan

- `text`: se traduce de los eventos de texto de `stream_async` de Strands. Hoy el Orchestrator ya emite solo el texto incremental.
- `status`: lo emite el código cuando el modelo inicia una tool (`ask_flights`, `ask_weather` o una tool de negocio).
- `ui`: lo emite el código **después** de una tool con `ok: true`, a partir de su resultado. El modelo no puede fabricar eventos `ui`.
- Para `flights` y `weather` se requiere que los especialistas devuelvan datos estructurados además del texto; hoy FlightsAgent responde texto sobrio. Esto es una decisión pendiente de S3 (ver `01-arquitectura.md`, supuesto 4).
- Tras una escritura por chat (p. ej. `create_trip`), el frontend refresca sus listas del canal 1 al recibir el `ui` correspondiente o `done`.

### 4.3 Ejemplo

```text
{"type":"status","agent":"flights","message":"Buscando vuelos BOG → CTG para el 2026-12-04…"}
{"type":"ui","component":"flights","data":{"query":{"origin":"BOG","destination":"CTG","date":"2026-12-04"},"options":[…]}}
{"type":"text","delta":"Encontré 3 opciones por la mañana. "}
{"type":"text","delta":"La más barata sale a las 07:15."}
{"type":"done"}
```

## 5. Invocación desde el navegador (referencia)

`POST` a la URL de invocación del runtime del Orchestrator con `Authorization: Bearer <access token>`, `Content-Type: application/json` y el identificador de sesión del runtime en su cabecera. Cuerpo: `{"prompt":"…"}`. El campo `actor_id` **deja de usarse**: el actor es el `sub` del token. El valor exacto de la URL, las cabeceras y el comportamiento CORS se confirman en el spike del sprint S2 (ADR-07).
