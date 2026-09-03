import json
import re
from typing import Any, Dict, Optional
from pydantic import BaseModel

import ollama
from sqlmodel import Session
from app.models import AgentLog


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences like ```json ... ``` from LLM output."""
    text = text.strip()
    match = re.match(r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text


class AgentResult(BaseModel):
    agent_name: str
    output: Dict[str, Any]

    raw_reasoning: str = ""

class Agent:
    name="base"

    def __init__(self, llm, session: Optional[Session] = None):
        self.llm=llm
        self.session=session

    def _reason(self,system_prompt:str,user_prompt:str,fallback:dict)-> dict:
        try:
            answer=ollama.chat(
                model=self.llm,
                messages=[{"role":"system","content":system_prompt},{"role":"user","content": user_prompt}]
            )
            raw_text=answer["message"]["content"]
            clean_text = _strip_code_fences(raw_text)
            try:
                parsed=json.loads(clean_text)
            except json.JSONDecodeError:
                parsed={**fallback, "reasoning": f"Could not parse model output: {raw_text[:100]}"}
        except Exception as e:
            parsed={**fallback, "reasoning": f"Ollama unavailable: {e}"}

        return parsed

    def _log_decision(self, decision: dict, cluster_size: int) -> None:
        if self.session is None:
            return
        log = AgentLog(
            agent_name=self.name,
            cluster_size=cluster_size,
            decision=json.dumps(decision),
            recommended_action=decision.get("recommended_action"),
        )
        self.session.add(log)
        self.session.commit()
