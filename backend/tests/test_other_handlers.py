import json
import unittest

import support
from support import USER_A, USER_B, agent_event, api_event, body_of, flight_reservation

DAYS = {"days": [
    {"date": "2026-12-04", "weather": {"tempMax": 31, "tempMin": 24, "condition": "Soleado", "rainProbability": 10},
     "items": [{"time": "07:15", "title": "Vuelo BOG-CTG", "type": "flight", "location": "El Dorado"}]},
    {"date": "2026-12-05", "items": [{"time": "09:00", "title": "Ciudad amurallada", "type": "activity"}]},
]}


class ItineraryTests(support.BaseCase):
    def path(self, trip_id):
        return {"tripId": trip_id}

    def test_create_get_replace(self):
        trip_id = self.create_trip()
        created = self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=DAYS))
        self.assertEqual(created["statusCode"], 201)
        self.assertEqual(len(body_of(created)["itinerary"]["days"]), 2)
        got = body_of(self.itineraries(api_event("GET /trips/{tripId}/itinerary", path_params=self.path(trip_id))))
        self.assertEqual(got["itinerary"]["tripId"], trip_id)
        replaced = self.itineraries(api_event("PUT /trips/{tripId}/itinerary", path_params=self.path(trip_id),
                                              body={"days": [{"date": "2026-12-06", "items": []}]}))
        self.assertEqual(replaced["statusCode"], 200)
        self.assertEqual(len(body_of(replaced)["itinerary"]["days"]), 1)
        detail = body_of(self.trips(api_event("GET /trips/{tripId}", path_params=self.path(trip_id))))
        self.assertEqual(detail["itinerary"]["days"][0]["date"], "2026-12-06")

    def test_post_twice_is_409_and_put_without_itinerary_is_404(self):
        trip_id = self.create_trip()
        put = self.itineraries(api_event("PUT /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=DAYS))
        self.assertEqual(put["statusCode"], 404)
        self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=DAYS))
        again = self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=DAYS))
        self.assertEqual((again["statusCode"], body_of(again)["error"]["code"]), (409, "CONFLICT"))

    def test_unknown_trip_is_404_for_every_verb(self):
        for method in ("GET", "POST", "PUT"):
            resp = self.itineraries(api_event(f"{method} /trips/{{tripId}}/itinerary", path_params=self.path("TRP-00000000"), body=DAYS))
            self.assertEqual(resp["statusCode"], 404, method)

    def test_get_without_itinerary_is_404_and_other_user_cannot_read(self):
        trip_id = self.create_trip()
        self.assertEqual(self.itineraries(api_event("GET /trips/{tripId}/itinerary", path_params=self.path(trip_id)))["statusCode"], 404)
        self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=DAYS))
        self.assertEqual(self.itineraries(api_event("GET /trips/{tripId}/itinerary", path_params=self.path(trip_id), sub=USER_B))["statusCode"], 404)

    def test_validation(self):
        trip_id = self.create_trip()
        bad = {"days": [{"date": "2027-01-01", "items": []}]}
        resp = self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params=self.path(trip_id), body=bad))
        self.assertEqual(resp["statusCode"], 400)

    def test_agent_actions(self):
        trip_id = self.create_trip()
        created = self.itineraries(agent_event("create_itinerary", {"tripId": trip_id, **DAYS}))
        self.assertEqual((created["ok"], created["statusCode"]), (True, 201))
        updated = self.itineraries(agent_event("update_itinerary", {"tripId": trip_id, "days": [{"date": "2026-12-04", "items": []}]}))
        self.assertTrue(updated["ok"])
        got = self.itineraries(agent_event("get_itinerary", {"tripId": trip_id}))
        self.assertEqual(len(got["data"]["itinerary"]["days"]), 1)
        json.dumps(got)


class ReservationTests(support.BaseCase):
    def setUp(self):
        super().setUp()
        self.trip_id = self.create_trip()
        self.path = {"tripId": self.trip_id}

    def create(self, **overrides):
        resp = self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=flight_reservation(**overrides)))
        self.assertEqual(resp["statusCode"], 201, resp["body"])
        return body_of(resp)["reservation"]

    def test_create_defaults_and_location(self):
        resp = self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=flight_reservation()))
        res = body_of(resp)["reservation"]
        self.assertEqual((res["status"], res["createdBy"], res["tripId"]), ("SIMULADA", "user", self.trip_id))
        self.assertRegex(res["resId"], r"^RES-[0-9a-f]{8}$")
        self.assertEqual(resp["headers"]["Location"], f"/trips/{self.trip_id}/reservations/{res['resId']}")

    def test_unknown_trip_is_404(self):
        resp = self.reservations(api_event("POST /trips/{tripId}/reservations", path_params={"tripId": "TRP-00000000"}, body=flight_reservation()))
        self.assertEqual((resp["statusCode"], body_of(resp)["error"]["code"]), (404, "NOT_FOUND"))
        self.assertEqual(self.store.count_prefix(f"USER#{USER_A}", "TRIP#", entity_type="RESERVATION"), 0)

    def test_http_api_accepts_a_1500_character_booking_url_and_rejects_bad_ones(self):
        def post(url):
            body = flight_reservation()
            body["details"]["bookingUrl"] = url
            return self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=body))

        long_url = "https://www.kiwi.com/booking?token=" + "x" * 1465
        self.assertEqual(len(long_url), 1500)
        ok = post(long_url)
        self.assertEqual(ok["statusCode"], 201)
        self.assertEqual(body_of(ok)["reservation"]["details"]["bookingUrl"], long_url)
        for bad in ("https://www.kiwi.com/" + "x" * 2040, "http://www.kiwi.com/x", "javascript:alert(1)"):
            resp = post(bad)
            self.assertEqual((resp["statusCode"], body_of(resp)["error"]["code"]), (400, "VALIDATION_ERROR"), bad[:30])
        self.assertEqual(self.store.count_prefix(f"USER#{USER_A}", "TRIP#", entity_type="RESERVATION"), 1)

    def test_card_data_is_rejected_and_nothing_is_stored(self):
        for extra in ({"cardNumber": "4111111111111111"}, {"cvv": "123"}):
            resp = self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=flight_reservation(**extra)))
            self.assertEqual(resp["statusCode"], 400)
        body = flight_reservation()
        body["details"]["card_number"] = "4111"
        self.assertEqual(self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=body))["statusCode"], 400)
        self.assertEqual(self.store.count_prefix(f"USER#{USER_A}", "TRIP#", entity_type="RESERVATION"), 0)

    def test_list_filters_by_trip_and_validates_the_filter(self):
        other = self.create_trip(title="Otro")
        mine = self.create()
        self.reservations(api_event("POST /trips/{tripId}/reservations", path_params={"tripId": other}, body=flight_reservation()))
        everything = body_of(self.reservations(api_event("GET /reservations")))["reservations"]
        self.assertEqual(len(everything), 2)
        only = body_of(self.reservations(api_event("GET /reservations", query={"tripId": self.trip_id})))["reservations"]
        self.assertEqual([r["resId"] for r in only], [mine["resId"]])
        self.assertEqual(self.reservations(api_event("GET /reservations", query={"tripId": "mal"}))["statusCode"], 400)
        self.assertEqual(body_of(self.reservations(api_event("GET /reservations", sub=USER_B)))["reservations"], [])

    def test_get_update_delete(self):
        res = self.create()
        path = {"tripId": self.trip_id, "resId": res["resId"]}
        got = self.reservations(api_event("GET /trips/{tripId}/reservations/{resId}", path_params=path))
        self.assertEqual(body_of(got)["reservation"]["provider"], "Avianca")
        upd = self.reservations(api_event("PUT /trips/{tripId}/reservations/{resId}", path_params=path, body={"status": "PENDIENTE"}))
        self.assertEqual(body_of(upd)["reservation"]["status"], "PENDIENTE")
        wrong_type = self.reservations(api_event("PUT /trips/{tripId}/reservations/{resId}", path_params=path, body={"type": "HOTEL"}))
        self.assertEqual(wrong_type["statusCode"], 400)
        bad_status = self.reservations(api_event("PUT /trips/{tripId}/reservations/{resId}", path_params=path, body={"status": "PAGADA"}))
        self.assertEqual(bad_status["statusCode"], 400)
        deleted = self.reservations(api_event("DELETE /trips/{tripId}/reservations/{resId}", path_params=path))
        self.assertEqual(deleted["statusCode"], 204)
        self.assertEqual(self.reservations(api_event("GET /trips/{tripId}/reservations/{resId}", path_params=path))["statusCode"], 404)

    def test_other_users_cannot_touch_the_reservation(self):
        res = self.create()
        path = {"tripId": self.trip_id, "resId": res["resId"]}
        for method, body in (("GET", None), ("PUT", {"status": "CONFIRMADA"}), ("DELETE", None)):
            resp = self.reservations(api_event(f"{method} /trips/{{tripId}}/reservations/{{resId}}", path_params=path, body=body, sub=USER_B))
            self.assertEqual(resp["statusCode"], 404, method)

    def test_limit_of_50_reservations_per_trip(self):
        for i in range(50):
            res_id = f"RES-{i:08x}"
            self.store.put_item({"PK": f"USER#{USER_A}", "SK": f"TRIP#{self.trip_id}#RES#{res_id}", "entityType": "RESERVATION", "resId": res_id})
        resp = self.reservations(api_event("POST /trips/{tripId}/reservations", path_params=self.path, body=flight_reservation()))
        self.assertEqual((resp["statusCode"], body_of(resp)["error"]["code"]), (409, "LIMIT_REACHED"))

    def test_agent_actions_and_confirmation(self):
        created = self.reservations(agent_event("create_reservation", {"tripId": self.trip_id, **flight_reservation()}))
        self.assertEqual((created["ok"], created["data"]["reservation"]["createdBy"]), (True, "assistant"))
        res_id = created["data"]["reservation"]["resId"]
        target = {"tripId": self.trip_id, "resId": res_id}
        listed = self.reservations(agent_event("get_reservations", {"tripId": self.trip_id}))
        self.assertEqual(len(listed["data"]["reservations"]), 1)
        self.assertTrue(self.reservations(agent_event("get_reservation", target))["ok"])
        upd = self.reservations(agent_event("update_reservation", {**target, "status": "CONFIRMADA", "price": 300000.5}))
        self.assertEqual(upd["data"]["reservation"]["status"], "CONFIRMADA")
        json.dumps(upd)
        self.assertEqual(self.reservations(agent_event("delete_reservation", target))["statusCode"], 400)
        self.assertEqual(self.reservations(agent_event("delete_reservation", {**target, "confirmed": False}))["statusCode"], 400)
        done = self.reservations(agent_event("delete_reservation", {**target, "confirmed": True}))
        self.assertEqual((done["ok"], done["data"]["deleted"]), (True, True))
        self.assertEqual(self.reservations(agent_event("get_reservation", target))["statusCode"], 404)


class PreferencesTests(support.BaseCase):
    def test_get_defaults_to_null_then_put_and_get(self):
        self.assertEqual(body_of(self.preferences(api_event("GET /preferences"))), {"preferences": None})
        body = {"preferredDepartureWindow": "MORNING", "budgetStyle": "BALANCED", "interests": ["playa"], "dietary": "vegano"}
        put = self.preferences(api_event("PUT /preferences", body=body))
        self.assertEqual(put["statusCode"], 200)
        prefs = body_of(self.preferences(api_event("GET /preferences")))["preferences"]
        self.assertEqual(prefs["interests"], ["playa"])
        self.assertEqual(prefs["updatedAt"], "2026-11-22T15:00:00Z")
        self.assertNotIn("PK", prefs)

    def test_put_replaces_everything(self):
        self.preferences(api_event("PUT /preferences", body={"dietary": "vegano", "budgetStyle": "PREMIUM"}))
        self.preferences(api_event("PUT /preferences", body={"budgetStyle": "ECONOMY"}))
        prefs = body_of(self.preferences(api_event("GET /preferences")))["preferences"]
        self.assertEqual(prefs["budgetStyle"], "ECONOMY")
        self.assertNotIn("dietary", prefs)

    def test_validation_isolation_and_agent(self):
        self.assertEqual(self.preferences(api_event("PUT /preferences", body={"budgetStyle": "x"}))["statusCode"], 400)
        self.preferences(api_event("PUT /preferences", body={"dietary": "vegano"}))
        self.assertEqual(body_of(self.preferences(api_event("GET /preferences", sub=USER_B)))["preferences"], None)
        agent = self.preferences(agent_event("update_preferences", {"dietary": "sin gluten"}, user_id=USER_B))
        self.assertTrue(agent["ok"])
        self.assertEqual(self.preferences(agent_event("get_preferences", {}, user_id=USER_B))["data"]["preferences"]["dietary"], "sin gluten")


if __name__ == "__main__":
    unittest.main()
