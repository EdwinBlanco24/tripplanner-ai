"""Pruebas S4.3: "Ciudad, Pais" en WeatherMcpServer (geocodificacion simulada, sin red).

    python -m unittest test_s4_3_places -v   (con mcp==1.30.0 y httpx)
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import unittest
from datetime import date

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, "..", "app", "WeatherMcpServer"))


def load():
    spec = importlib.util.spec_from_file_location("weather_mcp_s43", os.path.join(SERVER_DIR, "main.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hit(id_, name, country, code, admin1, lat, lon):
    return {"id": id_, "name": name, "country": country, "country_code": code, "admin1": admin1, "latitude": lat, "longitude": lon}


CTG_CO = hit(1, "Cartagena", "Colombia", "CO", "Bolívar", 10.39972, -75.51444)
CTG_ES = hit(2, "Cartagena", "España", "ES", "Región de Murcia", 37.60512, -0.98623)
CTG_CL = hit(3, "Cartagena", "Chile", "CL", "Valparaíso", -33.55, -71.6)
ES_RESULTS = [CTG_CO, CTG_ES, CTG_CL]
EN_RESULTS = [dict(CTG_CO, country="Colombia"), dict(CTG_ES, country="Spain"), dict(CTG_CL, country="Chile")]
FORECAST = {"daily": {"time": ["2026-11-26"], "temperature_2m_max": [30], "temperature_2m_min": [24],
                      "precipitation_probability_max": [10], "weather_code": [1]}}


def client(calls: list):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if "geocoding-api" in request.url.host:
            lang = request.url.params.get("language")
            return httpx.Response(200, json={"results": EN_RESULTS if lang == "en" else ES_RESULTS})
        return httpx.Response(200, json=FORECAST)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class PlaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = load()

    def geo(self, place, **kw):
        calls: list = []

        async def run():
            async with client(calls) as c:
                return await self.srv.geocode(c, place, **kw)
        return asyncio.run(run()), calls

    def test_parse_place(self):
        p = self.srv.parse_place
        self.assertEqual(p("Cartagena"), ("Cartagena", None, None))
        self.assertEqual(p("Cartagena, Colombia"), ("Cartagena", None, "Colombia"))
        self.assertEqual(p(" Cartagena ,  España "), ("Cartagena", None, "España"))
        self.assertEqual(p("Cartagena, Región de Murcia, España"), ("Cartagena", "Región de Murcia", "España"))
        self.assertEqual(p("San Cristóbal de La Laguna, España"), ("San Cristóbal de La Laguna", None, "España"))

    def test_colombia_vs_spain(self):
        co, _ = self.geo("Cartagena, Colombia")
        es, _ = self.geo("Cartagena, España")
        self.assertEqual((co["country"], co["lat"]), ("Colombia", 10.39972))
        self.assertEqual((es["country"], es["lat"]), ("España", 37.60512))
        self.assertIn("admin1", co)
        self.assertEqual(es["admin1"], "Región de Murcia")

    def test_geocoder_receives_only_the_city_with_count_10(self):
        _, calls = self.geo("Cartagena, Colombia")
        params = dict(calls[0].url.params)
        self.assertEqual((params["name"], params["count"], params["language"]), ("Cartagena", "10", "es"))

    def test_iso2_english_and_accents(self):
        self.assertEqual(self.geo("Cartagena, ES")[0]["country"], "España")
        self.assertEqual(self.geo("Cartagena, es")[0]["country"], "España")
        self.assertEqual(self.geo("Cartagena, Spain")[0]["country"], "España")   # ingles: segunda consulta, nombres en espanol
        self.assertEqual(self.geo("Cartagena, ESPANA")[0]["country"], "España")  # sin tilde ni mayusculas
        self.assertEqual(self.geo("Cartagena", country_code="ES")[0]["country"], "España")  # parametro heredado

    def test_region_breaks_ties(self):
        dup = [hit(10, "Cartagena", "España", "ES", "Andalucía", 1.0, 1.0), CTG_ES]
        calls: list = []

        def handler(request):
            return httpx.Response(200, json={"results": dup})

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                return await self.srv.geocode(c, "Cartagena, Murcia, España")
        self.assertEqual(asyncio.run(run())["admin1"], "Región de Murcia")

    def test_without_country_keeps_first_result(self):
        out, _ = self.geo("Cartagena")
        self.assertEqual(out["country"], "Colombia")

    def test_country_without_match_is_a_clear_spanish_error(self):
        with self.assertRaises(ValueError) as ctx:
            self.geo("Cartagena, Japón")
        self.assertEqual(str(ctx.exception), "No encontré Cartagena en Japón.")

    def test_forecast_uses_the_matching_city(self):
        calls: list = []

        async def run():
            async with client(calls) as c:
                return await self.srv.forecast(c, "Cartagena, España", "2026-11-26", "2026-11-26", today=date(2026, 11, 23))
        out = asyncio.run(run())
        self.assertEqual(out["location"]["lat"], 37.60512)
        self.assertEqual(float(dict(calls[-1].url.params)["latitude"]), 37.60512)

    def test_current_weather_accepts_city_country(self):
        cur = {"current": {"time": "t", "temperature_2m": 20, "weather_code": 0}}

        def handler(request):
            if "geocoding-api" in request.url.host:
                return httpx.Response(200, json={"results": ES_RESULTS})
            return httpx.Response(200, json=cur)

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                return await self.srv.current_weather(c, "Cartagena, Chile")
        self.assertEqual(asyncio.run(run())["location"]["country"], "Chile")


class PromptTests(unittest.TestCase):
    """Los prompts piden "Ciudad, Pais" (se leen como texto: no hace falta importar los agentes)."""

    @staticmethod
    def text(*parts):
        with open(os.path.join(HERE, "..", "app", *parts), encoding="utf-8") as f:
            return f.read()

    def test_weather_agent_passes_the_full_location(self):
        self.assertIn("COMPLETA", self.text("WeatherAgent", "main.py"))
        self.assertIn('"Ciudad, País"', self.text("WeatherAgent", "main.py"))

    def test_orchestrator_saves_and_forwards_city_country(self):
        t = self.text("OrchestratorAgent", "main.py")
        self.assertIn('origin y destination como "Ciudad, País"', t)
        self.assertIn("destino COMPLETO", " ".join(t.split()))

    def test_flights_agent_prompt_is_unchanged_by_s4_3(self):
        t = self.text("FlightsAgent", "main.py")
        self.assertIn("kiwi_search_flight", t)
        self.assertNotIn("Ciudad, País", t)


if __name__ == "__main__":
    unittest.main()
