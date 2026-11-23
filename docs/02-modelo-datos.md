# TripPlanner AI — Modelo de datos

Tabla única **`TripPlannerTable`** · DynamoDB on-demand · cifrado en reposo con la clave administrada por AWS (`aws/dynamodb`, `SSEEnabled: true`) · PITR activado · protección contra borrado.

- Clave de partición `PK` (string) y clave de ordenación `SK` (string).
- Atributo `entityType` en todos los ítems: `PROFILE`, `PREFS`, `TRIP`, `ITINERARY`, `RESERVATION`.
- Todo ítem de un usuario cuelga de `PK = USER#<sub>`, donde `<sub>` es el claim `sub` del JWT de Cognito.
- Fechas de negocio `YYYY-MM-DD`; marcas de tiempo `createdAt`/`updatedAt` en ISO-8601 UTC.
- Dinero: tipo `Number` de DynamoDB (la Lambda usa `Decimal`, nunca `float`).
- **Prohibido guardar datos de tarjetas** (número, CVV, vencimiento) ni credenciales de pago.

## 1. Ítems

### 1.1 Perfil — `PK=USER#<sub>`, `SK=PROFILE`

| Atributo | Tipo | Notas |
|---|---|---|
| `entityType` | S | `PROFILE` |
| `email` | S | **No se guarda hoy**: el canal 1 usa el *access token* de Cognito, que no incluye `email` ni `name`. Solo se guardaría si el token los trae (p. ej. un ID token) |
| `name` | S | Nombre visible, máx. 80 |
| `createdAt` | S | Se fija en el primer acceso |

### 1.2 Preferencias — `SK=PREFS`

| Atributo | Tipo | Notas |
|---|---|---|
| `entityType` | S | `PREFS` |
| `preferredDepartureWindow` | S | `MORNING` \| `AFTERNOON` \| `NIGHT` \| `ANY` |
| `budgetStyle` | S | `ECONOMY` \| `BALANCED` \| `PREMIUM` |
| `interests` | L de S | Hasta 10 elementos, máx. 40 caracteres cada uno |
| `dietary` | S | Máx. 100 |
| `updatedAt` | S | |

### 1.3 Viaje — `SK=TRIP#<tripId>`

| Atributo | Tipo | Notas |
|---|---|---|
| `entityType` | S | `TRIP` |
| `tripId` | S | `TRP-` + 8 caracteres hexadecimales en minúscula (de un UUID v4) |
| `title` | S | 1–120 |
| `origin`, `destination` | S | 2–80 (ciudad o código IATA) |
| `startDate`, `endDate` | S | `YYYY-MM-DD`, `endDate ≥ startDate` |
| `travelers` | N | Entero 1–20 |
| `budget` | N | > 0 |
| `currency` | S | `COP` \| `USD` |
| `notes` | S | Máx. 1000, opcional |
| `createdBy` | S | `user` \| `assistant` |
| `status` | S | `PLANNED` \| `CANCELLED` |
| `createdAt`, `updatedAt` | S | |

### 1.4 Itinerario — `SK=TRIP#<tripId>#ITIN` (uno por viaje)

| Atributo | Tipo | Notas |
|---|---|---|
| `entityType` | S | `ITINERARY` |
| `tripId` | S | |
| `days` | L de M | Hasta 30 días (ver estructura) |
| `updatedAt` | S | |

Estructura de `days[]`:

```json
{
  "date": "2026-12-04",
  "weather": { "tempMax": 31, "tempMin": 24, "condition": "Parcialmente nublado", "rainProbability": 20 },
  "items": [
    { "time": "07:15", "title": "Vuelo Bogotá → Cartagena", "type": "flight",
      "location": "Aeropuerto El Dorado", "notes": "Llegar 2 h antes" }
  ]
}
```

- `weather` es opcional. `tempMax`/`tempMin` en °C, `rainProbability` 0–100.
- `items[].type`: `flight` \| `hotel` \| `activity` \| `meal` \| `transfer` \| `other`. `time` en `HH:MM`. Hasta 30 ítems por día.

### 1.5 Reserva — `SK=TRIP#<tripId>#RES#<resId>`

| Atributo | Tipo | Notas |
|---|---|---|
| `entityType` | S | `RESERVATION` |
| `resId` | S | `RES-` + 8 hexadecimales |
| `tripId` | S | |
| `type` | S | `FLIGHT` \| `HOTEL` \| `ACTIVITY` |
| `status` | S | `SIMULADA` \| `PENDIENTE` \| `CONFIRMADA` |
| `provider` | S | Máx. 80 (p. ej. aerolínea u hotel) |
| `details` | M | Según `type` (ver abajo); máx. 4 KB |
| `price` | N | ≥ 0 |
| `currency` | S | `COP` \| `USD` |
| `createdBy` | S | `user` \| `assistant` |
| `createdAt`, `updatedAt` | S | |

`details` por tipo:

| `type` | Claves | Obligatorias |
|---|---|---|
| `FLIGHT` | `airline`, `flightNumber`, `departureTime`, `arrivalTime`, `origin`, `destination`, `bookingUrl` | `flightNumber`, `origin`, `destination`, `departureTime` |
| `HOTEL` | `hotelName`, `checkIn`, `checkOut` | las tres |
| `ACTIVITY` | `activityName`, `date`, `time` | `activityName`, `date` |

`bookingUrl` debe empezar por `https://`. La reserva es **simulada**: no se contacta con el proveedor ni se cobra.

### 1.6 Límites de negocio

Hasta **100 viajes por usuario** y **50 reservas por viaje**. Así, un viaje completo (1 viaje + 1 itinerario + 50 reservas = 52 ítems) cabe en una sola transacción de DynamoDB (máx. 100 ítems).

**Riesgo aceptado: los límites no son atómicos.** La Lambda cuenta los ítems (`Query` con `Select=COUNT`) y luego crea el nuevo con otra operación. Dos peticiones simultáneas del mismo usuario podrían pasar el límite por una unidad. Se acepta porque cada usuario opera casi siempre de forma secuencial y el exceso no compromete la integridad: el borrado en cascada sigue cabiendo en una transacción mientras el total no supere 100 ítems. Si deja de ser aceptable, se añadiría un contador en el ítem `PROFILE` con una condición de actualización atómica.

## 2. Patrones de acceso

Las expresiones usan alias (`#name`, `#status`, `#type`, `#notes`…) porque varios atributos son palabras reservadas de DynamoDB.

| # | Patrón | Operación | Clave / condición |
|---|---|---|---|
| A1 | Leer perfil | `GetItem` | `PK=USER#sub, SK=PROFILE` |
| A2 | Crear perfil en el primer acceso | `PutItem` | Condición `attribute_not_exists(PK)` |
| A3 | Leer preferencias | `GetItem` | `SK=PREFS` |
| A4 | Guardar preferencias | `PutItem` (reemplazo) | Sin condición; fija `updatedAt` |
| A5 | Listar viajes del usuario | `Query` | `PK=USER#sub AND begins_with(SK,'TRIP#')` + `FilterExpression entityType = :trip` |
| A6 | Obtener un viaje | `GetItem` | `SK=TRIP#<tripId>` |
| A7 | Obtener viaje con itinerario y reservas | `Query` | `PK=USER#sub AND begins_with(SK,'TRIP#<tripId>')`; el código separa por `entityType` |
| A8 | Crear viaje | `PutItem` | Condición `attribute_not_exists(PK)`; antes se comprueba el límite de 100 viajes (A5 con `Select=COUNT`) |
| A9 | Actualizar viaje | `UpdateItem` | Condición `attribute_exists(PK)`; fija `updatedAt` |
| A10 | Crear itinerario | `PutItem` | `SK=TRIP#<id>#ITIN`, condición `attribute_not_exists(PK)` (409 si ya existe); antes se verifica que el viaje exista (A6) |
| A11 | Reemplazar itinerario | `PutItem` | Condición `attribute_exists(PK)` (404 si no existe) |
| A12 | Leer itinerario | `GetItem` | `SK=TRIP#<id>#ITIN` |
| A13 | Crear reserva | `PutItem` | Condición `attribute_not_exists(PK)`; antes se verifica el viaje y el límite de 50 reservas (A14 con `Select=COUNT`) |
| A14 | Reservas de un viaje | `Query` | `PK=USER#sub AND begins_with(SK,'TRIP#<tripId>#RES#')` |
| A15 | Todas las reservas del usuario | `Query` | `begins_with(SK,'TRIP#')` + `FilterExpression entityType = :res` |
| A16 | Obtener una reserva | `GetItem` | `SK=TRIP#<id>#RES#<resId>` |
| A17 | Actualizar reserva | `UpdateItem` | Condición `attribute_exists(PK)` |
| A18 | Eliminar reserva | `DeleteItem` | Condición `attribute_exists(PK)` |
| A19 | **Eliminar viaje en cascada** | `Query` (solo claves) + `TransactWriteItems` | Ver 2.1 |

**Seguridad por construcción.** Ninguna operación acepta un `PK` que venga del cliente: la Lambda lo arma siempre como `USER#` + `sub` del token (canal 1) o del `userId` inyectado por el Orchestrator (canal 2). Un `tripId` ajeno simplemente no existe bajo esa `PK` y produce 404.

**Prefijo seguro.** Como todos los `tripId` miden lo mismo (`TRP-` + 8 caracteres), `begins_with(SK,'TRIP#TRP-1a2b3c4d')` solo alcanza al viaje, a su itinerario y a sus reservas; nunca a otro viaje.

### 2.1 Borrado en cascada de un viaje

1. `Query` con `PK=USER#sub AND begins_with(SK,'TRIP#<tripId>')`, `ProjectionExpression = PK, SK`.
2. Si no devuelve nada, responde 404.
3. `TransactWriteItems` con un `Delete` por cada clave (hasta 52 por el límite de 1.6). Es atómico: o se borra todo o nada.
4. Si en el futuro se supera el límite de 100 ítems por transacción, se usa `BatchWriteItem` en bloques de 25 con reintento de no procesados (se pierde la atomicidad; documentarlo entonces).

## 3. ¿Por qué no hay índice secundario (GSI)?

A esta escala (decenas de viajes por usuario, ítems de pocos KB) todas las consultas se resuelven por `PK` y prefijo de `SK`. Los dos filtros (A5 y A15) leen ítems que luego descartan, pero el volumen por usuario es pequeño y el coste es despreciable. Un GSI añadiría escrituras duplicadas y complejidad sin beneficio.

**Cuándo se añadiría:**

- Listar viajes ordenados por fecha de inicio o próximos a empezar → GSI con `PK=USER#sub` y `SK=startDate`, *sparse* (solo ítems `TRIP`).
- Consultar reservas por estado en todos los usuarios (operación o soporte) → GSI con `PK=status`, `SK=createdAt`.
- Si el número de viajes por usuario supera cientos y el filtro empieza a pesar en el rendimiento.
- Cualquier lectura "entre usuarios" (la tabla actual no la permite por diseño).

## 4. Consistencia y concurrencia

- Las lecturas de negocio que siguen a una escritura (p. ej. mostrar el viaje recién creado) usan `ConsistentRead=true`.
- Las creaciones usan condición de existencia para evitar sobrescribir (409 `CONFLICT`).
- Las actualizaciones son de "último escritor gana" y actualizan `updatedAt`. Si la edición simultánea entre canal 1 y canal 2 se vuelve un problema real, se añade un atributo `version` con condición de igualdad.
- Los identificadores se generan en la Lambda, nunca en el cliente ni en el LLM.
