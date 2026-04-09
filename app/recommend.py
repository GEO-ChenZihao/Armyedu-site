from __future__ import annotations
import math
from typing import Dict, List

def recommend_items(theta: float, mastery: Dict[str, float], candidates: List[dict], n: int = 1) -> List[dict]:
    scored = []
    for it in candidates:
        sid = it["skill_id"]
        p_m = float(mastery.get(sid, 0.2))
        weakness = 1 - p_m
        closeness = math.exp(-abs(float(it["b"]) - float(theta)))
        novelty = 1.0 if it.get("is_new", True) else 0.4
        score = 0.55 * weakness + 0.35 * closeness + 0.10 * novelty
        scored.append((score, it))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [it for _, it in scored[:n]]
