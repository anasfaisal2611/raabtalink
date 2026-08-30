"""Command Agent — ranks all clusters against each other and allocates
responders based on (mock) availability.

This is the top-level decision-maker: after the Clustering_Agent scores
individual clusters, the Command Agent compares them head-to-head and
decides which clusters get responders first.
"""

from typing import Optional
from sqlmodel import Session, select
from app.models import SOSReport
from app.services.agents.base import Agent, AgentResult


SYSTEM_PROMPT = (
    "You are the Command Agent for a disaster-response coordination centre. "
    "You will receive a list of active clusters, each already scored by a "
    "cluster-triage agent with a severity_score (0-100), estimated resources "
    "needed, total people affected, and recommended action.\n\n"
    "You will ALSO receive the current responder availability (how many "
    "ambulances, rescue teams, and fire trucks are currently free).\n\n"
    "Your job:\n"
    "1. Rank ALL clusters from highest to lowest priority.\n"
    "2. Allocate available responders to the top-ranked clusters. Do NOT "
    "   allocate more responders than are available.\n"
    "3. Clusters that cannot be staffed this round should be marked as "
    "   'queued'.\n\n"
    "Respond with ONLY valid JSON in exactly this format, no extra text:\n"
    "{\n"
    '  "rankings": [\n'
    "    {\n"
    '      "cluster_id": "<first sos_id in the cluster>",\n'
    '      "rank": 1,\n'
    '      "responders_allocated": "2 ambulances, 1 rescue team",\n'
    '      "status": "allocated" | "queued",\n'
    '      "reasoning": "one short sentence"\n'
    "    }\n"
    "  ],\n"
    '  "overall_reasoning": "one sentence summary of the allocation decision"\n'
    "}"
)


class CommandAgent(Agent):
    name = "command"

    def check_responder_availability(self) -> dict:
        """Mock responder availability — placeholder for a real tracking system."""
        return {
            "ambulances_available": 3,
            "rescue_teams_available": 2,
            "fire_trucks_available": 1,
            "total_available": 6,
        }

    def _build_cluster_summary(self, clusters: list[dict]) -> str:
        lines = []
        for c in clusters:
            ids = [r.sos_id for r in c["reports"]]
            lines.append(
                f"- Cluster (lead ID {ids[0]}): severity_score={c['severity_score']}, "
                f"people_count={c['total_people']}, "
                f"resources_needed={c['resources_needed']}, "
                f"recommended_action={c['recommended_action']}, "
                f"report_ids={ids}"
            )
        return "ACTIVE CLUSTERS:\n" + "\n".join(lines)

    def _act(self, decision: dict, clusters: list[dict]) -> None:
        if self.session is None:
            return

        rankings = decision.get("rankings", [])
        for entry in rankings:
            cluster_id = entry.get("cluster_id")
            rank = entry.get("rank")
            allocated = entry.get("responders_allocated")

            # Find the cluster whose lead ID matches
            for c in clusters:
                if c["reports"] and c["reports"][0].sos_id == cluster_id:
                    for report in c["reports"]:
                        report.command_rank = rank
                        report.responders_allocated = allocated
                        self.session.add(report)
                    break

        self._log_decision(decision, sum(len(c["reports"]) for c in clusters))
        self.session.commit()

    def run(self, clusters: list[dict]) -> AgentResult:
        availability = self.check_responder_availability()
        cluster_summary = self._build_cluster_summary(clusters)

        availability_text = (
            f"\n\nRESPONDER AVAILABILITY:\n"
            f"- Ambulances: {availability['ambulances_available']}\n"
            f"- Rescue teams: {availability['rescue_teams_available']}\n"
            f"- Fire trucks: {availability['fire_trucks_available']}\n"
            f"- Total: {availability['total_available']}"
        )

        user_message = cluster_summary + availability_text

        fallback = {
            "rankings": [
                {
                    "cluster_id": c["reports"][0].sos_id if c["reports"] else "unknown",
                    "rank": i + 1,
                    "responders_allocated": "unknown",
                    "status": "queued",
                    "reasoning": "Model output could not be parsed.",
                }
                for i, c in enumerate(clusters)
            ],
            "overall_reasoning": "Fallback — model unavailable.",
        }

        parsed = self._reason(SYSTEM_PROMPT, user_message, fallback)
        self._act(parsed, clusters)

        return AgentResult(
            agent_name=self.name,
            output=parsed,
            raw_reasoning=parsed.get("overall_reasoning", ""),
        )


def run_command_agent(session: Session) -> Optional[AgentResult]:
    """Gather all non-duplicate, non-monitoring clusters and run the
    Command Agent to rank and allocate responders."""
    from app.services.agents.agentic_service import Clustering_Agent

    # Get all active (non-duplicate) reports
    reports = session.exec(
        select(SOSReport).where(SOSReport.is_duplicate == False)
    ).all()

    if not reports:
        return None

    # Group reports into rough clusters by dispatch_status
    # (real clustering already happened — here we group by proximity of dispatch status)
    from app.services.clustering_service import find_nearby_reports

    processed_ids = set()
    clusters = []

    for report in reports:
        if report.sos_id in processed_ids:
            continue
        if report.latitude is None:
            continue

        nearby = find_nearby_reports(
            report.latitude, report.longitude, reports,
            exclude_id=report.sos_id
        )
        cluster_reports = [report] + [r for r in nearby if r.sos_id not in processed_ids]
        processed_ids.update(r.sos_id for r in cluster_reports)

        total_people = sum(r.people_count for r in cluster_reports)
        severity_scores = {"critical": 100, "high": 75, "medium": 50, "low": 25, "unknown": 10}
        max_score = max(severity_scores.get(str(r.severity), 10) for r in cluster_reports)

        # Use existing cluster agent scoring if available, else estimate
        clusters.append({
            "reports": cluster_reports,
            "severity_score": max_score,
            "total_people": total_people,
            "resources_needed": "unknown",
            "recommended_action": "dispatch_now" if max_score >= 75 else "monitor",
        })

    if not clusters:
        return None

    from app.services.clustering_service import CLUSTERING_MODEL
    agent = CommandAgent(CLUSTERING_MODEL, session)
    return agent.run(clusters)
