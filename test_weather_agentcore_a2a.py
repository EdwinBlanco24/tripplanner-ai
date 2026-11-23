import httpx

from a2a.client import ClientConfig
from strands.agent.a2a_agent import A2AAgent

from sigv4_auth import SigV4Auth


WEATHER_URL = (
    "https://bedrock-agentcore.us-east-2.amazonaws.com/"
    "runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-2%3A458934380591%3A"
    "runtime%2FTripPlannerA2A_WeatherAgent-CvtJPlH0zR/invocations/"
)


def main():
    auth = SigV4Auth(
        service="bedrock-agentcore",
        region="us-east-2",
    )

    client = httpx.AsyncClient(
        auth=auth,
        timeout=300,
    )

    config = ClientConfig(
        httpx_client=client,
    )

    remote = A2AAgent(
        endpoint=WEATHER_URL,
        client_config=config,
    )

    result = remote(
        "Consulta el clima de Cartagena para el 26 de septiembre de 2026."
    )

    print("=== RESPUESTA A2A WEATHER AGENTCORE ===")
    print(result.message)


if __name__ == "__main__":
    main()