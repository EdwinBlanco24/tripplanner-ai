// Unico modulo que importa jsPDF. Se carga SIEMPRE con import() dinamico (ver download.ts): chunk aparte.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { SIMULATED_NOTE, type DayModel, type TripPdfModel, type VoucherPdfModel } from './models'

const PRIMARY: [number, number, number] = [15, 118, 110] // #0F766E
const PRIMARY_DARK: [number, number, number] = [17, 94, 89]
const TEXT: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [71, 85, 105]
const MARGIN = 15
const TOP = 24 // deja sitio a la cabecera de cada pagina
const BOTTOM = 18 // y al pie

export interface BuiltPdf {
  doc: jsPDF
  filename: string
}

class Cursor {
  y = TOP
  constructor(readonly doc: jsPDF) {}
  get width() {
    return this.doc.internal.pageSize.getWidth() - MARGIN * 2
  }
  get limit() {
    return this.doc.internal.pageSize.getHeight() - BOTTOM
  }
  ensure(h: number) {
    if (this.y + h > this.limit) {
      this.doc.addPage()
      this.y = TOP
    }
  }
  heading(text: string, size = 14) {
    this.y += 3
    this.ensure(size + 6)
    this.doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...PRIMARY_DARK)
    this.doc.text(text, MARGIN, this.y)
    this.y += size * 0.5 + 2
  }
  paragraph(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...(opts.color ?? TEXT))
    const lines = this.doc.splitTextToSize(text, this.width) as string[]
    for (const line of lines) {
      this.ensure(size * 0.5)
      this.doc.text(line, MARGIN, this.y)
      this.y += size * 0.45 + 1
    }
    this.y += opts.gap ?? 1
  }
  kv(rows: [string, string][]) {
    if (rows.length === 0) return
    autoTable(this.doc, {
      startY: this.y,
      body: rows,
      theme: 'plain',
      margin: { left: MARGIN, right: MARGIN, top: TOP, bottom: BOTTOM },
      styles: { font: 'helvetica', fontSize: 10, textColor: TEXT, cellPadding: { top: 1, bottom: 1, left: 0, right: 2 } },
      columnStyles: { 0: { fontStyle: 'bold', textColor: MUTED, cellWidth: 40 } },
    })
    this.y = this.lastY() + 5
  }
  table(head: string[], rows: string[][], widths?: Record<number, number>) {
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: rows,
      margin: { left: MARGIN, right: MARGIN, top: TOP, bottom: BOTTOM },
      headStyles: { fillColor: PRIMARY, textColor: 255, font: 'helvetica', fontStyle: 'bold' },
      styles: { font: 'helvetica', fontSize: 9, textColor: TEXT, cellPadding: 2 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: Object.fromEntries(Object.entries(widths ?? {}).map(([k, v]) => [k, { cellWidth: v }])),
    })
    this.y = this.lastY() + 6
  }
  lastY(): number {
    return (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? this.y
  }
}

function day(cur: Cursor, d: DayModel) {
  cur.ensure(24)
  cur.heading(d.heading, 12)
  cur.paragraph(`Clima: ${d.weather}`, { size: 9.5, color: MUTED })
  if (d.activities.length === 0) cur.paragraph('Sin actividades.', { size: 9.5, color: MUTED, gap: 3 })
  else cur.table(['Hora', 'Actividad', 'Lugar'], d.activities.map((a) => [a.time, a.title, a.place]), { 0: 18 })
}

/** Cabecera ("TripPlanner AI" + fecha de generacion) y pie (aviso y "Pagina X de Y") en TODAS las paginas. */
function decorate(doc: jsPDF, generated: string) {
  const total = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFillColor(...PRIMARY).rect(0, 0, w, 3, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...PRIMARY_DARK)
    doc.text('TripPlanner AI', MARGIN, 12)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED)
    doc.text(generated, w - MARGIN, 12, { align: 'right' })
    doc.setDrawColor(203, 213, 225).line(MARGIN, 15, w - MARGIN, 15)
    doc.line(MARGIN, h - 13, w - MARGIN, h - 13)
    doc.setFontSize(8.5)
    doc.text(SIMULATED_NOTE, MARGIN, h - 8)
    doc.text(`Página ${i} de ${total}`, w - MARGIN, h - 8, { align: 'right' })
  }
}

function newDoc(): jsPDF {
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
}

export function buildTripPdf(m: TripPdfModel): BuiltPdf {
  const doc = newDoc()
  doc.setProperties({ title: `${m.title} - ${m.tripId}`, subject: 'Resumen de viaje', author: 'TripPlanner AI' })
  const cur = new Cursor(doc)

  // Portada
  cur.y = 32
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...PRIMARY_DARK)
  const titleLines = doc.splitTextToSize(m.title, cur.width) as string[]
  titleLines.forEach((l) => {
    doc.text(l, MARGIN, cur.y)
    cur.y += 9
  })
  cur.paragraph(m.tripId, { size: 10, color: MUTED, gap: 4 })
  cur.kv([
    ['Ruta', m.route],
    ['Fechas', m.dates],
    ['Viajeros', m.travelers],
    ['Presupuesto', m.budget],
  ])
  cur.heading('Resumen del presupuesto', 12)
  m.budgetSummary.forEach((l, i) => cur.paragraph(l, { size: i === m.budgetSummary.length - 1 ? 8.5 : 10, color: i === m.budgetSummary.length - 1 ? MUTED : TEXT }))
  cur.y += 4

  // Reservas
  cur.heading('Reservas')
  if (m.reservations.rows.length === 0) cur.paragraph('Este viaje aún no tiene reservas.', { color: MUTED, gap: 4 })
  else cur.table(m.reservations.head, m.reservations.rows, { 0: 26, 1: 18, 3: 24, 4: 28, 5: 22 })

  // Itinerario
  cur.ensure(30)
  cur.heading('Itinerario')
  if (!m.hasItinerary || m.days.length === 0) cur.paragraph('Este viaje aún no tiene itinerario.', { color: MUTED })
  else m.days.forEach((d) => day(cur, d))

  decorate(doc, m.generatedLabel)
  return { doc, filename: m.filename }
}

export function buildVoucherPdf(m: VoucherPdfModel): BuiltPdf {
  const doc = newDoc()
  doc.setProperties({ title: m.heading, subject: 'Comprobante de reserva', author: 'TripPlanner AI' })
  const cur = new Cursor(doc)
  cur.y = 30
  cur.paragraph('Comprobante de reserva', { size: 10, color: MUTED, gap: 1 })
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...PRIMARY_DARK)
  doc.text(m.heading, MARGIN, cur.y)
  cur.y += 9
  cur.paragraph(`Estado: ${m.status}`, { bold: true, size: 11, gap: 3 })
  if (m.simulated) cur.paragraph(SIMULATED_NOTE + '.', { size: 10, color: [180, 83, 9], gap: 4 })

  cur.heading('Reserva', 12)
  cur.kv([['Proveedor', m.provider], ...m.details, ['Precio', m.price]])
  if (m.bookingUrl) cur.kv([['Enlace de reserva', m.bookingUrl]])

  cur.heading('Viaje', 12)
  cur.kv(m.trip)

  cur.heading('Día del itinerario', 12)
  if (m.day) day(cur, m.day)
  else cur.paragraph('Este viaje no tiene un día de itinerario para la fecha de esta reserva.', { color: MUTED })

  decorate(doc, m.generatedLabel)
  return { doc, filename: m.filename }
}
