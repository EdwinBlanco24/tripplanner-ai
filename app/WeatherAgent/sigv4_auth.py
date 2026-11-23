import httpx

from botocore.auth import SigV4Auth as BotocoreSigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import get_session


class SigV4Auth(httpx.Auth):
    requires_request_body = True

    def __init__(self, service: str, region: str):
        self.service = service
        self.region = region
        self.session = get_session()

    def auth_flow(self, request: httpx.Request):
        credentials = self.session.get_credentials()

        if credentials is None:
            raise RuntimeError("No se encontraron credenciales AWS.")

        credentials = credentials.get_frozen_credentials()

        headers = dict(request.headers)

        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers=headers,
        )

        BotocoreSigV4Auth(
            credentials,
            self.service,
            self.region,
        ).add_auth(aws_request)

        for key, value in aws_request.headers.items():
            request.headers[key] = value

        yield request
