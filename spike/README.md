# Spike S2 — streaming de AgentCore desde el navegador

Página de prueba **sin dependencias** (`agentcore-stream.html`). Hace login directo contra Cognito y llama al runtime del
OrchestratorAgent con `Authorization: Bearer <access token>`, leyendo la respuesta con `ReadableStream`.
Sirve para comprobar el supuesto del ADR-07 (CORS y streaming) **antes** de construir el frontend.

## Cómo servirla

```powershell
cd C:\Users\User\agentic-workshop\a2a-trip-planner\spike
python -m http.server 5173
```

Abre <http://localhost:5173/agentcore-stream.html>. No abras el archivo con `file://`: el origen sería `null`.

## Qué probar

1. Inicia sesión con un usuario del User Pool (`tripplanner-users`). El token vive solo en memoria.
2. Pulsa **Enviar**. Mira:
   - **Diagnóstico**: código HTTP y cabeceras visibles.
   - **Fragmentos crudos** y las métricas de tiempo (primer y último fragmento).
   - **Respuesta acumulada**: el texto limpio (si llegan eventos `data: ...`, se extrae el contenido).
3. **Nueva sesión** genera un `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` nuevo (45 caracteres; el mínimo es 33).

## Cómo interpretar los resultados

| Resultado | Significado |
|---|---|
| `TypeError: Failed to fetch` (F12 → Console: *blocked by CORS policy*) | CORS: el servicio no respondió al preflight `OPTIONS` o no devolvió `Access-Control-Allow-Origin`. Activa el plan B del ADR-07. |
| HTTP 401/403 con cuerpo legible | CORS **sí** funciona; falla la autorización del JWT (cliente no permitido, token vencido, `discoveryUrl`). |
| HTTP 200 con varios fragmentos separados en el tiempo | Plan A viable: streaming incremental directo desde el navegador. |
| HTTP 200 con un solo fragmento al final | CORS funciona pero no hay streaming incremental. |

Requisitos previos: el Orchestrator debe estar desplegado con el inbound `CUSTOM_JWT` (este sprint no despliega).
Los valores del User Pool, del client y del ARN están al inicio del `<script>`.
