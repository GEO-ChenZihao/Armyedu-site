from __future__ import annotations
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable, List, Optional, Tuple

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "armedu.db"
DB_PATH = Path(os.environ.get("ARMEDU_DB_PATH", str(DEFAULT_DB)))

def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    # 更可用的并发与稳定性配置
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn

def init_db() -> None:
    conn = connect()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'trainee',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions(
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS skills(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS items(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stem TEXT NOT NULL,
            choices_json TEXT NOT NULL,
            answer_key INTEGER NOT NULL,
            skill_id TEXT NOT NULL,
            a REAL NOT NULL DEFAULT 1.0,
            b REAL NOT NULL DEFAULT 0.0,
            c REAL NOT NULL DEFAULT 0.0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS responses(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            correct INTEGER NOT NULL,
            choice_index INTEGER NOT NULL,
            time_spent REAL NOT NULL DEFAULT 0.0,
            error_type TEXT,
            answered_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS mastery(
            user_id INTEGER NOT NULL,
            skill_id TEXT NOT NULL,
            p_mastery REAL NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(user_id, skill_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ability(
            user_id INTEGER PRIMARY KEY,
            theta REAL NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ability_history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            theta REAL NOT NULL,
            at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_log(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            detail_json TEXT NOT NULL,
            at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        -- -------------------- Extended modules (non-breaking additions) --------------------
        CREATE TABLE IF NOT EXISTS item_meta(
            item_id INTEGER PRIMARY KEY,
            qtype TEXT NOT NULL DEFAULT 'single',
            difficulty INTEGER NOT NULL DEFAULT 2,
            tags_json TEXT NOT NULL DEFAULT '[]',
            explanation TEXT,
            voice_script TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lessons(
            skill_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_md TEXT NOT NULL,
            resources_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lesson_progress(
            user_id INTEGER NOT NULL,
            skill_id TEXT NOT NULL,
            completed_count INTEGER NOT NULL DEFAULT 0,
            last_at TEXT NOT NULL,
            PRIMARY KEY(user_id, skill_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lesson_videos(
            skill_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            script_text TEXT NOT NULL DEFAULT '',
            storyboard_json TEXT NOT NULL DEFAULT '[]',
            poster_text TEXT NOT NULL DEFAULT '',
            duration_sec INTEGER NOT NULL DEFAULT 120,
            status TEXT NOT NULL DEFAULT 'ready',
            source TEXT NOT NULL DEFAULT 'offline_template',
            updated_at TEXT NOT NULL,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lesson_video_progress(
            user_id INTEGER NOT NULL,
            skill_id TEXT NOT NULL,
            progress REAL NOT NULL DEFAULT 0.0,
            watched_sec REAL NOT NULL DEFAULT 0.0,
            completed INTEGER NOT NULL DEFAULT 0,
            last_scene INTEGER NOT NULL DEFAULT 1,
            last_at TEXT NOT NULL,
            PRIMARY KEY(user_id, skill_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_notes(
            user_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            note TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(user_id, item_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_achievements(
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            unlocked_at TEXT NOT NULL,
            PRIMARY KEY(user_id, code),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_items_skill ON items(skill_id);
        CREATE INDEX IF NOT EXISTS idx_items_enabled ON items(enabled);
        CREATE INDEX IF NOT EXISTS idx_resp_user ON responses(user_id);
        CREATE INDEX IF NOT EXISTS idx_resp_item ON responses(item_id);
        CREATE INDEX IF NOT EXISTS idx_resp_time ON responses(answered_at);
        CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at);

        CREATE INDEX IF NOT EXISTS idx_item_meta_qtype ON item_meta(qtype);
        CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
        CREATE INDEX IF NOT EXISTS idx_lesson_video_progress_user ON lesson_video_progress(user_id);
        CREATE INDEX IF NOT EXISTS idx_lesson_video_status ON lesson_videos(status);
        CREATE INDEX IF NOT EXISTS idx_user_notes_user ON user_notes(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_ach_user ON user_achievements(user_id);
        """
    )
    conn.commit()
    conn.close()

def q(conn: sqlite3.Connection, sql: str, params: Tuple[Any, ...] = ()) -> List[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()

def one(conn: sqlite3.Connection, sql: str, params: Tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
    return conn.execute(sql, params).fetchone()

def exec(conn: sqlite3.Connection, sql: str, params: Tuple[Any, ...] = ()) -> int:
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid
