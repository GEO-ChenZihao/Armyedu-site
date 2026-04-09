from __future__ import annotations
import hashlib
import secrets
import datetime as dt
from typing import Optional

from . import db

def now() -> str:
    return dt.datetime.utcnow().isoformat()

def hash_password(password: str, salt: Optional[str] = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${dk.hex()}"

def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, salt, hexhash = password_hash.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        check = hash_password(password, salt)
        return secrets.compare_digest(check, password_hash)
    except Exception:
        return False

def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn = db.connect()
    db.exec(conn, "INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)", (token, user_id, now()))
    conn.close()
    return token

def delete_session(token: str) -> None:
    conn = db.connect()
    db.exec(conn, "DELETE FROM sessions WHERE token=?", (token,))
    conn.close()

def get_user_by_token(token: str):
    conn = db.connect()
    row = db.one(conn, """SELECT u.id, u.username, u.role, s.created_at
                            FROM sessions s JOIN users u ON s.user_id = u.id
                            WHERE s.token = ?""", (token,))
    # optional TTL (hours): ARMEDU_SESSION_TTL_HOURS
    try:
        ttl_h = float((__import__("os").environ.get("ARMEDU_SESSION_TTL_HOURS", "") or "").strip())
    except Exception:
        ttl_h = 0.0
    if row and ttl_h and ttl_h > 0:
        try:
            created = dt.datetime.fromisoformat(row["created_at"])
            if (dt.datetime.utcnow() - created).total_seconds() > ttl_h * 3600:
                db.exec(conn, "DELETE FROM sessions WHERE token=?", (token,))
                row = None
        except Exception:
            pass
    conn.close()
    return row

def require_role(user, allowed: set[str]) -> None:
    if user is None or user["role"] not in allowed:
        raise PermissionError("insufficient permission")
