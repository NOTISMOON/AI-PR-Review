"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  Bell,
  CheckCheck,
  Eye,
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
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";
import { invalidateCache } from "@/lib/client/data-cache";
import { toast } from "sonner";

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

/** 顶栏通知面板：未读角标 + 列表 + 已读 + 右键查看/删除 */
function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  // 右键菜单：目标通知 + 面板内坐标
  const [ctx, setCtx] = useState<{ id: number; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // 初始加载 + SSE 实时推送（多实例经 Redis 广播）+ 兜底轮询（断线保底）
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("notification", (e) => {
      // 收到通知说明服务端数据有更新，局部失效审查任务 / 通知缓存（provider 前缀此处无法得知，故只清通用前缀）
      invalidateCache("/api/review/tasks");
      invalidateCache("/api/notifications");
      load();
      // 实时 toast 提示（消息带 type/title/link）
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          type?: string;
          title?: string;
          link?: string;
        };
        if (data.title) {
          toast(data.title, {
            description: data.type === "review_completed" ? "AI 审查已完成，等待处理" : "新通知",
            action: data.link
              ? {
                  label: "查看",
                  onClick: () => {
                    window.location.href = data.link!;
                  },
                }
              : undefined,
          });
        }
      } catch {
        /* 消息解析失败仅刷新 */
      }
    });
    // EventSource 内置断线自动重连；onerror 无需额外逻辑
    return () => {
      clearInterval(t);
      es.close();
    };
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

  /** 删除单条通知：后端返回最新未读数，回写角标 */
  async function removeItem(id: number) {
    setCtx(null);
    try {
      const res = await authFetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (res.ok) {
        const removed = items.find((i) => i.id === id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        const d = await res.json().catch(() => null);
        setUnread(typeof d?.unread === "number" ? d.unread : Math.max(0, unread - (removed && !removed.read ? 1 : 0)));
      }
    } catch {
      /* 删除失败保持原状 */
    }
  }

  // 点击外部 / 滚动 / 其它交互时关闭右键菜单
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtx(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("scroll", () => setCtx(null), true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("scroll", onDoc, true);
    };
  }, []);

  const ctxItem = ctx ? items.find((i) => i.id === ctx.id) : null;

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
          <div className="min-h-[11.5rem] max-h-80 overflow-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-face-3">
                <Loader2 className="size-4 animate-spin" /> 加载中…
              </div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-[12.5px] text-face-3">暂无通知</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => markRead(n.id, n.link)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCtx({
                      id: n.id,
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    });
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer flex-col gap-0.5 border-b border-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-ink-850",
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
                  {ctx?.id === n.id && ctxItem && (
                    <div
                      ref={menuRef}
                      style={{ left: ctx.x, top: ctx.y }}
                      className="absolute z-50 w-28 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-m)]"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCtx(null);
                          markRead(n.id, n.link);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px] text-face-1 transition-colors hover:bg-ink-850"
                      >
                        <Eye className="size-3.5" /> 查看
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(n.id);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 border-t border-line bg-[var(--red-soft)]/40 px-3 py-2 text-left text-[12px] text-red transition-colors hover:bg-[var(--red-soft)]"
                      >
                        <Trash2 className="size-3.5" /> 删除
                      </button>
                    </div>
                  )}
                </div>
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
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  /** 全局搜索：独立下拉结果（仓库 + 按 PR title 匹配的 PR），不与仓库列表页搜索串数据 */
  const [gq, setGq] = useState("");
  const [gRepos, setGRepos] = useState<{ full_name: string; name: string; owner: string; description: string | null }[]>([]);
  const [gPrs, setGPrs] = useState<{ repo: string; number: number; title: string; html_url: string; state?: string }[]>([]);
  const [gOpen, setGOpen] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);
  const { meta, provider, ready } = usePlatform();

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

  // 待审 PR 角标：统计审查队列中待处理（PENDING）的数量
  const refreshPending = useCallback(async () => {
    try {
      const r = await authFetch("/api/review/tasks");
      if (!r.ok) return;
      const d = await r.json();
      if (!d?.jobs) return;
      const n = (d.jobs as { decision: string }[]).filter(
        (j) => j.decision === "PENDING",
      ).length;
      setPendingCount(n);
    } catch {
      /* 拉取失败保持旧值 */
    }
  }, []);

  // 刷新时机：路由变化 + 审查决策处理后的自定义事件 + 轮询兜底（保证处理完即更新，不依赖手动导航）
  useEffect(() => {
    refreshPending();
    const onJobsChanged = () => {
      // 审查决策处理后局部失效待审任务缓存，下次进入页面能拉到最新
      invalidateCache("/api/review/tasks");
      refreshPending();
    };
    window.addEventListener("review-jobs-changed", onJobsChanged);
    const t = setInterval(refreshPending, 30000);
    return () => {
      window.removeEventListener("review-jobs-changed", onJobsChanged);
      clearInterval(t);
    };
  }, [refreshPending, pathname]);

  // 全局搜索：防抖拉取当前平台匹配仓库 + 仓库内的匹配 PR（按 PR title / PR 号），渲染独立下拉列表
  useEffect(() => {
    const kw = gq.trim();
    if (!kw) {
      setGRepos([]);
      setGPrs([]);
      setGLoading(false);
      return;
    }
    if (!ready || (provider !== "github" && provider !== "gitee")) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setGLoading(true);
      try {
        const [rr, pr] = await Promise.all([
          // 仓库：模糊匹配仓库名/描述
          authFetch(`/api/${provider}/repos?q=${encodeURIComponent(kw)}&pageSize=50`),
          // PR：后端跨全仓库遍历（按 PR 标题 / PR 号），与仓库过滤解耦
          authFetch(`/api/${provider}/search-pr?q=${encodeURIComponent(kw)}`),
        ]);
        if (cancelled) return;
        setGRepos(rr.ok
          ? ((await rr.json()).repos ?? []).map((x: any) => ({
              full_name: x?.full_name,
              name: x?.name,
              owner: x?.full_name?.split("/")?.[0] ?? "",
              description: x?.description ?? null,
            }))
          : []);
        setGPrs(pr.ok ? (await pr.json()).prs ?? [] : []);
      } catch {
        if (!cancelled) {
          setGRepos([]);
          setGPrs([]);
        }
      } finally {
        if (!cancelled) setGLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [gq, provider, ready]);

  // 点击全局搜索框外部时收起下拉
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setGOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function goToRepo(full: string) {
    const [o, n] = full.split("/");
    if (o && n) router.push(`/repo?owner=${encodeURIComponent(o)}&repo=${encodeURIComponent(n)}`);
    setGOpen(false);
    setGq("");
  }

  function onSearchSubmit() {
    const kw = gq.trim();
    if (!kw) return;
    // 命中 PR → 打开第一个 PR；命中仓库 → 跳到第一个仓库；否则输入形如 owner/repo → 直接跳该仓库
    const firstPr = gPrs[0];
    if (firstPr?.html_url) {
      window.open(firstPr.html_url, "_blank", "noopener");
      setGOpen(false);
      setGq("");
      return;
    }
    const first = gRepos[0];
    if (first?.full_name) {
      goToRepo(first.full_name);
      return;
    }
    const slashes = kw.split("/").filter(Boolean);
    if (slashes.length === 2) {
      router.push(`/repo?owner=${encodeURIComponent(slashes[0])}&repo=${encodeURIComponent(slashes[1])}`);
      setGOpen(false);
      setGq("");
    }
  }

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

        {/* search：独立下拉结果（仓库），与仓库列表页搜索各自独立 */}
        {!collapsed && (
          <div ref={searchBoxRef} className="relative mx-3 mb-2 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-face-3" />
            <input
              value={gq}
              onChange={(e) => {
                setGq(e.target.value);
                setGOpen(true);
              }}
              onFocus={() => setGOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setGOpen(false);
                if (e.key === "Enter") onSearchSubmit();
              }}
              placeholder="搜索仓库 / PR…"
              aria-label="全局搜索"
              aria-expanded={gOpen}
              className="h-9 w-full rounded-md border border-border bg-ink-850 pr-8 pl-9 text-[13px] text-foreground placeholder:text-face-3 focus:border-amber focus:ring-[3px] focus:ring-amber/25 focus:outline-none"
            />
            {gq && (
              <button
                type="button"
                aria-label="清空全局搜索"
                onClick={() => {
                  setGq("");
                  setGRepos([]);
                  setGPrs([]);
                }}
                className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-face-3 transition-colors hover:bg-ink-800 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}

            {gOpen && gq.trim() && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-m)]">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-face-3 uppercase">
                    搜索 · {meta.name}
                  </span>
                  <span className="text-[10.5px] text-face-3">
                    {gLoading ? "搜索中…" : `PR ${gPrs.length} · 仓库 ${gRepos.length}`}
                  </span>
                </div>
                <div className="max-h-72 overflow-auto">
                  {gLoading && gPrs.length === 0 && gRepos.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-face-3">
                      <Loader2 className="size-3.5 animate-spin" /> 搜索中…
                    </div>
                  ) : gPrs.length === 0 && gRepos.length === 0 ? (
                    <div className="px-3 py-4 text-[12px] text-face-3">未找到匹配的仓库或 PR</div>
                  ) : (
                    <>
                      {gPrs.length > 0 && (
                        <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-face-3 uppercase">
                          Pull Requests
                        </div>
                      )}
                      {gPrs.map((p) => (
                        <button
                          key={`${p.repo}#${p.number}`}
                          type="button"
                          onClick={() => {
                            window.open(p.html_url, "_blank", "noopener");
                            setGOpen(false);
                            setGq("");
                          }}
                          className="flex w-full cursor-pointer items-start gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors hover:bg-ink-850"
                        >
                          <GitPullRequest className="mt-0.5 size-4 shrink-0 text-[var(--cyan)]" />
                          <div className="min-w-0">
                            <div className="truncate text-[12.5px] text-face-1">
                              <span className="font-mono text-[var(--cyan)]">#{p.number}</span>{" "}
                              {p.title}
                              {p.state && p.state !== "open" && (
                                <span className="ml-1.5 rounded px-1 py-px font-mono text-[9.5px] align-middle uppercase text-face-2 bg-ink-800">
                                  {p.state === "merged" ? "已合并" : p.state === "closed" ? "已关闭" : p.state}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-face-3">
                              {p.repo}
                            </div>
                          </div>
                        </button>
                      ))}

                      {gRepos.length > 0 && (
                        <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-face-3 uppercase">
                          仓库
                        </div>
                      )}
                      {gRepos.map((r) => (
                        <button
                          key={r.full_name}
                          type="button"
                          onClick={() => goToRepo(r.full_name)}
                          className="flex w-full cursor-pointer items-start gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-ink-850"
                        >
                          <FolderGit2 className="mt-0.5 size-4 shrink-0 text-amber" />
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[12.5px] text-face-1">
                              {r.full_name}
                            </div>
                            {r.description && (
                              <div className="mt-0.5 line-clamp-1 text-[11.5px] text-face-3">
                                {r.description}
                              </div>
                            )}
                          </div>
                          <span className="ml-auto mt-1 shrink-0 text-[10px] text-face-3">
                            {meta.name}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
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
