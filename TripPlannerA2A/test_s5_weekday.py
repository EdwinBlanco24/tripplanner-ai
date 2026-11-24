"""Pruebas S5: weekday en espanol calculado en codigo (WeatherMcpServer) y regla en los prompts.

    python -m unittest test_s5_weekday -v   (con mcp==1.30.0 y httpx)
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "app"))
sys.path.insert(0, os.path.join(APP, "WeatherAgent"))
import weather_blocks as wb  # noqa: E402


def load_server():
    spec = importlib.util.spec_from_file_location("weather_mcp_s5", os.path.join(APP, "WeatherMcpServer", "main.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def text(*parts):
    with open(os.path.join(APP, *parts), encoding="utf-8") as f:
        return " ".join(f.read().split())


class WeekdayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = load_server()

    def test_known_dates(self):
        for day, name in [("2026-12-04", "viernes"), ("2026-12-07", "lunes"), ("2026-12-31", "jueves"),
                          ("2026-12-05", "sábado"), ("2026-12-06", "domingo"), ("2026-12-02", "miércoles"), ("2026-12-01", "martes")]:
            with self.subTest(day=day):
                self.assertEqual(self.srv.weekday_es(day), name)

    def test_invalid_input_gives_none(self):
        for bad in (None, "", "04/12/2026", "2026-02-30", 5):
            self.assertIsNone(self.srv.weekday_es(bad))

    def test_days_carry_weekday(self):
        days = self.srv.build_days({"time": ["2026-12-04", "2026-12-07"], "temperature_2m_max": [30, 31]})
        self.assertEqual([d["weekday"] for d in days], ["viernes", "lunes"])

    def test_current_weather_weekday_uses_the_local_date_of_the_city(self):
        self.assertEqual(self.srv.weekday_es("2026-12-31T23:30"), "jueves")  # fecha local de la ciudad, no UTC


class BlockTests(unittest.TestCase):
    def test_block_keeps_weekday_and_region(self):
        data = {"location": {"name": "Cartagena", "admin1": "Región de Murcia", "country": "España"},
                "days": [{"date": "2026-12-04", "weekday": "viernes", "tempMax": 20, "tempMin": 10, "condition": "Despejado"},
                         {"date": "2026-12-05", "tempMax": 21, "tempMin": 11, "condition": "Nublado"}]}
        forecast = wb.normalize_forecast(data)
        self.assertEqual(forecast["location"], "Cartagena, Región de Murcia, España")
        self.assertEqual(forecast["days"][0]["weekday"], "viernes")
        self.assertNotIn("weekday", forecast["days"][1])
        payload = json.loads(wb.build_weather_block(forecast).split("```json\n")[1].rsplit("\n```", 1)[0])
        self.assertEqual(payload["weather"]["days"][0]["weekday"], "viernes")


class PromptTests(unittest.TestCase):
    def test_weather_agent_rule(self):
        t = text("WeatherAgent", "main.py")
        self.assertIn("Usa SIEMPRE el campo weekday de los datos para nombrar los días; nunca calcules el día de la semana.", t)

    def test_orchestrator_rule(self):
        t = text("OrchestratorAgent", "main.py")
        self.assertIn("usa SIEMPRE el campo weekday de los datos", t)
        self.assertIn("no nombres el día de la semana y muestra solo la fecha", t)


if __name__ == "__main__":
    unittest.main()
