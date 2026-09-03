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


def _has_non_ascii(text: str) -> bool:
    """Check if text contains non-ASCII characters (e.g. Chinese)."""
    try:
        text.encode('ascii')
        return False
    except UnicodeEncodeError:
        return True


def _sanitize_dict_strings(d: dict) -> dict:
    """Replace non-ASCII string values with a placeholder."""
    result = {}
    for k, v in d.items():
        if isinstance(v, str) and _has_non_ascii(v):
            result[k] = "Response processed (translation unavailable)"
        elif isinstance(v, dict):
            result[k] = _sanitize_dict_strings(v)
        elif isinstance(v, list):
            result[k] = [_sanitize_dict_strings(i) if isinstance(i, dict) else i for i in v]
        else:
            result[k] = v
    return result


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
            
            # Retry with stronger prompt if non-ASCII detected
            if _has_non_ascii(clean_text):
                answer = ollama.chat(
                    model=self.llm,
                    messages=[
                        {"role": "system", "content": system_prompt + "\n\nCRITICAL: Your previous response was not in English. You MUST respond in English only."},
                        {"role": "user", "content": user_prompt}
                    ]
                )
                raw_text = answer["message"]["content"]
                clean_text = _strip_code_fences(raw_text)
            
            try:
                parsed=json.loads(clean_text)
                # Sanitize any remaining non-ASCII strings
                parsed = _sanitize_dict_strings(parsed)
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
