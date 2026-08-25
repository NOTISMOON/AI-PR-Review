"use client";

import { useRef, type ElementType, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

function prefersReduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 数字动画滚动（原型 [data-count]） */
export function CountUp({
  to,
  suffix = "",
  duration = 1.6,
  className,
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReduced()) {
        el.textContent = to.toLocaleString() + suffix;
        return;
      }
      // 重置旧值再滚动：to 变化（如 provider 校正 / 真实数据到达）时立即反映新目标，
      // 否则数字会停留在首帧 mock 上（KPI 被“冻死”，显示与同页实时数据不一致）。
      el.textContent = "0";
      const obj = { v: 0 };
      gsap.to(obj, {
        v: to,
        duration,
        ease: "power2.inOut",
        onUpdate: () => {
          if (ref.current)
            ref.current.textContent = Math.round(obj.v).toLocaleString() + suffix;
        },
      });
    },
    { scope: ref, dependencies: [to, duration, suffix] }
  );

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

/** 卡片 3D 倾斜（原型 .tilt，仅精确指针设备） */
export function Tilt({
  children,
  className,
  max = 10,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReduced() || window.matchMedia("(hover: none)").matches) return;
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        gsap.to(el, {
          rotationX:
            ((e.clientY - r.top) / r.height - 0.5) * -max,
          rotationY: ((e.clientX - r.left) / r.width - 0.5) * max,
          transformPerspective: 900,
          duration: 0.4,
        });
      };
      const onLeave = () =>
        gsap.to(el, { rotationX: 0, rotationY: 0, duration: 0.5, ease: "power2.out" });
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      return () => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
      };
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className} style={{ transformStyle: "preserve-3d" }}>
      {children}
    </div>
  );
}

/** 琥珀高亮笔横向扫过（原型 .hl-sweep 签名动画） */
export function HighlightSweep({
  children,
  className,
  delay = 0.5,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReduced()) return;
      const brush = document.createElement("span");
      brush.style.cssText =
        "position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;opacity:0.55;" +
        "background:linear-gradient(120deg,transparent 0%,#e8a33d 45%,#e8a33d 55%,transparent 100%);";
      el.style.position = "relative";
      el.style.overflow = "hidden";
      el.appendChild(brush);
      gsap.set(brush, { xPercent: -120 });
      gsap.to(brush, {
        xPercent: 250,
        duration: 1.1,
        ease: "power3.inOut",
        delay,
        onComplete: () => gsap.set(brush, { autoAlpha: 0 }),
      });
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** 挂载后对直接子元素做依次淡入上移 */
export function Entrance({
  children,
  y = 24,
  stagger = 0.08,
  delay = 0,
  duration = 0.7,
  className,
}: {
  children: ReactNode;
  y?: number;
  stagger?: number;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReduced()) return;
      gsap.from(root.current?.children ?? [], {
        y,
        opacity: 0,
        stagger,
        delay,
        duration,
        ease: "power3.out",
        clearProps: "all",
      });
    },
    { scope: root }
  );

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

/** 滚动进入视口时，对直接子元素逐一淡入 */
export function Reveal({
  children,
  y = 28,
  start = "top 88%",
  className,
}: {
  children: ReactNode;
  y?: number;
  start?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReduced()) return;
      const els = gsap.utils.toArray(root.current?.children ?? []);
      els.forEach((el) => {
        gsap.fromTo(
          el as Element,
          { y, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: {
              trigger: el as Element,
              start,
              toggleActions: "play none none none",
            },
          }
        );
      });
    },
    { scope: root }
  );

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

/**
 * 标题字符入场（原型 `.split-title`）
 * 字符自下而上带一点 3D 旋转升起，逐字推进。用于页头 h1 的“字体动画”。
 */
export function SplitTitle({
  children,
  className,
  as: Tag = "h1",
  delay = 0.08,
  stagger = 0.018,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  delay?: number;
  stagger?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReduced()) return;
      // 任何 SplitText 异常都静默降级，保证页面始终可用
      try {
        const split = SplitText.create(el, {
          type: "words, chars",
          mask: "words",
        });
        gsap.from(split.chars, {
          yPercent: 110,
          rotationX: 45,
          autoAlpha: 0,
          duration: 0.9,
          ease: "power3.out",
          stagger,
          delay,
        });
        return () => {
          try {
            split.revert();
          } catch {
            /* 恢复失败不致命 */
          }
        };
      } catch {
        /* SplitText 降级：保留原文 */
        return undefined;
      }
    },
    { scope: ref }
  );

  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}