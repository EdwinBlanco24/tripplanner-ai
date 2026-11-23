"""Pruebas S3c del FlightsAgent (sin red ni AWS): bloque de vuelos construido en código.

Usa un resultado REAL (recortado) de search-flight de Kiwi y la respuesta A2A real del agente desplegado.

    python -m unittest test_s3c_flights -v      (desde TripPlannerA2A, con el Python del .venv del repo)
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
FLIGHTS_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "FlightsAgent"))
sys.path.insert(0, FLIGHTS_DIR)

import flight_blocks as fb  # noqa: E402


def load_flights_main():
    """Carga app/FlightsAgent/main.py con otro nombre (el Orchestrator también tiene un main.py)."""
    spec = importlib.util.spec_from_file_location("flights_agent_main", os.path.join(FLIGHTS_DIR, "main.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as handle:
        return json.load(handle)


KIWI = load_json("kiwi_search_flight_result.json")["result"]
EXPECTED_KEYS = {"airline", "flightNumber", "origin", "destination", "departureTime", "arrivalTime",
                 "durationMinutes", "stops", "price", "currency", "bookingUrl"}


class ParseToolResultTests(unittest.TestCase):
    def test_structured_content_is_preferred(self):
        data = fb.parse_tool_result(KIWI)
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(len(data["itineraries"]), 6)

    def test_falls_back_to_the_json_text_block(self):
        result = {"status": "success", "content": [{"text": "no json"}, {"text": json.dumps({"itineraries": [], "currency": "USD"})}]}
        self.assertEqual(fb.parse_tool_result(result), {"itineraries": [], "currency": "USD"})

    def test_errors_and_garbage_give_none(self):
        for result in ({"status": "error", "content": [{"text": "{}"}]}, {"status": "success", "isError": True, "content": []},
                       {"status": "success", "content": [{"text": "texto"}]}, None, "x", {"status": "success"}):
            self.assertIsNone(fb.parse_tool_result(result), result)


class NormalizeTests(unittest.TestCase):
    def setUp(self):
        self.data = fb.parse_tool_result(KIWI)
        self.flights = fb.normalize_result(self.data)

    def test_every_flight_follows_the_schema(self):
        self.assertEqual(len(self.flights), 6)
        for flight in self.flights:
            self.assertEqual(set(flight), EXPECTED_KEYS)
            self.assertRegex(flight["departureTime"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
            self.assertRegex(flight["arrivalTime"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
            self.assertIsInstance(flight["durationMinutes"], int)
            self.assertIsInstance(flight["stops"], int)
            self.assertIsInstance(flight["price"], (int, float))
            self.assertEqual(flight["currency"], "USD")
            self.assertTrue(flight["bookingUrl"].startswith("https://"))

    def test_values_come_from_the_real_result(self):
        first_raw = self.data["itineraries"][0]
        first = self.flights[0]
        segment = first_raw["outbound"]["segments"][0]
        self.assertEqual(first["airline"], segment["carrierName"])
        self.assertEqual(first["flightNumber"], segment["flightNumber"])
        self.assertEqual((first["origin"], first["destination"]), (first_raw["outbound"]["from"], first_raw["outbound"]["to"]))
        self.assertEqual(first["departureTime"], first_raw["outbound"]["departureTime"][:16])
        self.assertEqual(first["durationMinutes"], round(first_raw["outbound"]["durationSeconds"] / 60))
        self.assertEqual(first["price"], first_raw["price"])
        self.assertEqual(first["bookingUrl"], first_raw["bookingUrl"])

    def test_connections_join_carriers_and_flight_numbers(self):
        itinerary = {"price": 200.5, "bookingUrl": "https://kiwi.com/u/x", "outbound": {
            "from": "BOG", "to": "CTG", "departureTime": "2026-12-04T06:00:00", "arrivalTime": "2026-12-04T12:30:00",
            "durationSeconds": 23400, "stops": 1, "segments": [
                {"carrierName": "Avianca", "flightNumber": "AV1"}, {"carrierName": "Avianca", "flightNumber": "AV2"},
                {"carrierName": "LATAM Airlines", "flightNumber": "LA3"}]}}
        flight = fb.normalize_itinerary(itinerary, "USD")
        self.assertEqual((flight["airline"], flight["flightNumber"], flight["price"], flight["durationMinutes"]),
                         ("Avianca / LATAM Airlines", "AV1+AV2+LA3", 200.5, 390))

    def test_unusable_itineraries_are_skipped_and_errors_give_nothing(self):
        data = {"currency": "USD", "itineraries": [None, {}, {"price": 1}, {"price": "x", "outbound": {"segments": []}}, self.data["itineraries"][0]]}
        self.assertEqual(len(fb.normalize_result(data)), 1)
        self.assertEqual(fb.normalize_result({"error": "sin vuelos", "itineraries": self.data["itineraries"]}), [])
        self.assertEqual(fb.normalize_result(None), [])
        self.assertEqual(fb.normalize_result({"itineraries": []}), [])


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.flights = fb.normalize_result(fb.parse_tool_result(KIWI))

    def test_follows_the_order_of_the_model_text(self):
        numbers = [f["flightNumber"] for f in self.flights]
        text = f"Opción 1: {numbers[3]}. Opción 2: {numbers[1]}. Opción 3: {numbers[4]}."
        chosen = fb.select_flights(self.flights, text)
        self.assertEqual([f["flightNumber"] for f in chosen], [numbers[3], numbers[1], numbers[4]])

    def test_without_mentions_the_cheapest_five_by_price(self):
        chosen = fb.select_flights(self.flights, "texto sin números de vuelo")
        self.assertEqual(len(chosen), 5)
        prices = [f["price"] for f in chosen]
        self.assertEqual(prices, sorted(prices))
        self.assertEqual(prices, sorted(f["price"] for f in self.flights)[:5])

    def test_limit_and_duplicates(self):
        many = [dict(self.flights[0], flightNumber=f"XX{i}", bookingUrl=f"https://kiwi.com/u/{i}") for i in range(8)]
        text = " ".join(f"XX{i}" for i in range(8))
        self.assertEqual(len(fb.select_flights(many, text)), 5)
        self.assertEqual(len(fb.select_flights(self.flights + self.flights, "")), 5)
        self.assertEqual(len({f["bookingUrl"] for f in fb.select_flights(self.flights + self.flights, "")}), 5)

    def test_block_format(self):
        self.assertEqual(fb.build_flights_block([]), "")
        block = fb.build_flights_block(self.flights[:2])
        match = re.fullmatch(r"\n\n```json\n(.*)\n```", block, re.S)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match.group(1)), {"flights": self.flights[:2]})


class CollectorAndAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = load_flights_main()

    def tool_event(self, result=KIWI, name="kiwi_search_flight", exception=None):
        return types.SimpleNamespace(tool_use={"name": name, "toolUseId": "t1"}, result=result, exception=exception)

    def test_collects_only_the_flight_tool_and_resets_per_invocation(self):
        collector = self.main.FlightsResultCollector()
        collector._collect(self.tool_event(name="otra_tool"))
        collector._collect(self.tool_event(exception=RuntimeError("x")))
        collector._collect(self.tool_event(result={"status": "error", "content": []}))
        self.assertEqual(collector.flights, [])
        collector._collect(self.tool_event())
        self.assertEqual(len(collector.flights), 6)
        collector._reset(types.SimpleNamespace())
        self.assertEqual(collector.flights, [])
        self.assertEqual(collector.block_for("texto"), "")

    def test_block_for_uses_the_text_order_or_falls_back_to_price(self):
        collector = self.main.FlightsResultCollector()
        collector._collect(self.tool_event())
        numbers = [f["flightNumber"] for f in collector.flights]
        block = collector.block_for(f"{numbers[2]} y luego {numbers[0]}")
        flights = json.loads(block.split("```json\n")[1].rsplit("\n```", 1)[0])["flights"]
        self.assertEqual([f["flightNumber"] for f in flights], [numbers[2], numbers[0]])
        by_price = json.loads(collector.block_for("sin mención").split("```json\n")[1].rsplit("\n```", 1)[0])["flights"]
        self.assertEqual(len(by_price), 5)

    def run_agent(self, events, collector_setup=None):
        main = self.main

        async def fake_stream(self, *args, **kwargs):
            for event in events:
                if callable(event):
                    event(self)
                else:
                    yield event

        collector = main.FlightsResultCollector()
        with mock.patch("strands.Agent.__init__", lambda self, *a, **k: None), \
                mock.patch("strands.Agent.stream_async", fake_stream):
            agent = main.FlightsAgent(collector=collector)
            if collector_setup:
                collector_setup(collector)

            async def collect():
                return [e async for e in agent.stream_async("hola")]

            return asyncio.run(collect())

    def test_the_block_is_appended_after_the_text_and_before_the_final_result(self):
        def setup(collector):
            collector._collect(self.tool_event())
        numbers = [f["flightNumber"] for f in fb.normalize_result(fb.parse_tool_result(KIWI))]
        events = [{"data": f"Opción: {numbers[1]}. "}, {"data": "Recomiendo esa."}, {"result": "RESULT"}]
        out = self.run_agent(events, setup)
        self.assertEqual([("data" in e) and "data" or "result" for e in out], ["data", "data", "data", "result"])
        self.assertEqual(out[-1], {"result": "RESULT"})
        self.assertTrue(out[2]["data"].startswith("\n\n```json\n"))
        self.assertEqual(json.loads(out[2]["data"].split("```json\n")[1].rsplit("\n```", 1)[0])["flights"][0]["flightNumber"], numbers[1])

    def test_no_block_without_results_or_on_error(self):
        events = [{"data": "No hay vuelos."}, {"result": "RESULT"}]
        self.assertEqual(self.run_agent(events), events)

        def boom(collector):
            collector.flights = [{"flightNumber": "X", "price": object()}]  # provoca un fallo al ordenar/serializar
        out = self.run_agent(events, boom)
        self.assertEqual(out, events)

    def test_collector_state_is_reset_by_the_hook_at_the_start_of_each_invocation(self):
        collector = self.main.FlightsResultCollector()
        registry = mock.MagicMock()
        collector.register_hooks(registry)
        registered = [call.args[0].__name__ for call in registry.add_callback.call_args_list]
        self.assertEqual(registered, ["BeforeInvocationEvent", "AfterToolCallEvent"])

    def test_a_model_written_block_is_superseded_by_the_code_block_on_the_consumer_side(self):
        sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "app", "OrchestratorAgent")))
        import business_tools as bt
        collector = self.main.FlightsResultCollector()
        collector._collect(self.tool_event())
        numbers = [f["flightNumber"] for f in collector.flights]
        model_text = f'Opción {numbers[0]}.\n```json\n{{"flights": [{{"flightNumber": "INVENTADO"}}]}}\n```'
        full = model_text + collector.block_for(model_text)
        cleaned, flights = bt.extract_json_block(full, "flights")
        self.assertNotIn("INVENTADO", json.dumps(flights))
        self.assertEqual(flights[0]["flightNumber"], numbers[0])
        self.assertNotIn("```", cleaned)


class KiwiDirectConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = load_flights_main()

    def test_both_tool_names_map_to_the_same_agent_tool(self):
        self.assertEqual(self.main.ALLOWED_MCP_TOOLS, {"search-flight": "kiwi_search_flight",
                                                       "kiwi-flights.search-flight": "kiwi_search_flight"})

    def test_smithery_key_is_never_sent_to_other_hosts(self):
        self.assertTrue(self.main._is_smithery_host("https://mcp.smithery.ai/x"))
        self.assertTrue(self.main._is_smithery_host("https://server.smithery.ai/abc"))
        for url in ("https://mcp.kiwi.com", "https://evil-smithery.ai.example.com", "https://smithery.ai.evil.com/x"):
            self.assertFalse(self.main._is_smithery_host(url), url)

    def test_connects_to_kiwi_without_authorization_header_and_without_any_key(self):
        main = self.main
        main._mcp_tools, main._mcp_last_failure = None, None
        env = {"TRAVEL_MCP_URL": "https://mcp.kiwi.com", "SMITHERY_SECRET_ID": "arn:aws:secretsmanager:us-east-2:1:secret:x"}
        with mock.patch.dict(os.environ, env), mock.patch.object(main, "_start_mcp", return_value=("client", ["tool"])) as start, \
                mock.patch.object(main, "_read_secret_from_secrets_manager", side_effect=AssertionError("no debe leerse el secreto")):
            self.assertEqual(main._get_mcp_tools(), ["tool"])
        start.assert_called_once_with("https://mcp.kiwi.com", None)
        main._mcp_tools = None

    def test_start_mcp_sends_no_headers_when_there_is_no_key(self):
        main = self.main
        captured = {}

        class FakeClient:
            def __init__(self, transport, startup_timeout=None):
                captured["transport"] = transport

            def start(self):
                pass

            def list_tools_sync(self, pagination_token=None):
                tool = types.SimpleNamespace(name="search-flight", description="d", inputSchema={"type": "object"}, outputSchema=None, annotations=None)
                return [types.SimpleNamespace(mcp_tool=tool)]

        with mock.patch.object(main, "MCPClient", FakeClient), mock.patch.object(main, "streamablehttp_client") as http_client:
            main._start_mcp("https://mcp.kiwi.com", None)
            captured["transport"]()
        self.assertIsNone(http_client.call_args.kwargs["headers"])
        with mock.patch.object(main, "MCPClient", FakeClient), mock.patch.object(main, "streamablehttp_client") as http_client:
            main._start_mcp("https://mcp.smithery.ai/x", "KEY")
            captured["transport"]()
        self.assertEqual(http_client.call_args.kwargs["headers"], {"Authorization": "Bearer KEY"})

    def test_prompt_no_longer_asks_the_model_for_a_json_block(self):
        prompt = self.main.SYSTEM_PROMPT
        self.assertNotIn("```json", prompt)
        self.assertIn("NO escribas bloques JSON", prompt)
        self.assertIn("flightNumber EXACTO", prompt)


if __name__ == "__main__":
    unittest.main()
