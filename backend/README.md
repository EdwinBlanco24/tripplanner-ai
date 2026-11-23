# TripPlanner AI — backend serverless (AWS SAM)

Implementa el canal 1 (API de negocio) y las acciones que usará el canal 2 (tools del agente), según
`docs/01-arquitectura.md` a `docs/04-tools-agentes.md`. Región `us-east-2`, perfil `agentic-workshop`.

```text
backend/
├── template.yaml          Cognito · HTTP API · 4 Lambdas · DynamoDB
├── samconfig.toml         stack tripplanner-backend
├── src/common/            errores, validación, ids, acceso a DynamoDB, parseo de eventos, despacho
├── src/{trips,itineraries,reservations,preferences}/app.py
├── tests/                 unittest (solo librería estándar, sin red)
└── scripts/smoke-test.ps1 prueba de humo contra el stack desplegado
```

Las cuatro funciones empaquetan `src/` completo (`CodeUri: src/`) para compartir `common/`; cada una tiene su
propio rol IAM y su propio `Handler` (`trips.app.lambda_handler`, etc.).

## Pruebas locales (sin AWS)

```powershell
cd backend
C:\Users\User\agentic-workshop\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Build y validación

```powershell
cd backend
sam validate --lint
sam build            # necesita Python 3.13 en el PATH (o: sam build --use-container)
```

## Despliegue (lo hace el usuario; este sprint no despliega)

```powershell
sam deploy --guided                      # la primera vez; pide AllowedOrigins
sam deploy --parameter-overrides AllowedOrigins="https://<dominio-cloudfront>,http://localhost:5173"
```

Los Outputs (`ApiUrl`, `UserPoolId`, `UserPoolClientId`, `JwtIssuer`, `TableName` y los cuatro `…FunctionArn`) se leen con:

```powershell
aws cloudformation describe-stacks --stack-name tripplanner-backend --profile agentic-workshop --region us-east-2 --query "Stacks[0].Outputs"
```

La tabla DynamoDB tiene `DeletionPolicy: Retain` y protección contra borrado: `sam delete` no la elimina.

## Prueba de humo (después de desplegar)

```powershell
.\scripts\smoke-test.ps1 -Email prueba.tripplanner@example.com -Cleanup
```

Crea un usuario de Cognito de prueba, recorre la API (caso feliz y negativos) e imprime una tabla Paso / Esperado /
Obtenido / OK. Con `-Cleanup` borra el viaje de prueba y el usuario (solo si lo creó el script). No imprime el token
ni la contraseña.

## Contrato interno con las tools del agente

```json
{ "source": "agent", "action": "create_trip", "userId": "<sub>", "payload": { "title": "…" } }
```

Respuesta: `{"ok": true, "statusCode": 201, "data": {…}}` o `{"ok": false, "statusCode": 400, "error": {"code","message","details"?}}`.
Acciones: `create_trip, get_trips, get_trip, update_trip, delete_trip, create_itinerary, get_itinerary, update_itinerary,
create_reservation, get_reservations, get_reservation, update_reservation, delete_reservation, get_preferences,
update_preferences`. Los `delete_*` exigen `payload.confirmed == true`. Los nombres en camelCase de
`docs/04-tools-agentes.md` (`createTrip`, `listTrips`…) se aceptan como alias.
