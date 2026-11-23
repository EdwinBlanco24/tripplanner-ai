from strands.agent.a2a_agent import A2AAgent


def main():
    remote = A2AAgent(
        endpoint="http://localhost:9000/"
    )

    result = remote(
        "Consulta el clima de Cartagena para el 26 de septiembre de 2026."
    )

    print("=== RESPUESTA A2A WEATHER ===")
    print(result.message)


if __name__ == "__main__":
    main()