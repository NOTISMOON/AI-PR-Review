"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  Bell,
  CheckCheck,
  FileCode2,
  FolderGit2,
  GitPullRequest,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Webhook,
} from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

gsap.registerPlugin(useGSAP);

const NAV: {
  group?: string;
  key?: string;
  label?: string;
  href?: string;
  icon?: React.ReactNode;
  badge?: string;
}[] = [
  { group: "工作台" },
  {
    key: "dashboard",
    label: "控制台",
    href: "/dashboard",
    icon: <LayoutDashboard className="size-[18px]" />,
  },
  { group: "仓库" },
  {
    key: "repos",
    label: "仓库列表",
    href: "/repos",
    icon: <FolderGit2 className="size-[18px]" />,
  },
  {
    key: "repo",
    label: "代码浏览",
    href: "/repo",
    icon: <FileCode2 className="size-[18px]" />,
  },
  { group: "审查" },
  {
    key: "review",
    label: "待审 PR",
    href: "/review",
    icon: <GitPullRequest className="size-[18px]" />,
  },
  {
    key: "history",
    label: "审查历史",
    href: "/history",
    icon: <History className="size-[18px]" />,
  },
  { group: "管理" },
  {
    key: "webhooks",
    label: "Webhook",
    href: "/webhooks",
    icon: <Webhook className="size-[18px]" />,
  },
  {
    key: "settings",
    label: "全局设置",
    href: "/settings",
    icon: <Settings className="size-[18px]" />,
  },
];

function BrandMark() {
  return (
    <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-lg bg-[radial-gradient(circle_at_30%_30%,var(--amber),#b97a1f)] font-mono text-[13px] font-bold text-[var(--text-on-amber)]">
      RF
    </span>
  );
}

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 顶栏通知面板：未读角标 + 列表 + 已读 */
function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setItems(d.items ?? []);
        setUnread(d.unread ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载未读数 + 每 30s 轮询
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // 点击外部关闭
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function markRead(id: number, link: string | null) {
    authFetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    setUnread((u) => Math.max(0, u - 1));
    if (link) window.location.href = link;
  }

  async function readAll() {
    authFetch("/api/notifications", { method: "POST" }).catch(() => {});
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="通知"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        className="relative"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-red px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-m)]">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="font-display text-[13.5px] font-semibold">通知</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] text-face-3 transition-colors hover:text-amber"
              >
                <CheckCheck className="size-3.5" /> 全部已读
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-face-3">
                <Loader2 className="size-4 animate-spin" /> 加载中…
              </div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-[12.5px] text-face-3">暂无通知</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id, n.link)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 border-b border-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-ink-850",
                    !n.read && "bg-[var(--amber-soft)]/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-amber" />}
                    <span className="text-[12.5px] font-semibold text-face-1">{n.title}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-face-3">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  {n.body && <p className="line-clamp-1 text-[11.5px] text-face-3">{n.body}</p>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);
  const { meta } = usePlatform();

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      tl.from(".aside-inner", { x: -16, autoAlpha: 0, duration: 0.45 })
        .from(
          "aside nav a, aside .side-group",
          { x: -14, autoAlpha: 0, duration: 0.4, stagger: 0.035 },
          "-=0.2"
        )
        .from(".app-topbar", { y: -16, autoAlpha: 0, duration: 0.45 }, "-=0.2")
        .from(
          "main > *",
          { y: 20, autoAlpha: 0, duration: 0.5, stagger: 0.06 },
          "-=0.25"
        );
    },
    { scope: shellRef }
  );

  // 待审 PR 角标：动态统计审查队列中待处理的数量
  useEffect(() => {
    let cancelled = false;
    authFetch("/api/review/tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.jobs) return;
        setPendingCount(d.jobs.filter((j: { decision: string }) => j.decision === "PENDING").length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const activeKey =
    NAV.filter((n) => n.href).find((n) =>
      pathname === n.href || pathname.startsWith((n.href as string) + "/")
    )?.key || "dashboard";

  const navWithBadge = NAV.map((n) =>
    n.key === "review" && pendingCount != null && pendingCount > 0
      ? { ...n, badge: String(pendingCount) }
      : n,
  );

  return (
    <div ref={shellRef} className="flex min-h-screen bg-background">
      {/* ===== Sidebar ===== */}
      <aside
        className={cn(
          "aside-inner sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {/* top */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2.5",
            collapsed ? "px-4 py-5" : "px-4.5 py-5"
          )}
        >
          <span className={collapsed ? "mx-auto" : ""}>
            <BrandMark />
          </span>
          {!collapsed && (
            <Link
              href="/dashboard"
              className="whitespace-nowrap font-display text-base font-semibold"
            >
              Review<b className="text-amber">Forge</b>
            </Link>
          )}
          {!collapsed && (
            <button
              ref={collapseBtnRef}
              aria-label="折叠侧边栏"
              onClick={() =>
                setCollapsed((prev) => {
                  if (collapseBtnRef.current) {
                    gsap.to(collapseBtnRef.current, {
                      rotation: prev ? 0 : 180,
                      duration: 0.3,
                      ease: "power2.inOut",
                    });
                  }
                  return !prev;
                })
              }
              className="ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-border text-face-2 transition-colors hover:border-amber/60 hover:bg-amber/10 hover:text-amber"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        {/* search */}
        {!collapsed && (
          <div className="relative mx-3 mb-2 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-face-3" />
            <input
              placeholder="搜索仓库 / PR…"
              aria-label="全局搜索"
              className="h-9 w-full rounded-md border border-border bg-ink-850 pl-9 pr-3 text-[13px] text-foreground placeholder:text-face-3 focus:border-amber focus:ring-[3px] focus:ring-amber/25 focus:outline-none"
            />
          </div>
        )}

        {/* nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-1.5">
          {navWithBadge.map((n, i) =>
            n.group ? (
              <div
                key={i}
                className={cn(
                  "px-2.5 pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.1em] text-face-3 uppercase",
                  collapsed && "hidden"
                )}
              >
                {n.group}
              </div>
            ) : (
              <Link
                key={n.key}
                href={n.href!}
                className={cn(
                  "relative mb-0.5 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
                  collapsed && "justify-center px-0",
                  activeKey === n.key
                    ? "bg-amber/10 text-amber"
                    : "text-face-2 hover:bg-ink-850 hover:text-foreground"
                )}
              >
                {activeKey === n.key && (
                  <span className="absolute top-1.5 bottom-1.5 -left-2.5 w-[3px] rounded-[3px] bg-amber shadow-[0_0_10px_var(--amber-glow)]" />
                )}
                <span className="shrink-0">{n.icon}</span>
                {!collapsed && <span className="min-w-0 truncate">{n.label}</span>}
                {!collapsed && n.badge && (
                  <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {n.badge}
                  </span>
                )}
              </Link>
            )
          )}
        </nav>

        {/* foot user */}
        <div className="shrink-0 border-t border-border p-3">
          <div
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-md p-2 hover:bg-ink-850",
              collapsed && "justify-center p-1.5"
            )}
          >
            <span className="size-8 shrink-0 overflow-hidden rounded-full border-2 border-line-strong">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={meta.avatar}
                alt={meta.user}
                className="size-full object-cover"
              />
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{meta.user}</div>
                <div className="truncate text-[11.5px] text-face-3">
                  {meta.authLabel}
                </div>
              </div>
            )}
          </div>

          {/* 退出登录（GET /api/auth/logout → 清 cookie + 删 Redis refresh） */}
          <div className={cn("mt-2 border-t border-line pt-2", collapsed && "flex justify-center")}>
            <a
              href="/api/auth/logout"
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-face-3 transition-colors hover:bg-red/10 hover:text-red",
                collapsed && "justify-center"
              )}
            >
              <LogOut className="size-4" />
              {!collapsed && <span>退出登录</span>}
            </a>
          </div>
        </div>
      </aside>

      {/* ===== Main ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar sticky top-0 z-30 flex h-15 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-xl">
          <span className="flex items-center gap-2 text-[13px] text-face-3">
            <span>ReviewForge</span>
            <span className="opacity-50">/</span>
            <b className="text-foreground">
              {NAV.find((n) => n.key === activeKey)?.label || "控制台"}
            </b>
          </span>
          <div className="ml-auto flex items-center gap-2.5">
            <Button asChild variant="default" size="sm">
              <Link href="/review">审查中心</Link>
            </Button>
            <NotificationPanel />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-7 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
