// 生成 README 顶部图：与 build/preview.html 相同的六种组合，
// 用 src/gauge.ts 的真实几何画成静态 SVG，再用 resvg 光栅化成 PNG。
//
// 用法（先装一次光栅化工具，它只在生成图片时需要）：
//   npm i -D @resvg/resvg-js
//   node --experimental-strip-types tools/preview-image.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bubbles, capsulePath, fillXOf, sparkles, starPath, wavePathH } from "../src/gauge.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAD = 32;
const GAP = 16;
const COLS = 3;
const CARD_W = 380;
const CARD_H = 142;
const GAUGE_W = CARD_W - 40;
const GAUGE_H = 68;
const W = PAD * 2 + CARD_W * COLS + GAP * (COLS - 1);
const ROWS = 2;
const HEAD = 78;
const H = HEAD + CARD_H * ROWS + GAP * (ROWS - 1) + PAD;

let uid = 0;

function gauge({ percent, color, style, showRing = false }) {
  const id = `g${uid++}`;
  const w = GAUGE_W;
  const h = GAUGE_H;
  const inset = showRing ? 1.6 : 1;
  const fillX = fillXOf(percent, inset, w - inset * 2);
  const period = Math.max(32, Math.round(h * 1.6));
  const amp = Math.max(1.4, Math.min(5, h * 0.06));
  const fontSize = Math.max(11, Math.min(34, Math.round(h * 0.46)));

  const fill =
    style === "simple"
      ? `<rect x="0" y="0" width="${Math.max(0, fillX).toFixed(2)}" height="${h}" fill="${color}"/>`
      : `<path d="${wavePathH(h, fillX, period, amp)}" fill="${color}"/>`;

  const particles =
    style === "simple"
      ? ""
      : `<g clip-path="url(#liq${id})">${
          style === "wave"
            ? bubbles(5, w, h)
                .map(
                  (b) =>
                    `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(2)}" fill="#fff" opacity="0.55"/>`,
                )
                .join("")
            : sparkles(6, w, h)
                .map((s) => `<path d="${starPath(s.x, s.y, s.r)}" fill="#fff" opacity="0.75"/>`)
                .join("")
        }</g>`;

  const ring = showRing
    ? `<path d="${capsulePath(w, h, 1.6)}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.4"/>`
    : "";

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">
  <defs>
    <clipPath id="cap${id}"><path d="${capsulePath(w, h, inset)}"/></clipPath>
    <clipPath id="liq${id}"><rect x="0" y="0" width="${Math.max(0, fillX).toFixed(2)}" height="${h}"/></clipPath>
  </defs>
  <path d="${capsulePath(w, h, inset)}" fill="#1b2029" stroke="rgba(255,255,255,.14)" stroke-width="0.8"/>
  <g clip-path="url(#cap${id})">${fill}${particles}</g>
  ${ring}
  <text x="${w / 2}" y="${(h / 2 + fontSize * 0.35).toFixed(1)}" text-anchor="middle" font-size="${fontSize}"
    font-weight="500" fill="#eaf2fb">${percent}%</text>
  <g clip-path="url(#liq${id})"><text x="${w / 2}" y="${(h / 2 + fontSize * 0.35).toFixed(1)}" text-anchor="middle"
    font-size="${fontSize}" font-weight="500" fill="#06222f">${percent}%</text></g>
</svg>`;
}

const cards = [
  { title: "简单填充 · 68% · 充电蓝", percent: 68, color: "#3da9ff", style: "simple" },
  { title: "液体波浪 · 68% · 充电蓝", percent: 68, color: "#3da9ff", style: "wave" },
  { title: "光点和粒子 · 68% · 充电蓝", percent: 68, color: "#3da9ff", style: "sparkle" },
  { title: "液体波浪 + 圆环 · 82% · 充电绿", percent: 82, color: "#2fbf86", style: "wave", showRing: true },
  { title: "满电插电 · 100% · 充电蓝（不掉回绿色）", percent: 100, color: "#3da9ff", style: "sparkle", showRing: true },
  { title: "放电 15% · 光点 + 圆环 · 红色段", percent: 15, color: "#e05a5a", style: "sparkle", showRing: true },
];

const cardSvg = cards
  .map((c, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + GAP);
    const y = HEAD + row * (CARD_H + GAP);
    return `<g transform="translate(${x} ${y})">
  <rect width="${CARD_W}" height="${CARD_H}" rx="12" fill="#11151c" stroke="#262d38"/>
  <text x="20" y="28" font-size="12" fill="#93a0b4">${c.title}</text>
  <g transform="translate(20 46)">${gauge(c)}</g>
</g>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0f1115"/>
<text x="${PAD}" y="40" font-size="17" font-weight="500" fill="#eaf2fb">浮屿电量插件 · 三种填充样式</text>
<text x="${PAD}" y="62" font-size="12" fill="#8b95a5">几何与配色来自插件源码（src/gauge.ts 与 styles.css），浮屿内表现与此一致</text>
${cardSvg}
</svg>`;

let Resvg;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch {
  console.error("需要先装光栅化工具：npm i -D @resvg/resvg-js");
  process.exit(1);
}

const docs = join(root, "docs");
mkdirSync(docs, { recursive: true });
writeFileSync(join(docs, "preview.svg"), svg, "utf8");

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W * 2 },
  font: {
    fontFiles: ["C:/Windows/Fonts/msyh.ttc"],
    loadSystemFonts: true,
    defaultFontFamily: "Microsoft YaHei",
  },
}).render().asPng();
writeFileSync(join(docs, "preview.png"), png);
console.log("wrote docs/preview.svg and docs/preview.png", png.length, "bytes");
