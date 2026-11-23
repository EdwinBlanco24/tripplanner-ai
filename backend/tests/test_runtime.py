import json
import unittest
from unittest import mock

import support
from common import jsonutil
from common.request import ACTION_ALIASES
from support import api_event, agent_event, body_of


class RuntimeTests(support.BaseCase):
    def test_unexpected_exception_returns_a_generic_500_without_internals(self):
        with mock.patch.object(self.store, "query_prefix", side_effect=RuntimeError("secret table detail 12345")):
            resp = self.trips(api_event("GET /trips"))
        self.assertEqual(resp["statusCode"], 500)
        error = body_of(resp)["error"]
        self.assertEqual(error["code"], "INTERNAL_ERROR")
        self.assertNotIn("secret", resp["body"])
        self.assertNotIn("12345", resp["body"])

    def test_agent_500_has_the_agent_format(self):
        with mock.patch.object(self.store, "query_prefix", side_effect=RuntimeError("boom")):
            resp = self.trips(agent_event("get_trips", {}))
        self.assertEqual((resp["ok"], resp["statusCode"], resp["error"]["code"]), (False, 500, "INTERNAL_ERROR"))
        self.assertNotIn("boom", json.dumps(resp))

    def test_logs_are_structured_and_contain_no_user_data_or_tokens(self):
        email = "ana@example.com"
        self.trips(api_event("POST /trips", body=support.trip_body(title="Mi viaje secreto"), claims={"email": email}))
        self.assertEqual(len([r for r in self.logged if r["event"] == "request"]), 1)
        record = next(r for r in self.logged if r["event"] == "request")
        self.assertEqual((record["source"], record["action"], record["status"]), ("api", "POST /trips", 201))
        self.assertEqual(record["requestId"], "req-test-1")
        self.assertIn("latencyMs", record)
        dumped = json.dumps(self.logged)
        for forbidden in (support.USER_A, email, "Mi viaje secreto", "Bogotá", "5000000"):
            self.assertNotIn(forbidden, dumped)
        self.assertEqual(len(record["user"]), 12)

    def test_error_logs_have_level_error_only_for_5xx(self):
        self.trips(api_event("GET /trips/{tripId}", path_params={"tripId": "TRP-00000000"}))
        self.assertEqual(self.logged[-1]["level"], "INFO")
        with mock.patch.object(self.store, "query_prefix", side_effect=RuntimeError("x")):
            self.trips(api_event("GET /trips"))
        self.assertEqual((self.logged[-1]["level"], self.logged[-1]["errorType"]), ("ERROR", "RuntimeError"))

    def test_profile_failure_does_not_break_the_request(self):
        with mock.patch.object(self.store, "put_item", side_effect=[RuntimeError("down"), None]):
            resp = self.trips(api_event("GET /trips"))
        self.assertEqual(resp["statusCode"], 200)

    def test_agent_calls_do_not_create_profiles(self):
        self.trips(agent_event("get_trips", {}))
        self.assertEqual(self.store.items, {})

    def test_every_alias_points_to_a_canonical_action_that_some_function_serves(self):
        import itineraries.app, preferences.app, reservations.app, trips.app
        served = set()
        for module in (trips.app, itineraries.app, reservations.app, preferences.app):
            served.update(module.ACTIONS)
        required = {"create_trip", "get_trips", "get_trip", "update_trip", "delete_trip", "create_itinerary", "get_itinerary",
                    "update_itinerary", "create_reservation", "get_reservations", "get_reservation", "update_reservation",
                    "delete_reservation", "get_preferences", "update_preferences"}
        self.assertEqual(served, required)
        self.assertTrue(set(ACTION_ALIASES.values()) <= required)

    def test_route_tables_match_docs_03_api(self):
        import itineraries.app, preferences.app, reservations.app, trips.app
        routes = {}
        for module in (trips.app, itineraries.app, reservations.app, preferences.app):
            routes.update(module.ROUTES)
        expected = {
            "GET /preferences", "PUT /preferences", "GET /trips", "POST /trips", "GET /trips/{tripId}", "PUT /trips/{tripId}",
            "DELETE /trips/{tripId}", "GET /trips/{tripId}/itinerary", "POST /trips/{tripId}/itinerary",
            "PUT /trips/{tripId}/itinerary", "GET /reservations", "POST /trips/{tripId}/reservations",
            "GET /trips/{tripId}/reservations/{resId}", "PUT /trips/{tripId}/reservations/{resId}",
            "DELETE /trips/{tripId}/reservations/{resId}",
        }
        self.assertEqual(set(routes), expected)

    def test_json_encoding_of_decimals(self):
        from decimal import Decimal
        self.assertEqual(jsonutil.dumps({"a": Decimal("5000000"), "b": Decimal("1.5")}), '{"a":5000000,"b":1.5}')

    def test_responses_are_json_with_no_store(self):
        resp = self.trips(api_event("GET /trips"))
        self.assertEqual(resp["headers"]["Content-Type"], "application/json")
        self.assertEqual(resp["headers"]["Cache-Control"], "no-store")
        self.assertIs(resp["isBase64Encoded"], False)


class DynamoStoreTests(unittest.TestCase):
    """DynamoStore con un cliente falso: comprueba las expresiones sin red ni boto3 real de AWS."""

    def setUp(self):
        try:
            import boto3  # noqa: F401
        except ImportError:
            self.skipTest("boto3 no está disponible en este intérprete")
        from common.store import DynamoStore
        self.client = mock.MagicMock()
        self.store = DynamoStore("tbl", client=self.client)

    def test_put_item_conditions_and_error_mapping(self):
        from common.store import ItemAlreadyExists, ItemNotFound
        err = type("ClientError", (Exception,), {})("x")
        err.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
        self.client.put_item.side_effect = err
        with self.assertRaises(ItemAlreadyExists):
            self.store.put_item({"PK": "a", "SK": "b"}, must_not_exist=True)
        with self.assertRaises(ItemNotFound):
            self.store.put_item({"PK": "a", "SK": "b"}, must_exist=True)
        self.assertEqual(self.client.put_item.call_args.kwargs["ConditionExpression"], "attribute_exists(PK)")

    def test_update_item_builds_set_and_remove(self):
        self.client.update_item.return_value = {"Attributes": {"PK": {"S": "a"}, "SK": {"S": "b"}, "n": {"N": "3"}}}
        out = self.store.update_item("a", "b", {"title": "x", "notes": None})
        kwargs = self.client.update_item.call_args.kwargs
        self.assertEqual(kwargs["UpdateExpression"], "SET #n0 = :v0 REMOVE #n1")
        self.assertEqual(kwargs["ConditionExpression"], "attribute_exists(PK)")
        self.assertEqual(kwargs["ExpressionAttributeNames"], {"#n0": "title", "#n1": "notes"})
        self.assertEqual(str(out["n"]), "3")

    def test_query_paginates_and_filters(self):
        self.client.query.side_effect = [
            {"Items": [{"PK": {"S": "a"}, "SK": {"S": "1"}}], "LastEvaluatedKey": {"PK": {"S": "a"}, "SK": {"S": "1"}}},
            {"Items": [{"PK": {"S": "a"}, "SK": {"S": "2"}}]},
        ]
        items = self.store.query_prefix("a", "TRIP#", entity_type="TRIP", consistent=True)
        self.assertEqual([i["SK"] for i in items], ["1", "2"])
        first = self.client.query.call_args_list[0].kwargs
        self.assertEqual(first["KeyConditionExpression"], "PK = :pk AND begins_with(SK, :p)")
        self.assertEqual(first["FilterExpression"], "entityType = :et")
        self.assertTrue(first["ConsistentRead"])

    def test_delete_many_is_one_transaction_and_has_a_hard_limit(self):
        self.store.delete_many([("a", "1"), ("a", "2")])
        items = self.client.transact_write_items.call_args.kwargs["TransactItems"]
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["Delete"]["Key"], {"PK": {"S": "a"}, "SK": {"S": "1"}})
        with self.assertRaises(RuntimeError):
            self.store.delete_many([("a", str(i)) for i in range(101)])


if __name__ == "__main__":
    unittest.main()
