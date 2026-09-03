
from app.models import SOSReport
from app.services.agents.base import Agent, AgentResult



SYSTEM_PROMPT = (
    "You are a Cluster Triage Agent for a disaster-response system. "
    "Respond in English only. "
    "You will be given a group of emergency reports that have already been "
    "confirmed to be from the same geographic area (a 'cluster'). Each report "
    "already has a severity (critical|high|medium|low|unknown), a category "
    "(medical|trapped|flood|fire|other), and a people_count. Do NOT re-judge "
    "individual reports or try to determine location — that has already been done. "
    "\n\n"
    "Your job is to reason about the CLUSTER AS A WHOLE and decide:\n"
    "1. severity_score: an integer 0-100 representing how urgent this cluster is "
    "overall. Weigh the worst-case severity present, the total number of people "
    "affected, and whether categories compound the danger (e.g. fire+trapped is "
    "worse than two isolated medical reports). Do not simply average or count reports.\n"
    "2. estimated_resources_needed: a short string estimate, e.g. "
    "'2 ambulances, 1 rescue team' — based on people_count and severity in the cluster.\n"
    "3. recommended_action: one of 'dispatch_now', 'monitor', or 'needs_more_info'.\n"
    "4. reasoning: one short sentence a human responder could read to understand "
    "your decision at a glance.\n"
    "\n"
    "Respond with ONLY valid JSON in exactly this format, no extra text:\n"
    '{"severity_score": <int 0-100>, "estimated_resources_needed": "<string>", '
    '"recommended_action": "dispatch_now|monitor|needs_more_info", "reasoning": "<string>"}'
)


class Clustering_Agent(Agent):
    name="cluster"
    def _build_summary(self, reports: list[SOSReport]) -> str:
        """Turns a list of reports into text the LLM can reason over."""
        lines = [
            f"- ID {r.sos_id}: severity={r.severity}, category={r.category}, "
            f"people_count={r.people_count}, text=\"{r.emergency_text}\""
            for r in reports
        ]
        return "CLUSTER REPORTS:\n" + "\n".join(lines)
    def _act(self, decision: dict, cluster_reports: list[SOSReport]) -> None:
        if self.session is None:
            return  # no DB session provided, skip persisting (e.g. during tests)

        status_map = {
            "dispatch_now": "escalated",
            "monitor": "monitoring",
            "needs_more_info": "needs_info",
        }
        new_status = status_map.get(decision["recommended_action"], "pending")

        for report in cluster_reports:
            report.dispatch_status = new_status
            self.session.add(report)
        self._log_decision(decision, len(cluster_reports))
        self.session.commit()
    

    def run(self,cluster_reports:list)-> AgentResult:
        user_message = self._build_summary(cluster_reports)

        fallback = {
            "severity_score": 0,
            "estimated_resources_needed": "unknown",
            "recommended_action": "needs_more_info",
            "reasoning": "Model output could not be parsed.",
        }

        parsed = self._reason(SYSTEM_PROMPT, user_message, fallback)

        self._act(parsed, cluster_reports)

        return AgentResult(
            agent_name=self.name,
            output=parsed,
            raw_reasoning=parsed.get("reasoning", ""),
        )