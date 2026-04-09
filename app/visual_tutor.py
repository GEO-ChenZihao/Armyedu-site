from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Optional


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def extract_json_payload(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    raw = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", raw, re.S)
    if m:
        raw = m.group(1).strip()
    else:
        m2 = re.search(r"(\{.*\})", raw, re.S)
        if m2:
            raw = m2.group(1).strip()
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _scene(
    title: str,
    subtitle: str,
    bullets: List[str],
    narration: str,
    duration_sec: int,
    visual_type: str,
    accent: str,
    equation: str = "",
    visual: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "title": title[:40],
        "subtitle": subtitle[:64],
        "bullets": [str(x)[:60] for x in bullets[:4]],
        "narration": narration[:240],
        "duration_sec": max(8, min(22, int(duration_sec or 12))),
        "visual_type": visual_type,
        "accent": accent,
        "equation": equation[:120],
        "visual": visual or {},
    }


def _infer_domain(question: str, subject: str = "auto") -> str:
    s = _clean_text(question).lower()
    if subject and subject != "auto":
        if subject in ("math", "数学"):
            # allow more specific detection even under math
            if "fourier" in s or "傅里叶" in question:
                return "fourier"
            if any(k in question for k in ["三角", "正弦", "余弦", "正切"]) or any(k in s for k in ["sin", "cos", "tan"]):
                return "trig"
            return "math"
        if subject in ("physics", "物理"):
            if any(k in question for k in ["抛体", "平抛"]) or "projectile" in s:
                return "projectile"
            if any(k in question for k in ["简谐", "振动", "波动"]) or "harmonic" in s:
                return "shm"
            return "physics"
    if "fourier" in s or "傅里叶" in question or "谐波" in question:
        return "fourier"
    if any(k in question for k in ["三角函数", "三角", "正弦", "余弦", "正切", "单位圆"]) or any(k in s for k in ["sin", "cos", "tan", "trig"]):
        return "trig"
    if any(k in question for k in ["抛体", "平抛", "斜抛", "抛射"]) or any(k in s for k in ["projectile", "parabola"]):
        return "projectile"
    if any(k in question for k in ["简谐", "振动", "弹簧", "波动", "频率", "周期"]) or any(k in s for k in ["harmonic", "oscillation", "period"]):
        return "shm"
    if any(k in question for k in ["牛顿", "动量", "能量", "电场", "磁场", "电路", "速度", "加速度", "力学"]) or any(k in s for k in ["force", "energy", "momentum", "velocity", "acceleration", "circuit"]):
        return "physics"
    return "math"


def _build_fourier(question: str) -> Dict[str, Any]:
    accent = "#8a63d2"
    scenes = [
        _scene(
            "傅里叶级数的核心想法",
            "把复杂周期函数拆成若干正弦余弦波",
            [
                "先确认函数是周期函数",
                "再判断奇偶性，决定保留哪些项",
                "最后再计算各阶系数",
            ],
            "这一类题的关键不是死记公式，而是先看周期、奇偶性和对称性。这样很多系数可以直接判零，后面的计算就会轻很多。",
            12,
            "fourier_intro",
            accent,
            "f(x)=a0/2+Σ(an cos nx + bn sin nx)",
            {"cycles": 1},
        ),
        _scene(
            "先写出通用展开式",
            "把题目放到统一公式框架里",
            [
                "确定周期 T 与基本角频率 ω0",
                "列出 a0、an、bn 的积分表达式",
                "利用对称性减少计算量",
            ],
            "真正解题时，建议先把 a0、an、bn 的表达式写出来，再根据奇偶性和分段区间一步步化简。",
            14,
            "equation_board",
            accent,
            "a_n=2/T∫f(x)cos(nω0x)dx,  b_n=2/T∫f(x)sin(nω0x)dx",
            {"highlight": "coefficients"},
        ),
        _scene(
            "动画看逼近过程",
            "奇次谐波逐步叠加，图像越来越接近原函数",
            [
                "先看 1 项近似",
                "再增加到 3 项、5 项、7 项",
                "观察拐点附近的振荡现象",
            ],
            "随着谐波数增加，逼近会越来越好，但在跳变点附近仍会出现振荡，这就是常见的 Gibbs 现象。",
            16,
            "fourier_plot",
            accent,
            "f(x)≈(4/π)(sin x + 1/3 sin3x + 1/5 sin5x + …)",
            {"series": "square_like", "max_harmonics": 9},
        ),
        _scene(
            "答题步骤总结",
            "把公式、性质和计算顺序串起来",
            [
                "第一步：定周期与奇偶性",
                "第二步：写积分并化简",
                "第三步：代回级数并说明收敛结论",
            ],
            "考试中最稳的做法是先判断性质，再算系数，最后写出级数并说明在间断点取左右极限平均值。",
            12,
            "step_board",
            accent,
            "四步：周期 → 性质 → 系数 → 级数",
            {"steps": 3},
        ),
    ]
    return {
        "title": "动态讲题：傅里叶级数",
        "summary": "通过公式板书与图像逼近动画，解释傅里叶级数的建模和解题步骤。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "傅里叶级数 / 图像逼近 / 公式推导",
        "scenes": scenes,
    }


def _build_trig(question: str) -> Dict[str, Any]:
    accent = "#2ab7ca"
    eq = "y = A sin(ωx + φ) + b"
    scenes = [
        _scene(
            "先从单位圆理解三角函数",
            "图像变化要回到几何含义",
            [
                "sin 对应纵坐标",
                "cos 对应横坐标",
                "角度变化会映射成周期图像",
            ],
            "讲三角函数时，不要一上来就套图像。先回到单位圆，弄清楚正弦、余弦分别表示什么，后面振幅、周期和相位才不会混。",
            12,
            "unit_circle",
            accent,
            "sin x, cos x",
            {"mode": "sin"},
        ),
        _scene(
            "再看图像怎样变化",
            "振幅、周期、相位、上下平移依次分析",
            [
                "A 决定振幅大小",
                "ω 决定周期 T=2π/ω",
                "φ 决定左右平移",
                "b 决定整体上移下移",
            ],
            "解题时建议按振幅、周期、相位、平移这四个维度逐个分析，不要把参数变化混在一起。",
            16,
            "trig_plot",
            accent,
            eq,
            {"amplitude": 1.3, "omega": 1.2, "phase": 0.7, "offset": 0.2},
        ),
        _scene(
            "题目如何落到步骤上",
            "先读条件，再锁定参数",
            [
                "读极值点或零点",
                "判断周期与相位",
                "最后列式验证",
            ],
            "很多题都会给你极值、零点或单调区间。只要把这些条件转换成参数信息，就能逐步把式子还原出来。",
            12,
            "step_board",
            accent,
            eq,
            {"steps": 3},
        ),
        _scene(
            "最后做一个小结",
            "把图像信息反推回函数表达式",
            [
                "图像是函数性质的直观表达",
                "参数变化对应确定的图像变化",
                "会看图，就更容易会列式",
            ],
            "三角函数题并不只是记公式，关键是建立图像和解析式之间的双向转换。",
            10,
            "summary_board",
            accent,
            eq,
            {"focus": "graph_to_formula"},
        ),
    ]
    return {
        "title": "动态讲题：三角函数",
        "summary": "通过单位圆、动态图像和参数变化讲解三角函数题。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "三角函数 / 单位圆 / 动态图像",
        "scenes": scenes,
    }


def _build_projectile(question: str) -> Dict[str, Any]:
    accent = "#d08a32"
    scenes = [
        _scene(
            "先做水平与竖直分解",
            "抛体运动本质上是两个方向的合成",
            [
                "水平方向：匀速运动",
                "竖直方向：匀加速运动",
                "合成后得到轨迹",
            ],
            "物理题里，最重要的是先把运动拆开。只要分清哪个方向速度恒定，哪个方向受重力影响，方程就会很清楚。",
            12,
            "projectile_plot",
            accent,
            "x=v0 cosθ·t,  y=v0 sinθ·t - 1/2 gt²",
            {"v0": 8.0, "angle_deg": 52, "g": 9.8},
        ),
        _scene(
            "常用公式板书",
            "时间、射程和最高点三类量最常见",
            [
                "先找时间条件",
                "再代入水平位移",
                "最高点由 vy=0 求得",
            ],
            "考试中很多抛体题都是围绕时间、位移、最高点展开。先把时间找出来，往往后面的问题都会顺着解决。",
            13,
            "equation_board",
            accent,
            "t_up=v0 sinθ/g,  H=(v0² sin²θ)/(2g)",
            {"highlight": "time_height"},
        ),
        _scene(
            "解题顺序建议",
            "已知什么，就从对应方向入手",
            [
                "给时间先写 y 或 x 方程",
                "给高度先用竖直方向",
                "给射程则联立时间与水平位移",
            ],
            "不要急着列一堆公式。先看题目给的是时间、高度还是水平距离，然后优先选择最直接的方向方程。",
            11,
            "step_board",
            accent,
            "分解 → 选方程 → 代入 → 校验单位",
            {"steps": 4},
        ),
    ]
    return {
        "title": "动态讲题：抛体运动",
        "summary": "通过轨迹动画与公式板书解释抛体运动的分解思路。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "抛体运动 / 轨迹动画 / 分步建模",
        "scenes": scenes,
    }


def _build_shm(question: str) -> Dict[str, Any]:
    accent = "#47a772"
    scenes = [
        _scene(
            "先抓住简谐振动三要素",
            "振幅、周期、相位是核心",
            [
                "振幅 A 决定最大偏移",
                "周期 T 决定重复快慢",
                "相位 φ 决定初始状态",
            ],
            "简谐振动题最怕把振幅、周期和相位混起来。只要先抓住这三项，后面位移、速度和加速度关系就能一步步推出来。",
            12,
            "shm_plot",
            accent,
            "x=A cos(ωt+φ)",
            {"amplitude": 1.0, "omega": 1.4, "phase": 0.6},
        ),
        _scene(
            "再看位移、速度、加速度关系",
            "相位错位是这类题的高频点",
            [
                "位移与速度相差 π/2",
                "速度与加速度也有对应关系",
                "最大值常在特殊位置出现",
            ],
            "很多错误都出在不知道速度、加速度与位移的相位关系。建议把三条曲线放在一起观察，会更直观。",
            14,
            "equation_board",
            accent,
            "v=-Aω sin(ωt+φ),  a=-ω²x",
            {"highlight": "phase_shift"},
        ),
        _scene(
            "解题步骤小结",
            "从已知量反推振动表达式",
            [
                "先确定 A 与 T",
                "再根据初始条件定 φ",
                "最后求所需物理量",
            ],
            "一旦把振动表达式写出来，后面多数问题都只是代值和判断时刻，不要跳过建立表达式这一步。",
            11,
            "step_board",
            accent,
            "A、T、φ → x(t) → v(t)、a(t)",
            {"steps": 3},
        ),
    ]
    return {
        "title": "动态讲题：简谐振动",
        "summary": "用动画曲线解释简谐振动中的位移、速度和加速度关系。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "简谐振动 / 曲线联动 / 相位关系",
        "scenes": scenes,
    }


def _build_generic_math(question: str) -> Dict[str, Any]:
    accent = "#4f7cff"
    q = _clean_text(question)
    scenes = [
        _scene(
            "先读题，再拆条件",
            "把已知、未知和限制条件分开",
            [
                "圈出已知量和符号",
                "明确题目要求求什么",
                "判断适合用哪一类公式或方法",
            ],
            f"这道题建议先把题干拆成条件和目标。原题核心内容是：{q[:68]}。不要急着算，先判断这是函数、方程还是几何关系问题。",
            12,
            "step_board",
            accent,
            "读题 → 拆条件 → 选方法",
            {"steps": 3},
        ),
        _scene(
            "把思路写成板书",
            "中间步骤要保持可检查",
            [
                "先列关系式",
                "再逐步变形或代入",
                "关键步骤要写理由",
            ],
            "无论是代数题还是函数题，都建议把核心关系式先写出来，再一步一步变形，避免跳步导致后面检查困难。",
            13,
            "equation_board",
            accent,
            "建议：把题目条件转成 1~2 个主方程",
            {"highlight": "method"},
        ),
        _scene(
            "最后回看答案是否合理",
            "结果要和题目条件相匹配",
            [
                "检查符号与范围",
                "检查单位或定义域",
                "必要时代回原式验证",
            ],
            "很多失分其实不是不会，而是最后没有验证。写完后回看定义域、范围和符号，往往就能发现问题。",
            10,
            "summary_board",
            accent,
            "条件一致、格式完整、结论明确",
            {"focus": "check"},
        ),
    ]
    return {
        "title": "动态讲题：数学题",
        "summary": "将题目拆成条件、方法和验证三个部分进行动画式讲解。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "数学题 / 步骤白板 / 条件拆解",
        "scenes": scenes,
    }


def _build_generic_physics(question: str) -> Dict[str, Any]:
    accent = "#5b8def"
    q = _clean_text(question)
    scenes = [
        _scene(
            "先画物理过程图",
            "时间顺序和受力/状态变化要先清楚",
            [
                "明确研究对象",
                "写出已知物理量",
                "判断适用的守恒或动力学关系",
            ],
            f"面对物理题，建议先把过程画出来。原题的核心是：{q[:70]}。对象是谁、处于什么状态、发生了什么变化，要先理顺。",
            12,
            "physics_board",
            accent,
            "对象 → 过程 → 规律",
            {"focus": "object_process_law"},
        ),
        _scene(
            "公式不是越多越好",
            "只保留和目标直接相关的关系式",
            [
                "受力题优先列牛顿第二定律",
                "能量题优先列守恒关系",
                "运动学题优先列位移速度公式",
            ],
            "物理建模的关键是匹配规律，而不是罗列公式。只要选对规律，后面的代数计算反而是最简单的部分。",
            13,
            "equation_board",
            accent,
            "常用：ΣF=ma / E守恒 / p守恒",
            {"highlight": "law_select"},
        ),
        _scene(
            "最后检查方向、单位和数量级",
            "这三项最容易暴露错误",
            [
                "方向正负是否一致",
                "单位是否统一",
                "数量级是否符合常识",
            ],
            "如果答案量级明显不合理，或者单位不匹配，往往说明前面的方程选择或符号设定出了问题。",
            10,
            "summary_board",
            accent,
            "研究对象清楚、规律匹配、计算有校验",
            {"focus": "sanity_check"},
        ),
    ]
    return {
        "title": "动态讲题：物理题",
        "summary": "用过程图、规律选择和校验步骤解释常见物理题。",
        "duration_sec": sum(int(s["duration_sec"]) for s in scenes),
        "scene_count": len(scenes),
        "style": "visual_tutor",
        "source": "offline_visual_tutor",
        "poster_text": "物理题 / 过程建模 / 白板推导",
        "scenes": scenes,
    }


def build_visual_storyboard(question: str, subject: str = "auto") -> Dict[str, Any]:
    q = _clean_text(question)
    domain = _infer_domain(q, subject)
    if domain == "fourier":
        out = _build_fourier(q)
    elif domain == "trig":
        out = _build_trig(q)
    elif domain == "projectile":
        out = _build_projectile(q)
    elif domain == "shm":
        out = _build_shm(q)
    elif domain == "physics":
        out = _build_generic_physics(q)
    else:
        out = _build_generic_math(q)
    out["question"] = q
    out["subject"] = subject if subject != "auto" else ("physics" if domain in ("projectile", "shm", "physics") else "math")
    out["domain"] = domain
    return out


def normalize_visual_storyboard(question: str, payload: Optional[Dict[str, Any]], subject: str = "auto") -> Dict[str, Any]:
    fallback = build_visual_storyboard(question, subject)
    if not payload:
        return fallback
    scenes = payload.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return fallback
    accent_default = "#4f7cff"
    fixed: List[Dict[str, Any]] = []
    for s in scenes[:6]:
        if not isinstance(s, dict):
            continue
        bullets = s.get("bullets") if isinstance(s.get("bullets"), list) else []
        bullets = [str(x)[:60] for x in bullets[:4]]
        fixed.append(
            {
                "title": str(s.get("title") or "讲题场景")[:40],
                "subtitle": str(s.get("subtitle") or "动态讲题")[:64],
                "bullets": bullets or ["围绕核心条件建立解题思路"],
                "narration": str(s.get("narration") or "请结合动画场景理解题目思路")[:240],
                "duration_sec": max(8, min(22, int(s.get("duration_sec") or 12))),
                "visual_type": str(s.get("visual_type") or s.get("layout") or "step_board")[:32],
                "accent": str(s.get("accent") or accent_default),
                "equation": str(s.get("equation") or "")[:120],
                "visual": s.get("visual") if isinstance(s.get("visual"), dict) else {},
            }
        )
    if not fixed:
        return fallback
    duration = sum(int(x["duration_sec"]) for x in fixed)
    return {
        "title": str(payload.get("title") or fallback["title"])[:60],
        "summary": str(payload.get("summary") or fallback["summary"])[:240],
        "duration_sec": duration,
        "scene_count": len(fixed),
        "style": "visual_tutor",
        "source": str(payload.get("source") or "external_ai"),
        "poster_text": str(payload.get("poster_text") or fallback.get("poster_text") or "动态讲题")[:80],
        "scenes": fixed,
        "question": _clean_text(question),
        "subject": subject if subject != "auto" else fallback.get("subject", "math"),
        "domain": _infer_domain(question, subject),
    }



def _visual_code_preview(scene: Dict[str, Any], idx: int) -> str:
    visual_type = str(scene.get('visual_type') or 'step_board')
    equation = str(scene.get('equation') or '')
    visual = scene.get('visual') if isinstance(scene.get('visual'), dict) else {}
    return "\n".join([
        f"// Scene {idx}: {scene.get('title') or '动态讲题'}",
        f"const vt = {json.dumps(visual_type, ensure_ascii=False)};",
        f"const equation = {json.dumps(equation, ensure_ascii=False)};",
        f"const visual = {json.dumps(visual, ensure_ascii=False)};",
        "drawAxes(ctx);",
        "drawAnimatedScene(ctx, vt, visual, progress);",
        "renderEquationCard(ctx, equation);",
        f"// narration: {str(scene.get('narration') or '')[:120]}",
    ])



def build_visual_teaching_process(payload: Dict[str, Any]) -> Dict[str, Any]:
    scenes = payload.get('scenes') if isinstance(payload.get('scenes'), list) else []
    question = _clean_text(str(payload.get('question') or ''))
    domain = str(payload.get('domain') or 'math')
    pipeline = [
        {
            'step': 1,
            'name': '题型识别',
            'desc': '先识别题目属于函数图像、傅里叶级数、抛体运动、简谐振动还是通用白板推导。',
        },
        {
            'step': 2,
            'name': '分镜规划',
            'desc': '把题目拆成“读题—建模—公式—图像/过程—小结”几个讲解场景。',
        },
        {
            'step': 3,
            'name': '绘图参数生成',
            'desc': '为每一幕生成 equation、visual_type 与 visual 参数，驱动画布动画。',
        },
        {
            'step': 4,
            'name': '旁白脚本生成',
            'desc': '把 narration 组织成适合语音播报的口语化解题说明。',
        },
        {
            'step': 5,
            'name': '动画播放与语音讲解',
            'desc': '浏览器端 Canvas 实时绘制当前幕，并可调用 TTS 朗读当前场景。',
        },
    ]
    scene_blueprints: List[Dict[str, Any]] = []
    for idx, scene in enumerate(scenes, start=1):
        scene_blueprints.append({
            'scene_no': idx,
            'focus': str(((scene.get('bullets') or ['围绕当前题目建立解题思路'])[0]))[:80],
            'drawing_plan': f"用 {scene.get('visual_type') or 'step_board'} 表达 {scene.get('title') or '当前步骤'}，突出 {scene.get('equation') or '关键关系式'}。",
            'voice_script': str(scene.get('narration') or '')[:220],
            'equation': str(scene.get('equation') or '')[:120],
            'code_preview': _visual_code_preview(scene, idx),
        })
    return {
        'engine': 'canvas_preview_with_tts',
        'domain': domain,
        'question_digest': question[:120],
        'pipeline': pipeline,
        'scene_blueprints': scene_blueprints,
    }
