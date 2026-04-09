// 基于你提供的 army.html 中的动态背景脚本（保持原视觉风格）
// 通过 document.documentElement.dataset.motion = "reduced" 可关闭动画

(function(){
  try{
    const raw = localStorage.getItem("armedu_settings");
    if(raw){
      const s = JSON.parse(raw);
      if(s && s.theme) document.documentElement.dataset.theme = s.theme;
      if(s && s.motion === "reduced") document.documentElement.dataset.motion = "reduced";
    }
  }catch(e){}
})();
(function(){
            const root = document.documentElement;
            const reduceByPref = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            function reduced(){
                return reduceByPref || root.dataset.motion === "reduced";
            }

            const cGrid = document.getElementById("bg_grid");
            const cRadar = document.getElementById("bg_radar");
            const cPart = document.getElementById("bg_particles");
            if(!cGrid || !cRadar || !cPart) return;

            const ctxG = cGrid.getContext("2d");
            const ctxR = cRadar.getContext("2d");
            const ctxP = cPart.getContext("2d");

            let time = 0;
            const particles = [];

            function resizeAll(){
                const w = window.innerWidth;
                const h = window.innerHeight;
                [cGrid, cRadar, cPart].forEach(c => {
                    c.width = w;
                    c.height = h;
                });
                particles.length = 0;
            }

            // 网格背景
            function drawGrid(){
                const w = cGrid.width;
                const h = cGrid.height;
                ctxG.clearRect(0,0,w,h);
                const size = 60;
                const shift = (time * 0.7) % size;
                ctxG.strokeStyle = "rgba(120, 175, 255, 0.08)";
                ctxG.lineWidth = 1;

                for(let x = shift; x < w; x += size){
                    ctxG.beginPath();
                    ctxG.moveTo(x, 0);
                    ctxG.lineTo(x, h);
                    ctxG.stroke();
                }
                for(let y = shift; y < h; y += size){
                    ctxG.beginPath();
                    ctxG.moveTo(0, y);
                    ctxG.lineTo(w, y);
                    ctxG.stroke();
                }
            }

            // 雷达扫描
            function drawRadar(){
                const w = cRadar.width;
                const h = cRadar.height;
                ctxR.clearRect(0,0,w,h);
                const cx = w - 70;
                const cy = 70;
                const r = 50;

                ctxR.strokeStyle = "rgba(0,229,255,0.25)";
                ctxR.lineWidth = 1;
                ctxR.beginPath();
                ctxR.arc(cx, cy, r, 0, Math.PI*2);
                ctxR.stroke();

                ctxR.beginPath();
                ctxR.arc(cx, cy, r*0.66, 0, Math.PI*2);
                ctxR.stroke();

                ctxR.beginPath();
                ctxR.arc(cx, cy, r*0.33, 0, Math.PI*2);
                ctxR.stroke();

                // 扫描线
                const angle = time % (Math.PI*2);
                ctxR.fillStyle = "rgba(0,229,255,0.12)";
                ctxR.beginPath();
                ctxR.moveTo(cx, cy);
                ctxR.arc(cx, cy, r, angle - 0.3, angle);
                ctxR.closePath();
                ctxR.fill();
            }

            // 粒子系统
            function initParticles(){
                const w = cPart.width;
                const h = cPart.height;
                const count = Math.min(40, Math.floor(w * h / 30000));
                for(let i=0; i<count; i++){
                    particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        vx: (Math.random()-0.5)*0.8,
                        vy: (Math.random()-0.5)*0.8,
                        r: Math.random()*2 + 0.5,
                        life: 1
                    });
                }
            }

            function drawParticles(){
                const w = cPart.width;
                const h = cPart.height;
                ctxP.clearRect(0,0,w,h);

                particles.forEach(p => {
                    p.x += p.vx;
                    p.y += p.vy;
                    if(p.x < 0 || p.x > w) p.vx *= -1;
                    if(p.y < 0 || p.y > h) p.vy *= -1;

                    ctxP.fillStyle = "rgba(0,229,255,0.5)";
                    ctxP.beginPath();
                    ctxP.arc(p.x, p.y, p.r, 0, Math.PI*2);
                    ctxP.fill();

                    // 连线
                    ctxP.strokeStyle = "rgba(0,229,255,0.12)";
                    ctxP.lineWidth = 0.5;
                    particles.forEach(other => {
                        const dx = p.x - other.x;
                        const dy = p.y - other.y;
                        const d = Math.sqrt(dx*dx + dy*dy);
                        if(d < 100){
                            ctxP.beginPath();
                            ctxP.moveTo(p.x, p.y);
                            ctxP.lineTo(other.x, other.y);
                            ctxP.stroke();
                        }
                    });
                });
            }

            function animate(){
                if(reduced()) return;
                time += 0.016;
                drawGrid();
                drawRadar();
                drawParticles();
                requestAnimationFrame(animate);
            }

            resizeAll();
            initParticles();
            if(!reduced()) animate();
            window.addEventListener("resize", () => {
                resizeAll();
                if(!reduced()) initParticles();
            });
        })();