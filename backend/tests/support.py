"""Ayudantes de pruebas: almacén DynamoDB en memoria, constructores de eventos y reloj fijo.

Solo usa la librería estándar. Los tests importan `import support` (el directorio tests/ queda en sys.path
con `python -m unittest discover -s tests`).
"""

from __future__ import annotations

import copy
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from common import logs, store as store_module  # noqa: E402
from common.store import ItemAlreadyExists, ItemNotFound  # noqa: E402

# 2026-11-22 15:00 UTC = 10:00 en Bogotá
FIXED_NOW = datetime(2026, 11, 22, 15, 0, 0, tzinfo=timezone.utc)
START, END = "2026-12-04", "2026-12-07"
USER_A = "11111111-aaaa-bbbb-cccc-000000000001"
USER_B = "22222222-aaaa-bbbb-cccc-000000000002"


class MemoryStore:
    """Imita las operaciones de DynamoStore sobre un diccionario."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict] = {}
        self.transactions: list[list[tuple[str, str]]] = []

    def get_item(self, pk, sk, consistent=False):
        item = self.items.get((pk, sk))
        return copy.deepcopy(item) if item else None

    def put_item(self, item, *, must_not_exist=False, must_exist=False):
        key = (item["PK"], item["SK"])
        if must_not_exist and key in self.items:
            raise ItemAlreadyExists()
        if must_exist and key not in self.items:
            raise ItemNotFound()
        self.items[key] = copy.deepcopy(item)

    def update_item(self, pk, sk, updates):
        if (pk, sk) not in self.items:
            raise ItemNotFound()
        item = self.items[(pk, sk)]
        for attr, value in updates.items():
            if value is None:
                item.pop(attr, None)
            else:
                item[attr] = copy.deepcopy(value)
        return copy.deepcopy(item)

    def _matching(self, pk, prefix, entity_type):
        rows = [it for (p, s), it in sorted(self.items.items()) if p == pk and s.startswith(prefix)]
        return [it for it in rows if entity_type is None or it.get("entityType") == entity_type]

    def query_prefix(self, pk, prefix, *, entity_type=None, keys_only=False, consistent=False):
        rows = self._matching(pk, prefix, entity_type)
        if keys_only:
            return [{"PK": r["PK"], "SK": r["SK"]} for r in rows]
        return copy.deepcopy(rows)

    def count_prefix(self, pk, prefix, *, entity_type=None):
        return len(self._matching(pk, prefix, entity_type))

    def delete_many(self, keys):
        self.transactions.append(list(keys))
        for key in keys:
            self.items.pop(key, None)


class FakeContext:
    aws_request_id = "req-test-1"


def api_event(route_key, *, path_params=None, query=None, body=None, sub=USER_A, claims=None, raw_body=None):
    all_claims = {"sub": sub} if sub is not None else {}
    all_claims.update(claims or {})
    event = {
        "version": "2.0",
        "routeKey": route_key,
        "rawPath": "/x",
        "headers": {"content-type": "application/json"},
        "pathParameters": path_params,
        "queryStringParameters": query,
        "requestContext": {"authorizer": {"jwt": {"claims": all_claims}} if sub is not None or claims else {}},
        "isBase64Encoded": False,
    }
    if raw_body is not None:
        event["body"] = raw_body
    elif body is not None:
        event["body"] = json.dumps(body)
    return event


def agent_event(action, payload=None, user_id=USER_A):
    event = {"source": "agent", "action": action}
    if user_id is not None:
        event["userId"] = user_id
    if payload is not None:
        event["payload"] = payload
    return event


def trip_body(**overrides):
    body = {
        "title": "Fin de semana en Cartagena", "origin": "Bogotá", "destination": "Cartagena",
        "startDate": START, "endDate": END, "travelers": 3, "budget": 5000000, "currency": "COP",
    }
    body.update(overrides)
    return body


def flight_reservation(**overrides):
    body = {
        "type": "FLIGHT", "provider": "Avianca",
        "details": {"airline": "Avianca", "flightNumber": "AV9821", "origin": "BOG", "destination": "CTG",
                    "departureTime": "2026-12-04T07:15", "bookingUrl": "https://www.kiwi.com/x"},
        "price": 289000, "currency": "COP",
    }
    body.update(overrides)
    return body


def body_of(response) -> dict:
    return json.loads(response["body"]) if response.get("body") else {}


class BaseCase(unittest.TestCase):
    """Reloj fijo, almacén en memoria inyectado y log capturado."""

    def setUp(self) -> None:
        self.store = MemoryStore()
        store_module.set_store(self.store)
        self.logged: list[dict] = []
        logs.set_sink(self.logged.append)
        patcher = mock.patch("common.clock.utcnow", return_value=FIXED_NOW)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(logs.set_sink, None)
        self.addCleanup(store_module.set_store, None)

    # Atajos que invocan los handlers reales
    def trips(self, event):
        from trips import app
        return app.lambda_handler(event, FakeContext())

    def itineraries(self, event):
        from itineraries import app
        return app.lambda_handler(event, FakeContext())

    def reservations(self, event):
        from reservations import app
        return app.lambda_handler(event, FakeContext())

    def preferences(self, event):
        from preferences import app
        return app.lambda_handler(event, FakeContext())

    def create_trip(self, sub=USER_A, **overrides) -> str:
        resp = self.trips(api_event("POST /trips", body=trip_body(**overrides), sub=sub))
        self.assertEqual(resp["statusCode"], 201, resp["body"])
        return body_of(resp)["trip"]["tripId"]
