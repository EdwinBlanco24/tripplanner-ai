from datetime import datetime

from bedrock_agentcore.runtime import serve_a2a
from strands import Agent, tool
from strands.multiagent.a2a.executor import StrandsA2AExecutor


@tool
def get_forecast(
    city: str,
    date: str,
) -> dict:
    """Devuelve el pronóstico del clima de una ciudad para una fecha futura determinada."""

    requested_date = datetime.strptime(date, "%Y-%m-%d").date()
    today = datetime.now().date()

    if requested_date < today:
        raise ValueError(
            f"La fecha solicitada {requested_date} no puede ser anterior "
            f"a la fecha actual {today}."
        )

    return {
        "city": city,
        "date": requested_date.isoformat(),
        "temp_c": 31,
        "condition": "Soleado",
    }


def create_agent(context_id: str) -> Agent:
    return Agent(
        name="Weather Agent",
        description="Consulta el pronóstico del clima por ciudad y fecha futura.",
        tools=[get_forecast],
        callback_handler=None,
    )


executor = StrandsA2AExecutor(
    agent_factory=create_agent,
    enable_a2a_compliant_streaming=True,
)


if __name__ == "__main__":
    serve_a2a(executor)