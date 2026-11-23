import unittest
from datetime import date
from decimal import Decimal

import support  # noqa: F401  (configura sys.path)
from common import validation as v
from common.errors import ValidationError

TODAY = date(2026, 11, 22)


def fields(exc: ValidationError) -> set[str]:
    return {d["field"] for d in exc.details}


class TripCreateTests(unittest.TestCase):
    def ok(self, **overrides):
        return v.validate_trip_create(support.trip_body(**overrides), TODAY)

    def bad(self, **overrides):
        with self.assertRaises(ValidationError) as ctx:
            self.ok(**overrides)
        return ctx.exception

    def test_valid_trip(self):
        out = self.ok(notes="  Aniversario  ")
        self.assertEqual(out["title"], "Fin de semana en Cartagena")
        self.assertEqual(out["travelers"], 3)
        self.assertEqual(out["budget"], Decimal("5000000"))
        self.assertEqual(out["notes"], "Aniversario")
        self.assertEqual(out["startDate"], "2026-12-04")

    def test_today_is_allowed_but_past_is_not(self):
        self.ok(startDate="2026-11-22", endDate="2026-11-23")
        self.assertIn("startDate", fields(self.bad(startDate="2026-11-21", endDate="2026-11-23")))

    def test_end_before_start(self):
        self.assertIn("endDate", fields(self.bad(startDate="2026-12-10", endDate="2026-12-09")))

    def test_trip_longer_than_90_days(self):
        self.assertIn("endDate", fields(self.bad(startDate="2026-12-01", endDate="2027-03-05")))

    def test_invalid_date_formats(self):
        for value in ("2026-13-01", "04/12/2026", "20261204", "2026-02-30", 20261204, None):
            with self.subTest(value=value):
                self.assertTrue(self.bad(startDate=value))

    def test_travelers_range(self):
        for ok in (1, 20):
            self.ok(travelers=ok)
        for bad in (0, 21, -1, 2.5, "3", True):
            with self.subTest(bad=bad):
                self.assertIn("travelers", fields(self.bad(travelers=bad)))

    def test_budget_rules(self):
        self.assertEqual(self.ok(budget=1500.5)["budget"], Decimal("1500.5"))
        for bad in (0, -5, "100", 100000001, Decimal("1.234"), True):
            with self.subTest(bad=bad):
                self.assertIn("budget", fields(self.bad(budget=bad)))

    def test_currency_enum(self):
        self.ok(currency="USD")
        self.assertIn("currency", fields(self.bad(currency="EUR")))
        self.assertIn("currency", fields(self.bad(currency="cop")))

    def test_required_and_lengths(self):
        self.assertIn("title", fields(self.bad(title="   ")))
        self.assertIn("title", fields(self.bad(title="x" * 121)))
        self.assertIn("origin", fields(self.bad(origin="A")))
        self.assertIn("destination", fields(self.bad(destination="x" * 81)))
        self.assertIn("notes", fields(self.bad(notes="x" * 1001)))
        body = support.trip_body()
        del body["budget"]
        with self.assertRaises(ValidationError) as ctx:
            v.validate_trip_create(body, TODAY)
        self.assertIn("budget", fields(ctx.exception))

    def test_unknown_fields_are_rejected_but_read_only_are_ignored(self):
        self.assertIn("hotelStars", fields(self.bad(hotelStars=5)))
        self.assertIn("status", fields(self.bad(status="CANCELLED")))
        out = self.ok(tripId="TRP-00000000", createdBy="assistant")
        self.assertNotIn("tripId", out)

    def test_body_must_be_an_object(self):
        for body in (None, [], "x", 5):
            with self.assertRaises(ValidationError):
                v.validate_trip_create(body, TODAY)

    def test_control_characters_are_rejected(self):
        self.assertIn("title", fields(self.bad(title="Hola\x00mundo")))
        self.assertIn("title", fields(self.bad(title="Hola\nmundo")))
        self.ok(notes="línea 1\nlínea 2")


class PaymentDataTests(unittest.TestCase):
    def test_card_fields_are_rejected_everywhere(self):
        for key in ("cardNumber", "card_number", "cvv", "CVC", "expiryDate", "cardHolder", "creditCard", "pan"):
            with self.subTest(key=key):
                with self.assertRaises(ValidationError) as ctx:
                    v.validate_trip_create(support.trip_body(**{key: "4111111111111111"}), TODAY)
                self.assertIn("tarjetas", str(ctx.exception))
                self.assertEqual(ctx.exception.details[0]["issue"], "payment_data_not_allowed")

    def test_card_fields_nested_in_details(self):
        body = support.flight_reservation()
        body["details"]["cardNumber"] = "4111111111111111"
        with self.assertRaises(ValidationError) as ctx:
            v.validate_reservation_create(body)
        self.assertEqual(ctx.exception.details[0]["issue"], "payment_data_not_allowed")

    def test_deeply_nested_structures_are_rejected(self):
        nested: dict = {}
        cursor = nested
        for _ in range(20):
            cursor["a"] = {}
            cursor = cursor["a"]
        with self.assertRaises(ValidationError):
            v.reject_payment_fields(nested)


class TripUpdateTests(unittest.TestCase):
    existing = {"startDate": "2026-12-04", "endDate": "2026-12-07", "status": "PLANNED"}

    def test_partial_update_returns_only_changes(self):
        self.assertEqual(v.validate_trip_update({"title": " Nuevo "}, self.existing, TODAY), {"title": "Nuevo"})

    def test_empty_update_is_rejected(self):
        with self.assertRaises(ValidationError):
            v.validate_trip_update({}, self.existing, TODAY)

    def test_past_date_check_only_applies_to_changed_start(self):
        old = {"startDate": "2026-11-01", "endDate": "2026-11-30"}  # viaje ya en curso
        self.assertEqual(v.validate_trip_update({"startDate": "2026-11-01"}, old, TODAY), {"startDate": "2026-11-01"})
        self.assertEqual(v.validate_trip_update({"endDate": "2026-12-05"}, old, TODAY), {"endDate": "2026-12-05"})
        with self.assertRaises(ValidationError):
            v.validate_trip_update({"startDate": "2026-11-02"}, old, TODAY)

    def test_dates_are_checked_against_final_values(self):
        with self.assertRaises(ValidationError):
            v.validate_trip_update({"endDate": "2026-12-01"}, self.existing, TODAY)

    def test_notes_can_be_cleared_and_status_changed(self):
        self.assertEqual(v.validate_trip_update({"notes": None}, self.existing, TODAY), {"notes": None})
        self.assertEqual(v.validate_trip_update({"notes": ""}, self.existing, TODAY), {"notes": None})
        self.assertEqual(v.validate_trip_update({"status": "CANCELLED"}, self.existing, TODAY), {"status": "CANCELLED"})
        with self.assertRaises(ValidationError):
            v.validate_trip_update({"status": "DONE"}, self.existing, TODAY)


class ItineraryTests(unittest.TestCase):
    trip = {"startDate": "2026-12-04", "endDate": "2026-12-07"}

    def day(self, date_="2026-12-04", **extra):
        day = {"date": date_, "items": [{"time": "07:15", "title": "Vuelo", "type": "flight"}]}
        day.update(extra)
        return day

    def test_valid_itinerary_is_sorted(self):
        out = v.validate_itinerary({"days": [self.day("2026-12-05"), self.day("2026-12-04")]}, self.trip)
        self.assertEqual([d["date"] for d in out], ["2026-12-04", "2026-12-05"])

    def test_weather_and_optional_fields(self):
        weather = {"tempMax": 31, "tempMin": 24.5, "condition": "Nublado", "rainProbability": 20}
        out = v.validate_itinerary({"days": [self.day(weather=weather)]}, self.trip)
        self.assertEqual(out[0]["weather"]["tempMin"], Decimal("24.5"))

    def test_rejects_date_outside_trip_duplicates_and_bad_times(self):
        cases = [
            {"days": [self.day("2026-12-08")]},
            {"days": [self.day(), self.day()]},
            {"days": [self.day(items=[{"time": "7:15", "title": "x", "type": "flight"}])]},
            {"days": [self.day(items=[{"time": "07:15", "title": "x", "type": "boat"}])]},
            {"days": [self.day(weather={"rainProbability": 101})]},
            {"days": []},
            {"days": "no"},
            {},
            {"days": [self.day()], "extra": 1},
        ]
        for body in cases:
            with self.subTest(body=body):
                with self.assertRaises(ValidationError):
                    v.validate_itinerary(body, self.trip)

    def test_limits(self):
        many_items = [{"time": "08:00", "title": "x", "type": "other"}] * 31
        with self.assertRaises(ValidationError):
            v.validate_itinerary({"days": [self.day(items=many_items)]}, self.trip)
        long_trip = {"startDate": "2026-12-01", "endDate": "2027-02-28"}
        days = [{"date": date.fromordinal(date(2026, 12, 1).toordinal() + i).isoformat(), "items": []} for i in range(31)]
        with self.assertRaises(ValidationError):
            v.validate_itinerary({"days": days}, long_trip)


class ReservationTests(unittest.TestCase):
    def test_defaults_to_simulada(self):
        out = v.validate_reservation_create(support.flight_reservation())
        self.assertEqual(out["status"], "SIMULADA")
        self.assertEqual(out["price"], Decimal("289000"))

    def test_hotel_and_activity(self):
        hotel = {"type": "HOTEL", "provider": "Casa Pestagua", "price": 0, "currency": "USD",
                 "details": {"hotelName": "Casa Pestagua", "checkIn": "2026-12-04", "checkOut": "2026-12-07"}}
        self.assertEqual(v.validate_reservation_create(hotel)["type"], "HOTEL")
        activity = {"type": "ACTIVITY", "provider": "Tours", "price": 50, "currency": "USD",
                    "details": {"activityName": "Islas del Rosario", "date": "2026-12-05", "time": "09:00"}}
        self.assertEqual(v.validate_reservation_create(activity)["details"]["time"], "09:00")

    def test_invalid_reservations(self):
        base = support.flight_reservation
        cases = {
            "type": base(type="CAR"),
            "status": base(status="PAGADA"),
            "currency": base(currency="EUR"),
            "price": base(price=-1),
            "provider": base(provider=""),
            "missing details": {k: v_ for k, v_ in base().items() if k != "details"},
            "unknown key": base(extra=1),
            "details unknown": base(details={"flightNumber": "A", "origin": "B", "destination": "C", "departureTime": "x", "seat": "1A"}),
            "details missing": base(details={"airline": "Avianca"}),
            "http url": base(details={"flightNumber": "A", "origin": "B", "destination": "C", "departureTime": "x", "bookingUrl": "http://x"}),
            "value too long": base(details={"flightNumber": "A" * 201, "origin": "B", "destination": "C", "departureTime": "x"}),
            "details not strings": base(details={"flightNumber": 12, "origin": "B", "destination": "C", "departureTime": "x"}),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                with self.assertRaises(ValidationError):
                    v.validate_reservation_create(body)

    def test_hotel_checkout_before_checkin(self):
        body = {"type": "HOTEL", "provider": "H", "price": 1, "currency": "COP",
                "details": {"hotelName": "H", "checkIn": "2026-12-07", "checkOut": "2026-12-04"}}
        with self.assertRaises(ValidationError):
            v.validate_reservation_create(body)

    def test_update_rules(self):
        existing = {"type": "FLIGHT"}
        self.assertEqual(v.validate_reservation_update({"status": "PENDIENTE"}, existing), {"status": "PENDIENTE"})
        self.assertEqual(v.validate_reservation_update({"type": "FLIGHT", "price": 10}, existing), {"price": Decimal("10")})
        with self.assertRaises(ValidationError):
            v.validate_reservation_update({"type": "HOTEL"}, existing)
        with self.assertRaises(ValidationError):
            v.validate_reservation_update({}, existing)
        with self.assertRaises(ValidationError):
            v.validate_reservation_update({"details": {"hotelName": "x"}}, existing)  # se valida contra el type guardado


class PreferencesTests(unittest.TestCase):
    def test_valid(self):
        body = {"preferredDepartureWindow": "MORNING", "budgetStyle": "BALANCED", "interests": ["playa", " café "], "dietary": "vegetariano"}
        out = v.validate_preferences(body)
        self.assertEqual(out["interests"], ["playa", "café"])

    def test_invalid(self):
        for body in ({"preferredDepartureWindow": "DAWN"}, {"budgetStyle": "cheap"}, {"interests": ["x"] * 11},
                     {"interests": ["y" * 41]}, {"dietary": "z" * 101}, {"other": 1}, []):
            with self.subTest(body=body):
                with self.assertRaises(ValidationError):
                    v.validate_preferences(body)

    def test_empty_body_is_a_valid_reset(self):
        self.assertEqual(v.validate_preferences({}), {})


class FilterTests(unittest.TestCase):
    def test_filters(self):
        self.assertEqual(v.validate_trip_status_filter("PLANNED"), "PLANNED")
        with self.assertRaises(ValidationError):
            v.validate_trip_status_filter("x")
        self.assertEqual(v.validate_trip_id_filter("TRP-0123abcd"), "TRP-0123abcd")
        with self.assertRaises(ValidationError):
            v.validate_trip_id_filter("TRP-XYZ")


if __name__ == "__main__":
    unittest.main()
