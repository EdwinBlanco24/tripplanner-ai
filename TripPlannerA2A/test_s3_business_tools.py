"""Pruebas unitarias del sprint S3b (sin red ni AWS): tools de negocio, extraccion de JSON y stream tipado.

Ejecutar con el Python del .venv del repo:
    python -m unittest test_s3_business_tools -v      (desde TripPlannerA2A)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import sys
import types
import unittest
from unittest import mock

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "OrchestratorAgent")
sys.path.insert(0, os.path.abspath(APP))

import business_tools as bt  # noqa: E402
import main  # noqa: E402

USER = "a1b2c3d4-0000-1111-2222-333344445555"
ARNS = {
    "TRIPS_FUNCTION_ARN": "arn:aws:lambda:us-east-2:000000000000:function:trips",
    "ITINERARIES_FUNCTION_ARN": "arn:aws:lambda:us-east-2:000000000000:function:itineraries",
    "RESERVATIONS_FUNCTION_ARN": "arn:aws:lambda:us-east-2:000000000000:function:reservations",
    "PREFERENCES_FUNCTION_ARN": "arn:aws:lambda:us-east-2:000000000000:function:preferences",
}
TRIP = {"tripId": "TRP-0123abcd", "title": "Cartagena", "status": "PLANNED"}
RES = {"resId": "RES-89abcdef", "tripId": "TRP-0123abcd", "type": "FLIGHT", "status": "SIMULADA"}
DEFAULT_RESPONSES = {
    "create_trip": {"trip": TRIP}, "update_trip": {"trip": TRIP}, "get_trips": {"trips": [TRIP]},
    "get_trip": {"trip": TRIP, "itinerary": None, "reservations": []},
    "delete_trip": {"deleted": True, "tripId": TRIP["tripId"], "deletedItems": 1},
    "create_itinerary": {"itinerary": {"tripId": TRIP["tripId"], "days": [{"date": "2026-12-04"}], "updatedAt": "x"}},
    "get_itinerary": {"itinerary": {"tripId": TRIP["tripId"], "days": [], "updatedAt": "x"}},
    "update_itinerary": {"itinerary": {"tripId": TRIP["tripId"], "days": [], "updatedAt": "x"}},
    "create_reservation": {"reservation": RES}, "update_reservation": {"reservation": RES},
    "get_reservation": {"reservation": RES}, "get_reservations": {"reservations": [RES]},
    "delete_reservation": {"deleted": True, "tripId": RES["tripId"], "resId": RES["resId"]},
    "get_preferences": {"preferences": None}, "update_preferences": {"preferences": {"budgetStyle": "ECONOMY"}},
}


class FakeLambda:
    """Cliente de Lambda falso: registra las invocaciones y responde con el contrato de las Lambdas."""

    def __init__(self, responses=None, function_error=False, raises=None):
        self.calls: list[dict] = []
        self.responses = responses if responses is not None else DEFAULT_RESPONSES
        self.function_error, self.raises = function_error, raises

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises:
            raise self.raises
        event = json.loads(kwargs["Payload"])
        body = self.responses[event["action"]]
        if not (isinstance(body, dict) and "ok" in body):
            body = {"ok": True, "statusCode": 200, "data": body}
        result = {"Payload": io.BytesIO(json.dumps(body).encode()), "StatusCode": 200}
        if self.function_error:
            result["FunctionError"] = "Unhandled"
        return result

    def events(self):
        return [json.loads(c["Payload"]) for c in self.calls]


class BusinessToolsBase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, ARNS)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.fake = FakeLambda()
        self.ui: list[tuple] = []
        self.tools = {t.tool_name: t for t in bt.build_business_tools(USER, lambda c, d: self.ui.append((c, d)), client=self.fake)}

    def call(self, name, **kwargs):
        return json.loads(self.tools[name](**kwargs))


class ExtractJsonBlockTests(unittest.TestCase):
    TEXT = 'Hay 2 opciones.\n\nRecomiendo la primera.\n\n```json\n{"flights": [{"airline": "A", "price": 1}, {"airline": "B", "price": 2}]}\n```'

    def test_extracts_and_removes_the_block(self):
        text, flights = bt.extract_json_block(self.TEXT, "flights")
        self.assertEqual([f["airline"] for f in flights], ["A", "B"])
        self.assertNotIn("```", text)
        self.assertTrue(text.endswith("Recomiendo la primera."))

    def test_block_in_the_middle_and_without_language_tag(self):
        text, flights = bt.extract_json_block('Antes\n```\n{"flights": [{"a": 1}]}\n```\nDespues', "flights")
        self.assertEqual(flights, [{"a": 1}])
        self.assertEqual(text, "Antes\n\nDespues")

    def test_invalid_or_irrelevant_blocks_leave_the_text_untouched(self):
        cases = [
            "sin bloque",
            "```json\n{no es json}\n```",
            '```json\n{"otra": []}\n```',
            '```json\n{"flights": "no es lista"}\n```',
            '```json\n["x"]\n```',
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual(bt.extract_json_block(text, "flights"), (text, None))

    def test_filters_non_objects_and_caps_the_list(self):
        block = '```json\n{"flights": [1, "x", ' + ", ".join('{"n": %d}' % i for i in range(15)) + "]}\n```"
        _, flights = bt.extract_json_block(block, "flights")
        self.assertEqual(len(flights), 10)
        self.assertTrue(all(isinstance(f, dict) for f in flights))

    def test_picks_the_right_block_when_there_are_several(self):
        text = '```json\n{"x": 1}\n```\nmedio\n```json\n{"flights": [{"a": 1}]}\n```'
        cleaned, flights = bt.extract_json_block(text, "flights")
        self.assertEqual(flights, [{"a": 1}])
        self.assertIn('{"x": 1}', cleaned)

    def test_weather_accepts_list_or_object(self):
        _, value = bt.extract_json_block('```json\n{"weather": {"days": []}}\n```', "weather", expect=(list, dict))
        self.assertEqual(value, {"days": []})
        _, value = bt.extract_json_block('```json\n{"weather": []}\n```', "weather", expect=(list, dict))
        self.assertEqual(value, [])

    def test_non_string_input(self):
        self.assertEqual(bt.extract_json_block(None, "flights"), (None, None))


class LambdaEventTests(BusinessToolsBase):
    def test_event_uses_the_closure_user_and_snake_case_action(self):
        self.call("create_trip", title="Cartagena", origin="Bogota", destination="Cartagena", start_date="2026-12-04",
                  end_date="2026-12-07", travelers=3, budget=5000000, currency="COP")
        call = self.fake.calls[0]
        self.assertEqual(call["FunctionName"], ARNS["TRIPS_FUNCTION_ARN"])
        self.assertEqual(call["InvocationType"], "RequestResponse")
        self.assertEqual(self.fake.events()[0], {
            "source": "agent", "action": "create_trip", "userId": USER,
            "payload": {"title": "Cartagena", "origin": "Bogota", "destination": "Cartagena", "startDate": "2026-12-04",
                        "endDate": "2026-12-07", "travelers": 3, "budget": 5000000, "currency": "COP"},
        })

    def test_no_tool_exposes_a_user_parameter(self):
        self.assertEqual(len(self.tools), 15)
        for name, tool in self.tools.items():
            props = tool.tool_spec["inputSchema"]["json"].get("properties", {})
            for forbidden in ("user_id", "userId", "user", "sub", "actor_id"):
                self.assertNotIn(forbidden, props, name)

    def test_the_model_cannot_inject_another_user_through_arguments(self):
        with self.assertRaises(TypeError):
            self.tools["get_trips"](user_id="OTRO")
        self.call("get_trips")
        self.assertEqual(self.fake.events()[0]["userId"], USER)

    def test_each_function_goes_to_its_own_lambda(self):
        self.call("get_itinerary", trip_id=TRIP["tripId"])
        self.call("get_reservations")
        self.call("get_preferences")
        self.call("get_trips")
        self.assertEqual([c["FunctionName"] for c in self.fake.calls], [
            ARNS["ITINERARIES_FUNCTION_ARN"], ARNS["RESERVATIONS_FUNCTION_ARN"],
            ARNS["PREFERENCES_FUNCTION_ARN"], ARNS["TRIPS_FUNCTION_ARN"]])

    def test_none_arguments_are_not_sent_and_ids_are_camel_case(self):
        self.call("update_reservation", trip_id=TRIP["tripId"], res_id=RES["resId"], status="PENDIENTE")
        self.assertEqual(self.fake.events()[0]["payload"], {"tripId": TRIP["tripId"], "resId": RES["resId"], "status": "PENDIENTE"})
        self.call("update_trip", trip_id=TRIP["tripId"], notes="")
        self.assertEqual(self.fake.events()[1]["payload"], {"tripId": TRIP["tripId"], "notes": ""})

    def test_preferences_are_translated_to_camel_case(self):
        self.call("update_preferences", travel_styles=["BEACH"], pace="RELAXED", flight_time="MORNING", budget_level="ECONOMY", notes="x")
        self.assertEqual(self.fake.events()[0]["payload"],
                         {"travelStyles": ["BEACH"], "pace": "RELAXED", "flightTime": "MORNING", "budgetLevel": "ECONOMY", "notes": "x"})

    def test_all_fifteen_actions_exist_and_use_the_canonical_names(self):
        calls = {
            "create_trip": dict(title="t", origin="ab", destination="cd", start_date="2026-12-04", end_date="2026-12-05", travelers=1, budget=1),
            "get_trips": {}, "get_trip": dict(trip_id="TRP-0123abcd"), "update_trip": dict(trip_id="TRP-0123abcd", title="x"),
            "delete_trip": dict(trip_id="TRP-0123abcd", confirmed=True),
            "create_itinerary": dict(trip_id="TRP-0123abcd", days=[]), "get_itinerary": dict(trip_id="TRP-0123abcd"),
            "update_itinerary": dict(trip_id="TRP-0123abcd", days=[]),
            "create_reservation": dict(trip_id="TRP-0123abcd", type="FLIGHT", provider="p", details={}, price=1),
            "get_reservations": {}, "get_reservation": dict(trip_id="TRP-0123abcd", res_id="RES-89abcdef"),
            "update_reservation": dict(trip_id="TRP-0123abcd", res_id="RES-89abcdef", status="PENDIENTE"),
            "delete_reservation": dict(trip_id="TRP-0123abcd", res_id="RES-89abcdef", confirmed=True),
            "get_preferences": {}, "update_preferences": dict(notes="x"),
        }
        self.assertEqual(set(calls), set(self.tools))
        for name, kwargs in calls.items():
            self.assertTrue(self.call(name, **kwargs)["ok"], name)
        self.assertEqual([e["action"] for e in self.fake.events()], list(calls))
        self.assertEqual(set(calls), set(bt.TOOL_STATUS) - {"ask_flights", "ask_weather"})


class DeleteConfirmationTests(BusinessToolsBase):
    def test_delete_without_confirmation_does_not_invoke_the_lambda(self):
        for name, kwargs in (("delete_trip", {"trip_id": "TRP-0123abcd"}),
                             ("delete_reservation", {"trip_id": "TRP-0123abcd", "res_id": "RES-89abcdef"})):
            for confirmed in (None, False, "true", 1):
                with self.subTest(name=name, confirmed=confirmed):
                    kw = dict(kwargs, **({} if confirmed is None else {"confirmed": confirmed}))
                    result = json.loads(self.tools[name](**kw))
                    self.assertFalse(result["ok"])
                    self.assertEqual(result["error"]["code"], "CONFIRMATION_REQUIRED")
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.ui, [])

    def test_delete_with_confirmation_invokes_the_lambda(self):
        self.assertTrue(self.call("delete_trip", trip_id="TRP-0123abcd", confirmed=True)["ok"])
        self.assertTrue(self.call("delete_reservation", trip_id="TRP-0123abcd", res_id="RES-89abcdef", confirmed=True)["ok"])
        events = self.fake.events()
        self.assertEqual([(e["action"], e["payload"]["confirmed"]) for e in events], [("delete_trip", True), ("delete_reservation", True)])


class AuthenticationTests(unittest.TestCase):
    def test_without_a_valid_user_no_lambda_is_invoked(self):
        for user in (None, "", "con espacios", "x" * 200):
            fake = FakeLambda()
            with mock.patch.dict(os.environ, ARNS):
                tools = {t.tool_name: t for t in bt.build_business_tools(user, lambda c, d: None, client=fake)}
                for name, kwargs in (("get_trips", {}), ("create_itinerary", {"trip_id": "TRP-0123abcd", "days": []}),
                                     ("delete_trip", {"trip_id": "TRP-0123abcd", "confirmed": True})):
                    result = json.loads(tools[name](**kwargs))
                    self.assertEqual(result, {"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Requiere usuario autenticado."}})
            self.assertEqual(fake.calls, [], user)

    def test_missing_arn_is_reported_without_calling_lambda(self):
        fake = FakeLambda()
        env = {k: v for k, v in os.environ.items() if k not in ARNS}
        with mock.patch.dict(os.environ, env, clear=True):
            tools = {t.tool_name: t for t in bt.build_business_tools(USER, lambda c, d: None, client=fake)}
            self.assertEqual(json.loads(tools["get_trips"]())["error"]["code"], "NOT_CONFIGURED")
        self.assertEqual(fake.calls, [])


class ResultHandlingTests(BusinessToolsBase):
    def test_lambda_errors_are_returned_with_code_and_message_only(self):
        self.fake.responses = {"create_trip": {"ok": False, "statusCode": 400, "error": {
            "code": "VALIDATION_ERROR", "message": "travelers debe estar entre 1 y 20.",
            "details": [{"field": "travelers", "issue": "out_of_range"}], "trace": "SECRETO"}}}
        result = self.call("create_trip", title="t", origin="ab", destination="cd", start_date="2026-12-04", end_date="2026-12-05", travelers=0, budget=1)
        self.assertEqual(result["ok"], False)
        self.assertEqual(result["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(result["error"]["details"], [{"field": "travelers", "issue": "out_of_range"}])
        self.assertNotIn("SECRETO", json.dumps(result))
        self.assertEqual(self.ui, [])

    def test_function_error_and_network_failures_do_not_leak_internals(self):
        self.fake.function_error = True
        result = self.call("get_trips")
        self.assertEqual(result["error"]["code"], "SERVICE_ERROR")
        for exc in (RuntimeError("AccessDenied arn:aws:iam::123:role/secret"), TimeoutError("read timeout")):
            self.fake.function_error, self.fake.raises = False, exc
            result = self.call("get_trips")
            self.assertEqual(result["error"]["code"], "SERVICE_UNAVAILABLE")
            self.assertNotIn("secret", json.dumps(result))
            self.assertNotIn("timeout", json.dumps(result))

    def test_unexpected_lambda_body(self):
        # Sin la clave "ok" la respuesta no cumple el contrato; con "ok" falso se trata como error.
        self.fake.responses = {"get_trips": {"ok": None}}
        self.assertFalse(self.call("get_trips")["ok"])
        self.fake.responses = {"get_trips": {"ok": True, "statusCode": 200, "data": {"trips": []}}}
        self.assertTrue(self.call("get_trips")["ok"])

    def test_result_is_compact_json(self):
        raw = self.tools["get_trips"]()
        self.assertNotIn(": ", raw)
        self.assertEqual(json.loads(raw), {"ok": True, "data": {"trips": [TRIP]}})


WRITE_CALLS = {
    "create_trip": dict(title="t", origin="ab", destination="cd", start_date="2026-12-04", end_date="2026-12-05", travelers=1, budget=1),
    "update_trip": dict(trip_id="TRP-0123abcd", title="x"),
    "create_itinerary": dict(trip_id="TRP-0123abcd", days=[]),
    "update_itinerary": dict(trip_id="TRP-0123abcd", days=[]),
    "create_reservation": dict(trip_id="TRP-0123abcd", type="FLIGHT", provider="p", details={}, price=1),
    "update_reservation": dict(trip_id="TRP-0123abcd", res_id="RES-89abcdef", status="PENDIENTE"),
    "update_preferences": dict(notes="x"),
}
UNCERTAIN_MESSAGE = "La operación pudo haberse completado; consulta antes de reintentar"


class UncertainResultTests(BusinessToolsBase):
    def test_read_timeout_on_create_or_update_is_uncertain(self):
        from botocore.exceptions import ReadTimeoutError
        self.fake.raises = ReadTimeoutError(endpoint_url="https://lambda.us-east-2.amazonaws.com")
        for name, kwargs in WRITE_CALLS.items():
            with self.subTest(name=name):
                result = self.call(name, **kwargs)
                self.assertEqual(result, {"ok": False, "error": {"code": "UNCERTAIN", "message": UNCERTAIN_MESSAGE}})
        self.assertEqual(self.ui, [])

    def test_connection_closed_on_a_write_is_also_uncertain(self):
        from botocore.exceptions import ConnectionClosedError
        self.fake.raises = ConnectionClosedError(endpoint_url="https://lambda.us-east-2.amazonaws.com")
        self.assertEqual(self.call("create_trip", **WRITE_CALLS["create_trip"])["error"]["code"], "UNCERTAIN")

    def test_lambda_function_error_on_a_write_is_uncertain_but_not_on_a_read(self):
        self.fake.function_error = True
        self.assertEqual(self.call("create_reservation", **WRITE_CALLS["create_reservation"])["error"]["code"], "UNCERTAIN")
        self.assertEqual(self.call("get_trips")["error"]["code"], "SERVICE_ERROR")

    def test_timeouts_on_reads_and_deletes_stay_service_unavailable(self):
        from botocore.exceptions import ReadTimeoutError
        self.fake.raises = ReadTimeoutError(endpoint_url="https://lambda.us-east-2.amazonaws.com")
        for name, kwargs in (("get_trips", {}), ("get_trip", dict(trip_id="TRP-0123abcd")), ("get_reservations", {}),
                             ("delete_trip", dict(trip_id="TRP-0123abcd", confirmed=True))):
            with self.subTest(name=name):
                self.assertEqual(self.call(name, **kwargs)["error"]["code"], "SERVICE_UNAVAILABLE")

    def test_connection_failures_before_sending_are_not_uncertain(self):
        from botocore.exceptions import ConnectTimeoutError, EndpointConnectionError
        for exc in (ConnectTimeoutError(endpoint_url="https://x"), EndpointConnectionError(endpoint_url="https://x")):
            self.fake.raises = exc
            with self.subTest(exc=type(exc).__name__):
                self.assertEqual(self.call("create_trip", **WRITE_CALLS["create_trip"])["error"]["code"], "SERVICE_UNAVAILABLE")


class LambdaClientConfigTests(unittest.TestCase):
    def test_client_has_no_retries_and_the_read_timeout_follows_the_lambda_timeout(self):
        import re
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "template.yaml")
        with open(path, encoding="utf-8") as handle:
            template = handle.read()
        lambda_timeout = int(re.search(r"^\s+Timeout:\s*(\d+)\s*$", template, re.M).group(1))
        self.assertEqual(lambda_timeout, bt.LAMBDA_TIMEOUT_SECONDS)
        with mock.patch("boto3.client") as boto_client:
            bt._default_client()
        args, kwargs = boto_client.call_args
        self.assertEqual(args, ("lambda",))
        config = kwargs["config"]
        self.assertEqual(config.retries, {"total_max_attempts": 1, "mode": "standard"})
        self.assertEqual(config.connect_timeout, 5)
        self.assertEqual(config.read_timeout, lambda_timeout + 5)
        self.assertEqual(config.read_timeout, 15)


class PromptRulesTests(unittest.TestCase):
    def test_prompt_covers_uncertain_and_flight_reservations(self):
        prompt = main.SYSTEM_PROMPT
        self.assertIn("UNCERTAIN", prompt)
        self.assertIn("ANTES de repetirla consulta con get_trips", prompt)
        for field in ("airline", "flightNumber", "origin", "destination", "departureTime", "arrivalTime", "bookingUrl"):
            self.assertIn(field, prompt)
        self.assertIn("price y currency", prompt)
        self.assertIn("tarjeta", prompt)
        prompt.format(rate_rule="x", current_date="2026-11-22", trip_window="del jueves 2026-12-03 al domingo 2026-12-06 (4 días)")  # el prompt se formatea con str.format: no puede traer llaves sueltas


class UiEmissionTests(BusinessToolsBase):
    def test_components_per_tool(self):
        self.call("create_trip", title="t", origin="ab", destination="cd", start_date="2026-12-04", end_date="2026-12-05", travelers=1, budget=1)
        self.call("update_trip", trip_id="TRP-0123abcd", title="x")
        self.call("get_trip", trip_id="TRP-0123abcd")
        self.call("get_trips")
        self.call("create_itinerary", trip_id="TRP-0123abcd", days=[])
        self.call("update_itinerary", trip_id="TRP-0123abcd", days=[])
        self.call("get_itinerary", trip_id="TRP-0123abcd")
        self.call("get_reservations", trip_id="TRP-0123abcd")
        self.call("create_reservation", trip_id="TRP-0123abcd", type="FLIGHT", provider="p", details={}, price=1)
        self.call("update_reservation", trip_id="TRP-0123abcd", res_id="RES-89abcdef", status="PENDIENTE")
        self.call("delete_reservation", trip_id="TRP-0123abcd", res_id="RES-89abcdef", confirmed=True)
        self.call("get_preferences")
        self.call("update_preferences", notes="x")
        self.call("delete_trip", trip_id="TRP-0123abcd", confirmed=True)
        self.assertEqual([c for c, _ in self.ui], [
            "trip", "trip", "trip", "trips", "itinerary", "itinerary", "itinerary",
            "reservations", "reservations", "reservations", "reservations", "preferences", "preferences"])

    def test_ui_data_shapes(self):
        self.call("create_trip", title="t", origin="ab", destination="cd", start_date="2026-12-04", end_date="2026-12-05", travelers=1, budget=1)
        self.assertEqual(self.ui[-1], ("trip", {"trip": TRIP}))
        self.call("get_trip", trip_id="TRP-0123abcd")
        self.assertEqual(set(self.ui[-1][1]), {"trip", "itinerary", "reservations"})
        self.call("get_itinerary", trip_id="TRP-0123abcd")
        self.assertEqual(set(self.ui[-1][1]), {"tripId", "days", "updatedAt"})
        self.call("get_reservations", trip_id="TRP-0123abcd")
        self.assertEqual(self.ui[-1][1], {"change": "listed", "reservations": [RES], "tripId": "TRP-0123abcd"})
        self.call("create_reservation", trip_id="TRP-0123abcd", type="FLIGHT", provider="p", details={}, price=1)
        self.assertEqual(self.ui[-1][1], {"tripId": "TRP-0123abcd", "change": "created", "reservations": [RES]})
        self.call("delete_reservation", trip_id="TRP-0123abcd", res_id="RES-89abcdef", confirmed=True)
        self.assertEqual(self.ui[-1][1], {"tripId": "TRP-0123abcd", "change": "deleted", "resId": "RES-89abcdef", "reservations": []})

    def test_a_failing_emit_ui_never_breaks_the_tool(self):
        def boom(component, data):
            raise RuntimeError("ui roto")
        tools = {t.tool_name: t for t in bt.build_business_tools(USER, boom, client=self.fake)}
        self.assertTrue(json.loads(tools["get_trips"]())["ok"])


class LoggingTests(BusinessToolsBase):
    def test_logs_have_action_latency_and_masked_user_only(self):
        with self.assertLogs("orchestrator_agent.business", level="INFO") as logs:
            self.call("create_trip", title="Mi viaje secreto", origin="Bogota", destination="Cartagena",
                      start_date="2026-12-04", end_date="2026-12-05", travelers=1, budget=987654)
        text = "\n".join(logs.output)
        self.assertIn("action=create_trip", text)
        self.assertIn("ms=", text)
        self.assertIn("ok=True", text)
        self.assertIn("a1b2c3d4…", text)
        for forbidden in (USER, "secreto", "987654", "Cartagena"):
            self.assertNotIn(forbidden, text)


class StreamEventDetectionTests(unittest.TestCase):
    def test_tool_use_started(self):
        self.assertEqual(bt.tool_use_started({"current_tool_use": {"toolUseId": "t1", "name": "create_trip", "input": ""}}), ("t1", "create_trip"))
        raw = {"event": {"contentBlockStart": {"start": {"toolUse": {"toolUseId": "t2", "name": "ask_flights"}}}}}
        self.assertEqual(bt.tool_use_started(raw), ("t2", "ask_flights"))
        for event in ({"data": "x"}, {"current_tool_use": {}}, {"current_tool_use": {"toolUseId": "t"}}, None, "x", {"event": {"contentBlockDelta": {}}}):
            self.assertIsNone(bt.tool_use_started(event))

    def test_status_messages(self):
        self.assertEqual(bt.status_for("ask_flights"), ("flights", "Consultando el agente de vuelos…"))
        self.assertEqual(bt.status_for("ask_weather"), ("weather", "Consultando el agente de clima…"))
        self.assertEqual(bt.status_for("create_trip"), ("business", "Guardando tu viaje…"))
        self.assertEqual(bt.status_for("otra_cosa")[0], "orchestrator")


FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load_real_a2a_response() -> dict:
    with open(os.path.join(FIXTURES, "s3c_flights_a2a_response.json"), encoding="utf-8") as handle:
        return json.load(handle)


class RealA2AResponseTests(unittest.TestCase):
    """Respuesta A2A REAL (recortada) del FlightsAgent desplegado: 356 fragmentos de texto, uno por part."""

    @classmethod
    def setUpClass(cls):
        cls.fixture = load_real_a2a_response()
        cls.result = types.SimpleNamespace(message={"role": "assistant", "content": [{"text": t} for t in cls.fixture["content_blocks"]]})

    def test_fixture_has_the_shape_that_broke_the_extraction(self):
        self.assertGreater(len(self.fixture["content_blocks"]), 300)
        self.assertEqual(self.fixture["events_head"][0]["kind"], "Task(inicial)")
        self.assertTrue(all(e["kind"] == "TaskArtifactUpdateEvent" for e in self.fixture["events_head"][1:]))
        self.assertEqual(self.fixture["events_tail"][-1]["state"], "completed")

    def test_the_old_repr_never_yielded_the_block(self):
        old = str(self.result.message)  # lo que hacía _ask_specialist
        self.assertTrue(old.startswith("{'role': 'assistant', 'content': [{'text':"))
        self.assertEqual(bt.extract_json_block(old, "flights"), (old, None))

    def test_specialist_text_joins_every_part_and_the_block_is_extracted(self):
        text = bt.specialist_text(self.result)
        self.assertEqual(text, "".join(self.fixture["content_blocks"]))
        self.assertIn("```json", text)
        cleaned, flights = bt.extract_json_block(text, "flights", expect=list)
        self.assertEqual(len(flights), 5)
        self.assertEqual({"airline", "flightNumber", "origin", "destination", "departureTime", "arrivalTime",
                          "durationMinutes", "stops", "price", "currency", "bookingUrl"}, set(flights[0]))
        self.assertNotIn("```", cleaned)
        self.assertNotIn('"flights"', cleaned)
        self.assertIn(flights[0]["flightNumber"], cleaned)  # el texto sigue describiendo los vuelos

    def test_ask_flights_end_to_end_with_the_real_response(self):
        emitted = []
        real_result = self.result

        class FakeRemote:
            def __init__(self, endpoint, client_config=None):
                self.endpoint = endpoint

            def __call__(self, request):
                return real_result

        tools = {t.tool_name: t for t in main.build_specialist_tools(lambda c, d: emitted.append((c, d)))}
        with mock.patch.object(main, "A2AAgent", FakeRemote), mock.patch.object(main, "create_a2a_client", return_value=object()), \
                mock.patch.object(main, "ClientConfig", lambda httpx_client=None: None):
            text = tools["ask_flights"]("vuelos")
        self.assertEqual([c for c, _ in emitted], ["flights"])
        self.assertEqual(len(emitted[0][1]["flights"]), 5)
        self.assertNotIn("```", text)
        self.assertFalse(text.startswith("{'role'"))

    def test_last_block_wins_and_all_blocks_are_removed(self):
        modelo = '```json\n{"flights": [{"flightNumber": "MODELO"}]}\n```'
        codigo = '```json\n{"flights": [{"flightNumber": "CODIGO"}]}\n```'
        cleaned, flights = bt.extract_json_block(f"Texto.\n\n{modelo}\n\n{codigo}", "flights")
        self.assertEqual(flights, [{"flightNumber": "CODIGO"}])
        self.assertEqual(cleaned, "Texto.")

    def test_specialist_text_falls_back_for_unexpected_results(self):
        self.assertEqual(bt.specialist_text(types.SimpleNamespace(message={"content": [{"text": "a"}, {"image": 1}, {"text": "b"}]})), "ab")
        self.assertEqual(bt.specialist_text(types.SimpleNamespace(message={"content": []})), "")


class SpecialistToolTests(unittest.TestCase):
    def test_ask_flights_emits_ui_and_strips_the_block(self):
        emitted = []
        tools = {t.tool_name: t for t in main.build_specialist_tools(lambda c, d: emitted.append((c, d)))}
        reply = 'Opcion 1: Avianca.\n\n```json\n{"flights": [{"airline": "Avianca", "price": 289000}]}\n```'
        with mock.patch.object(main, "_ask_specialist", return_value=reply) as ask:
            text = tools["ask_flights"]("vuelos BOG-CTG")
        ask.assert_called_once_with(main.FLIGHTS_AGENT_URL, "vuelos BOG-CTG")
        self.assertEqual(text, "Opcion 1: Avianca.")
        self.assertEqual(emitted, [("flights", {"flights": [{"airline": "Avianca", "price": 289000}]})])

    def test_ask_flights_without_block_or_results(self):
        emitted = []
        tools = {t.tool_name: t for t in main.build_specialist_tools(lambda c, d: emitted.append((c, d)))}
        for reply in ("Sin resultados.", '```json\n{"flights": []}\n```\nNo hay vuelos.'):
            with mock.patch.object(main, "_ask_specialist", return_value=reply):
                tools["ask_flights"]("x")
        self.assertEqual(emitted, [])

    def test_ask_weather_is_ready_for_a_weather_block(self):
        emitted = []
        tools = {t.tool_name: t for t in main.build_specialist_tools(lambda c, d: emitted.append((c, d)))}
        with mock.patch.object(main, "_ask_specialist", return_value='Soleado.\n```json\n{"weather": {"days": [1]}}\n```'):
            self.assertEqual(tools["ask_weather"]("clima"), "Soleado.")
        self.assertEqual(emitted, [("weather", {"weather": {"days": [1]}})])


def jwt_for(sub):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return enc({"alg": "RS256"}) + "." + enc({"sub": sub}) + ".firma"


class FakeSessionManager:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.sm = FakeSessionManager()
        self.captured: dict = {}
        self.script = []
        patches = [
            mock.patch.object(main, "create_memory_session_manager", side_effect=self._create_sm),
            mock.patch.object(main, "build_agent", side_effect=self._build_agent),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _create_sm(self, session_id, actor_id):
        self.captured["actor_id"] = actor_id
        return self.sm

    def _build_agent(self, session_manager, user_id=None, emit_ui=None):
        self.captured["user_id"] = user_id
        script = self.script

        class FakeAgent:
            async def stream_async(self, prompt):
                for step in script:
                    if callable(step):
                        step(emit_ui)
                    elif isinstance(step, Exception):
                        raise step
                    else:
                        yield step

        return FakeAgent()

    def run_invoke(self, payload, headers=None, session_id="s" * 40):
        context = types.SimpleNamespace(session_id=session_id, request_headers=headers)

        async def collect():
            return [event async for event in main.invoke(payload, context)]

        return asyncio.run(collect())

    def test_typed_stream_with_status_ui_text_and_done(self):
        trip_ui = ("trip", {"trip": TRIP})
        self.script = [
            {"current_tool_use": {"toolUseId": "t1", "name": "create_trip", "input": ""}},
            {"current_tool_use": {"toolUseId": "t1", "name": "create_trip", "input": "{}"}},
            lambda emit: emit(*trip_ui),
            {"event": {"contentBlockDelta": {}}},
            {"data": "Listo "},
            {"data": ""},
            {"data": "tu viaje."},
            {"current_tool_use": {"toolUseId": "t2", "name": "ask_flights", "input": ""}},
            lambda emit: emit("flights", {"flights": [{"airline": "A"}]}),
        ]
        events = self.run_invoke({"prompt": "hola"}, {"Authorization": "Bearer " + jwt_for(USER)})
        self.assertEqual(events, [
            {"type": "status", "agent": "business", "message": "Guardando tu viaje…"},
            {"type": "ui", "component": "trip", "data": {"trip": TRIP}},
            {"type": "text", "delta": "Listo "},
            {"type": "text", "delta": "tu viaje."},
            {"type": "status", "agent": "flights", "message": "Consultando el agente de vuelos…"},
            {"type": "ui", "component": "flights", "data": {"flights": [{"airline": "A"}]}},
            {"type": "done"},
        ])
        self.assertTrue(self.sm.closed)

    def test_user_id_comes_only_from_the_jwt(self):
        self.run_invoke({"prompt": "hola", "actor_id": "ATACANTE"}, {"Authorization": "Bearer " + jwt_for(USER)})
        self.assertEqual(self.captured, {"actor_id": USER, "user_id": USER})

    def test_without_jwt_business_tools_get_no_user(self):
        self.run_invoke({"prompt": "hola", "actor_id": "dev-user-1"})
        self.assertEqual(self.captured["actor_id"], "dev-user-1")
        self.assertIsNone(self.captured["user_id"])
        with mock.patch.dict(os.environ, {"DEFAULT_ACTOR_ID": "default-actor"}):
            self.run_invoke({"prompt": "hola"})
        self.assertEqual((self.captured["actor_id"], self.captured["user_id"]), ("default-actor", None))

    def test_failure_emits_a_generic_error_then_done_and_closes_the_session(self):
        self.script = [{"data": "Hola"}, RuntimeError("detalle interno secreto arn:aws:iam::1:role/x")]
        with self.assertLogs("orchestrator_agent", level="ERROR"):
            events = self.run_invoke({"prompt": "hola"}, {"Authorization": "Bearer " + jwt_for(USER)})
        self.assertEqual([e["type"] for e in events], ["text", "error", "done"])
        self.assertEqual(events[1]["message"], main.GENERIC_ERROR_MESSAGE)
        self.assertNotIn("secreto", json.dumps(events))
        self.assertTrue(self.sm.closed)

    def test_ui_emitted_by_a_late_tool_is_not_lost(self):
        self.script = [lambda emit: emit("trips", {"trips": []})]
        events = self.run_invoke({"prompt": "hola"}, {"Authorization": "Bearer " + jwt_for(USER)})
        self.assertEqual(events, [{"type": "ui", "component": "trips", "data": {"trips": []}}, {"type": "done"}])

    def test_invalid_requests_become_error_events_without_building_an_agent(self):
        cases = [
            ({"prompt": "   "}, None, "s" * 40),
            ({"prompt": 5}, None, "s" * 40),
            ({"prompt": "hola"}, {"Authorization": "Bearer abc.def.ghi"}, "s" * 40),
            ({"prompt": "hola"}, None, ""),
        ]
        with mock.patch.dict(os.environ, {"DEFAULT_ACTOR_ID": "default-actor"}):
            for payload, headers, session in cases:
                with self.subTest(payload=payload, headers=headers, session=session):
                    events = self.run_invoke(payload, headers, session_id=session)
                    self.assertEqual([e["type"] for e in events], ["error", "done"])
                    self.assertTrue(events[0]["message"])
        self.assertNotIn("user_id", self.captured)
        self.assertFalse(self.sm.closed)


if __name__ == "__main__":
    logging.disable(logging.NOTSET)
    unittest.main()
