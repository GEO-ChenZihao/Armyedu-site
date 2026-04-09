from __future__ import annotations
import time
import collections
from dataclasses import dataclass
from typing import Deque, Dict, List, Tuple

@dataclass
class ReqEvent:
    ts: float
    method: str
    path: str
    status: int
    ms: float

class MetricsStore:
    def __init__(self, max_events: int = 500):
        self.start_ts = time.time()
        self.events: Deque[ReqEvent] = collections.deque(maxlen=max_events)

    def add(self, method: str, path: str, status: int, ms: float):
        self.events.append(ReqEvent(ts=time.time(), method=method, path=path, status=status, ms=ms))

    def snapshot(self) -> dict:
        ev = list(self.events)
        total = len(ev)
        by_endpoint: Dict[str, int] = {}
        status_counts: Dict[str, int] = {}
        latencies = []

        for e in ev:
            key = f"{e.method} {e.path}"
            by_endpoint[key] = by_endpoint.get(key, 0) + 1
            sc = str(e.status)
            status_counts[sc] = status_counts.get(sc, 0) + 1
            latencies.append(e.ms)

        latencies.sort()
        def pctl(p: float) -> float:
            if not latencies:
                return 0.0
            idx = int(round((p/100.0) * (len(latencies)-1)))
            idx = max(0, min(len(latencies)-1, idx))
            return float(latencies[idx])

        return {
            "uptime_s": int(time.time() - self.start_ts),
            "total": total,
            "by_endpoint": sorted(by_endpoint.items(), key=lambda x: x[1], reverse=True)[:12],
            "status_counts": status_counts,
            "latency_ms": {
                "p50": round(pctl(50), 2),
                "p95": round(pctl(95), 2),
                "p99": round(pctl(99), 2),
            },
            "recent": [
                {
                    "ts": e.ts,
                    "method": e.method,
                    "path": e.path,
                    "status": e.status,
                    "ms": round(e.ms, 2),
                }
                for e in ev[-30:]
            ],
        }
