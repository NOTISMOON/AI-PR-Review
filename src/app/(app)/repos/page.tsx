"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Circle, FolderGit2, GitPullRequest, Search, ShieldCheck, Star } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";
import { CountUp, Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

type Platform = "github" | "gitee";
type ReviewStatus = "reviewing" | "enabled" | "off";
type Lang = "typescript" | "python" | "rust" | "go" | "javascript";

interface Repo {
  name: string;
  nameFocus: string;
  owner: string;
  platform: Platform;
  desc: string;
  lang: Lang;
  star: number;
  pending: number;
  status: ReviewStatus;
  updated: string;
}

const LANG_DOT: Record<Lang, string> = {
  typescript: "bg-[var(--cyan)]",
  javascript: "bg-[var(--amber)]",
  python: "bg-[var(--violet)]",
  go: "bg-[#46d1e8]",
  rust: "bg-[#ff8870]",
};

const LANG_LABEL: Record<Lang, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
};

/** 把 GitHub API 的语言名映射到本地 Lang 枚举（未知一律回退 typescript） */
function toLang(name: string | null): Lang {
  switch ((name || "").toLowerCase()) {
    case "typescript":
    case "ts":
      return "typescript";
    case "javascript":
    case "js":
      return "javascript";
    case "python":
      return "python";
    case "go":
      return "go";
    case "rust":
      return "rust";
    default:
      return "typescript";
  }
}

const STATUS_STYLE: Record<
  ReviewStatus,
  { label: string; className: string; pulse: boolean }
> = {
  reviewing: {
    label: "审查中",
    className: "bg-[var(--amber-soft)] text-[var(--amber)]",
    pulse: true,
  },
  enabled: {
    label: "已开启",
    className: "bg-[var(--green-soft)] text-[var(--green)]",
    pulse: false,
  },
  off: {
    label: "未开启",
    className: "bg-ink-800 text-face-2",
    pulse: false,
  },
};

const REPOS: Repo[] = [
  {
    name: "ai-pr-",
    nameFocus: "review",
    owner: "nicepkg",
    platform: "github",
    desc: "AI 代码审查平台核心仓库，Webhook 自动审查与多模型路由。",
    lang: "typescript",
    star: 128,
    pending: 2,
    status: "reviewing",
    updated: "2 小时前",
  },
  {
    name: "nextjs-",
    nameFocus: "blog",
    owner: "nicepkg",
    platform: "github",
    desc: "Next.js 14 + MDX 博客主题，SSR 与静态渲染示例。",
    lang: "typescript",
    star: 56,
    pending: 0,
    status: "enabled",
    updated: "昨天",
  },
  {
    name: "ml-",
    nameFocus: "toolkit",
    owner: "nicepkg",
    platform: "gitee",
    desc: "数据预处理与模型评估的机器学习工具集。",
    lang: "python",
    star: 42,
    pending: 2,
    status: "off",
    updated: "3 天前",
  },
  {
    name: "rust-",
    nameFocus: "parser",
    owner: "nicepkg",
    platform: "github",
    desc: "用 rust 编写的轻量异步 diff 解析库。",
    lang: "rust",
    star: 89,
    pending: 1,
    status: "enabled",
    updated: "4 天前",
  },
  {
    name: "go-",
    nameFocus: "gateway",
    owner: "nicepkg",
    platform: "gitee",
    desc: "基于 Go 的 API 网关，内置限流与鉴权中间件。",
    lang: "go",
    star: 67,
    pending: 0,
    status: "reviewing",
    updated: "6 天前",
  },
  {
    name: "ui-design-",
    nameFocus: "system",
    owner: "nicepkg",
    platform: "github",
    desc: "跨框架组件库与设计令牌，供 Forge 平台使用。",
    lang: "javascript",
    star: 31,
    pending: 0,
    status: "off",
    updated: "1 周前",
  },
];

const KPIS_ICON = {
  total: <FolderGit2 className="size-5" />,
  enabled: <ShieldCheck className="size-5" />,
  pending: <GitPullRequest className="size-5" />,
  auto: <Circle className="size-5" />,
} as const;

function RepoCard({ repo }: { repo: Repo }) {
  const status = STATUS_STYLE[repo.status];
  const owner = repo.owner.split(" · ")[0];
  const name = repo.name + repo.nameFocus;
  return (
    <Link
      href={`/repo?owner=${encodeURIComponent(owner || "nicepkg")}&repo=${encodeURIComponent(name)}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5.5 shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-m)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-semibold">
            {repo.name}
            <b className="text-amber">{repo.nameFocus}</b>
          </div>
          <div className="mt-0.5 font-mono text-[12.5px] text-face-3">
            {repo.owner} · {repo.platform === "github" ? "GitHub" : "Gitee"}
          </div>
        </div>
        <Badge
          data-slot="badge"
          className={cn(
            "rounded-full border-transparent px-2.5",
            status.className
          )}
          variant="outline"
        >
          <span
            className={cn(
              "size-1.5 rounded-full bg-current",
              status.pulse && "animate-pulse"
            )}
          />
          {status.label}
        </Badge>
      </div>

      <p className="mt-3 mb-3.5 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-face-2">
        {repo.desc}
      </p>

      <div className="mt-auto flex items-center gap-3.5 text-[12.5px] text-face-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn("size-2.25 rounded-full", LANG_DOT[repo.lang])}
          />
          {LANG_LABEL[repo.lang]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Star className="size-3.5" />
          {repo.star}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-[var(--amber)]" />
          {repo.pending} 待审
        </span>
        <span className="ml-auto">{repo.updated}</span>
      </div>
    </Link>
  );
}

export default function ReposPage() {
  const { provider, meta } = usePlatform();
  const [live, setLive] = useState<Repo[]>([]);
  const [liveLoading, setLiveLoading] = useState(provider === "github" || provider === "gitee");
  const [liveError, setLiveError] = useState<string | null>(null);

  // GitHub / Gitee：按当前登录身份拉取真实仓库；其它情况用 mock 兜底
  useEffect(() => {
    if (provider !== "github" && provider !== "gitee") {
      setLiveLoading(false);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    authFetch(`/api/${provider}/repos`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { repos?: any[]; login?: string };
      })
      .then(async (data) => {
        if (cancelled) return;
        const raw = (data.repos ?? []) as any[];
        const mapped: Repo[] = raw.map((r: any): Repo => ({
          name: r.full_name?.split("/")?.[1] ?? r.name,
          nameFocus: "",
          owner: data.login ?? "",
          platform: provider,
          desc: r.description || "(无描述)",
          lang: toLang(r.language),
          star: r.stargazers_count ?? 0,
          pending: 0,
          status: "off",
          updated: "",
        }));

        // 并行拉前 6 个仓库的 open PR 数（替换固定 0）
        const counts = await Promise.all(
          raw.slice(0, 6).map(async (r: any): Promise<number> => {
            if (!r?.full_name) return 0;
            const [o, n] = String(r.full_name).split("/");
            try {
              const res = await authFetch(`/api/${provider}/pulls?owner=${encodeURIComponent(o)}&repo=${encodeURIComponent(n)}`);
              if (!res.ok) return 0;
              const j = (await res.json()) as { pulls?: unknown[] };
              return (j.pulls ?? []).length;
            } catch {
              return 0;
            }
          }),
        );
        if (cancelled) return;
        setLive(mapped.map((m, i) => ({ ...m, pending: counts[i] ?? 0 })));
      })
      .catch((e) => {
        if (!cancelled) setLiveError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const mockList = REPOS.filter((r) => r.platform === provider);
  const isLive = provider === "github" || provider === "gitee";
  const list = isLive && live.length > 0 ? live : mockList;
  const kpis = [
    { label: "总仓库", value: list.length, icon: KPIS_ICON.total },
    { label: "已开启审查", value: list.filter((r) => r.status !== "off").length, icon: KPIS_ICON.enabled },
    { label: "待审 PR", value: list.reduce((s, r) => s + r.pending, 0), icon: KPIS_ICON.pending },
    { label: "审查中", value: list.filter((r) => r.status === "reviewing").length, icon: KPIS_ICON.auto },
  ];

  const syncedStatus = (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-face-2">
      <span className={`size-1.5 rounded-full ${liveLoading ? "bg-amber animate-pulse" : "bg-green"}`} />
      {liveLoading ? "同步中…" : `${isLive ? "实时" : "演示"} · ${list.length} 个仓库`}
    </span>
  );

  return (
    <Entrance className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <SplitTitle className="font-display text-[clamp(26px,3vw,34px)] font-semibold leading-tight tracking-[-0.02em]">
            仓库<b className="text-amber">列表</b>
          </SplitTitle>
          <p className="mt-1.5 text-[13px] text-face-3">
            当前 {meta.name} 视角 · 仅接入本平台的仓库，数据相互独立。
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">{syncedStatus}</div>
      </div>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-0">
            <CardContent className="flex items-center gap-4 px-5 py-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--amber-soft)] text-[var(--amber)]">
                {k.icon}
              </span>
              <div className="min-w-0">
                <div className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em]">
                  <CountUp to={k.value} />
                </div>
                <div className="mt-1 text-[13px] text-face-2">{k.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* 筛选（单登录身份：仅当前平台） */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-md border border-border bg-ink-850 p-0.5">
          <span className="rounded px-3 py-1.5 text-[12.5px] font-semibold bg-ink-700 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
            {meta.name}
          </span>
          <span className="px-3 py-1.5 text-[12.5px] text-face-3">数据独立</span>
        </div>
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-face-3" />
          <Input
            type="search"
            placeholder={`搜索${meta.name}仓库…`}
            aria-label="搜索仓库"
            className="h-9.5 border-line bg-ink-850 pl-9"
          />
        </div>
      </div>

      {/* 实时加载失败提示（回退演示数据时） */}
      {isLive && liveError && (
        <div className="rounded-md border border-amber/30 bg-amber/10 px-3.5 py-2 text-[12.5px] text-amber">
          实时数据加载失败（{liveError}），当前暂显示演示数据。
        </div>
      )}

      {/* 仓库网格 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLive && liveLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-border bg-card p-5.5">
              <div className="h-4 w-1/2 rounded bg-ink-700" />
              <div className="mt-3 h-3 w-3/4 rounded bg-ink-700/70" />
              <div className="mt-6 h-3 w-1/3 rounded bg-ink-700/50" />
            </div>
          ))
        ) : (
          list.map((repo) => <RepoCard key={repo.name + repo.nameFocus} repo={repo} />)
        )}
      </section>

      {/* 分页 */}
      <div className="flex items-center justify-between gap-3 text-[12.5px] text-face-3">
        <span>
          共 {list.length} 个仓库 · 当前显示 {list.length}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" disabled className="opacity-60">
            上一页
          </Button>
          <Button variant="secondary" size="sm">
            下一页
          </Button>
        </div>
      </div>
    </Entrance>
  );
}