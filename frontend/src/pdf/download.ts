import { getExchangeRates } from '../config/config'
import type { ItineraryDay, Reservation, Trip } from '../types'
import { tripPdfModel, voucherPdfModel } from './models'

// jsPDF y autotable viven en ./render y SOLO se cargan aqui, con import() dinamico, al pulsar "Descargar PDF".
const loadRenderer = () => import('./render')

/** Genera y descarga TripPlanner_<TRP>.pdf. Devuelve el nombre del archivo. */
export async function downloadTripPdf(args: { trip: Trip; itinerary: { days: ItineraryDay[] } | null; reservations: Reservation[] }): Promise<string> {
  const { buildTripPdf } = await loadRenderer()
  const { doc, filename } = buildTripPdf(tripPdfModel({ ...args, rates: getExchangeRates() }))
  doc.save(filename)
  return filename
}

/** Genera y descarga Comprobante_<RES>.pdf. */
export async function downloadVoucherPdf(args: { trip: Trip; reservation: Reservation; day: ItineraryDay | null }): Promise<string> {
  const { buildVoucherPdf } = await loadRenderer()
  const { doc, filename } = buildVoucherPdf(voucherPdfModel(args))
  doc.save(filename)
  return filename
}
