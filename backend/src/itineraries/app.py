"""ItinerariesFunction: itinerario de un viaje (GET/POST/PUT /trips/{tripId}/itinerary)."""

from __future__ import annotations

from common import clock, repository as repo, validation as v
from common.errors import Conflict, NotFound
from common.runtime import Result, handle
from common.store import ItemAlreadyExists, ItemNotFound


def _build(req, trip_id: str, trip: dict) -> dict:
    days = v.validate_itinerary(req.fields(), trip)
    return {
        "PK": repo.user_pk(req.user_id), "SK": repo.itinerary_sk(trip_id), "entityType": "ITINERARY",
        "tripId": trip_id, "days": days, "updatedAt": clock.now_iso(),
    }


def get_itinerary(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    repo.get_trip(store, req.user_id, trip_id)
    item = store.get_item(repo.user_pk(req.user_id), repo.itinerary_sk(trip_id), consistent=True)
    if item is None:
        raise NotFound("El viaje todavía no tiene itinerario.")
    return Result(200, {"itinerary": repo.public_itinerary(item)})


def create_itinerary(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    trip = repo.get_trip(store, req.user_id, trip_id)
    item = _build(req, trip_id, trip)
    try:
        store.put_item(item, must_not_exist=True)
    except ItemAlreadyExists:
        raise Conflict("El viaje ya tiene itinerario; usa PUT para reemplazarlo.") from None
    return Result(201, {"itinerary": repo.public_itinerary(item)})


def update_itinerary(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    trip = repo.get_trip(store, req.user_id, trip_id)
    item = _build(req, trip_id, trip)
    try:
        store.put_item(item, must_exist=True)
    except ItemNotFound:
        raise NotFound("El viaje todavía no tiene itinerario.") from None
    return Result(200, {"itinerary": repo.public_itinerary(item)})


ROUTES = {
    "GET /trips/{tripId}/itinerary": get_itinerary,
    "POST /trips/{tripId}/itinerary": create_itinerary,
    "PUT /trips/{tripId}/itinerary": update_itinerary,
}

ACTIONS = {
    "get_itinerary": get_itinerary,
    "create_itinerary": create_itinerary,
    "update_itinerary": update_itinerary,
}


def lambda_handler(event, context):
    return handle(event, context, routes=ROUTES, actions=ACTIONS)
