# Evidencias de funcionamiento

Capturas reales de la aplicación desplegada (https://d2d27liabon15k.cloudfront.net) y de la consola de AWS. Se añaden con **estos nombres exactos** para que el README de la raíz las enlace. Mientras un archivo no exista, su enlace aparecerá roto: es un pendiente de captura, no un error de la documentación.

| Archivo | Paso del escenario | Qué debe mostrar |
|---|---|---|
| `01-login.png` | 1 · Ingresa | Pantalla de acceso con la cuenta de evaluación (sin la contraseña visible). |
| `02-asistente-solicitud.png` | 2 · Asistente | La solicitud del PDF enviada con el primer chip de sugerencias. |
| `03-04-05-orquestacion-vuelos-clima.png` | 3, 4 y 5 · Orquestación | Las líneas de estado del asistente: consulta al agente de vuelos (MCP de Kiwi) y al de clima (MCP propio sobre Open-Meteo). |
| `06-resultados.png` | 6 · Presentación | El lienzo con las pestañas Vuelos y Clima y la respuesta resumida del asistente. |
| `07-viaje-creado.png` | 7 · Crear viaje | El viaje creado con «Crear el viaje» (pestaña Viaje o «Mis viajes»). |
| `08-itinerario.png` | 8 · Itinerario | El itinerario día a día generado con «Generar itinerario con actividades». |
| `09-reserva.png` | 9 · Reserva | La reserva simulada creada desde «Reservar» en una tarjeta de vuelo. |
| `10-dynamodb.png` | 10 · DynamoDB | Consola de DynamoDB, tabla `TripPlannerTable`: ítems `USER#<sub>` con `TRIP#…`, `TRIP#…#ITIN` y `TRIP#…#RES#…` (ocultar el `sub` si se desea). |
| `11-12-recupera-datos.png` | 11 y 12 · Cierra y vuelve | Después de «Cerrar sesión» y volver a ingresar: «Mis viajes» y «Reservas» con los datos guardados. |
| `13-pdf-viaje.png` | Opcional · PDF | El PDF real del viaje descargado (itinerario, reservas y presupuesto). |
| `14-presupuesto.png` | Opcional · Presupuesto | El comparador de presupuesto del detalle del viaje (estado y porcentaje usado). |
| `15-preferencias.png` | Opcional · Preferencias | La pantalla «Mis preferencias» guardada, y/o la franja «Usando tus preferencias» en el asistente. |
| `16-cloudwatch-mcp.png` | Observabilidad | Logs de CloudWatch de `WeatherMcpServer` o de `FlightsAgent` mostrando llamadas MCP. |
| `17-agentcore-runtimes.png` | Arquitectura | Consola de AgentCore: los cuatro runtimes (OrchestratorAgent, FlightsAgent, WeatherAgent, WeatherMcpServer) en estado listo y la Memory `TripPlannerMemory`. |

## Capturas de desarrollo

La carpeta [`frontend/docs-evidencia/`](../../frontend/docs-evidencia/) guarda las capturas que se tomaron durante el desarrollo con las rutas de pruebas locales (`/dev/*`, datos de ejemplo, sin sesión real). No sustituyen a las capturas de esta carpeta, que corresponden a la aplicación desplegada.

## Reglas

- No capturar contraseñas, tokens ni códigos de verificación.
- Preferir 1280×800 de ancho de ventana para las pantallas de la aplicación.
