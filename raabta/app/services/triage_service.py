import ollama
import json
import re


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text


TRIAGE_MODEL="qwen2.5:1.5b"

TRIAGE_SYSTEM_PROMPT='You are a strict disaster triage classifier. Respond in English only. Given an emergency report, reply only in JSON in the following format: '
'{"severity":"high|medium|critical","category":"medical|trapped|flood|fire|other","reasoning":"one short sentence"}'

def triage_report(emergency_text:str):
    try:
        response=ollama.chat(
            model=TRIAGE_MODEL,
            messages=[{"role":"system","content":TRIAGE_SYSTEM_PROMPT},
                    {"role":"user","content": emergency_text}]
        )

        raw_text=response["message"]["content"]
        clean_text = _strip_code_fences(raw_text)
        try:
            parsed=json.loads(clean_text)
        except json.JSONDecodeError:
            parsed={
                "severity":"unknown",
                "category":"unknown",
                "reasoning":f"Couldnt parse information {raw_text}"
            }
    except Exception as e:
        parsed={
            "severity":"unknown",
            "category":"unknown",
            "reasoning":f"Ollama unavailable: {e}"
        }
    return parsed
if __name__ == "__main__":
    result = triage_report("Building collapsed, I can hear someone under the rubble, no visible injuries reported yet.")
    print(result)
