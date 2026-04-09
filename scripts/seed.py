from __future__ import annotations
import datetime as dt
import json
import random
from typing import List, Tuple, Optional, Dict, Any

from app import db
from app.security import hash_password
from app.microcourse import ensure_demo_lessons_and_videos

def now() -> str:
    return dt.datetime.utcnow().isoformat()

def ensure_user(conn, username: str, password: str, role: str):
    row = db.one(conn, "SELECT id FROM users WHERE username=?", (username,))
    if row:
        return int(row["id"])
    uid = db.exec(conn, "INSERT INTO users(username, password_hash, role, created_at) VALUES(?,?,?,?)",
                 (username, hash_password(password), role, now()))
    return uid

def ensure_skill(conn, sid: str, name: str):
    row = db.one(conn, "SELECT id FROM skills WHERE id=?", (sid,))
    if row:
        return
    db.exec(conn, "INSERT INTO skills(id, name) VALUES(?,?)", (sid, name))

def ensure_item(conn, stem: str, skill_id: str, choices: List[str], answer_key: int, a: float, b: float):
    row = db.one(conn, "SELECT id FROM items WHERE stem=?", (stem,))
    if row:
        item_id = int(row["id"])
    else:
        item_id = int(db.exec(conn, """INSERT INTO items(stem, choices_json, answer_key, skill_id, a, b, c, enabled, created_at)
                                 VALUES(?,?,?,?,?,?,0.0,1,?)""", (stem, json.dumps(choices, ensure_ascii=False), answer_key, skill_id, a, b, now())))
    # add default meta if missing (non-destructive)
    r2 = db.one(conn, "SELECT item_id FROM item_meta WHERE item_id=?", (item_id,))
    if not r2:
        db.exec(conn, """INSERT INTO item_meta(item_id, qtype, difficulty, tags_json, explanation, voice_script, updated_at)
                           VALUES(?,?,?,?,?,?,?)""",
                (item_id, "single", 2, "[]", None, None, now()))
    return item_id

def ensure_item_meta(conn, item_id: int, qtype: str = "single", difficulty: int = 2, tags: Optional[List[str]] = None,
                     explanation: Optional[str] = None, voice_script: Optional[str] = None):
    """Insert meta if missing; if exists, only fill blanks."""
    tags = tags or []
    row = db.one(conn, "SELECT qtype, difficulty, tags_json, explanation, voice_script FROM item_meta WHERE item_id=?", (item_id,))
    if not row:
        db.exec(conn, """INSERT INTO item_meta(item_id, qtype, difficulty, tags_json, explanation, voice_script, updated_at)
                           VALUES(?,?,?,?,?,?,?)""",
                (item_id, qtype, int(difficulty), json.dumps(tags, ensure_ascii=False), explanation, voice_script, now()))
        return
    # patch-missing fields only
    cur_tags = []
    try:
        cur_tags = json.loads(row["tags_json"] or "[]")
    except Exception:
        cur_tags = []
    new_tags = cur_tags or tags
    new_explain = row["explanation"] or explanation
    new_voice = row["voice_script"] or voice_script
    new_qtype = row["qtype"] or qtype
    new_diff = int(row["difficulty"] or difficulty)
    db.exec(conn, """UPDATE item_meta SET qtype=?, difficulty=?, tags_json=?, explanation=?, voice_script=?, updated_at=? WHERE item_id=?""",
            (new_qtype, new_diff, json.dumps(new_tags, ensure_ascii=False), new_explain, new_voice, now(), item_id))

def ensure_lesson(conn, skill_id: str, title: str, content_md: str, resources: Optional[List[Dict[str, Any]]] = None):
    resources = resources or []
    row = db.one(conn, "SELECT skill_id FROM lessons WHERE skill_id=?", (skill_id,))
    if row:
        return
    db.exec(conn, """INSERT INTO lessons(skill_id, title, content_md, resources_json, updated_at)
                       VALUES(?,?,?,?,?)""", (skill_id, title, content_md, json.dumps(resources, ensure_ascii=False), now()))

def ensure_mastery_for_user(conn, user_id: int):
    skills = db.q(conn, "SELECT id FROM skills")
    for s in skills:
        sid = s["id"]
        row = db.one(conn, "SELECT p_mastery FROM mastery WHERE user_id=? AND skill_id=?", (user_id, sid))
        if not row:
            db.exec(conn, "INSERT INTO mastery(user_id, skill_id, p_mastery, updated_at) VALUES(?,?,?,?)",
                    (user_id, sid, 0.20, now()))

def ensure_ability_for_user(conn, user_id: int):
    row = db.one(conn, "SELECT theta FROM ability WHERE user_id=?", (user_id,))
    if not row:
        db.exec(conn, "INSERT INTO ability(user_id, theta, updated_at) VALUES(?,?,?)", (user_id, 0.0, now()))
        db.exec(conn, "INSERT INTO ability_history(user_id, theta, at) VALUES(?,?,?)", (user_id, 0.0, now()))

def gen_questions() -> List[Tuple[str, str, List[str], int]]:
    """返回 list of (skill_id, stem, choices, answer_key)。
    题库方向：B（国防教育/军事理论），避免任何危险/操作性细节，只做概念/规范/原则层面的题。
    """
    random.seed(42)

    skills_points = {
        "ch1_law": [
            ("依法治军", "强调以法律和制度规范军队建设与管理"),
            ("纪律要求", "强调遵守组织纪律与命令体系，确保行动一致"),
            ("保密原则", "遵循分级管理、最小必要、留痕可审计"),
            ("权责边界", "明确职责分工与授权范围，避免越权与失责"),
            ("合规流程", "强调按程序办事并保留必要记录与证据"),
            ("国防动员法", "规范国防动员的组织实施与公民义务"),
            ("军队条令", "用于规范军人日常行为与内务秩序"),
            ("教育训练条例", "强调训练组织管理、质量评估与安全保障"),
        ],
        "ch2_security": [
            ("总体国家安全观", "强调统筹发展和安全，覆盖多领域安全"),
            ("风险治理", "强调识别-评估-处置-复盘的闭环管理"),
            ("信息安全", "强调机密性、完整性、可用性与合规"),
            ("舆情素养", "强调辨识信息源、避免谣言传播与情绪化判断"),
            ("应急响应", "强调预案、演练、分级处置与协同联动"),
            ("安全责任制", "强调谁主管谁负责、谁使用谁负责"),
            ("安全教育", "强调常态化学习与案例复盘"),
            ("边界意识", "强调线上线下、工作生活的边界与自我约束"),
        ],
        "ch3_history": [
            ("军事史学习", "强调以史为鉴，理解战争规律与战略思维"),
            ("人民战争", "强调依靠人民群众与整体动员"),
            ("国防观念", "强调国家主权、安全与发展利益的维护"),
            ("战略文化", "强调历史经验对战略选择的影响"),
            ("典型战例", "强调从战例中提炼决策方法而非细节复刻"),
            ("历史虚无主义辨析", "强调尊重史实、证据与多源校验"),
            ("英雄精神", "强调价值引领与行为示范"),
            ("国防科技发展史", "强调技术演进与体系化建设观念"),
        ],
        "ch4_build": [
            ("政治建军", "强调思想引领、组织纪律与作风建设"),
            ("组织管理", "强调目标、分工、协同与考核闭环"),
            ("作风纪律", "强调求真务实、反对形式主义"),
            ("人才培养", "强调能力模型、梯队建设与持续学习"),
            ("训练质量", "强调标准化、过程监控与复盘改进"),
            ("沟通协同", "强调信息对称、及时反馈与责任到人"),
            ("领导力", "强调决策、激励与风险控制能力"),
            ("廉洁自律", "强调底线思维与制度约束"),
        ],
        "ch5_mobilize": [
            ("国防动员", "强调平战结合、体系筹划与资源统筹"),
            ("应急管理", "强调预案、演练、处置、恢复全周期"),
            ("协同机制", "强调跨部门协同与信息共享"),
            ("后勤保障概念", "强调保障体系与资源管理"),
            ("演练评估", "强调演练后的指标评估与改进计划"),
            ("突发事件处置原则", "强调依法、科学、快速、协同"),
            ("社会动员", "强调公众参与与规范组织"),
            ("韧性建设", "强调冗余、备份与持续恢复能力"),
        ],
        "ch6_theory": [
            ("战略与战术", "战略关注全局目标与资源配置，战术关注局部行动方法"),
            ("作战体系", "强调体系对抗与综合效能"),
            ("信息主导", "强调信息优势对决策与协同的支撑"),
            ("制胜机理", "强调优势聚合、节奏控制与决策质量"),
            ("训练与实战衔接", "强调以能力为牵引的训练设计"),
            ("指挥控制", "强调态势感知、决策、协同与反馈"),
            ("兵棋推演", "强调在规则化环境中检验方案与风险"),
            ("决策方法", "强调目标-方案-评估-选择的结构化过程"),
        ],
        "ch7_inform": [
            ("信息化战争概念", "强调体系化、信息化与联合作战思维"),
            ("网络空间安全素养", "强调合规、风险意识与防护习惯"),
            ("智能化趋势", "强调人机协同与伦理规范"),
            ("数据治理", "强调数据质量、权限控制与可追溯"),
            ("模型偏差", "强调理解模型局限与数据分布差异"),
            ("可解释性", "强调让决策依据可理解可审计"),
            ("训练数据安全", "强调脱敏、授权与最小化"),
            ("人因工程", "强调降低认知负荷与减少误操作"),
        ],
        "ch8_ethics": [
            ("国际法基本原则", "强调尊重主权、遵守国际规则"),
            ("人道主义原则", "强调减少不必要伤害与保护平民"),
            ("军事伦理", "强调正当性、比例性与责任意识"),
            ("信息伦理", "强调真实、透明、可追责"),
            ("合规审计", "强调过程可追溯与问责机制"),
            ("宣传与信息发布", "强调依法依规、避免误导"),
            ("规则意识", "强调制度边界与风险红线"),
            ("职业素养", "强调敬业、诚信与团队协作"),
        ],
    }

    patterns = [
        ("关于【{concept}】的理解，哪项更符合规范？", "{correct}", [
            "完全由个人经验决定，无需制度约束",
            "只追求速度，不必考虑合规与风险",
            "可以为了方便随意变更流程且不留记录",
        ]),
        ("下列做法中，最符合【{concept}】要求的是？", "{correct}", [
            "把重要信息随意转发到公共群以便协作",
            "遇到不确定情况先跳过流程，事后再补",
            "认为制度可有可无，按个人习惯处理",
        ]),
        ("【{concept}】的核心强调点更接近以下哪项？", "{correct}", [
            "强调个人偏好优先于组织规则",
            "强调不做任何记录以减少工作量",
            "强调无需复盘与改进，只要完成即可",
        ]),
    ]

    qs: List[Tuple[str, str, List[str], int]] = []
    for sid, points in skills_points.items():
        for concept, correct in points:
            for pat in patterns:
                stem_tpl, correct_tpl, wrongs = pat
                stem = stem_tpl.format(concept=concept)
                correct_opt = correct_tpl.format(correct=correct)
                options = [correct_opt] + random.sample(wrongs, k=3)  # 1 correct + 3 wrong
                random.shuffle(options)
                answer_key = options.index(correct_opt)
                qs.append((sid, stem, options, answer_key))

    # 控制总量：每章约 8(点) * 3(模式) = 24 题；8章=192题
    return qs

def main():
    db.init_db()
    conn = db.connect()

    # skills
    skills = [
        ("ch1_law", "第1章 国防法规与纪律"),
        ("ch2_security", "第2章 国家安全与总体安全观"),
        ("ch3_history", "第3章 军事历史与国防常识"),
        ("ch4_build", "第4章 军队建设与作风"),
        ("ch5_mobilize", "第5章 国防动员与应急"),
        ("ch6_theory", "第6章 军事理论基础"),
        ("ch7_inform", "第7章 信息化与智能化趋势"),
        ("ch8_ethics", "第8章 军事伦理与国际法素养"),
    ]
    for sid, name in skills:
        ensure_skill(conn, sid, name)

    # users
    uid_admin = ensure_user(conn, "admin", "admin123", "admin")
    uid_trainee = ensure_user(conn, "trainee", "trainee123", "trainee")

    # ensure mastery/ability
    for uid in (uid_admin, uid_trainee):
        ensure_mastery_for_user(conn, uid)
        ensure_ability_for_user(conn, uid)

    # items
    questions = gen_questions()
    for sid, stem, choices, answer_key in questions:
        a = round(random.uniform(0.85, 1.45), 2)
        b = round(random.uniform(-1.2, 1.2), 2)
        ensure_item(conn, stem, sid, choices, answer_key, a, b)

    # demo lessons / AI animated micro-courses
    ensure_demo_lessons_and_videos(conn, now)

    conn.close()
    print("Seed finished.")
    print("Default accounts: trainee/trainee123 , admin/admin123")
    print("Question count (expected):", len(questions))

if __name__ == "__main__":
    main()
