# TripPlanner AI — frontend (canal 1)

Vite + React + TypeScript + PrimeReact. Arranque: `npm ci`, `npm run dev` (http://localhost:5173, puerto fijo por CORS).
Comprobaciones: `npm run lint`, `npm run test`, `npm run build`.

## Datos de ciudades (autocompletado de Origen y Destino)

`public/data/cities.json` se genera con `npm run build:cities` (`scripts/build-cities.mjs`, sin dependencias):
descarga `cities15000.zip` y `admin1CodesASCII.txt` de GeoNames, deja los temporales en la carpeta temporal del
sistema (no en el repo) y escribe `[[nombre, nombreAscii, región, ISO2, población], ...]` ordenado por población.
`nombreAscii` va vacío cuando es igual al nombre. El archivo se versiona y NO entra en el bundle de JavaScript:
se descarga de forma perezosa al primer foco de un campo de ciudad.

**Atribución:** Datos de ciudades: [GeoNames](https://www.geonames.org) (CC BY 4.0).

## Solo desarrollo

`/dev/sandbox` muestra los formularios (Nuevo viaje, Añadir reserva) con servicios simulados, sin sesión ni API.
Esa ruta no existe en el build de producción.
