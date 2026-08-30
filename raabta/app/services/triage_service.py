import ollama
import json


TRIAGE_MODEL="qwen2.5:1.5b"

TRIAGE_SYSTEM_PROMPT='You are a strict diasaster triage classifier,''given an emergency report reply only in json in the following format''{"severity":"high|medium|critical","category":"medical|trapped|flood|fire|other","reasoning":"one short sentence"}'

def triage_report(emergency_text:str):
    try:
        response=ollama.chat(
            model=TRIAGE_MODEL,
            messages=[{"role":"system","content":TRIAGE_SYSTEM_PROMPT},
                    {"role":"user","content": emergency_text}]
        )

        raw_text=response["message"]["content"]
        try:
            parsed=json.loads(raw_text)
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
