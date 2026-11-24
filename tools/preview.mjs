// 生成 build/preview.html：用 src/gauge.ts 里真实的几何函数渲染六种组合，
// 不依赖浮屿运行时，用于在浏览器里核对形状与动画。
import { mkdirSync, writeFileSync } from "node:fs";
import { bubbles, capsulePath, capsulePerimeter, levelOf, sparkles, starPath, wavePath } from "../src/gauge.ts";

const W = 320;
const H = 84;

function gauge({ percent, color, style, showRing = false, animate = true }) {
  const inset = showRing ? 3.4 : 1;
  const level = levelOf(percent, inset, H - inset * 2);
  const period = Math.max(32, Math.round(H * 1.6));
  const amp = Math.max(1.4, Math.min(5, H * 0.06));
  const fontSize = Math.max(11, Math.min(34, Math.round(H * 0.46)));
  const ringPerim = capsulePerimeter(W, H, 1.6);
  const uid = Math.random().toString(36).slice(2, 8);
  const vars = `--battery-wave-period:${period}px;--battery-rise:${Math.max(12, H * 0.55)}px`;

  const liquid =
    style === "simple"
      ? `<rect x="0" y="${level}" width="${W}" height="${Math.max(0, H - level)}" fill="${color}"/>`
      : `<path d="${wavePath(W, H, level, period, amp)}" fill="${color}"/>`;

  const body = style === "simple" || !animate ? liquid : `<g class="wave">${liquid}</g>`;

  const particles =
    animate && style !== "simple"
      ? `<g clip-path="url(#liq${uid})">${
          style === "wave"
            ? bubbles(5, W, H)
                .map(
                  (b) =>
                    `<circle class="bubble" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(
                      2,
                    )}" fill="#fff" opacity="0.55" style="animation-delay:${b.delay.toFixed(2)}s;animation-duration:${b.dur.toFixed(
                      2,
                    )}s"/>`,
                )
                .join("")
            : sparkles(6, W, H)
                .map(
                  (s) =>
                    `<path class="sparkle" d="${starPath(s.x, s.y, s.r)}" fill="#fff" style="animation-delay:${s.delay.toFixed(
                      2,
                    )}s;animation-duration:${s.dur.toFixed(2)}s"/>`,
                )
                .join("")
        }</g>`
      : "";

  const ring = showRing
    ? `<path d="${capsulePath(W, H, 1.6)}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2.2"/>
       <path d="${capsulePath(W, H, 1.6)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"
         stroke-dasharray="${ringPerim.toFixed(2)}" stroke-dashoffset="${(ringPerim * (1 - percent / 100)).toFixed(2)}"/>`
    : "";

  return `<svg class="gauge" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${vars}">
  <defs>
    <clipPath id="cap${uid}"><path d="${capsulePath(W, H, inset)}"/></clipPath>
    <clipPath id="liq${uid}"><rect x="0" y="${level}" width="${W}" height="${Math.max(0, H - level)}"/></clipPath>
  </defs>
  <path d="${capsulePath(W, H, inset)}" fill="#1b2029" stroke="rgba(255,255,255,.14)" stroke-width="0.8"/>
  <g clip-path="url(#cap${uid})">${body}${particles}</g>
  ${ring}
  <text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}"
    font-weight="500" fill="#eaf2fb">${percent}%</text>
</svg>`;
}

const cards = [
  { title: "简单填充 · 充电蓝", percent: 68, color: "#3da9ff", style: "simple" },
  { title: "液体波浪 · 充电蓝", percent: 68, color: "#3da9ff", style: "wave" },
  { title: "光点和粒子 · 充电蓝", percent: 68, color: "#3da9ff", style: "sparkle" },
  { title: "液体波浪 + 圆环 · 充电绿", percent: 82, color: "#2fbf86", style: "wave", showRing: true },
  { title: "满电插电 · 光点 + 圆环 · 充电蓝", percent: 100, color: "#3da9ff", style: "sparkle", showRing: true },
  { title: "放电 32% · 黄色段", percent: 32, color: "#e0a13c", style: "wave" },
  { title: "放电 15% · 红色段", percent: 15, color: "#e05a5a", style: "sparkle", showRing: true },
];

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>电量插件 · 样式预览</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 28px; background: #0f1115; color: #eaf2fb;
         font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 15px; font-weight: 500; margin: 0 0 4px; }
  p.note { margin: 0 0 20px; color: #8b95a5; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
  .card { padding: 14px; border-radius: 12px; background: #11151c; border: 1px solid #262d38; }
  .card h2 { margin: 0 0 10px; font-size: 12px; font-weight: 400; color: #93a0b4; }
  .gauge { display: block; }
  @keyframes wave-shift { from { transform: translateX(0); } to { transform: translateX(calc(var(--battery-wave-period) * -1)); } }
  .wave { animation: wave-shift 3.6s linear infinite; }
  @keyframes bubble-rise {
    0% { transform: translateY(0); opacity: 0; }
    20% { opacity: .75; }
    100% { transform: translateY(calc(var(--battery-rise) * -1)); opacity: 0; }
  }
  .bubble { animation: bubble-rise 3s ease-in-out infinite; }
  @keyframes sparkle-pulse {
    0%, 100% { opacity: .12; transform: scale(.6); }
    50% { opacity: .9; transform: scale(1); }
  }
  .sparkle { transform-box: fill-box; transform-origin: center; animation: sparkle-pulse 2.6s ease-in-out infinite; }
</style>
</head>
<body>
<h1>电量插件 · 三种填充样式</h1>
<p class="note">几何与动画均来自插件源码（gauge.ts 与 styles.css），浮屿内表现与此一致。</p>
<div class="grid">
${cards
  .map(
    (c) => `  <div class="card"><h2>${c.title}</h2>${gauge({ percent: c.percent, color: c.color, style: c.style, showRing: c.showRing })}</div>`,
  )
  .join("\n")}
</div>
</body>
</html>`;

mkdirSync("build", { recursive: true });
writeFileSync("build/preview.html", html, "utf8");
console.log("wrote build/preview.html", html.length, "bytes");
