"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Circle, FolderGit2, GitPullRequest, Search, ShieldCheck, Star, X } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";
import { CountUp, Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { cachedFetch } from "@/lib/client/data-cache";

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
  const { provider, meta, ready } = usePlatform();
  const [live, setLive] = useState<Repo[]>([]);
  const [liveLoading, setLiveLoading] = useState(provider === "github" || provider === "gitee");
  const [liveError, setLiveError] = useState<string | null>(null);
  /** 分页：每页固定展示 6 个，切换页时仅统计当前 6 个的待审数 */
  const PAGE_SIZE = 6;
  const [page, setPage] = useState(1);
  /** 各仓库 open PR 数（full_name → count），按访问过的页累积，便于切回直接命中 */
  const [pendingMap, setPendingMap] = useState<Record<string, number>>({});
  /** 后端分页返回的全量聚合（真分页：总仓库数 / 已开启审查数 / 审查中数） */
  const [total, setTotal] = useState(0);
  const [enabledCount, setEnabledCount] = useState(0);
  const [reviewingCount, setReviewingCount] = useState(0);
  /** 模糊搜索：输入 → 防抖到 debouncedQ，随分页一并请求后端过滤 */
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // 从 URL ?q= 初始化（支持侧边栏全局搜索跳转带关键词）
  useEffect(() => {
    const urlQ = new URLSearchParams(window.location.search).get("q") || "";
    setQ(urlQ);
    setDebouncedQ(urlQ);
  }, []);

  // 输入防抖 + 切回第 1 页
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // GitHub / Gitee：按当前登录身份 + 页码分页拉取真实仓库（后端每个 status 已算好）
  useEffect(() => {
    if (!ready) return; // 身份未校正前不发平台请求，避免首帧误打错误平台接口产生 401
    if (provider !== "github" && provider !== "gitee") {
      setLiveLoading(false);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) sp.set("q", debouncedQ);
    cachedFetch<{
      repos?: any[];
      total?: number;
      enabledCount?: number;
      reviewingCount?: number;
      login?: string;
    }>(`/api/${provider}/repos?${sp.toString()}`, 30)
      .then((data) => {
        if (cancelled) return;
        const totalN = typeof data.total === "number" ? data.total : (data.repos ?? []).length;
        setTotal(totalN);
        setEnabledCount(typeof data.enabledCount === "number" ? data.enabledCount : 0);
        setReviewingCount(typeof data.reviewingCount === "number" ? data.reviewingCount : 0);
        // 后端已给每条 status；此处仅拼接前端展示所需字段
        const mapped: Repo[] = (data.repos ?? []).map((r: any): Repo => ({
          name: r.full_name?.split("/")?.[1] ?? r.name,
          nameFocus: "",
          owner: r.full_name?.split("/")?.[0] ?? data.login ?? "",
          platform: provider,
          desc: r.description || "(无描述)",
          lang: toLang(r.language),
          star: r.stargazers_count ?? 0,
          pending: 0,
          status: r.status === "reviewing" || r.status === "enabled" ? r.status : "off",
          updated: "",
        }));
        setLive(mapped);
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
  }, [provider, ready, page, debouncedQ]);

  // 切换平台时回到第 1 页，避免停留在旧平台的页码
  useEffect(() => {
    setPage(1);
  }, [provider]);

  const isLive = provider === "github" || provider === "gitee";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageKey = (r: Repo) => `${r.owner}/${r.name}`;
  const kpis = [
    { label: "总仓库", value: total, icon: KPIS_ICON.total },
    { label: "已开启审查", value: enabledCount, icon: KPIS_ICON.enabled },
    { label: "待审 PR", value: live.reduce((s, r) => s + (pendingMap[pageKey(r)] ?? 0), 0), icon: KPIS_ICON.pending },
    { label: "审查中", value: reviewingCount, icon: KPIS_ICON.auto },
  ];

  // 分页待审：仅拉取「当前页」仓库的 open PR 数，写入 pendingMap（切回已访问页直接命中）
  useEffect(() => {
    if (!ready || !live.length) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const repo of live) {
        const owner = repo.owner;
        const name = repo.name;
        const key = `${owner}/${name}`;
        if (!owner || !name) {
          next[key] = 0;
          continue;
        }
        try {
          const j = await cachedFetch<{ pulls?: unknown[] }>(
            `/api/${provider}/pulls?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(name)}`,
            60,
          );
          next[key] = (j.pulls ?? []).length;
        } catch {
          next[key] = 0;
        }
      }
      if (!cancelled) setPendingMap((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [live, provider, ready, page]);

  const syncedStatus = (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-face-2">
      <span className={`size-1.5 rounded-full ${liveLoading ? "bg-amber animate-pulse" : "bg-green"}`} />
      {liveLoading ? "同步中…" : "实时"} · {total} 个仓库
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`搜索${meta.name}仓库…`}
            aria-label="搜索仓库"
            className="h-9.5 border-line bg-ink-850 pr-9 pl-9"
          />
          {q && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-face-3 transition-colors hover:bg-ink-800 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 实时加载失败提示 */}
      {isLive && liveError && (
        <div className="rounded-md border border-amber/30 bg-amber/10 px-3.5 py-2 text-[12.5px] text-amber">
          实时数据加载失败（{liveError}），请确认授权后重试。
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
          live.map((repo) => (
            <RepoCard
              key={`${repo.owner}/${repo.name}${repo.nameFocus}`}
              repo={{ ...repo, pending: pendingMap[pageKey(repo)] ?? 0 }}
            />
          ))
        )}
      </section>

      {/* 分页：每页 6 个，仅请求/统计当前页 */}
      <div className="flex items-center justify-between gap-3 text-[12.5px] text-face-3">
        <span>
          第 {page} / {totalPages} 页 · 共 {total} 个仓库
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={page <= 1 ? "opacity-60" : ""}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className={page >= totalPages ? "opacity-60" : ""}
          >
            下一页
          </Button>
        </div>
      </div>
    </Entrance>
  );
}