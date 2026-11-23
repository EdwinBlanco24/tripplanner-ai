"""TripsFunction: viajes (GET/POST /trips, GET/PUT/DELETE /trips/{tripId}) y sus acciones de agente."""

from __future__ import annotations

from common import clock, ids, repository as repo, validation as v
from common.errors import LimitReached, NotFound
from common.runtime import Result, handle
from common.store import ItemAlreadyExists, ItemNotFound


def list_trips(req, store) -> Result:
    status = req.param("status")
    if status is not None:
        status = v.validate_trip_status_filter(status)
    items = store.query_prefix(repo.user_pk(req.user_id), "TRIP#", entity_type="TRIP")
    trips = [repo.public(i) for i in items if status is None or i.get("status") == status]
    trips.sort(key=lambda t: (t.get("startDate", ""), t.get("createdAt", "")))
    return Result(200, {"trips": trips})


def create_trip(req, store) -> Result:
    fields = v.validate_trip_create(req.fields(), clock.today_bogota())
    pk = repo.user_pk(req.user_id)
    if store.count_prefix(pk, "TRIP#", entity_type="TRIP") >= repo.MAX_TRIPS_PER_USER:
        raise LimitReached(f"Alcanzaste el máximo de {repo.MAX_TRIPS_PER_USER} viajes.")
    now = clock.now_iso()
    for _ in range(5):
        trip_id = ids.new_trip_id()
        item = {
            "PK": pk, "SK": repo.trip_sk(trip_id), "entityType": "TRIP", "tripId": trip_id,
            **fields,
            "status": "PLANNED",
            "createdBy": "assistant" if req.source == "agent" else "user",
            "createdAt": now, "updatedAt": now,
        }
        try:
            store.put_item(item, must_not_exist=True)
            break
        except ItemAlreadyExists:
            continue
    else:  # 5 colisiones de un id de 32 bits: prácticamente imposible
        raise RuntimeError("No se pudo generar un identificador único")
    headers = {"Location": f"/trips/{trip_id}"} if req.source == "api" else None
    return Result(201, {"trip": repo.public(item)}, headers)


def get_trip(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    items = store.query_prefix(repo.user_pk(req.user_id), repo.trip_sk(trip_id), consistent=True)
    trip = itinerary = None
    reservations = []
    for item in items:
        kind = item.get("entityType")
        if kind == "TRIP":
            trip = item
        elif kind == "ITINERARY":
            itinerary = item
        elif kind == "RESERVATION":
            reservations.append(item)
    if trip is None:
        raise NotFound("El viaje no existe.")
    reservations.sort(key=lambda r: (r.get("createdAt", ""), r.get("resId", "")), reverse=True)
    return Result(200, {
        "trip": repo.public(trip),
        "itinerary": repo.public_itinerary(itinerary),
        "reservations": [repo.public(r) for r in reservations],
    })


def update_trip(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    existing = repo.get_trip(store, req.user_id, trip_id)
    changes = v.validate_trip_update(req.fields(), existing, clock.today_bogota())
    changes["updatedAt"] = clock.now_iso()
    try:
        item = store.update_item(repo.user_pk(req.user_id), repo.trip_sk(trip_id), changes)
    except ItemNotFound:
        raise NotFound("El viaje no existe.") from None
    return Result(200, {"trip": repo.public(item)})


def delete_trip(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    repo.require_confirmation(req)
    pk = repo.user_pk(req.user_id)
    items = store.query_prefix(pk, repo.trip_sk(trip_id), keys_only=True, consistent=True)
    if not any(i["SK"] == repo.trip_sk(trip_id) for i in items):
        raise NotFound("El viaje no existe.")
    store.delete_many([(i["PK"], i["SK"]) for i in items])  # una transacción: viaje + itinerario + reservas
    if req.source == "api":
        return Result(204)
    return Result(200, {"deleted": True, "tripId": trip_id, "deletedItems": len(items)})


ROUTES = {
    "GET /trips": list_trips,
    "POST /trips": create_trip,
    "GET /trips/{tripId}": get_trip,
    "PUT /trips/{tripId}": update_trip,
    "DELETE /trips/{tripId}": delete_trip,
}

ACTIONS = {
    "get_trips": list_trips,
    "create_trip": create_trip,
    "get_trip": get_trip,
    "update_trip": update_trip,
    "delete_trip": delete_trip,
}


def lambda_handler(event, context):
    return handle(event, context, routes=ROUTES, actions=ACTIONS)
