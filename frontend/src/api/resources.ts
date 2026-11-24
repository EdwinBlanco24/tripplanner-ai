import type { ApiClient } from './client'
import type {
  Itinerary,
  ItineraryDay,
  Reservation,
  ReservationInput,
  Trip,
  TripDetailResponse,
  TripInput,
  TripStatus,
} from '../types'

export function createResources(api: ApiClient) {
  return {
    listTrips: async (status?: TripStatus): Promise<Trip[]> =>
      (await api.request<{ trips: Trip[] }>('GET', `/trips${status ? `?status=${status}` : ''}`)).trips,
    createTrip: async (input: TripInput): Promise<Trip> => (await api.request<{ trip: Trip }>('POST', '/trips', input)).trip,
    getTrip: (tripId: string): Promise<TripDetailResponse> => api.request('GET', `/trips/${encodeURIComponent(tripId)}`),
    updateTrip: async (tripId: string, patch: Partial<TripInput> & { status?: TripStatus }): Promise<Trip> =>
      (await api.request<{ trip: Trip }>('PUT', `/trips/${encodeURIComponent(tripId)}`, patch)).trip,
    deleteTrip: (tripId: string): Promise<void> => api.request('DELETE', `/trips/${encodeURIComponent(tripId)}`),

    createItinerary: async (tripId: string, days: ItineraryDay[]): Promise<Itinerary> =>
      (await api.request<{ itinerary: Itinerary }>('POST', `/trips/${encodeURIComponent(tripId)}/itinerary`, { days })).itinerary,
    replaceItinerary: async (tripId: string, days: ItineraryDay[]): Promise<Itinerary> =>
      (await api.request<{ itinerary: Itinerary }>('PUT', `/trips/${encodeURIComponent(tripId)}/itinerary`, { days })).itinerary,

    listReservations: async (tripId?: string): Promise<Reservation[]> =>
      (await api.request<{ reservations: Reservation[] }>('GET', `/reservations${tripId ? `?tripId=${encodeURIComponent(tripId)}` : ''}`))
        .reservations,
    createReservation: async (tripId: string, input: ReservationInput): Promise<Reservation> =>
      (await api.request<{ reservation: Reservation }>('POST', `/trips/${encodeURIComponent(tripId)}/reservations`, input)).reservation,
    getReservation: async (tripId: string, resId: string): Promise<Reservation> =>
      (await api.request<{ reservation: Reservation }>('GET', `/trips/${encodeURIComponent(tripId)}/reservations/${encodeURIComponent(resId)}`))
        .reservation,
    updateReservation: async (tripId: string, resId: string, patch: Partial<Omit<ReservationInput, 'type'>>): Promise<Reservation> =>
      (
        await api.request<{ reservation: Reservation }>(
          'PUT',
          `/trips/${encodeURIComponent(tripId)}/reservations/${encodeURIComponent(resId)}`,
          patch,
        )
      ).reservation,
    deleteReservation: (tripId: string, resId: string): Promise<void> =>
      api.request('DELETE', `/trips/${encodeURIComponent(tripId)}/reservations/${encodeURIComponent(resId)}`),
  }
}

export type Resources = ReturnType<typeof createResources>
