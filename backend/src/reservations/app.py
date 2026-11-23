"""ReservationsFunction: reservas SIMULADAS (no hay pagos ni datos de tarjeta)."""

from __future__ import annotations

from common import clock, ids, repository as repo, validation as v
from common.errors import LimitReached, NotFound
from common.runtime import Result, handle
from common.store import ItemAlreadyExists, ItemNotFound


def _sorted(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda r: (r.get("createdAt", ""), r.get("resId", "")), reverse=True)


def list_reservations(req, store) -> Result:
    trip_id = req.param("tripId")
    pk = repo.user_pk(req.user_id)
    if trip_id is not None:
        trip_id = v.validate_trip_id_filter(trip_id)
        items = store.query_prefix(pk, repo.reservation_prefix(trip_id), entity_type="RESERVATION")
    else:
        items = store.query_prefix(pk, "TRIP#", entity_type="RESERVATION")
    return Result(200, {"reservations": [repo.public(r) for r in _sorted(items)]})


def create_reservation(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    repo.get_trip(store, req.user_id, trip_id)
    fields = v.validate_reservation_create(req.fields())
    pk = repo.user_pk(req.user_id)
    if store.count_prefix(pk, repo.reservation_prefix(trip_id), entity_type="RESERVATION") >= repo.MAX_RESERVATIONS_PER_TRIP:
        raise LimitReached(f"El viaje alcanzó el máximo de {repo.MAX_RESERVATIONS_PER_TRIP} reservas.")
    now = clock.now_iso()
    for _ in range(5):
        res_id = ids.new_reservation_id()
        item = {
            "PK": pk, "SK": repo.reservation_sk(trip_id, res_id), "entityType": "RESERVATION",
            "resId": res_id, "tripId": trip_id, **fields,
            "createdBy": "assistant" if req.source == "agent" else "user",
            "createdAt": now, "updatedAt": now,
        }
        try:
            store.put_item(item, must_not_exist=True)
            break
        except ItemAlreadyExists:
            continue
    else:
        raise RuntimeError("No se pudo generar un identificador único")
    headers = {"Location": f"/trips/{trip_id}/reservations/{res_id}"} if req.source == "api" else None
    return Result(201, {"reservation": repo.public(item)}, headers)


def _get_existing(req, store) -> tuple[str, str, dict]:
    trip_id = repo.require_trip_id(req)
    res_id = repo.require_reservation_id(req)
    item = store.get_item(repo.user_pk(req.user_id), repo.reservation_sk(trip_id, res_id), consistent=True)
    if item is None or item.get("entityType") != "RESERVATION":
        raise NotFound("La reserva no existe.")
    return trip_id, res_id, item


def get_reservation(req, store) -> Result:
    return Result(200, {"reservation": repo.public(_get_existing(req, store)[2])})


def update_reservation(req, store) -> Result:
    trip_id, res_id, existing = _get_existing(req, store)
    changes = v.validate_reservation_update(req.fields(), existing)
    changes["updatedAt"] = clock.now_iso()
    try:
        item = store.update_item(repo.user_pk(req.user_id), repo.reservation_sk(trip_id, res_id), changes)
    except ItemNotFound:
        raise NotFound("La reserva no existe.") from None
    return Result(200, {"reservation": repo.public(item)})


def delete_reservation(req, store) -> Result:
    trip_id = repo.require_trip_id(req)
    res_id = repo.require_reservation_id(req)
    repo.require_confirmation(req)
    _get_existing(req, store)
    store.delete_many([(repo.user_pk(req.user_id), repo.reservation_sk(trip_id, res_id))])
    if req.source == "api":
        return Result(204)
    return Result(200, {"deleted": True, "tripId": trip_id, "resId": res_id})


ROUTES = {
    "GET /reservations": list_reservations,
    "POST /trips/{tripId}/reservations": create_reservation,
    "GET /trips/{tripId}/reservations/{resId}": get_reservation,
    "PUT /trips/{tripId}/reservations/{resId}": update_reservation,
    "DELETE /trips/{tripId}/reservations/{resId}": delete_reservation,
}

ACTIONS = {
    "get_reservations": list_reservations,
    "create_reservation": create_reservation,
    "get_reservation": get_reservation,
    "update_reservation": update_reservation,
    "delete_reservation": delete_reservation,
}


def lambda_handler(event, context):
    return handle(event, context, routes=ROUTES, actions=ACTIONS)
