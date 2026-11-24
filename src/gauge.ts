// 纯几何计算：胶囊轮廓、液面高度、波浪路径、粒子排布。
// 全部无副作用、可单测，界面层只负责把它们拼成 SVG。

export type Point = { x: number; y: number };

// 胶囊（圆角矩形，半径取高度一半）闭合路径；inset 用于把描边留在可视区内。
export function capsulePath(w: number, h: number, inset = 0): string {
  const x = inset;
  const y = inset;
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);
  const r = Math.min(ih / 2, iw / 2);
  const right = x + iw;
  const bottom = y + ih;
  return [
    `M ${x + r} ${y}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

// 圆环进度用它算总长：两条直边 + 两个半圆。
export function capsulePerimeter(w: number, h: number, inset = 0): number {
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);
  const r = Math.min(ih / 2, iw / 2);
  return 2 * (iw - 2 * r) + 2 * Math.PI * r;
}

// percent=0 液面贴底，100 贴顶；top 是容器内边距后的顶边。
export function levelOf(percent: number, top: number, height: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return top + height * (1 - p / 100);
}

// 液面波形：先一段二次贝塞尔，再用 T 连续反射控制点，得到平滑正弦。
// 路径左右各多画一个周期，横向平移一个周期即可无缝循环。
export function wavePath(w: number, h: number, level: number, period: number, amp: number): string {
  const seg = period / 2;
  const start = -period;
  const end = w + period;
  let d = `M ${start} ${level}`;
  d += ` Q ${start + seg / 2} ${level - amp} ${start + seg} ${level}`;
  let x = start + seg;
  while (x < end) {
    x += seg;
    d += ` T ${x} ${level}`;
  }
  d += ` L ${x} ${h} L ${start} ${h} Z`;
  return d;
}

// 固定种子的伪随机，保证同一尺寸下每次渲染位置一致，不会因重渲染抖动。
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Bubble = { x: number; y: number; r: number; delay: number; dur: number };

export function bubbles(count: number, w: number, h: number): Bubble[] {
  const rand = rng(Math.round(w * 7 + h * 13 + count));
  return Array.from({ length: count }, () => ({
    x: w * (0.08 + rand() * 0.84),
    y: h * (0.62 + rand() * 0.3),
    r: 1 + rand() * 1.8,
    delay: rand() * 3.2,
    dur: 2.4 + rand() * 1.2,
  }));
}

export type Sparkle = Point & { r: number; delay: number; dur: number };

export function sparkles(count: number, w: number, h: number): Sparkle[] {
  const rand = rng(Math.round(w * 11 + h * 17 + count));
  return Array.from({ length: count }, () => ({
    x: w * (0.12 + rand() * 0.76),
    y: h * (0.2 + rand() * 0.6),
    r: 1.8 + rand() * 2.2,
    delay: rand() * 2.4,
    dur: 2.2 + rand() * 1.4,
  }));
}

// 四角星：四个象限各一段短贝塞尔，形成尖角。
export function starPath(cx: number, cy: number, r: number): string {
  const k = r * 0.2;
  return [
    `M ${cx} ${cy - r}`,
    `Q ${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `Q ${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `Q ${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `Q ${cx - k} ${cy - k} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}
