from __future__ import annotations
import math
from typing import List, Tuple

def sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1 / (1 + z)
    z = math.exp(x)
    return z / (1 + z)

def p_2pl(theta: float, a: float, b: float) -> float:
    return sigmoid(a * (theta - b))

def estimate_theta_map(
    responses: List[Tuple[int, float, float]],  # (u, a, b)
    theta0: float = 0.0,
    max_iter: int = 25,
    tol: float = 1e-4,
    prior_mean: float = 0.0,
    prior_sd: float = 1.0,
) -> float:
    if not responses:
        return theta0
    theta = float(theta0)
    var = prior_sd ** 2

    for _ in range(max_iter):
        d1 = -(theta - prior_mean) / var
        d2 = -1 / var
        for u, a, b in responses:
            p = p_2pl(theta, a, b)
            d1 += a * (u - p)
            d2 += -(a*a) * p * (1 - p)

        if abs(d2) < 1e-9:
            break
        step = d1 / d2
        theta_new = theta - step
        if abs(theta_new - theta) < tol:
            theta = theta_new
            break
        theta = theta_new

    return max(-4.0, min(4.0, theta))
