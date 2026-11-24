"""Pruebas S6.1: fecha de hoy en Bogota inyectada por peticion y propuesta de fechas sin que el usuario las de.

    python -m unittest test_s6_1_planning   (con el entorno del Orchestrator)
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "app", "OrchestratorAgent")))
import main  # noqa: E402


def utc(y, m, d, h=12, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


class TodayInBogotaTests(unittest.TestCase):
    def test_current_date_has_weekday_computed_in_code(self):
        self.assertEqual(main.get_current_date(utc(2026, 11, 24)), "2026-11-24 (martes)")

    def test_uses_bogota_not_utc(self):
        # 23:30 UTC del 24 = 18:30 en Bogota (aun 24); 02:00 UTC del 25 = 21:00 del 24 en Bogota
        self.assertEqual(main.today_bogota(utc(2026, 11, 25, 2, 0)), date(2026, 11, 24))
        self.assertEqual(main.today_bogota(utc(2026, 11, 24, 5, 0)), date(2026, 11, 24))
        self.assertEqual(main.today_bogota(utc(2026, 11, 24, 4, 59)), date(2026, 11, 23))


class WindowTests(unittest.TestCase):
    def test_from_tuesday_2026_11_24(self):
        start, end = main.suggest_trip_window(date(2026, 11, 24))
        self.assertEqual((start.isoformat(), end.isoformat()), ("2026-12-03", "2026-12-06"))
        self.assertEqual((start.weekday(), end.weekday()), (3, 6))  # jueves a domingo

    def test_start_is_always_a_thursday_at_least_7_days_ahead(self):
        for offset in range(0, 60):
            today = date(2026, 11, 1).fromordinal(date(2026, 11, 1).toordinal() + offset)
            start, end = main.suggest_trip_window(today)
            self.assertEqual(start.weekday(), 3)
            self.assertGreaterEqual((start - today).days, 7)
            self.assertLess((start - today).days, 14)
            self.assertEqual((end - start).days, 3)

    def test_exactly_seven_days_ahead_thursday_counts(self):
        start, _ = main.suggest_trip_window(date(2026, 11, 26))  # jueves + 7 = jueves 12-03
        self.assertEqual(start.isoformat(), "2026-12-03")

    def test_custom_duration(self):
        start, end = main.suggest_trip_window(date(2026, 11, 24), days=6)
        self.assertEqual(end.isoformat(), "2026-12-08")

    def test_description_for_the_prompt_and_horizon_warning(self):
        text = main.describe_window(date(2026, 11, 24))
        self.assertEqual(text, "del jueves 2026-12-03 al domingo 2026-12-06 (4 días)")
        self.assertIn("fuera del pronóstico", main.describe_window(date(2026, 11, 24), days=10))


class PromptTests(unittest.TestCase):
    def test_prompt_formats_with_both_values(self):
        prompt = main.SYSTEM_PROMPT.format(rate_rule="x", current_date=main.get_current_date(utc(2026, 11, 24)), trip_window=main.describe_window(date(2026, 11, 24)))
        flat = " ".join(prompt.split())
        self.assertIn("(hora de Bogotá) es: 2026-11-24 (martes)", flat)
        self.assertIn("del jueves 2026-12-03 al domingo 2026-12-06 (4 días)", flat)

    def test_planning_rules(self):
        flat = " ".join(main.SYSTEM_PROMPT.split())
        for needle in [
            "Planificación sin fechas:",
            "NO preguntes primero: propón fechas concretas",
            "Propongo del jueves X al domingo Y; puedes cambiarlas",
            "en el MISMO turno llama a ask_flights",
            "ask_weather (destino completo",
            '"Viajo con dos personas más" = 3 viajeros',
            "5 millones = 5000000",
            "3 o 4 ideas acordes al clima",
            "NO crees el viaje (create_trip) hasta que el usuario lo pida",
            "dentro de los 16 días del pronóstico",
        ]:
            with self.subTest(needle=needle):
                self.assertIn(needle, flat)

    def test_previous_rules_are_kept(self):
        flat = " ".join(main.SYSTEM_PROMPT.split())
        for needle in ["Formato de respuesta con interfaz:", "usa SIEMPRE el campo weekday", '"Ciudad, País"', "UNCERTAIN", "SIMULADAS"]:
            self.assertIn(needle, flat)


class TestFlagEmojiRuleS62(unittest.TestCase):
    """S6.2: el prompt prohibe los emojis de banderas y conserva las reglas anteriores."""

    def setUp(self):
        self.prompt = main.SYSTEM_PROMPT.format(rate_rule="x", current_date="2026-11-24 (martes)", trip_window="del jueves 2026-12-03 al domingo 2026-12-06 (4 días)")

    def test_flag_rule_present(self):
        self.assertIn("No uses emojis de banderas", self.prompt)
        self.assertIn("escribe el nombre del país", self.prompt)

    def test_previous_rules_kept(self):
        for text in ("Planificación sin fechas", "NO crees el viaje", "Formato de respuesta con interfaz", "SIMULADA", "UNCERTAIN", "2026-12-03"):
            self.assertIn(text, self.prompt)


class TestReferenceRateOP12(unittest.TestCase):
    """OP1-2: tasa de referencia USD/COP unica, tomada de REFERENCE_USD_COP."""

    def test_reads_the_variable(self):
        self.assertEqual(main.reference_usd_cop({"REFERENCE_USD_COP": "3300"}), "3300")
        self.assertEqual(main.reference_usd_cop({"REFERENCE_USD_COP": " 3300.0 "}), "3300")
        self.assertEqual(main.reference_usd_cop({"REFERENCE_USD_COP": "3812.5"}), "3812.5")

    def test_missing_or_invalid_gives_none(self):
        for env in ({}, {"REFERENCE_USD_COP": ""}, {"REFERENCE_USD_COP": "abc"}, {"REFERENCE_USD_COP": "0"}, {"REFERENCE_USD_COP": "-5"}, {"REFERENCE_USD_COP": "inf"}):
            self.assertIsNone(main.reference_usd_cop(env), env)

    def test_rule_with_rate(self):
        rule = main.exchange_rate_rule("3300")
        self.assertIn("SIEMPRE la tasa de referencia 3300 COP/USD", rule)
        self.assertIn("aproximada", rule)
        self.assertIn("no uses otra tasa", rule)

    def test_rule_without_rate_does_not_convert(self):
        rule = main.exchange_rate_rule(None)
        self.assertIn("NO conviertas", rule)
        self.assertNotIn("COP/USD", rule)

    def test_prompt_contains_the_rule_and_formats(self):
        prompt = main.SYSTEM_PROMPT.format(rate_rule=main.exchange_rate_rule("3300"), current_date="2026-11-24 (martes)", trip_window="x")
        self.assertIn("Tasa de cambio:", prompt)
        self.assertIn("3300 COP/USD", prompt)
        self.assertIn("No uses emojis de banderas", prompt)  # conserva reglas anteriores

    def test_deploy_config_declares_the_variable(self):
        import json
        cfg = json.load(open(os.path.join(HERE, "agentcore", "agentcore.json"), encoding="utf-8"))
        orch = next(r for r in cfg["runtimes"] if r["name"] == "OrchestratorAgent")
        self.assertIn({"name": "REFERENCE_USD_COP", "value": "3300"}, orch["envVars"])


class TestPreferencesSectionOP3(unittest.TestCase):
    """OP3: el prompt pide leer las preferencias una vez y aplicarlas, sin perder reglas anteriores."""

    def setUp(self):
        self.prompt = main.SYSTEM_PROMPT.format(rate_rule="x", current_date="2026-11-24 (martes)", trip_window="del jueves 2026-12-03 al domingo 2026-12-06 (4 días)")

    def test_section_and_rules(self):
        for text in ("Preferencias del usuario:", "get_preferences", "UNA sola vez por conversación", "RELAXED 2", "BALANCED 3", "INTENSE 4 a 5",
                     "flightTime", "budgetLevel", "Como prefieres", "no inventes", "Mis preferencias", "NO consultes las preferencias",
                     "prevalecen sobre lo recordado"):
            self.assertIn(text, self.prompt)

    def test_previous_rules_are_kept(self):
        for text in ("Planificación sin fechas", "NO crees el viaje", "Formato de respuesta con interfaz", "Tasa de cambio:", "No uses emojis de banderas",
                     "SIMULADA", "UNCERTAIN", "La fecha actual del sistema", "2026-12-03"):
            self.assertIn(text, self.prompt)

    def test_the_preferences_tool_exists_and_emits_the_ui_component(self):
        import business_tools as bt
        self.assertEqual(bt._lambda_ui("get_preferences", {}, {"preferences": None}), ("preferences", {"preferences": None}))
        self.assertEqual(bt._lambda_ui("update_preferences", {}, {"preferences": {"pace": "RELAXED"}})[0], "preferences")


if __name__ == "__main__":
    unittest.main()
