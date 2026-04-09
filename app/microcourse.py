from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

# 课程配色与图标：用于前端动画课程展示
COURSE_THEME: Dict[str, Dict[str, str]] = {
    "ch1_law": {"accent": "#4f7cff", "icon": "⚖️"},
    "ch2_security": {"accent": "#2ab7ca", "icon": "🛡️"},
    "ch3_history": {"accent": "#47a772", "icon": "📚"},
    "ch4_build": {"accent": "#8a63d2", "icon": "🧭"},
    "ch5_mobilize": {"accent": "#d08a32", "icon": "🚨"},
    "ch6_theory": {"accent": "#4f7cff", "icon": "🎯"},
    "ch7_inform": {"accent": "#5b8def", "icon": "💡"},
    "ch8_ethics": {"accent": "#6d7c96", "icon": "🌍"},
}

DEMO_LESSONS: Dict[str, Dict[str, str]] = {
    "ch1_law": {
        "title": "第1章 国防法规与纪律微课",
        "content_md": """## 学习目标\n- 理解依法治军、纪律要求与保密原则的基本含义\n- 能区分“按流程办事”和“凭经验处理”的差别\n- 建立规则意识、边界意识和留痕意识\n\n## 核心概念\n### 依法治军\n- 强调以法律和制度规范军队建设与管理\n- 核心不是增加流程，而是让职责、权限和责任更清晰\n- 面对复杂情境时，先看规定，再做判断\n\n### 纪律要求\n- 纪律是统一行动和高效执行的前提\n- 重点包括服从命令、按级请示、按程序处理\n- 纪律不是束缚，而是保证整体效率的基础\n\n### 保密原则\n- 坚持分级管理、最小必要、过程留痕\n- 不能因为“方便协作”就随意扩散信息\n- 对不确定的信息，应先确认范围与授权\n\n## 常见误区\n- 误以为经验丰富就可以跳过流程\n- 误以为内部交流可以不考虑保密边界\n- 误以为只要结果正确，过程是否合规并不重要\n\n## 学习口诀\n- 先看规定，再做动作；先明权限，再谈效率；先留记录，再做流转。\n\n## 小结\n本章的重点不在记忆条文细节，而在形成规则意识。面对任务时，既要重视效率，也要遵守制度边界。""",
    },
    "ch2_security": {
        "title": "第2章 国家安全与总体安全观微课",
        "content_md": """## 学习目标\n- 理解总体国家安全观的基本内涵\n- 掌握风险识别、分级处置与复盘的基本思路\n- 形成信息安全与责任安全的基本习惯\n\n## 核心概念\n### 总体国家安全观\n- 强调统筹发展和安全，覆盖政治、经济、军事、科技、社会等多个领域\n- 安全问题往往不是单点问题，而是系统性问题\n- 学习中要建立“全局看安全”的思维方式\n\n### 风险治理\n- 一个完整闭环通常包括识别、评估、处置和复盘\n- 仅仅发现问题还不够，更重要的是形成可执行的处置方案\n- 复盘的作用是避免同类问题重复出现\n\n### 信息安全与责任制\n- 信息安全强调机密性、完整性和可用性\n- 责任制强调谁主管谁负责、谁使用谁负责\n- 安全工作不是单独部门的任务，而是所有参与者共同承担\n\n## 常见误区\n- 把安全理解成“出了问题以后再处理”\n- 只重视技术手段，忽视流程规范和责任边界\n- 认为安全教育是阶段任务，而不是日常习惯\n\n## 小结\n本章强调的不是抽象口号，而是通过风险闭环和责任意识，把安全真正落到具体行为上。""",
    },
    "ch3_history": {
        "title": "第3章 军事历史与国防常识微课",
        "content_md": """## 学习目标\n- 了解军事史学习在国防教育中的意义\n- 能从历史材料中提炼规律，而不是停留在事件记忆\n- 形成正确的国防观念与历史观\n\n## 核心内容\n### 以史为鉴\n- 军事历史的学习价值在于总结规律、理解决策和认识代价\n- 同一历史事件可以从战略、组织、技术和精神多个角度分析\n- 学历史不是背故事，而是学会观察问题的方法\n\n### 国防观念\n- 国防不仅是军队建设问题，也与国家安全、社会稳定和人民责任相关\n- 国防观念强调居安思危、整体意识和长期建设\n- 国防教育的目标之一是提升责任意识与公共意识\n\n### 英雄精神与史实辨析\n- 学习英雄精神重在理解信念、责任和行动力\n- 面对历史信息时要尊重事实、证据和多源校验\n- 既不能片面神化，也不能随意否定历史价值\n\n## 学习方法\n- 先梳理背景，再看过程，最后总结规律\n- 尝试把一个战例概括成“目标—条件—选择—结果”四步\n\n## 小结\n本章重在帮助学习者通过历史理解国防常识，建立更稳固的价值判断与分析能力。""",
    },
    "ch4_build": {
        "title": "第4章 军队建设与作风微课",
        "content_md": """## 学习目标\n- 理解政治建军、组织管理和作风纪律的基本要求\n- 掌握“目标—分工—执行—反馈”的组织运行思路\n- 认识作风建设在训练质量中的实际作用\n\n## 核心内容\n### 政治建军\n- 核心是思想引领、组织纪律和价值统一\n- 它决定队伍在复杂环境下能否保持方向一致\n\n### 组织管理\n- 管理不是简单分任务，而是明确目标、分工和反馈机制\n- 一个高质量组织需要责任到人、流程清楚、信息畅通\n\n### 作风纪律\n- 作风体现为求真务实、执行有力、重视标准\n- 纪律体现为服从、协同、守规矩\n- 二者共同影响训练质量和组织效能\n\n## 常见问题\n- 分工有了，但责任边界不清\n- 任务完成了，但缺少复盘与改进\n- 过程看似忙碌，但实际标准不统一\n\n## 小结\n本章重点在于理解军队建设不是单点工作，而是思想、组织、纪律和作风共同作用的结果。""",
    },
    "ch5_mobilize": {
        "title": "第5章 国防动员与应急微课",
        "content_md": """## 学习目标\n- 理解国防动员与应急管理的基本思路\n- 掌握预案、演练、处置和恢复的基本流程\n- 建立协同机制和韧性建设意识\n\n## 核心内容\n### 国防动员\n- 国防动员强调平战结合、统一筹划和资源统筹\n- 它不是临时动作，而是长期准备和机制建设\n\n### 应急管理\n- 应急管理一般包括预案准备、监测预警、分级处置和恢复总结\n- 关键在于“平时有方案，事发有秩序，事后有复盘”\n\n### 协同与保障\n- 动员和应急都离不开跨部门协作与信息共享\n- 后勤保障、资源配置和角色分工决定响应效率\n\n## 常见误区\n- 只重视应急处置，不重视预案和演练\n- 认为有预案就够了，忽视实际推演和评估\n- 协同停留在口头，缺少责任清单与流程接口\n\n## 小结\n本章强调“准备比反应更重要”。真正高质量的动员与应急体系，必须建立在长期准备和协同机制之上。""",
    },
    "ch6_theory": {
        "title": "第6章 军事理论基础微课",
        "content_md": """## 学习目标\n- 区分战略、战术、作战体系等基本概念\n- 理解信息主导、体系对抗和决策质量的关系\n- 掌握从理论走向训练设计的基本思路\n\n## 核心内容\n### 战略与战术\n- 战略关注全局目标与资源配置\n- 战术关注具体行动方法与局部实施\n- 二者层次不同，但必须相互衔接\n\n### 作战体系与信息主导\n- 现代条件下更强调体系对抗而不是单点能力\n- 信息优势会影响感知、判断、协同和行动节奏\n- 理解体系化思维，是学习军事理论的重要基础\n\n### 训练与实战衔接\n- 理论学习的目的之一，是指导训练设计和能力建设\n- 训练不能只看题量，还要看目标是否清晰、难度是否匹配、反馈是否及时\n\n## 学习提示\n- 先分清概念层次，再理解它们之间的关系\n- 把理论概念放到“目标—条件—行动—反馈”框架中理解会更清楚\n\n## 小结\n本章重在帮助学习者建立概念框架，为后续训练、分析和推演打下基础。""",
    },
    "ch7_inform": {
        "title": "第7章 信息化与智能化趋势微课",
        "content_md": """## 学习目标\n- 了解信息化、智能化在现代训练中的基本趋势\n- 掌握数据治理、可解释性与模型偏差等基础概念\n- 建立人机协同和风险防控意识\n\n## 核心内容\n### 信息化与智能化\n- 信息化强调数据、网络和协同支撑\n- 智能化强调模型、算法和辅助决策能力\n- 二者都服务于效率提升，但不能脱离规则和场景边界\n\n### 数据治理\n- 数据治理关注数据质量、权限边界和全流程可追溯\n- 数据不是越多越好，关键是可用、可信、可控\n\n### 模型偏差与可解释性\n- 模型会受到训练数据、场景变化和规则约束的影响\n- 可解释性有助于理解“系统为什么给出这样的建议”\n- 在教育场景中，可解释性直接关系到学习者是否愿意信任系统反馈\n\n## 小结\n本章强调技术趋势必须与责任意识、规则意识和使用边界结合起来理解。""",
    },
    "ch8_ethics": {
        "title": "第8章 军事伦理与国际法素养微课",
        "content_md": """## 学习目标\n- 理解军事伦理、人道主义原则和国际法基本要求\n- 建立规则意识、责任意识和职业素养\n- 认识信息发布、行为选择与伦理边界之间的关系\n\n## 核心内容\n### 人道主义原则\n- 强调减少不必要伤害、保护平民和遵守基本规则\n- 学习这一部分的重点是理解边界，而不是记忆口号\n\n### 军事伦理\n- 军事伦理关注正当性、比例性和责任意识\n- 在复杂情境下，越需要明确底线与规则\n\n### 信息伦理与职业素养\n- 信息发布应当真实、审慎、依法依规\n- 职业素养强调敬业、诚信、协同和责任担当\n\n## 常见误区\n- 把伦理理解成附属要求，而不是基本约束\n- 只重结果，不重行为边界\n- 认为规则意识会影响效率，忽视长期风险\n\n## 小结\n本章的价值在于帮助学习者把规则意识、伦理判断和职业行为结合起来理解。""",
    },
}


def default_lesson_resources(skill_id: str) -> List[Dict[str, Any]]:
    return [
        {"type": "reading", "label": "文字微课", "skill_id": skill_id},
        {"type": "animated_course", "label": "AI动画微课", "skill_id": skill_id},
    ]



def _clean_line(text: str) -> str:
    t = re.sub(r"^#+\s*", "", text or "").strip()
    t = re.sub(r"^[-*]\s*", "", t).strip()
    t = re.sub(r"^\d+[.)、]\s*", "", t).strip()
    return t



def parse_lesson_sections(content_md: str) -> List[Dict[str, Any]]:
    """将 markdown 文本切成若干节，供离线动画课程使用。"""
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    def ensure_current(title: str) -> Dict[str, Any]:
        nonlocal current
        if current is None:
            current = {"title": title, "bullets": [], "text": []}
        return current

    for raw in (content_md or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("## ") or line.startswith("### "):
            if current and (current["bullets"] or current["text"]):
                sections.append(current)
            current = {"title": _clean_line(line), "bullets": [], "text": []}
            continue
        cur = ensure_current("重点内容")
        if line.startswith("- ") or line.startswith("* "):
            cur["bullets"].append(_clean_line(line))
        elif re.match(r"^\d+[.)、]", line):
            cur["bullets"].append(_clean_line(line))
        else:
            cur["text"].append(_clean_line(line))
    if current and (current["bullets"] or current["text"]):
        sections.append(current)
    return sections



def _take(xs: List[str], n: int = 3) -> List[str]:
    out: List[str] = []
    for x in xs:
        x = (x or "").strip()
        if x and x not in out:
            out.append(x)
        if len(out) >= n:
            break
    return out



def _summary_sentence(sections: List[Dict[str, Any]]) -> str:
    heads = [s["title"] for s in sections if s.get("title")]
    if not heads:
        return "本节课重点梳理核心概念、易错点和训练提示。"
    if len(heads) == 1:
        return f"本节课围绕“{heads[0]}”展开，最后会给出训练提示。"
    return f"本节课依次讲解“{heads[0]}”“{heads[1]}”等重点内容，并补充易错点与复盘建议。"


def _scene_visual_type(title: str, layout: str, idx: int) -> str:
    t = (title or "")
    if idx == 1 or layout == "intro":
        return "concept_map"
    if "目标" in t:
        return "goal_map"
    if "误区" in t:
        return "compare_board"
    if "小结" in t or layout == "summary":
        return "summary_board"
    if "方法" in t or "步骤" in t or "提示" in t:
        return "step_ladder"
    return "bullet_ladder"


def _scene_equation(skill_id: str, title: str) -> str:
    if skill_id == "ch6_theory":
        return "战略 → 战术 → 行动 → 反馈"
    if skill_id == "ch5_mobilize":
        return "预案 → 监测 → 处置 → 恢复"
    if skill_id == "ch2_security":
        return "识别 → 评估 → 处置 → 复盘"
    if skill_id == "ch7_inform":
        return "数据治理 = 质量 + 权限 + 追溯"
    if skill_id == "ch8_ethics":
        return "规则意识 + 责任意识 + 边界意识"
    if "依法" in title or skill_id == "ch1_law":
        return "规则 → 权限 → 流程 → 留痕"
    return "概念 → 易错点 → 训练巩固"



def build_offline_storyboard(skill_id: str, skill_name: str, title: str, content_md: str) -> Dict[str, Any]:
    sections = parse_lesson_sections(content_md)
    theme = COURSE_THEME.get(skill_id, {"accent": "#4f7cff", "icon": "🎬"})
    intro_bullets = []
    if sections:
        intro_bullets.extend(sections[0].get("bullets") or [])
    if len(intro_bullets) < 3 and len(sections) > 1:
        intro_bullets.extend(sections[1].get("bullets") or [])
    intro_bullets = _take(intro_bullets, 3)
    if not intro_bullets:
        intro_bullets = ["先建立概念框架", "再区分易错点", "最后进入专项训练"]

    scenes: List[Dict[str, Any]] = [
        {
            "scene_no": 1,
            "title": title,
            "subtitle": f"{skill_name} · AI 动画微课",
            "bullets": intro_bullets,
            "narration": _summary_sentence(sections),
            "duration_sec": 12,
            "accent": theme["accent"],
            "icon": theme["icon"],
            "layout": "intro",
            "visual_type": "concept_map",
            "equation": _scene_equation(skill_id, title),
            "visual": {"nodes": intro_bullets[:3]},
        }
    ]

    for sec in sections[:4]:
        bullets = _take(sec.get("bullets") or sec.get("text") or [], 4)
        if not bullets:
            continue
        text_line = "；".join(_take(sec.get("text") or [], 2))
        narration = text_line or f"这一部分重点理解“{sec['title']}”的基本含义和应用边界。"
        layout = "bullet"
        visual_type = _scene_visual_type(sec["title"], layout, len(scenes) + 1)
        scenes.append(
            {
                "scene_no": len(scenes) + 1,
                "title": sec["title"],
                "subtitle": f"{skill_name} · 核心知识点",
                "bullets": bullets,
                "narration": narration,
                "duration_sec": 15,
                "accent": theme["accent"],
                "icon": theme["icon"],
                "layout": layout,
                "visual_type": visual_type,
                "equation": _scene_equation(skill_id, sec["title"]),
                "visual": {"nodes": bullets[:4], "section": sec["title"]},
            }
        )

    review_points: List[str] = []
    for sec in sections:
        review_points.extend(sec.get("bullets") or [])
    review_points = _take(review_points, 3)
    if not review_points:
        review_points = ["理解本章核心概念", "区分常见易错点", "完成 3-5 题专项训练"]

    scenes.append(
        {
            "scene_no": len(scenes) + 1,
            "title": "本节课小结",
            "subtitle": "学完后建议立刻进入训练巩固",
            "bullets": review_points,
            "narration": "建议学习完成后，先做一组小题快速检验掌握情况，再根据错题继续复盘。",
            "duration_sec": 12,
            "accent": theme["accent"],
            "icon": "✅",
            "layout": "summary",
            "visual_type": "summary_board",
            "equation": _scene_equation(skill_id, "本节课小结"),
            "visual": {"nodes": review_points[:3]},
        }
    )

    duration_sec = sum(int(s.get("duration_sec") or 12) for s in scenes)
    summary = scenes[0]["narration"] if scenes else "AI 动画微课"
    return {
        "title": title,
        "summary": summary,
        "duration_sec": duration_sec,
        "scene_count": len(scenes),
        "style": "animated_storyboard",
        "source": "offline_template",
        "poster_text": f"{skill_name} / {len(scenes)} 个场景 / 约 {max(1, round(duration_sec/60))} 分钟",
        "scenes": scenes,
    }



def ensure_demo_lessons_and_videos(conn, now_func) -> None:
    """为演示环境补齐 lessons 与 lesson_videos。对已有数据只做非破坏性补全。"""
    for sid, payload in DEMO_LESSONS.items():
        skill = conn.execute("SELECT id, name FROM skills WHERE id=?", (sid,)).fetchone()
        if not skill:
            continue
        lesson = conn.execute("SELECT skill_id, resources_json FROM lessons WHERE skill_id=?", (sid,)).fetchone()
        resources_json = json.dumps(default_lesson_resources(sid), ensure_ascii=False)
        if not lesson:
            conn.execute(
                "INSERT INTO lessons(skill_id, title, content_md, resources_json, updated_at) VALUES(?,?,?,?,?)",
                (sid, payload["title"], payload["content_md"], resources_json, now_func()),
            )
        else:
            try:
                current_res = json.loads(lesson["resources_json"] or "[]")
            except Exception:
                current_res = []
            labels = {str(x.get("label") or x.get("type") or "") for x in current_res if isinstance(x, dict)}
            if "AI动画微课" not in labels:
                current_res.extend(default_lesson_resources(sid))
                dedup: List[Dict[str, Any]] = []
                seen: set[str] = set()
                for item in current_res:
                    if not isinstance(item, dict):
                        continue
                    key = f"{item.get('type')}::{item.get('label')}"
                    if key in seen:
                        continue
                    seen.add(key)
                    dedup.append(item)
                conn.execute(
                    "UPDATE lessons SET resources_json=?, updated_at=? WHERE skill_id=?",
                    (json.dumps(dedup, ensure_ascii=False), now_func(), sid),
                )

        lv = conn.execute("SELECT skill_id, source, storyboard_json FROM lesson_videos WHERE skill_id=?", (sid,)).fetchone()
        story = build_offline_storyboard(sid, skill["name"], payload["title"], payload["content_md"])
        should_refresh = False
        if lv:
            try:
                existing_scenes = json.loads(lv["storyboard_json"] or "[]")
            except Exception:
                existing_scenes = []
            first_scene = existing_scenes[0] if existing_scenes and isinstance(existing_scenes[0], dict) else {}
            should_refresh = str(lv["source"] or "") == "offline_template" or (not first_scene.get("visual_type"))
        if not lv:
            conn.execute(
                """INSERT INTO lesson_videos(skill_id, title, summary, script_text, storyboard_json,
                   poster_text, duration_sec, status, source, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    sid,
                    story["title"],
                    story["summary"],
                    payload["content_md"],
                    json.dumps(story["scenes"], ensure_ascii=False),
                    story["poster_text"],
                    int(story["duration_sec"]),
                    "ready",
                    story["source"],
                    now_func(),
                ),
            )
        elif should_refresh:
            conn.execute(
                """UPDATE lesson_videos
                   SET title=?, summary=?, script_text=?, storyboard_json=?, poster_text=?, duration_sec=?, status=?, source=?, updated_at=?
                   WHERE skill_id=?""",
                (
                    story["title"],
                    story["summary"],
                    payload["content_md"],
                    json.dumps(story["scenes"], ensure_ascii=False),
                    story["poster_text"],
                    int(story["duration_sec"]),
                    "ready",
                    story["source"],
                    now_func(),
                    sid,
                ),
            )
    conn.commit()



def extract_json_payload(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    raw = text.strip()
    # strip fenced block
    m = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", raw, re.S)
    if m:
        raw = m.group(1).strip()
    else:
        # try to locate first JSON object
        m2 = re.search(r"(\{.*\})", raw, re.S)
        if m2:
            raw = m2.group(1).strip()
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None



def normalize_storyboard(skill_id: str, skill_name: str, title: str, content_md: str, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    fallback = build_offline_storyboard(skill_id, skill_name, title, content_md)
    if not payload:
        return fallback
    scenes = payload.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return fallback
    theme = COURSE_THEME.get(skill_id, {"accent": "#4f7cff", "icon": "🎬"})
    fixed_scenes: List[Dict[str, Any]] = []
    for i, s in enumerate(scenes[:6], start=1):
        if not isinstance(s, dict):
            continue
        bullets = s.get("bullets") if isinstance(s.get("bullets"), list) else []
        bullets = _take([str(x) for x in bullets], 4)
        layout = str(s.get("layout") or "bullet")
        title_i = str(s.get("title") or f"场景{i}")[:30]
        fixed_scenes.append(
            {
                "scene_no": i,
                "title": title_i,
                "subtitle": str(s.get("subtitle") or skill_name)[:48],
                "bullets": bullets or ["请结合本章内容理解核心概念"],
                "narration": str(s.get("narration") or "请结合本场景要点完成学习")[:220],
                "duration_sec": max(8, min(24, int(s.get("duration_sec") or 14))),
                "accent": str(s.get("accent") or theme["accent"]),
                "icon": str(s.get("icon") or theme["icon"]),
                "layout": layout,
                "visual_type": str(s.get("visual_type") or _scene_visual_type(title_i, layout, i)),
                "equation": str(s.get("equation") or _scene_equation(skill_id, title_i))[:120],
                "visual": s.get("visual") if isinstance(s.get("visual"), dict) else {"nodes": bullets[:4]},
            }
        )
    if not fixed_scenes:
        return fallback
    duration_sec = sum(int(x["duration_sec"]) for x in fixed_scenes)
    return {
        "title": str(payload.get("title") or title)[:60],
        "summary": str(payload.get("summary") or fallback["summary"])[:240],
        "duration_sec": duration_sec,
        "scene_count": len(fixed_scenes),
        "style": "animated_storyboard",
        "source": str(payload.get("source") or "external_ai"),
        "poster_text": str(payload.get("poster_text") or f"{skill_name} / {len(fixed_scenes)} 个场景 / 约 {max(1, round(duration_sec/60))} 分钟")[:80],
        "scenes": fixed_scenes,
    }



def _safe_class_name(seed: str) -> str:
    raw = re.sub(r'[^0-9A-Za-z]+', ' ', str(seed or 'Scene')).title().replace(' ', '')
    if not raw:
        raw = 'Scene'
    if raw[0].isdigit():
        raw = f'Scene{raw}'
    return raw



def _visual_desc_from_scene(scene: Dict[str, Any]) -> str:
    visual_type = str(scene.get('visual_type') or 'concept_map')
    title = str(scene.get('title') or '当前场景')
    mapping = {
        'concept_map': '展示中心主题与分支节点，适合课程导入与概念总览',
        'goal_map': '以目标卡片方式展示学习目标与重点要求',
        'compare_board': '左右对比展示常见误区与正确做法',
        'summary_board': '展示课程小结、复盘建议与训练入口',
        'step_ladder': '按步骤阶梯逐步展开方法和流程',
        'bullet_ladder': '按要点依次出现知识点并配合讲解',
    }
    detail = mapping.get(visual_type, f'围绕“{title}”展示结构化知识点与板书动画')
    visual = scene.get('visual') if isinstance(scene.get('visual'), dict) else {}
    nodes = visual.get('nodes') if isinstance(visual.get('nodes'), list) else []
    if nodes:
        detail += '；重点节点：' + '、'.join(str(x) for x in nodes[:3])
    return detail



def _student_question_for_scene(title: str, idx: int, total: int) -> str:
    t = str(title or '')
    if idx == 1:
        return '这一节课先学什么？我应该先建立什么知识框架？'
    if '目标' in t:
        return '这里最重要的学习目标是什么？做题时应该抓住哪几点？'
    if '误区' in t:
        return '这一部分最容易错在哪里？怎样避免只记结论不理解原因？'
    if '方法' in t or '步骤' in t or '提示' in t:
        return '这部分有没有一个稳定的解题顺序，可以让我直接迁移到练习里？'
    if '小结' in t or idx == total:
        return '学完这一章后，我应该怎样复盘，并马上进入训练巩固？'
    return '这一幕的核心概念是什么？我在理解时最应该关注哪里？'



def _manim_code_preview(scene: Dict[str, Any], class_name: str, scene_type: str = 'Scene') -> str:
    title = str(scene.get('title') or '知识点')
    subtitle = str(scene.get('subtitle') or '')
    bullets = [str(x) for x in (scene.get('bullets') or [])[:4]]
    equation = str(scene.get('equation') or '')
    visual_type = str(scene.get('visual_type') or 'concept_map')
    bullet_code = "\n".join(
        f"        Text({json.dumps('• ' + b, ensure_ascii=False)}, font_size=28, color=TEXT_COLOR)"
        for b in bullets
    ) or "        Text('• 讲解要点', font_size=28, color=TEXT_COLOR)"
    lines = [
        'from manim import *',
        '',
        f'class {class_name}({scene_type}):',
        '    def construct(self):',
        f'        title = Text({json.dumps(title, ensure_ascii=False)}, font_size=40)',
        f'        subtitle = Text({json.dumps(subtitle, ensure_ascii=False)}, font_size=24).next_to(title, DOWN)',
        '        bullet_group = VGroup(',
        bullet_code,
        '        ).arrange(DOWN, aligned_edge=LEFT, buff=0.32)',
        '        bullet_group.next_to(subtitle, DOWN, buff=0.5).to_edge(LEFT, buff=0.8)',
    ]
    if equation:
        lines.extend([
            f'        formula = MathTex({json.dumps(equation, ensure_ascii=False)}, font_size=34).to_edge(RIGHT, buff=0.8)',
            '        self.play(FadeIn(formula, shift=UP*0.2))',
        ])
    lines.extend([
        '        self.play(FadeIn(title, shift=UP*0.2), FadeIn(subtitle, shift=UP*0.2))',
        '        self.play(LaggedStart(*[FadeIn(m, shift=RIGHT*0.1) for m in bullet_group], lag_ratio=0.15))',
        f'        # visual_type = {visual_type}',
        f'        # narration = {json.dumps(str(scene.get("narration") or ""), ensure_ascii=False)}',
        '        self.wait(0.8)',
    ])
    return "\n".join(lines)



def build_animation_package(skill_id: str, skill_name: str, title: str,
                            content_md: str, scenes: List[Dict[str, Any]]) -> Dict[str, Any]:
    theme = COURSE_THEME.get(skill_id, {'accent': '#4f7cff', 'icon': '🎬'})
    scene_type = 'ThreeDScene' if any('3d' in str(s.get('visual_type') or '').lower() for s in scenes) else 'Scene'
    safe_prefix = _safe_class_name(skill_id or title)
    dual_agent_rounds: List[Dict[str, Any]] = []
    manim_blueprints: List[Dict[str, Any]] = []
    voiceover_script: List[Dict[str, Any]] = []
    total = max(1, len(scenes))

    for idx, scene in enumerate(scenes, start=1):
        visual_desc = _visual_desc_from_scene(scene)
        teacher_text = f"先讲‘{scene.get('title') or f'场景{idx}'}’。" + '；'.join(str(x) for x in (scene.get('bullets') or [])[:3])
        student_text = _student_question_for_scene(str(scene.get('title') or ''), idx, total)
        voice_text = str(scene.get('narration') or teacher_text)
        image_desc = visual_desc
        dual_agent_rounds.append({
            'scene_no': idx,
            'teacher': teacher_text[:220],
            'student': student_text[:180],
            'goal': str(((scene.get('bullets') or ['理解本幕核心知识点'])[0]))[:80],
            'voiceText': voice_text[:220],
            'voiceRole': 'teacher' if idx < total else 'teacher_summary',
            'imageDesc': image_desc[:220],
        })
        class_name = f"{safe_prefix}Scene{idx}"
        code_preview = _manim_code_preview(scene, class_name, scene_type)
        manim_blueprints.append({
            'scene_no': idx,
            'class_name': class_name,
            'scene_type': scene_type,
            'voiceText': voice_text[:220],
            'voiceRole': 'teacher' if idx < total else 'teacher_summary',
            'imageDesc': image_desc[:220],
            'manim_hint': f"使用 {scene.get('visual_type') or 'concept_map'} 生成板书/图形动画，并保持与前一幕的 current_code 连续性。",
            'code_preview': code_preview,
            'validation': [
                'AST 语法检查',
                '参数与版式优化',
                '末帧试渲染校验',
                '失败后按规则修复',
            ],
        })
        voiceover_script.append({
            'scene_no': idx,
            'voice_role': 'teacher',
            'subtitle': str(scene.get('subtitle') or skill_name)[:80],
            'tts_text': voice_text[:220],
        })

    pipeline = [
        {
            'step': 1,
            'name': '双智能体内容设计',
            'desc': '教师智能体组织讲解主线，学生智能体补充追问，先得到 voiceText / voiceRole / imageDesc 中间表示。',
        },
        {
            'step': 2,
            'name': '结构化分镜接口',
            'desc': '按 JSON 场景拆解标题、要点、旁白与 visual_type，对应论文中的标准化接口输出。',
        },
        {
            'step': 3,
            'name': 'Manim 代码生成',
            'desc': '结合 global_config、visual_type 与 current_code 上下文，生成可执行的 Manim 场景代码。',
        },
        {
            'step': 4,
            'name': '静态检查与参数优化',
            'desc': '检查 AST、组件参数、字号、布局与动画时长，减少内容拥挤和视觉断层。',
        },
        {
            'step': 5,
            'name': '运行时验证与修复',
            'desc': '先做末帧试渲染；如有异常，再按模式修复、上下文修复、重构代码三级策略处理。',
        },
        {
            'step': 6,
            'name': '配音、字幕与渲染',
            'desc': '根据 narration 生成 TTS 旁白与字幕时间轴，最终合成为可播放动画视频。',
        },
    ]

    return {
        'mode': 'paper_based_manim_pipeline',
        'global_config': {
            'scene_type': scene_type,
            'fps': 30,
            'resolution': '1280x720',
            'theme_accent': theme.get('accent', '#4f7cff'),
            'continuity_strategy': 'current_code',
            'subtitle_mode': 'tts_timeline',
            'voice_roles': {'teacher': '讲解老师', 'student': '追问学生'},
        },
        'interface_spec': {
            'transport': 'json',
            'scene_fields': ['voiceText', 'voiceRole', 'imageDesc'],
            'example': dual_agent_rounds[0] if dual_agent_rounds else {'voiceText': '', 'voiceRole': 'teacher', 'imageDesc': ''},
        },
        'pipeline': pipeline,
        'dual_agent_rounds': dual_agent_rounds,
        'voiceover_script': voiceover_script,
        'manim_blueprints': manim_blueprints,
        'quality_checks': [
            '场景时长控制在 8-24 秒，适合微课节奏',
            '公式与标题分栏，避免中文逐字竖排',
            '采用 current_code 保持场景连贯性',
            '支持后续接入 SVG、图片、TTS 与字幕插件',
        ],
        'content_digest': _summary_sentence(parse_lesson_sections(content_md)) if content_md else '根据章节内容自动生成动画讲解包。',
    }
