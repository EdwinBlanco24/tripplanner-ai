# TripPlanner AI — Arquitectura

Estado: **diseño (Sprint S0)** · Región `us-east-2` · Cuenta `458934380591`

TripPlanner AI convierte el TripPlanner del taller (tres agentes Strands en AgentCore) en una aplicación web con **dos canales** que comparten la misma base de datos y el mismo usuario autenticado:

| Canal | Para qué sirve | Ruta |
|---|---|---|
| **1 · Negocio** | Pantallas clásicas: viajes, itinerarios, reservas y preferencias | Frontend → API Gateway (HTTP API, autorizador JWT de Cognito) → Lambda → DynamoDB |
| **2 · Agéntico** | Conversación en lenguaje natural con streaming | Frontend → HTTP streaming **directo** a AgentCore (sin API Gateway) → OrchestratorAgent → FlightsAgent / WeatherAgent / Tools de negocio → Lambdas → DynamoDB |

Diagrama: `docs/arquitectura-tripplanner.drawio` (abrir con diagrams.net).

## 1. Vista general

```text
Usuario ── CloudFront ── S3 (Vite + React + TypeScript)
   │
   ├─ login ───────────────► Amazon Cognito (User Pool)
   │
   ├─ Canal 1 (JWT) ───────► API Gateway ─► Lambdas (Trips · Itineraries · Reservations · Preferences) ─► DynamoDB
   │
   └─ Canal 2 (JWT, stream) ► AgentCore Runtime · OrchestratorAgent (inbound CUSTOM_JWT)
                                 ├─ A2A (SigV4) ─► FlightsAgent ─► MCP Smithery ─► Kiwi.com   (key en Secrets Manager)
                                 ├─ A2A (SigV4) ─► WeatherAgent ─► MCP de clima (por definir en S3)
                                 ├─ Tools ─ lambda:InvokeFunction ─► las mismas 4 Lambdas ─► DynamoDB
                                 └─ AgentCore Memory (TripPlannerMemory)
Transversales: CloudWatch (logs y alarmas) · IAM (mínimo privilegio)
```

## 2. Componentes

| Componente | Responsabilidad | Notas de diseño |
|---|---|---|
| **Frontend** (Vite + React + TS) | Interfaz de ambos canales: pantallas de negocio y chat con streaming | Publicado en S3 + CloudFront. Guarda los tokens de Cognito en memoria (no en `localStorage`). Lee el stream por `fetch` + `ReadableStream`. |
| **Amazon Cognito** | Registro, login y emisión de JWT | User Pool con un app client público (sin secreto, flujo SRP/PKCE). El claim `sub` es el identificador de usuario en todo el sistema. |
| **API Gateway (HTTP API)** | Entrada del canal 1 | Autorizador JWT nativo (issuer del User Pool, audiencia = app client). CORS restringido, throttling por etapa y por ruta, logs de acceso. |
| **AWS Lambda** | Lógica de negocio | Cuatro funciones (Trips, Itineraries, Reservations, Preferences). Cada una acepta dos tipos de evento (ADR-02) y comparte una capa de código de negocio. Python 3.13. |
| **DynamoDB** | Fuente de verdad del negocio | Tabla única `TripPlannerTable`, on-demand, PITR activado (ADR-01). |
| **AgentCore Runtime** | Aloja los tres agentes | OrchestratorAgent (protocolo HTTP, inbound CUSTOM_JWT); FlightsAgent y WeatherAgent (protocolo A2A, IAM SigV4). |
| **Strands Agents** | Marco de los agentes | Orquestación con tools, sesiones y memoria. |
| **MCP Kiwi (Smithery)** | Vuelos reales | Streamable HTTP. Solo se expone al modelo la tool `kiwi_search_flight` (lista blanca). |
| **MCP de clima** | Pronóstico | **Por definir en el sprint S3** (criterios: Streamable HTTP, preferiblemente sin API key, datos diarios de temperatura y lluvia). |
| **Secrets Manager** | Secretos | Guarda la API key de Smithery (`tripplanner/smithery-api-key`). Solo FlightsAgent puede leerla. |
| **AgentCore Memory** | Contexto conversacional | `TripPlannerMemory` con estrategias USER_PREFERENCE, SUMMARIZATION y SEMANTIC. `actorId` = `sub` del usuario (ADR-06). |
| **S3 + CloudFront** | Hosting estático | Bucket privado con OAC, HTTPS obligatorio, fallback de SPA a `index.html`. |
| **IAM** | Control de acceso | Un rol por función y por runtime; el Orchestrator solo puede invocar las cuatro Lambdas (ADR-03). |
| **CloudWatch** | Observabilidad | Logs de Lambdas, API Gateway y AgentCore con retención de 30 días; alarmas de errores 5xx, throttling y duración. |

## 3. Flujos principales

**Canal 1 (negocio).** El usuario inicia sesión en Cognito y el frontend envía el *access token* en `Authorization: Bearer`. API Gateway valida firma, emisor y audiencia; la Lambda recibe el `sub` en `requestContext.authorizer.jwt.claims` y opera solo sobre `PK = USER#<sub>`.

**Canal 2 (agéntico).** El frontend abre una petición HTTP con streaming a la URL de invocación del runtime del Orchestrator con el mismo token. AgentCore valida el JWT (CUSTOM_JWT). El Orchestrator obtiene el `userId` del token, decide qué especialistas o tools usar y emite eventos JSON por línea (contrato en `04-tools-agentes.md`). Las tools de negocio invocan las Lambdas directamente; no pasan por API Gateway.

**Coherencia entre canales.** Ambos canales escriben en la misma tabla con el mismo `sub`, así que un viaje creado por el chat aparece en las pantallas de negocio y viceversa (`createdBy` registra el origen).

## 4. Seguridad (resumen)

- El `userId` **siempre** sale del claim `sub` de un JWT validado. Nunca lo envía el cliente en el cuerpo ni lo decide el LLM.
- Las tools del agente no tienen parámetro `userId`; el código del Orchestrator lo inyecta.
- Mínimo privilegio: cada Lambda accede solo a su tabla y acciones; el runtime del Orchestrator solo tiene `lambda:InvokeFunction` sobre las cuatro funciones.
- FlightsAgent y WeatherAgent no son accesibles desde internet con JWT: siguen con IAM SigV4 y solo aceptan al rol del Orchestrator.
- No se almacenan datos de tarjetas ni se procesan pagos. Las reservas son **simuladas**.
- Los resultados de MCP son datos no confiables: los prompts de los agentes ordenan ignorar instrucciones incrustadas en ellos.

## 5. Registro de decisiones (ADR)

### ADR-01 · Tabla única DynamoDB con `PK = USER#<sub>`

- **Contexto.** Los datos son pequeños, siempre se consultan por usuario y por viaje, y se necesita borrar un viaje con todo lo suyo.
- **Decisión.** Una sola tabla `TripPlannerTable` (on-demand) con `PK` (string) y `SK` (string). Perfil, preferencias, viajes, itinerarios y reservas viven bajo la misma `PK = USER#<sub>`; el `SK` los distingue (`PROFILE`, `PREFS`, `TRIP#<id>`, `TRIP#<id>#ITIN`, `TRIP#<id>#RES#<id>`).
- **Alternativas.** (a) Una tabla por entidad: más recursos y más permisos, sin beneficio a esta escala. (b) RDS/Aurora: coste fijo y VPC innecesarios.
- **Consecuencias.** Todas las lecturas son `Query`/`GetItem` por clave, sin joins. El aislamiento por usuario se logra con la clave. El borrado en cascada es una consulta por prefijo. Si aparecen accesos por otro eje (p. ej. todas las reservas por fecha) habrá que añadir un GSI (ver `02-modelo-datos.md`).

### ADR-02 · Una Lambda por recurso con dos entradas

- **Contexto.** El mismo negocio debe poder invocarse desde API Gateway (canal 1) y desde las tools del agente (canal 2) sin duplicar reglas.
- **Decisión.** Cuatro Lambdas: Trips, Itineraries, Reservations y Preferences. Cada una detecta el tipo de evento: (1) evento de API Gateway HTTP API (payload 2.0), o (2) evento directo de la tool `{"source":"agent","action":"...","userId":"...","payload":{...}}`. Ambos caminos llaman a la misma lógica de negocio (validación, acceso a DynamoDB) en un módulo compartido.
- **Alternativas.** (a) Una Lambda monolítica: menos aislamiento de permisos y despliegues más grandes. (b) Lambdas separadas para API y para agente: duplica validaciones y las deja divergir. (c) Que el agente llame a la API por HTTP: añade latencia y obliga a gestionar credenciales (ver ADR-03).
- **Consecuencias.** Un único punto de validación. El evento directo es un contrato interno que debe versionarse (`04-tools-agentes.md`). Hay que probar ambas entradas con los mismos casos.

### ADR-03 · Las tools invocan Lambdas con `lambda:InvokeFunction`

- **Contexto.** El Orchestrator corre en AgentCore con un rol IAM propio; el JWT del usuario no es una credencial para API Gateway en el lado del servidor.
- **Decisión.** Las tools usan `boto3.client("lambda").invoke` (síncrono) con el rol del runtime. La política concede solo `lambda:InvokeFunction` sobre los ARN de las cuatro funciones.
- **Alternativas.** (a) Llamar a API Gateway con el JWT reenviado: requiere pasar el token a las tools y gestionar expiración. (b) Llamar a API Gateway con SigV4: exige una segunda forma de autorización en la API. (c) Acceso directo a DynamoDB desde el agente: se salta las validaciones de negocio.
- **Consecuencias.** Menos saltos y sin dependencia de la API pública. La confianza en `userId` descansa en que **solo** el rol del Orchestrator puede invocar las funciones con `source: "agent"`. Los ARN de las Lambdas llegan al agente como variables de entorno.

### ADR-04 · Autenticación con Cognito

- **Contexto.** Hay dos puertas de entrada (API Gateway y AgentCore) y se necesita una identidad única y no falsificable.
- **Decisión.** Un Cognito User Pool. API Gateway usa un **JWT authorizer** (emisor del pool, audiencia = app client). El runtime del OrchestratorAgent usa **inbound CUSTOM_JWT** (`discoveryUrl` del pool y `allowedClients` = app client; los *access tokens* de Cognito traen `client_id`, no `aud`). El frontend envía el *access token* a ambos. `userId` = claim `sub`. FlightsAgent y WeatherAgent siguen con IAM SigV4 porque solo los llama el Orchestrator.
- **Alternativas.** (a) Claves de API: no identifican personas. (b) Identity Pool con SigV4 desde el navegador: expone credenciales AWS temporales al cliente y complica el mínimo privilegio por usuario. (c) IdP externo (Auth0, Google): más piezas para un trabajo académico.
- **Consecuencias.** El Orchestrator pasa de IAM a CUSTOM_JWT: `agentcore invoke` desde el CLI necesitará un token. El runtime debe recibir el encabezado `Authorization` (`requestHeaderAllowlist`) para leer el `sub`; como AgentCore ya validó la firma, el código solo decodifica el payload. El `sub` se usa también como `actorId` de AgentCore Memory, lo que sustituye al `actor_id` del cuerpo y al `DEFAULT_ACTOR_ID` de pruebas.

### ADR-05 · IaC: AWS SAM para el backend y el CLI `agentcore` para los agentes

- **Contexto.** El backend serverless (Cognito, API, Lambdas, DynamoDB, S3, CloudFront) se despliega bien con SAM. Los agentes ya se gestionan con el CLI `agentcore` (proyecto CDK generado, con empaquetado CodeZip y `agentcore.json`).
- **Decisión.** **Dos stacks**: `template.yaml` (SAM) y el proyecto AgentCore existente. SAM exporta los ARN y el *issuer*/client de Cognito; `agentcore.json` los consume mediante `envVars` y `additionalPolicies`.
- **Alternativas.** (a) Todo en SAM: SAM no modela runtimes de AgentCore con el flujo del CLI. (b) Todo en CDK propio: se pierde el empaquetado y las convenciones del CLI. (c) Consola manual: no reproducible.
- **Consecuencias.** Orden de despliegue: SAM primero (crea Lambdas y Cognito), después los agentes (necesitan sus ARN). Hay un acoplamiento manual por valores; se documentará en cada sprint. Cada stack se puede revertir por separado.

### ADR-06 · Memory ≠ persistencia

- **Contexto.** AgentCore Memory extrae preferencias y resúmenes de la conversación, pero su contenido es inferido, no auditable y expira.
- **Decisión.** AgentCore Memory solo aporta **contexto y preferencias conversacionales** (p. ej. "prefiere vuelos de mañana"). **DynamoDB es la fuente de verdad** de viajes, itinerarios, reservas y de las preferencias que el usuario edita en pantalla.
- **Alternativas.** (a) Guardar todo en Memory: no es consultable ni editable desde el canal 1. (b) Ignorar Memory: pierde personalización entre sesiones.
- **Consecuencias.** Pueden existir dos "preferencias" (inferida y explícita); la explícita de DynamoDB manda. Ninguna operación de negocio puede depender de Memory.

### ADR-07 · Riesgo: consumir el streaming de AgentCore desde el navegador

- **Contexto.** El canal 2 llama a AgentCore directamente desde el navegador con un JWT. No está verificado que el endpoint de invocación responda al preflight CORS ni cómo entrega el streaming (el SDK emite eventos SSE cuando el *entrypoint* es un generador asíncrono).
- **Decisión.** **Plan A**: llamada directa con `fetch` y `Authorization: Bearer`, leyendo `data:` línea a línea. Se valida en un **spike del sprint S2** antes de construir la interfaz. **Plan B** (solo si A falla por CORS o por el formato del stream): un proxy mínimo con streaming (Lambda Function URL con *response streaming* o Lambda detrás de un origen propio) que reenvíe el token y el cuerpo sin lógica de negocio.
- **Alternativas.** (a) API Gateway delante de AgentCore: descartado por requisito (el canal 2 no usa API Gateway) y por el límite de tiempo de integración. (b) WebSocket propio: más infraestructura.
- **Consecuencias.** Si se usa el plan B se documenta como excepción, con la razón técnica medida (respuesta del preflight, cabeceras observadas). El contrato de eventos (`04-tools-agentes.md`) no cambia entre planes.

## 6. Supuestos por verificar

1. El endpoint de invocación de AgentCore acepta peticiones del navegador (CORS) con `Authorization: Bearer` (ADR-07).
2. El runtime puede recibir el encabezado `Authorization` mediante `requestHeaderAllowlist` (el esquema del CLI incluye el campo; falta probarlo con CUSTOM_JWT).
3. El formato exacto del stream (SSE `data:` con un objeto JSON por evento) y cómo traducir los eventos de Strands (texto, inicio de tool, resultado de tool) a los eventos del contrato.
4. Que FlightsAgent pueda devolver datos estructurados además del texto sobrio actual, para alimentar los eventos `ui` de vuelos.
5. Elección del MCP de clima (S3).

## 7. Fuera de alcance

Pagos reales, emisión de tickets, correo o notificaciones, múltiples entornos (solo `dev`), multi-región.
