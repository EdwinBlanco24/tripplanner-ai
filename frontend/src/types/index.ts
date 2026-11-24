export type Currency = 'COP' | 'USD'
export type TripStatus = 'PLANNED' | 'CANCELLED'
export type ReservationType = 'FLIGHT' | 'HOTEL' | 'ACTIVITY'
export type ReservationStatus = 'SIMULADA' | 'PENDIENTE' | 'CONFIRMADA'
export type CreatedBy = 'user' | 'assistant'
export type ItemType = 'flight' | 'hotel' | 'activity' | 'meal' | 'transfer' | 'other'

export interface Trip {
  tripId: string
  title: string
  origin: string
  destination: string
  startDate: string
  endDate: string
  travelers: number
  budget: number
  currency: Currency
  notes?: string
  createdBy: CreatedBy
  status: TripStatus
  createdAt: string
  updatedAt: string
}

export type TripInput = Pick<
  Trip,
  'title' | 'origin' | 'destination' | 'startDate' | 'endDate' | 'travelers' | 'budget' | 'currency'
> & { notes?: string }

export interface DayWeather {
  tempMax?: number
  tempMin?: number
  condition?: string
  rainProbability?: number
}

export interface ItineraryItem {
  time: string
  title: string
  type: ItemType
  location?: string
  notes?: string
}

export interface ItineraryDay {
  date: string
  weather?: DayWeather
  items: ItineraryItem[]
}

export interface Itinerary {
  tripId?: string
  days: ItineraryDay[]
  updatedAt: string
}

export type ReservationDetails = Record<string, string>

export interface Reservation {
  resId: string
  tripId: string
  type: ReservationType
  status: ReservationStatus
  provider: string
  details: ReservationDetails
  price: number
  currency: Currency
  createdBy: CreatedBy
  createdAt: string
  updatedAt: string
}

export interface ReservationInput {
  type: ReservationType
  status: ReservationStatus
  provider: string
  details: ReservationDetails
  price: number
  currency: Currency
}

export interface TripDetailResponse {
  trip: Trip
  itinerary: Itinerary | null
  reservations: Reservation[]
}

export const RESERVATION_STATUSES: ReservationStatus[] = ['SIMULADA', 'PENDIENTE', 'CONFIRMADA']
export const RESERVATION_TYPES: ReservationType[] = ['FLIGHT', 'HOTEL', 'ACTIVITY']
export const ITEM_TYPES: ItemType[] = ['flight', 'hotel', 'activity', 'meal', 'transfer', 'other']
