import type { Context } from "fuyu-plugin";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { bubbles, capsulePath, fillXOf, levelOf, sparkles, starPath, wavePath, wavePathH } from "./gauge.ts";
import { text } from "./text.ts";
import {
  DEFAULT_CONFIG,
  INITIAL_STATE,
  METHODS,
  TOPICS,
  isPlugged,
  normalizeConfig,
  toneOf,
  type BatteryConfig,
  type BatteryState,
  type FillStyle,
} from "./types.ts";
import "./styles.css";

function BatteryIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="17" height="10" rx="2.5" />
      <path d="M22 10.5v3" />
      <rect x="4.6" y="9.6" width="7.5" height="4.8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BoltIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.2 2 4.5 13.6h5.8L9.1 22l8.9-11.9h-5.9z" />
    </svg>
  );
}

function statusOf(state: BatteryState): string {
  if (!state.ok) {
    if (state.error === "no-battery") return text.noBattery;
    if (state.error === "wmi-failed") return text.wmiFailed;
    return text.readFailed;
  }
  if (state.full) return text.full;
  // 接了电就绝不说「使用中」：真在放电的「使用中」只留给拔掉电源之后。
  if (state.ac) return state.charging ? text.charging : text.plugged;
  return text.discharging;
}

function leftOf(state: BatteryState): string {
  // 充满时间优先用「剩余容量 ÷ 充电功率」算出来的那个，比 TimeToFullCharge 靠谱。
  const minutes = state.charging ? state.minutesToFull ?? state.minutes : state.minutes;
  if (!state.ok || minutes === null) return "";
  const span = text.span(minutes);
  return state.charging ? text.toFull(span) : text.remaining(span);
}

type GaugeProps = {
  w: number;
  h: number;
  percent: number;
  ok: boolean;
  color: string;
  style: FillStyle;
  showRing: boolean;
  animate: boolean;
  charging: boolean;
  /** h：液面竖直、从左往右推进（展开页）；v：液面水平、由下往上涨（挂件位，沿用原样式）。 */
  orientation?: "h" | "v";
};

// 三种样式共用一套几何：simple 只填色，wave 加正弦液面，sparkle 再叠光点。
function Gauge({ w, h, percent, ok, color, style, showRing, animate, charging, orientation = "h" }: GaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const inset = showRing ? 1.6 : 1;
  const vertical = orientation === "v";
  const fillX = vertical ? 0 : fillXOf(percent, inset, Math.max(1, w - inset * 2));
  const level = vertical ? levelOf(percent, inset, Math.max(1, h - inset * 2)) : 0;
  // 波浪周期取推进方向的垂直边：横条沿高度振荡，水位沿宽度振荡。
  // 水位在方形卡片里如果沿用 h*1.6，一个画面只装得下半个波，看着像一条斜直线，所以按宽度收。
  const period = vertical ? Math.max(32, Math.round(w / 2)) : Math.max(32, Math.round(h * 1.6));
  const amp = vertical ? Math.max(1.4, Math.min(7, h * 0.04)) : Math.max(1.4, Math.min(5, h * 0.06));
  const fontSize = Math.max(11, Math.min(34, Math.round(h * 0.46)));
  const label = ok ? `${percent}%` : "--";
  const vars = {
    // 液面左右轻晃 ±2：幅度小到只像水面在颤，不会被读成电量在跳。
    "--battery-sway": `${Math.max(1.5, Math.min(3, w * 0.008)).toFixed(1)}px`,
    // 水位模式靠平移「一个周期」表现流动：波形路径左右各多画一个周期，
    // 平移量超过一个周期，路径左边缘就会滑进画面，左侧露出底色（一条竖缝）。
    "--battery-wave-period": `${period}px`,
    // 粒子横向漂移的距离：跟着宽度走，窄条上不会一步跨出边界。
    "--battery-flow": `${Math.round(Math.max(36, w * 0.14))}px`,
    // 光带从左侧画外扫到右侧画外，行程按画布宽度算。
    "--battery-sheen-travel": `${Math.round(w * 1.3)}px`,
  } as Record<string, string>;

  const liquid = vertical
    ? style === "simple"
      ? <rect x={0} y={level} width={w} height={Math.max(0, h - level)} fill={color} />
      : <path d={wavePath(w, h, level, period, amp)} fill={color} />
    : style === "simple"
      ? <rect x={0} y={0} width={Math.max(0, fillX)} height={h} fill={color} />
      : <path d={wavePathH(h, fillX, period, amp)} fill={color} />

  const liquidClip = vertical
    ? <rect x={0} y={level} width={w} height={Math.max(0, h - level)} />
    : <rect x={0} y={0} width={Math.max(0, fillX)} height={h} />;

  return (
    <svg
      className={animate ? "battery-gauge" : "battery-gauge battery-still"}
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={vars as CSSProperties}
      role="img"
      aria-label={ok ? `${percent}%` : text.readFailed}
    >
      <defs>
        <clipPath id={`bcap${uid}`}>
          <path d={capsulePath(w, h, inset)} />
        </clipPath>
        <clipPath id={`bliq${uid}`}>{liquidClip}</clipPath>
      </defs>
      <path d={capsulePath(w, h, inset)} fill="var(--fuyu-plugin-surface)" stroke="var(--fuyu-plugin-border)" strokeWidth={0.8} />
      <g clipPath={`url(#bcap${uid})`}>
        {style === "simple" || !animate ? (
          liquid
        ) : (
          <g className={vertical ? "battery-wave battery-wave--v" : "battery-wave"}>{liquid}</g>
        )}
        {animate && style !== "simple" && (
          <g clipPath={`url(#bliq${uid})`}>
            {style === "wave" &&
              bubbles(5, w, h).map((b, i) => (
                <circle
                  key={`b${i}`}
                  className="battery-bubble"
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  fill="#ffffff"
                  opacity={0.55}
                  style={{ animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}
                />
              ))}
            {style === "sparkle" &&
              sparkles(6, w, h).map((s, i) => (
                <path
                  key={`s${i}`}
                  className="battery-sparkle"
                  d={starPath(s.x, s.y, s.r)}
                  fill="#ffffff"
                  style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
                />
              ))}
          </g>
        )}
        {/* 只在充电时扫光：液面以下的裁剪避免 100% 时压着胶囊顶边闪。 */}
        {animate && charging && (
          <g clipPath={`url(#bliq${uid})`}>
            <rect
              className="battery-sheen"
              x={-w * 0.28}
              y={0}
              width={Math.max(24, w * 0.22)}
              height={h}
              rx={h / 2}
              fill="#ffffff"
              opacity={0}
            />
          </g>
        )}
      </g>
      {/* 外描边：横向填充下圆环进度会和填充长度打架（15% 时刻度在右上角、液体在左边），
          所以这里只勾一圈同色边，进度交给液面表达。 */}
      {showRing && (
        <path
          d={capsulePath(w, h, 1.6)}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          opacity={0.4}
        />
      )}
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={500}
        fill="var(--fuyu-plugin-text)"
      >
        {label}
      </text>
      {/* 液面盖住的半个字换深色：横条填到一半时，单色字必然有一半糊在底色里。 */}
      <g clipPath={`url(#bliq${uid})`} aria-hidden="true">
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={500}
          fill="#06222f"
        >
          {label}
        </text>
      </g>
    </svg>
  );
}

export default function apply(ctx: Context) {
  function useBattery(): BatteryState {
    const [state, setState] = useState<BatteryState>(INITIAL_STATE);

    useEffect(() => {
      const off = ctx.host.on(TOPICS.state, (next: BatteryState) => setState(next));
      void ctx.host.call(METHODS.getState).then((value) => setState(value as BatteryState));
      return () => { void off(); };
    }, []);

    return state;
  }

  function useConfig(): BatteryConfig {
    const [config, setConfig] = useState<BatteryConfig>(DEFAULT_CONFIG);

    // 配置统一由宿主读盘后推过来：窗口侧拿不到 plugin-config 服务，
    // 之前直接调服务失败又被 catch 吞掉，所以面板改了样式岛上没反应。
    useEffect(() => {
      let alive = true;
      const apply = (values: unknown) => {
        if (alive) setConfig(normalizeConfig(values));
      };
      const off = ctx.host.on(TOPICS.config, apply);
      void ctx.host.call(METHODS.getConfig).then(apply).catch(() => {
        // 宿主没实现时保持默认样式，读数照常。
      });
      return () => {
        alive = false;
        void off();
      };
    }, []);

    return config;
  }

  function Page() {
    const state = useBattery();
    const config = useConfig();
    const percent = state.ok ? state.percent : 0;
    const color = toneOf(percent, isPlugged(state), config.chargeColor, config.customColor);

    return (
      <div className="battery">
        <p className="battery__head">
          <BatteryIcon size={15} />
          <span>{text.title}</span>
          <span className="battery__status">{statusOf(state)}</span>
        </p>
        <div className="battery__gauge">
          <Gauge
            w={320}
            h={84}
            percent={percent}
            ok={state.ok}
            color={color}
            style={config.style}
            showRing={config.showRing}
            animate={config.animate}
            charging={state.charging}
          />
        </div>
        <div className="battery__meta">
          <span>{text.labelStatus}</span>
          <span>{statusOf(state)}</span>
          <span>{state.charging ? text.labelTimeCharge : text.labelTimeUse}</span>
          <span>{leftOf(state) || "—"}</span>
          {state.watts !== null ? (
            <>
              <span>{text.labelPower}</span>
              <span>{text.watt(state.watts)}</span>
            </>
          ) : (
            // 插拔后 1.5 秒内功率是空的；这一行要占住位置，否则下面整块会上下跳。
            <>
              <span>{text.labelPower}</span>
              <span>—</span>
            </>
          )}
          <span>{text.labelBattery}</span>
          <span>{state.name || "—"}</span>
        </div>
        <div className="battery__actions">
          <button type="button" className="battery__button" onClick={() => void ctx.host.call(METHODS.refresh)}>
            {text.refresh}
          </button>
          <button type="button" className="battery__button" onClick={() => void ctx.settings.open()}>
            {text.settings}
          </button>
        </div>
        <p className="battery__status">{text.hint}</p>
      </div>
    );
  }

  function Widget({ size, width, height }: { size: "bar" | "s" | "m" | "l" | "w"; width: number; height: number }) {
    const state = useBattery();
    const config = useConfig();
    const w = Math.max(60, Math.round(width || 200));
    const h = Math.max(20, Math.round(height || 64));
    const compact = size === "bar" || size === "s" || h < 56;
    const percent = state.ok ? state.percent : 0;
    const color = toneOf(percent, isPlugged(state), config.chargeColor, config.customColor);
    const gaugeHeight = compact ? h : Math.max(24, h - 16);

    return (
      <div className="battery-widget">
        <div className="battery-widget__gauge">
          <Gauge
            w={w}
            h={gaugeHeight}
            percent={percent}
            ok={state.ok}
            color={color}
            style={config.style}
            showRing={config.showRing}
            animate={config.animate}
            charging={state.charging}
            orientation="v"
          />
        </div>
        {!compact && (
          <div className="battery-widget__foot">
            <span>{statusOf(state)}</span>
            <span>{leftOf(state)}</span>
          </div>
        )}
      </div>
    );
  }

  function BarItem() {
    const state = useBattery();
    const config = useConfig();
    const percent = state.ok ? state.percent : null;
    const color = toneOf(percent ?? 0, isPlugged(state), config.chargeColor, config.customColor);

    return (
      <div className="battery-bar" title={statusOf(state)}>
        {state.charging ? <BoltIcon size={12} /> : <BatteryIcon size={14} />}
        <span className="battery-bar__track">
          <span className="battery-bar__fill" style={{ width: `${percent ?? 0}%`, background: color }} />
        </span>
        <span className="battery-bar__pct">{percent === null ? "--" : percent}</span>
      </div>
    );
  }

  ctx.slots.add("island.page/v1", {
    id: "battery",
    title: { "zh-CN": "电量", en: "Battery" },
    component: Page,
    icon: BatteryIcon,
  });

  ctx.slots.add("island.collapsed/v1", {
    id: "battery-bar",
    label: { "zh-CN": "电量", en: "Battery" },
    opens: "battery",
    component: BarItem,
  });

  // 与录音插件同一套注册方式：island.widget/v1 必须直接在 ctx.slots 上调用，
  // 取出 add 当函数用会丢 this（Cannot read properties of undefined）。
  try {
    type WidgetSlotItem = { id: string; sizes: string[]; label: unknown; icon: unknown; component: unknown };
    type AddFn = (this: typeof ctx.slots, name: string, item: WidgetSlotItem) => () => void;
    (ctx.slots.add as unknown as AddFn).call(ctx.slots, "island.widget/v1", {
      id: "battery",
      sizes: ["bar", "s", "m", "l", "w"],
      label: { "zh-CN": "电量", en: "Battery" },
      icon: BatteryIcon,
      component: Widget,
    });
  } catch {
    // 旧版浮屿不认这个插槽时，页面和收起条仍可用。
  }
}
