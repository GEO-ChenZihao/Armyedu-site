from __future__ import annotations
import math
from typing import List, Tuple

def sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1 / (1 + z)
    z = math.exp(x)
    return z / (1 + z)

def recalibrate_item_b(a: float, b0: float, data: List[Tuple[float, int]], lr: float = 0.05, steps: int = 80) -> float:
    if not data:
        return float(b0)
    b = float(b0)
    for _ in range(steps):
        grad = 0.0
        for theta, u in data:
            p = sigmoid(a * (theta - b))
            grad += a * (p - u)
        grad /= max(1, len(data))
        b -= lr * grad
        b = max(-4.0, min(4.0, b))
    return b
