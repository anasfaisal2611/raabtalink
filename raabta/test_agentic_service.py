"""Test script for the agentic service (Clustering_Agent).

Runs the agent with fake in-memory reports (no DB session needed)
and verifies each stage: import -> reasoning (Ollama) -> result.
"""
import traceback

from app.models import SOSReport, Severity, EmergencyCategory


def make_report(text, severity, category, people_count):
    return SOSReport(
        sender_id="test-sender",
        emergency_text=text,
        latitude=19.0,
        longitude=72.0,
        people_count=people_count,
        category=category,
        severity=severity,
    )


def main():
    # Stage 1: import the agentic service
    print("[1/3] Importing Clustering_Agent ...")
    from app.services.agents.agentic_service import Clustering_Agent
    print("      OK")

    # Stage 2: build a fake cluster (no DB) and run the agent
    print("[2/3] Running agent on a fake 3-report cluster ...")
    cluster = [
        make_report("Building collapsed, people trapped under rubble", Severity.critical, EmergencyCategory.trapped, 5),
        make_report("Same building collapsed, my brother is stuck inside", Severity.critical, EmergencyCategory.trapped, 1),
        make_report("Injured woman bleeding near the collapsed building", Severity.high, EmergencyCategory.medical, 2),
    ]

    agent = Clustering_Agent(llm="qwen2.5:1.5b", session=None)
    result = agent.run(cluster)
    print("      OK")

    # Stage 3: inspect the result
    print("[3/3] Agent result:")
    print(f"      agent_name   : {result.agent_name}")
    print(f"      output       : {result.output}")
    print(f"      raw_reasoning: {result.raw_reasoning}")

    assert result.agent_name == "cluster"
    assert isinstance(result.output, dict)
    for key in ("severity_score", "estimated_resources_needed", "recommended_action"):
        assert key in result.output, f"missing key in output: {key}"

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\nTEST FAILED")
        traceback.print_exc()
