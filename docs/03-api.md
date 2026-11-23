# TripPlanner AI — API de negocio (Canal 1)

HTTP API de API Gateway con **autorizador JWT de Cognito**. Base: `https://<api-id>.execute-api.us-east-2.amazonaws.com` (sin prefijo de versión en la etapa; la versión va en la ruta solo si cambia el contrato).

## 1. Convenciones

| Tema | Regla |
|---|---|
| Autenticación | `Authorization: Bearer <access token de Cognito>`. El autorizador valida firma, `iss` y `client_id`/`aud`. |
| Identidad | `userId` = claim `sub` (`requestContext.authorizer.jwt.claims.sub`). **Nunca** se acepta un `userId` en la ruta, la consulta ni el cuerpo. |
| Formato | JSON UTF-8. `Content-Type: application/json` en `POST`/`PUT`. Cuerpo máx. 256 KB. |
| Fechas | `YYYY-MM-DD` (fecha de negocio) e ISO-8601 UTC (`createdAt`, `updatedAt`). La validación "fecha futura" usa la zona `America/Bogota`. |
| CORS | Orígenes permitidos: el dominio de CloudFront del frontend y `http://localhost:5173` (solo en `dev`). Métodos `GET, POST, PUT, DELETE, OPTIONS`; cabeceras `Authorization, Content-Type`; `max-age` 3600; sin credenciales. Nunca `*`. |
| Throttling | Etapa: 20 req/s en régimen y ráfaga de 40. Escrituras (`POST`, `PUT`, `DELETE`): 10 req/s por ruta. Excederlo devuelve 429. |
| Códigos de éxito | `200` lectura/actualización, `201` creación (con cuerpo), `204` borrado sin cuerpo. |

### 1.1 Formato de error

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "endDate debe ser igual o posterior a startDate", "details": [ { "field": "endDate", "issue": "before_startDate" } ] } }
```

`details` es opcional (solo en 400).

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | JSON inválido, campos faltantes o fuera de rango, enums inválidos |
| 401 | `UNAUTHORIZED` | Token ausente, vencido o inválido. Lo genera API Gateway (se configura una *Gateway Response* para usar este formato) |
| 403 | `FORBIDDEN` | Token válido pero sin permiso para la operación. Un recurso de otro usuario **no** produce 403 sino 404, para no revelar su existencia |
| 404 | `NOT_FOUND` | El viaje, itinerario o reserva no existe para este usuario |
| 409 | `CONFLICT` | Ya existe (itinerario duplicado) o cambio incompatible |
| 409 | `LIMIT_REACHED` | Se alcanzó el máximo de viajes (100) o de reservas por viaje (50) |
| 429 | `TOO_MANY_REQUESTS` | Throttling |
| 500 | `INTERNAL_ERROR` | Error no controlado. El mensaje es genérico; el detalle va solo a CloudWatch |

## 2. Validaciones comunes

| Campo | Regla |
|---|---|
| `title` | texto 1–120 |
| `origin`, `destination` | texto 2–80 |
| `startDate`, `endDate` | `YYYY-MM-DD` válidos; **`startDate` ≥ hoy**; `endDate` ≥ `startDate`; duración máx. 90 días |
| `travelers` | entero 1–20 |
| `budget` | número > 0 (máx. 2 decimales, ≤ 100 000 000) |
| `price` | número ≥ 0 (mismas reglas) |
| `currency` | `COP` \| `USD` |
| `notes` | texto ≤ 1000 |
| `status` (viaje) | `PLANNED` \| `CANCELLED` |
| `type` (reserva) | `FLIGHT` \| `HOTEL` \| `ACTIVITY` |
| `status` (reserva) | `SIMULADA` \| `PENDIENTE` \| `CONFIRMADA` (por defecto `SIMULADA`) |
| `provider` | texto 1–80 |
| `details` | objeto con las claves permitidas por tipo (ver `02-modelo-datos.md`), valores texto ≤ 200, `bookingUrl` que empiece por `https://`, tamaño total ≤ 4 KB |
| itinerario | 1–30 días; fechas únicas dentro de `[startDate, endDate]` del viaje; ≤ 30 ítems por día; `time` `HH:MM`; `title` ≤ 120; `location` ≤ 120; `notes` ≤ 500; `type` ∈ `flight, hotel, activity, meal, transfer, other`; `rainProbability` 0–100 |
| preferencias | `preferredDepartureWindow` ∈ `MORNING, AFTERNOON, NIGHT, ANY`; `budgetStyle` ∈ `ECONOMY, BALANCED, PREMIUM`; `interests` ≤ 10 textos de ≤ 40; `dietary` ≤ 100 |

Reglas de actualización: en `PUT` las validaciones de fecha futura solo se aplican a los campos que **cambian** (así un viaje en curso puede editar sus notas). Los campos desconocidos se rechazan con 400. Los campos de solo lectura (`tripId`, `resId`, `createdBy`, `createdAt`, `updatedAt`) se ignoran si llegan.

## 3. Endpoints

La columna **Lambda** indica la función que atiende la ruta.

| Método y ruta | Lambda | Descripción |
|---|---|---|
| `GET /preferences` | Preferences | Lee las preferencias |
| `PUT /preferences` | Preferences | Guarda las preferencias |
| `GET /trips` | Trips | Lista los viajes |
| `POST /trips` | Trips | Crea un viaje |
| `GET /trips/{tripId}` | Trips | Viaje con itinerario y reservas |
| `PUT /trips/{tripId}` | Trips | Actualiza campos del viaje |
| `DELETE /trips/{tripId}` | Trips | Borra el viaje en cascada |
| `GET /trips/{tripId}/itinerary` | Itineraries | Lee el itinerario |
| `POST /trips/{tripId}/itinerary` | Itineraries | Crea el itinerario |
| `PUT /trips/{tripId}/itinerary` | Itineraries | Reemplaza el itinerario |
| `GET /reservations` | Reservations | Reservas del usuario (`?tripId=` opcional) |
| `POST /trips/{tripId}/reservations` | Reservations | Crea una reserva |
| `GET /trips/{tripId}/reservations/{resId}` | Reservations | Lee una reserva |
| `PUT /trips/{tripId}/reservations/{resId}` | Reservations | Actualiza una reserva |
| `DELETE /trips/{tripId}/reservations/{resId}` | Reservations | Borra una reserva |

### 3.1 Preferencias

**`GET /preferences`** → `200`

```json
{ "preferences": { "preferredDepartureWindow": "MORNING", "budgetStyle": "BALANCED", "interests": ["playa", "gastronomía"], "dietary": "vegetariano", "updatedAt": "2026-11-22T15:04:05Z" } }
```

Si nunca se guardaron, devuelve `200` con `{"preferences": null}`.
Errores: 401, 500.

**`PUT /preferences`** — cuerpo: los cuatro campos de preferencias (todos opcionales; los omitidos se guardan vacíos, es un reemplazo). → `200` con el mismo formato.
Errores: 400, 401, 500.

### 3.2 Viajes

**`GET /trips`** → `200` `{"trips":[{...}]}` ordenados por `startDate` ascendente. Parámetro opcional `?status=PLANNED|CANCELLED`. Sin paginación (máx. 100 por el límite de negocio).
Errores: 400 (status inválido), 401, 500.

**`POST /trips`** — cuerpo:

```json
{ "title": "Fin de semana en Cartagena", "origin": "Bogotá", "destination": "Cartagena",
  "startDate": "2026-12-04", "endDate": "2026-12-07", "travelers": 2,
  "budget": 3500000, "currency": "COP", "notes": "Aniversario" }
```

Obligatorios: todos salvo `notes`. → `201` `{"trip": {...}}` con `tripId`, `status: "PLANNED"`, `createdBy: "user"`, `createdAt`, `updatedAt`. Cabecera `Location: /trips/{tripId}`.
Errores: 400, 401, 409 `LIMIT_REACHED`, 500.

**`GET /trips/{tripId}`** → `200`

```json
{ "trip": {...}, "itinerary": { "days": [...], "updatedAt": "..." } , "reservations": [ {...} ] }
```

`itinerary` es `null` si no existe y `reservations` es `[]` si no hay. Errores: 401, 404, 500.

**`PUT /trips/{tripId}`** — cuerpo parcial con cualquiera de: `title, origin, destination, startDate, endDate, travelers, budget, currency, notes, status`. Se revalidan las fechas con los valores finales. → `200` `{"trip": {...}}`.
Errores: 400, 401, 404, 500.

**`DELETE /trips/{tripId}`** → `204`. Borra viaje, itinerario y reservas en una transacción. Errores: 401, 404, 500.

### 3.3 Itinerario

**`GET /trips/{tripId}/itinerary`** → `200` `{"itinerary": {"tripId":"TRP-...","days":[...],"updatedAt":"..."}}`. Errores: 401, 404 (viaje o itinerario inexistente), 500.

**`POST /trips/{tripId}/itinerary`** — cuerpo `{"days":[ {date, weather?, items:[...]} ]}`. → `201` con el itinerario. Errores: 400, 401, 404 (viaje), 409 `CONFLICT` (ya existe; usar `PUT`), 500.

**`PUT /trips/{tripId}/itinerary`** — mismo cuerpo; reemplaza todo. → `200`. Errores: 400, 401, 404 (viaje o itinerario), 500.

### 3.4 Reservas

**`GET /reservations`** → `200` `{"reservations":[{...}]}` ordenadas por `createdAt` descendente. `?tripId=` filtra por viaje. Errores: 400 (`tripId` con formato inválido), 401, 500.

**`POST /trips/{tripId}/reservations`** — cuerpo:

```json
{ "type": "FLIGHT", "status": "SIMULADA", "provider": "Avianca",
  "details": { "airline": "Avianca", "flightNumber": "AV9821", "departureTime": "2026-12-04T07:15", "arrivalTime": "2026-12-04T08:55",
               "origin": "BOG", "destination": "CTG", "bookingUrl": "https://www.kiwi.com/..." },
  "price": 289000, "currency": "COP" }
```

→ `201` `{"reservation": {...}}` con `resId`, `createdBy: "user"`. Errores: 400, 401, 404 (viaje), 409 `LIMIT_REACHED`, 500.

**`GET /trips/{tripId}/reservations/{resId}`** → `200` `{"reservation": {...}}`. Errores: 401, 404, 500.

**`PUT /trips/{tripId}/reservations/{resId}`** — cuerpo parcial con `status, provider, details, price, currency` (el `type` no cambia). Si llega `details`, se reemplaza completo y se revalida contra el `type`. → `200`. Errores: 400, 401, 404, 500.

**`DELETE /trips/{tripId}/reservations/{resId}`** → `204`. Errores: 401, 404, 500.

## 4. Notas de implementación

- **Rutas protegidas por defecto**: la ruta por defecto del autorizador es "requerido"; ninguna ruta es pública.
- **Registro del usuario**: el primer acceso (cualquier ruta) crea `PROFILE` si no existe (A2 en `02-modelo-datos.md`) con `email` y `name` tomados de los claims.
- **Logs**: se registra `requestId`, ruta, código de respuesta y `sub` hasheado; nunca cuerpos completos ni tokens.
- **Idempotencia**: las creaciones no son idempotentes en esta versión (cada `POST` crea un recurso nuevo). El frontend deshabilita el botón mientras la petición está en curso.
- **Mismo contrato en el canal 2**: las tools del agente invocan la misma lógica con los mismos validadores (ver `04-tools-agentes.md`), por lo que los errores equivalen en código y mensaje.
