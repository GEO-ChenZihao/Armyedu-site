from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx


@dataclass
class AIHTTPError(RuntimeError):
    """Normalized HTTP error from an AI provider."""

    status_code: int
    endpoint: str
    body: str = ""
    retry_after_s: Optional[float] = None

    def __str__(self) -> str:  # pragma: no cover
        ra = f" retry_after={self.retry_after_s}" if self.retry_after_s else ""
        return f"AIHTTPError({self.status_code}) endpoint={self.endpoint}{ra}: {self.body[:200]}"


def _parse_retry_after(headers: httpx.Headers) -> Optional[float]:
    v = headers.get("retry-after")
    if not v:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _jitter_s(base: float) -> float:
    return base + random.random() * 0.25

def offline_mock(message: str, mode: str, context: Optional[dict] = None, reason: str = "") -> str:
    base = [
        "我先用“测-学-评”双循环的视角给你一个结构化回答：",
        "我会分三步：定位你当前能力(θ)、定位薄弱知识点(P(L))、给出下一步训练建议。",
        "我理解你的问题了，我们可以把它拆成“概念→例子→常见误区→练习建议”。",
    ]
    head = "【离线演示】外部模型暂不可用" + (f"（{reason}）" if reason else "")
    if mode == "emotion":
        tail = "如果你现在有点紧张，建议先做一次深呼吸（4秒吸气-4秒屏息-6秒呼气），然后从一题“低难度+高把握”的题开始恢复信心。"
    elif mode == "plan":
        tail = "学习计划建议：今天先完成 6 题（2题基础+3题中等+1题复盘），每题做完看错因，最后用 5 分钟总结要点。"
    else:
        tail = "讲解建议：先记住核心定义与边界，再用 2 个对比点区分相近概念，最后用 1 题巩固。"
    return "\n".join([head, random.choice(base), f"你的问题：{message}", tail])


def _format_profile_context(context: Optional[dict]) -> str:
    """将学习画像压缩成短文本，用于提示词（不包含敏感信息）。"""
    if not context:
        return ""
    try:
        theta = context.get("theta")
        answered = context.get("answered")
        mastery = context.get("mastery") or []
        mtxt = "、".join(
            [
                f"{m.get('name')}≈{round(float(m.get('p_mastery', 0.0)) * 100)}%"
                for m in mastery[:6]
                if isinstance(m, dict)
            ]
        )
        parts = []
        if theta is not None:
            parts.append(f"θ≈{round(float(theta), 2)}")
        if answered is not None:
            parts.append(f"已作答≈{int(answered)}")
        if mtxt:
            parts.append(f"薄弱点：{mtxt}")
        return "学习者画像：" + "；".join(parts) if parts else ""
    except Exception:
        return ""

async def call_openai_compatible(
    base_url: str,
    api_key: str,
    model: str,
    message: str,
    mode: str,
    context: Optional[dict] = None,
    timeout_s: float = 25.0,
    max_attempts: int = 3,
    max_output_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    """OpenAI-compatible: 优先 /v1/responses，失败则回退 /v1/chat/completions。
    说明：为了离线可演示，任何异常都建议由上层捕获并使用 offline_mock。
    """
    if not base_url:
        raise ValueError("base_url required")
    base = base_url.rstrip("/")
    # root: base without a trailing /v1 (used for OpenAI-style endpoints)
    if base.endswith("/v1"):
        root = base[:-3]
    else:
        root = base

    # DeepSeek is OpenAI-compatible but its canonical REST endpoints are:
    #   POST https://api.deepseek.com/chat/completions
    #   GET  https://api.deepseek.com/models
    # It also allows base_url=https://api.deepseek.com/v1 for SDK compatibility
    # where the SDK appends /chat/completions.
    is_deepseek = "deepseek.com" in root.lower() or "deepseek.com" in base.lower()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    profile_ctx = _format_profile_context(context)
    system_prompt = {
        "explain": "你是国防教育/军事理论学习助手。用清晰分点讲解概念、边界、易错点，并给出1-2个练习建议。避免提供任何危险或操作性细节。",
        "plan": "你是学习规划助手。根据学习者的薄弱点，给出可执行的训练计划（今日/本周），并附复盘方法。避免提供任何危险或操作性细节。",
        "emotion": "你是情绪支持学习教辅。用共情+行动建议缓解紧张焦虑，引导回到学习任务。避免提供任何危险或操作性细节。",
    }.get(mode, "你是学习助手，提供结构化帮助。")

    if profile_ctx:
        system_prompt = system_prompt + "\n" + profile_ctx

    # Separate connect/read timeouts reduce spurious failures on some networks.
    timeout = httpx.Timeout(timeout_s, connect=8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        # 1) Try Responses API (skip for providers known to not support it)
        if not is_deepseek:
            payload_resp = {
                "model": model,
                "input": [
                    {"type": "message", "role": "system", "content": system_prompt},
                    {"type": "message", "role": "user", "content": message},
                ],
            }
            resp_url = f"{root}/v1/responses"
            r = await client.post(resp_url, headers=headers, json=payload_resp)
            if r.status_code < 300:
                data = r.json()
                # 尽量兼容不同返回结构
                txt = None
                if isinstance(data, dict):
                    # OpenAI responses: output_text helper field sometimes exists
                    txt = data.get("output_text")
                    if not txt:
                        # Try to parse output[0].content[0].text
                        out = data.get("output") or []
                        if out and isinstance(out, list):
                            c = out[0].get("content") if isinstance(out[0], dict) else None
                            if c and isinstance(c, list):
                                # find first text
                                for seg in c:
                                    if isinstance(seg, dict) and seg.get("type") in ("output_text", "text"):
                                        txt = seg.get("text")
                                        break
                if txt:
                    return {"text": txt, "endpoint": "responses"}
                return {"text": json.dumps(data, ensure_ascii=False)[:800], "endpoint": "responses"}
            # Normalize non-2xx
            raise AIHTTPError(
                status_code=r.status_code,
                endpoint="responses",
                body=r.text,
                retry_after_s=_parse_retry_after(r.headers),
            )

        # 2) fallback Chat Completions (supported by OpenAI-compatible providers)
        payload_chat = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message},
            ],
            "temperature": 0.5,
        }
        if max_output_tokens is not None:
            # Limit output length to reduce latency/timeouts on longer questions.
            payload_chat["max_tokens"] = int(max_output_tokens)
        # DeepSeek: prefer /chat/completions (no /v1). If user set base_url with
        # /v1 for SDK compatibility, keep it (base already includes /v1).
        if is_deepseek:
            chat_url = f"{base}/chat/completions" if base.endswith("/v1") else f"{root}/chat/completions"
        else:
            chat_url = f"{root}/v1/chat/completions"
        # Retry loop for transient failures (network jitter / provider rate limiting)
        last_err: Optional[BaseException] = None
        for attempt in range(1, max_attempts + 1):
            try:
                r2 = await client.post(chat_url, headers=headers, json=payload_chat)
                if r2.status_code >= 300:
                    raise AIHTTPError(
                        status_code=r2.status_code,
                        endpoint="chat.completions",
                        body=r2.text,
                        retry_after_s=_parse_retry_after(r2.headers),
                    )
                data2 = r2.json()
                try:
                    txt2 = data2["choices"][0]["message"]["content"]
                except Exception:
                    txt2 = json.dumps(data2, ensure_ascii=False)[:800]
                return {"text": txt2, "endpoint": "chat.completions"}
            except AIHTTPError as e:
                last_err = e
                # 401/403/402 are not transient
                if e.status_code in (401, 403, 402):
                    raise
                # transient: 408/409/429/5xx
                if e.status_code in (408, 409, 429, 500, 502, 503, 504):
                    if attempt < max_attempts:
                        sleep_s = e.retry_after_s if e.retry_after_s else _jitter_s(0.6 * (2 ** (attempt - 1)))
                        await asyncio.sleep(min(max(sleep_s, 0.2), 3.5))
                        continue
                raise
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError) as e:
                last_err = e
                if attempt < max_attempts:
                    await asyncio.sleep(_jitter_s(0.5 * (2 ** (attempt - 1))))
                    continue
                raise
        # Should not reach
        raise last_err if last_err else RuntimeError("AI request failed")
