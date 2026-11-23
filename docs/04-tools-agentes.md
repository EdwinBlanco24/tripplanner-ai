# TripPlanner AI — Tools de los agentes y contrato del stream (Canal 2)

Estado: implementado en el sprint S3b (sin desplegar). Código: `app/OrchestratorAgent/business_tools.py` y `main.py`.

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
Frontend ◄── eventos JSON (status · ui · text · error · done) ◄┘
```

Reglas del ciclo:

1. **`userId` fuera del alcance del LLM.** Ninguna tool declara ese parámetro. `build_business_tools(user_id, emit_ui)` crea las tools por petición como *closures* que capturan el `userId` ya extraído del JWT y lo añaden al evento que envían a la Lambda. Solo se entrega usuario cuando la identidad viene de un **JWT validado**: en desarrollo local (sin token, `actor_id` del payload o `DEFAULT_ACTOR_ID`) las tools de negocio responden `UNAUTHENTICATED` («Requiere usuario autenticado.») sin invocar ninguna Lambda, para no escribir en la base real con un usuario ficticio.
2. **Las Lambdas son la autoridad.** Validan todo otra vez (ADR-02); un parámetro mal formado del LLM produce un error estructurado que el modelo puede corregir.
3. **Confirmación de acciones destructivas.** `delete_trip` y `delete_reservation` exigen `confirmed=true`; el *system prompt* obliga al modelo a pedir confirmación explícita al usuario. Sin `confirmed=true` la tool devuelve `CONFIRMATION_REQUIRED` **sin invocar la Lambda** (y la Lambda lo vuelve a exigir).
4. **Identificadores.** El modelo nunca inventa `tripId`/`resId`: los obtiene de `get_trips` / `get_reservations` o de resultados previos. La Lambda responde `NOT_FOUND` si no existen.
5. **Resultados no confiables.** Textos de MCP o de reservas son datos, no instrucciones.
6. **Sin datos de tarjeta.** El *system prompt* prohíbe pedirlos o aceptarlos y las Lambdas rechazan cualquier campo de tarjeta con 400.

## 2. Contrato de invocación Orchestrator → Lambda

Evento (invocación síncrona `RequestResponse`):

```json
{ "source": "agent", "action": "create_trip", "userId": "<sub>", "payload": { "...": "..." } }
```

Respuesta de la Lambda:

```json
{ "ok": true,  "statusCode": 201, "data": { "...": "..." } }
{ "ok": false, "statusCode": 400, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Lo que recibe el modelo es un JSON compacto: `{"ok":true,"data":…}` o `{"ok":false,"error":{"code","message","details"?}}`. Nunca recibe trazas ni textos de excepciones. Códigos propios de la tool (la Lambda no llega a invocarse o falla la infraestructura):

| Código | Cuándo |
|---|---|
| `UNAUTHENTICATED` | No hay un usuario válido en la petición |
| `NOT_CONFIGURED` | Falta el ARN de la Lambda en el entorno |
| `CONFIRMATION_REQUIRED` | `delete_*` sin `confirmed=true` |
| `UNCERTAIN` | En `create_*` / `update_*`: lectura agotada, conexión cerrada a mitad o `FunctionError` de la Lambda. La escritura **pudo completarse**: el mensaje es «La operación pudo haberse completado; consulta antes de reintentar» y el *system prompt* obliga a consultar (`get_trips`, `get_reservations`, `get_itinerary`) antes de repetir |
| `SERVICE_ERROR` | `FunctionError` de la Lambda en una lectura o en un `delete_*`, o respuesta fuera de contrato |
| `SERVICE_UNAVAILABLE` | Red, permisos, fallo antes de enviar la petición, tiempo agotado en lecturas y `delete_*`, u otra excepción del cliente |

Los demás códigos son los de `03-api.md` (sin el HTTP). Cliente `boto3`: región `us-east-2`, conexión 5 s, lectura 15 s (= `Timeout` de las Lambdas, 10 s, + 5 s) y **sin reintentos** (`total_max_attempts = 1`): las Lambdas no son idempotentes y un reintento tras un timeout podría duplicar un viaje o una reserva. Cada llamada registra `action`, latencia en ms, `ok`/código y el usuario enmascarado (8 caracteres + «…»); nunca el payload ni el `userId` completo.

## 3. Tools del OrchestratorAgent (15 de negocio + 2 especialistas)

Los nombres de las tools son `snake_case` (Bedrock solo admite `[a-zA-Z0-9_-]+`) y **coinciden con el nombre de la acción** que se envía a la Lambda. La columna **Guía** conserva el nombre del enunciado.

| Tool | Guía | Propósito | Parámetros (sin `userId`) | Lambda |
|---|---|---|---|---|
| `create_trip` | CreateTrip | Crea un viaje a partir de lo hablado | `title`, `origin`, `destination`, `start_date`, `end_date`, `travelers`, `budget`, `currency="COP"`, `notes?` | Trips |
| `get_trips` | GetTrips | Lista los viajes | `status?` (`PLANNED`\|`CANCELLED`) | Trips |
| `get_trip` | (extra) | Un viaje con su itinerario y reservas | `trip_id` | Trips |
| `update_trip` | UpdateTrip | Cambia campos de un viaje (cancelar con `status`) | `trip_id`, y cualquiera de: `title`, `origin`, `destination`, `start_date`, `end_date`, `travelers`, `budget`, `currency`, `notes`, `status` | Trips |
| `delete_trip` | (extra) | Borra un viaje con su itinerario y reservas | `trip_id`, `confirmed` | Trips |
| `create_itinerary` | CreateItinerary | Crea el itinerario día a día | `trip_id`, `days[]` (`date`, `weather?`, `items[]`) | Itineraries |
| `get_itinerary` | (extra) | Lee el itinerario | `trip_id` | Itineraries |
| `update_itinerary` | UpdateItinerary | Reemplaza el itinerario | `trip_id`, `days[]` | Itineraries |
| `create_reservation` | CreateReservation | Registra una reserva **simulada** | `trip_id`, `type`, `provider`, `details`, `price`, `currency="COP"`, `status="SIMULADA"` | Reservations |
| `get_reservations` | GetReservations | Lista reservas del usuario o de un viaje | `trip_id?` | Reservations |
| `get_reservation` | (extra) | Lee una reserva | `trip_id`, `res_id` | Reservations |
| `update_reservation` | UpdateReservation | Cambia estado, proveedor, detalles o precio | `trip_id`, `res_id`, y cualquiera de: `status`, `provider`, `details`, `price`, `currency` | Reservations |
| `delete_reservation` | (extra) | Elimina una reserva | `trip_id`, `res_id`, `confirmed` | Reservations |
| `get_preferences` | (extra) | Lee las preferencias guardadas | — | Preferences |
| `update_preferences` | (extra) | Guarda (reemplaza) las preferencias | `preferred_departure_window?`, `budget_style?`, `interests?`, `dietary?` | Preferences |
| `ask_flights` | — | Delega en FlightsAgent (A2A, SigV4) | `request` | — |
| `ask_weather` | — | Delega en WeatherAgent (A2A, SigV4) | `request` | — |

Notas:

- Las tools usan `snake_case` en los parámetros; la tool traduce a `camelCase` en el `payload` (`start_date` → `startDate`, `trip_id` → `tripId`). Los parámetros omitidos (`None`) no se envían. Para borrar las notas de un viaje se pasa `notes=""`.
- `update_preferences` reemplaza todas las preferencias: el modelo debe incluir las que quiere conservar.
- Toda escritura hecha por una tool lleva `createdBy: "assistant"`.
- Reservas FLIGHT a partir de `ask_flights`: el *system prompt* manda copiar tal cual en `details` `airline`, `flightNumber`, `origin`, `destination`, `departureTime`, `arrivalTime` y `bookingUrl` (omitiendo los `null`), y usar el `price` y la `currency` del vuelo como campos de la reserva, no dentro de `details` (el backend rechaza claves desconocidas). `bookingUrl` admite hasta 2048 caracteres.
- FlightsAgent solo expone `kiwi_search_flight` (lista blanca). El MCP de clima se define en S3.

### 3.1 Acciones de las Lambdas (evento `source: "agent"`)

Los nombres **canónicos** de acción están en `snake_case` y coinciden con los de las tools:

| Lambda | Acciones |
|---|---|
| Trips | `create_trip`, `get_trips`, `get_trip`, `update_trip`, `delete_trip` |
| Itineraries | `create_itinerary`, `get_itinerary`, `update_itinerary` |
| Reservations | `create_reservation`, `get_reservations`, `get_reservation`, `update_reservation`, `delete_reservation` |
| Preferences | `get_preferences`, `update_preferences` |

**Alias.** Las Lambdas también aceptan los nombres camelCase del diseño inicial (`createTrip`, `listTrips`, `getTrip`, `updateTrip`, `deleteTrip`, `createItinerary`, `getItinerary`, `updateItinerary`, `createReservation`, `listReservations`, `getReservation`, `updateReservation`, `deleteReservation`, `getPreferences`, `updatePreferences`) y los traducen al nombre canónico. El código nuevo debe usar siempre `snake_case`.

**Respuesta de la Lambda al agente** (no es el formato de API Gateway): `{"ok": true, "statusCode": 200, "data": {...}}` o `{"ok": false, "statusCode": 400, "error": {"code", "message", "details"?}}`. Los `delete_*` exigen `payload.confirmed == true` y responden `statusCode` 200 con `data` (`deleted`, ids y, en viajes, `deletedItems`).

### 3.2 Permisos y configuración

El rol del runtime del OrchestratorAgent recibe una política por archivo (`additionalPolicies` en `agentcore.json`, ruta relativa al `codeLocation`): `TripPlannerA2A/agentcore/policies/orchestrator-invoke-business-lambdas.json`, con `lambda:InvokeFunction` **solo** sobre los ARN de las cuatro funciones. Los ARN se pasan como variables de entorno del runtime (`TRIPS_FUNCTION_ARN`, `ITINERARIES_FUNCTION_ARN`, `RESERVATIONS_FUNCTION_ARN`, `PREFERENCES_FUNCTION_ARN`). Si se recrea el stack del backend, cambian los ARN y hay que actualizar variables y política.

## 4. Contrato del stream hacia el frontend

Cada evento es **un objeto JSON**. El SDK de AgentCore lo entrega por SSE: `data: {json}` seguido de una línea en blanco (cada `yield` del Orchestrator es un evento). El cliente descarta líneas vacías o de comentario. El contrato de los objetos no cambia si se usa el plan B del proxy (ADR-07).

| Evento | Forma | Cuándo |
|---|---|---|
| Estado | `{"type":"status","agent":"flights","message":"Consultando el agente de vuelos…"}` | Una vez por cada uso de tool (por `toolUseId`), al detectar su inicio. `agent` ∈ `orchestrator`, `flights`, `weather`, `business`. |
| Interfaz | `{"type":"ui","component":"flights","data":{…}}` | Datos estructurados para renderizar un componente (ver 4.1). |
| Texto | `{"type":"text","delta":"Encontré 3 opciones…"}` | Fragmento incremental de la respuesta del modelo. El cliente concatena `delta`. |
| Error | `{"type":"error","message":"…"}` | Falla la petición (mensaje claro y sin detalles internos). Siempre va seguido de `done`. |
| Fin | `{"type":"done"}` | **Último evento de toda respuesta**, correcta o con error. |

Reglas del cliente: ignorar `type` o `component` desconocidos (compatibilidad hacia adelante); no mostrar `ui` si `data` no cumple el esquema; tratar el cierre del stream sin `done` como error.

Errores antes de empezar (mensaje vacío, token sin usuario válido, sesión ausente) también salen como `error` + `done` con HTTP 200, no como una excepción.

### 4.1 Forma de `data` por componente

| `component` | `data` | Origen |
|---|---|---|
| `flights` | `{"flights":[{"airline","flightNumber","origin","destination","departureTime","arrivalTime","durationMinutes","stops","price","currency","bookingUrl"}]}` (hasta 10; el agente pide 5) | Bloque ```json de FlightsAgent, vía `ask_flights` |
| `weather` | `{"weather": <lista u objeto>}` | Bloque ```json con la clave `weather` (WeatherAgent aún no lo emite) |
| `trip` | `{"trip":{…}}`; con `get_trip`: `{"trip","itinerary","reservations"}` | `create_trip` / `update_trip` / `get_trip` |
| `trips` | `{"trips":[{…}]}` | `get_trips` |
| `itinerary` | `{"tripId","days":[…],"updatedAt"}` (estructura de `02-modelo-datos.md`) | `create_itinerary` / `update_itinerary` / `get_itinerary` |
| `reservations` | `{"tripId"?,"change":"listed\|created\|updated\|deleted","reservations":[{…}],"resId"?}` | `get_reservations`, `create/update/get_reservation`, `delete_reservation` (con `change:"deleted"`, `resId` y lista vacía) |
| `preferences` | `{"preferences":{…}\|null}` | `get_preferences` / `update_preferences` |

`delete_trip` no emite `ui`: el frontend refresca su lista al recibir `done`.

### 4.2 Cómo se generan

- `status`: el código detecta el inicio de un `toolUse` en los eventos de `stream_async` (`current_tool_use` o `contentBlockStart`), un evento por `toolUseId`; el mensaje sale de `TOOL_STATUS` en `business_tools.py`.
- `text`: cada fragmento de texto del modelo (`event["data"]`).
- `ui`: lo emite el **código** (una cola por petición alimentada por las tools) **después** de una tool con `ok: true`; el modelo no puede fabricarlo. Se vacía la cola tras cada evento del stream y al final.
- `flights` / `weather`: FlightsAgent termina sus respuestas con un bloque ```json con la clave `flights` (misma información que el texto, máx. 5). `ask_flights` lo extrae, valida que sea una lista de objetos, emite el `ui` y devuelve al modelo el texto **sin** el bloque. `ask_weather` tiene el mismo mecanismo con la clave `weather`.
- Tras una escritura por chat (p. ej. `create_trip`), el frontend refresca sus listas del canal 1 al recibir el `ui` correspondiente o `done`.

### 4.3 Ejemplo

```text
data: {"type":"status","agent":"flights","message":"Consultando el agente de vuelos…"}
data: {"type":"ui","component":"flights","data":{"flights":[{"airline":"Avianca","flightNumber":"AV9821","price":289000,"currency":"COP"}]}}
data: {"type":"text","delta":"Encontré 3 opciones por la mañana. "}
data: {"type":"text","delta":"La más barata sale a las 07:15."}
data: {"type":"status","agent":"business","message":"Guardando tu viaje…"}
data: {"type":"ui","component":"trip","data":{"trip":{"tripId":"TRP-0123abcd"}}}
data: {"type":"done"}
```

## 5. Invocación desde el navegador (referencia)

`POST` a la URL de invocación del runtime del Orchestrator con `Authorization: Bearer <access token>`, `Content-Type: application/json` y el identificador de sesión del runtime en su cabecera. Cuerpo: `{"prompt":"…"}`. El campo `actor_id` **deja de usarse**: el actor es el `sub` del token. El valor exacto de la URL, las cabeceras y el comportamiento CORS se confirman en el spike del sprint S2 (ADR-07). Prueba por línea de comandos: `TripPlannerA2A/s3_stream_test.py`.
