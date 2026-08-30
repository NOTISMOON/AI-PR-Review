"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/app/components/ui/utils";

gsap.registerPlugin(useGSAP);

/** 复用的像素安全下拉项 */
export interface AnimatedSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface AnimatedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AnimatedSelectOption[];
  placeholder?: string;
  /** 触发器左侧图标（如分支的 GitBranch） */
  icon?: ReactNode;
  /** 触发器额外类名 */
  triggerClassName?: string;
  /** 菜单浮层额外类名（内边距/宽度等） */
  menuClassName?: string;
  ariaLabel?: string;
  maxHeight?: string;
  align?: "start" | "end";
}

function prefersReduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 自定义动画下拉框。
 * - 展开/收起：GSAP 缩放 + 淡入 + 位移，选项逐条滑入（prefers-reduced-motion 时静默降级为瞬时切换）。
 * - 键盘可达：Enter/Space 开合，↑/↓ 移动高亮，Enter 选中，Esc 关闭，焦点状态可感知。
 * - 点击外部 / Esc 自动关闭。
 */
export function AnimatedSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  icon,
  triggerClassName,
  menuClassName,
  ariaLabel,
  maxHeight = "max-h-72",
  align = "start",
}: AnimatedSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const closingRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const id = useId();

  const selected = options.find((o) => o.value === value);

  /** 打开：入场动画（菜单容器 + 选项逐条） */
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const list = listRef.current;
    if (!menu) return;
    const reduce = prefersReduced();
    gsap.set(menu, { autoAlpha: 0, y: align === "end" ? 8 : -8, scale: 0.96 });
    gsap.to(menu, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: reduce ? 0 : 0.2,
      ease: "power2.out",
      clearProps: "opacity",
    });
    if (list && !reduce) {
      const items = gsap.utils.toArray<HTMLElement>(list.children);
      gsap.fromTo(
        items,
        { y: 6, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.24,
          stagger: Math.min(0.022, 0.4 / Math.max(items.length, 1)),
          ease: "power2.out",
          delay: 0.05,
          clearProps: "opacity",
        },
      );
    }
  }, [open, align]);

  function openMenu() {
    closingRef.current = false;
    setOpen(true);
  }

  function closeMenu() {
    const menu = menuRef.current;
    if (!menu || prefersReduced() || closingRef.current) {
      closingRef.current = false;
      setOpen(false);
      return;
    }
    closingRef.current = true;
    gsap.to(menu, {
      autoAlpha: 0,
      y: -4,
      scale: 0.98,
      duration: 0.12,
      ease: "power1.in",
      onComplete: () => {
        closingRef.current = false;
        setOpen(false);
      },
    });
  }

  function toggle() {
    if (open) closeMenu();
    else {
      setActiveIndex(
        Math.max(
          0,
          options.findIndex((o) => o.value === value),
        ),
      );
      openMenu();
    }
  }

  function pick(o: AnimatedSelectOption) {
    if (o.disabled) return;
    if (o.value !== value) onChange(o.value);
    closeMenu();
  }

  // 全局键盘 + 点击外部
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const dir = e.key === "ArrowDown" ? 1 : -1;
          const enabled = options
            .map((o, i) => (o.disabled ? -1 : i))
            .filter((i) => i >= 0);
          if (!enabled.length) return prev;
          const cur = enabled.indexOf(
            Math.max(
              0,
              enabled.findIndex((i) => i === prev),
            ),
          );
          const next = enabled[(cur + dir + enabled.length) % enabled.length];
          listRef.current?.children[next]?.scrollIntoView({
            block: "nearest",
          });
          return next;
        });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (activeIndex >= 0 && activeIndex < options.length) {
          e.preventDefault();
          pick(options[activeIndex]);
        }
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options, activeIndex, value, onChange]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-ink-850 px-2.5 font-mono text-[12.5px] text-face-1 outline-none transition-colors focus-visible:border-amber focus-visible:ring-[3px] focus-visible:ring-amber/25 whitespace-nowrap",
          triggerClassName,
        )}
      >
        {icon ? (
          <span className="pointer-events-none shrink-0 text-[var(--amber)]">
            {icon}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            !selected && "text-face-3",
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "pointer-events-none size-3.5 shrink-0 text-face-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-labelledby={id}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 min-w-full origin-top overflow-hidden rounded-md border border-line-strong bg-ink-800 p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]",
            align === "end" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          <ul
            ref={listRef}
            role="presentation"
            className={cn("overflow-y-auto", maxHeight)}
          >
            {options.map((o, idx) => {
              const active = activeIndex === idx;
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-mono text-[12.5px] text-face-1 whitespace-nowrap transition-colors",
                    active && "bg-ink-700 text-foreground",
                    isSel && "text-amber",
                    o.disabled && "pointer-events-none opacity-40",
                  )}
                >
                  <span className="w-3.5 shrink-0">
                    {isSel ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </span>
                  <span className="min-w-0">{o.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}