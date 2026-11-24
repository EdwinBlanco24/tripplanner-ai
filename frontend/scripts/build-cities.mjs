// Genera public/data/cities.json desde GeoNames (cities15000 + admin1CodesASCII). Uso: npm run build:cities
// Sin dependencias: el zip se lee con node:zlib. Los archivos descargados van a la carpeta temporal del sistema, nunca al repo.
// Formato de salida: [[nombre, nombreAscii, region, ISO2, poblacion], ...] ordenado por poblacion desc.
// nombreAscii va vacio ("") cuando es igual a nombre (ahorra bytes; el cliente lo trata como "igual").
// Datos: GeoNames (https://www.geonames.org), licencia CC BY 4.0.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync, gzipSync } from 'node:zlib'

const BASE = 'https://download.geonames.org/export/dump/'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'cities.json')

async function download(name) {
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`No se pudo descargar ${name}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Extrae la primera entrada de un zip (metodo 0 o 8) leyendo el directorio central. */
function unzipFirst(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip invalido (sin EOCD)')
  const cd = buf.readUInt32LE(eocd + 16)
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip invalido (directorio central)')
  const method = buf.readUInt16LE(cd + 10)
  const csize = buf.readUInt32LE(cd + 20)
  const local = buf.readUInt32LE(cd + 42)
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
  const data = buf.subarray(start, start + csize)
  return method === 0 ? data : inflateRawSync(data)
}

const tmp = mkdtempSync(join(tmpdir(), 'geonames-'))
try {
  const [zip, admin] = await Promise.all([download('cities15000.zip'), download('admin1CodesASCII.txt')])
  writeFileSync(join(tmp, 'cities15000.zip'), zip)
  const regions = new Map()
  for (const line of admin.toString('utf8').split('\n')) {
    const [code, name] = line.split('\t')
    if (code && name) regions.set(code, name)
  }
  const rows = []
  for (const line of unzipFirst(zip).toString('utf8').split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    const [, name, ascii, , , , , , cc, , admin1] = f
    const pop = Number.parseInt(f[14], 10) || 0
    rows.push([name, ascii === name ? '' : ascii, regions.get(`${cc}.${admin1}`) ?? '', cc, pop])
  }
  rows.sort((a, b) => b[4] - a[4])
  const json = JSON.stringify(rows)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, json)
  const gz = gzipSync(json, { level: 9 }).length
  console.log(`cities.json: ${rows.length} ciudades, ${Buffer.byteLength(json)} bytes (${(Buffer.byteLength(json) / 1024).toFixed(0)} KiB), gzip ${gz} bytes (${(gz / 1024).toFixed(0)} KiB)`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
