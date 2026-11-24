"""Pruebas S3c del clima (sin red ni AWS): WeatherMcpServer (logica con Open-Meteo simulado) y WeatherAgent.

    python -m unittest test_s3c_weather -v   (desde TripPlannerA2A, con mcp, strands-agents, httpx y boto3 disponibles)
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import types
import unittest
from datetime import date
from unittest import mock

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "WeatherMcpServer"))
AGENT_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "WeatherAgent"))
sys.path.insert(0, AGENT_DIR)

import weather_blocks as wb  # noqa: E402


def load(name: str, directory: str):
    spec = importlib.util.spec_from_file_location(name, os.path.join(directory, "main.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TODAY = date(2026, 11, 23)

GEOCODE_OK = {"results": [{"name": "Cartagena de Indias", "country": "Colombia", "latitude": 10.39817, "longitude": -75.49328}]}
FORECAST_OK = {"daily": {
    "time": ["2026-11-26", "2026-11-27", "2026-11-28"],
    "temperature_2m_max": [32.14, 31.9, None],
    "temperature_2m_min": [27.7, 26.6, 26.6],
    "precipitation_probability_max": [92, 75.0, None],
    "weather_code": [53, 51, 999],
}}


def fake_open_meteo(geocode=GEOCODE_OK, forecast=FORECAST_OK, calls=None, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if "geocoding-api" in request.url.host:
            return httpx.Response(status, json=geocode)
        return httpx.Response(status, json=forecast)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class ServerLogicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = load("weather_mcp_main", SERVER_DIR)

    def test_validate_range(self):
        v = self.srv.validate_range
        self.assertEqual(v("2026-11-23", "2026-11-23", TODAY), (TODAY, TODAY))
        v("2026-11-22", "2026-11-23", TODAY)  # ayer se tolera (zonas horarias)
        for start, end, text in [
            ("2026-11-26", "2026-11-25", "anterior"),
            ("2026-11-20", "2026-11-23", "pasada"),
            ("2026-11-23", "2026-12-09", "16 días"),
            ("2026-12-01", "2026-12-10", "horizonte"),
            ("26/11/2026", "2026-11-27", "YYYY-MM-DD"),
            ("2026-02-30", "2026-03-01", "fecha válida"),
        ]:
            with self.subTest(start=start, end=end):
                with self.assertRaises(ValueError) as ctx:
                    v(start, end, TODAY)
                self.assertIn(text, str(ctx.exception))
        v("2026-11-23", "2026-12-08", TODAY)  # exactamente 16 días: ok

    def test_condition_table_is_spanish_and_total(self):
        self.assertEqual(self.srv.condition_for(0), "Despejado")
        self.assertEqual(self.srv.condition_for(95), "Tormenta eléctrica")
        self.assertEqual(self.srv.condition_for(12345), "Condición desconocida")
        self.assertEqual(self.srv.condition_for(None), "Condición desconocida")
        self.assertEqual(self.srv.condition_for(True), "Condición desconocida")

    def test_build_days_tolerates_missing_values(self):
        days = self.srv.build_days(FORECAST_OK["daily"])
        self.assertEqual(days[0], {"date": "2026-11-26", "weekday": "jueves", "tempMax": 32.1, "tempMin": 27.7, "rainProbability": 92, "condition": "Llovizna moderada"})
        self.assertEqual(days[1]["rainProbability"], 75)
        self.assertIsNone(days[2]["tempMax"])
        self.assertIsNone(days[2]["rainProbability"])
        self.assertEqual(days[2]["condition"], "Condición desconocida")
        self.assertEqual(self.srv.build_days({}), [])

    def test_forecast_end_to_end_with_simulated_open_meteo(self):
        calls = []

        async def run():
            async with fake_open_meteo(calls=calls) as client:
                return await self.srv.forecast(client, " Cartagena ", "2026-11-26", "2026-11-28", "co", today=TODAY)
        out = asyncio.run(run())
        self.assertEqual(out["location"], {"name": "Cartagena de Indias", "country": "Colombia", "admin1": None, "lat": 10.39817, "lon": -75.49328})
        self.assertEqual(len(out["days"]), 3)
        geocode_params = dict(calls[0].url.params)
        self.assertEqual(geocode_params["name"], "Cartagena")
        self.assertEqual(geocode_params["countryCode"], "CO")
        self.assertEqual(geocode_params["language"], "es")
        forecast_params = dict(calls[1].url.params)
        self.assertEqual((forecast_params["start_date"], forecast_params["end_date"]), ("2026-11-26", "2026-11-28"))
        self.assertEqual(forecast_params["timezone"], "auto")

    def test_errors_are_clear_and_spanish(self):
        async def run(coro_factory, **kw):
            async with fake_open_meteo(**kw) as client:
                return await coro_factory(client)

        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run(lambda c: self.srv.forecast(c, "Nada", "2026-11-26", "2026-11-27", today=TODAY), geocode={"results": []}))
        self.assertIn("No se encontró la ciudad", str(ctx.exception))
        with self.assertRaises(ValueError):
            asyncio.run(run(lambda c: self.srv.forecast(c, "  ", "2026-11-26", "2026-11-27", today=TODAY)))
        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run(lambda c: self.srv.geocode(c, "Bogota", "COL")))
        self.assertIn("country_code", str(ctx.exception))
        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run(lambda c: self.srv.forecast(c, "X", "2026-11-26", "2026-11-27", today=TODAY), forecast={"daily": {"time": []}}))
        self.assertIn("no devolvió datos", str(ctx.exception))
        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run(lambda c: self.srv.geocode(c, "X"), geocode={"error": True, "reason": "Rate limit"}, status=429))
        self.assertIn("Rate limit", str(ctx.exception))

    def test_network_failures_become_value_errors(self):
        def boom(request):
            raise httpx.ConnectTimeout("t")

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as client:
                return await self.srv.geocode(client, "X")
        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run())
        self.assertIn("no respondió a tiempo", str(ctx.exception))

    def test_current_weather_shape(self):
        current = {"current": {"time": "2026-11-23T14:45", "temperature_2m": 31.84, "apparent_temperature": 37.7,
                               "relative_humidity_2m": 70, "wind_speed_10m": 7.7, "weather_code": 51}}

        async def run():
            async with fake_open_meteo(forecast=current) as client:
                return await self.srv.current_weather(client, "Cartagena")
        out = asyncio.run(run())
        self.assertEqual(out["current"], {"time": "2026-11-23T14:45", "weekday": "lunes", "temperature": 31.8, "apparentTemperature": 37.7,
                                          "humidity": 70, "windSpeedKmh": 7.7, "condition": "Llovizna ligera"})

    def test_server_contract_for_agentcore(self):
        self.assertEqual(self.srv.mcp.settings.host, "0.0.0.0")
        self.assertEqual(self.srv.mcp.settings.port, 8000)
        self.assertTrue(self.srv.mcp.settings.stateless_http)
        self.assertEqual(self.srv.mcp.settings.streamable_http_path, "/mcp")
        names = {t.name for t in asyncio.run(self.srv.mcp.list_tools())}
        self.assertEqual(names, {"get_forecast", "get_current_weather"})


SERVER_RESULT = {
    "status": "success", "toolUseId": "t1",
    "content": [{"text": json.dumps({"location": {"name": "Cartagena de Indias", "country": "Colombia", "lat": 1, "lon": 2},
                                     "days": [{"date": "2026-11-26", "tempMax": 32.1, "tempMin": 27.7, "rainProbability": 92, "condition": "Llovizna moderada"},
                                              {"date": "mal", "tempMax": 1},
                                              {"date": "2026-11-27", "tempMax": 31.9, "tempMin": 26.6, "rainProbability": None, "condition": "Nublado"}]})}],
}


class WeatherBlocksTests(unittest.TestCase):
    def test_parse_tool_result(self):
        self.assertEqual(wb.parse_tool_result(SERVER_RESULT)["location"]["name"], "Cartagena de Indias")
        self.assertEqual(wb.parse_tool_result({"structuredContent": {"a": 1}, "content": []}), {"a": 1})
        self.assertIsNone(wb.parse_tool_result({"status": "error", "content": [{"text": "{}"}]}))
        self.assertIsNone(wb.parse_tool_result({"content": [{"text": "no json"}]}))
        self.assertIsNone(wb.parse_tool_result(None))

    def test_normalize_drops_invalid_days_and_flattens_location(self):
        forecast = wb.normalize_forecast(wb.parse_tool_result(SERVER_RESULT))
        self.assertEqual(forecast["location"], "Cartagena de Indias, Colombia")
        self.assertEqual([d["date"] for d in forecast["days"]], ["2026-11-26", "2026-11-27"])
        self.assertEqual(forecast["days"][0]["rainProbability"], 92)
        self.assertNotIn("rainProbability", forecast["days"][1])
        self.assertIsNone(wb.normalize_forecast({"days": []}))
        self.assertIsNone(wb.normalize_forecast("x"))

    def test_block_format_is_what_the_orchestrator_extracts(self):
        block = wb.build_weather_block(wb.normalize_forecast(wb.parse_tool_result(SERVER_RESULT)))
        self.assertTrue(block.startswith("\n\n```json\n") and block.endswith("\n```"))
        payload = json.loads(block.split("```json\n")[1].rsplit("\n```", 1)[0])
        self.assertEqual(set(payload), {"weather"})
        self.assertEqual(set(payload["weather"]), {"location", "days"})
        self.assertEqual(wb.build_weather_block(None), "")

    def test_orchestrator_extracts_the_block(self):
        orch = os.path.abspath(os.path.join(HERE, "..", "app", "OrchestratorAgent"))
        sys.path.insert(0, orch)
        try:
            import business_tools
        finally:
            sys.path.remove(orch)
        text = "Pronóstico sobrio." + wb.build_weather_block(wb.normalize_forecast(wb.parse_tool_result(SERVER_RESULT)))
        clean, weather = business_tools.extract_json_block(text, "weather", expect=(list, dict))
        self.assertEqual(clean.strip(), "Pronóstico sobrio.")
        self.assertEqual(len(weather["days"]), 2)


class WeatherAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = load("weather_agent_main", AGENT_DIR)

    def tool_event(self, result=SERVER_RESULT, name="get_forecast", exception=None):
        return types.SimpleNamespace(tool_use={"name": name, "toolUseId": "t1"}, result=result, exception=exception)

    def test_collector_only_keeps_forecast_results(self):
        c = self.main.WeatherResultCollector()
        c._collect(self.tool_event(name="get_current_weather"))
        c._collect(self.tool_event(exception=RuntimeError("x")))
        c._collect(self.tool_event(result={"status": "error", "content": []}))
        self.assertEqual(c.block(), "")
        c._collect(self.tool_event())
        self.assertIn('"weather"', c.block())
        c._reset(types.SimpleNamespace())
        self.assertEqual(c.block(), "")

    def test_block_is_appended_before_the_final_result(self):
        main = self.main

        async def fake_stream(self, *args, **kwargs):
            yield {"data": "Texto. "}
            yield {"result": "RESULT"}

        collector = main.WeatherResultCollector()
        with mock.patch("strands.Agent.__init__", lambda self, *a, **k: None), \
                mock.patch("strands.Agent.stream_async", fake_stream):
            agent = main.WeatherAgent(collector=collector)
            collector._collect(self.tool_event())

            async def collect():
                return [e async for e in agent.stream_async("hola")]
            out = asyncio.run(collect())
        self.assertEqual(out[0], {"data": "Texto. "})
        self.assertIn("```json", out[1]["data"])
        self.assertEqual(out[2], {"result": "RESULT"})

    def test_runtime_url_encodes_the_arn(self):
        arn = "arn:aws:bedrock-agentcore:us-east-2:458934380591:runtime/TripPlannerA2A_WeatherMcpServer-AbCdEfGhIj"
        url = self.main.runtime_url(arn)
        self.assertTrue(url.startswith("https://bedrock-agentcore.us-east-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3A"))
        self.assertTrue(url.endswith("%2FTripPlannerA2A_WeatherMcpServer-AbCdEfGhIj/invocations?qualifier=DEFAULT"))

    def test_mcp_client_uses_sigv4_and_session_header(self):
        main = self.main
        captured = {}

        class FakeClient:
            def __init__(self, transport, startup_timeout=None):
                captured["transport"] = transport

            def start(self): pass
            def stop(self, *a): pass
            def list_tools_sync(self, pagination_token=None):
                tools = [types.SimpleNamespace(tool_name=n, mcp_tool=types.SimpleNamespace(name=n)) for n in ("get_forecast", "get_current_weather", "otra")]
                return tools

        arn = "arn:aws:bedrock-agentcore:us-east-2:1:runtime/TripPlannerA2A_WeatherMcpServer-X"
        with mock.patch.object(main, "MCPClient", FakeClient), mock.patch.object(main, "streamablehttp_client") as http_client:
            client, tools = main._start_mcp(arn)
            captured["transport"]()
        self.assertEqual([t.tool_name for t in tools], ["get_forecast", "get_current_weather"])
        kwargs = http_client.call_args.kwargs
        self.assertIsInstance(kwargs["auth"], main.SigV4Auth)
        self.assertEqual((kwargs["auth"].service, kwargs["auth"].region), ("bedrock-agentcore", "us-east-2"))
        self.assertGreaterEqual(len(kwargs["headers"][main.SESSION_HEADER]), 33)

    def test_without_arn_the_agent_falls_back_honestly(self):
        main = self.main
        main._mcp_tools = None
        main._mcp_last_failure = None
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WEATHER_MCP_RUNTIME_ARN", None)
            self.assertIsNone(main._get_mcp_tools())
            with mock.patch.object(main, "WeatherAgent") as agent_cls:
                main.create_agent("ctx")
        kwargs = agent_cls.call_args.kwargs
        self.assertEqual(kwargs["tools"], [])
        self.assertIn("NO inventes", kwargs["system_prompt"])

    def test_prompt_forbids_model_written_json_and_states_the_horizon(self):
        self.assertIn("NO escribas bloques JSON", self.main.SYSTEM_PROMPT)
        self.assertIn("15 días", self.main.SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
