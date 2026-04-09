from __future__ import annotations

import datetime as dt
import io
import json
import os
import csv
import time
import asyncio
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .security import verify_password, hash_password, create_session, delete_session, get_user_by_token, require_role
from .bkt import BKTParams, update_bkt
from .irt import estimate_theta_map
from .recommend import recommend_items
from .calibrate import recalibrate_item_b
from .metrics import MetricsStore
from .ai import offline_mock, call_openai_compatible, AIHTTPError
from .microcourse import ensure_demo_lessons_and_videos, build_offline_storyboard, extract_json_payload, normalize_storyboard, build_animation_package
from .visual_tutor import build_visual_storyboard, normalize_visual_storyboard, extract_json_payload as extract_visual_json_payload, build_visual_teaching_process

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="ArmEdu 双循环引擎（Command UI）", version="6.0")

# static
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="assets")

# init db
db.init_db()

# in-memory metrics
metrics = MetricsStore(max_events=800)

# very small in-memory rate limit (best-effort, per-process)
_rl_bucket: Dict[str, deque] = defaultdict(deque)

# External AI call concurrency guard (helps avoid provider 429 bursts)
_ai_sem = asyncio.Semaphore(int(os.environ.get("ARMEDU_AI_MAX_CONCURRENCY", "4")))

def _client_ip(req: Request) -> str:
    # 兼容常见反代 header（不强依赖）
    xff = req.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else "unknown"

def _rate_limit(req: Request) -> Optional[str]:
    """返回 None 表示放行；否则返回拒绝原因。仅对少数高风险入口做保护。"""
    path = req.url.path
    if path not in ("/api/auth/login", "/api/auth/register", "/api/ai/chat", "/api/ai/visual_solve"):
        return None
    ip = _client_ip(req)
    key = f"{ip}:{path}"
    q = _rl_bucket[key]
    now_s = time.time()
    # sliding window: 60s
    while q and (now_s - q[0]) > 60:
        q.popleft()
    limit = 20 if path == "/api/ai/visual_solve" else (30 if path == "/api/ai/chat" else 15)
    if len(q) >= limit:
        return "Too many requests"
    q.append(now_s)
    return None

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = dt.datetime.utcnow()
    response = None
    # basic rate limiting for a few endpoints
    deny = _rate_limit(request)
    if deny:
        return JSONResponse(status_code=429, content={"detail": deny})
    try:
        response = await call_next(request)
        return response
    finally:
        dur_ms = (dt.datetime.utcnow() - start).total_seconds() * 1000.0
        # 注意：不要记录静态资源噪声太多
        path = request.url.path
        if not path.startswith("/assets"):
            metrics.add(request.method, path, getattr(response, "status_code", 0) if response else 0, dur_ms)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    # 基础安全响应头（尽量不影响现有功能）
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # 允许页面自身使用麦克风（语音输入）；其余能力默认关闭
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(self), camera=()")
    return response

def now() -> str:
    return dt.datetime.utcnow().isoformat()


def _bootstrap_demo_learning_content() -> None:
    conn = db.connect()
    try:
        ensure_demo_lessons_and_videos(conn, now)
    finally:
        conn.close()


_bootstrap_demo_learning_content()


def audit(user_id: Optional[int], action: str, detail: Dict[str, Any]):
    conn = db.connect()
    db.exec(conn, "INSERT INTO audit_log(user_id, action, detail_json, at) VALUES(?,?,?,?)",
            (user_id, action, json.dumps(detail, ensure_ascii=False), now()))
    conn.close()

def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return None

def get_current_user(request: Request):
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired")
    return {"id": int(user["id"]), "username": user["username"], "role": user["role"], "token": token}

# -------------------- Gamification / Learning helpers --------------------
ACHIEVEMENTS: Dict[str, Dict[str, str]] = {
    "first_answer": {"title": "初次作答", "desc": "完成第 1 次训练作答"},
    "ten_answers": {"title": "小试牛刀", "desc": "累计作答达到 10 次"},
    "fifty_answers": {"title": "稳扎稳打", "desc": "累计作答达到 50 次"},
    "hundred_answers": {"title": "百题达人", "desc": "累计作答达到 100 次"},
    "first_correct": {"title": "旗开得胜", "desc": "首次答对题目"},
    "fast_10": {"title": "迅捷反应", "desc": "10 秒内答对一道题"},
    "accuracy_80_50": {"title": "质量优先", "desc": "作答≥50 且正确率≥80%"},
    "lesson_first": {"title": "开始微课", "desc": "完成一次章节微课"},
}

def _unlock(conn, user_id: int, code: str) -> bool:
    if code not in ACHIEVEMENTS:
        return False
    row = db.one(conn, "SELECT 1 FROM user_achievements WHERE user_id=? AND code=?", (user_id, code))
    if row:
        return False
    db.exec(conn, "INSERT INTO user_achievements(user_id, code, unlocked_at) VALUES(?,?,?)", (user_id, code, now()))
    return True

def _unique_dates_utc(iso_list: List[str]) -> List[dt.date]:
    out: List[dt.date] = []
    seen = set()
    for s in iso_list:
        if not s:
            continue
        d = s[:10]
        if d in seen:
            continue
        seen.add(d)
        try:
            out.append(dt.date.fromisoformat(d))
        except Exception:
            continue
    out.sort(reverse=True)
    return out

def _compute_streak(dates_desc: List[dt.date]) -> Tuple[int, int]:
    """(current, best) based on UTC dates."""
    if not dates_desc:
        return 0, 0
    # best streak
    best = 1
    cur = 1
    for i in range(1, len(dates_desc)):
        if (dates_desc[i-1] - dates_desc[i]).days == 1:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
    # current streak anchored to today or yesterday (allow users who studied late)
    today = dt.datetime.utcnow().date()
    head = dates_desc[0]
    if head not in (today, today - dt.timedelta(days=1)):
        return 0, best
    current = 1
    for i in range(1, len(dates_desc)):
        if (dates_desc[i-1] - dates_desc[i]).days == 1:
            current += 1
        else:
            break
    return current, best

@app.get("/")
def index():
    # 直接返回基于你提供的 army.html 的 UI
    return FileResponse(str(TEMPLATE_DIR / "army.html"))

@app.get("/app")
def app_page():
    return FileResponse(str(TEMPLATE_DIR / "army.html"))

@app.get("/health")
def health():
    return {"ok": True, "time": now()}

# -------------------- Auth --------------------
class LoginIn(BaseModel):
    username: str
    password: str

class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=64)
    role: str = "trainee"

@app.post("/api/auth/login")
def api_login(data: LoginIn):
    conn = db.connect()
    row = db.one(conn, "SELECT id, username, password_hash, role FROM users WHERE username=?", (data.username,))
    if not row or not verify_password(data.password, row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    token = create_session(int(row["id"]))
    audit(int(row["id"]), "login", {"username": data.username})
    conn.close()
    return {"token": token, "user": {"id": int(row["id"]), "username": row["username"], "role": row["role"]}}

@app.post("/api/auth/logout")
def api_logout(user=Depends(get_current_user)):
    delete_session(user["token"])
    audit(user["id"], "logout", {})
    return {"ok": True}

@app.post("/api/auth/register")
def api_register(data: RegisterIn):
    # 默认不允许自助注册 admin，除非显式开启
    allow_admin = os.environ.get("ARMEDU_ALLOW_ADMIN_REGISTER", "0") == "1"
    role = data.role if data.role in ("trainee", "instructor", "admin") else "trainee"
    if role == "admin" and not allow_admin:
        raise HTTPException(status_code=403, detail="管理员注册已关闭，请联系管理员创建账号")
    if role == "instructor" and not allow_admin:
        # 教员也默认关闭自助注册
        role = "trainee"

    conn = db.connect()
    exists = db.one(conn, "SELECT id FROM users WHERE username=?", (data.username,))
    if exists:
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已存在")

    uid = db.exec(conn, "INSERT INTO users(username, password_hash, role, created_at) VALUES(?,?,?,?)",
                 (data.username, hash_password(data.password), role, now()))
    # init mastery & ability
    skills = db.q(conn, "SELECT id FROM skills")
    for s in skills:
        db.exec(conn, "INSERT INTO mastery(user_id, skill_id, p_mastery, updated_at) VALUES(?,?,?,?)",
                (uid, s["id"], 0.20, now()))
    db.exec(conn, "INSERT INTO ability(user_id, theta, updated_at) VALUES(?,?,?)", (uid, 0.0, now()))
    db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (uid, 0.0, now()))
    conn.close()

    token = create_session(uid)
    audit(uid, "register", {"role": role})
    return {"token": token, "user": {"id": uid, "username": data.username, "role": role}}

@app.get("/api/me")
def api_me(user=Depends(get_current_user)):
    return {"user": {"id": user["id"], "username": user["username"], "role": user["role"]}}

# -------------------- Core data --------------------
@app.get("/api/skills")
def api_skills(user=Depends(get_current_user)):
    conn = db.connect()
    rows = db.q(conn, """SELECT s.id, s.name,
                           (SELECT COUNT(*) FROM items i WHERE i.skill_id=s.id AND i.enabled=1) AS item_count
                           FROM skills s ORDER BY s.id""")
    conn.close()
    return {"skills": [{"id": r["id"], "name": r["name"], "item_count": int(r["item_count"])} for r in rows]}

@app.get("/api/profile")
def api_profile(user=Depends(get_current_user)):
    conn = db.connect()
    theta_row = db.one(conn, "SELECT theta FROM ability WHERE user_id=?", (user["id"],))
    theta = float(theta_row["theta"]) if theta_row else 0.0

    stats = db.one(conn, """SELECT COUNT(*) AS answered,
                                     SUM(correct) AS correct,
                                     AVG(correct*1.0) AS acc,
                                     SUM(time_spent) AS total_time
                              FROM responses WHERE user_id=?""", (user["id"],))
    answered = int(stats["answered"] or 0)
    correct = int(stats["correct"] or 0)
    acc = float(stats["acc"] or 0.0)
    total_time = float(stats["total_time"] or 0.0)

    mastery_rows = db.q(conn, """SELECT m.skill_id, m.p_mastery, s.name
                                   FROM mastery m JOIN skills s ON m.skill_id=s.id
                                   WHERE m.user_id=? ORDER BY s.id""", (user["id"],))
    mastery = {r["skill_id"]: float(r["p_mastery"]) for r in mastery_rows}
    mastery_named = [{"skill_id": r["skill_id"], "name": r["name"], "p": float(r["p_mastery"])} for r in mastery_rows]

    conn.close()
    return {
        "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
        "theta": theta,
        "stats": {
            "answered": answered,
            "correct": correct,
            "accuracy": acc,
            "total_time_s": total_time,
        },
        "mastery": mastery,
        "mastery_named": mastery_named,
    }

@app.get("/api/responses/recent")
def api_recent(limit: int = 5, user=Depends(get_current_user)):
    limit = max(1, min(20, int(limit)))
    conn = db.connect()
    rows = db.q(conn, """SELECT r.answered_at, r.correct, r.time_spent, r.error_type,
                                   i.stem, s.name AS skill_name
                            FROM responses r
                            JOIN items i ON r.item_id=i.id
                            JOIN skills s ON i.skill_id=s.id
                            WHERE r.user_id=?
                            ORDER BY r.answered_at DESC LIMIT ?""", (user["id"], limit))
    conn.close()
    return {"recent": [
        {
            "at": r["answered_at"],
            "correct": bool(r["correct"]),
            "time_spent": float(r["time_spent"]),
            "error_type": r["error_type"],
            "stem": r["stem"],
            "skill": r["skill_name"],
        } for r in rows
    ]}

# -------------------- Training --------------------
@app.get("/api/items/recommendations")
def api_recommend(n: int = 1, skill_id: Optional[str] = None, mode: str = "mix", user=Depends(get_current_user)):
    n = max(1, min(10, int(n)))
    mode = mode if mode in ("mix", "new", "review") else "mix"

    conn = db.connect()
    theta_row = db.one(conn, "SELECT theta FROM ability WHERE user_id=?", (user["id"],))
    theta = float(theta_row["theta"]) if theta_row else 0.0

    mastery_rows = db.q(conn, "SELECT skill_id, p_mastery FROM mastery WHERE user_id=?", (user["id"],))
    mastery = {r["skill_id"]: float(r["p_mastery"]) for r in mastery_rows}

    answered_rows = db.q(conn, "SELECT DISTINCT item_id FROM responses WHERE user_id=?", (user["id"],))
    answered_set = {int(r["item_id"]) for r in answered_rows}

    params: List[Any] = []
    sql = """SELECT i.id, i.stem, i.choices_json, i.skill_id, i.a, i.b, s.name AS skill_name
              FROM items i JOIN skills s ON i.skill_id=s.id
              WHERE i.enabled=1"""
    if skill_id:
        sql += " AND i.skill_id=?"
        params.append(skill_id)
    rows = db.q(conn, sql, tuple(params))

    # optional meta (qtype/tags/difficulty). If missing, keep defaults.
    ids = [int(r["id"]) for r in rows]
    meta_map: Dict[int, Dict[str, Any]] = {}
    if ids:
        ph = ",".join(["?"] * len(ids))
        mrows = db.q(conn, f"SELECT item_id, qtype, difficulty, tags_json FROM item_meta WHERE item_id IN ({ph})", tuple(ids))
        for m in mrows:
            try:
                tags = json.loads(m["tags_json"]) if m["tags_json"] else []
            except Exception:
                tags = []
            meta_map[int(m["item_id"])] = {
                "qtype": m["qtype"],
                "difficulty": int(m["difficulty"] or 2),
                "tags": tags,
            }

    candidates = []
    for r in rows:
        is_new = int(r["id"]) not in answered_set
        if mode == "new" and not is_new:
            continue
        if mode == "review" and is_new:
            continue
        candidates.append({
            "id": int(r["id"]),
            "stem": r["stem"],
            "choices": json.loads(r["choices_json"]),
            "skill_id": r["skill_id"],
            "skill_name": r["skill_name"],
            "a": float(r["a"]),
            "b": float(r["b"]),
            "is_new": is_new,
            **meta_map.get(int(r["id"]), {"qtype": "single", "difficulty": 2, "tags": []}),
        })

    picked = recommend_items(theta, mastery, candidates, n=n)
    conn.close()
    return {"items": picked, "theta": theta}

class AnswerIn(BaseModel):
    item_id: int
    choice_index: int
    time_spent: float = 0.0
    error_type: Optional[str] = None

@app.post("/api/answers")
def api_answer(data: AnswerIn, user=Depends(get_current_user)):
    conn = db.connect()
    item = db.one(conn, "SELECT id, answer_key, skill_id, a, b FROM items WHERE id=? AND enabled=1", (data.item_id,))
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="题目不存在或已禁用")

    answer_key = int(item["answer_key"])
    correct = int(data.choice_index) == answer_key
    skill_id = item["skill_id"]
    a = float(item["a"])
    b = float(item["b"])

    # insert response
    db.exec(conn, """INSERT INTO responses(user_id, item_id, correct, choice_index, time_spent, error_type, answered_at)
                       VALUES(?,?,?,?,?,?,?)""", (user["id"], data.item_id, int(correct), int(data.choice_index),
                                                    float(data.time_spent or 0.0), data.error_type, now()))
    audit(user["id"], "answer", {"item_id": data.item_id, "correct": correct, "skill_id": skill_id})

    # update mastery for this skill (BKT)
    mrow = db.one(conn, "SELECT p_mastery FROM mastery WHERE user_id=? AND skill_id=?", (user["id"], skill_id))
    p_old = float(mrow["p_mastery"]) if mrow else 0.2
    p_new = update_bkt(p_old, correct, BKTParams())
    if mrow:
        db.exec(conn, "UPDATE mastery SET p_mastery=?, updated_at=? WHERE user_id=? AND skill_id=?",
                (p_new, now(), user["id"], skill_id))
    else:
        db.exec(conn, "INSERT INTO mastery(user_id, skill_id, p_mastery, updated_at) VALUES(?,?,?,?)",
                (user["id"], skill_id, p_new, now()))

    # update theta (MAP, 2PL)
    resp_rows = db.q(conn, """SELECT r.correct AS u, i.a, i.b
                                FROM responses r JOIN items i ON r.item_id=i.id
                                WHERE r.user_id=?""", (user["id"],))
    resp = [(int(r["u"]), float(r["a"]), float(r["b"])) for r in resp_rows]
    theta0_row = db.one(conn, "SELECT theta FROM ability WHERE user_id=?", (user["id"],))
    theta0 = float(theta0_row["theta"]) if theta0_row else 0.0
    theta = estimate_theta_map(resp, theta0=theta0)

    if theta0_row:
        db.exec(conn, "UPDATE ability SET theta=?, updated_at=? WHERE user_id=?", (theta, now(), user["id"]))
    else:
        db.exec(conn, "INSERT INTO ability(user_id, theta, updated_at) VALUES(?,?,?)", (user["id"], theta, now()))
    db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (user["id"], theta, now()))

    # achievements (non-blocking / best-effort)
    unlocked: List[str] = []
    try:
        st = db.one(conn, """SELECT COUNT(*) AS answered, SUM(correct) AS correct, AVG(correct*1.0) AS acc
                              FROM responses WHERE user_id=?""", (user["id"],))
        answered = int(st["answered"] or 0)
        correct_total = int(st["correct"] or 0)
        acc = float(st["acc"] or 0.0)
        if answered == 1 and _unlock(conn, user["id"], "first_answer"):
            unlocked.append("first_answer")
        if answered >= 10 and _unlock(conn, user["id"], "ten_answers"):
            unlocked.append("ten_answers")
        if answered >= 50 and _unlock(conn, user["id"], "fifty_answers"):
            unlocked.append("fifty_answers")
        if answered >= 100 and _unlock(conn, user["id"], "hundred_answers"):
            unlocked.append("hundred_answers")
        if correct and correct_total == 1 and _unlock(conn, user["id"], "first_correct"):
            unlocked.append("first_correct")
        if correct and float(data.time_spent or 0.0) > 0 and float(data.time_spent) <= 10 and _unlock(conn, user["id"], "fast_10"):
            unlocked.append("fast_10")
        if answered >= 50 and acc >= 0.8 and _unlock(conn, user["id"], "accuracy_80_50"):
            unlocked.append("accuracy_80_50")
    except Exception:
        unlocked = []

    conn.close()
    return {
        "correct": correct,
        "answer_key": answer_key,
        "theta": theta,
        "mastery": {"skill_id": skill_id, "p_old": p_old, "p_new": p_new},
        "unlocked": unlocked,
    }

# -------------------- Smart learning / lessons / voice meta --------------------
class NoteIn(BaseModel):
    note: str = Field(min_length=0, max_length=2000)

class ItemMetaIn(BaseModel):
    qtype: str = "single"  # single|judge|case|multi_mock|order_mock
    difficulty: int = Field(default=2, ge=1, le=5)
    tags: List[str] = []
    explanation: Optional[str] = None
    voice_script: Optional[str] = None

@app.get("/api/items/{item_id}")
def api_item_public(item_id: int, user=Depends(get_current_user)):
    """公开题目（不含答案），用于错题本/外部打开单题练习。"""
    conn = db.connect()
    r = db.one(conn, """SELECT i.id, i.stem, i.choices_json, i.skill_id, s.name AS skill_name
                         FROM items i JOIN skills s ON i.skill_id=s.id
                         WHERE i.id=? AND i.enabled=1""", (int(item_id),))
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "id": int(r["id"]),
        "stem": r["stem"],
        "choices": json.loads(r["choices_json"]),
        "skill_id": r["skill_id"],
        "skill_name": r["skill_name"],
    }

@app.get("/api/items/{item_id}/meta")
def api_item_meta(item_id: int, user=Depends(get_current_user)):
    conn = db.connect()
    m = db.one(conn, "SELECT * FROM item_meta WHERE item_id=?", (int(item_id),))
    n = db.one(conn, "SELECT note, updated_at FROM user_notes WHERE user_id=? AND item_id=?", (user["id"], int(item_id)))
    conn.close()
    out = {
        "item_id": int(item_id),
        "qtype": "single",
        "difficulty": 2,
        "tags": [],
        "explanation": None,
        "voice_script": None,
        "note": n["note"] if n else "",
        "note_updated_at": n["updated_at"] if n else None,
    }
    if m:
        try:
            tags = json.loads(m["tags_json"]) if m["tags_json"] else []
        except Exception:
            tags = []
        out.update({
            "qtype": m["qtype"] or "single",
            "difficulty": int(m["difficulty"] or 2),
            "tags": tags,
            "explanation": m["explanation"],
            "voice_script": m["voice_script"],
            "updated_at": m["updated_at"],
        })
    return out

@app.post("/api/items/{item_id}/note")
def api_item_note(item_id: int, data: NoteIn, user=Depends(get_current_user)):
    conn = db.connect()
    exists = db.one(conn, "SELECT 1 FROM user_notes WHERE user_id=? AND item_id=?", (user["id"], int(item_id)))
    if exists:
        db.exec(conn, "UPDATE user_notes SET note=?, updated_at=? WHERE user_id=? AND item_id=?",
                (data.note, now(), user["id"], int(item_id)))
    else:
        db.exec(conn, "INSERT INTO user_notes(user_id, item_id, note, updated_at) VALUES(?,?,?,?)",
                (user["id"], int(item_id), data.note, now()))
    conn.close()
    audit(user["id"], "note", {"item_id": int(item_id)})
    return {"ok": True}

@app.get("/api/learning/wrongbook")
def api_wrongbook(limit: int = 50, user=Depends(get_current_user)):
    limit = max(5, min(200, int(limit)))
    conn = db.connect()
    rows = db.q(conn, """SELECT i.id, i.stem, i.skill_id, s.name AS skill_name,
                              SUM(CASE WHEN r.correct=0 THEN 1 ELSE 0 END) AS wrong_count,
                              MAX(CASE WHEN r.correct=0 THEN r.answered_at ELSE NULL END) AS last_wrong_at,
                              COUNT(r.id) AS answered_count,
                              AVG(r.correct*1.0) AS acc
                       FROM responses r
                       JOIN items i ON r.item_id=i.id
                       JOIN skills s ON i.skill_id=s.id
                       WHERE r.user_id=?
                       GROUP BY i.id
                       HAVING wrong_count > 0
                       ORDER BY last_wrong_at DESC
                       LIMIT ?""", (user["id"], limit))
    conn.close()
    out = []
    for r in rows:
        out.append({
            "id": int(r["id"]),
            "stem": r["stem"],
            "skill_id": r["skill_id"],
            "skill_name": r["skill_name"],
            "wrong_count": int(r["wrong_count"] or 0),
            "answered_count": int(r["answered_count"] or 0),
            "accuracy": float(r["acc"] or 0.0),
            "last_wrong_at": r["last_wrong_at"],
        })
    return {"items": out}

@app.get("/api/learning/daily_plan")
def api_daily_plan(user=Depends(get_current_user)):
    conn = db.connect()
    mrows = db.q(conn, """SELECT m.skill_id, m.p_mastery, s.name
                            FROM mastery m JOIN skills s ON m.skill_id=s.id
                            WHERE m.user_id=?
                            ORDER BY m.p_mastery ASC, s.id ASC""", (user["id"],))
    weakest = mrows[:2]
    # wrongbook size
    w = db.one(conn, """SELECT COUNT(1) AS c FROM (
                          SELECT i.id,
                                 SUM(CASE WHEN r.correct=0 THEN 1 ELSE 0 END) AS wrong_count
                          FROM responses r JOIN items i ON r.item_id=i.id
                          WHERE r.user_id=?
                          GROUP BY i.id
                          HAVING wrong_count > 0
                        )""", (user["id"],))
    wrong_cnt = int(w["c"] or 0) if w else 0

    tasks: List[Dict[str, Any]] = []
    focus = []
    for r in weakest:
        sid = r["skill_id"]
        focus.append({"skill_id": sid, "name": r["name"], "p_mastery": float(r["p_mastery"] or 0.2)})
        l = db.one(conn, "SELECT title FROM lessons WHERE skill_id=?", (sid,))
        if l:
            tasks.append({"type": "lesson", "skill_id": sid, "title": l["title"], "est_min": 8,
                          "reason": "针对薄弱章节，先用微课建立框架"})
        tasks.append({"type": "practice", "skill_id": sid, "title": f"专项练习：{r['name']}", "n": 5, "est_min": 10,
                      "reason": "用 5 题巩固关键概念"})

    if wrong_cnt:
        tasks.append({"type": "wrong", "title": "错题复习", "n": min(10, wrong_cnt), "est_min": 10,
                      "reason": "优先解决高频错误"})
    conn.close()
    return {"focus_skills": focus, "tasks": tasks, "wrongbook_count": wrong_cnt}

class LessonVideoProgressIn(BaseModel):
    progress: float = 0.0
    watched_sec: float = 0.0
    last_scene: int = 1


class LessonVideoGenerateIn(BaseModel):
    use_external: bool = True
    force: bool = True
    config: Optional[Dict[str, str]] = None


def _read_lesson_video_meta(conn, skill_id: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    row = db.one(conn, """SELECT v.skill_id, v.title, v.summary, v.script_text, v.storyboard_json, v.poster_text,
                                  v.duration_sec, v.status, v.source, v.updated_at,
                                  s.name AS skill_name
                           FROM lesson_videos v
                           JOIN skills s ON s.id=v.skill_id
                           WHERE v.skill_id=?""", (skill_id,))
    if not row:
        return None
    try:
        scenes = json.loads(row["storyboard_json"] or "[]")
    except Exception:
        scenes = []
    progress = {"progress": 0.0, "watched_sec": 0.0, "completed": False, "last_scene": 1, "last_at": None}
    if user_id is not None:
        p = db.one(conn, "SELECT progress, watched_sec, completed, last_scene, last_at FROM lesson_video_progress WHERE user_id=? AND skill_id=?",
                   (user_id, skill_id))
        if p:
            progress = {
                "progress": float(p["progress"] or 0.0),
                "watched_sec": float(p["watched_sec"] or 0.0),
                "completed": bool(p["completed"]),
                "last_scene": int(p["last_scene"] or 1),
                "last_at": p["last_at"],
            }
    production = build_animation_package(row["skill_id"], row["skill_name"], row["title"], row["script_text"], scenes)
    return {
        "skill_id": row["skill_id"],
        "skill_name": row["skill_name"],
        "title": row["title"],
        "summary": row["summary"],
        "script_text": row["script_text"],
        "scenes": scenes,
        "scene_count": len(scenes),
        "poster_text": row["poster_text"],
        "duration_sec": int(row["duration_sec"] or 0),
        "status": row["status"],
        "source": row["source"],
        "updated_at": row["updated_at"],
        "progress": progress,
        "production": production,
    }



def _record_lesson_finish(conn, user_id: int, skill_id: str, increment: bool = True) -> bool:
    p = db.one(conn, "SELECT completed_count FROM lesson_progress WHERE user_id=? AND skill_id=?", (user_id, skill_id))
    if p:
        current = int(p["completed_count"] or 0)
        nxt = current + (1 if increment else 0)
        if nxt < 1:
            nxt = 1
        db.exec(conn, "UPDATE lesson_progress SET completed_count=?, last_at=? WHERE user_id=? AND skill_id=?",
                (nxt, now(), user_id, skill_id))
    else:
        db.exec(conn, "INSERT INTO lesson_progress(user_id, skill_id, completed_count, last_at) VALUES(?,?,?,?)",
                (user_id, skill_id, 1, now()))
    return _unlock(conn, user_id, "lesson_first")



def _upsert_lesson_video_progress(conn, user_id: int, skill_id: str, progress: float, watched_sec: float,
                                  last_scene: int, completed: Optional[bool] = None) -> Dict[str, Any]:
    progress = max(0.0, min(1.0, float(progress or 0.0)))
    watched_sec = max(0.0, float(watched_sec or 0.0))
    last_scene = max(1, int(last_scene or 1))
    row = db.one(conn, "SELECT progress, watched_sec, completed, last_scene FROM lesson_video_progress WHERE user_id=? AND skill_id=?",
                 (user_id, skill_id))
    if row:
        new_completed = bool(row["completed"]) if completed is None else bool(completed)
        db.exec(conn, """UPDATE lesson_video_progress
                      SET progress=?, watched_sec=?, completed=?, last_scene=?, last_at=?
                      WHERE user_id=? AND skill_id=?""",
                (max(progress, float(row["progress"] or 0.0)),
                 max(watched_sec, float(row["watched_sec"] or 0.0)),
                 1 if new_completed else 0,
                 max(last_scene, int(row["last_scene"] or 1)),
                 now(), user_id, skill_id))
    else:
        db.exec(conn, """INSERT INTO lesson_video_progress(user_id, skill_id, progress, watched_sec, completed, last_scene, last_at)
                  VALUES(?,?,?,?,?,?,?)""",
                (user_id, skill_id, progress, watched_sec, 1 if completed else 0, last_scene, now()))
    return _read_lesson_video_meta(conn, skill_id, user_id) or {}


async def _generate_lesson_video_payload(skill_id: str, use_external: bool = True,
                                         config: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    conn = db.connect()
    lesson = db.one(conn, """SELECT l.skill_id, l.title, l.content_md, s.name AS skill_name
                             FROM lessons l JOIN skills s ON s.id=l.skill_id
                             WHERE l.skill_id=?""", (skill_id,))
    conn.close()
    if not lesson:
        raise HTTPException(status_code=404, detail="lesson not found")

    title = lesson["title"]
    content_md = lesson["content_md"]
    skill_name = lesson["skill_name"]
    story = build_offline_storyboard(skill_id, skill_name, title, content_md)
    endpoint = "offline_storyboard"
    used_external = False
    fallback_reason = ""

    if use_external:
        cfg = config or {}
        env_cfg = _env_ai_config()
        base_url = (cfg.get("base_url") or env_cfg.get("base_url") or "").strip()
        model = (cfg.get("model") or env_cfg.get("model") or "").strip()
        allow_client_key = env_cfg.get("allow_client_key") == "1"
        api_key = (env_cfg.get("api_key") or "").strip()
        if (not api_key) and allow_client_key:
            api_key = (cfg.get("api_key") or "").strip()
        if base_url and api_key and model:
            prompt = (
                "请将下面这节国防教育微课转换为‘动画课程分镜 JSON’。返回严格 JSON，不要解释。\n"
                "字段格式：{title, summary, poster_text, scenes:[{title, subtitle, bullets:[...], narration, duration_sec, icon, layout, visual_type, equation, visual}]}。\n"
                "要求：1) 场景 4-6 个；2) 每个 bullets 2-4 条；3) 每个场景要带 visual_type（如 concept_map、step_ladder、summary_board）；4) equation 用于需要突出展示的公式或流程；5) visual 为对象，描述节点/强调项/参数；6) 不要出现危险或操作性细节。\n\n"
                f"课程标题：{title}\n章节：{skill_name}\n课程正文：\n{content_md}"
            )
            try:
                async with _ai_sem:
                    r = await call_openai_compatible(
                        base_url, api_key, model, prompt, "explain",
                        context={"theta": 0, "mastery": [], "answered": 0},
                        timeout_s=float(os.environ.get("ARMEDU_AI_TIMEOUT_SECONDS", "60")),
                        max_attempts=int(os.environ.get("ARMEDU_AI_MAX_ATTEMPTS", "3")),
                        max_output_tokens=900,
                    )
                payload = extract_json_payload(r.get("text", ""))
                story = normalize_storyboard(skill_id, skill_name, title, content_md, payload)
                story["source"] = "external_ai"
                endpoint = r.get("endpoint") or "chat.completions"
                used_external = True
            except Exception as e:
                fallback_reason = f"{type(e).__name__}: {repr(e)}"
                story = normalize_storyboard(skill_id, skill_name, title, content_md, None)
                endpoint = "offline_storyboard"
        else:
            fallback_reason = "未配置外部模型，已切换为离线模板"
    else:
        fallback_reason = "已按要求使用离线模板生成"

    production = build_animation_package(skill_id, skill_name, title, content_md, story.get("scenes") or [])
    return {
        **story,
        "skill_id": skill_id,
        "skill_name": skill_name,
        "used_external": used_external,
        "endpoint": endpoint,
        "fallback_reason": fallback_reason,
        "production": production,
    }


@app.get("/api/lessons")
def api_lessons(user=Depends(get_current_user)):
    conn = db.connect()
    rows = db.q(conn, """SELECT l.skill_id, l.title, l.updated_at, s.name AS skill_name,
                              COALESCE(p.completed_count,0) AS completed_count,
                              COALESCE(m.p_mastery,0.2) AS p_mastery,
                              COALESCE(v.duration_sec,0) AS video_duration,
                              COALESCE(v.status,'missing') AS video_status,
                              COALESCE(v.source,'') AS video_source,
                              COALESCE(vp.progress,0.0) AS video_progress,
                              COALESCE(vp.completed,0) AS video_completed
                       FROM lessons l
                       JOIN skills s ON s.id=l.skill_id
                       LEFT JOIN lesson_progress p ON p.user_id=? AND p.skill_id=l.skill_id
                       LEFT JOIN mastery m ON m.user_id=? AND m.skill_id=l.skill_id
                       LEFT JOIN lesson_videos v ON v.skill_id=l.skill_id
                       LEFT JOIN lesson_video_progress vp ON vp.user_id=? AND vp.skill_id=l.skill_id
                       ORDER BY l.skill_id""", (user["id"], user["id"], user["id"]))
    conn.close()
    return {"lessons": [
        {
            "skill_id": r["skill_id"],
            "skill_name": r["skill_name"],
            "title": r["title"],
            "updated_at": r["updated_at"],
            "completed_count": int(r["completed_count"] or 0),
            "p_mastery": float(r["p_mastery"] or 0.2),
            "mastery": float(r["p_mastery"] or 0.2),
            "has_video": str(r["video_status"]) != "missing",
            "video_duration": int(r["video_duration"] or 0),
            "video_status": r["video_status"],
            "video_source": r["video_source"],
            "video_progress": float(r["video_progress"] or 0.0),
            "video_completed": bool(r["video_completed"]),
        } for r in rows
    ]}


@app.get("/api/lessons/{skill_id}")
def api_lesson_get(skill_id: str, user=Depends(get_current_user)):
    conn = db.connect()
    r = db.one(conn, """SELECT l.skill_id, l.title, l.content_md, l.resources_json, l.updated_at, s.name AS skill_name
                         FROM lessons l JOIN skills s ON s.id=l.skill_id
                         WHERE l.skill_id=?""", (skill_id,))
    p = db.one(conn, "SELECT completed_count, last_at FROM lesson_progress WHERE user_id=? AND skill_id=?", (user["id"], skill_id))
    video = _read_lesson_video_meta(conn, skill_id, user["id"])
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="lesson not found")
    try:
        resources = json.loads(r["resources_json"]) if r["resources_json"] else []
    except Exception:
        resources = []
    return {
        "skill_id": r["skill_id"],
        "skill_name": r["skill_name"],
        "title": r["title"],
        "content_md": r["content_md"],
        "resources": resources,
        "updated_at": r["updated_at"],
        "progress": {"completed_count": int(p["completed_count"] or 0) if p else 0, "last_at": p["last_at"] if p else None},
        "video": video,
        "completed_count": int(p["completed_count"] or 0) if p else 0,
    }


@app.get("/api/lessons/{skill_id}/video")
def api_lesson_video_get(skill_id: str, user=Depends(get_current_user)):
    conn = db.connect()
    video = _read_lesson_video_meta(conn, skill_id, user["id"])
    if not video:
        lesson = db.one(conn, """SELECT l.skill_id, l.title, l.content_md, s.name AS skill_name
                                 FROM lessons l JOIN skills s ON s.id=l.skill_id
                                 WHERE l.skill_id=?""", (skill_id,))
        if not lesson:
            conn.close()
            raise HTTPException(status_code=404, detail="lesson not found")
        story = build_offline_storyboard(skill_id, lesson["skill_name"], lesson["title"], lesson["content_md"])
        db.exec(conn, """INSERT INTO lesson_videos(skill_id, title, summary, script_text, storyboard_json,
                  poster_text, duration_sec, status, source, updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (skill_id, story["title"], story["summary"], lesson["content_md"], json.dumps(story["scenes"], ensure_ascii=False),
                 story["poster_text"], int(story["duration_sec"]), "ready", story["source"], now()))
        video = _read_lesson_video_meta(conn, skill_id, user["id"])
    conn.close()
    return video


@app.post("/api/lessons/{skill_id}/complete")
def api_lesson_complete(skill_id: str, user=Depends(get_current_user)):
    conn = db.connect()
    r = db.one(conn, "SELECT 1 FROM lessons WHERE skill_id=?", (skill_id,))
    if not r:
        conn.close()
        raise HTTPException(status_code=404, detail="lesson not found")
    unlocked = _record_lesson_finish(conn, user["id"], skill_id, increment=True)
    conn.close()
    audit(user["id"], "lesson_complete", {"skill_id": skill_id})
    return {"ok": True, "unlocked": ["lesson_first"] if unlocked else []}


@app.post("/api/lessons/{skill_id}/video/progress")
def api_lesson_video_progress(skill_id: str, data: LessonVideoProgressIn, user=Depends(get_current_user)):
    conn = db.connect()
    video = db.one(conn, "SELECT 1 FROM lesson_videos WHERE skill_id=?", (skill_id,))
    if not video:
        lesson = db.one(conn, "SELECT 1 FROM lessons WHERE skill_id=?", (skill_id,))
        if not lesson:
            conn.close()
            raise HTTPException(status_code=404, detail="lesson not found")
    out = _upsert_lesson_video_progress(conn, user["id"], skill_id, data.progress, data.watched_sec, data.last_scene, None)
    conn.close()
    return {"ok": True, "progress": out.get("progress")}


@app.post("/api/lessons/{skill_id}/video/complete")
def api_lesson_video_complete(skill_id: str, user=Depends(get_current_user)):
    conn = db.connect()
    video = _read_lesson_video_meta(conn, skill_id, user["id"])
    if not video:
        conn.close()
        raise HTTPException(status_code=404, detail="video lesson not found")
    _upsert_lesson_video_progress(conn, user["id"], skill_id, 1.0, float(video.get("duration_sec") or 0), int(video.get("scene_count") or 1), True)
    unlocked = _record_lesson_finish(conn, user["id"], skill_id, increment=False)
    conn.close()
    audit(user["id"], "lesson_video_complete", {"skill_id": skill_id})
    return {"ok": True, "unlocked": ["lesson_first"] if unlocked else []}


@app.get("/api/admin/lesson_videos")
def api_admin_lesson_videos(user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    rows = db.q(conn, """SELECT v.skill_id, v.title, v.duration_sec, v.status, v.source, v.updated_at,
                                s.name AS skill_name
                         FROM lesson_videos v JOIN skills s ON s.id=v.skill_id
                         ORDER BY v.skill_id""")
    conn.close()
    return {"videos": [
        {
            "skill_id": r["skill_id"],
            "skill_name": r["skill_name"],
            "title": r["title"],
            "duration_sec": int(r["duration_sec"] or 0),
            "status": r["status"],
            "source": r["source"],
            "updated_at": r["updated_at"],
        } for r in rows
    ]}


@app.post("/api/admin/lessons/{skill_id}/video/generate")
async def api_admin_generate_lesson_video(skill_id: str, data: LessonVideoGenerateIn, user=Depends(get_current_user)):
    admin_guard(user)
    if not data.force:
        conn = db.connect()
        existing = _read_lesson_video_meta(conn, skill_id, None)
        conn.close()
        if existing:
            return {**existing, "used_external": existing.get("source") == "external_ai", "endpoint": "cached"}
    payload = await _generate_lesson_video_payload(skill_id, use_external=bool(data.use_external), config=data.config)
    conn = db.connect()
    lesson = db.one(conn, "SELECT content_md FROM lessons WHERE skill_id=?", (skill_id,))
    ex = db.one(conn, "SELECT 1 FROM lesson_videos WHERE skill_id=?", (skill_id,))
    if ex:
        db.exec(conn, """UPDATE lesson_videos SET title=?, summary=?, script_text=?, storyboard_json=?,
                  poster_text=?, duration_sec=?, status=?, source=?, updated_at=? WHERE skill_id=?""",
                (payload["title"], payload["summary"], lesson["content_md"] if lesson else "",
                 json.dumps(payload["scenes"], ensure_ascii=False), payload["poster_text"], int(payload["duration_sec"]),
                 "ready", payload.get("source") or ("external_ai" if payload.get("used_external") else "offline_template"), now(), skill_id))
    else:
        db.exec(conn, """INSERT INTO lesson_videos(skill_id, title, summary, script_text, storyboard_json,
                  poster_text, duration_sec, status, source, updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (skill_id, payload["title"], payload["summary"], lesson["content_md"] if lesson else "",
                 json.dumps(payload["scenes"], ensure_ascii=False), payload["poster_text"], int(payload["duration_sec"]),
                 "ready", payload.get("source") or ("external_ai" if payload.get("used_external") else "offline_template"), now()))
    conn.close()
    audit(user["id"], "admin_generate_lesson_video", {"skill_id": skill_id, "used_external": bool(payload.get("used_external"))})
    return payload


@app.get("/api/social/leaderboard")
def api_leaderboard(limit: int = 10, user=Depends(get_current_user)):
    limit = max(5, min(50, int(limit)))
    conn = db.connect()
    rows = db.q(conn, """SELECT u.username, u.role,
                              COUNT(r.id) AS answered,
                              SUM(r.correct) AS correct,
                              AVG(r.correct*1.0) AS acc,
                              COALESCE(a.theta, 0.0) AS theta
                       FROM users u
                       LEFT JOIN responses r ON r.user_id=u.id
                       LEFT JOIN ability a ON a.user_id=u.id
                       GROUP BY u.id
                       ORDER BY answered DESC, acc DESC
                       LIMIT ?""", (limit,))
    conn.close()
    out = []
    for r in rows:
        ans = int(r["answered"] or 0)
        out.append({
            "username": r["username"],
            "role": r["role"],
            "answered": ans,
            "accuracy": float(r["acc"] or 0.0) if ans else 0.0,
            "theta": float(r["theta"] or 0.0),
        })
    return {"leaderboard": out}

@app.get("/api/social/me")
def api_social_me(user=Depends(get_current_user)):
    conn = db.connect()
    rrows = db.q(conn, "SELECT answered_at FROM responses WHERE user_id=? ORDER BY answered_at DESC LIMIT 600", (user["id"],))
    dates = _unique_dates_utc([r["answered_at"] for r in rrows])
    current, best = _compute_streak(dates)
    arows = db.q(conn, "SELECT code, unlocked_at FROM user_achievements WHERE user_id=? ORDER BY unlocked_at DESC", (user["id"],))
    conn.close()
    ach = []
    for r in arows:
        meta = ACHIEVEMENTS.get(r["code"], {"title": r["code"], "desc": ""})
        ach.append({"code": r["code"], "title": meta["title"], "desc": meta["desc"], "unlocked_at": r["unlocked_at"]})
    return {"streak": {"current": current, "best": best}, "achievements": ach}

# -------------------- Analytics --------------------
@app.get("/api/analytics/theta_series")
def api_theta_series(limit: int = 30, user=Depends(get_current_user)):
    limit = max(2, min(120, int(limit)))
    conn = db.connect()
    rows = db.q(conn, "SELECT at, theta FROM ability_history WHERE user_id=? ORDER BY at DESC LIMIT ?",
                (user["id"], limit))
    conn.close()
    series = [{"at": r["at"], "theta": float(r["theta"])} for r in reversed(rows)]
    return {"series": series}

@app.get("/api/analytics/skill_stats")
def api_skill_stats(user=Depends(get_current_user)):
    conn = db.connect()
    rows = db.q(conn, """SELECT s.id AS skill_id, s.name,
                                   COUNT(r.id) AS answered,
                                   SUM(r.correct) AS correct,
                                   AVG(r.correct*1.0) AS acc,
                                   AVG(r.time_spent) AS avg_time
                            FROM skills s
                            LEFT JOIN items i ON i.skill_id=s.id
                            LEFT JOIN responses r ON r.item_id=i.id AND r.user_id=?
                            GROUP BY s.id, s.name
                            ORDER BY s.id""", (user["id"],))
    mrows = db.q(conn, "SELECT skill_id, p_mastery FROM mastery WHERE user_id=?", (user["id"],))
    mastery = {r["skill_id"]: float(r["p_mastery"]) for r in mrows}
    conn.close()
    out = []
    for r in rows:
        sid = r["skill_id"]
        out.append({
            "skill_id": sid,
            "name": r["name"],
            "answered": int(r["answered"] or 0),
            "correct": int(r["correct"] or 0),
            "accuracy": float(r["acc"] or 0.0),
            "avg_time": float(r["avg_time"] or 0.0),
            "p_mastery": float(mastery.get(sid, 0.2)),
        })
    return {"skills": out}

@app.get("/api/analytics/overview")
def api_analytics_overview(user=Depends(get_current_user)):
    conn = db.connect()
    # theta series
    rows = db.q(conn, "SELECT at, theta FROM ability_history WHERE user_id=? ORDER BY at DESC LIMIT 40", (user["id"],))
    theta_series = [{"at": r["at"], "theta": float(r["theta"])} for r in reversed(rows)]

    # mastery
    mrows = db.q(conn, """SELECT m.skill_id, s.name, m.p_mastery
                             FROM mastery m JOIN skills s ON m.skill_id=s.id
                             WHERE m.user_id=? ORDER BY s.id""", (user["id"],))
    mastery = [{"skill_id": r["skill_id"], "name": r["name"], "p": float(r["p_mastery"])} for r in mrows]

    # error types
    erows = db.q(conn, """SELECT COALESCE(error_type,'未标注') AS et, COUNT(*) AS c
                             FROM responses WHERE user_id=? GROUP BY et ORDER BY c DESC""", (user["id"],))
    error_types = [{"name": r["et"], "count": int(r["c"])} for r in erows]

    # time distribution
    trows = db.q(conn, "SELECT time_spent FROM responses WHERE user_id=? AND time_spent IS NOT NULL", (user["id"],))
    bins = {"<10s":0, "10-30s":0, "30-60s":0, "60-120s":0, ">=120s":0}
    for r in trows:
        t = float(r["time_spent"] or 0.0)
        if t < 10: bins["<10s"] += 1
        elif t < 30: bins["10-30s"] += 1
        elif t < 60: bins["30-60s"] += 1
        elif t < 120: bins["60-120s"] += 1
        else: bins[">=120s"] += 1
    time_dist = [{"name": k, "count": v} for k,v in bins.items()]

    # per-skill table
    srows = db.q(conn, """SELECT s.id AS skill_id, s.name,
                                   COUNT(r.id) AS answered,
                                   SUM(r.correct) AS correct,
                                   AVG(r.correct*1.0) AS acc,
                                   AVG(r.time_spent) AS avg_time
                            FROM skills s
                            LEFT JOIN items i ON i.skill_id=s.id
                            LEFT JOIN responses r ON r.item_id=i.id AND r.user_id=?
                            GROUP BY s.id, s.name
                            ORDER BY s.id""", (user["id"],))
    mastery_map = {r["skill_id"]: float(r["p_mastery"]) for r in mrows}
    per_skill = []
    for r in srows:
        sid = r["skill_id"]
        per_skill.append({
            "skill_id": sid,
            "name": r["name"],
            "answered": int(r["answered"] or 0),
            "accuracy": float(r["acc"] or 0.0),
            "avg_time": float(r["avg_time"] or 0.0),
            "p_mastery": float(mastery_map.get(sid, 0.2)),
        })

    conn.close()
    return {
        "theta_series": theta_series,
        "mastery": mastery,
        "error_types": error_types,
        "time_dist": time_dist,
        "per_skill": per_skill,
    }

@app.get("/api/analytics/skill_detail")
def api_skill_detail(skill_id: str, user=Depends(get_current_user)):
    conn = db.connect()
    rows = db.q(conn, """SELECT r.answered_at, r.correct, r.time_spent, r.error_type, i.stem
                            FROM responses r JOIN items i ON r.item_id=i.id
                            WHERE r.user_id=? AND i.skill_id=?
                            ORDER BY r.answered_at DESC LIMIT 12""", (user["id"], skill_id))
    conn.close()
    return {"responses": [
        {"at": r["answered_at"], "correct": bool(r["correct"]), "time_spent": float(r["time_spent"]), "error_type": r["error_type"], "stem": r["stem"]}
        for r in rows
    ]}

# -------------------- AI --------------------
class AIChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    mode: str = "explain"  # explain|plan|emotion
    config: Optional[Dict[str, str]] = None


class VisualSolveIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    subject: str = "auto"  # auto|math|physics
    config: Optional[Dict[str, str]] = None


def _env_ai_config() -> Dict[str, str]:
    """从环境变量读取服务端 AI 配置（不返回 key 给前端）。

    约定：
      - ARMEDU_AI_BASE_URL
      - ARMEDU_AI_API_KEY
      - ARMEDU_AI_MODEL
      - ARMEDU_AI_ALLOW_CLIENT_KEY=0  # 可选：禁用前端自带 key（更安全；默认允许以保持兼容）
    """
    return {
        "base_url": (os.environ.get("ARMEDU_AI_BASE_URL") or "").strip(),
        "api_key": (os.environ.get("ARMEDU_AI_API_KEY") or "").strip(),
        "model": (os.environ.get("ARMEDU_AI_MODEL") or "").strip(),
        "allow_client_key": "0" if (os.environ.get("ARMEDU_AI_ALLOW_CLIENT_KEY", "1") == "0") else "1",
    }

@app.post("/api/ai/chat")
async def api_ai_chat(data: AIChatIn, user=Depends(get_current_user)):
    mode = data.mode if data.mode in ("explain","plan","emotion") else "explain"
    cfg = data.config or {}
    env_cfg = _env_ai_config()

    # base_url / model：允许前端覆盖（便于切换到 OpenAI-Compatible 自建网关）
    base_url = (cfg.get("base_url") or env_cfg.get("base_url") or "").strip()
    model = (cfg.get("model") or env_cfg.get("model") or "").strip()

    # api_key：优先服务端环境变量；若未配置服务端 key，则回退到前端（默认允许，以保持兼容）
    allow_client_key = env_cfg.get("allow_client_key") == "1"
    api_key = (env_cfg.get("api_key") or "").strip()
    if (not api_key) and allow_client_key:
        api_key = (cfg.get("api_key") or "").strip()

    # profile context for better plan (optional)
    ctx = {}
    try:
        prof = api_profile(user)
        ctx = {"theta": prof["theta"], "mastery": prof["mastery_named"][:6], "answered": prof["stats"]["answered"]}
    except Exception:
        ctx = {}

    if base_url and api_key and model:
        try:
            async with _ai_sem:
                timeout_s = float(os.environ.get("ARMEDU_AI_TIMEOUT_SECONDS", "60"))
                max_attempts = int(os.environ.get("ARMEDU_AI_MAX_ATTEMPTS", "3"))
                # Smaller max output reduces latency (helps avoid timeouts on explain/plan).
                max_out = int(os.environ.get("ARMEDU_AI_MAX_OUTPUT_TOKENS", "700"))
                r = await call_openai_compatible(
                    base_url, api_key, model, data.message, mode,
                    context=ctx, timeout_s=timeout_s, max_attempts=max_attempts, max_output_tokens=max_out
                )
            audit(user["id"], "ai_chat", {"mode": mode, "endpoint": r.get("endpoint"), "model": model})
            return {"reply": r.get("text"), "used_external": True, "endpoint": r.get("endpoint"), "model": model}
        except Exception as e:
            # Some httpx exceptions have an empty str(e); keep useful diagnostics.
            reason = f"{type(e).__name__}: {repr(e)}"

            # For auth/billing/rate-limit errors, show a clear message instead of a misleading mock.
            if isinstance(e, AIHTTPError):
                sc = int(e.status_code)
                # Try to extract a short provider message (best effort)
                msg = ""
                try:
                    j = json.loads(e.body or "{}")
                    if isinstance(j, dict):
                        msg = (j.get("error", {}) or {}).get("message") or j.get("message") or ""
                except Exception:
                    msg = ""
                msg = (msg or "").strip()
                short = (msg[:120] + "…") if len(msg) > 120 else msg

                if sc in (401, 403):
                    txt = "【外部模型鉴权失败】请确认 Base URL 与 API Key 属于同一平台（DeepSeek 的 Key 不能用于 OpenAI，反之亦然）。\n" + (f"提示：{short}" if short else "")
                    audit(user["id"], "ai_chat_fallback", {"reason": f"{sc} auth", "mode": mode})
                    return {"reply": txt, "used_external": False, "endpoint": "auth_error", "model": model, "fallback_reason": reason[:240]}

                if sc == 402:
                    txt = "【外部模型余额/额度不足】请在对应平台充值或放开项目限额后再试。\n" + (f"提示：{short}" if short else "")
                    audit(user["id"], "ai_chat_fallback", {"reason": f"{sc} quota", "mode": mode})
                    return {"reply": txt, "used_external": False, "endpoint": "quota_error", "model": model, "fallback_reason": reason[:240]}

                if sc == 429:
                    txt = "【外部模型触发限流(429)】请稍等 3-10 秒再试，或降低并发/请求频率。\n" + (f"提示：{short}" if short else "")
                    audit(user["id"], "ai_chat_fallback", {"reason": f"{sc} rate", "mode": mode})
                    return {"reply": txt, "used_external": False, "endpoint": "rate_limited", "model": model, "fallback_reason": reason[:240]}

            # Other errors: fallback to offline mock (but label it clearly)
            txt = offline_mock(data.message, mode, ctx, reason=("网络波动/服务不稳定，已自动切换"))
            audit(user["id"], "ai_chat_fallback", {"reason": reason[:240], "mode": mode})
            return {"reply": txt, "used_external": False, "endpoint": "offline_mock", "model": "offline", "fallback_reason": reason[:240]}
    else:
        txt = offline_mock(data.message, mode, ctx, reason="未配置外部模型")
        audit(user["id"], "ai_chat_mock", {"mode": mode})
        return {"reply": txt, "used_external": False, "endpoint": "offline_mock", "model": "offline"}



@app.post("/api/ai/visual_solve")
async def api_ai_visual_solve(data: VisualSolveIn, user=Depends(get_current_user)):
    subject = data.subject if data.subject in ("auto", "math", "physics") else "auto"
    question = data.question.strip()
    cfg = data.config or {}
    env_cfg = _env_ai_config()

    base_url = (cfg.get("base_url") or env_cfg.get("base_url") or "").strip()
    model = (cfg.get("model") or env_cfg.get("model") or "").strip()
    allow_client_key = env_cfg.get("allow_client_key") == "1"
    api_key = (env_cfg.get("api_key") or "").strip()
    if (not api_key) and allow_client_key:
        api_key = (cfg.get("api_key") or "").strip()

    story = build_visual_storyboard(question, subject)
    endpoint = "offline_visual_tutor"
    used_external = False
    fallback_reason = ""

    if base_url and api_key and model:
        prompt = (
            "请把下面这道题转换成‘浏览器动态讲题 JSON’，返回严格 JSON，不要解释。\n"
            "字段格式：{title, summary, poster_text, scenes:[{title, subtitle, bullets:[...], narration, duration_sec, visual_type, equation, visual, accent}]}。\n"
            "要求：1) 适合数学/物理题动态讲解；2) visual_type 可用 fourier_plot、trig_plot、projectile_plot、shm_plot、equation_board、step_board、physics_board、summary_board、unit_circle；3) narration 口语化、适合语音播报；4) equation 保留本场景最重要的公式；5) visual 用对象描述绘图参数；6) 不要出现危险或操作性细节。\n\n"
            f"题目：{question}\n学科：{subject}"
        )
        try:
            async with _ai_sem:
                r = await call_openai_compatible(
                    base_url, api_key, model, prompt, "explain",
                    context={"theta": 0, "mastery": [], "answered": 0},
                    timeout_s=float(os.environ.get("ARMEDU_AI_TIMEOUT_SECONDS", "60")),
                    max_attempts=int(os.environ.get("ARMEDU_AI_MAX_ATTEMPTS", "3")),
                    max_output_tokens=1000,
                )
            payload = extract_visual_json_payload(r.get("text", ""))
            story = normalize_visual_storyboard(question, payload, subject)
            story["source"] = "external_ai"
            endpoint = r.get("endpoint") or "chat.completions"
            used_external = True
        except Exception as e:
            fallback_reason = f"{type(e).__name__}: {repr(e)}"
            story = build_visual_storyboard(question, subject)
            endpoint = "offline_visual_tutor"
    else:
        fallback_reason = "未配置外部模型，已切换为离线动态讲题"

    teaching_process = build_visual_teaching_process(story)
    audit(user["id"], "ai_visual_solve", {"subject": subject, "used_external": used_external, "endpoint": endpoint})
    return {
        **story,
        "used_external": used_external,
        "endpoint": endpoint,
        "model": model if used_external else "offline",
        "fallback_reason": fallback_reason,
        "teaching_process": teaching_process,
    }

# -------------------- Data export / reset --------------------
@app.get("/api/export/my_responses.csv")
def api_export_my_responses(user=Depends(get_current_user)):
    conn = db.connect()
    rows = db.q(conn, """SELECT r.answered_at, s.name AS skill, i.stem, r.choice_index, r.correct, r.time_spent, COALESCE(r.error_type,'') AS error_type
                            FROM responses r
                            JOIN items i ON r.item_id=i.id
                            JOIN skills s ON i.skill_id=s.id
                            WHERE r.user_id=?
                            ORDER BY r.answered_at""", (user["id"],))
    conn.close()

    def gen():
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["answered_at","skill","stem","choice_index","correct","time_spent","error_type"])
        for r in rows:
            w.writerow([r["answered_at"], r["skill"], r["stem"], r["choice_index"], r["correct"], r["time_spent"], r["error_type"]])
        yield out.getvalue().encode("utf-8")

    headers = {"Content-Disposition": f"attachment; filename=my_responses_{user['username']}.csv"}
    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8", headers=headers)

@app.post("/api/reset/my_data")
def api_reset_my_data(user=Depends(get_current_user)):
    conn = db.connect()
    # delete responses
    db.exec(conn, "DELETE FROM responses WHERE user_id=?", (user["id"],))
    # reset mastery to 0.2
    db.exec(conn, "UPDATE mastery SET p_mastery=?, updated_at=? WHERE user_id=?", (0.2, now(), user["id"]))
    # reset theta
    db.exec(conn, "UPDATE ability SET theta=?, updated_at=? WHERE user_id=?", (0.0, now(), user["id"]))
    db.exec(conn, "DELETE FROM ability_history WHERE user_id=?", (user["id"],))
    db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (user["id"], 0.0, now()))
    conn.close()
    audit(user["id"], "reset_my_data", {})
    return {"ok": True}

# -------------------- Admin / Instructor --------------------
def admin_guard(user) -> None:
    try:
        require_role(user, {"admin","instructor"})
    except PermissionError:
        raise HTTPException(status_code=403, detail="需要管理员/教员权限")

@app.get("/api/admin/metrics")
def api_admin_metrics(user=Depends(get_current_user)):
    admin_guard(user)
    snap = metrics.snapshot()
    # db stats
    conn = db.connect()
    c_users = db.one(conn, "SELECT COUNT(*) AS c FROM users")["c"]
    c_items = db.one(conn, "SELECT COUNT(*) AS c FROM items")["c"]
    c_resp = db.one(conn, "SELECT COUNT(*) AS c FROM responses")["c"]
    conn.close()

    try:
        db_path = db.DB_PATH
        size = db_path.stat().st_size if db_path.exists() else 0
    except Exception:
        size = 0

    return {
        **snap,
        "db": {
            "users": int(c_users),
            "items": int(c_items),
            "responses": int(c_resp),
            "size_kb": int(size/1024),
        }
    }

@app.get("/api/admin/audit")
def api_admin_audit(limit: int = 50, user=Depends(get_current_user)):
    admin_guard(user)
    limit = max(10, min(200, int(limit)))
    conn = db.connect()
    rows = db.q(conn, """SELECT a.at, a.action, a.detail_json, u.username
                            FROM audit_log a LEFT JOIN users u ON a.user_id=u.id
                            ORDER BY a.at DESC LIMIT ?""", (limit,))
    conn.close()
    out = []
    for r in rows:
        try:
            detail = json.loads(r["detail_json"])
        except Exception:
            detail = {"raw": r["detail_json"]}
        out.append({"at": r["at"], "action": r["action"], "user": r["username"] or "-", "detail": detail})
    return {"logs": out}

# ----- Admin: Items -----
@app.get("/api/admin/items")
def api_admin_items(search: str = "", skill_id: str = "", page: int = 1, page_size: int = 20, user=Depends(get_current_user)):
    admin_guard(user)
    page = max(1, int(page))
    page_size = max(5, min(50, int(page_size)))
    search = (search or "").strip()
    skill_id = (skill_id or "").strip()

    where = ["1=1"]
    params: List[Any] = []
    if search:
        where.append("i.stem LIKE ?")
        params.append(f"%{search}%")
    if skill_id:
        where.append("i.skill_id=?")
        params.append(skill_id)

    conn = db.connect()
    total = db.one(conn, f"SELECT COUNT(*) AS c FROM items i WHERE {' AND '.join(where)}", tuple(params))["c"]
    rows = db.q(conn, f"""SELECT i.id, i.stem, i.skill_id, s.name AS skill_name, i.a, i.b, i.enabled,
                                   COALESCE(m.qtype,'single') AS qtype,
                                   COALESCE(m.difficulty,2) AS difficulty,
                                   COALESCE(m.tags_json,'[]') AS tags_json
                            FROM items i JOIN skills s ON i.skill_id=s.id
                            LEFT JOIN item_meta m ON m.item_id=i.id
                            WHERE {' AND '.join(where)}
                            ORDER BY i.id DESC
                            LIMIT ? OFFSET ?""", tuple(params + [page_size, (page-1)*page_size]))
    conn.close()
    return {
        "page": page,
        "page_size": page_size,
        "total": int(total),
        "items": [
            {
                "id": int(r["id"]),
                "stem": r["stem"],
                "skill_id": r["skill_id"],
                "skill_name": r["skill_name"],
                "a": float(r["a"]),
                "b": float(r["b"]),
                "enabled": bool(r["enabled"]),
                "qtype": r["qtype"],
                "difficulty": int(r["difficulty"] or 2),
                "tags": json.loads(r["tags_json"]) if r["tags_json"] else [],
            } for r in rows
        ],
    }

class ItemIn(BaseModel):
    stem: str
    skill_id: str
    choices: List[str]
    answer_key: int
    a: float = 1.0
    b: float = 0.0
    enabled: bool = True

@app.post("/api/admin/items")
def api_admin_create_item(data: ItemIn, user=Depends(get_current_user)):
    admin_guard(user)
    if len(data.choices) < 2:
        raise HTTPException(status_code=400, detail="choices 至少2个")
    if not (0 <= data.answer_key < len(data.choices)):
        raise HTTPException(status_code=400, detail="answer_key 超出范围")

    conn = db.connect()
    # ensure skill exists
    s = db.one(conn, "SELECT id FROM skills WHERE id=?", (data.skill_id,))
    if not s:
        db.exec(conn, "INSERT INTO skills(id, name) VALUES(?,?)", (data.skill_id, data.skill_id))
    item_id = db.exec(conn, """INSERT INTO items(stem, choices_json, answer_key, skill_id, a, b, c, enabled, created_at)
                                 VALUES(?,?,?,?,?,?,0.0,?,?)""", (data.stem, json.dumps(data.choices, ensure_ascii=False),
                                                                    data.answer_key, data.skill_id, float(data.a), float(data.b),
                                                                    1 if data.enabled else 0, now()))
    conn.close()
    audit(user["id"], "admin_create_item", {"item_id": item_id})
    return {"ok": True, "id": item_id}

@app.get("/api/admin/items/{item_id}")
def api_admin_get_item(item_id: int, user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    r = db.one(conn, "SELECT * FROM items WHERE id=?", (int(item_id),))
    conn.close()
    if not r:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "id": int(r["id"]),
        "stem": r["stem"],
        "skill_id": r["skill_id"],
        "choices": json.loads(r["choices_json"]),
        "answer_key": int(r["answer_key"]),
        "a": float(r["a"]),
        "b": float(r["b"]),
        "enabled": bool(r["enabled"]),
    }

@app.get("/api/admin/items/{item_id}/meta")
def api_admin_get_item_meta(item_id: int, user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    it = db.one(conn, "SELECT id FROM items WHERE id=?", (int(item_id),))
    if not it:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    m = db.one(conn, "SELECT * FROM item_meta WHERE item_id=?", (int(item_id),))
    conn.close()
    if not m:
        return {"item_id": int(item_id), "qtype": "single", "difficulty": 2, "tags": [], "explanation": None, "voice_script": None}
    try:
        tags = json.loads(m["tags_json"]) if m["tags_json"] else []
    except Exception:
        tags = []
    return {
        "item_id": int(item_id),
        "qtype": m["qtype"] or "single",
        "difficulty": int(m["difficulty"] or 2),
        "tags": tags,
        "explanation": m["explanation"],
        "voice_script": m["voice_script"],
        "updated_at": m["updated_at"],
    }

@app.put("/api/admin/items/{item_id}/meta")
def api_admin_put_item_meta(item_id: int, data: ItemMetaIn, user=Depends(get_current_user)):
    admin_guard(user)
    qtype = data.qtype if data.qtype in ("single", "judge", "case", "multi_mock", "order_mock") else "single"
    tags_json = json.dumps([t.strip() for t in (data.tags or []) if t and t.strip()], ensure_ascii=False)
    conn = db.connect()
    it = db.one(conn, "SELECT id FROM items WHERE id=?", (int(item_id),))
    if not it:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    ex = db.one(conn, "SELECT 1 FROM item_meta WHERE item_id=?", (int(item_id),))
    if ex:
        db.exec(conn, """UPDATE item_meta SET qtype=?, difficulty=?, tags_json=?, explanation=?, voice_script=?, updated_at=? WHERE item_id=?""",
                (qtype, int(data.difficulty), tags_json, data.explanation, data.voice_script, now(), int(item_id)))
    else:
        db.exec(conn, """INSERT INTO item_meta(item_id, qtype, difficulty, tags_json, explanation, voice_script, updated_at)
                   VALUES(?,?,?,?,?,?,?)""",
                (int(item_id), qtype, int(data.difficulty), tags_json, data.explanation, data.voice_script, now()))
    conn.close()
    audit(user["id"], "admin_item_meta", {"item_id": int(item_id), "qtype": qtype})
    return {"ok": True}

@app.put("/api/admin/items/{item_id}")
def api_admin_update_item(item_id: int, data: ItemIn, user=Depends(get_current_user)):
    admin_guard(user)
    if len(data.choices) < 2:
        raise HTTPException(status_code=400, detail="choices 至少2个")
    if not (0 <= data.answer_key < len(data.choices)):
        raise HTTPException(status_code=400, detail="answer_key 超出范围")

    conn = db.connect()
    r = db.one(conn, "SELECT id FROM items WHERE id=?", (int(item_id),))
    if not r:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    db.exec(conn, """UPDATE items SET stem=?, choices_json=?, answer_key=?, skill_id=?, a=?, b=?, enabled=?
                        WHERE id=?""", (data.stem, json.dumps(data.choices, ensure_ascii=False), data.answer_key,
                                          data.skill_id, float(data.a), float(data.b), 1 if data.enabled else 0, int(item_id)))
    conn.close()
    audit(user["id"], "admin_update_item", {"item_id": int(item_id)})
    return {"ok": True}

@app.delete("/api/admin/items/{item_id}")
def api_admin_delete_item(item_id: int, user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    r = db.one(conn, "SELECT id FROM items WHERE id=?", (int(item_id),))
    if not r:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    db.exec(conn, "DELETE FROM items WHERE id=?", (int(item_id),))
    conn.close()
    audit(user["id"], "admin_delete_item", {"item_id": int(item_id)})
    return {"ok": True}

@app.post("/api/admin/items/import_csv")
async def api_admin_import_csv(file: UploadFile = File(...), user=Depends(get_current_user)):
    admin_guard(user)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except Exception:
        text = content.decode("utf-8", errors="ignore")
    reader = csv.reader(io.StringIO(text))
    inserted = 0
    skipped = 0
    conn = db.connect()
    for row in reader:
        if not row or len(row) < 6:
            continue
        skill_id, stem, choices_s, answer_key_s, a_s, b_s = [c.strip() for c in row[:6]]
        if not stem:
            continue
        # ensure skill
        s = db.one(conn, "SELECT id FROM skills WHERE id=?", (skill_id,))
        if not s:
            db.exec(conn, "INSERT INTO skills(id, name) VALUES(?,?)", (skill_id, skill_id))
        # skip dup stem
        ex = db.one(conn, "SELECT id FROM items WHERE stem=?", (stem,))
        if ex:
            skipped += 1
            continue
        choices = [c.strip() for c in choices_s.split("|") if c.strip()]
        if len(choices) < 2:
            skipped += 1
            continue
        try:
            answer_key = int(answer_key_s)
            a = float(a_s)
            b = float(b_s)
        except Exception:
            skipped += 1
            continue
        if not (0 <= answer_key < len(choices)):
            skipped += 1
            continue
        db.exec(conn, """INSERT INTO items(stem, choices_json, answer_key, skill_id, a, b, c, enabled, created_at)
                            VALUES(?,?,?,?,?,?,0.0,1,?)""", (stem, json.dumps(choices, ensure_ascii=False), answer_key,
                                                               skill_id, a, b, now()))
        inserted += 1
    conn.close()
    audit(user["id"], "admin_import_csv", {"inserted": inserted, "skipped": skipped})
    return {"ok": True, "inserted": inserted, "skipped": skipped}

@app.get("/api/admin/export/responses.csv")
def api_admin_export_all(user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    rows = db.q(conn, """SELECT r.answered_at, u.username, s.name AS skill, i.stem, r.choice_index, r.correct, r.time_spent, COALESCE(r.error_type,'') AS error_type
                            FROM responses r
                            JOIN users u ON r.user_id=u.id
                            JOIN items i ON r.item_id=i.id
                            JOIN skills s ON i.skill_id=s.id
                            ORDER BY r.answered_at""")
    conn.close()
    def gen():
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["answered_at","username","skill","stem","choice_index","correct","time_spent","error_type"])
        for r in rows:
            w.writerow([r["answered_at"], r["username"], r["skill"], r["stem"], r["choice_index"], r["correct"], r["time_spent"], r["error_type"]])
        yield out.getvalue().encode("utf-8")
    headers = {"Content-Disposition": "attachment; filename=all_responses.csv"}
    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8", headers=headers)

@app.get("/api/admin/db/backup")
def api_admin_db_backup(user=Depends(get_current_user)):
    admin_guard(user)
    path = db.DB_PATH
    if not path.exists():
        raise HTTPException(status_code=404, detail="db not found")
    audit(user["id"], "admin_db_backup", {})
    return FileResponse(str(path), filename=f"armedu_backup_{dt.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.db")

@app.post("/api/admin/reset/all_data")
def api_admin_reset_all(user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    # keep users/items/skills; clear learning traces
    db.exec(conn, "DELETE FROM responses")
    db.exec(conn, "DELETE FROM ability_history")
    db.exec(conn, "UPDATE mastery SET p_mastery=?, updated_at=?", (0.2, now()))
    db.exec(conn, "UPDATE ability SET theta=?, updated_at=?", (0.0, now()))
    # reinsert ability_history baseline for each user
    urows = db.q(conn, "SELECT id FROM users")
    for u in urows:
        db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (int(u["id"]), 0.0, now()))
    conn.close()
    audit(user["id"], "admin_reset_all_data", {})
    return {"ok": True}

# ----- Admin: Users -----
@app.get("/api/admin/users")
def api_admin_users(user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    rows = db.q(conn, """SELECT u.id, u.username, u.role, u.created_at,
                                   (SELECT theta FROM ability a WHERE a.user_id=u.id) AS theta,
                                   (SELECT COUNT(*) FROM responses r WHERE r.user_id=u.id) AS answered
                            FROM users u ORDER BY u.id""")
    conn.close()
    return {"users": [
        {
            "id": int(r["id"]),
            "username": r["username"],
            "role": r["role"],
            "created_at": r["created_at"],
            "theta": float(r["theta"] or 0.0),
            "answered": int(r["answered"] or 0),
        } for r in rows
    ]}

class AdminCreateUserIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=64)
    role: str = "trainee"

@app.post("/api/admin/users")
def api_admin_create_user(data: AdminCreateUserIn, user=Depends(get_current_user)):
    admin_guard(user)
    role = data.role if data.role in ("trainee","instructor","admin") else "trainee"
    conn = db.connect()
    ex = db.one(conn, "SELECT id FROM users WHERE username=?", (data.username,))
    if ex:
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已存在")
    uid = db.exec(conn, "INSERT INTO users(username, password_hash, role, created_at) VALUES(?,?,?,?)",
                 (data.username, hash_password(data.password), role, now()))
    # init mastery/ability
    skills = db.q(conn, "SELECT id FROM skills")
    for s in skills:
        db.exec(conn, "INSERT INTO mastery(user_id, skill_id, p_mastery, updated_at) VALUES(?,?,?,?)",
                (uid, s["id"], 0.20, now()))
    db.exec(conn, "INSERT INTO ability(user_id, theta, updated_at) VALUES(?,?,?)", (uid, 0.0, now()))
    db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (uid, 0.0, now()))
    conn.close()
    audit(user["id"], "admin_create_user", {"created_user": data.username, "role": role})
    return {"ok": True, "id": uid}

class AdminUpdateUserIn(BaseModel):
    role: Optional[str] = None
    new_password: Optional[str] = None

@app.put("/api/admin/users/{uid}")
def api_admin_update_user(uid: int, data: AdminUpdateUserIn, user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    ex = db.one(conn, "SELECT id FROM users WHERE id=?", (int(uid),))
    if not ex:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    if data.role:
        role = data.role if data.role in ("trainee","instructor","admin") else None
        if role:
            db.exec(conn, "UPDATE users SET role=? WHERE id=?", (role, int(uid)))
    if data.new_password:
        db.exec(conn, "UPDATE users SET password_hash=? WHERE id=?", (hash_password(data.new_password), int(uid)))
    conn.close()
    audit(user["id"], "admin_update_user", {"uid": int(uid), "role": data.role, "pwd_reset": bool(data.new_password)})
    return {"ok": True}

@app.delete("/api/admin/users/{uid}")
def api_admin_delete_user(uid: int, user=Depends(get_current_user)):
    admin_guard(user)
    if int(uid) == int(user["id"]):
        raise HTTPException(status_code=400, detail="不能删除自己")
    conn = db.connect()
    ex = db.one(conn, "SELECT id FROM users WHERE id=?", (int(uid),))
    if not ex:
        conn.close()
        raise HTTPException(status_code=404, detail="not found")
    db.exec(conn, "DELETE FROM users WHERE id=?", (int(uid),))
    conn.close()
    audit(user["id"], "admin_delete_user", {"uid": int(uid)})
    return {"ok": True}

# ----- Admin: Recalibrate -----
@app.post("/api/admin/recalibrate")
def api_admin_recalibrate(user=Depends(get_current_user)):
    admin_guard(user)
    conn = db.connect()
    # For each item, collect (theta, u)
    items = db.q(conn, "SELECT id, a, b FROM items")
    updated = 0
    for it in items:
        item_id = int(it["id"])
        a = float(it["a"])
        b0 = float(it["b"])
        # join responses with theta history approx: use user's current theta at answer time = latest before answer (rough)
        # 简化：用用户当前 theta 近似
        data = db.q(conn, """SELECT (SELECT theta FROM ability WHERE user_id=r.user_id) AS theta, r.correct AS u
                                FROM responses r WHERE r.item_id=?""", (item_id,))
        pairs = []
        for r in data:
            th = float(r["theta"] or 0.0)
            u = int(r["u"] or 0)
            pairs.append((th, u))
        if len(pairs) < 6:
            continue
        b_new = recalibrate_item_b(a, b0, pairs, lr=0.05, steps=60)
        if abs(b_new - b0) > 1e-3:
            db.exec(conn, "UPDATE items SET b=? WHERE id=?", (b_new, item_id))
            updated += 1
    conn.close()
    audit(user["id"], "admin_recalibrate", {"updated_items": updated})
    return {"ok": True, "updated_items": updated}
