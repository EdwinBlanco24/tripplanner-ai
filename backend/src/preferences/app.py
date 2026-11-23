"""PreferencesFunction: preferencias editables del usuario (GET/PUT /preferences)."""

from __future__ import annotations

from common import clock, repository as repo, validation as v
from common.runtime import Result, handle


def get_preferences(req, store) -> Result:
    item = store.get_item(repo.user_pk(req.user_id), repo.SK_PREFS, consistent=True)
    return Result(200, {"preferences": repo.public(item)})


def update_preferences(req, store) -> Result:
    fields = v.validate_preferences(req.fields())
    item = {
        "PK": repo.user_pk(req.user_id), "SK": repo.SK_PREFS, "entityType": "PREFS",
        **fields, "updatedAt": clock.now_iso(),
    }
    store.put_item(item)  # reemplazo completo
    return Result(200, {"preferences": repo.public(item)})


ROUTES = {
    "GET /preferences": get_preferences,
    "PUT /preferences": update_preferences,
}

ACTIONS = {
    "get_preferences": get_preferences,
    "update_preferences": update_preferences,
}


def lambda_handler(event, context):
    return handle(event, context, routes=ROUTES, actions=ACTIONS)
