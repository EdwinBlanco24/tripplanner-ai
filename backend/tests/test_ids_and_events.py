import base64
import json
import unittest
from decimal import Decimal

import support
from common import ids
from common.errors import Unauthorized, ValidationError
from common.request import parse_event


class IdTests(unittest.TestCase):
    def test_format(self):
        for _ in range(200):
            self.assertRegex(ids.new_trip_id(), r"^TRP-[0-9a-f]{8}$")
            self.assertRegex(ids.new_reservation_id(), r"^RES-[0-9a-f]{8}$")

    def test_ids_are_random(self):
        self.assertGreater(len({ids.new_trip_id() for _ in range(500)}), 495)

    def test_uses_secrets_not_random(self):
        import inspect
        source = inspect.getsource(ids)
        self.assertIn("secrets.token_hex", source)
        self.assertNotIn("import random", source)

    def test_validators(self):
        self.assertTrue(ids.is_trip_id("TRP-0123abcd"))
        for bad in ("TRP-0123ABCD", "TRP-123", "RES-0123abcd", "", None, 5, "TRP-0123abcd\n"):
            self.assertFalse(ids.is_trip_id(bad), bad)
        self.assertTrue(ids.is_reservation_id("RES-0123abcd"))
        self.assertFalse(ids.is_reservation_id("TRP-0123abcd"))


class ApiEventTests(unittest.TestCase):
    def test_user_id_comes_only_from_the_jwt_claim(self):
        event = support.api_event("POST /trips", body={"userId": "ATTACKER", "sub": "ATTACKER"}, sub="real-user-1")
        request = parse_event(event)
        self.assertEqual(request.user_id, "real-user-1")
        self.assertEqual(request.source, "api")
        self.assertEqual(request.action, "POST /trips")

    def test_missing_or_invalid_sub_is_401(self):
        for sub in (None, "", "con espacios", "x" * 200):
            event = support.api_event("GET /trips", sub=sub if sub is not None else None)
            if sub is not None:
                event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"] = sub
            with self.subTest(sub=sub), self.assertRaises(Unauthorized):
                parse_event(event)

    def test_body_is_parsed_with_decimals(self):
        request = parse_event(support.api_event("POST /trips", raw_body='{"budget": 1500.50, "n": 3}'))
        self.assertEqual(request.body["budget"], Decimal("1500.50"))
        self.assertIsInstance(request.body["n"], int)

    def test_invalid_bodies(self):
        for raw in ("{no json", "NaN", '{"a": Infinity}', "[" * 5000):
            with self.subTest(raw=raw[:20]), self.assertRaises(ValidationError):
                parse_event(support.api_event("POST /trips", raw_body=raw))

    def test_oversized_body(self):
        with self.assertRaises(ValidationError):
            parse_event(support.api_event("POST /trips", raw_body=json.dumps({"x": "a" * 300000})))

    def test_base64_body(self):
        event = support.api_event("POST /trips", raw_body=base64.b64encode(b'{"a": 1}').decode())
        event["isBase64Encoded"] = True
        self.assertEqual(parse_event(event).body, {"a": 1})

    def test_get_ignores_body(self):
        event = support.api_event("GET /trips", raw_body="{no json")
        self.assertIsNone(parse_event(event).body)

    def test_path_and_query(self):
        event = support.api_event("GET /reservations", query={"tripId": "TRP-0123abcd"})
        self.assertEqual(parse_event(event).param("tripId"), "TRP-0123abcd")


class AgentEventTests(unittest.TestCase):
    def test_agent_event(self):
        request = parse_event(support.agent_event("create_trip", {"title": "x"}, user_id="u-1"))
        self.assertEqual((request.source, request.user_id, request.action), ("agent", "u-1", "create_trip"))
        self.assertEqual(request.fields(), {"title": "x"})

    def test_target_ids_are_not_part_of_the_fields(self):
        request = parse_event(support.agent_event("update_trip", {"tripId": "TRP-0123abcd", "title": "x"}))
        self.assertEqual(request.fields(), {"title": "x"})

    def test_missing_user_is_401_and_bad_shapes_are_400(self):
        with self.assertRaises(Unauthorized):
            parse_event(support.agent_event("get_trips", {}, user_id=None))
        with self.assertRaises(ValidationError):
            parse_event({"source": "agent", "userId": "u-1"})
        with self.assertRaises(ValidationError):
            parse_event(support.agent_event("get_trips", ["no"]))

    def test_payload_defaults_to_empty(self):
        self.assertEqual(parse_event(support.agent_event("get_trips")).body, {})

    def test_unknown_events(self):
        for event in ({}, {"source": "other"}, "text", None, {"routeKey": "GET /x"}):
            with self.subTest(event=event), self.assertRaises(ValidationError):
                parse_event(event)

    def test_agent_marker_inside_an_api_event_does_not_make_it_an_agent_event(self):
        event = support.api_event("GET /trips")
        event["source"] = "agent"
        event["userId"] = "ATTACKER"
        self.assertEqual(parse_event(event).source, "api")
        self.assertEqual(parse_event(event).user_id, support.USER_A)


if __name__ == "__main__":
    unittest.main()
