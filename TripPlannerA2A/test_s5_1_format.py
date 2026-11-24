"""Pruebas S5.1: el prompt del Orchestrator trae la seccion de formato con interfaz y conserva las reglas anteriores."""

from __future__ import annotations

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def prompt_text() -> str:
    with open(os.path.join(HERE, "..", "app", "OrchestratorAgent", "main.py"), encoding="utf-8") as f:
        return " ".join(f.read().split())


class FormatSectionTests(unittest.TestCase):
    def test_section_and_rules(self):
        t = prompt_text()
        for needle in [
            "Formato de respuesta con interfaz:",
            "NO repitas esos datos en tablas ni en listas largas",
            "Responde en 2 a 4 frases: conclusión, recomendación y siguiente paso propuesto",
            "(Vuelos, Clima, Viaje, Itinerario o Reservas)",
            "Incluye siempre los identificadores relevantes (TRP-…, RES-…)",
            "máximo 4 columnas y cabeceras cortas",
        ]:
            with self.subTest(needle=needle):
                self.assertIn(needle, t)

    def test_previous_rules_are_kept(self):
        t = prompt_text()
        for needle in [
            "usa SIEMPRE el campo weekday de los datos",
            '"Ciudad, País" con el país en español',
            "Antes de usar delete_trip o delete_reservation pide una confirmación",
            "SIMULADAS",
            "Nunca pidas ni aceptes números de tarjeta",
            "devuelve el error UNCERTAIN",
        ]:
            with self.subTest(needle=needle):
                self.assertIn(needle, t)


if __name__ == "__main__":
    unittest.main()
