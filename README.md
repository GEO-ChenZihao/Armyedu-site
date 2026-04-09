# ArmEdu 双循环引擎（基于 army.html 指挥台UI）- 全栈可运行成品

本工程**严格基于你提供的 `army.html` UI**，将其中的“模拟数据/本地 localStorage 登录”替换为真实后端：
- FastAPI + SQLite（WAL + 索引）
- IRT(2PL) 能力 θ 估计
- BKT 知识追踪掌握度
- 推荐训练（测→学）
- 回流校准（学→评，简化：更新 b）
- 管理端：题库/用户/监控/审计
- AI 教辅（D 模式：讲解/计划/情绪支持；未配置时离线 Mock；支持 OpenAI-Compatible，包括 Codex）
- 微课与 AI 动画课程（文字微课 + 自动生成分镜动画课 + 观看进度回流）
- 动态讲题窗口（傅里叶级数 / 三角函数 / 抛体运动 / 简谐振动 / 白板推导 + 语音讲解）

## 1) 运行（Windows / VS Code）
在项目根目录（看到 requirements.txt 的那层）执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt
python -m scripts.seed
python -m uvicorn app.main:app --reload
```

浏览器打开：
- http://127.0.0.1:8000/  （登录 + 指挥台）

默认账号（seed 后可用）：
- trainee / trainee123
- admin / admin123

## 2) 题库扩展
题库（国防教育/军事理论方向，章节化）在 `scripts/seed.py` 里。
你可以继续追加题目模板或 CSV 导入（管理端 → 题库管理 → CSV导入）。

CSV 格式（不带表头）：
skill_id,stem,choices(|分隔),answer_key,a,b

## 3) AI 接入（OpenAI-Compatible / DeepSeek / Codex）
设置 → AI 模型配置：
- Base URL（OpenAI-Compatible）
- API Key
- Model（你账号可用的模型名；可用“填入Codex / 填入DeepSeek”按钮快速写入常用值）

### DeepSeek 快速配置（推荐国内可用）
- Base URL：`https://api.deepseek.com`
- Model：`deepseek-chat`（通用对话）或 `deepseek-reasoner`（更强推理）
- API Key：填 DeepSeek 控制台申请的 Key

如果不配置：后端会返回离线 Mock，保证答辩离线可演示。

### 推荐（更安全）：服务端用环境变量配置 Key
不建议把 API Key 存在浏览器 localStorage。你可以在**后端**设置环境变量，然后在前端勾选“使用服务端 API Key”。

环境变量：
- `ARMEDU_AI_BASE_URL`（例如 `https://api.openai.com` 或 `https://api.deepseek.com`）
- `ARMEDU_AI_API_KEY`
- `ARMEDU_AI_MODEL`（例如 `deepseek-chat` / `deepseek-reasoner` / 你账号可用的模型名）

Windows PowerShell 示例：
```powershell
$env:ARMEDU_AI_BASE_URL = "https://api.deepseek.com"  # 或 https://api.openai.com
$env:ARMEDU_AI_API_KEY  = "<你的key>"
$env:ARMEDU_AI_MODEL    = "<你的model>"
python -m uvicorn app.main:app --reload
```

> 如需**强制禁用**前端自带 Key（更安全），可设置：`ARMEDU_AI_ALLOW_CLIENT_KEY=0`。


## 4) 微课视频 / AI 动画课程
系统已新增“文字微课 + AI 动画课程”双形态学习资源：
- 学员端：智能学习 → 微课目录 → 阅读 / 动画
- 动画课程：按场景自动播放，支持上一幕/下一幕/暂停、进度回传、学习完成
- 管理端：知识点画像 → AI生成动画课（可调用外部模型；未配置时回退离线模板）

接口补充：
- `GET /api/lessons/{skill_id}/video`
- `POST /api/lessons/{skill_id}/video/progress`
- `POST /api/lessons/{skill_id}/video/complete`
- `POST /api/admin/lessons/{skill_id}/video/generate`

> 若配置了外部 OpenAI-Compatible 模型，系统会尝试生成课程分镜 JSON；否则自动回退到离线模板，保证答辩时也能演示。

## 4) AI 单元（仪表盘一键计划）
登录后进入「仪表盘」，你会看到 **AI单元**：
- 「生成今日学习计划」：结合 θ + 掌握度 + 最近作答，生成 30-45 分钟可执行计划
- 「生成薄弱点突击计划」：更聚焦掌握度最低章节
- 「打开 AI 教辅」：进入对话模式（讲解/计划/情绪支持）

> 未配置模型时，会返回离线 Mock，保证流程可演示。


## 5) 动态讲题窗口
在「AI 教辅」页面新增了动态讲题窗口：
- 输入数学/物理题，系统可生成分镜动画讲解
- 支持函数图像、傅里叶级数、抛体运动、简谐振动等可视化场景
- 支持上一幕/下一幕/暂停/语音朗读
- 题目解析页也可一键打开“动态讲题”

> 风格上尽量接近“短视频讲题 + 白板动画”，但实现方式保持轻量化、浏览器端 Canvas 动画和离线可演示。


## 6) 基于论文实现的 AI 动画制作链路
- 动画课程页新增“制作流程”面板，按论文中的技术路线展示：双智能体分镜 → JSON 中间表示（voiceText / voiceRole / imageDesc）→ Manim 代码草案 → 静态检查 → 运行校验 → 配音字幕与渲染。
- 每一幕都会展示当前的教师/学生讲解轮次和对应的 Manim 代码草案，便于答辩时说明“不是简单轮播，而是可继续落到动画生产”的实现路径。
- 动态讲题窗口也新增了题型识别、分镜规划和绘图脚本面板，方便展示数学/物理题的可视化讲解过程。
