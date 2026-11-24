import type { Context } from "fuyu-plugin";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { bubbles, capsulePath, capsulePerimeter, levelOf, sparkles, starPath, wavePath } from "./gauge.ts";
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
  return state.charging ? text.charging : text.discharging;
}

function leftOf(state: BatteryState): string {
  if (!state.ok || state.minutes === null) return "";
  const span = text.span(state.minutes);
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
};

// 三种样式共用一套几何：simple 只填色，wave 加正弦液面，sparkle 再叠光点。
function Gauge({ w, h, percent, ok, color, style, showRing, animate }: GaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const inset = showRing ? 3.4 : 1;
  const level = levelOf(percent, inset, Math.max(1, h - inset * 2));
  const period = Math.max(32, Math.round(h * 1.6));
  const amp = Math.max(1.4, Math.min(5, h * 0.06));
  const fontSize = Math.max(11, Math.min(34, Math.round(h * 0.46)));
  const ringPerim = capsulePerimeter(w, h, 1.6);
  const vars = {
    "--battery-wave-period": `${period}px`,
    "--battery-rise": `${Math.max(12, h * 0.55)}px`,
  } as Record<string, string>;

  const liquid =
    style === "simple" ? (
      <rect x={0} y={level} width={w} height={Math.max(0, h - level)} fill={color} />
    ) : (
      <path d={wavePath(w, h, level, period, amp)} fill={color} />
    );

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
        <clipPath id={`bliq${uid}`}>
          <rect x={0} y={level} width={w} height={Math.max(0, h - level)} />
        </clipPath>
      </defs>
      <path d={capsulePath(w, h, inset)} fill="var(--fuyu-plugin-surface)" stroke="var(--fuyu-plugin-border)" strokeWidth={0.8} />
      <g clipPath={`url(#bcap${uid})`}>
        {style === "simple" || !animate ? (
          liquid
        ) : (
          <g className="battery-wave">{liquid}</g>
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
      </g>
      {showRing && (
        <path d={capsulePath(w, h, 1.6)} fill="none" stroke="var(--fuyu-plugin-border)" strokeWidth={2.2} />
      )}
      {showRing && (
        <path
          d={capsulePath(w, h, 1.6)}
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeDasharray={ringPerim}
          strokeDashoffset={ringPerim * (1 - percent / 100)}
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
        {ok ? `${percent}%` : "--"}
      </text>
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
          />
        </div>
        <div className="battery__meta">
          <span>{text.labelStatus}</span>
          <span>{statusOf(state)}</span>
          <span>{state.charging ? text.labelTimeCharge : text.labelTimeUse}</span>
          <span>{leftOf(state) || "—"}</span>
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
