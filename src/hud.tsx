import type { Context } from "fuyu-plugin";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { METHODS, TOPICS, TONES, type HudKind, type HudPayload } from "./types.ts";
import { text } from "./text.ts";
import "./hud.css";

function BoltIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.2 2 4.5 13.6h5.8L9.1 22l8.9-11.9h-5.9z" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2 2.4 20h19.2z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.6 2.6L16 9.4" />
    </svg>
  );
}

// 拔掉电源用「插头断开」，和充电的闪电区分开，不用第二个电池图标。
function UnplugIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v3.2a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16.7V21" />
      <path d="M3.5 3.5 20.5 20.5" strokeWidth="1.6" opacity=".55" />
    </svg>
  );
}

function accentOf(kind: HudKind, percent: number): string {
  if (kind === "full") return TONES.green;
  if (kind === "low") return TONES.red;
  if (kind === "plug") return TONES.blue;
  // 拔电按剩余电量分档，和岛上的颜色一致。
  if (percent <= 20) return TONES.red;
  if (percent <= 40) return TONES.amber;
  return TONES.green;
}

function iconOf(kind: HudKind) {
  if (kind === "low") return <WarnIcon />;
  if (kind === "full") return <CheckIcon />;
  if (kind === "unplug") return <UnplugIcon />;
  return <BoltIcon />;
}

function copyOf(payload: HudPayload): { title: string; body: string } {
  const span = payload.minutes !== null ? text.span(payload.minutes) : "";
  switch (payload.kind) {
    case "plug":
      return {
        title: text.hudPlug,
        body: payload.charging && span ? text.hudPlugBody(span) : text.hudPlugIdle,
      };
    case "unplug":
      return {
        title: text.hudUnplug,
        body: span ? text.hudUnplugBody(span) : text.hudUnplugIdle,
      };
    case "low":
      return {
        title: text.hudLow,
        body: span ? text.hudLowBody(span) : text.hudLowIdle,
      };
    default:
      return { title: text.hudFull, body: text.hudFullBody };
  }
}

// 组件由 apply 现造：窗口侧要从闭包里拿到 ctx 才能订阅宿主。
export function createHudView(ctx: Context) {
  return function HudView() {
  const [payload, setPayload] = useState<HudPayload | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    let alive = true;

    const play = (next: HudPayload) => {
      if (!alive || next.seq <= lastSeq.current) return;
      lastSeq.current = next.seq;
      setPayload(next);
      // 内容先落地，下一帧再加动画类：同一帧里换内容又加类，浏览器会合并成「一出现就在终点」。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = shellRef.current;
          if (!el || !alive) return;
          el.classList.remove("hud--in");
          void el.offsetWidth;
          el.classList.add("hud--in");
        });
      });
    };

    const off = ctx.host.on(TOPICS.hud, (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const next = raw as HudPayload;
      if (typeof next.seq === "number") play(next);
    });

    // 浮层可能晚于第一条 publish 挂载，主动取一次当前内容。
    void ctx.host.call(METHODS.getHud).then((raw) => {
      if (!alive || !raw || typeof raw !== "object") return;
      const next = raw as HudPayload;
      if (typeof next.seq === "number") play(next);
    }).catch(() => {});

    return () => {
      alive = false;
      void off();
    };
  }, []);

  const copy = payload ? copyOf(payload) : null;
  const accent = payload ? accentOf(payload.kind, payload.percent) : TONES.blue;

  return (
    <div
      ref={shellRef}
      className="hud"
      data-kind={payload?.kind ?? "plug"}
      style={{ "--hud-accent": accent } as CSSProperties}
      aria-hidden={payload ? undefined : "true"}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget || payload === null) return;
        setPayload(null);
        void ctx.host.call(METHODS.hudDone, { seq: payload.seq }).catch(() => {});
      }}
    >
      <span className="hud__badge">{payload ? iconOf(payload.kind) : null}</span>
      <span className="hud__copy">
        <span className="hud__title">{copy?.title ?? ""}</span>
        <span className="hud__sub">{copy?.body ?? ""}</span>
      </span>
      <span className="hud__pct">
        {payload ? payload.percent : 0}
        <small>%</small>
      </span>
    </div>
  );
  };
}

