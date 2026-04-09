from __future__ import annotations
from dataclasses import dataclass

@dataclass
class BKTParams:
    p_init: float = 0.2
    p_learn: float = 0.1
    p_guess: float = 0.2
    p_slip: float = 0.1

def update_bkt(p_mastery: float, correct: bool, params: BKTParams) -> float:
    pL = max(0.0, min(1.0, float(p_mastery)))
    if correct:
        num = pL * (1 - params.p_slip)
        den = num + (1 - pL) * params.p_guess
    else:
        num = pL * params.p_slip
        den = num + (1 - pL) * (1 - params.p_guess)

    if den <= 1e-12:
        pL_given = pL
    else:
        pL_given = num / den

    p_next = pL_given + (1 - pL_given) * params.p_learn
    return max(0.0, min(1.0, p_next))
