import json
import unittest

import support
from support import USER_A, USER_B, agent_event, api_event, body_of, trip_body


class TripsApiTests(support.BaseCase):
    def stored_trip_items(self):
        return [k for k in self.store.items if k[1].startswith("TRIP#")]

    def test_create_get_list(self):
        resp = self.trips(api_event("POST /trips", body=trip_body(notes="Aniversario")))
        self.assertEqual(resp["statusCode"], 201)
        trip = body_of(resp)["trip"]
        self.assertRegex(trip["tripId"], r"^TRP-[0-9a-f]{8}$")
        self.assertEqual(trip["status"], "PLANNED")
        self.assertEqual(trip["createdBy"], "user")
        self.assertEqual(trip["createdAt"], "2026-11-22T15:00:00Z")
        self.assertEqual(resp["headers"]["Location"], f"/trips/{trip['tripId']}")
        self.assertNotIn("PK", trip)
        self.assertNotIn("entityType", trip)

        detail = body_of(self.trips(api_event("GET /trips/{tripId}", path_params={"tripId": trip["tripId"]})))
        self.assertEqual(detail["trip"]["title"], "Fin de semana en Cartagena")
        self.assertIsNone(detail["itinerary"])
        self.assertEqual(detail["reservations"], [])

        listing = body_of(self.trips(api_event("GET /trips")))
        self.assertEqual([t["tripId"] for t in listing["trips"]], [trip["tripId"]])

    def test_list_is_sorted_by_start_date_and_can_filter_by_status(self):
        late = self.create_trip(startDate="2026-12-20", endDate="2026-12-22")
        early = self.create_trip(startDate="2026-12-01", endDate="2026-12-02")
        self.trips(api_event("PUT /trips/{tripId}", path_params={"tripId": late}, body={"status": "CANCELLED"}))
        trips = body_of(self.trips(api_event("GET /trips")))["trips"]
        self.assertEqual([t["tripId"] for t in trips], [early, late])
        planned = body_of(self.trips(api_event("GET /trips", query={"status": "PLANNED"})))["trips"]
        self.assertEqual([t["tripId"] for t in planned], [early])
        self.assertEqual(self.trips(api_event("GET /trips", query={"status": "x"}))["statusCode"], 400)

    def test_users_are_isolated(self):
        trip_id = self.create_trip(sub=USER_A)
        other = self.trips(api_event("GET /trips/{tripId}", path_params={"tripId": trip_id}, sub=USER_B))
        self.assertEqual(other["statusCode"], 404)
        self.assertEqual(body_of(self.trips(api_event("GET /trips", sub=USER_B)))["trips"], [])
        for method in ("PUT", "DELETE"):
            resp = self.trips(api_event(f"{method} /trips/{{tripId}}", path_params={"tripId": trip_id}, body={"title": "x"}, sub=USER_B))
            self.assertEqual(resp["statusCode"], 404)
        self.assertEqual(self.trips(api_event("GET /trips/{tripId}", path_params={"tripId": trip_id}, sub=USER_A))["statusCode"], 200)

    def test_validation_errors_use_the_documented_format(self):
        resp = self.trips(api_event("POST /trips", body=trip_body(startDate="2026-01-01", endDate="2026-01-02")))
        self.assertEqual(resp["statusCode"], 400)
        error = body_of(resp)["error"]
        self.assertEqual(error["code"], "VALIDATION_ERROR")
        self.assertIn("startDate", [d["field"] for d in error["details"]])
        self.assertEqual(resp["headers"]["Content-Type"], "application/json")

    def test_card_fields_and_unknown_fields_are_400(self):
        for extra in ({"cardNumber": "4111111111111111"}, {"cvv": "123"}, {"foo": "bar"}):
            resp = self.trips(api_event("POST /trips", body=trip_body(**extra)))
            self.assertEqual(resp["statusCode"], 400, extra)
        self.assertEqual(self.stored_trip_items(), [])

    def test_missing_body_and_invalid_json(self):
        self.assertEqual(self.trips(api_event("POST /trips"))["statusCode"], 400)
        self.assertEqual(self.trips(api_event("POST /trips", raw_body="{oops"))["statusCode"], 400)

    def test_user_id_in_the_body_is_never_used(self):
        resp = self.trips(api_event("POST /trips", body=trip_body(userId=USER_B)))
        self.assertEqual(resp["statusCode"], 400)  # campo desconocido
        self.assertEqual(self.stored_trip_items(), [])

    def test_unauthenticated_event_is_401(self):
        resp = self.trips(api_event("GET /trips", sub=None))
        self.assertEqual(resp["statusCode"], 401)
        self.assertEqual(body_of(resp)["error"]["code"], "UNAUTHORIZED")

    def test_update_changes_fields_and_updated_at(self):
        trip_id = self.create_trip()
        resp = self.trips(api_event("PUT /trips/{tripId}", path_params={"tripId": trip_id},
                                    body={"title": "Nuevo título", "travelers": 4, "notes": "Hola"}))
        trip = body_of(resp)["trip"]
        self.assertEqual((trip["title"], trip["travelers"], trip["notes"]), ("Nuevo título", 4, "Hola"))
        cleared = body_of(self.trips(api_event("PUT /trips/{tripId}", path_params={"tripId": trip_id}, body={"notes": None})))["trip"]
        self.assertNotIn("notes", cleared)
        self.assertEqual(self.trips(api_event("PUT /trips/{tripId}", path_params={"tripId": trip_id}, body={}))["statusCode"], 400)

    def test_unknown_and_malformed_ids_are_404(self):
        for trip_id in ("TRP-00000000", "no-es-un-id", "TRP-1234"):
            resp = self.trips(api_event("GET /trips/{tripId}", path_params={"tripId": trip_id}))
            self.assertEqual(resp["statusCode"], 404, trip_id)

    def test_unknown_route_is_404(self):
        self.assertEqual(self.trips(api_event("PATCH /trips"))["statusCode"], 404)

    def test_limit_of_100_trips(self):
        for i in range(100):
            self.store.put_item({"PK": f"USER#{USER_A}", "SK": f"TRIP#TRP-{i:08x}", "entityType": "TRIP", "tripId": f"TRP-{i:08x}"})
        resp = self.trips(api_event("POST /trips", body=trip_body()))
        self.assertEqual(resp["statusCode"], 409)
        self.assertEqual(body_of(resp)["error"]["code"], "LIMIT_REACHED")
        self.assertEqual(self.trips(api_event("POST /trips", body=trip_body(), sub=USER_B))["statusCode"], 201)

    def test_delete_cascades_in_a_single_transaction(self):
        trip_id = self.create_trip()
        other = self.create_trip(title="Otro viaje")
        self.itineraries(api_event("POST /trips/{tripId}/itinerary", path_params={"tripId": trip_id},
                                   body={"days": [{"date": "2026-12-04", "items": []}]}))
        for _ in range(2):
            self.reservations(api_event("POST /trips/{tripId}/reservations", path_params={"tripId": trip_id}, body=support.flight_reservation()))
        self.reservations(api_event("POST /trips/{tripId}/reservations", path_params={"tripId": other}, body=support.flight_reservation()))

        resp = self.trips(api_event("DELETE /trips/{tripId}", path_params={"tripId": trip_id}))
        self.assertEqual(resp["statusCode"], 204)
        self.assertEqual(resp["body"], "")
        self.assertEqual(len(self.store.transactions), 1)
        self.assertEqual(len(self.store.transactions[0]), 4)  # viaje + itinerario + 2 reservas
        remaining = {sk for (_, sk) in self.store.items if sk.startswith("TRIP#")}
        self.assertTrue(all(sk.startswith(f"TRIP#{other}") for sk in remaining))
        self.assertEqual(self.trips(api_event("DELETE /trips/{tripId}", path_params={"tripId": trip_id}))["statusCode"], 404)

    def test_profile_is_created_once_on_first_access_without_failing_the_request(self):
        self.trips(api_event("GET /trips", claims={"email": "ana@example.com", "name": "Ana"}))
        profile = self.store.items[(f"USER#{USER_A}", "PROFILE")]
        self.assertEqual((profile["email"], profile["name"], profile["entityType"]), ("ana@example.com", "Ana", "PROFILE"))
        created = profile["createdAt"]
        self.trips(api_event("GET /trips"))
        self.assertEqual(self.store.items[(f"USER#{USER_A}", "PROFILE")]["createdAt"], created)

    def test_access_token_without_email_still_creates_a_profile(self):
        self.trips(api_event("GET /trips"))
        self.assertNotIn("email", self.store.items[(f"USER#{USER_A}", "PROFILE")])


class TripsAgentTests(support.BaseCase):
    def test_create_and_get_trips_via_agent(self):
        resp = self.trips(agent_event("create_trip", trip_body()))
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["statusCode"], 201)
        trip = resp["data"]["trip"]
        self.assertEqual(trip["createdBy"], "assistant")
        self.assertNotIn("headers", resp)
        json.dumps(resp)  # serializable sin Decimal
        listed = self.trips(agent_event("get_trips", {}))
        self.assertEqual([t["tripId"] for t in listed["data"]["trips"]], [trip["tripId"]])
        one = self.trips(agent_event("get_trip", {"tripId": trip["tripId"]}))
        self.assertEqual(one["data"]["trip"]["tripId"], trip["tripId"])

    def test_agent_user_id_scopes_the_data(self):
        self.trips(agent_event("create_trip", trip_body(), user_id=USER_A))
        self.assertEqual(self.trips(agent_event("get_trips", {}, user_id=USER_B))["data"]["trips"], [])

    def test_agent_errors_have_the_agent_format(self):
        resp = self.trips(agent_event("create_trip", trip_body(travelers=0)))
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["statusCode"], 400)
        self.assertEqual(resp["error"]["code"], "VALIDATION_ERROR")
        missing = self.trips(agent_event("get_trip", {"tripId": "TRP-00000000"}))
        self.assertEqual((missing["ok"], missing["statusCode"], missing["error"]["code"]), (False, 404, "NOT_FOUND"))
        no_id = self.trips(agent_event("get_trip", {}))
        self.assertEqual(no_id["statusCode"], 400)

    def test_unauthenticated_agent_event(self):
        resp = self.trips(agent_event("get_trips", {}, user_id=None))
        self.assertEqual((resp["ok"], resp["statusCode"], resp["error"]["code"]), (False, 401, "UNAUTHORIZED"))

    def test_unknown_action_and_legacy_names(self):
        self.assertEqual(self.trips(agent_event("fly_to_moon", {}))["statusCode"], 400)
        self.assertEqual(self.trips(agent_event("create_itinerary", {}))["statusCode"], 400)  # es de otra función
        self.assertTrue(self.trips(agent_event("createTrip", trip_body()))["ok"])  # alias de docs/04
        self.assertTrue(self.trips(agent_event("listTrips", {}))["ok"])

    def test_update_via_agent_ignores_the_target_id_as_a_field(self):
        trip_id = self.trips(agent_event("create_trip", trip_body()))["data"]["trip"]["tripId"]
        resp = self.trips(agent_event("update_trip", {"tripId": trip_id, "status": "CANCELLED"}))
        self.assertEqual(resp["data"]["trip"]["status"], "CANCELLED")

    def test_delete_requires_confirmed_true(self):
        trip_id = self.trips(agent_event("create_trip", trip_body()))["data"]["trip"]["tripId"]
        for payload in ({"tripId": trip_id}, {"tripId": trip_id, "confirmed": False}, {"tripId": trip_id, "confirmed": "true"}):
            resp = self.trips(agent_event("delete_trip", payload))
            self.assertEqual(resp["statusCode"], 400, payload)
        self.assertTrue(any(k[1] == f"TRIP#{trip_id}" for k in self.store.items))
        done = self.trips(agent_event("delete_trip", {"tripId": trip_id, "confirmed": True}))
        self.assertEqual((done["ok"], done["data"]["deleted"], done["data"]["deletedItems"]), (True, True, 1))
        self.assertFalse(any(k[1] == f"TRIP#{trip_id}" for k in self.store.items))


if __name__ == "__main__":
    unittest.main()
