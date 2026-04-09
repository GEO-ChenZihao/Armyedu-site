
/**
 * ArmEdu Command UI v4 (army.html) - App Logic (Full-stack)
 * 说明：
 * - 严格基于你提供的 army.html 结构与 CSS
 * - 将原来的 mockLogin / localStorage 用户数据改为真实后端 API
 * - 所有主要按钮与窗口都有对应动作（训练/作答/分析/AI/题库/用户/监控/设置）
 */

(function(){
  "use strict";

  // ---------- helpers ----------
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  function safeText(s){
    if(s === null || s === undefined) return "";
    return String(s);
  }

  function escapeHtml(s){
    return safeText(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function formatSec(sec){
    sec = Math.max(0, Number(sec||0));
    if(sec < 60) return `${sec.toFixed(0)}s`;
    const m = Math.floor(sec/60);
    const s = Math.floor(sec%60);
    if(m < 60) return `${m}m ${String(s).padStart(2,'0')}s`;
    const h = Math.floor(m/60);
    const mm = m%60;
    return `${h}h ${String(mm).padStart(2,'0')}m`;
  }

  function mapThetaToPct(theta){
    // theta ∈ [-4,4] -> [0,100]
    return clamp(((theta + 4) / 8) * 100, 0, 100);
  }

  function fitCanvas(canvas){
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, rect.width);
    const h = Math.max(120, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function skillChapterNo(skillId){
    const m = String(skillId || "").match(/ch(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function renderPipelineHtml(steps){
    const list = Array.isArray(steps) ? steps : [];
    if(!list.length) return '<div class="mini">当前使用离线模板，但仍保留完整的分镜与播放流程。</div>';
    return list.map((step, idx)=>`<div class="process-item">
        <div class="process-item-no">${Number(step.step || idx+1)}</div>
        <div>
          <div class="process-item-title">${escapeHtml(step.name || `步骤${idx+1}`)}</div>
          <div class="process-item-desc">${escapeHtml(step.desc || "")}</div>
        </div>
      </div>`).join("");
  }

  function renderSchemaTags(fields){
    const arr = Array.isArray(fields) ? fields : [];
    if(!arr.length) return '<div class="mini">当前场景会自动生成旁白、角色与画面描述。</div>';
    return arr.map(x=>`<span class="schema-tag">${escapeHtml(String(x))}</span>`).join('');
  }

  function renderDialogueHtml(round, blueprint){
    const cards = [];
    if(round && round.teacher){
      cards.push(`<div class="dialogue-card"><div class="mini">教师智能体</div><div class="dialogue-text">${escapeHtml(round.teacher)}</div></div>`);
    }
    if(round && round.student){
      cards.push(`<div class="dialogue-card"><div class="mini">学生智能体</div><div class="dialogue-text">${escapeHtml(round.student)}</div></div>`);
    }
    if(blueprint && (blueprint.imageDesc || blueprint.manim_hint)){
      cards.push(`<div class="dialogue-card"><div class="mini">画面规划</div><div class="dialogue-text">${escapeHtml(blueprint.imageDesc || blueprint.manim_hint || "")}</div></div>`);
    }
    return cards.length ? cards.join("") : '<div class="mini">当前场景按“教师讲解 + 学生追问”的方式自动组织分镜。</div>';
  }

  function renderSceneMetaHtml(meta){
    if(!meta) return '<div class="mini">系统会自动为当前幕生成公式、绘图参数和旁白脚本。</div>';
    const rows = [];
    if(meta.focus) rows.push(`<div class="scene-meta-item"><b>本幕重点：</b>${escapeHtml(meta.focus)}</div>`);
    if(meta.goal) rows.push(`<div class="scene-meta-item"><b>教学目标：</b>${escapeHtml(meta.goal)}</div>`);
    if(meta.drawing_plan) rows.push(`<div class="scene-meta-item"><b>绘图方案：</b>${escapeHtml(meta.drawing_plan)}</div>`);
    if(meta.imageDesc) rows.push(`<div class="scene-meta-item"><b>画面描述：</b>${escapeHtml(meta.imageDesc)}</div>`);
    if(meta.voice_script || meta.voiceText) rows.push(`<div class="scene-meta-item"><b>旁白脚本：</b>${escapeHtml(meta.voice_script || meta.voiceText)}</div>`);
    if(meta.equation) rows.push(`<div class="scene-meta-item"><b>核心公式：</b>${escapeHtml(meta.equation)}</div>`);
    return rows.length ? rows.join("") : '<div class="mini">当前幕的绘图与讲解参数将跟随场景自动更新。</div>';
  }

  // ---------- charts (simple canvas HUD style) ----------
  function drawBarChart(canvas, labels, values){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = 36;
    const cw = w - pad*2;
    const ch = h - pad*2;

    const maxVal = Math.max(1, ...values);
    // axis
    ctx.strokeStyle = "rgba(120,175,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h-pad);
    ctx.lineTo(w-pad, h-pad);
    ctx.stroke();

    const barGap = 10;
    const barW = Math.max(10, (cw - barGap*(labels.length-1)) / labels.length);

    const neonC = cssVar("--neonC") || "#00e5ff";
    const neonM = cssVar("--neonM") || "#7c4dff";
    const text = cssVar("--text") || "#d9e6ff";
    const muted = cssVar("--muted") || "#8fb0d8";

    labels.forEach((lab, i)=>{
      const v = values[i] || 0;
      const bh = (v / maxVal) * (ch * 0.78);
      const x = pad + i*(barW + barGap);
      const y = h - pad - bh;

      // gradient
      const g = ctx.createLinearGradient(x, y, x, y+bh);
      g.addColorStop(0, "rgba(0,229,255,0.55)");
      g.addColorStop(1, "rgba(124,77,255,0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, barW, bh);

      ctx.strokeStyle = "rgba(0,229,255,0.55)";
      ctx.strokeRect(x, y, barW, bh);

      ctx.fillStyle = text;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
      ctx.textAlign = "center";
      const short = lab.length > 6 ? lab.slice(0,6) + "…" : lab;
      ctx.fillText(short, x + barW/2, h - pad + 18);

      ctx.fillStyle = muted;
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Arial";
      ctx.fillText(`${Math.round(v)}%`, x + barW/2, y - 8);
    });

    // title corner line
    ctx.strokeStyle = "rgba(0,229,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(10,10); ctx.lineTo(36,10);
    ctx.moveTo(10,10); ctx.lineTo(10,36);
    ctx.stroke();
  }

  function drawLineChart(canvas, labels, values){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const pad = 36;
    const cw = w - pad*2;
    const ch = h - pad*2;

    // axis
    ctx.strokeStyle = "rgba(120,175,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h-pad);
    ctx.lineTo(w-pad, h-pad);
    ctx.stroke();

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = Math.max(1e-6, maxVal - minVal);
    const xStep = cw / Math.max(1, values.length-1);

    const neonC = cssVar("--neonC") || "#00e5ff";
    const neonM = cssVar("--neonM") || "#7c4dff";
    const text = cssVar("--text") || "#d9e6ff";
    const muted = cssVar("--muted") || "#8fb0d8";

    // area fill
    ctx.beginPath();
    values.forEach((v, i)=>{
      const x = pad + i*xStep;
      const y = pad + (1 - (v - minVal)/span) * (ch*0.86);
      if(i === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.lineTo(pad + (values.length-1)*xStep, h-pad);
    ctx.lineTo(pad, h-pad);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, pad, 0, h-pad);
    g.addColorStop(0, "rgba(0,229,255,0.18)");
    g.addColorStop(1, "rgba(124,77,255,0.06)");
    ctx.fillStyle = g;
    ctx.fill();

    // line
    ctx.beginPath();
    values.forEach((v, i)=>{
      const x = pad + i*xStep;
      const y = pad + (1 - (v - minVal)/span) * (ch*0.86);
      if(i === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = "rgba(0,229,255,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // points + labels
    values.forEach((v, i)=>{
      const x = pad + i*xStep;
      const y = pad + (1 - (v - minVal)/span) * (ch*0.86);
      ctx.fillStyle = "rgba(124,77,255,0.9)";
      ctx.beginPath();
      ctx.arc(x,y,3.5,0,Math.PI*2);
      ctx.fill();

      if(labels && labels[i] && (i===0 || i===values.length-1 || i%Math.ceil(values.length/4)===0)){
        ctx.fillStyle = muted;
        ctx.font = "11px system-ui, -apple-system, Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.fillText(labels[i], x, h-pad+18);
      }
    });

    // y labels
    ctx.fillStyle = muted;
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Arial";
    ctx.textAlign = "right";
    ctx.fillText(maxVal.toFixed(2), pad-6, pad+2);
    ctx.fillText(minVal.toFixed(2), pad-6, h-pad);
  }

  function drawPieChart(canvas, labels, values){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);

    const total = values.reduce((a,b)=>a+(b||0),0) || 1;
    const cx = w/2;
    const cy = h/2;
    const r = Math.min(w,h) * 0.32;

    const colors = [
      "rgba(0,229,255,0.65)",
      "rgba(124,77,255,0.55)",
      "rgba(0,255,168,0.55)",
      "rgba(255,204,102,0.55)",
      "rgba(255,92,122,0.55)",
      "rgba(120,175,255,0.45)",
    ];
    let ang = -Math.PI/2;
    labels.forEach((lab, i)=>{
      const v = values[i] || 0;
      const a = (v/total) * Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,ang,ang+a);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      ang += a;
    });

    // center hole (HUD style)
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.55,0,Math.PI*2);
    ctx.fillStyle = "rgba(6,16,31,0.80)";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,175,255,0.16)";
    ctx.stroke();

    // legend
    const text = cssVar("--text") || "#d9e6ff";
    const muted = cssVar("--muted") || "#8fb0d8";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
    ctx.textAlign = "left";
    let y0 = 18;
    labels.forEach((lab, i)=>{
      const v = values[i] || 0;
      const pct = Math.round((v/total)*100);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(12, y0-10, 10, 10);
      ctx.fillStyle = text;
      ctx.fillText(`${lab}  ${pct}%`, 28, y0);
      ctx.fillStyle = muted;
      ctx.fillText(`(${v})`, 28 + ctx.measureText(`${lab}  ${pct}%`).width + 6, y0);
      y0 += 18;
    });
  }

  function roundedRectPath(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function drawNodeCard(ctx, x, y, w, h, title, accent, alpha=1){
    ctx.save();
    ctx.globalAlpha = alpha;
    roundedRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(8,18,34,0.86)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#e8f2ff';
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, Arial';
    ctx.textAlign = 'center';
    wrapCanvasText(ctx, title, x + w/2, y + h/2 - 6, w - 18, 16, true);
    ctx.restore();
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, centered=false, maxLines=3){
    const parts = String(text || '').split(/\s+/);
    const lines = [];
    let cur = '';
    for(const p of parts){
      const test = cur ? cur + ' ' + p : p;
      if(ctx.measureText(test).width > maxWidth && cur){
        lines.push(cur);
        cur = p;
      }else{
        cur = test;
      }
    }
    if(cur) lines.push(cur);
    const use = lines.slice(0, maxLines);
    const startY = y - ((use.length-1) * lineHeight / 2);
    use.forEach((line, idx)=>{
      if(centered) ctx.textAlign = 'center';
      ctx.fillText(line, x, startY + idx*lineHeight);
    });
  }

  function drawStageBackdrop(ctx, w, h, accent, progress=0){
    ctx.clearRect(0,0,w,h);
    const bg = ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,'rgba(5,10,20,0.96)');
    bg.addColorStop(1,'rgba(4,8,18,0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,w,h);
    ctx.save();
    ctx.strokeStyle = 'rgba(120,175,255,0.10)';
    ctx.lineWidth = 1;
    for(let x=0; x<w; x+=36){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
    for(let y=0; y<h; y+=30){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
    ctx.restore();
    const glow = ctx.createRadialGradient(w*0.15, h*0.08, 20, w*0.15, h*0.08, w*0.45);
    glow.addColorStop(0, accent.replace(')',',0.22)').replace('rgb','rgba'));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    // if accent is hex, approximate with overlay
    ctx.fillStyle = 'rgba(79,124,255,0.16)';
    ctx.beginPath(); ctx.arc(w*0.18, h*0.1, w*0.28, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    roundedRectPath(ctx, 10, 10, w-20, h-20, 16); ctx.stroke();

    ctx.fillStyle = '#f2f7ff';
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, Arial';
    ctx.textAlign = 'left';
    ctx.fillText('AI 动态讲解台', 22, 28);
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Arial';
    ctx.fillStyle = 'rgba(217,230,255,0.70)';
    ctx.fillText(`场景进度 ${Math.round(progress*100)}%`, w-106, 28);
  }

  function drawConceptMapScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#4f7cff';
    drawStageBackdrop(ctx, w, h, accent, progress);
    drawNodeCard(ctx, w*0.33, h*0.38, w*0.34, 62, scene.title || '核心概念', accent, 1);
    const nodes = (scene.visual?.nodes || scene.bullets || []).slice(0,3);
    const poses = [[w*0.12,h*0.12],[w*0.7,h*0.14],[w*0.7,h*0.66]];
    nodes.forEach((n,idx)=>{
      const [x,y] = poses[idx] || [w*0.12, h*0.18 + idx*74];
      const alpha = clamp((progress - idx*0.18) / 0.35, 0, 1);
      if(alpha <= 0) return;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(w*0.5, h*0.41);
      ctx.lineTo(x + 90, y + 30);
      ctx.stroke();
      drawNodeCard(ctx, x, y, 180, 60, String(n), accent, alpha);
      ctx.restore();
    });
  }

  function drawStepBoardScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#4f7cff';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const steps = (scene.bullets || []).slice(0,4);
    ctx.textAlign = 'left';
    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, Arial';
    steps.forEach((step, idx)=>{
      const alpha = clamp((progress - idx*0.15) / 0.25, 0, 1);
      const y = 70 + idx*56;
      ctx.save();
      ctx.globalAlpha = Math.max(0.18, alpha);
      ctx.fillStyle = alpha > 0.9 ? 'rgba(0,229,255,0.16)' : 'rgba(255,255,255,0.03)';
      roundedRectPath(ctx, 28, y, w-56, 42, 16);
      ctx.fill();
      ctx.strokeStyle = alpha > 0.9 ? accent : 'rgba(255,255,255,0.08)';
      ctx.stroke();
      ctx.fillStyle = '#eaf3ff';
      ctx.beginPath(); ctx.arc(48, y+21, 12, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#081220'; ctx.textAlign = 'center'; ctx.fillText(String(idx+1), 48, y+26);
      ctx.textAlign = 'left'; ctx.fillStyle = '#e8f2ff';
      wrapCanvasText(ctx, step, 72, y+21, w-110, 16, false, 2);
      ctx.restore();
    });
    if(scene.equation){
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundedRectPath(ctx, 28, h-58, w-56, 34, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
      ctx.fillStyle = '#9ddcff';
      ctx.font = '600 13px system-ui, -apple-system, Segoe UI, Arial';
      ctx.fillText(scene.equation, 42, h-36);
    }
  }

  function drawSummaryScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#4f7cff';
    drawStageBackdrop(ctx, w, h, accent, progress);
    ctx.fillStyle = '#eff6ff';
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(scene.title || '本节总结', w/2, 74);
    const bullets = (scene.bullets || []).slice(0,3);
    bullets.forEach((b, idx)=>{
      const alpha = clamp((progress - idx*0.18) / 0.25, 0, 1);
      const x = 54 + idx * ((w - 108) / Math.max(1, bullets.length));
      const cardW = Math.min(170, (w - 130) / Math.max(1, bullets.length));
      const y = 132;
      drawNodeCard(ctx, x, y, cardW, 112, String(b), accent, alpha);
    });
  }

  function drawEquationBoardScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#4f7cff';
    drawStageBackdrop(ctx, w, h, accent, progress);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundedRectPath(ctx, 28, 58, w-56, 72, 16); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#f3f8ff';
    ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Arial';
    ctx.textAlign = 'center';
    wrapCanvasText(ctx, scene.equation || '核心公式', w/2, 92, w-120, 24, true, 2);
    ctx.textAlign = 'left';
    (scene.bullets || []).slice(0,3).forEach((b, idx)=>{
      const alpha = clamp((progress - idx*0.15) / 0.25, 0, 1);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; roundedRectPath(ctx, 44, 154 + idx*42, w-88, 30, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke();
      ctx.fillStyle = '#cfe2ff'; ctx.font = '13px system-ui, -apple-system, Segoe UI, Arial';
      ctx.fillText(`• ${b}`, 56, 174 + idx*42);
      ctx.restore();
    });
  }

  function drawAxes(ctx, x, y, w, h, color='rgba(255,255,255,0.18)'){
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y+h/2); ctx.lineTo(x+w, y+h/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+w/2, y); ctx.lineTo(x+w/2, y+h); ctx.stroke();
  }

  function drawTrigPlotScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#2ab7ca';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const plotX = 42, plotY = 54, plotW = w-84, plotH = h-118;
    drawAxes(ctx, plotX, plotY, plotW, plotH);
    const visual = scene.visual || {};
    const A = Number(visual.amplitude || 1.2);
    const omega = Number(visual.omega || 1.0);
    const phase = Number(visual.phase || 0.0);
    const offset = Number(visual.offset || 0.0);
    ctx.strokeStyle = accent; ctx.lineWidth = 2.2; ctx.beginPath();
    const maxT = Math.PI * 2 * clamp(progress + 0.06, 0.08, 1.0);
    for(let i=0; i<=280; i++){
      const t = (i/280) * maxT;
      const px = plotX + (i/280) * plotW;
      const yv = A * Math.sin(omega * t + phase) + offset;
      const py = plotY + plotH/2 - yv * (plotH*0.25);
      if(i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#dff4ff'; ctx.font = '600 13px system-ui, -apple-system, Segoe UI, Arial';
    ctx.fillText(scene.equation || 'y = A sin(ωx + φ) + b', 50, 34);
  }

  function drawUnitCircleScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#2ab7ca';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const cx = w*0.33, cy = h*0.55, r = Math.min(w,h) * 0.22;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-r-22, cy); ctx.lineTo(cx+r+22, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy-r-22); ctx.lineTo(cx, cy+r+22); ctx.stroke();
    const ang = Math.PI/8 + progress * Math.PI*1.25;
    const px = cx + r*Math.cos(ang), py = cy - r*Math.sin(ang);
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke();
    ctx.fillStyle = '#dff4ff'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI*2); ctx.fill();
    ctx.fillText('sinθ', px + 12, (py + cy)/2); ctx.fillText('cosθ', (px + cx)/2, cy + 18);
    drawNodeCard(ctx, w*0.58, h*0.24, w*0.28, 120, scene.subtitle || '单位圆', accent, 1);
  }

  function drawFourierPlotScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#8a63d2';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const plotX = 34, plotY = 50, plotW = w-68, plotH = h-112;
    drawAxes(ctx, plotX, plotY, plotW, plotH);
    const maxH = Number(scene.visual?.max_harmonics || 9);
    let harmonics = Math.max(1, Math.floor(progress * maxH));
    if(harmonics % 2 === 0) harmonics = Math.max(1, harmonics - 1);
    ctx.strokeStyle = accent; ctx.lineWidth = 2.1; ctx.beginPath();
    for(let i=0; i<=320; i++){
      const x = -Math.PI + (i/320) * Math.PI*2;
      let yv = 0;
      for(let k=1; k<=harmonics; k+=2){ yv += (4/Math.PI) * Math.sin(k*x) / k; }
      const px = plotX + (i/320) * plotW;
      const py = plotY + plotH/2 - yv * (plotH*0.18);
      if(i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#f0e5ff'; ctx.font = '600 13px system-ui, -apple-system, Segoe UI, Arial';
    ctx.fillText(`奇次谐波数：${harmonics}`, 44, 30);
    if(scene.equation) ctx.fillText(scene.equation, 180, 30);
  }

  function drawProjectileScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#d08a32';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const plotX = 38, plotY = 46, plotW = w-76, plotH = h-106;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(plotX, plotY+plotH); ctx.lineTo(plotX+plotW, plotY+plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(plotX, plotY+plotH); ctx.lineTo(plotX, plotY); ctx.stroke();
    const v0 = Number(scene.visual?.v0 || 8);
    const angle = Number(scene.visual?.angle_deg || 52) * Math.PI/180;
    const g = Number(scene.visual?.g || 9.8);
    const tEnd = Math.max(0.6, 2*v0*Math.sin(angle)/g);
    const tNow = tEnd * clamp(progress, 0.06, 1);
    ctx.strokeStyle = accent; ctx.lineWidth = 2.2; ctx.beginPath();
    for(let i=0; i<=220; i++){
      const t = (i/220) * tNow;
      const x = v0*Math.cos(angle)*t;
      const y = v0*Math.sin(angle)*t - 0.5*g*t*t;
      const px = plotX + (x/(v0*Math.cos(angle)*tEnd*1.05)) * plotW;
      const py = plotY + plotH - (y/Math.max(1, (v0*Math.sin(angle))**2/(2*g)*1.2)) * plotH;
      if(i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawShmScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#47a772';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const A = Number(scene.visual?.amplitude || 1.0);
    const omega = Number(scene.visual?.omega || 1.3);
    const phase = Number(scene.visual?.phase || 0.4);
    const cx = w*0.26, cy = h*0.56;
    const displacement = Math.cos(progress * Math.PI*2 * omega + phase) * 78 * A;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(30, cy); ctx.lineTo(cx-110, cy); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath();
    let sx = cx-110;
    ctx.moveTo(sx, cy);
    for(let i=1; i<=12; i++){
      const x = sx + i*14;
      const y = cy + (i%2===0 ? -14 : 14);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cx + displacement - 28, cy);
    ctx.stroke();
    ctx.fillStyle = '#dff6ea';
    roundedRectPath(ctx, cx + displacement - 28, cy - 28, 72, 56, 14); ctx.fill();
    ctx.strokeStyle = accent; ctx.stroke();
    const plotX = w*0.48, plotY = 48, plotW = w*0.46, plotH = h-96;
    drawAxes(ctx, plotX, plotY, plotW, plotH);
    ctx.strokeStyle = accent; ctx.beginPath();
    const maxT = Math.PI*2 * clamp(progress + 0.05, 0.08, 1);
    for(let i=0; i<=220; i++){
      const t = (i/220)*maxT;
      const px = plotX + (i/220)*plotW;
      const py = plotY + plotH/2 - A*Math.cos(omega*t + phase)*(plotH*0.24);
      if(i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawPhysicsBoardScene(canvas, scene, progress=0){
    const ctx = fitCanvas(canvas);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const accent = scene.accent || '#5b8def';
    drawStageBackdrop(ctx, w, h, accent, progress);
    const cols = ['研究对象','过程','规律'];
    cols.forEach((name, idx)=>{
      const x = 30 + idx * ((w-96)/3);
      drawNodeCard(ctx, x, 88, (w-120)/3, 112, name, accent, clamp((progress - idx*0.16)/0.3, 0, 1));
    });
    (scene.bullets || []).slice(0,3).forEach((b, idx)=>{
      ctx.fillStyle = '#d7e7ff'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Arial';
      ctx.fillText(`• ${b}`, 42, 230 + idx*24);
    });
  }

  function drawVisualLessonScene(canvas, scene, progress=0){
    const type = String(scene.visual_type || scene.layout || '').toLowerCase();
    if(type.includes('fourier')) return drawFourierPlotScene(canvas, scene, progress);
    if(type.includes('trig')) return drawTrigPlotScene(canvas, scene, progress);
    if(type.includes('unit_circle')) return drawUnitCircleScene(canvas, scene, progress);
    if(type.includes('projectile')) return drawProjectileScene(canvas, scene, progress);
    if(type.includes('shm')) return drawShmScene(canvas, scene, progress);
    if(type.includes('equation')) return drawEquationBoardScene(canvas, scene, progress);
    if(type.includes('physics')) return drawPhysicsBoardScene(canvas, scene, progress);
    if(type.includes('summary')) return drawSummaryScene(canvas, scene, progress);
    if(type.includes('concept') || type.includes('goal')) return drawConceptMapScene(canvas, scene, progress);
    return drawStepBoardScene(canvas, scene, progress);
  }

  // ---------- UI: toast & modal ----------
  function toast(message, type="ok"){
    const container = $("#toast");
    if(!container) return;
    const t = document.createElement("div");
    t.className = `t ${type}`;
    t.innerHTML = `<b>${type==="ok" ? "✓" : type==="bad" ? "✗" : "⚠"}</b> ${safeText(message)}`;
    container.appendChild(t);
    setTimeout(()=>{
      t.style.opacity = "0";
      t.style.transform = "translateX(80px)";
      setTimeout(()=>{ if(t.parentNode) t.parentNode.removeChild(t); }, 240);
    }, 2800);
  }

  function showModal(title, bodyHtml, footerHtml){
    const root = $("#modalRoot");
    if(!root) return;
    root.innerHTML = "";
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.addEventListener("click", ()=> closeModal());
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-panel">
        <div class="modal-head">
          <h3>${safeText(title)}</h3>
          <button class="btn ghost" data-action="modal-close">关闭</button>
        </div>
        <div class="modal-body">${bodyHtml || ""}</div>
        ${footerHtml ? `<div class="hr"></div><div class="row" style="justify-content:flex-end;gap:10px;">${footerHtml}</div>` : ""}
      </div>
    `;
    root.appendChild(backdrop);
    root.appendChild(modal);
    return root;
  }

  function closeModal(){
    // stop any active speech recognition (voice input)
    try{
      if(window.app && typeof window.app.stopVoiceInput === "function"){
        window.app.stopVoiceInput(true);
      }
      if(window.app && typeof window.app.destroyLessonVideoPlayer === "function"){
        window.app.destroyLessonVideoPlayer(true);
      }
      if(window.app && typeof window.app.destroyVisualTutorPlayer === "function"){
        window.app.destroyVisualTutorPlayer(true);
      }
    }catch(_e){}
    const root = $("#modalRoot");
    if(root) root.innerHTML = "";
  }

  // ---------- main app ----------
  class ArmEduApp {
    constructor(){
      this.tokenKey = "armedu_token";
      this.settingsKey = "armedu_settings";

      this.currentUser = null;
      this.currentPage = "dashboard";

      this.pages = {
        dashboard: "仪表盘",
        ops: "战术任务",
        training: "训练中心",
        smart: "智能学习",
        wrongbook: "错题本",
        badges: "勋章/打卡",
        analysis: "分析报告",
        ai: "AI教辅",
        knowledge: "知识点画像",
        monitor: "系统监控",
        question: "题库管理",
        users: "用户管理",
        settings: "系统设置",
      };

      this.state = {
        skills: [],
        profile: null,
        recent: [],
        analytics: null,
        skillStats: [],
        dailyPlan: null,
        ai_unit_plan: "",
        lessons: [],
        wrongbook: [],
        social: null,
        adminItems: null,
        adminUsers: null,
        metrics: null,
        audit: null,
        ops: null,
      };

      this.aiMode = "explain"; // explain | plan | emotion
      this.aiMessages = [];
      this.lessonVideoPlayer = null;
      this.visualTutorPlayer = null;

      // Ops mode (immersive mission)
      this.ops = {
        active: false,
        mission: null,
        total: 8,
        done: 0,
        correct: 0,
        startedAt: null,
      };

      this.settings = this.loadSettings();
      this.applySettings();

      this.bindGlobalEvents();
      this.checkAuth().finally(()=>{
        this.startClock();
      });
    }

    // ---------- settings ----------
    loadSettings(){
      try{
        const raw = localStorage.getItem(this.settingsKey);
        if(raw){
          const s = JSON.parse(raw);
          // backward-compatible defaults
          s.ai = s.ai || { base_url: "", api_key: "", model: "", emotion_enabled: true };
          s.voice = s.voice || { enabled: true, rate: 1.0, pitch: 1.0, uri: "" };
          // SpeechRecognition (voice input)
          s.voice_rec = s.voice_rec || {
            enabled: true,
            lang: "zh-CN",
            auto_send_ai: false,
            quiz_confirm: true,
          };
          return s;
        }
      }catch(e){}
      return {
        theme: document.documentElement.dataset.theme || "cold",
        motion: "normal", // normal|reduced
        clock_show_seconds: true,
        clock_24h: true,
        ui_view: "auto", // auto|trainee|admin (admin only preview)
        ai: {
          base_url: "",
          api_key: "",
          model: "",
          emotion_enabled: true,
        },
        voice: {
          enabled: true,
          rate: 1.0,
          pitch: 1.0,
          uri: "",
        },
        voice_rec: {
          enabled: true,
          lang: "zh-CN",
          auto_send_ai: false,
          quiz_confirm: true,
        },
      };
    }

    saveSettings(){
      localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
    }

    applySettings(){
      // theme
      if(this.settings.theme){
        document.documentElement.dataset.theme = this.settings.theme;
      }
      // motion
      if(this.settings.motion === "reduced"){
        document.documentElement.dataset.motion = "reduced";
      }else{
        delete document.documentElement.dataset.motion;
      }
    }

    getToken(){ return localStorage.getItem(this.tokenKey) || ""; }
    setToken(t){ localStorage.setItem(this.tokenKey, t); }
    clearToken(){ localStorage.removeItem(this.tokenKey); }

    getAiConfig(){
      const ai = this.settings.ai || {};
      const useServerKey = !!ai.use_server_key; // 默认保持兼容：不勾选则沿用旧逻辑
      return {
        base_url: (ai.base_url || "").trim(),
        api_key: useServerKey ? "" : (ai.api_key || "").trim(),
        model: (ai.model || "").trim(),
      };
    }

    // ---------- API wrapper ----------
    async api(path, {method="GET", body=null, form=false, headers={}} = {}){
      const h = Object.assign({}, headers);
      const token = this.getToken();
      if(token) h["Authorization"] = "Bearer " + token;
      if(!form) h["Content-Type"] = "application/json";
      const resp = await fetch(path, {
        method,
        headers: h,
        body: body ? (form ? body : JSON.stringify(body)) : null,
      });
      const text = await resp.text();
      let data = null;
      try{ data = text ? JSON.parse(text) : null; }catch(e){ data = {raw:text}; }
      if(!resp.ok){
        const det = data ? (data.detail ?? data.message ?? data.error) : null;
        let msg = `HTTP ${resp.status}`;
        if(det !== null && det !== undefined){
          if(typeof det === "string"){
            msg = det;
          }else{
            try{ msg = JSON.stringify(det); }catch(_e){ msg = String(det); }
          }
        }else if(data && data.raw){
          msg = String(data.raw || msg).slice(0, 300);
        }
        throw new Error(msg);
      }
      return data;
    }

    async download(path, filename){
      const token = this.getToken();
      const h = {};
      if(token) h["Authorization"] = "Bearer " + token;
      const resp = await fetch(path, {headers:h});
      if(!resp.ok){
        const t = await resp.text();
        throw new Error(t || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    }

    // ---------- auth ----------
    async checkAuth(){
      const token = this.getToken();
      if(!token){
        this.showLogin();
        return;
      }
      try{
        const me = await this.api("/api/me");
        this.currentUser = me.user;
        this.showApp();
      }catch(e){
        this.clearToken();
        this.showLogin();
      }
    }

    showLogin(){
      $("#loginPage")?.classList.remove("hidden");
      $("#appPage")?.classList.add("hidden");
      // reset pill
      const pill = $("#pillRole");
      if(pill) pill.innerHTML = `<span class="dot warn"></span> 未登录`;
    }

    showApp(){
      $("#loginPage")?.classList.add("hidden");
      $("#appPage")?.classList.remove("hidden");
      this.updatePill();

      // build nav & go default page
      this.buildNav();
      this.switchPage(this.currentPage || "dashboard");
    }

    updatePill(){
      const pill = $("#pillRole");
      if(!pill || !this.currentUser) return;
      const roleCn = this.currentUser.role === "admin" ? "管理员"
                   : this.currentUser.role === "instructor" ? "教员"
                   : "学员";
      const dotCls = (this.currentUser.role === "admin") ? "bad" : (this.currentUser.role === "instructor" ? "warn" : "ok");
      pill.innerHTML = `<span class="dot ${dotCls}"></span> ${this.currentUser.username} (${roleCn})`;
    }

    async handleLogin(){
      const username = ($("#loginUser")?.value || "").trim();
      const password = ($("#loginPass")?.value || "");
      if(!username || !password){
        toast("请输入用户名和密码", "bad"); return;
      }
      try{
        const r = await this.api("/api/auth/login", {method:"POST", body:{username, password}});
        this.setToken(r.token);
        this.currentUser = r.user;
        toast("登录成功", "ok");
        this.showApp();
      }catch(e){
        toast("登录失败：" + e.message, "bad");
      }
    }

    async handleRegister(){
      const username = ($("#regUser")?.value || "").trim();
      const password = ($("#regPass")?.value || "");
      const role = ($("#regRole")?.value || "trainee");
      if(!username || !password){
        toast("请输入用户名和密码", "bad"); return;
      }
      if(password.length < 6){
        toast("密码至少6位", "bad"); return;
      }
      try{
        const r = await this.api("/api/auth/register", {method:"POST", body:{username, password, role}});
        this.setToken(r.token);
        this.currentUser = r.user;
        toast("注册成功并已登录", "ok");
        this.showApp();
      }catch(e){
        toast("注册失败：" + e.message, "bad");
      }
    }

    async logout(){
      try{
        await this.api("/api/auth/logout", {method:"POST"});
      }catch(e){}
      this.clearToken();
      this.currentUser = null;
      this.showLogin();
      toast("已退出登录", "ok");
    }

    // ---------- nav ----------
    effectiveRole(){
      if(!this.currentUser) return "trainee";
      const r = this.currentUser.role;
      if((r === "admin" || r === "instructor") && this.settings.ui_view && this.settings.ui_view !== "auto"){
        return this.settings.ui_view; // preview only
      }
      return r;
    }

    buildNav(){
      const nav = $("#nav");
      if(!nav) return;
      const role = this.effectiveRole();
      const isAdmin = (role === "admin" || role === "instructor");

      const group = (title, itemsHtml) => `
        <div class="nav-group-title">${title}</div>
        ${itemsHtml}
      `;

      const item = (id, icon, text, sub) => `
        <div class="nav-item ${this.currentPage===id ? "active" : ""}" data-page="${id}">
          <div class="nav-icon">${icon}</div>
          <div class="nav-text">${text}</div>
        </div>
        ${sub ? `<div class="nav-sub">${sub}</div>` : ""}
      `;

      let html = "";
      html += group("个人中心",
        item("dashboard","📊","能力仪表盘","") +
        item("ops","🛰️","战术任务","沉浸式闯关训练") +
        item("smart","🗺️","智能学习","每日计划/微课/复习") +
        item("training","🎯","训练中心","IRT自适应推荐") +
        item("wrongbook","📌","错题本","高频错误聚合复习") +
        item("badges","🏅","勋章/打卡","学习动力与排行榜") +
        item("analysis","📈","分析报告","BKT追踪可视化")
      );
      html += group("智能辅助",
        item("ai","🤖","AI教辅","讲解/计划/情绪支持") +
        item("knowledge","🧠","知识点画像","薄弱点定位与专项练习")
      );
      if(isAdmin){
        html += group("系统管理",
          item("monitor","🖥️","系统监控","请求统计/回流校准") +
          item("question","📚","题库管理","增删改查/CSV导入") +
          item("users","👥","用户管理","角色/重置/删除")
        );
      }
      html += group("配置",
        item("settings","⚙️","系统设置","主题/动效/AI/导入导出")
      );

      nav.innerHTML = html;
    }

    async switchPage(page){
      // stop voice input when switching pages
      this.stopVoiceInput(true);
      // permissions check (UI side)
      const role = this.effectiveRole();
      const isAdmin = (role === "admin" || role === "instructor");
      if(["monitor","question","users"].includes(page) && !isAdmin){
        toast("该页面需要管理员/教员权限", "warn");
        page = "dashboard";
      }
      this.currentPage = page;
      $("#currentPage").textContent = this.pages[page] || "ArmEdu";

      // update nav active
      $$(".nav-item").forEach(el=>{
        el.classList.toggle("active", el.dataset.page === page);
      });

      await this.renderPage();
    }

    // ---------- page renders ----------
    async renderPage(){
      const route = $("#route");
      if(!route) return;

      try{
        route.innerHTML = `<div class="card"><div class="h2">加载中…</div><div class="help">正在获取数据与渲染界面</div></div>`;
        let html = "";
        if(this.currentPage === "dashboard"){
          await this.loadDashboard();
          html = this.tplDashboard();
        }else if(this.currentPage === "ops"){
          await this.loadOps();
          html = this.tplOps();
        }else if(this.currentPage === "smart"){
          await this.loadSmart();
          html = this.tplSmart();
        }else if(this.currentPage === "training"){
          await this.loadTraining();
          html = this.tplTraining();
        }else if(this.currentPage === "wrongbook"){
          await this.loadWrongbook();
          html = this.tplWrongbook();
        }else if(this.currentPage === "badges"){
          await this.loadBadges();
          html = this.tplBadges();
        }else if(this.currentPage === "analysis"){
          await this.loadAnalysis();
          html = this.tplAnalysis();
        }else if(this.currentPage === "ai"){
          html = this.tplAI();
        }else if(this.currentPage === "knowledge"){
          await this.loadKnowledge();
          html = this.tplKnowledge();
        }else if(this.currentPage === "monitor"){
          await this.loadMonitor();
          html = this.tplMonitor();
        }else if(this.currentPage === "question"){
          await this.loadQuestionBank();
          html = this.tplQuestionBank();
        }else if(this.currentPage === "users"){
          await this.loadUsers();
          html = this.tplUsers();
        }else if(this.currentPage === "settings"){
          html = this.tplSettings();
        }else{
          await this.loadDashboard();
          html = this.tplDashboard();
        }
        route.innerHTML = html;

        // after render hooks
        if(this.currentPage === "dashboard"){
          this.drawDashboardCharts();
        }
        if(this.currentPage === "ops"){
          this.afterOpsRender();
        }
        if(this.currentPage === "analysis"){
          this.drawAnalysisCharts();
        }
        if(this.currentPage === "monitor"){
          this.drawMonitorCharts();
        }
        if(this.currentPage === "settings"){
          this.populateVoiceSelect();
        }
      }catch(e){
        route.innerHTML = `<div class="card"><div class="h2">渲染失败</div><div class="help">${safeText(e.message)}</div></div>`;
      }
    }

    async loadDashboard(){
      const [profile, skills, recent, thetaSeries] = await Promise.all([
        this.api("/api/profile"),
        this.api("/api/skills"),
        this.api("/api/responses/recent?limit=5"),
        this.api("/api/analytics/theta_series?limit=24"),
      ]);
      this.state.profile = profile;
      this.state.skills = skills.skills || [];
      this.state.recent = recent.recent || [];
      this.state.thetaSeries = thetaSeries.series || [];
    }

    tplDashboard(){
      const p = this.state.profile;
      const theta = p?.theta ?? 0;
      const answered = p?.stats?.answered ?? 0;
      const acc = (p?.stats?.accuracy ?? 0) * 100;
      const totalT = p?.stats?.total_time_s ?? 0;

      const prog = mapThetaToPct(theta);

      const recent = (this.state.recent || []).slice(0,3).map(r=>{
        const badge = r.correct ? "ok" : "bad";
        const t = r.correct ? "正确" : "错误";
        return `
          <div style="margin-bottom:10px;">
            <div><span class="badge ${badge}">${t}</span> <b>${safeText(r.skill)}</b></div>
            <div class="mini">${safeText(r.stem).slice(0,42)}${safeText(r.stem).length>42?"…":""}</div>
          </div>
        `;
      }).join("");
      const aiPlan = safeText(this.state.ai_unit_plan || "");
      const aiPlanShort = aiPlan ? (aiPlan.length > 260 ? aiPlan.slice(0,260) + "…" : aiPlan) : "";


      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">能力仪表盘 <small>${safeText(this.currentUser?.username || "")}</small></h2>
              <div class="hr"></div>

              <div class="row">
                <div class="kv"><span>IRT能力值 θ</span><b>${theta.toFixed(2)}</b></div>
                <div class="kv"><span>训练完成</span><b>${answered} 次</b></div>
                <div class="kv"><span>平均正确率</span><b>${acc.toFixed(1)}%</b></div>
                <div class="kv"><span>学习时长</span><b>${formatSec(totalT)}</b></div>
              </div>

              <div class="label" style="margin-top: 18px;">θ 进展（映射进度条）</div>
              <div class="progress"><i style="width:${prog.toFixed(0)}%"></i></div>
              <div class="mini" style="margin-top:6px;">提示：θ 为能力连续值；掌握度由 BKT 追踪，推荐引擎综合考虑薄弱点与难度贴合。</div>
            </div>
          </div>

          <div class="col-8">
            <div class="card">
              <h2 class="h2">知识点掌握度（BKT）</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="knowledgeChart"></canvas>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="card">
              <h2 class="h2">近期活动</h2>
              <div class="help" style="margin-top:10px;">
                ${recent || '<div class="mini">暂无作答记录。去“训练中心”开始第一题吧。</div>'}
              </div>
              <div class="hr"></div>
              <div class="row">
                <button class="btn primary" data-action="start-training">继续训练</button>
                <button class="btn ghost" data-action="open-settings">系统设置</button>
              </div>
            </div>
          </div>


          <div class="col-12">
            <div class="card" style="background: rgba(0,229,255,0.04);">
              <h2 class="h2">AI单元 <small>一键生成今日计划 / 快速进入 AI 教辅</small></h2>
              <div class="help">
                该单元会结合你的 θ、掌握度与最近作答记录，自动给出可执行的学习安排（默认 30-45 分钟）。
              </div>
              <div class="row" style="margin-top:10px;">
                <button class="btn primary" data-action="aiunit-plan">生成今日学习计划</button>
                <button class="btn" data-action="aiunit-weak">生成薄弱点突击计划</button>
                <button class="btn ghost" style="margin-left:auto;" data-action="aiunit-open">打开 AI 教辅</button>
              </div>
              <div class="hr"></div>
              <div class="mini" style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(aiPlanShort || "暂无计划。点击上方按钮生成。")}</div>
            </div>
          </div>

          <div class="col-12">
            <div class="card">
              <h2 class="h2">能力曲线（θ）<small>最近 ${Math.max(2,(this.state.thetaSeries||[]).length)} 个点</small></h2>
              <div class="chart-container" style="height:220px;">
                <canvas class="chart-canvas" id="thetaLine"></canvas>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    drawDashboardCharts(){
      // mastery bar
      const canvas = $("#knowledgeChart");
      const p = this.state.profile;
      if(canvas && p){
        const masteryNamed = p.mastery_named || [];
        const labels = masteryNamed.map(x=>x.name.replace(/^第\d+章\s*/,""));
        const values = masteryNamed.map(x=>Math.round((x.p||0)*100));
        drawBarChart(canvas, labels, values);
      }
      // theta line
      const line = $("#thetaLine");
      if(line){
        const series = this.state.thetaSeries || [];
        const labels = series.map((x,i)=>{
          // show last part of date
          const at = safeText(x.at);
          return at ? at.slice(5,10) : String(i+1);
        });
        const values = series.map(x=>Number(x.theta||0));
        if(values.length >= 2){
          drawLineChart(line, labels, values);
        }
      }
    }

    // ---------- Ops: immersive mission mode ----------
    async loadOps(){
      const [profile, skills] = await Promise.all([
        this.api("/api/profile"),
        this.api("/api/skills"),
      ]);
      this.state.profile = profile;
      this.state.skills = skills.skills || [];
    }

    buildOpsMissions(){
      const p = this.state.profile || {};
      const mastery = (p.mastery_named || []).slice();
      // pick weak skills as a特色：薄弱点突击
      const weak = mastery.sort((a,b)=>Number(a.p||0)-Number(b.p||0)).slice(0, 3);
      const weakIds = weak.map(x=>x.skill_id).filter(Boolean);
      const allIds = (this.state.skills || []).map(s=>s.id).filter(Boolean);
      const mixIds = allIds.slice(0, 6);

      const missions = [
        {
          id: "weakstrike",
          icon: "🧨",
          title: "薄弱点突击",
          subtitle: "优先锁定掌握度最低的 3 个章节",
          skill_ids: weakIds,
          total: 8,
          mode: "mix",
          briefing: "指挥部：我们将对你的薄弱点进行‘短时高频’突击训练。目标：用最少题量把关键误区打穿。",
        },
        {
          id: "patrol",
          icon: "🛰️",
          title: "全域巡航",
          subtitle: "覆盖多章节，检验综合能力",
          skill_ids: mixIds,
          total: 10,
          mode: "mix",
          briefing: "电台：进入巡航任务。你将被随机抽检多个知识域，保持节奏，稳住正确率。",
        },
        {
          id: "speedrun",
          icon: "⚡",
          title: "极速拉练",
          subtitle: "更偏向新题 + 更快节奏",
          skill_ids: [],
          total: 12,
          mode: "new",
          briefing: "训练官：本轮为极速拉练，重点是‘快判断+稳复盘’，不要恋战。",
        },
      ];
      return missions;
    }

    tplOps(){
      const missions = this.buildOpsMissions();
      const ops = this.ops || {active:false};
      const active = !!ops.active;
      const prog = active ? Math.round((ops.done / Math.max(1, ops.total)) * 100) : 0;
      const elapsed = active && ops.startedAt ? formatSec((Date.now() - ops.startedAt)/1000) : "--";
      const m = ops.mission;

      const missionCards = missions.map(ms=>{
        const disabled = active;
        const skillsTxt = (ms.skill_ids && ms.skill_ids.length)
          ? `章节：${ms.skill_ids.length} 个 · ${ms.total} 题`
          : `章节：综合 · ${ms.total} 题`;
        return `
          <div class="col-4">
            <div class="card">
              <div class="row" style="align-items:center; gap:10px;">
                <div class="nav-icon" style="width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(0,229,255,0.08);">${ms.icon}</div>
                <div>
                  <div class="h2" style="font-size:14px; margin:0;">${escapeHtml(ms.title)}</div>
                  <div class="mini" style="color:var(--muted);">${escapeHtml(ms.subtitle)}</div>
                </div>
              </div>
              <div class="hr"></div>
              <div class="mini">${escapeHtml(skillsTxt)}</div>
              <div class="row" style="margin-top:12px;">
                <button class="btn primary" data-action="ops-start" data-mid="${escapeHtml(ms.id)}" ${disabled?"disabled":""}>开始任务</button>
                <button class="btn ghost" data-action="ops-briefing" data-mid="${escapeHtml(ms.id)}">简报</button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      const statusCard = active ? `
        <div class="card" style="background: rgba(0,229,255,0.05);">
          <h2 class="h2">任务进行中 <small>${escapeHtml(m?.title||"")}</small></h2>
          <div class="help" style="white-space:pre-wrap;">${escapeHtml(m?.briefing||"")}</div>
          <div class="row" style="margin-top:10px;">
            <div class="kv"><span>进度</span><b>${ops.done}/${ops.total}</b></div>
            <div class="kv"><span>正确</span><b>${ops.correct}</b></div>
            <div class="kv"><span>用时</span><b>${elapsed}</b></div>
          </div>
          <div class="label" style="margin-top:10px;">任务进度</div>
          <div class="progress"><i style="width:${prog}%"></i></div>
          <div class="row" style="margin-top:12px;">
            <button class="btn primary" data-action="ops-open-next">进入下一题</button>
            <button class="btn ghost" data-action="ops-exit">退出任务</button>
            <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="ops_briefing">🔊电台播报</button>
            <button class="btn ghost" data-action="tts-stop">⏹停止</button>
          </div>
          <div class="mini" style="margin-top:10px; color:var(--muted);">提示：做题弹窗内支持语音作答（A/B/C/D），答完可“继续任务”。</div>
        </div>
      ` : `
        <div class="card">
          <h2 class="h2">战术任务模式 <small>让训练更像一次‘行动’</small></h2>
          <div class="help">
            这是一个区别于常规刷题的“沉浸式闯关”：先简报 → 再按节奏出题 → 最后复盘。
            你依然使用同一套题库与评测引擎，但体验更像指挥台。
          </div>
        </div>
      `;

      // cache tts text
      this._ttsCache = this._ttsCache || {};
      this._ttsCache.ops_briefing = m?.briefing || "";

      return `
        <div class="grid">
          <div class="col-12">${statusCard}</div>
          <div class="col-12">
            <div class="card">
              <h2 class="h2">选择任务 <small>三种不同节奏</small></h2>
              <div class="help">${active?"任务进行中时无法开启新任务。先完成或退出当前任务。":"点击‘简报’可先试听/阅读任务说明。"}</div>
            </div>
          </div>
          ${missionCards}
        </div>
      `;
    }

    afterOpsRender(){
      // light hook: no-op for now (reserved for future animation)
    }

    findMissionById(mid){
      return this.buildOpsMissions().find(x=>x.id===mid) || null;
    }

    opsStart(mid){
      const m = this.findMissionById(mid);
      if(!m){ toast("任务不存在", "bad"); return; }
      if(this.ops.active){
        toast("当前已有任务进行中", "warn");
        return;
      }
      this.ops.active = true;
      this.ops.mission = m;
      this.ops.total = Number(m.total || 8);
      this.ops.done = 0;
      this.ops.correct = 0;
      this.ops.startedAt = Date.now();
      this._opsLastItemId = null;

      this._ttsCache = this._ttsCache || {};
      this._ttsCache.ops_briefing = m.briefing || "";

      toast("任务已开始：" + (m.title || ""), "ok");
      this.renderPage();
      // auto open the first question for a more "不同"体验
      this.opsOpenNext();
      // optional radio speak
      if(this.settings.voice?.enabled !== false && (m.briefing||"").trim()){
        this.ttsSpeak(m.briefing);
      }
    }

    opsExit(){
      if(!this.ops.active){ toast("当前没有进行中的任务", "warn"); return; }
      this.ops.active = false;
      this.ops.mission = null;
      this.ops.startedAt = null;
      this._opsLastItemId = null;
      toast("已退出任务", "ok");
      this.renderPage();
    }

    opsBriefing(mid){
      const m = this.findMissionById(mid);
      if(!m){ toast("任务不存在", "bad"); return; }
      this._ttsCache = this._ttsCache || {};
      this._ttsCache["ops_preview"] = m.briefing || "";
      showModal(
        "任务简报",
        `<div class="help" style="white-space:pre-wrap; line-height:1.7;">${escapeHtml(m.briefing||"")}</div>`,
        `<button class="btn primary" data-action="ops-start" data-mid="${escapeHtml(m.id)}">开始任务</button>
         <button class="btn ghost" data-action="tts-speak" data-tts="ops_preview">🔊播报</button>
         <button class="btn ghost" data-action="modal-close">关闭</button>`
      );
    }

    async opsOpenNext(){
      if(!this.ops.active){ toast("请先开始任务", "warn"); return; }
      if(this.ops.done >= this.ops.total){
        this.opsFinish();
        return;
      }
      const m = this.ops.mission || {};
      let sid = null;
      if(Array.isArray(m.skill_ids) && m.skill_ids.length){
        // pick the weakest among mission skills for adaptive flavor
        const mastery = (this.state.profile?.mastery_named || []).filter(x=>m.skill_ids.includes(x.skill_id));
        mastery.sort((a,b)=>Number(a.p||0)-Number(b.p||0));
        sid = mastery.length ? mastery[0].skill_id : m.skill_ids[this.ops.done % m.skill_ids.length];
      }
      try{
        const url = new URL("/api/items/recommendations", window.location.origin);
        url.searchParams.set("n","1");
        url.searchParams.set("mode", m.mode || "mix");
        if(sid) url.searchParams.set("skill_id", sid);
        const r = await this.api(url.pathname + url.search);
        const item = (r.items && r.items[0]) ? r.items[0] : null;
        if(!item){
          toast("暂无可用题目（题库可能不足）", "warn");
          this.opsFinish();
          return;
        }
        this._quizOrigin = "ops";
        await this.openQuizModalFromItem(item, "ops");
      }catch(e){
        toast("获取题目失败：" + e.message, "bad");
      }
    }

    opsFinish(){
      const m = this.ops.mission || {};
      const acc = this.ops.total ? Math.round((this.ops.correct/Math.max(1,this.ops.total))*100) : 0;
      const cost = this.ops.startedAt ? formatSec((Date.now() - this.ops.startedAt)/1000) : "--";
      const body = `
        <div class="card" style="background:rgba(0,229,255,0.05);">
          <h2 class="h2">任务复盘 <small>${escapeHtml(m.title||"")}</small></h2>
          <div class="row" style="margin-top:10px;">
            <div class="kv"><span>完成题数</span><b>${this.ops.total}</b></div>
            <div class="kv"><span>正确率</span><b>${acc}%</b></div>
            <div class="kv"><span>用时</span><b>${cost}</b></div>
          </div>
          <div class="hr"></div>
          <div class="help">建议：现在去“分析报告”看错因分布，再用“薄弱点突击”做一轮短复训，把正确率稳住。</div>
        </div>
      `;
      this.ops.active = false;
      this.ops.mission = null;
      this.ops.startedAt = null;
      this._opsLastItemId = null;
      this.renderPage();
      showModal("任务完成", body,
        `<button class="btn primary" data-action="goto-analysis">查看分析</button>
         <button class="btn ghost" data-action="modal-close">关闭</button>`
      );
    }

    // ---------- Smart learning (daily plan / micro-lessons / wrongbook / badges) ----------
    async loadSmart(){
      const [plan, lessons, me] = await Promise.all([
        this.api("/api/learning/daily_plan"),
        this.api("/api/lessons"),
        this.api("/api/social/me"),
      ]);
      this.state.dailyPlan = plan;
      this.state.lessons = lessons.lessons || [];
      this.state.social = me;
    }

    tplSmart(){
      const plan = this.state.dailyPlan || {};
      const tasks = (plan.tasks || []).map(t=>{
        const isLesson = t.type === "lesson";
        const isPractice = t.type === "practice";
        const badge = isLesson ? "微课" : isPractice ? "训练" : "错题";
        const badgeCls = isLesson ? "" : isPractice ? "ok" : "warn";
        const title = isLesson ? (t.title || t.skill_name || t.skill_id) : isPractice ? (t.skill_name || t.skill_id) : "错题本复习";
        const meta = isLesson ? `约 ${t.est_min || 8} 分钟` : isPractice ? `建议 ${t.n || 5} 题` : `${t.count || 0} 道待复盘`;
        const actions = isLesson
          ? `<button class="btn primary" data-action="smart-open-lesson" data-skill="${safeText(t.skill_id)}">文字微课</button>
             <button class="btn ghost" data-action="smart-open-video" data-skill="${safeText(t.skill_id)}">AI动画课</button>
             <button class="btn ghost" data-action="smart-start-skill" data-skill="${safeText(t.skill_id)}">做 1 题热身</button>`
          : isPractice
            ? `<button class="btn primary" data-action="smart-start-skill" data-skill="${safeText(t.skill_id)}">开始训练</button>`
            : `<button class="btn primary" data-action="goto-wrongbook">去错题本</button>`;
        return `<div class="plan-task">
          <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap;">
            <span class="badge ${badgeCls}">${badge}</span>
            <b>${safeText(title)}</b>
            <span class="mini" style="margin-left:auto;">${safeText(meta)}</span>
          </div>
          <div class="mini" style="margin-top:8px; line-height:1.65;">${safeText(t.reason || "根据当前掌握情况生成的学习建议")}</div>
          <div class="hr"></div>
          <div class="row" style="gap:8px; flex-wrap:wrap;">${actions}</div>
        </div>`;
      }).join("");

      const me = this.state.social || {};
      const streak = me.streak ? `${me.streak.current || 0} 天` : "--";
      const badgeCount = (me.achievements || []).length;

      const lessonCards = (this.state.lessons || []).map(l=>{
        const p = Number(l.p_mastery ?? l.mastery ?? 0);
        const badgeCls = p < 0.4 ? "bad" : p < 0.7 ? "warn" : "ok";
        const chapterNo = skillChapterNo(l.skill_id);
        const videoText = l.video_completed
          ? "动画课已完成"
          : l.has_video
            ? `动画课 ${Math.max(1, Math.round((Number(l.video_progress||0))*100))}%`
            : "待生成动画课";
        const desc = l.title || "文字微课 + AI 动画课程 + 配套训练";
        return `<div class="lesson-catalog-card">
          <div class="lesson-card-head">
            <span class="lesson-card-index">${chapterNo ? `第 ${chapterNo} 章` : "章节"}</span>
            <span class="badge ${badgeCls}">${Math.round(p*100)}%</span>
          </div>
          <div class="lesson-card-title">${safeText(l.skill_name || l.title)}</div>
          <div class="lesson-card-desc">${safeText(desc)}</div>
          <div class="lesson-card-metrics">
            <span class="metric-pill">当前掌握：${Math.round(p*100)}%</span>
            <span class="metric-pill">${safeText(videoText)}</span>
            <span class="metric-pill">完成 ${safeText(l.completed_count || 0)} 次</span>
          </div>
          <div class="lesson-card-actions">
            <button class="btn ghost" data-action="smart-open-lesson" data-skill="${safeText(l.skill_id)}">文字微课</button>
            <button class="btn ghost" data-action="smart-open-video" data-skill="${safeText(l.skill_id)}">AI动画课</button>
            <button class="btn" data-action="smart-start-skill" data-skill="${safeText(l.skill_id)}">1题热身</button>
          </div>
        </div>`;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">智能学习 <small>每日计划 · 微课 · AI动画课程 · 复习闭环</small></h2>
              <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap;">
                <div class="kv"><span>连续学习</span><b>${streak}</b></div>
                <div class="kv"><span>已解锁勋章</span><b>${badgeCount}</b></div>
                <div class="kv"><span>今日建议</span><b>${(plan.tasks||[]).length} 项</b></div>
                <button class="btn ghost" style="margin-left:auto;" data-action="admin-export-all">导出数据</button>
              </div>
              <div class="help" style="margin-top:10px;">系统会优先安排：薄弱章节补强 → 观看 AI 动画微课 → 小步训练巩固 → 错题复盘。所有 8 个章节都已接入文字微课与动画课程入口。</div>
            </div>
          </div>
          <div class="col-12">
            <div class="smart-layout">
              <div class="card">
                <h3 class="h2" style="font-size:14px;">今日学习清单</h3>
                <div class="help">建议先学后练：先用微课建立框架，再做少量题目巩固，最后回到错题本复盘。</div>
                <div class="hr"></div>
                <div class="plan-list">${tasks || `<div class="mini">暂无计划。先去“训练中心”做几题，系统就能更懂你。</div>`}</div>
              </div>
              <div class="card">
                <h3 class="h2" style="font-size:14px;">微课目录（完整 8 章）</h3>
                <div class="help">每章均支持文字微课、AI 动画微课与配套热身题。改成卡片式目录后，章节标题不会再挤成一列一列的窄排版。</div>
                <div class="lesson-catalog">
                  ${lessonCards || `<div class="mini">暂无微课数据（可运行 seed 生成示例）。</div>`}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    async openLessonModal(skillId){
      if(!skillId){ toast("缺少 skill_id", "warn"); return; }
      try{
        const l = await this.api(`/api/lessons/${encodeURIComponent(skillId)}`);
        const title = l.title || l.skill_name || skillId;
        const content = this.renderMarkdown(l.content_md || "");
        const done = l.completed_count || l.progress?.completed_count || 0;
        const hasVideo = !!(l.video && (l.video.scenes||[]).length);
        const videoChip = hasVideo
          ? `<span class="badge ok">已生成动画课</span>`
          : `<span class="badge warn">可自动生成动画课</span>`;
        const body = `
          <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="badge">微课</span>
            <b>${safeText(title)}</b>
            ${videoChip}
            <span class="mini" style="margin-left:auto;">已完成 ${done} 次</span>
          </div>
          <div class="hr"></div>
          <div style="line-height:1.7; font-size:14px;">${content}</div>
          <div class="hr"></div>
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            <button class="btn primary" data-action="lesson-complete" data-skill="${safeText(skillId)}">我学完了</button>
            <button class="btn" data-action="smart-open-video" data-skill="${safeText(skillId)}">观看 AI 动画课</button>
            <button class="btn ghost" data-action="tts-speak" data-tts="lesson">🔊朗读本页</button>
            <button class="btn ghost" data-action="modal-close" style="margin-left:auto;">关闭</button>
          </div>
        `;
        this._ttsCache = this._ttsCache || {};
        this._ttsCache.lesson = `${title}。${(l.content_md||"").replace(/\s+/g," ")}`;
        showModal("智能微课", body, "");
      }catch(e){
        toast("打开微课失败：" + e.message, "bad");
      }
    }

    async completeLesson(skillId){
      try{
        await this.api(`/api/lessons/${encodeURIComponent(skillId)}/complete`, {method:"POST", body:{}});
        toast("已记录完成", "ok");
        if(this.currentPage === "smart"){
          await this.loadSmart();
          this.renderPage();
        }
      }catch(e){
        toast("记录失败：" + e.message, "bad");
      }
    }

    async openLessonVideoModal(skillId){
      if(!skillId){ toast("缺少 skill_id", "warn"); return; }
      try{
        const v = await this.api(`/api/lessons/${encodeURIComponent(skillId)}/video`);
        const progress = v.progress || {};
        const production = v.production || {};
        const adminOps = (this.currentUser && ["admin","instructor"].includes(this.currentUser.role))
          ? `<button class="btn ghost" data-action="lesson-video-regenerate" data-skill="${safeText(skillId)}">AI重新生成</button>`
          : "";
        const sourceText = v.source === "external_ai" ? "外部模型生成" : "离线模板生成";
        const interfaceFields = production.interface_spec?.scene_fields || [];
        const body = `
          <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="badge">AI动画微课</span>
            <b>${safeText(v.title || skillId)}</b>
            <span class="mini">${safeText(v.skill_name || skillId)} · ${Math.max(1, Math.round((v.duration_sec||60)/60))} 分钟</span>
            <span class="mini" style="margin-left:auto;">${safeText(sourceText)}</span>
          </div>
          <div class="help" style="margin-top:8px;">这里按论文里的思路展示完整 AI 动画制作链路：双智能体分镜 → JSON 中间表示 → Manim 代码草案 → 校验修复 → 配音字幕与渲染。</div>
          <div class="lesson-video-shell">
            <div>
              <div class="lesson-video-stage" id="lessonVideoStage">
                <div class="lesson-video-glow"></div>
                <div class="lesson-video-chip" id="lessonVideoIcon">🎬</div>
                <div class="lesson-video-subtitle" id="lessonVideoSubtitle">${safeText(v.summary || "动画课程准备中")}</div>
                <div class="lesson-video-title" id="lessonVideoTitle">课程加载中...</div>
              </div>
              <div class="lesson-video-canvas-wrap" style="margin-top:12px;">
                <canvas class="lesson-video-canvas" id="lessonVideoCanvas"></canvas>
                <div class="lesson-video-note" id="lessonVideoNarration" style="margin-top:12px;"></div>
                <ul class="lesson-video-bullets" id="lessonVideoBullets" style="margin-top:12px;"></ul>
              </div>
            </div>
            <div class="visual-tutor-side">
              <div class="row" style="align-items:center; gap:10px;">
                <div class="progress" style="flex:1;"><i id="lessonVideoProgressBar" style="width:${Math.round((Number(progress.progress||0))*100)}%"></i></div>
                <span class="mini" id="lessonVideoPager">0 / 0</span>
              </div>
              <div class="mini" id="lessonVideoProgressText" style="margin-top:8px;">上次观看进度：${Math.round((Number(progress.progress||0))*100)}%</div>
              <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:12px;">
                <button class="btn ghost" data-action="lesson-video-prev" data-skill="${safeText(skillId)}">上一幕</button>
                <button class="btn primary" data-action="lesson-video-toggle" data-skill="${safeText(skillId)}" id="lessonVideoToggleBtn">暂停</button>
                <button class="btn ghost" data-action="lesson-video-next" data-skill="${safeText(skillId)}">下一幕</button>
                <button class="btn ghost" data-action="tts-speak" data-tts="lesson_video_scene">🔊朗读当前幕</button>
                ${adminOps}
              </div>
              <div class="hr"></div>
              <div class="mini">场景目录</div>
              <div class="scene-rail" id="lessonVideoSceneRail"></div>
              <div class="hr"></div>
              <div class="visual-mini-panel">
                <div class="mini">中间表示接口（PDF 4.1.1）</div>
                <div class="schema-tags" id="lessonVideoSchema">${renderSchemaTags(interfaceFields)}</div>
              </div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">AI 动画制作流程</div>
                <div class="process-list" id="lessonVideoPipeline">${renderPipelineHtml(production.pipeline)}</div>
              </div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">双智能体讲解过程</div>
                <div class="dialogue-stack" id="lessonVideoDialogue"></div>
              </div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">当前幕 Manim 代码草案</div>
                <pre class="code-view" id="lessonVideoCodePreview"></pre>
              </div>
              <div class="hr"></div>
              <div class="row">
                <button class="btn" data-action="lesson-video-complete" data-skill="${safeText(skillId)}" style="margin-left:auto;">学习完成</button>
              </div>
            </div>
          </div>
        `;
        showModal("AI 动画课程", body, "");
        this.initLessonVideoPlayer(v);
      }catch(e){
        toast("打开动画课程失败：" + e.message, "bad");
      }
    }

    initLessonVideoPlayer(video){
      this.destroyLessonVideoPlayer(false);
      const scenes = Array.isArray(video.scenes) ? video.scenes : [];
      const startIdx = clamp((Number(video.progress?.last_scene || 1) - 1), 0, Math.max(0, scenes.length - 1));
      this.lessonVideoPlayer = {
        video,
        index: startIdx,
        playing: true,
        timer: null,
        sceneStartedAt: Date.now(),
        sceneOffsetMs: 0,
        lastSyncedAt: 0,
      };
      this.renderLessonVideoFrame();
      this.lessonVideoPlayer.timer = setInterval(()=> this.tickLessonVideo(), 220);
    }

    destroyLessonVideoPlayer(sync=true){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      if(p.timer){ clearInterval(p.timer); }
      if(sync){ this.syncLessonVideoProgress(true).catch(()=>{}); }
      this.lessonVideoPlayer = null;
    }

    lessonVideoSceneProgress(){
      const p = this.lessonVideoPlayer;
      if(!p) return {sceneProgress:0, overall:0};
      const scenes = p.video.scenes || [];
      if(!scenes.length) return {sceneProgress:0, overall:0};
      const scene = scenes[p.index] || {};
      const durMs = Math.max(4000, Number(scene.duration_sec || 12) * 1000);
      const elapsed = (p.sceneOffsetMs || 0) + (p.playing ? (Date.now() - p.sceneStartedAt) : 0);
      const sceneProgress = clamp(elapsed / durMs, 0, 1);
      return {sceneProgress, overall: clamp((p.index + sceneProgress) / scenes.length, 0, 1)};
    }

    renderLessonVideoFrame(){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      const scenes = p.video.scenes || [];
      const scene = scenes[p.index];
      if(!scene) return;
      const titleEl = $("#lessonVideoTitle");
      const subEl = $("#lessonVideoSubtitle");
      const bulletsEl = $("#lessonVideoBullets");
      const narrEl = $("#lessonVideoNarration");
      const iconEl = $("#lessonVideoIcon");
      const stage = $("#lessonVideoStage");
      const toggle = $("#lessonVideoToggleBtn");
      const rail = $("#lessonVideoSceneRail");
      const schemaEl = $("#lessonVideoSchema");
      const pipelineEl = $("#lessonVideoPipeline");
      const dialogueEl = $("#lessonVideoDialogue");
      const codeEl = $("#lessonVideoCodePreview");
      if(titleEl) titleEl.textContent = scene.title || p.video.title || "动画课程";
      if(subEl) subEl.textContent = scene.subtitle || p.video.summary || "";
      if(iconEl) iconEl.textContent = scene.icon || "🎬";
      if(narrEl) narrEl.textContent = scene.narration || "";
      if(bulletsEl){
        bulletsEl.innerHTML = (scene.bullets || []).map(x=>`<li>${escapeHtml(String(x))}</li>`).join("");
      }
      if(stage){
        stage.style.setProperty("--lesson-accent", scene.accent || "#4f7cff");
        stage.classList.remove("is-enter");
        void stage.offsetWidth;
        stage.classList.add("is-enter");
      }
      if(toggle){ toggle.textContent = p.playing ? "暂停" : "继续播放"; }
      if(rail){
        rail.innerHTML = scenes.map((s, idx)=>`<div class="scene-card ${idx===p.index ? "active" : ""}" data-action="lesson-video-jump" data-idx="${idx}">
            <div class="mini">场景 ${idx+1}</div>
            <div style="margin-top:4px; line-height:1.55;">${escapeHtml(s.title || `场景${idx+1}`)}</div>
          </div>`).join("");
      }
      const production = p.video.production || {};
      const sceneNo = Number(scene.scene_no || (p.index + 1));
      const round = (production.dual_agent_rounds || []).find(x=>Number(x.scene_no || 0) === sceneNo);
      const blueprint = (production.manim_blueprints || []).find(x=>Number(x.scene_no || 0) === sceneNo);
      if(schemaEl) schemaEl.innerHTML = renderSchemaTags(production.interface_spec?.scene_fields || []);
      if(pipelineEl) pipelineEl.innerHTML = renderPipelineHtml(production.pipeline || []);
      if(dialogueEl) dialogueEl.innerHTML = renderDialogueHtml(round, blueprint);
      if(codeEl) codeEl.textContent = (blueprint && (blueprint.code_preview || blueprint.manim_hint)) ? (blueprint.code_preview || blueprint.manim_hint) : "// 当前幕暂无代码草案";
      const prog = this.lessonVideoSceneProgress();
      const canvas = $("#lessonVideoCanvas");
      if(canvas) drawVisualLessonScene(canvas, scene, prog.sceneProgress);
      this._ttsCache = this._ttsCache || {};
      this._ttsCache.lesson_video_scene = `${scene.title || ''}。${(scene.bullets||[]).join('；')}。${scene.narration || ''}`;
      this.updateLessonVideoProgressBar();
    }

    updateLessonVideoProgressBar(){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      const scenes = p.video.scenes || [];
      if(!scenes.length) return;
      const scene = scenes[p.index] || {};
      const prog = this.lessonVideoSceneProgress();
      const bar = $("#lessonVideoProgressBar");
      const pager = $("#lessonVideoPager");
      const txt = $("#lessonVideoProgressText");
      if(bar) bar.style.width = `${Math.round(prog.overall * 100)}%`;
      if(pager) pager.textContent = `${p.index + 1} / ${scenes.length}`;
      if(txt) txt.textContent = `观看进度：${Math.round(prog.overall * 100)}% · 当前场景约 ${scene.duration_sec || 12}s`;
    }

    tickLessonVideo(){
      const p = this.lessonVideoPlayer;
      if(!p || !p.playing) return;
      const scenes = p.video.scenes || [];
      const scene = scenes[p.index];
      if(!scene) return;
      const durMs = Math.max(4000, Number(scene.duration_sec || 12) * 1000);
      const elapsed = (p.sceneOffsetMs || 0) + (Date.now() - p.sceneStartedAt);
      if(elapsed >= durMs){
        if(p.index < scenes.length - 1){
          p.index += 1;
          p.sceneStartedAt = Date.now();
          p.sceneOffsetMs = 0;
          this.renderLessonVideoFrame();
          this.syncLessonVideoProgress(true).catch(()=>{});
        }else{
          p.playing = false;
          p.sceneOffsetMs = durMs;
          this.renderLessonVideoFrame();
          this.syncLessonVideoProgress(true).catch(()=>{});
        }
      }else{
        const canvas = $("#lessonVideoCanvas");
        if(canvas) drawVisualLessonScene(canvas, scene, this.lessonVideoSceneProgress().sceneProgress);
      }
      this.updateLessonVideoProgressBar();
      if(!p.lastSyncedAt || Date.now() - p.lastSyncedAt > 5000){
        p.lastSyncedAt = Date.now();
        this.syncLessonVideoProgress(true).catch(()=>{});
      }
    }

    lessonVideoPrev(){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      p.index = Math.max(0, p.index - 1);
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderLessonVideoFrame();
      this.syncLessonVideoProgress(true).catch(()=>{});
    }

    lessonVideoNext(){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      const scenes = p.video.scenes || [];
      p.index = Math.min(Math.max(0, scenes.length - 1), p.index + 1);
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderLessonVideoFrame();
      this.syncLessonVideoProgress(true).catch(()=>{});
    }

    lessonVideoJump(idx){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      const scenes = p.video.scenes || [];
      p.index = clamp(Number(idx || 0), 0, Math.max(0, scenes.length - 1));
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderLessonVideoFrame();
      this.syncLessonVideoProgress(true).catch(()=>{});
    }

    toggleLessonVideoPlay(){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      if(p.playing){
        p.sceneOffsetMs = (p.sceneOffsetMs || 0) + (Date.now() - p.sceneStartedAt);
        p.playing = false;
      }else{
        p.playing = true;
        p.sceneStartedAt = Date.now();
      }
      this.renderLessonVideoFrame();
    }

    async syncLessonVideoProgress(silent=true){
      const p = this.lessonVideoPlayer;
      if(!p) return;
      const scenes = p.video.scenes || [];
      if(!scenes.length) return;
      const prog = this.lessonVideoSceneProgress();
      const progress = prog.overall;
      const watched_sec = Math.round(progress * Number(p.video.duration_sec || 0));
      try{
        await this.api(`/api/lessons/${encodeURIComponent(p.video.skill_id)}/video/progress`, {
          method:"POST",
          body:{progress, watched_sec, last_scene: p.index + 1}
        });
      }catch(e){
        if(!silent) throw e;
      }
    }

    async completeLessonVideo(skillId){
      try{
        await this.syncLessonVideoProgress(true);
        await this.api(`/api/lessons/${encodeURIComponent(skillId)}/video/complete`, {method:"POST", body:{}});
        toast("已记录动画课程学习完成", "ok");
        if(this.currentPage === "smart" || this.currentPage === "knowledge"){
          if(this.currentPage === "smart") await this.loadSmart();
          if(this.currentPage === "knowledge") await this.loadKnowledge();
          this.renderPage();
        }
      }catch(e){
        toast("记录失败：" + e.message, "bad");
      }
    }

    async generateLessonVideo(skillId, useExternal=true, quiet=false){
      try{
        const cfg = this.getAiConfig();
        const r = await this.api(`/api/admin/lessons/${encodeURIComponent(skillId)}/video/generate`, {
          method:"POST",
          body:{use_external: !!useExternal, force: true, config: cfg}
        });
        if(!quiet){
          toast(r.used_external ? "已用外部模型生成动画课程" : "已按离线模板生成动画课程", r.used_external ? "ok" : "warn");
        }
        if(this.currentPage === "smart") await this.loadSmart();
        if(this.currentPage === "knowledge") await this.loadKnowledge();
        if(["smart","knowledge"].includes(this.currentPage)) this.renderPage();
        return r;
      }catch(e){
        if(!quiet) toast("生成失败：" + e.message, "bad");
        throw e;
      }
    }

    buildVisualPromptFromItem(it, answerKey=null){
      const choices = (it.choices || []).map((c,i)=>`${String.fromCharCode(65+i)}. ${c}`).join("\n");
      const correctText = (answerKey !== null && answerKey !== undefined) ? `\n正确答案：${String.fromCharCode(65 + Number(answerKey))}` : "";
      return `请把这道题做成动画讲题，要求给出思路、关键公式、图像或运动过程，并在结尾总结易错点。
题目：${it.stem}
选项：
${choices}${correctText}`;
    }

    async openVisualTutorForItem(itemId, answerKey=null){
      try{
        const it = await this.api(`/api/items/${Number(itemId)}`);
        const prompt = this.buildVisualPromptFromItem(it, answerKey);
        const skillName = it.skill_name || it.skill || "题目讲解";
        await this.openVisualTutorModal(prompt, "auto", {title: `动态讲题 · ${skillName}`});
      }catch(e){
        toast("打开动态讲题失败：" + e.message, "bad");
      }
    }

    async openVisualTutorFromInput(){
      const input = $("#visualPrompt");
      const message = (input ? input.value : "").trim();
      if(!message){ toast("请先输入题目或知识点", "warn"); return; }
      await this.openVisualTutorModal(message, "auto", {title:"动态讲题"});
    }

    async openVisualTutorModal(question, subject="auto", opts={}){
      try{
        const cfg = this.getAiConfig();
        const payload = await this.api("/api/ai/visual_solve", {
          method:"POST",
          body:{question, subject, config: cfg}
        });
        const title = opts.title || payload.title || "动态讲题";
        const process = payload.teaching_process || {};
        const body = `
          <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="badge">动态讲题</span>
            <b>${safeText(payload.title || title)}</b>
            <span class="mini">${safeText(payload.poster_text || '')}</span>
            <span class="mini" style="margin-left:auto;">${payload.used_external ? '外部模型脚本' : '离线可视化脚本'}</span>
          </div>
          <div class="help" style="margin-top:8px;">支持数学/物理题动画讲解：函数图像、傅里叶级数、抛体运动、简谐振动，以及白板式推导与语音讲解。右侧会同步显示题型识别、分镜规划和绘图脚本。</div>
          <div class="visual-tutor-shell">
            <div>
              <div class="visual-stage">
                <canvas class="visual-canvas" id="visualTutorCanvas"></canvas>
                <div class="lesson-video-note" id="visualTutorNarration" style="margin-top:12px;"></div>
                <ul class="lesson-video-bullets" id="visualTutorBullets" style="margin-top:12px;"></ul>
              </div>
            </div>
            <div class="visual-tutor-side">
              <div class="row" style="align-items:center; gap:10px;">
                <div class="progress" style="flex:1;"><i id="visualTutorProgressBar" style="width:0%"></i></div>
                <span class="mini" id="visualTutorPager">0 / 0</span>
              </div>
              <div class="mini" id="visualTutorProgressText" style="margin-top:8px;">准备开始动画讲题</div>
              <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:12px;">
                <button class="btn ghost" data-action="visual-prev">上一幕</button>
                <button class="btn primary" data-action="visual-toggle" id="visualTutorToggleBtn">暂停</button>
                <button class="btn ghost" data-action="visual-next">下一幕</button>
                <button class="btn ghost" data-action="tts-speak" data-tts="visual_tutor_scene">🔊朗读当前幕</button>
              </div>
              <div class="hr"></div>
              <div class="mini">讲题分镜</div>
              <div class="scene-list" id="visualTutorSceneList"></div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">讲题生成流程</div>
                <div class="process-list" id="visualTutorPipeline">${renderPipelineHtml(process.pipeline)}</div>
              </div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">当前幕绘制说明</div>
                <div class="scene-meta-list" id="visualTutorMeta"></div>
              </div>
              <div class="visual-mini-panel" style="margin-top:12px;">
                <div class="mini">当前幕绘图脚本</div>
                <pre class="code-view" id="visualTutorCodePreview"></pre>
              </div>
            </div>
          </div>
        `;
        showModal(title, body, "");
        this.initVisualTutorPlayer(payload);
      }catch(e){
        toast("动态讲题生成失败：" + e.message, "bad");
      }
    }

    initVisualTutorPlayer(payload){
      this.destroyVisualTutorPlayer(false);
      this.visualTutorPlayer = {
        payload,
        index: 0,
        playing: true,
        timer: null,
        sceneStartedAt: Date.now(),
        sceneOffsetMs: 0,
      };
      this.renderVisualTutorFrame();
      this.visualTutorPlayer.timer = setInterval(()=> this.tickVisualTutor(), 220);
    }

    destroyVisualTutorPlayer(_sync=true){
      const p = this.visualTutorPlayer;
      if(!p) return;
      if(p.timer) clearInterval(p.timer);
      this.visualTutorPlayer = null;
    }

    visualTutorSceneProgress(){
      const p = this.visualTutorPlayer;
      if(!p) return {sceneProgress:0, overall:0};
      const scenes = p.payload.scenes || [];
      if(!scenes.length) return {sceneProgress:0, overall:0};
      const scene = scenes[p.index] || {};
      const durMs = Math.max(4000, Number(scene.duration_sec || 12) * 1000);
      const elapsed = (p.sceneOffsetMs || 0) + (p.playing ? (Date.now() - p.sceneStartedAt) : 0);
      const sceneProgress = clamp(elapsed / durMs, 0, 1);
      return {sceneProgress, overall: clamp((p.index + sceneProgress) / scenes.length, 0, 1)};
    }

    renderVisualTutorFrame(){
      const p = this.visualTutorPlayer;
      if(!p) return;
      const scenes = p.payload.scenes || [];
      const scene = scenes[p.index];
      if(!scene) return;
      const narr = $("#visualTutorNarration");
      const bullets = $("#visualTutorBullets");
      const pager = $("#visualTutorPager");
      const txt = $("#visualTutorProgressText");
      const bar = $("#visualTutorProgressBar");
      const btn = $("#visualTutorToggleBtn");
      const list = $("#visualTutorSceneList");
      const pipelineEl = $("#visualTutorPipeline");
      const metaEl = $("#visualTutorMeta");
      const codeEl = $("#visualTutorCodePreview");
      if(narr) narr.textContent = `${scene.title || ''}：${scene.narration || ''}`;
      if(bullets) bullets.innerHTML = (scene.bullets || []).map(x=>`<li>${escapeHtml(String(x))}</li>`).join("");
      const prog = this.visualTutorSceneProgress();
      if(bar) bar.style.width = `${Math.round(prog.overall * 100)}%`;
      if(pager) pager.textContent = `${p.index + 1} / ${scenes.length}`;
      if(txt) txt.textContent = `讲题进度：${Math.round(prog.overall * 100)}% · 当前场景约 ${scene.duration_sec || 12}s`;
      if(btn) btn.textContent = p.playing ? "暂停" : "继续播放";
      if(list){
        list.innerHTML = scenes.map((s, idx)=>`<div class="scene-card ${idx===p.index ? "active" : ""}" data-action="visual-jump" data-idx="${idx}">
            <div class="mini">场景 ${idx+1}</div>
            <div style="margin-top:4px; line-height:1.55;">${escapeHtml(s.title || `场景${idx+1}`)}</div>
          </div>`).join("");
      }
      const process = p.payload.teaching_process || {};
      const sceneNo = p.index + 1;
      const blueprint = (process.scene_blueprints || []).find(x=>Number(x.scene_no || 0) === sceneNo);
      if(pipelineEl) pipelineEl.innerHTML = renderPipelineHtml(process.pipeline || []);
      if(metaEl) metaEl.innerHTML = renderSceneMetaHtml(blueprint);
      if(codeEl) codeEl.textContent = blueprint?.code_preview || "// 当前幕暂无绘图脚本";
      const canvas = $("#visualTutorCanvas");
      if(canvas) drawVisualLessonScene(canvas, scene, prog.sceneProgress);
      this._ttsCache = this._ttsCache || {};
      this._ttsCache.visual_tutor_scene = `${scene.title || ''}。${(scene.bullets||[]).join('；')}。${scene.narration || ''}`;
    }

    tickVisualTutor(){
      const p = this.visualTutorPlayer;
      if(!p || !p.playing) return;
      const scenes = p.payload.scenes || [];
      const scene = scenes[p.index];
      if(!scene) return;
      const durMs = Math.max(4000, Number(scene.duration_sec || 12) * 1000);
      const elapsed = (p.sceneOffsetMs || 0) + (Date.now() - p.sceneStartedAt);
      if(elapsed >= durMs){
        if(p.index < scenes.length - 1){
          p.index += 1;
          p.sceneStartedAt = Date.now();
          p.sceneOffsetMs = 0;
        }else{
          p.playing = false;
          p.sceneOffsetMs = durMs;
        }
      }
      this.renderVisualTutorFrame();
    }

    visualTutorPrev(){
      const p = this.visualTutorPlayer;
      if(!p) return;
      p.index = Math.max(0, p.index - 1);
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderVisualTutorFrame();
    }

    visualTutorNext(){
      const p = this.visualTutorPlayer;
      if(!p) return;
      const scenes = p.payload.scenes || [];
      p.index = Math.min(Math.max(0, scenes.length - 1), p.index + 1);
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderVisualTutorFrame();
    }

    visualTutorJump(idx){
      const p = this.visualTutorPlayer;
      if(!p) return;
      const scenes = p.payload.scenes || [];
      p.index = clamp(Number(idx || 0), 0, Math.max(0, scenes.length - 1));
      p.sceneStartedAt = Date.now();
      p.sceneOffsetMs = 0;
      this.renderVisualTutorFrame();
    }

    toggleVisualTutorPlay(){
      const p = this.visualTutorPlayer;
      if(!p) return;
      if(p.playing){
        p.sceneOffsetMs = (p.sceneOffsetMs || 0) + (Date.now() - p.sceneStartedAt);
        p.playing = false;
      }else{
        p.playing = true;
        p.sceneStartedAt = Date.now();
      }
      this.renderVisualTutorFrame();
    }

    async loadWrongbook(){
      const r = await this.api("/api/learning/wrongbook?limit=60");
      this.state.wrongbook = r.items || [];
      this._wrongIdx = 0;
    }

    tplWrongbook(){
      const rows = (this.state.wrongbook||[]).map(it=>{
        const stem = safeText(it.stem || "");
        const last = safeText(it.last_wrong_at || "").slice(0,16).replace("T"," ");
        return `<tr>
          <td>${safeText(it.skill_name || it.skill_id)}</td>
          <td>${stem.slice(0,48)}${stem.length>48?"…":""}</td>
          <td><span class="badge warn">${it.wrong_count || 0}</span></td>
          <td class="mini">${last || "--"}</td>
          <td><button class="btn primary" data-action="wrong-practice" data-id="${it.id}">重练</button></td>
        </tr>`;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">错题本 <small>把最难的题变成最熟的题</small></h2>
              <div class="help">按“最近错误时间”排序。建议先把高频错题复盘 1-2 轮，再回到混合推荐训练。</div>
              <div class="hr"></div>
              <table class="table">
                <thead><tr><th>章节</th><th>题干</th><th>错次数</th><th>最近错</th><th></th></tr></thead>
                <tbody>
                  ${rows || `<tr><td colspan="5" class="mini">暂无错题 🎉 你可以去“训练中心”继续挑战。</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    async openWrongItem(itemId){
      try{
        const it = await this.api(`/api/items/${Number(itemId)}`);
        this._quizOrigin = "wrongbook";
        this._wrongQueue = (this.state.wrongbook||[]).map(x=>Number(x.id)).filter(Boolean);
        this._wrongIdx = Math.max(0, this._wrongQueue.indexOf(Number(itemId)));
        await this.openQuizModalFromItem(it, "wrongbook");
      }catch(e){
        toast("打开错题失败：" + e.message, "bad");
      }
    }

    openNextWrong(){
      const q = this._wrongQueue || [];
      if(!q.length){ toast("错题队列为空", "warn"); return; }
      this._wrongIdx = (Number(this._wrongIdx||0) + 1) % q.length;
      const next = q[this._wrongIdx];
      this.openWrongItem(next);
    }

    async loadBadges(){
      const [me, lb] = await Promise.all([
        this.api("/api/social/me"),
        this.api("/api/social/leaderboard?limit=12"),
      ]);
      this.state.social = me;
      this.state.leaderboard = lb.leaderboard || [];
    }

    tplBadges(){
      const me = this.state.social || {};
      const streak = me.streak || {current:0, best:0};
      const ach = me.achievements || [];
      const achRows = ach.map(a=>`<div class="row" style="margin:6px 0;">
        <span class="badge ok">🏅</span>
        <b>${safeText(a.title)}</b>
        <span class="mini" style="margin-left:auto;">${safeText(a.unlocked_at||"").slice(0,10)}</span>
      </div><div class="mini" style="margin-left:34px; color:var(--muted);">${safeText(a.desc||"")}</div>`).join("");

      const lbRows = (this.state.leaderboard||[]).map((u,idx)=>`<tr>
        <td>${idx+1}</td>
        <td>${safeText(u.username)}</td>
        <td>${safeText(u.answered||0)}</td>
        <td>${Number(u.accuracy||0)*100 ? (Number(u.accuracy)*100).toFixed(1)+"%" : "0.0%"}</td>
        <td>${u.theta!==null && u.theta!==undefined ? Number(u.theta).toFixed(2) : "--"}</td>
      </tr>`).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">勋章/打卡 <small>用可见的进步驱动持续学习</small></h2>
              <div class="row" style="margin-top:10px;">
                <div class="kv"><span>当前连续</span><b>${streak.current||0} 天</b></div>
                <div class="kv"><span>最佳连续</span><b>${streak.best||0} 天</b></div>
                <div class="kv"><span>已解锁</span><b>${ach.length} 枚</b></div>
                <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="badges">🔊朗读</button>
              </div>
              <div class="help" style="margin-top:10px;">小建议：每天 5~10 分钟也算打卡，关键是不断档。</div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h3 class="h2" style="font-size:14px;">我的勋章</h3>
              <div class="hr"></div>
              ${achRows || `<div class="mini">还没有勋章。先去做 1 题，马上就能解锁第一枚！</div>`}
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h3 class="h2" style="font-size:14px;">排行榜</h3>
              <div class="help">按作答量优先，其次正确率、能力 θ。</div>
              <div class="hr"></div>
              <table class="table">
                <thead><tr><th>#</th><th>用户</th><th>作答</th><th>正确率</th><th>θ</th></tr></thead>
                <tbody>
                  ${lbRows || `<tr><td colspan="5" class="mini">暂无数据。</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    async loadTraining(){
      const [profile, skills, skillStats] = await Promise.all([
        this.api("/api/profile"),
        this.api("/api/skills"),
        this.api("/api/analytics/skill_stats"),
      ]);
      this.state.profile = profile;
      this.state.skills = skills.skills || [];
      this.state.skillStats = skillStats.skills || [];
    }

    tplTraining(){
      const statsMap = {};
      (this.state.skillStats||[]).forEach(s=>{ statsMap[s.skill_id] = s; });

      const cards = (this.state.skills||[]).map(s=>{
        const st = statsMap[s.id] || {};
        const p = (st.p_mastery ?? 0.2);
        const prog = clamp(p*100,0,100);
        const level = p < 0.4 ? "初级" : p < 0.7 ? "中级" : "提高";
        const badgeCls = p < 0.4 ? "bad" : p < 0.7 ? "warn" : "ok";
        const answered = st.answered ?? 0;
        const acc = ((st.accuracy ?? 0)*100).toFixed(0);

        return `
          <div class="col-4">
            <div class="card">
              <h3 class="h2" style="font-size:14px;">${safeText(s.name)}</h3>
              <span class="badge ${badgeCls}">${level}</span>
              <div class="label">掌握度</div>
              <div class="progress"><i style="width:${prog.toFixed(0)}%"></i></div>
              <div class="row" style="margin-top:10px;">
                <span class="mini">已答：${answered} · 正确率：${acc}%</span>
                <button class="btn primary" style="margin-left:auto;" data-action="start-training" data-skill="${safeText(s.id)}">开始</button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">训练中心 <small>IRT 自适应推荐 + BKT 追踪</small></h2>
              <div class="help">
                选择章节开始训练；系统会根据你的 θ 与掌握度，推荐更合适的题目（薄弱点优先 + 难度贴合）。
              </div>
              <div class="hr"></div>
              <div class="row">
                <span class="badge">模式</span>
                <select class="select" id="trainMode" style="max-width:160px;">
                  <option value="mix">混合推荐</option>
                  <option value="new">优先新题</option>
                  <option value="review">优先复训</option>
                </select>
                <button class="btn primary" data-action="start-training">一键开始推荐训练</button>
                <span class="mini" style="margin-left:auto;">提示：作答后会实时更新 θ 与掌握度。</span>
              </div>
            </div>
          </div>
          ${cards}
        </div>
      `;
    }

    async startTraining(skillId=null){
      const modeSel = $("#trainMode");
      const mode = modeSel ? modeSel.value : "mix";
      await this.openQuizModal({skillId, mode});
    }

    async openQuizModal({skillId=null, mode="mix"} = {}){
      const startedAt = performance.now();
      try{
        const url = new URL("/api/items/recommendations", window.location.origin);
        url.searchParams.set("n","1");
        url.searchParams.set("mode", mode);
        if(skillId) url.searchParams.set("skill_id", skillId);
        const r = await this.api(url.pathname + url.search);
        const item = (r.items && r.items[0]) ? r.items[0] : null;
        if(!item){
          toast("暂无可推荐题目（可能已全部做完/模式过滤）", "warn");
          return;
        }
        this._quizStartedAt = startedAt;
        this._quizOrigin = "training";
        await this.openQuizModalFromItem(item, "training");
      }catch(e){
        toast("获取题目失败：" + e.message, "bad");
      }
    }

    async openQuizModalFromItem(item, origin="training"){
      // reset timer for this question
      this._quizStartedAt = performance.now();
      const stemRaw = (item.stem || "");
      const stem = safeText(stemRaw);
      const choices = item.choices || [];
      const skillName = safeText(item.skill_name || item.skill || "");
      const skillId = safeText(item.skill_id || item.skillId || "");
      const qtype = safeText(item.qtype || "single");

      // keep current quiz context for voice input
      this._quizCurrent = {
        item_id: Number(item.id),
        skill_id: skillId,
        choices: Array.isArray(choices) ? choices.slice(0) : [],
        qtype: qtype,
        skill_name: skillName,
      };
      this._quizAnswered = false;

      this._ttsCache = this._ttsCache || {};
      const spokenChoices = choices.map((c, idx)=>`${String.fromCharCode(65+idx)}：${c}`).join("。 ");
      this._ttsCache.quiz_stem = `章节：${skillName}。题目：${stemRaw}。选项：${spokenChoices}`;

      const qtypeBadge = qtype && qtype !== "single" ? `<span class="badge">${safeText(qtype)}</span>` : "";

      const canRec = (this.settings.voice_rec?.enabled !== false) && this.voiceRecSupported();
      const quizListening = !!(this._recogActive && this._recogTarget === "quiz" && this._recogQuizItemId === Number(item.id));
      const quizMicBtn = canRec
        ? `<button class="btn ghost" id="btnQuizVoice" data-action="voice-quiz-toggle">${quizListening ? "🎙停止作答" : "🎙语音作答"}</button>`
        : "";
      const quizDefaultHint = "语音作答：可说“选A/选B/选C/选D” 或 “A/B/C/D”。";
      const quizHintLine = canRec
        ? `<div id="quizVoiceStatus" data-default="${escapeHtml(quizDefaultHint)}" class="mini" style="margin-top:10px; color:${quizListening ? "var(--warn)" : "var(--muted)"};">${quizListening ? "🎙正在听…（说“选A/选B/选C/选D”）" : quizDefaultHint}</div>`
        : "";
      const choicesHtml = choices.map((c, idx)=>`
        <button class="btn" style="width:100%; justify-content:flex-start;" data-action="quiz-choose" data-item="${item.id}" data-choice="${idx}" data-skill="${skillId}">
          <span class="badge"> ${String.fromCharCode(65+idx)} </span>
          <span>${safeText(c)}</span>
        </button>
      `).join("");

      const originBtn = origin === "wrongbook"
        ? `<button class="btn ghost" data-action="goto-wrongbook" style="width:100%;">返回错题本</button>`
        : origin === "ops"
          ? `<button class="btn ghost" data-action="goto-ops" style="width:100%;">返回任务</button>`
          : `<button class="btn ghost" data-action="modal-close" style="width:100%;">返回训练</button>`;

      const body = `
        <div class="split">
          <div>
            <div class="row" style="align-items:center; gap:10px;">
              <div class="badge">章节</div> <span class="mini">${skillName}</span>
              ${qtypeBadge}
              ${quizMicBtn}
              <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="quiz_stem">🔊朗读题目</button>
              <button class="btn ghost" data-action="tts-stop">⏹停止</button>
            </div>
            <div class="hr"></div>
            <div style="font-size:14px; line-height:1.6;">
              <b>题干：</b>${stem}
            </div>
            <div class="hr"></div>
            <div class="label">请选择答案</div>
            <div class="row" style="flex-direction:column; align-items:stretch;">
              ${choicesHtml}
            </div>
            ${quizHintLine}
            <div class="mini" style="margin-top:10px; color: var(--muted);">提示：可在“系统设置”里调整语速/音色。</div>
          </div>
          <div>
            <div class="card" style="background: rgba(0,0,0,0.12);">
              <h3 class="h2" style="font-size:14px;">作答设置</h3>
              <div class="label">错因类型（可选）</div>
              <select class="select" id="errorType">
                <option value="">未标注</option>
                <option value="概念不清">概念不清</option>
                <option value="审题不仔细">审题不仔细</option>
                <option value="记忆混淆">记忆混淆</option>
                <option value="方法不熟">方法不熟</option>
                <option value="粗心">粗心</option>
              </select>
              <div class="label" style="margin-top:14px;">提示</div>
              <div class="help">
                提交后系统会：
                <ul style="margin:6px 0 0 16px; color: var(--muted);">
                  <li>更新该章节掌握度（BKT）</li>
                  <li>更新能力 θ（IRT, MAP）</li>
                  <li>用于下一题推荐</li>
                </ul>
              </div>
              <div class="hr"></div>
              ${originBtn}
            </div>
            <div id="quizResult" style="margin-top:12px;"></div>
          </div>
        </div>
      `;
      showModal("训练作答", body, "");
    }

    async submitAnswer(itemId, choiceIndex, skillId){
      // ensure voice input is stopped before submitting
      this.stopVoiceInput(true);
      const elapsed = (performance.now() - (this._quizStartedAt || performance.now()))/1000.0;
      const errSel = $("#errorType");
      const error_type = errSel ? errSel.value : "";
      try{
        const r = await this.api("/api/answers", {
          method:"POST",
          body:{
            item_id: Number(itemId),
            choice_index: Number(choiceIndex),
            time_spent: Number(elapsed.toFixed(2)),
            error_type: error_type || null,
          }
        });
        const correct = !!r.correct;
        const key = r.answer_key;
        const badge = correct ? "ok" : "bad";

        const pNew = r.mastery?.p_new ?? null;
        const theta = r.theta ?? null;

        // fetch meta (explanation / note) if available
        let meta = null;
        try{ meta = await this.api(`/api/items/${Number(itemId)}/meta`); }catch(_e){}
        const explanation = meta && meta.explanation ? String(meta.explanation) : "";
        const note = meta && meta.note ? String(meta.note) : "";
        this._ttsCache = this._ttsCache || {};
        this._ttsCache.quiz_explain = explanation ? `解析：${explanation}` : "本题暂无预置解析。你可以点击 AI讲解 来生成讲解。";

        const unlocked = (r.unlocked || []);
        const unlockedHtml = unlocked.length ? `
          <div class="hr"></div>
          <div class="row" style="align-items:center; gap:8px;">
            <span class="badge ok">🎉解锁</span>
            <span class="mini">${unlocked.map(c=>`<span class=\"badge\">${escapeHtml(c)}</span>`).join(" ")}</span>
            <button class="btn ghost" style="margin-left:auto;" onclick="window.app.switchPage('badges')">去看看</button>
          </div>
        ` : "";

        const explainHtml = explanation
          ? `<div class="label" style="margin-top:10px;">解析</div>
             <div class="help" style="white-space:pre-wrap;">${escapeHtml(explanation)}</div>`
          : `<div class="mini" style="margin-top:10px; color:var(--muted);">暂无预置解析，可点“AI讲解”。</div>`;

        const origin = this._quizOrigin || "training";

        // update ops progress (once per answered item)
        if(origin === "ops" && this.ops && this.ops.active){
          const curId = Number(itemId);
          if(this._opsLastItemId !== curId){
            this.ops.done = Math.min(this.ops.total, (this.ops.done||0) + 1);
            if(correct) this.ops.correct = (this.ops.correct||0) + 1;
            this._opsLastItemId = curId;
          }
        }

        let nextBtn = "";
        let backBtn = "";
        if(origin === "wrongbook"){
          nextBtn = `<button class="btn primary" data-action="wrong-next">继续错题</button>`;
          backBtn = `<button class="btn ghost" data-action="goto-wrongbook">返回错题本</button>`;
        }else if(origin === "ops"){
          nextBtn = `<button class="btn primary" data-action="ops-next">继续任务</button>`;
          backBtn = `<button class="btn ghost" data-action="goto-ops">返回任务</button>`;
        }else{
          nextBtn = `<button class="btn primary" data-action="quiz-next" data-skill="${safeText(skillId)}">下一题</button>`;
          backBtn = `<button class="btn ghost" data-action="goto-analysis">查看分析</button>`;
        }

        const opsLine = (origin === "ops" && this.ops && this.ops.active)
          ? `<div class="hr"></div>
             <div class="row" style="align-items:center; gap:10px;">
               <span class="badge">任务进度</span>
               <span class="mini">${this.ops.done}/${this.ops.total} · 正确 ${this.ops.correct}</span>
               <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="ops_briefing">🔊电台</button>
             </div>`
          : "";

        const resBox = $("#quizResult");
        if(resBox){
          resBox.innerHTML = `
            <div class="card" style="background: rgba(0,229,255,0.05);">
              <h3 class="h2" style="font-size:14px;">结果反馈</h3>
              <div class="row" style="align-items:center; gap:10px;">
                <span class="badge ${badge}">${correct ? "回答正确" : "回答错误"}</span>
                <span class="mini">正确选项：${String.fromCharCode(65 + Number(key))}</span>
                <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="quiz_explain">🔊朗读解析</button>
                <button class="btn ghost" data-action="tts-stop">⏹停止</button>
              </div>
              <div class="hr"></div>
              <div class="row">
                <div class="kv"><span>新 θ</span><b>${theta !== null ? Number(theta).toFixed(2) : "--"}</b></div>
                <div class="kv"><span>新掌握度</span><b>${pNew !== null ? Math.round(Number(pNew)*100) + "%" : "--"}</b></div>
                <div class="kv"><span>用时</span><b>${formatSec(elapsed)}</b></div>
              </div>

              ${unlockedHtml}

              ${opsLine}
              <div class="hr"></div>
              ${explainHtml}
              <div class="row" style="margin-top:10px;">
                <button class="btn ghost" data-action="quiz-ai-explain" data-item="${Number(itemId)}" data-key="${Number(key)}">🤖 AI讲解</button>
                <button class="btn ghost" data-action="quiz-visual-explain" data-item="${Number(itemId)}" data-key="${Number(key)}">🎬 动态讲题</button>
              </div>
              <div id="aiExplainBox" style="margin-top:10px;"></div>

              <div class="label" style="margin-top:12px;">我的笔记</div>
              <textarea id="noteText" rows="3" style="width:100%; padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.15); color:var(--text);">${escapeHtml(note)}</textarea>
              <div class="row" style="margin-top:10px;">
                <button class="btn ghost" data-action="note-save" data-item="${Number(itemId)}">保存笔记</button>
                <span class="mini" style="margin-left:auto; color:var(--muted);">笔记仅自己可见</span>
              </div>

              <div class="hr"></div>
              <div class="row">
                ${nextBtn}
                ${backBtn}
              </div>
            </div>
          `;
        }
        this._quizAnswered = true;
        toast(correct ? "已记录：正确" : "已记录：错误", correct ? "ok" : "warn");

        // refresh profile cache if on dashboard/training
        this.state.profile = await this.api("/api/profile");
      }catch(e){
        toast("提交失败：" + e.message, "bad");
      }
    }

    async loadAnalysis(){
      const [overview] = await Promise.all([
        this.api("/api/analytics/overview"),
      ]);
      this.state.analytics = overview;
    }

    tplAnalysis(){
      const a = this.state.analytics || {};
      const perSkillRows = (a.per_skill || []).map(s=>{
        const badge = s.p_mastery < 0.4 ? "bad" : s.p_mastery < 0.7 ? "warn" : "ok";
        return `
          <tr>
            <td>${safeText(s.name)}</td>
            <td><span class="badge ${badge}">${Math.round(s.p_mastery*100)}%</span></td>
            <td>${safeText((s.answered||0))}</td>
            <td>${(Number(s.accuracy||0)*100).toFixed(1)}%</td>
            <td>${formatSec(s.avg_time||0)}</td>
          </tr>
        `;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">分析报告 <small>θ / 掌握度 / 用时 / 错因</small></h2>
              <div class="help">
                这里展示你的学习闭环数据：能力 θ 的变化、各章节掌握度、作答用时与错因分布，便于“评→学”优化训练策略。
              </div>
            </div>
          </div>

          <div class="col-8">
            <div class="card">
              <h2 class="h2">能力曲线（θ）</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="growthChart"></canvas>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="card">
              <h2 class="h2">用时分布</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="timePie"></canvas>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">掌握度概览</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="masteryChart"></canvas>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">错因统计</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="errorBar"></canvas>
              </div>
            </div>
          </div>

          <div class="col-12">
            <div class="card">
              <h2 class="h2">章节明细表</h2>
              <table class="table">
                <thead>
                  <tr>
                    <th>章节</th>
                    <th>掌握度</th>
                    <th>已答</th>
                    <th>正确率</th>
                    <th>平均用时</th>
                  </tr>
                </thead>
                <tbody>
                  ${perSkillRows || '<tr><td colspan="5" class="mini">暂无数据</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    drawAnalysisCharts(){
      const a = this.state.analytics || {};
      // theta line
      const growth = $("#growthChart");
      if(growth){
        const series = a.theta_series || [];
        const labels = series.map((x,i)=>{
          const at = safeText(x.at);
          return at ? at.slice(5,10) : String(i+1);
        });
        const values = series.map(x=>Number(x.theta||0));
        if(values.length >= 2) drawLineChart(growth, labels, values);
      }
      // time pie
      const pie = $("#timePie");
      if(pie){
        const td = a.time_dist || [];
        drawPieChart(pie, td.map(x=>x.name), td.map(x=>x.count));
      }
      // mastery bar
      const mc = $("#masteryChart");
      if(mc){
        const m = a.mastery || [];
        drawBarChart(mc, m.map(x=>x.name.replace(/^第\d+章\s*/,"")), m.map(x=>Math.round((x.p||0)*100)));
      }
      // error bar
      const eb = $("#errorBar");
      if(eb){
        const e = a.error_types || [];
        drawBarChart(eb, e.map(x=>x.name), e.map(x=>x.count));
      }
    }

    tplAI(){
      const modeBadge = (m)=> this.aiMode === m ? "primary" : "ghost";
      const recEnabled = (this.settings.voice_rec?.enabled !== false);
      const recSupported = this.voiceRecSupported();
      const canRec = recEnabled && recSupported;
      const aiListening = !!(this._recogActive && this._recogTarget === "ai");
      const micBtn = canRec
        ? `<button class="btn ghost" id="btnAiVoice" data-action="voice-ai-toggle">${aiListening ? "🎙停止" : "🎙语音输入"}</button>`
        : `<button class="btn ghost" id="btnAiVoice" data-action="voice-ai-toggle" title="浏览器不支持或已在系统设置关闭" ${(!recSupported ? "disabled" : "")}>🎙语音输入</button>`;
      const micHint = canRec
        ? `<span id="aiVoiceStatus" class="mini" style="margin-left:auto; color:${aiListening ? "var(--warn)" : "var(--muted)"};">${aiListening ? "🎙正在听…（说完稍等）" : ""}</span>`
        : `<span id="aiVoiceStatus" class="mini" style="margin-left:auto; color:var(--muted);">${recSupported ? "可在系统设置开启语音输入" : "当前浏览器不支持语音识别"}</span>`;

      const msgs = this.aiMessages.map((m, idx)=>{
        const isUser = m.role === "user";
        const badge = isUser ? "warn" : "ok";
        const name = isUser ? "你" : "AI";
        const voiceBtn = (!isUser) ? `
          <button class="btn ghost" style="margin-left:auto;" data-action="tts-ai" data-idx="${idx}">🔊朗读</button>
          <button class="btn ghost" data-action="tts-stop">⏹停止</button>
        ` : "";
        return `
          <div class="ai-message-card">
            <div class="ai-message-actions">
              <span class="badge ${badge}">${name}</span>
              ${voiceBtn}
            </div>
            <div class="ai-message-content">${safeText(m.content)}</div>
          </div>
        `;
      }).join("");

      const examples = [
        "请动态讲解傅里叶级数如何逼近平方波，并解释 Gibbs 现象",
        "请用动画讲解 y = 2sin(x+π/3) 的图像变化过程",
        "请讲解一题抛体运动，重点说明水平和竖直方向分解",
        "请动态演示简谐振动中位移、速度、加速度的关系",
      ].map(t=>`<button class="example-chip" data-action="visual-chip" data-text="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");

      return `
        <div class="ai-assist-grid">
          <div class="card ai-panel">
            <div class="ai-panel-head">
              <div>
                <h2 class="h2">AI智能教辅 <small>讲解 / 计划 / 情绪支持</small></h2>
                <div class="help">你可以直接提问，也可以切换模式。若未配置模型，将自动使用离线 Mock，保证可演示。</div>
              </div>
              <button class="btn ghost" data-action="open-settings">AI配置</button>
            </div>
            <div class="ai-mode-row">
              <button class="btn ${modeBadge("explain")}" data-action="ai-set-mode" data-mode="explain">讲解</button>
              <button class="btn ${modeBadge("plan")}" data-action="ai-set-mode" data-mode="plan">计划</button>
              <button class="btn ${modeBadge("emotion")}" data-action="ai-set-mode" data-mode="emotion">情绪支持</button>
            </div>
            <div class="ai-input-box">
              <div class="label" style="margin-top:0;">输入问题</div>
              <textarea class="textarea" id="aiInput" rows="4" placeholder="例如：总体国家安全观的核心要义是什么？"></textarea>
              <div class="row" style="margin-top: 12px; align-items:center;">
                <button class="btn primary" data-action="ask-ai">询问AI</button>
                <button class="btn ghost" data-action="ai-clear">清除</button>
                ${micBtn}
                ${micHint}
              </div>
            </div>
            <div id="aiChat" class="ai-chat-scroll">
              ${msgs || '<div class="ai-side-section"><div class="mini">暂无对话。输入问题开始。</div></div>'}
            </div>
          </div>

          <div class="card ai-panel">
            <div>
              <h2 class="h2">动态讲题窗口 <small>函数图像 / 物理过程 / 白板推导</small></h2>
              <div class="help">这里适合数学、物理题。系统会生成分镜，边画边讲，并支持语音朗读当前场景。风格上更接近“短视频讲题 + 白板动画”，但保留了毕业设计可离线演示的实现方式。</div>
            </div>
            <div class="ai-side-scroll">
              <div class="ai-side-section">
                <div class="label" style="margin-top:0;">输入需要动态讲解的题目</div>
                <textarea class="textarea" id="visualPrompt" rows="6" placeholder="例如：请动态讲解傅里叶级数如何逼近平方波，并解释 Gibbs 现象。"></textarea>
                <div class="ai-example-list">${examples}</div>
                <div class="row" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
                  <button class="btn primary" data-action="visual-open">打开动态讲题</button>
                  <button class="btn ghost" data-action="visual-use-ai-input">使用左侧问题</button>
                </div>
              </div>

              <div class="ai-side-section">
                <div class="ai-side-title">支持的动态场景</div>
                <div class="ai-support-grid">
                  <div class="ai-support-item">三角函数图像绘制与变换</div>
                  <div class="ai-support-item">傅里叶级数逼近与 Gibbs 现象</div>
                  <div class="ai-support-item">抛体运动分解与轨迹分析</div>
                  <div class="ai-support-item">简谐振动位移速度加速度</div>
                  <div class="ai-support-item">数学题白板推导</div>
                  <div class="ai-support-item">物理题过程动画讲解</div>
                </div>
              </div>

              <div class="ai-side-section">
                <div class="ai-side-title">使用建议</div>
                <div class="help" style="margin-top:8px; line-height:1.7;">题目里尽量写清楚“已知条件、求解目标、希望重点讲解的步骤”。页面内容过长时，现在右侧和弹窗都支持直接滚动查看，不用再缩放页面。</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    async askAI(){
      // stop voice input before sending
      this.stopVoiceInput(true);
      const input = $("#aiInput");
      const message = (input ? input.value : "").trim();
      if(!message){
        toast("请输入问题", "bad"); return;
      }
      this.aiMessages.push({role:"user", content: message});
      if(input) input.value = "";
      await this.renderPage(); // refresh chat area quickly

      const mode = this.aiMode;
      const cfg = this.getAiConfig();
      try{
        const r = await this.api("/api/ai/chat", {method:"POST", body:{message, mode, config: cfg}});
        this.aiMessages.push({role:"assistant", content: r.reply});
        {
          const tag = r.used_external ? `外部模型/${r.endpoint||"ok"}` : ((r.endpoint === "offline_mock") ? "离线" : `外部错误/${r.endpoint||"unknown"}`);
          toast(`AI已回复（${tag}）`, r.used_external ? "ok" : "warn");
        }
        await this.renderPage();
      }catch(e){
        this.aiMessages.push({role:"assistant", content: "AI 调用失败：" + e.message});
        toast("AI 调用失败：" + e.message, "bad");
        await this.renderPage();
      }
    }

    async aiUnitGeneratePlan(kind="daily"){
      // kind: daily | weak
      this.stopVoiceInput(true);
      try{
        // ensure profile + recent data exists
        const prof = this.state.profile || await this.api("/api/profile");
        const recent = (this.state.recent || []).slice(0,5);
        const mastery = Array.isArray(prof.mastery_named) ? prof.mastery_named.slice() : [];
        const weak = mastery.slice().sort((a,b)=>Number(a.p||0)-Number(b.p||0)).slice(0,3);

        const theta = Number(prof.theta || 0).toFixed(2);
        const answered = prof.stats?.answered ?? 0;
        const acc = ((prof.stats?.accuracy ?? 0) * 100).toFixed(1);

        const weakLine = weak.length
          ? weak.map(x=>`${x.name}(${Math.round((x.p||0)*100)}%)`).join("、")
          : "暂无（先做几题建立画像）";

        const recentLine = recent.length
          ? recent.map(r=>`${r.correct ? "✅" : "❌"} ${r.skill}: ${String(r.stem||"").slice(0,28)}${String(r.stem||"").length>28?"…":""}`).join("\n")
          : "暂无最近作答";

        const focus = (kind === "weak")
          ? "请优先围绕掌握度最低的章节做‘薄弱点突击’，给出更聚焦、更可执行的安排。"
          : "请给出均衡的今日学习安排（薄弱点优先，但注意难度梯度）。";

        const prompt =
`你是“军队理论学习”智能教辅。请基于学习者画像生成一份今天可执行的学习计划（30-45分钟），要求：\n` +
`- 结构清晰：目标→步骤→每步用时→检验方式→复盘\n` +
`- 语言务实，不要空话\n` +
`- 最后给 3 条提醒（如何避免常见错误）\n\n` +
`学习者画像：\n` +
`- 当前能力 θ：${theta}\n` +
`- 已作答：${answered} 次；平均正确率：${acc}%\n` +
`- 薄弱章节：${weakLine}\n\n` +
`最近作答（摘要）：\n${recentLine}\n\n` +
`${focus}`;

        const cfg = this.getAiConfig();
        const r = await this.api("/api/ai/chat", {method:"POST", body:{message: prompt, mode:"plan", config: cfg}});
        const txt = r.reply || "";
        this.state.ai_unit_plan = txt;
        toast(r.used_external ? "已生成计划（外部模型）" : (r.endpoint === "offline_mock" ? "已生成计划（离线）" : `生成计划失败（${r.endpoint||"error"}）`), r.used_external ? "ok" : "warn");
        showModal("AI 单元 · 学习计划", `<div style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(txt)}</div>`,
          `<button class="btn primary" data-action="modal-close">关闭</button>
           <button class="btn ghost" onclick="window.app.switchPage('training')">去训练</button>
           <button class="btn ghost" onclick="window.app.switchPage('ai')">继续问AI</button>`
        );
        // refresh dashboard card if currently on dashboard
        if(this.currentPage === "dashboard") this.renderPage();
      }catch(e){
        toast("生成计划失败：" + e.message, "bad");
      }
    }


    async loadKnowledge(){
      const [skillStats, lessons] = await Promise.all([
        this.api("/api/analytics/skill_stats"),
        this.api("/api/lessons"),
      ]);
      this.state.skillStats = skillStats.skills || [];
      this.state.lessons = lessons.lessons || [];
    }

    tplKnowledge(){
      const isAdmin = !!(this.currentUser && ["admin","instructor"].includes(this.currentUser.role));
      const lessonMap = Object.fromEntries((this.state.lessons || []).map(x=>[x.skill_id, x]));
      const rows = (this.state.skillStats||[]).map(s=>{
        const p = s.p_mastery ?? 0.2;
        const badge = p < 0.4 ? "bad" : p < 0.7 ? "warn" : "ok";
        const prog = clamp(p*100,0,100);
        const lesson = lessonMap[s.skill_id] || {};
        const videoText = lesson.video_completed ? "动画课已完成" : lesson.has_video ? `动画课 ${Math.round((lesson.video_progress||0)*100)}%` : "可生成动画课";
        return `
          <div class="col-6">
            <div class="card">
              <div class="row" style="align-items:center;">
                <h3 class="h2" style="font-size:14px; margin:0;">${safeText(s.name)}</h3>
                <span class="badge ${badge}" style="margin-left:auto;">${Math.round(prog)}%</span>
              </div>
              <div class="label">掌握度</div>
              <div class="progress"><i style="width:${prog.toFixed(0)}%"></i></div>
              <div class="row" style="margin-top:10px;">
                <span class="mini">已答：${s.answered||0} · 正确率：${(Number(s.accuracy||0)*100).toFixed(0)}% · 平均用时：${formatSec(s.avg_time||0)}</span>
              </div>
              <div class="mini" style="margin-top:8px;">${safeText(videoText)}</div>
              <div class="hr"></div>
              <div class="row" style="gap:8px; flex-wrap:wrap;">
                <button class="btn primary" data-action="start-training" data-skill="${safeText(s.skill_id)}">专项练习</button>
                <button class="btn ghost" data-action="skill-detail" data-skill="${safeText(s.skill_id)}">详情</button>
                <button class="btn ghost" data-action="smart-open-video" data-skill="${safeText(s.skill_id)}">动画课</button>
                ${isAdmin ? `<button class="btn ghost" data-action="admin-generate-video" data-skill="${safeText(s.skill_id)}">AI生成动画课</button>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">知识点画像 <small>掌握度 / 训练建议 / AI动画课程</small></h2>
              <div class="help">
                这里按章节展示掌握度与训练情况。点击“动画课”可直接进入 AI 自动生成的动画微课；管理员可重新生成课程脚本。
              </div>
            </div>
          </div>
          ${rows || '<div class="col-12"><div class="card"><div class="mini">暂无数据</div></div></div>'}
        </div>
      `;
    }

    async openSkillDetail(skillId){
      try{
        const r = await this.api(`/api/analytics/skill_detail?skill_id=${encodeURIComponent(skillId)}`);
        const list = r.responses || [];
        const rows = list.map(x=>{
          const badge = x.correct ? "ok" : "bad";
          return `
            <div style="margin-bottom:10px;">
              <span class="badge ${badge}">${x.correct ? "正确" : "错误"}</span>
              <span class="mini">${safeText(x.at).slice(0,19).replace("T"," ")}</span>
              <div class="mini">${safeText(x.stem).slice(0,70)}${safeText(x.stem).length>70?"…":""}</div>
              <div class="mini">用时：${formatSec(x.time_spent||0)} · 错因：${safeText(x.error_type||"未标注")}</div>
              <div class="hr" style="margin:8px 0;"></div>
            </div>
          `;
        }).join("") || "<div class='mini'>暂无作答记录</div>";

        showModal("章节作答详情", rows, `<button class="btn primary" data-action="start-training" data-skill="${safeText(skillId)}">继续专项练习</button>`);
      }catch(e){
        toast("获取详情失败：" + e.message, "bad");
      }
    }

    // ---------- admin pages ----------
    async loadMonitor(){
      const r = await this.api("/api/admin/metrics");
      this.state.metrics = r;
      const audit = await this.api("/api/admin/audit?limit=30");
      this.state.audit = audit.logs || [];
    }

    tplMonitor(){
      const m = this.state.metrics || {};
      const dbs = m.db || {};
      const byEp = m.by_endpoint || [];
      const statusCounts = m.status_counts || {};
      const recent = m.recent || [];

      const recentRows = recent.slice().reverse().map(x=>{
        const badge = x.status >= 500 ? "bad" : x.status >= 400 ? "warn" : "ok";
        return `<tr>
          <td class="mini">${new Date(x.ts*1000).toLocaleTimeString("zh-CN",{hour12:false})}</td>
          <td>${safeText(x.method)}</td>
          <td class="mini">${safeText(x.path)}</td>
          <td><span class="badge ${badge}">${x.status}</span></td>
          <td class="mini">${x.ms}ms</td>
        </tr>`;
      }).join("");

      const auditRows = (this.state.audit||[]).slice(0,10).map(l=>{
        return `<tr>
          <td class="mini">${safeText(l.at).slice(0,19).replace("T"," ")}</td>
          <td>${safeText(l.user)}</td>
          <td>${safeText(l.action)}</td>
          <td class="mini">${safeText(JSON.stringify(l.detail)).slice(0,90)}${JSON.stringify(l.detail).length>90?"…":""}</td>
        </tr>`;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <h2 class="h2">系统监控 <small>请求统计 / 数据库 / 审计 / 回流校准</small></h2>
              <div class="row">
                <span class="pill"><span class="dot ok"></span> Uptime: ${m.uptime_s||0}s</span>
                <span class="pill">Req: ${m.total||0}</span>
                <span class="pill">P95: ${m.latency_ms?.p95||0}ms</span>
                <span class="pill">DB: ${dbs.size_kb||0}KB</span>
                <button class="btn primary" style="margin-left:auto;" data-action="admin-recalibrate">回流校准 b</button>
                <button class="btn" data-action="admin-export-all">导出作答CSV</button>
                <button class="btn ghost" data-action="admin-backup-db">DB备份</button>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">Top Endpoints</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="epBar"></canvas>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">状态码分布</h2>
              <div class="chart-container">
                <canvas class="chart-canvas" id="statusPie"></canvas>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">最近请求</h2>
              <table class="table">
                <thead><tr><th>时间</th><th>M</th><th>路径</th><th>状态</th><th>耗时</th></tr></thead>
                <tbody>
                  ${recentRows || '<tr><td colspan="5" class="mini">暂无</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">审计日志</h2>
              <table class="table">
                <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>详情</th></tr></thead>
                <tbody>
                  ${auditRows || '<tr><td colspan="4" class="mini">暂无</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    drawMonitorCharts(){
      const m = this.state.metrics || {};
      const byEp = m.by_endpoint || [];
      const labels = byEp.map(x=>x[0].replace("GET ","").replace("POST ",""));
      const values = byEp.map(x=>x[1]);
      const ep = $("#epBar");
      if(ep && labels.length){
        drawBarChart(ep, labels.slice(0,8), values.slice(0,8));
      }
      const statusPie = $("#statusPie");
      if(statusPie){
        const sc = m.status_counts || {};
        const labs = Object.keys(sc).sort();
        const vals = labs.map(k=>sc[k]);
        drawPieChart(statusPie, labs, vals);
      }
    }

    async adminRecalibrate(){
      try{
        const r = await this.api("/api/admin/recalibrate", {method:"POST"});
        toast(`回流校准完成：更新题目 ${r.updated_items} 道`, "ok");
      }catch(e){
        toast("回流校准失败：" + e.message, "bad");
      }
    }

    async loadQuestionBank(){
      // keep query in memory
      if(!this._itemQuery){
        this._itemQuery = {search:"", skill_id:"", page:1, page_size:20};
      }
      // load skills for filter
      const skills = await this.api("/api/skills");
      this.state.skills = skills.skills || [];
      const q = this._itemQuery;
      const url = new URL("/api/admin/items", window.location.origin);
      if(q.search) url.searchParams.set("search", q.search);
      if(q.skill_id) url.searchParams.set("skill_id", q.skill_id);
      url.searchParams.set("page", String(q.page));
      url.searchParams.set("page_size", String(q.page_size));
      const r = await this.api(url.pathname + url.search);
      this.state.adminItems = r;
    }

    tplQuestionBank(){
      const r = this.state.adminItems || {items:[], total:0, page:1, page_size:20};
      const items = r.items || [];
      const total = r.total || 0;
      const page = r.page || 1;
      const pageSize = r.page_size || 20;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const q = this._itemQuery || {search:"", skill_id:""};

      const skillOpts = [`<option value="">全部章节</option>`].concat(
        (this.state.skills||[]).map(s=>`<option value="${safeText(s.id)}" ${q.skill_id===s.id?"selected":""}>${safeText(s.name)}</option>`)
      ).join("");

      const rows = items.map(it=>{
        const qtMap = {single:"单选", judge:"判断", scenario:"情景", multi:"多选", fill:"填空"};
        const qt = qtMap[it.qtype] || (it.qtype || "单选");
        const tagHtml = (it.tags || []).slice(0,3).map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join(" ") || `<span class="mini" style="color:var(--muted);">—</span>`;
        return `
          <tr>
            <td>${it.id}</td>
            <td class="mini">${safeText(it.stem).slice(0,60)}${safeText(it.stem).length>60?"…":""}</td>
            <td class="mini">${safeText(it.skill_name)}</td>
            <td class="mini"><span class="badge ok">${escapeHtml(qt)}</span> <span class="mini" style="margin-left:6px;">${tagHtml}</span></td>
            <td class="mini">a=${Number(it.a).toFixed(2)} · b=${Number(it.b).toFixed(2)}</td>
            <td><span class="badge ${it.enabled ? "ok" : "warn"}">${it.enabled ? "启用" : "禁用"}</span></td>
            <td>
              <button class="btn ghost" style="padding:4px 8px; font-size:11px;" data-action="item-edit" data-id="${it.id}">编辑</button>
              <button class="btn ghost" style="padding:4px 8px; font-size:11px;" data-action="item-delete" data-id="${it.id}">删除</button>
            </td>
          </tr>
        `;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <div class="row" style="align-items:center;">
                <h2 class="h2" style="margin:0;">题库管理 <small>共 ${total} 题</small></h2>
                <button class="btn primary" style="margin-left:auto;" data-action="item-new">新增题目</button>
                <button class="btn" data-action="item-import">CSV导入</button>
              </div>

              <div class="hr"></div>

              <div class="row" style="align-items:center;">
                <input class="input" id="itemSearch" placeholder="搜索题干关键词" style="max-width:260px;" value="${safeText(q.search)}"/>
                <select class="select" id="itemSkill" style="max-width:240px;">
                  ${skillOpts}
                </select>
                <button class="btn" data-action="item-search">查询</button>
                <span class="mini" style="margin-left:auto;">页码 ${page}/${pages}</span>
                <button class="btn ghost" data-action="item-prev" ${page<=1?"disabled":""}>上一页</button>
                <button class="btn ghost" data-action="item-next" ${page>=pages?"disabled":""}>下一页</button>
              </div>

              <div class="hr"></div>

              <table class="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>题干</th>
                    <th>章节</th>
                    <th>题型/标签</th>
                    <th>参数</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="7" class="mini">暂无</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    async itemSearch(){
      const search = ($("#itemSearch")?.value || "").trim();
      const skill_id = ($("#itemSkill")?.value || "").trim();
      this._itemQuery.search = search;
      this._itemQuery.skill_id = skill_id;
      this._itemQuery.page = 1;
      await this.renderPage();
    }

    async itemPrev(){
      if(this._itemQuery.page > 1){
        this._itemQuery.page -= 1;
        await this.renderPage();
      }
    }

    async itemNext(){
      this._itemQuery.page += 1;
      await this.renderPage();
    }

    async itemOpenImport(){
      const body = `
        <div class="help">
          选择 CSV 文件导入题目（不带表头）：<br>
          <span class="kbd">skill_id,stem,choices(|分隔),answer_key,a,b</span>
        </div>
        <div class="hr"></div>
        <input type="file" id="csvFile" class="input" accept=".csv" />
      `;
      showModal("CSV 导入题库", body, `
        <button class="btn primary" data-action="item-import-confirm">开始导入</button>
      `);
    }

    async itemImportConfirm(){
      const f = $("#csvFile")?.files?.[0];
      if(!f){
        toast("请选择 CSV 文件", "bad"); return;
      }
      const fd = new FormData();
      fd.append("file", f);
      try{
        const r = await this.api("/api/admin/items/import_csv", {method:"POST", body:fd, form:true});
        toast(`导入完成：新增 ${r.inserted}，跳过 ${r.skipped}`, "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("导入失败：" + e.message, "bad");
      }
    }

    async itemOpenForm(item=null){
      // item: {id, stem, skill_id, choices, answer_key, a, b, enabled}
      const isEdit = !!item;
      const meta = (item && item.meta) ? item.meta : {};
      const qtype = meta.qtype || "single";
      const difficulty = Number(meta.difficulty || 2);
      const tags = (meta.tags || []).join(",");
      const explanation = meta.explanation || "";
      const skills = this.state.skills || [];
      const skillOpts = skills.map(s=>`<option value="${safeText(s.id)}" ${(item && item.skill_id===s.id)?"selected":""}>${safeText(s.name)}</option>`).join("");
      const choicesText = item ? (item.choices || []).join("\n") : "选项A\n选项B\n选项C\n选项D";
      const body = `
        <div class="split">
          <div>
            <div class="label">章节</div>
            <select class="select" id="fSkill">${skillOpts}</select>

            <div class="label">题干</div>
            <textarea class="textarea" id="fStem" rows="4" placeholder="输入题干">${item ? safeText(item.stem) : ""}</textarea>

            <div class="label">选项（每行一个）</div>
            <textarea class="textarea" id="fChoices" rows="6">${choicesText}</textarea>
          </div>
          <div>
            <div class="label">正确选项索引（0=A,1=B…）</div>
            <input class="input" id="fKey" type="number" min="0" value="${item ? item.answer_key : 0}"/>

            <div class="label">IRT 参数 a（区分度）</div>
            <input class="input" id="fA" type="number" step="0.01" value="${item ? item.a : 1.0}"/>

            <div class="label">IRT 参数 b（难度）</div>
            <input class="input" id="fB" type="number" step="0.01" value="${item ? item.b : 0.0}"/>

            <div class="label">启用</div>
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="fEnabled" ${(!item || item.enabled) ? "checked" : ""}/>
              <span class="mini">禁用后不会被推荐</span>
            </label>

            <div class="hr"></div>
            <div class="label">题型（可选）</div>
            <select class="select" id="fQType">
              <option value="single" ${qtype==="single"?"selected":""}>单选题</option>
              <option value="judge" ${qtype==="judge"?"selected":""}>判断题</option>
              <option value="scenario" ${qtype==="scenario"?"selected":""}>情景题</option>
              <option value="case" ${qtype==="case"?"selected":""}>案例分析</option>
              <option value="sequence" ${qtype==="sequence"?"selected":""}>步骤排序</option>
              <option value="combo" ${qtype==="combo"?"selected":""}>多选（组合）</option>
            </select>

            <div class="label">难度 1~5（可选）</div>
            <input class="input" id="fDiff" type="number" min="1" max="5" value="${difficulty}"/>

            <div class="label">标签（逗号分隔，可选）</div>
            <input class="input" id="fTags" placeholder="例如：法规,装备,安全" value="${escapeHtml(tags)}"/>

            <div class="label">解析（可选）</div>
            <textarea class="textarea" id="fExplain" rows="4" placeholder="输入解析">${escapeHtml(explanation)}</textarea>

            <div class="hr"></div>
            <div class="help">
              提示：如果不想手工设置 a/b，可保持默认；后续可在“系统监控→回流校准”自动更新 b。
            </div>
          </div>
        </div>
      `;
      showModal(isEdit ? "编辑题目" : "新增题目", body, `
        <button class="btn primary" data-action="${isEdit ? "item-save-edit" : "item-save-new"}" ${isEdit ? `data-id="${item.id}"` : ""}>保存</button>
      `);
    }

    async itemNew(){
      await this.itemOpenForm(null);
    }

    async itemEdit(id){
      try{
        const item = await this.api(`/api/admin/items/${id}`);
        try{ item.meta = await this.api(`/api/admin/items/${id}/meta`); }catch(_e){ item.meta = {}; }
        await this.itemOpenForm(item);
      }catch(e){
        toast("读取题目失败：" + e.message, "bad");
      }
    }

    async itemSaveNew(){
      const data = this.collectItemForm();
      if(!data) return;
      const meta = this.collectItemMetaForm();
      try{
        const r = await this.api("/api/admin/items", {method:"POST", body:data});
        const id = r.id;
        if(id && meta) await this.saveItemMeta(id, meta);
        toast("新增成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("新增失败：" + e.message, "bad");
      }
    }

    async itemSaveEdit(id){
      const data = this.collectItemForm();
      if(!data) return;
      const meta = this.collectItemMetaForm();
      try{
        await this.api(`/api/admin/items/${id}`, {method:"PUT", body:data});
        if(meta) await this.saveItemMeta(id, meta);
        toast("保存成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("保存失败：" + e.message, "bad");
      }
    }

    collectItemForm(){
      const skill_id = ($("#fSkill")?.value || "").trim();
      const stem = ($("#fStem")?.value || "").trim();
      const choices = ($("#fChoices")?.value || "").split("\n").map(s=>s.trim()).filter(Boolean);
      const answer_key = Number($("#fKey")?.value || 0);
      const a = Number($("#fA")?.value || 1.0);
      const b = Number($("#fB")?.value || 0.0);
      const enabled = !!$("#fEnabled")?.checked;

      if(!skill_id){ toast("请选择章节", "bad"); return null; }
      if(!stem){ toast("请输入题干", "bad"); return null; }
      if(choices.length < 2){ toast("选项至少2个", "bad"); return null; }
      if(!(answer_key >= 0 && answer_key < choices.length)){ toast("正确选项索引超出范围", "bad"); return null; }
      return {stem, skill_id, choices, answer_key, a, b, enabled};
    }

    collectItemMetaForm(){
      const qtype = ($("#fQType")?.value || "single").trim();
      const difficulty = Math.max(1, Math.min(5, Number($("#fDiff")?.value || 2)));
      const tags = ($("#fTags")?.value || "")
        .split(/[,，]/)
        .map(t=>t.trim())
        .filter(Boolean)
        .slice(0, 12);
      const explanation = ($("#fExplain")?.value || "").trim();
      return {qtype, difficulty, tags, explanation};
    }

    async saveItemMeta(id, meta){
      try{
        await this.api(`/api/admin/items/${id}/meta`, {method:"PUT", body: meta});
      }catch(e){
        toast("保存扩展信息失败：" + e.message, "warn");
      }
    }

    async itemDelete(id){
      showModal("确认删除", `<div class="help">确定删除题目 ID=${id}？此操作不可撤销。</div>`, `
        <button class="btn danger" data-action="item-delete-confirm" data-id="${id}">删除</button>
      `);
    }

    async itemDeleteConfirm(id){
      try{
        await this.api(`/api/admin/items/${id}`, {method:"DELETE"});
        toast("删除成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("删除失败：" + e.message, "bad");
      }
    }

    async loadUsers(){
      const r = await this.api("/api/admin/users");
      this.state.adminUsers = r.users || [];
    }

    tplUsers(){
      const users = this.state.adminUsers || [];
      const rows = users.map(u=>{
        const badge = u.role === "admin" ? "bad" : (u.role === "instructor" ? "warn" : "ok");
        return `
          <tr>
            <td>${safeText(u.username)}</td>
            <td><span class="badge ${badge}">${safeText(u.role)}</span></td>
            <td class="mini">${Number(u.theta||0).toFixed(2)}</td>
            <td class="mini">${u.answered||0}</td>
            <td class="mini">${safeText(u.created_at).slice(0,19).replace("T"," ")}</td>
            <td>
              <button class="btn ghost" style="padding:4px 8px; font-size:11px;" data-action="user-edit" data-id="${u.id}">修改</button>
              <button class="btn ghost" style="padding:4px 8px; font-size:11px;" data-action="user-delete" data-id="${u.id}">删除</button>
            </td>
          </tr>
        `;
      }).join("");

      return `
        <div class="grid">
          <div class="col-12">
            <div class="card">
              <div class="row" style="align-items:center;">
                <h2 class="h2" style="margin:0;">用户管理</h2>
                <button class="btn primary" style="margin-left:auto;" data-action="user-new">新增用户</button>
              </div>
              <div class="hr"></div>
              <table class="table">
                <thead><tr><th>用户名</th><th>角色</th><th>θ</th><th>已答</th><th>创建时间</th><th>操作</th></tr></thead>
                <tbody>
                  ${rows || '<tr><td colspan="7" class="mini">暂无</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    async userNew(){
      const body = `
        <div class="label">用户名</div>
        <input class="input" id="uName" placeholder="username"/>

        <div class="label">密码</div>
        <input class="input" id="uPass" type="password" placeholder="至少6位"/>

        <div class="label">角色</div>
        <select class="select" id="uRole">
          <option value="trainee">trainee（学员）</option>
          <option value="instructor">instructor（教员）</option>
          <option value="admin">admin（管理员）</option>
        </select>
      `;
      showModal("新增用户", body, `<button class="btn primary" data-action="user-save-new">保存</button>`);
    }

    async userSaveNew(){
      const username = ($("#uName")?.value || "").trim();
      const password = ($("#uPass")?.value || "");
      const role = ($("#uRole")?.value || "trainee");
      if(!username){ toast("请输入用户名", "bad"); return; }
      if(password.length < 6){ toast("密码至少6位", "bad"); return; }
      try{
        await this.api("/api/admin/users", {method:"POST", body:{username,password,role}});
        toast("新增用户成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("新增用户失败：" + e.message, "bad");
      }
    }

    async userEdit(id){
      const u = (this.state.adminUsers||[]).find(x=>String(x.id)===String(id));
      if(!u){ toast("用户不存在", "bad"); return; }
      const body = `
        <div class="label">用户名</div>
        <div class="pill">${safeText(u.username)}</div>

        <div class="label">角色</div>
        <select class="select" id="uRole2">
          <option value="trainee" ${u.role==="trainee"?"selected":""}>trainee（学员）</option>
          <option value="instructor" ${u.role==="instructor"?"selected":""}>instructor（教员）</option>
          <option value="admin" ${u.role==="admin"?"selected":""}>admin（管理员）</option>
        </select>

        <div class="label">重置密码（可选）</div>
        <input class="input" id="uPass2" type="password" placeholder="留空则不改"/>
      `;
      showModal("修改用户", body, `<button class="btn primary" data-action="user-save-edit" data-id="${u.id}">保存</button>`);
    }

    async userSaveEdit(id){
      const role = ($("#uRole2")?.value || "").trim();
      const new_password = ($("#uPass2")?.value || "").trim();
      const body = {role};
      if(new_password) body.new_password = new_password;
      try{
        await this.api(`/api/admin/users/${id}`, {method:"PUT", body});
        toast("修改成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("修改失败：" + e.message, "bad");
      }
    }

    async userDelete(id){
      showModal("确认删除用户", `<div class="help">确定删除用户 ID=${id}？这会同时删除其学习记录。</div>`, `
        <button class="btn danger" data-action="user-delete-confirm" data-id="${id}">删除</button>
      `);
    }

    async userDeleteConfirm(id){
      try{
        await this.api(`/api/admin/users/${id}`, {method:"DELETE"});
        toast("删除成功", "ok");
        closeModal();
        await this.renderPage();
      }catch(e){
        toast("删除失败：" + e.message, "bad");
      }
    }

    // ---------- settings page ----------
    tplSettings(){
      const role = this.currentUser?.role || "trainee";
      const isAdmin = (role==="admin" || role==="instructor");

      const theme = this.settings.theme || "cold";
      const motionReduced = this.settings.motion === "reduced";
      const showSeconds = !!this.settings.clock_show_seconds;
      const clock24 = !!this.settings.clock_24h;

      const ai = this.settings.ai || {};
      const voice = this.settings.voice || {};
      const voiceEnabled = voice.enabled !== false;
      const voiceRate = Number(voice.rate || 1.0);
      const voicePitch = Number(voice.pitch || 1.0);
      const voiceURI = voice.uri || "";

      const rec = this.settings.voice_rec || {};
      const recEnabled = rec.enabled !== false;
      const recLang = rec.lang || "zh-CN";
      const recAutoSendAI = !!rec.auto_send_ai;
      const recQuizConfirm = rec.quiz_confirm !== false;
      const uiView = this.settings.ui_view || "auto";

      return `
        <div class="grid">
          <div class="col-6">
            <div class="card">
              <h2 class="h2">界面设置</h2>

              <div class="label">主题模式（冷热）</div>
              <div class="row">
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="radio" name="theme" value="cold" ${theme==="cold"?"checked":""}>
                  冷色调（军工蓝）
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="radio" name="theme" value="warm" ${theme==="warm"?"checked":""}>
                  暖色调
                </label>
              </div>

              <div class="label" style="margin-top: 14px;">动态背景</div>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="setMotion" ${!motionReduced?"checked":""}>
                启用动态背景（关闭后更省电）
              </label>

              <div class="label" style="margin-top: 14px;">时间时钟管理</div>
              <div class="row">
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" id="setSeconds" ${showSeconds?"checked":""}>
                  显示秒
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" id="set24h" ${clock24?"checked":""}>
                  24小时制
                </label>
              </div>

              ${isAdmin ? `
              <div class="label" style="margin-top: 14px;">端口视图切换（演示用）</div>
              <select class="select" id="setView">
                <option value="auto" ${uiView==="auto"?"selected":""}>自动（按真实角色显示菜单）</option>
                <option value="trainee" ${uiView==="trainee"?"selected":""}>学员端视图</option>
                <option value="admin" ${uiView==="admin"?"selected":""}>管理端视图</option>
              </select>
              <div class="mini" style="margin-top:6px;">说明：仅影响“菜单显示”，不会改变后端权限。</div>
              ` : ""}

              <div class="hr"></div>
              <div class="row">
                <button class="btn primary" style="width:100%;" data-action="save-settings">保存设置</button>
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="card">
              <h2 class="h2">系统设置（功能）</h2>

              <div class="label">AI 模型配置（支持 OpenAI-Compatible / DeepSeek / Codex）</div>
              <div class="row">
                <button class="btn ghost" data-action="ai-fill-codex">填入Codex</button>
                <button class="btn ghost" data-action="ai-fill-deepseek">填入DeepSeek</button>
                <button class="btn ghost" data-action="ai-export">导出配置</button>
                <button class="btn ghost" data-action="ai-import">导入配置</button>
                <button class="btn" style="margin-left:auto;" data-action="ai-test">连接测试</button>
              </div>

              <div class="label">Base URL</div>
              <input class="input" id="aiBase" placeholder="https://api.openai.com" value="${safeText(ai.base_url||"")}"/>

              <label style="display:flex;align-items:center;gap:8px; margin-top:10px;">
                <input type="checkbox" id="aiUseServerKey" ${ai.use_server_key?"checked":""}>
                使用服务端 API Key（推荐：不在浏览器保存密钥）
              </label>
              <div class="mini" style="margin-top:6px; color:var(--muted);">
                若后端已设置环境变量 <code>ARMEDU_AI_API_KEY</code>，勾选后本页无需填写 Key。
              </div>

              <div class="label">API Key</div>
              <input class="input" id="aiKey" type="password" placeholder="sk-..." value="${safeText(ai.api_key||"")}" ${ai.use_server_key?"disabled":""}/>

              <div class="label">Model</div>
              <input class="input" id="aiModel" placeholder="填写你账号可用的模型名" value="${safeText(ai.model||"")}"/>

              <div class="label" style="margin-top:12px;">AI 情绪支持</div>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="aiEmotion" ${ai.emotion_enabled!==false?"checked":""}>
                启用情绪支持模式（D 模式的一部分）
              </label>

              <div class="hr"></div>
              <div class="label">语音讲解（浏览器朗读，离线可用）</div>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="voiceEnabled" ${voiceEnabled?"checked":""}>
                启用朗读按钮（题目/解析/微课/AI回复）
              </label>
              <div class="row" style="gap:12px; margin-top:10px;">
                <div class="kv" style="flex:1;">
                  <span>语速</span>
                  <input type="range" id="voiceRate" min="0.7" max="1.3" step="0.05" value="${voiceRate}" style="width:100%;">
                </div>
                <div class="kv" style="flex:1;">
                  <span>音调</span>
                  <input type="range" id="voicePitch" min="0.6" max="1.4" step="0.05" value="${voicePitch}" style="width:100%;">
                </div>
              </div>
              <div class="label" style="margin-top:10px;">音色</div>
              <select class="select" id="voiceSel" data-current="${escapeHtml(voiceURI)}">
                <option value="">自动选择（推荐中文优先）</option>
              </select>
              <div class="row" style="margin-top:10px;">
                <button class="btn ghost" data-action="voice-test">试听</button>
                <span class="mini" style="margin-left:auto; color:var(--muted);">部分浏览器需先点一次页面才能出声</span>
              </div>

              <div class="hr"></div>
              <div class="label">语音输入（语音转文字，需 HTTPS/localhost）</div>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="recEnabled" ${recEnabled?"checked":""}>
                启用语音输入按钮（AI提问 / 语音作答）
              </label>
              <div class="label" style="margin-top:10px;">识别语言</div>
              <select class="select" id="recLang">
                <option value="zh-CN" ${recLang==="zh-CN"?"selected":""}>中文（zh-CN）</option>
                <option value="en-US" ${recLang==="en-US"?"selected":""}>English（en-US）</option>
                <option value="" ${recLang===""?"selected":""}>自动（跟随浏览器）</option>
              </select>
              <div class="row" style="margin-top:10px; gap:14px;">
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" id="recAutoSendAI" ${recAutoSendAI?"checked":""}>
                  识别结束自动发送到 AI
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" id="recQuizConfirm" ${recQuizConfirm?"checked":""}>
                  语音作答先确认
                </label>
              </div>
              <div class="mini" style="margin-top:8px; color:var(--muted);">
                提示：语音输入通常只在 Chrome/Edge 等浏览器可用，且需要在 HTTPS 或 localhost 环境下使用。
              </div>

              <div class="label">数据与数据库</div>
              <div class="row">
                <button class="btn" data-action="export-my">导出我的作答CSV</button>
                <button class="btn danger" data-action="clear-my">清空我的记录</button>
              </div>
              ${isAdmin ? `
              <div class="row" style="margin-top:10px;">
                <button class="btn" data-action="export-all">导出全站作答CSV</button>
                <button class="btn" data-action="backup-db">DB备份</button>
                <button class="btn danger" data-action="clear-all">清空全站作答</button>
              </div>
              <div class="row" style="margin-top:10px;">
                <button class="btn" data-action="open-import-csv">导入题库CSV</button>
              </div>
              ` : ""}

              <div class="hr"></div>
              <div class="help">
                <b>使用提示：</b><br>
                1) “保存设置”会保存主题/动效/时钟/AI 配置到浏览器本地（localStorage）。<br>
                2) 管理端功能受后端权限控制，视图切换仅用于演示。<br>
              </div>
            </div>
          </div>
        </div>

        <input id="aiImportFile" type="file" accept=".json" class="hidden"/>
      `;
    }

    async saveSettingsFromUI(){
      // theme
      const theme = document.querySelector('input[name="theme"]:checked')?.value;
      if(theme) this.settings.theme = theme;

      // motion
      const motionOn = $("#setMotion")?.checked;
      this.settings.motion = motionOn ? "normal" : "reduced";

      // clock
      this.settings.clock_show_seconds = !!$("#setSeconds")?.checked;
      this.settings.clock_24h = !!$("#set24h")?.checked;

      // view
      const viewSel = $("#setView");
      if(viewSel) this.settings.ui_view = viewSel.value;

      // AI config
      this.settings.ai = this.settings.ai || {};
      this.settings.ai.base_url = ($("#aiBase")?.value || "").trim();
      this.settings.ai.use_server_key = !!$("#aiUseServerKey")?.checked;
      this.settings.ai.api_key = this.settings.ai.use_server_key ? "" : ($("#aiKey")?.value || "").trim();
      this.settings.ai.model = ($("#aiModel")?.value || "").trim();
      this.settings.ai.emotion_enabled = !!$("#aiEmotion")?.checked;

      // Voice (Speech Synthesis)
      this.settings.voice = this.settings.voice || {enabled:true, rate:1.0, pitch:1.0, uri:""};
      this.settings.voice.enabled = !!$("#voiceEnabled")?.checked;
      this.settings.voice.rate = Number($("#voiceRate")?.value || 1.0);
      this.settings.voice.pitch = Number($("#voicePitch")?.value || 1.0);
      this.settings.voice.uri = ($("#voiceSel")?.value || "");

      // Voice input (SpeechRecognition)
      this.settings.voice_rec = this.settings.voice_rec || {enabled:true, lang:"zh-CN", auto_send_ai:false, quiz_confirm:true};
      const recEnEl = $("#recEnabled");
      if(recEnEl) this.settings.voice_rec.enabled = !!recEnEl.checked;
      const recLangEl = $("#recLang");
      if(recLangEl) this.settings.voice_rec.lang = (recLangEl.value || "");
      const recAutoEl = $("#recAutoSendAI");
      if(recAutoEl) this.settings.voice_rec.auto_send_ai = !!recAutoEl.checked;
      const recQcEl = $("#recQuizConfirm");
      if(recQcEl) this.settings.voice_rec.quiz_confirm = !!recQcEl.checked;

      this.saveSettings();
      this.applySettings();
      this.updatePill();
      this.buildNav();
      toast("设置已保存", "ok");
      await this.renderPage();
    }

    populateVoiceSelect(){
      const sel = $("#voiceSel");
      if(!sel || !window.speechSynthesis) return;

      const refresh = () => {
        const current = sel.getAttribute("data-current") || (this.settings.voice?.uri || "");
        const voices = window.speechSynthesis.getVoices() || [];
        // keep first "auto" option
        const keep = sel.querySelectorAll("option");
        // remove existing dynamic options
        Array.from(keep).slice(1).forEach(o=>o.remove());
        voices.forEach(v=>{
          const opt = document.createElement("option");
          opt.value = v.voiceURI;
          opt.textContent = `${v.name} (${v.lang})`;
          sel.appendChild(opt);
        });
        if(current){ sel.value = current; }
      };

      // Some browsers load voices async
      window.speechSynthesis.onvoiceschanged = refresh;
      refresh();
    }

    ttsStop(){
      if(!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
    }

    ttsSpeak(text){
      if(!window.speechSynthesis || !window.SpeechSynthesisUtterance){
        toast("当前浏览器不支持语音朗读", "warn");
        return;
      }
      const vset = this.settings.voice || {enabled:true, rate:1.0, pitch:1.0, uri:""};
      if(vset.enabled === false){
        toast("语音讲解已关闭（可在系统设置开启）", "warn");
        return;
      }
      const t = String(text || "").trim();
      if(!t){ toast("暂无可朗读内容", "warn"); return; }
      // keep it reasonably short
      const clipped = t.length > 1200 ? (t.slice(0, 1200) + "...") : t;
      try{ window.speechSynthesis.cancel(); }catch(_e){}
      const u = new SpeechSynthesisUtterance(clipped);
      u.rate = clamp(Number(vset.rate||1.0), 0.5, 2.0);
      u.pitch = clamp(Number(vset.pitch||1.0), 0.0, 2.0);
      const voices = window.speechSynthesis.getVoices() || [];
      const chosen = vset.uri ? voices.find(v=>v.voiceURI===vset.uri) : null;
      const zh = voices.find(v=>String(v.lang||"").toLowerCase().startsWith("zh"));
      if(chosen) u.voice = chosen; else if(zh) u.voice = zh;
      window.speechSynthesis.speak(u);
    }

    ttsSpeakKey(key){
      const cache = this._ttsCache || {};
      if(key === "badges"){
        const s = this.state.social || {};
        const cur = s.streak?.current || 0;
        const best = s.streak?.best || 0;
        const n = (s.achievements||[]).length;
        this.ttsSpeak(`你当前连续打卡 ${cur} 天，历史最高 ${best} 天。已解锁勋章 ${n} 枚。`);
        return;
      }
      this.ttsSpeak(cache[key] || "");
    }

    ttsSpeakAi(idx){
      const m = (this.aiMessages || [])[Number(idx)];
      if(!m) return;
      this.ttsSpeak(m.content || "");
    }

    // ---------- voice input (SpeechRecognition) ----------
    voiceRecSupported(){
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    voiceRecEnvOk(){
      const host = String(location.hostname || "");
      const ok = !!window.isSecureContext || host === "localhost" || host === "127.0.0.1";
      if(!ok) toast("语音输入需要 HTTPS 或 localhost 环境", "warn");
      return ok;
    }

    voiceRecExplainError(code){
      const host = String(location.hostname || "");
      const secure = !!window.isSecureContext || host === "localhost" || host === "127.0.0.1";
      const c = String(code || "unknown");
      if(c === "not-allowed" || c === "service-not-allowed"){
        if(!secure) return `${c}（需要 HTTPS/localhost；不要用 file:// 直接打开）`;
        return `${c}（麦克风权限被拒绝：点击地址栏左侧锁/设置，允许麦克风；或检查系统麦克风权限）`;
      }
      if(c === "not-found") return `${c}（未检测到麦克风设备）`;
      if(c === "network") return `${c}（网络/语音服务异常：可换 Chrome/Edge 或关闭代理）`;
      if(c === "aborted") return `${c}（识别被中断：可能同时开启了多个识别）`;
      return c;
    }

    stopVoiceInput(silent=false){
      if(this._recog){
        try{
          this._recog.onresult = null;
          this._recog.onerror = null;
          this._recog.onend = null;
          this._recog.stop();
        }catch(_e){}
      }
      this._recog = null;
      this._recogActive = false;
      this._recogStopByUser = true;
      this._recogTarget = null;
      this._recogQuizItemId = null;
      this.updateVoiceUI();
      if(!silent && this.voiceRecSupported()) toast("已停止语音输入", "ok");
    }

    createRecognition({lang=null, continuous=false, interimResults=true} = {}){
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if(!SR) return null;
      const r = new SR();
      const cfgLang = (lang !== null) ? lang : (this.settings.voice_rec?.lang ?? "zh-CN");
      if(cfgLang) r.lang = cfgLang;
      r.continuous = !!continuous;
      r.interimResults = !!interimResults;
      r.maxAlternatives = 1;
      return r;
    }

    updateVoiceUI(statusText=""){
      // AI page
      const aiBtn = $("#btnAiVoice");
      const aiStatus = $("#aiVoiceStatus");
      const canRec = (this.settings.voice_rec?.enabled !== false) && this.voiceRecSupported();
      const aiListening = !!(this._recogActive && this._recogTarget === "ai");
      if(aiBtn){
        if(!canRec){
          aiBtn.textContent = "🎙语音输入";
          aiBtn.disabled = !this.voiceRecSupported();
        }else{
          aiBtn.disabled = false;
          aiBtn.textContent = aiListening ? "🎙停止" : "🎙语音输入";
        }
      }
      if(aiStatus){
        if(aiListening){
          aiStatus.textContent = statusText || "🎙正在听…（说完稍等）";
          aiStatus.style.color = "var(--warn)";
        }else{
          // keep non-listening hint (tplAI already renders it)
          if(statusText) aiStatus.textContent = statusText;
        }
      }

      // Quiz modal
      const qBtn = $("#btnQuizVoice");
      const qStatus = $("#quizVoiceStatus");
      const quizListening = !!(this._recogActive && this._recogTarget === "quiz");
      if(qBtn){
        qBtn.textContent = quizListening ? "🎙停止作答" : "🎙语音作答";
      }
      if(qStatus){
        const def = qStatus.getAttribute("data-default") || qStatus.textContent || "";
        if(quizListening){
          qStatus.textContent = statusText || "🎙正在听…（说“选A/选B/选C/选D”）";
          qStatus.style.color = "var(--warn)";
        }else{
          qStatus.textContent = def;
          qStatus.style.color = "var(--muted)";
        }
      }
    }

    toggleVoiceAI(){
      if(this.settings.voice_rec?.enabled === false){
        toast("语音输入已关闭（可在系统设置开启）", "warn");
        return;
      }
      if(!this.voiceRecSupported()){
        toast("当前浏览器不支持语音识别", "warn");
        return;
      }
      if(!this.voiceRecEnvOk()) return;

      if(this._recogActive && this._recogTarget === "ai"){
        this.stopVoiceInput(true);
        this.renderPage();
        return;
      }
      this.startVoiceAI();
    }

    startVoiceAI(){
      const input = $("#aiInput");
      if(!input){ toast("找不到输入框", "bad"); return; }

      // stop any other recognition
      this.stopVoiceInput(true);
      this._recogStopByUser = false;
      const rec = this.createRecognition({continuous:true, interimResults:true});
      if(!rec){ toast("当前浏览器不支持语音识别", "warn"); return; }

      const base = String(input.value || "").trim();
      const prefix = base ? (base + "\n") : "";
      let finalText = "";

      this._recog = rec;
      this._recogActive = true;
      this._recogTarget = "ai";
      this.updateVoiceUI("🎙正在听…（说完稍等）");

      rec.onresult = (ev)=>{
        let interim = "";
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const res = ev.results[i];
          const txt = res[0]?.transcript || "";
          if(res.isFinal) finalText += txt;
          else interim += txt;
        }
        input.value = prefix + finalText + interim;
        const hint = interim ? ("🎙正在听…：" + interim.slice(-20)) : "🎙正在听…（说完稍等）";
        this.updateVoiceUI(hint);
      };

      rec.onerror = (e)=>{
        const msg = e?.error ? String(e.error) : "unknown";
        toast("语音识别失败：" + this.voiceRecExplainError(msg), "warn");
        this.stopVoiceInput(true);
        this.renderPage();
      };

      rec.onend = ()=>{
        const shouldAuto = !!this.settings.voice_rec?.auto_send_ai;
        const stoppedByUser = !!this._recogStopByUser;
        this._recogActive = false;
        this._recogTarget = null;
        this._recog = null;
        this.updateVoiceUI("");
        if(this.currentPage === "ai") this.renderPage();

        if(shouldAuto && !stoppedByUser){
          const msg = String(input.value || "").trim();
          if(msg) this.askAI();
        }
      };

      try{ rec.start(); }
      catch(e){ toast("无法启动语音识别：" + e.message, "warn"); this.stopVoiceInput(true); }
    }

    toggleVoiceQuiz(){
      if(this.settings.voice_rec?.enabled === false){
        toast("语音输入已关闭（可在系统设置开启）", "warn");
        return;
      }
      if(!this.voiceRecSupported()){
        toast("当前浏览器不支持语音识别", "warn");
        return;
      }
      if(!this.voiceRecEnvOk()) return;
      if(this._quizAnswered){
        toast("本题已提交，无法语音作答", "warn");
        return;
      }
      if(!this._quizCurrent || !this._quizCurrent.item_id){
        toast("当前没有可语音作答的题目", "warn");
        return;
      }

      if(this._recogActive && this._recogTarget === "quiz"){
        this.stopVoiceInput(true);
        return;
      }
      this.startVoiceQuiz();
    }

    parseChoiceFromSpeech(text, choices){
      const raw = String(text || "").trim();
      if(!raw) return null;
      const upper = raw.toUpperCase();
      const n = Array.isArray(choices) ? choices.length : 0;

      const letters = ["A","B","C","D","E","F"];
      for(let i=0; i<Math.min(n, letters.length); i++){
        const L = letters[i];
        if(upper.includes(L) || raw.includes("选"+L) || raw.includes("选择"+L) || raw.includes(L+"项")) return i;
      }

      const m = upper.match(/(^|\D)([1-6])($|\D)/);
      if(m){
        const idx = Number(m[2]) - 1;
        if(idx >= 0 && idx < n) return idx;
      }

      const cn = [["一",0],["二",1],["三",2],["四",3],["五",4],["六",5]];
      for(const [c, idx] of cn){
        if(raw.includes(c) && idx < n) return idx;
      }

      // True/False by matching option text
      if(n === 2){
        const yes = /对|正确|是/.test(raw);
        const no = /错|错误|不是|不对/.test(raw);
        if(yes || no){
          const idx = choices.findIndex(c=>{
            const s = String(c||"");
            return yes ? /对|正确|是/.test(s) : /错|错误|否|不是|不对/.test(s);
          });
          if(idx >= 0) return idx;
        }
      }

      return null;
    }

    showQuizVoicePrompt({itemId, skillId, choiceIndex, transcript=""}){
      const box = $("#quizResult");
      if(!box) return;
      const letter = String.fromCharCode(65 + Number(choiceIndex));
      box.setAttribute("data-voice", "1");
      box.innerHTML = `
        <div class="card" style="background: rgba(0,0,0,0.12);">
          <h3 class="h2" style="font-size:14px;">语音识别结果</h3>
          <div class="row" style="align-items:center; gap:10px;">
            <span class="badge warn">识别为</span>
            <b style="font-size:16px;">选择 ${letter}</b>
          </div>
          ${transcript ? `<div class="mini" style="margin-top:8px; color:var(--muted);">原话：${escapeHtml(String(transcript).slice(0,60))}${String(transcript).length>60?"…":""}</div>` : ""}
          <div class="hr"></div>
          <div class="row" style="gap:10px;">
            <button class="btn primary" data-action="voice-quiz-confirm" data-item="${Number(itemId)}" data-skill="${escapeHtml(skillId)}" data-choice="${Number(choiceIndex)}">确认提交</button>
            <button class="btn ghost" data-action="voice-quiz-cancel">取消</button>
          </div>
          <div class="mini" style="margin-top:8px; color:var(--muted);">提示：可再次点击“🎙语音作答”重录。</div>
        </div>
      `;
    }

    clearQuizVoicePrompt(){
      const box = $("#quizResult");
      if(!box) return;
      if(box.getAttribute("data-voice") === "1"){
        box.removeAttribute("data-voice");
        box.innerHTML = "";
      }
    }

    startVoiceQuiz(){
      this.clearQuizVoicePrompt();
      this.stopVoiceInput(true);
      this._recogStopByUser = false;
      const rec = this.createRecognition({continuous:false, interimResults:true});
      if(!rec){ toast("当前浏览器不支持语音识别", "warn"); return; }

      const cur = this._quizCurrent;
      const itemId = Number(cur.item_id);
      const sid = String(cur.skill_id || "");
      const choices = Array.isArray(cur.choices) ? cur.choices : [];

      this._recog = rec;
      this._recogActive = true;
      this._recogTarget = "quiz";
      this._recogQuizItemId = itemId;
      this.updateVoiceUI("🎙正在听…（说“选A/选B/选C/选D”）");

      let finalTranscript = "";

      rec.onresult = (ev)=>{
        let interim = "";
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const res = ev.results[i];
          const txt = res[0]?.transcript || "";
          if(res.isFinal) finalTranscript += txt;
          else interim += txt;
        }
        const show = interim ? interim : finalTranscript;
        if(show) this.updateVoiceUI("🎙识别中：" + String(show).slice(-22));

        // if we already have a final transcript, try to parse and finish
        if(finalTranscript.trim()){
          const idx = this.parseChoiceFromSpeech(finalTranscript, choices);
          if(idx !== null){
            // stop recognition; proceed
            this.stopVoiceInput(true);
            const needConfirm = (this.settings.voice_rec?.quiz_confirm !== false);
            if(needConfirm){
              this.showQuizVoicePrompt({itemId, skillId:sid, choiceIndex: idx, transcript: finalTranscript});
            }else{
              this.submitAnswer(itemId, idx, sid);
            }
          }
        }
      };

      rec.onerror = (e)=>{
        const msg = e?.error ? String(e.error) : "unknown";
        toast("语音识别失败：" + this.voiceRecExplainError(msg), "warn");
        this.stopVoiceInput(true);
      };

      rec.onend = ()=>{
        this._recogActive = false;
        this._recogTarget = null;
        this._recog = null;
        this.updateVoiceUI("");
      };

      try{ rec.start(); }
      catch(e){ toast("无法启动语音识别：" + e.message, "warn"); this.stopVoiceInput(true); }
    }

    renderMarkdown(md){
      const s = escapeHtml(md || "");
      // very small markdown-ish renderer
      let out = s
        .replace(/^###\s*(.*)$/gm, '<div class="h2" style="font-size:14px; margin:10px 0 6px;">$1</div>')
        .replace(/^##\s*(.*)$/gm, '<div class="h2" style="font-size:15px; margin:12px 0 6px;">$1</div>')
        .replace(/^#\s*(.*)$/gm, '<div class="h2" style="font-size:16px; margin:12px 0 6px;">$1</div>')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`(.+?)`/g, '<code style="padding:2px 6px; border-radius:8px; background:rgba(255,255,255,0.06);">$1</code>');

      // bullets
      out = out.replace(/^\-\s+/gm, "• ");
      // paragraphs
      out = out.replace(/\n\n+/g, "<br><br>").replace(/\n/g, "<br>");
      return out;
    }

    async saveNote(itemId, note){
      await this.api(`/api/items/${Number(itemId)}/note`, {method:"POST", body:{note: String(note||"")}});
      toast("笔记已保存", "ok");
    }

    async askAiForItemExplain(itemId, answerKey){
      const box = $("#aiExplainBox");
      if(box) box.innerHTML = `<div class="mini" style="color:var(--muted);">AI 讲解生成中...</div>`;
      try{
        const it = await this.api(`/api/items/${Number(itemId)}`);
        const choices = it.choices || [];
        const correctLetter = String.fromCharCode(65 + Number(answerKey));
        const choiceText = choices.map((c,i)=>`${String.fromCharCode(65+i)}. ${c}`).join("\n");
        const prompt = `请用中文给出这道题的讲解（步骤清晰、可操作），并指出为什么正确选项是 ${correctLetter}，其他选项错在哪。\n\n题目：${it.stem}\n\n选项：\n${choiceText}\n\n输出结构建议：\n1) 核心考点\n2) 正确选项理由\n3) 其他选项误区\n4) 记忆口诀/小贴士（可选）`;
        const cfg = this.getAiConfig();
        const rr = await this.api("/api/ai/chat", {method:"POST", body:{message: prompt, mode:"explain", config: cfg}});
        const txt = rr.reply || "";
        this._ttsCache = this._ttsCache || {};
        this._ttsCache.ai_explain = txt;
        if(box){
          box.innerHTML = `
            <div class="card" style="background: rgba(0,0,0,0.12);">
              <div class="row" style="align-items:center; gap:10px;">
                <span class="badge">AI解析</span>
                <button class="btn ghost" style="margin-left:auto;" data-action="tts-speak" data-tts="ai_explain">🔊朗读</button>
                <button class="btn ghost" data-action="tts-stop">⏹停止</button>
              </div>
              <div class="help" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(txt)}</div>
            </div>
          `;
        }
      }catch(e){
        if(box) box.innerHTML = `<div class="mini" style="color:var(--bad);">AI 讲解生成失败：${escapeHtml(e.message)}</div>`;
      }
    }

    aiFillCodex(){
      // 不强绑定具体模型名，避免版本差异；给出常用示例值，用户可自行改
      const base = $("#aiBase");
      const model = $("#aiModel");
      if(base && !base.value.trim()) base.value = "https://api.openai.com";
      if(model && !model.value.trim()) model.value = "gpt-5-codex";
      toast("已填入 Codex 常用配置（如不匹配可自行修改 Model）", "ok");
    }

    aiFillDeepSeek(){
      // DeepSeek 官方提供 OpenAI-compatible 接口（chat/completions）
      const base = $("#aiBase");
      const model = $("#aiModel");
      if(base) base.value = "https://api.deepseek.com";
      if(model && !model.value.trim()) model.value = "deepseek-chat";
      toast("已填入 DeepSeek 常用配置（Model 可选 deepseek-chat / deepseek-reasoner）", "ok");
    }

    aiExport(){
      const useServerKey = !!$("#aiUseServerKey")?.checked;
      const cfg = {
        base_url: ($("#aiBase")?.value || "").trim(),
        api_key: useServerKey ? "" : ($("#aiKey")?.value || "").trim(),
        model: ($("#aiModel")?.value || "").trim(),
        use_server_key: useServerKey,
      };
      const blob = new Blob([JSON.stringify(cfg, null, 2)], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "armedu_ai_config.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
      toast("已导出 AI 配置", "ok");
    }

    aiImport(){
      const f = $("#aiImportFile");
      if(!f) return;
      f.value = "";
      f.click();
    }

    async aiImportHandle(file){
      if(!file) return;
      try{
        const text = await file.text();
        const cfg = JSON.parse(text);
        if(cfg.base_url !== undefined) $("#aiBase").value = cfg.base_url || "";
        if(cfg.use_server_key !== undefined) $("#aiUseServerKey").checked = !!cfg.use_server_key;
        if(cfg.api_key !== undefined) $("#aiKey").value = cfg.api_key || "";
        if(cfg.model !== undefined) $("#aiModel").value = cfg.model || "";
        toast("已导入 AI 配置（记得点“保存设置”）", "ok");
      }catch(e){
        toast("导入失败：" + e.message, "bad");
      }
    }

    async aiTest(){
      const useServerKey = !!$("#aiUseServerKey")?.checked;
      const cfg = {
        base_url: ($("#aiBase")?.value || "").trim(),
        api_key: useServerKey ? "" : ($("#aiKey")?.value || "").trim(),
        model: ($("#aiModel")?.value || "").trim(),
      };
      const isLocal = /localhost|127\.0\.0\.1/i.test(cfg.base_url || "");
      if(!cfg.base_url || !cfg.model || (!cfg.api_key && !isLocal && !useServerKey)){
        toast(isLocal ? "请先填写 Base URL / Model（本地服务可不填 API Key）" : (useServerKey ? "请先填写 Base URL / Model（已启用服务端 Key）" : "请先填写 Base URL / API Key / Model"), "warn");
        return;
      }
      try{
        const r = await this.api("/api/ai/chat", {method:"POST", body:{message:"连接测试：请用一句话回复“OK”。", mode:"explain", config: cfg}});
        toast(r.used_external ? "连接测试通过（外部模型）" : (r.endpoint === "offline_mock" ? "连接测试：已切换离线" : `连接测试：外部失败（${r.endpoint||"error"}）`), r.used_external ? "ok" : "warn");
        showModal("AI 连接测试结果", `<div style="white-space:pre-wrap;line-height:1.6;">${safeText(r.reply)}</div>`,
          `<button class="btn primary" data-action="modal-close">关闭</button>`);
      }catch(e){
        toast("连接测试失败：" + e.message, "bad");
      }
    }

    async exportMy(){
      try{
        await this.download("/api/export/my_responses.csv", `my_responses_${this.currentUser?.username||"user"}.csv`);
        toast("已导出", "ok");
      }catch(e){
        toast("导出失败：" + e.message, "bad");
      }
    }

    async exportAll(){
      try{
        await this.download("/api/admin/export/responses.csv", "all_responses.csv");
        toast("已导出全站作答", "ok");
      }catch(e){
        toast("导出失败：" + e.message, "bad");
      }
    }

    async backupDb(){
      try{
        await this.download("/api/admin/db/backup", "armedu_backup.db");
        toast("已下载 DB 备份", "ok");
      }catch(e){
        toast("备份失败：" + e.message, "bad");
      }
    }

    async clearMy(){
      showModal("确认清空", `<div class="help">确定清空<strong>我的</strong>作答记录？掌握度与 θ 将重置。</div>`, `
        <button class="btn danger" data-action="clear-my-confirm">清空我的记录</button>
      `);
    }

    async clearMyConfirm(){
      try{
        await this.api("/api/reset/my_data", {method:"POST"});
        toast("已清空我的记录", "ok");
        closeModal();
        await this.switchPage("dashboard");
      }catch(e){
        toast("清空失败：" + e.message, "bad");
      }
    }

    async clearAll(){
      showModal("危险操作确认", `<div class="help">确定清空<strong>全站</strong>作答数据？（用户/题库保留）</div>`, `
        <button class="btn danger" data-action="clear-all-confirm">清空全站作答</button>
      `);
    }

    async clearAllConfirm(){
      try{
        await this.api("/api/admin/reset/all_data", {method:"POST"});
        toast("已清空全站作答", "ok");
        closeModal();
        await this.switchPage("monitor");
      }catch(e){
        toast("清空失败：" + e.message, "bad");
      }
    }

    async openImportCsvFromSettings(){
      // Reuse item import modal
      await this.itemOpenImport();
    }

    // ---------- topbar / clock ----------
    startClock(){
      const tick = ()=>{
        const el = $("#miniClock");
        if(!el) return;
        const now = new Date();
        const opt = {
          hour12: !this.settings.clock_24h,
          hour: "2-digit",
          minute: "2-digit",
          second: this.settings.clock_show_seconds ? "2-digit" : undefined,
        };
        const t = now.toLocaleTimeString("zh-CN", opt);
        const d = now.toLocaleDateString("zh-CN", {year:"numeric", month:"2-digit", day:"2-digit"});
        el.textContent = `${d} ${t}`;
      };
      tick();
      if(this._clockTimer) clearInterval(this._clockTimer);
      this._clockTimer = setInterval(tick, 1000);
    }

    // ---------- event binding ----------
    bindGlobalEvents(){
      // nav click
      document.addEventListener("click", (e)=>{
        const navItem = e.target.closest(".nav-item");
        if(navItem && navItem.dataset.page){
          this.switchPage(navItem.dataset.page);
        }
      });

      // action dispatcher
      document.addEventListener("click", (e)=>{
        const a = e.target.closest("[data-action]");
        if(!a) return;
        const act = a.dataset.action;
        if(act === "modal-close"){
          this.stopVoiceInput(true);
          closeModal(); return;
        }
        if(act === "start-training"){
          const sid = a.dataset.skill || null;
          this.startTraining(sid); return;
        }
        if(act === "ops-start"){
          const mid = a.dataset.mid || "";
          this.opsStart(mid); return;
        }
        if(act === "ops-briefing"){
          const mid = a.dataset.mid || "";
          this.opsBriefing(mid); return;
        }
        if(act === "ops-open-next"){
          this.opsOpenNext(); return;
        }
        if(act === "ops-next"){
          closeModal();
          this.opsOpenNext(); return;
        }
        if(act === "ops-exit"){
          this.opsExit(); return;
        }
        if(act === "goto-ops"){
          closeModal();
          this.switchPage("ops"); return;
        }
        if(act === "quiz-choose"){
          const item = a.dataset.item;
          const choice = a.dataset.choice;
          const sid = a.dataset.skill;
          this.submitAnswer(item, choice, sid); return;
        }
        if(act === "quiz-next"){
          const sid = a.dataset.skill || null;
          closeModal();
          this.startTraining(sid); return;
        }
        if(act === "wrong-practice"){
          const id = Number(a.dataset.id);
          this.openWrongItem(id); return;
        }
        if(act === "wrong-next"){
          this.openNextWrong(); return;
        }
        if(act === "goto-wrongbook"){
          closeModal();
          this.switchPage("wrongbook"); return;
        }
        if(act === "smart-open-lesson"){
          const sid = a.dataset.skill || "";
          this.openLessonModal(sid); return;
        }
        if(act === "smart-open-video"){
          const sid = a.dataset.skill || "";
          this.openLessonVideoModal(sid); return;
        }
        if(act === "lesson-complete"){
          const sid = a.dataset.skill || "";
          this.completeLesson(sid); return;
        }
        if(act === "lesson-video-toggle"){
          this.toggleLessonVideoPlay(); return;
        }
        if(act === "lesson-video-prev"){
          this.lessonVideoPrev(); return;
        }
        if(act === "lesson-video-next"){
          this.lessonVideoNext(); return;
        }
        if(act === "lesson-video-jump"){
          this.lessonVideoJump(a.dataset.idx); return;
        }
        if(act === "lesson-video-complete"){
          const sid = a.dataset.skill || "";
          this.completeLessonVideo(sid); return;
        }
        if(act === "lesson-video-regenerate" || act === "admin-generate-video"){
          const sid = a.dataset.skill || "";
          this.generateLessonVideo(sid, true, false); return;
        }
        if(act === "smart-start-skill"){
          const sid = a.dataset.skill || null;
          this.startTraining(sid); return;
        }
        if(act === "note-save"){
          const id = Number(a.dataset.item);
          this.saveNote(id); return;
        }
        if(act === "quiz-ai-explain"){
          const id = Number(a.dataset.item);
          const key = Number(a.dataset.key);
          this.askAiForItemExplain(id, key); return;
        }
        if(act === "quiz-visual-explain"){
          const id = Number(a.dataset.item);
          const key = Number(a.dataset.key);
          this.openVisualTutorForItem(id, key); return;
        }
        if(act === "tts-speak"){
          this.ttsSpeakKey(a.dataset.tts || ""); return;
        }
        if(act === "tts-ai"){
          this.ttsSpeakAi(Number(a.dataset.idx)); return;
        }
        if(act === "tts-stop"){
          this.ttsStop(); return;
        }
        if(act === "voice-ai-toggle"){
          this.toggleVoiceAI(); return;
        }
        if(act === "voice-quiz-toggle"){
          this.toggleVoiceQuiz(); return;
        }
        if(act === "voice-quiz-confirm"){
          const itemId = Number(a.dataset.item);
          const choice = Number(a.dataset.choice);
          const sid = a.dataset.skill || "";
          this.clearQuizVoicePrompt();
          this.submitAnswer(itemId, choice, sid); return;
        }
        if(act === "voice-quiz-cancel"){
          this.clearQuizVoicePrompt(); return;
        }
        if(act === "voice-test"){
          this.ttsSpeak("语音讲解已开启。你可以在系统设置里调整语速和音色。"); return;
        }
        if(act === "goto-analysis"){
          closeModal();
          this.switchPage("analysis"); return;
        }
        if(act === "open-settings"){
          this.switchPage("settings"); return;
        }
        if(act === "aiunit-open"){
          this.switchPage("ai"); return;
        }
        if(act === "aiunit-plan"){
          this.aiUnitGeneratePlan("daily"); return;
        }
        if(act === "aiunit-weak"){
          this.aiUnitGeneratePlan("weak"); return;
        }
        if(act === "ask-ai"){
          this.askAI(); return;
        }
        if(act === "ai-clear"){
          this.aiMessages = [];
          this.renderPage(); return;
        }
        if(act === "visual-open"){
          this.openVisualTutorFromInput(); return;
        }
        if(act === "visual-use-ai-input"){
          const aiInput = $("#aiInput");
          const visualInput = $("#visualPrompt");
          if(aiInput && visualInput) visualInput.value = aiInput.value || visualInput.value;
          return;
        }
        if(act === "visual-chip"){
          const visualInput = $("#visualPrompt");
          if(visualInput) visualInput.value = a.dataset.text || "";
          return;
        }
        if(act === "visual-prev"){
          this.visualTutorPrev(); return;
        }
        if(act === "visual-next"){
          this.visualTutorNext(); return;
        }
        if(act === "visual-toggle"){
          this.toggleVisualTutorPlay(); return;
        }
        if(act === "visual-jump"){
          this.visualTutorJump(a.dataset.idx); return;
        }
        if(act === "ai-set-mode"){
          this.aiMode = a.dataset.mode || "explain";
          toast("模式：" + (this.aiMode==="plan"?"计划":this.aiMode==="emotion"?"情绪支持":"讲解"), "ok");
          this.renderPage(); return;
        }

        // monitor/admin
        if(act === "admin-recalibrate"){ this.adminRecalibrate(); return; }
        if(act === "admin-export-all"){ this.exportAll(); return; }
        if(act === "admin-backup-db"){ this.backupDb(); return; }

        // knowledge
        if(act === "skill-detail"){ this.openSkillDetail(a.dataset.skill); return; }

        // question bank
        if(act === "item-search"){ this.itemSearch(); return; }
        if(act === "item-prev"){ this.itemPrev(); return; }
        if(act === "item-next"){ this.itemNext(); return; }
        if(act === "item-new"){ this.itemNew(); return; }
        if(act === "item-edit"){ this.itemEdit(a.dataset.id); return; }
        if(act === "item-save-new"){ this.itemSaveNew(); return; }
        if(act === "item-save-edit"){ this.itemSaveEdit(a.dataset.id); return; }
        if(act === "item-delete"){ this.itemDelete(a.dataset.id); return; }
        if(act === "item-delete-confirm"){ this.itemDeleteConfirm(a.dataset.id); return; }
        if(act === "item-import"){ this.itemOpenImport(); return; }
        if(act === "item-import-confirm"){ this.itemImportConfirm(); return; }

        // users
        if(act === "user-new"){ this.userNew(); return; }
        if(act === "user-save-new"){ this.userSaveNew(); return; }
        if(act === "user-edit"){ this.userEdit(a.dataset.id); return; }
        if(act === "user-save-edit"){ this.userSaveEdit(a.dataset.id); return; }
        if(act === "user-delete"){ this.userDelete(a.dataset.id); return; }
        if(act === "user-delete-confirm"){ this.userDeleteConfirm(a.dataset.id); return; }

        // settings
        if(act === "save-settings"){ this.saveSettingsFromUI(); return; }
        if(act === "ai-fill-codex"){ this.aiFillCodex(); return; }
        if(act === "ai-fill-deepseek"){ this.aiFillDeepSeek(); return; }
        if(act === "ai-export"){ this.aiExport(); return; }
        if(act === "ai-import"){ this.aiImport(); return; }
        if(act === "ai-test"){ this.aiTest(); return; }
        if(act === "export-my"){ this.exportMy(); return; }
        if(act === "export-all"){ this.exportAll(); return; }
        if(act === "backup-db"){ this.backupDb(); return; }
        if(act === "clear-my"){ this.clearMy(); return; }
        if(act === "clear-my-confirm"){ this.clearMyConfirm(); return; }
        if(act === "clear-all"){ this.clearAll(); return; }
        if(act === "clear-all-confirm"){ this.clearAllConfirm(); return; }
        if(act === "open-import-csv"){ this.openImportCsvFromSettings(); return; }
      });

      // file import (AI config)
      document.addEventListener("change", (e)=>{
        if(e.target && e.target.id === "aiImportFile"){
          const file = e.target.files && e.target.files[0];
          this.aiImportHandle(file);
        }
      });

      // topbar buttons
      $("#btnQuickTheme")?.addEventListener("click", ()=>{
        const cur = document.documentElement.dataset.theme || "cold";
        const next = cur === "cold" ? "warm" : "cold";
        this.settings.theme = next;
        this.applySettings();
        this.saveSettings();
        toast("主题已切换", "ok");
        // re-render charts for new theme
        this.renderPage();
      });

      $("#btnGoTrain")?.addEventListener("click", ()=> this.switchPage("training"));
      $("#btnRefresh")?.addEventListener("click", ()=> this.renderPage());
      $("#btnLogout")?.addEventListener("click", ()=> this.logout());

      // login tabs
      $$(".login-tab").forEach(tab=>{
        tab.addEventListener("click", ()=>{
          const tabName = tab.dataset.tab;
          $$(".login-tab").forEach(t=>t.classList.remove("active"));
          $$(".login-form").forEach(f=>f.classList.remove("active"));
          tab.classList.add("active");
          $("#" + tabName + "Form")?.classList.add("active");
        });
      });

      // login quick fill
      $("#btnFillT")?.addEventListener("click", ()=>{
        $("#loginUser").value = "trainee";
        $("#loginPass").value = "trainee123";
      });
      $("#btnFillA")?.addEventListener("click", ()=>{
        $("#loginUser").value = "admin";
        $("#loginPass").value = "admin123";
      });
      $("#btnClear")?.addEventListener("click", ()=>{
        $("#loginUser").value = "";
        $("#loginPass").value = "";
      });

      $("#btnLogin")?.addEventListener("click", ()=> this.handleLogin());
      $("#btnReg")?.addEventListener("click", ()=> this.handleRegister());

      // Enter to login
      $("#loginPass")?.addEventListener("keydown", (e)=>{
        if(e.key === "Enter") this.handleLogin();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    window.app = new ArmEduApp();
  });

})();
