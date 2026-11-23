"""Acceso a DynamoDB (tabla única). Las Lambdas solo conocen la interfaz `Store`.

`DynamoStore` usa el cliente de bajo nivel de boto3 (importado de forma perezosa para que
las pruebas unitarias corran sin red ni credenciales). Las pruebas usan un `MemoryStore`.
"""

from __future__ import annotations

import os

MAX_TRANSACTION_ITEMS = 100


class ItemAlreadyExists(Exception):
    """put_item con must_not_exist=True sobre una clave que ya existe."""


class ItemNotFound(Exception):
    """update/put/delete con must_exist=True sobre una clave inexistente."""


def _error_code(exc: Exception) -> str | None:
    return getattr(exc, "response", {}).get("Error", {}).get("Code")


class DynamoStore:
    def __init__(self, table_name: str, client=None):
        from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

        if client is None:
            import boto3

            client = boto3.client("dynamodb")
        self.table = table_name
        self.client = client
        self._ser = TypeSerializer()
        self._de = TypeDeserializer()

    # --- conversión -----------------------------------------------------------------
    def _to_db(self, item: dict) -> dict:
        return {k: self._ser.serialize(v) for k, v in item.items()}

    def _from_db(self, item: dict) -> dict:
        return {k: self._de.deserialize(v) for k, v in item.items()}

    @staticmethod
    def _key(pk: str, sk: str) -> dict:
        return {"PK": {"S": pk}, "SK": {"S": sk}}

    # --- lectura --------------------------------------------------------------------
    def get_item(self, pk: str, sk: str, consistent: bool = False) -> dict | None:
        resp = self.client.get_item(TableName=self.table, Key=self._key(pk, sk), ConsistentRead=consistent)
        item = resp.get("Item")
        return self._from_db(item) if item else None

    def _query_args(self, pk, prefix, entity_type, consistent):
        values = {":pk": {"S": pk}, ":p": {"S": prefix}}
        args = {
            "TableName": self.table,
            "KeyConditionExpression": "PK = :pk AND begins_with(SK, :p)",
            "ConsistentRead": consistent,
        }
        if entity_type:
            args["FilterExpression"] = "entityType = :et"
            values[":et"] = {"S": entity_type}
        args["ExpressionAttributeValues"] = values
        return args

    def query_prefix(self, pk, prefix, *, entity_type=None, keys_only=False, consistent=False) -> list[dict]:
        args = self._query_args(pk, prefix, entity_type, consistent)
        if keys_only:
            args["ProjectionExpression"] = "PK, SK"
        items: list[dict] = []
        while True:
            resp = self.client.query(**args)
            items.extend(self._from_db(i) for i in resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if not last:
                return items
            args["ExclusiveStartKey"] = last

    def count_prefix(self, pk, prefix, *, entity_type=None) -> int:
        args = self._query_args(pk, prefix, entity_type, False)
        args["Select"] = "COUNT"
        total = 0
        while True:
            resp = self.client.query(**args)
            total += resp.get("Count", 0)
            last = resp.get("LastEvaluatedKey")
            if not last:
                return total
            args["ExclusiveStartKey"] = last

    # --- escritura ------------------------------------------------------------------
    def put_item(self, item: dict, *, must_not_exist: bool = False, must_exist: bool = False) -> None:
        args = {"TableName": self.table, "Item": self._to_db(item)}
        if must_not_exist:
            args["ConditionExpression"] = "attribute_not_exists(PK)"
        elif must_exist:
            args["ConditionExpression"] = "attribute_exists(PK)"
        try:
            self.client.put_item(**args)
        except Exception as exc:
            if _error_code(exc) == "ConditionalCheckFailedException":
                raise (ItemAlreadyExists() if must_not_exist else ItemNotFound()) from None
            raise

    def update_item(self, pk: str, sk: str, updates: dict) -> dict:
        """SET de los valores y REMOVE de los None. Exige que el ítem exista. Devuelve el ítem nuevo."""
        names, values, sets, removes = {}, {}, [], []
        for i, (attr, value) in enumerate(updates.items()):
            names[f"#n{i}"] = attr
            if value is None:
                removes.append(f"#n{i}")
            else:
                sets.append(f"#n{i} = :v{i}")
                values[f":v{i}"] = self._ser.serialize(value)
        expression = "SET " + ", ".join(sets)
        if removes:
            expression += " REMOVE " + ", ".join(removes)
        try:
            resp = self.client.update_item(
                TableName=self.table,
                Key=self._key(pk, sk),
                UpdateExpression=expression,
                ConditionExpression="attribute_exists(PK)",
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        except Exception as exc:
            if _error_code(exc) == "ConditionalCheckFailedException":
                raise ItemNotFound() from None
            raise
        return self._from_db(resp["Attributes"])

    def delete_many(self, keys: list[tuple[str, str]]) -> None:
        """Borra varias claves en UNA transacción atómica (máx. 100 ítems)."""
        if not keys:
            return
        if len(keys) > MAX_TRANSACTION_ITEMS:
            raise RuntimeError("Demasiados ítems para una transacción")
        self.client.transact_write_items(
            TransactItems=[{"Delete": {"TableName": self.table, "Key": self._key(pk, sk)}} for pk, sk in keys]
        )


_store = None


def get_store():
    global _store
    if _store is None:
        _store = DynamoStore(os.environ["TABLE_NAME"])
    return _store


def set_store(store) -> None:
    """Solo para pruebas: inyecta un almacén en memoria."""
    global _store
    _store = store
