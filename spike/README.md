# Spike — stream tipado de AgentCore desde el navegador

Página de prueba **sin dependencias** (`agentcore-stream.html`). Hace login directo contra Cognito y llama al runtime del
OrchestratorAgent con `Authorization: Bearer <access token>`, leyendo la respuesta con `ReadableStream`. Sirve para
comprobar el supuesto del ADR-07 (CORS y streaming) y para ver el **stream tipado** del sprint S3b.

## Cómo servirla

```powershell
cd C:\Users\User\agentic-workshop\a2a-trip-planner\spike
python -m http.server 5173
```

Abre <http://localhost:5173/agentcore-stream.html>. No abras el archivo con `file://`: el origen sería `null`.
El origen `http://localhost:5173` es el que debe aceptar CORS (si se usa otro puerto, hay que tenerlo en cuenta).

## Qué muestra

La página interpreta cada evento `data: {...}` del stream (acumula hasta la línea en blanco, así que tolera eventos
partidos entre fragmentos de red):

| Evento | Qué se ve |
|---|---|
| `status` | Una línea de **Progreso** con el instante, el agente (`orchestrator`, `flights`, `weather`, `business`) y el mensaje |
| `text` | El `delta` se concatena en **Texto** |
| `ui` | Un bloque `<pre>` por componente con su nombre (`flights`, `trip`, `trips`, `itinerary`, `reservations`, `weather`, `preferences`) y el JSON formateado |
| `error` | Una línea roja con el mensaje |
| `done` | «Fin (done)». Si el stream termina sin `done`, la página lo marca como error |

Además: **Diagnóstico** (código HTTP, cabeceras visibles, formato detectado), **fragmentos crudos** con su instante, y las
métricas de tiempo (cabeceras, primer y último fragmento, nº de fragmentos y de eventos).

## Cómo probar

1. Inicia sesión con un usuario del User Pool (`tripplanner-users`). El token vive solo en memoria; no hay tokens ni
   contraseñas en el archivo ni en `localStorage`.
2. Pulsa **Enviar**. **Nueva sesión** genera un `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` nuevo (45 caracteres; el mínimo es 33).
   Para que el agente recuerde el contexto (p. ej. un viaje recién creado) mantén la misma sesión entre mensajes.
3. Mensajes sugeridos:
   - `Busca vuelos de Bogotá a Cartagena el 2026-12-04 por la mañana` → `status` de vuelos y `ui · flights`.
   - `Guarda ese viaje para 2 personas con 3 millones de presupuesto` → `status` de negocio y `ui · trip`.
   - `Muéstrame mis viajes` → `ui · trips`.

## Cómo interpretar los resultados

| Resultado | Significado |
|---|---|
| `TypeError: Failed to fetch` (F12 → Console: *blocked by CORS policy*) | CORS: el servicio no respondió al preflight `OPTIONS` o no devolvió `Access-Control-Allow-Origin`. Activa el plan B del ADR-07. |
| HTTP 401/403 con cuerpo legible | CORS **sí** funciona; falla la autorización del JWT (cliente no permitido, token vencido, `discoveryUrl`). |
| HTTP 200 con varios fragmentos separados en el tiempo | Plan A viable: streaming incremental directo desde el navegador. |
| HTTP 200 con un solo fragmento al final | CORS funciona pero no hay streaming incremental. |
| Evento `error` seguido de `done` | La petición falló en el agente; el mensaje es genérico a propósito (el detalle está en CloudWatch). |

Requisitos previos: el Orchestrator debe estar desplegado con el inbound `CUSTOM_JWT` y con los cambios del sprint S3b
(este repositorio todavía no despliega nada). Los valores del User Pool, del client y del ARN están al inicio del `<script>`.
