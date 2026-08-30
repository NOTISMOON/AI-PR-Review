"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  FolderGit2,
  GitPullRequest,
  History,
  RadioTower,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { AnimatedSelect } from "@/app/components/animated-select";
import { CountUp, Tilt, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";
import { cachedFetch, invalidateCache } from "@/lib/client/data-cache";

gsap.registerPlugin(useGSAP);

interface LiveDashboard {
  login: string;
  repoCount: number;
  openPullCount: number;
  totalStars: number;
  recentRepos: { full_name: string; name: string; description: string | null; language: string | null; stargazers_count: number; html_url: string }[];
  topRepos: { full_name: string; name: string; description: string | null; language: string | null; stargazers_count: number; html_url: string }[];
  languageDistribution: { language: string; repoCount: number }[];
  openPulls: { repo: string; number: number; title: string; user: string }[];
  reviewStats?: {
    totalReviews: number;
    riskyReviews: number;
    totalRisks: number;
    pendingReviews: number;
    passRate: number;
  };
  pendingReviews?: {
    id: number;
    prNumber: number;
    repoFullName: string;
    prTitle: string | null;
    riskLevel: string | null;
    riskCount: number;
    decision: string;
    completedAt: string | null;
  }[];
}

interface HeatData {
  year: number;
  weeks: (number | null)[][];
  months: { label: string; col: number }[];
  total: number;
  max: number;
}

/** KPI 卡片结构（不含具体数值，数值由下方实时数据填充） */
const KPI_CARDS = [
  { icon: <History className="size-5" />, suffix: "", label: "年内提交" },
  { icon: <FolderGit2 className="size-5" />, suffix: "", label: "仓库数" },
  { icon: <GitPullRequest className="size-5" />, suffix: "", label: "待审 PR" },
  { icon: <RadioTower className="size-5" />, suffix: "%", label: "问题检出率" },
];

export default function DashboardPage() {
  const langBarRef = useRef<HTMLDivElement>(null);
  const { provider, meta, ready } = usePlatform();

  // 接库：按当前登录身份拉 `/api/{p}/dashboard`，失败/未登录回退 mock
  const [live, setLive] = useState<LiveDashboard | null>(null);
  const [heat, setHeat] = useState<HeatData | null>(null);
  const [commitTotal, setCommitTotal] = useState<number | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [me, setMe] = useState<{ login: string; name?: string; avatar?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // 真实登录身份（覆盖 PLATFORM_META 占位）
  useEffect(() => {
    authFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.login) setMe(u);
      })
      .catch(() => {});
  }, []);

  /** 同步数据：清缓存后重新拉取控制台与贡献数据 */
  async function syncData() {
    setSyncing(true);
    try {
      // 先局部失效：把当前 provider 的 dashboard / contributions 缓存清掉，避免重拉吃到旧缓存
      invalidateCache(`/api/${provider}/dashboard`);
      invalidateCache(`/api/${provider}/contributions`);
      // 保留原有 POST 行为（POST 清后端缓存并返回最新 dashboard 数据）
      const [dr, cr] = await Promise.all([
        authFetch(`/api/${provider}/dashboard`, { method: "POST" }),
        cachedFetch<HeatData>(`/api/${provider}/contributions`, 60),
      ]);
      if (dr.ok) {
        const data = await dr.json();
        if (typeof data.repoCount === "number") setLive(data);
      }
      // contributions 走 cachedFetch：cr 直接是数据（非 Response）
      const hd = cr;
      if (hd && Array.isArray(hd.weeks)) {
        setHeat(hd);
        if (typeof hd.total === "number") setCommitTotal(hd.total);
      }
    } finally {
      setSyncing(false);
    }
  }
  // 仅允许「近12个月」和「当前年」：GitHub 官方贡献接口只暴露最近 1 年，过往年份拿不到准确数据
  const years = [new Date().getFullYear()];
  useEffect(() => {
    if (provider !== "github" && provider !== "gitee") return;
    if (!ready) return; // 身份未校正前不发平台请求，避免首帧误打 /api/github/* 产生 401 { error: "provider" }
    let cancelled = false;
    cachedFetch<LiveDashboard>(`/api/${provider}/dashboard`, 30)
      .then((data) => {
        if (!cancelled && typeof data.repoCount === "number") setLive(data);
      })
      .catch(() => {
        /* 忽略，回退 mock */
      });
    // 提交贡献热力图（独立接口，支持年份，慢则不影响卡片渲染）
    const q = year ? `?year=${year}` : "";
    cachedFetch<HeatData>(`/api/${provider}/contributions${q}`, 60)
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.weeks) && data.weeks.length > 0) setHeat(data);
        if (typeof data.total === "number") setCommitTotal(data.total);
      })
      .catch(() => {
        /* 忽略，热力图回退随机 */
      });
    return () => {
      cancelled = true;
    };
  }, [provider, year, ready]);

  // KPI 数值：全部来自实时数据，未加载/缺失一律为 0，绝不回落 mock 假值
  const kpiValues = [
    commitTotal ?? 0,
    live?.repoCount ?? 0,
    live?.openPullCount ?? 0,
    live?.reviewStats && live.reviewStats.totalReviews > 0
      ? Math.round((live.reviewStats.riskyReviews / live.reviewStats.totalReviews) * 100)
      : 0,
  ];
  const kpiView = KPI_CARDS.map((k, i) => ({ ...k, value: kpiValues[i] }));
  const repoView = live
    ? live.recentRepos.map((r) => ({
        n: r.name,
        owner: live.login,
        href: `/repo?owner=${encodeURIComponent(live.login)}&repo=${encodeURIComponent(r.name)}`,
        tag: "实时",
        cls: "text-amber bg-amber/10",
        lan: "bg-cyan",
        lanl: r.language || "—",
        stars: r.stargazers_count,
        prs: live.openPulls.filter((p) => p.repo === r.full_name).length,
      }))
    : [];
  // 待审 PR：优先展示「待处理」的自动审查结果（链接到审查处理中心），否则为平台 open PR
  const pendingView = live?.pendingReviews?.length
    ? live.pendingReviews.map((p) => ({
        c: p.riskCount > 0 ? "var(--red)" : "var(--amber)",
        t: p.prTitle || `PR #${p.prNumber}`,
        m: `${p.repoFullName} #${p.prNumber} · ${p.riskLevel || "已审查"} · ${p.riskCount} 处问题`,
        l: "待处理",
        lc: "text-face-2 bg-ink-800",
      }))
    : null;
  const prView = pendingView ?? (live
    ? live.openPulls.slice(0, 5).map((p) => ({
        c: "var(--amber)",
        t: p.title,
        m: `${p.repo} #${p.number} · ${p.user}`,
        l: "待审",
        lc: "text-face-2 bg-ink-800",
      }))
    : []);
  // 语言占比（实时统计）
  const LANG_COLORS = ["var(--cyan)", "var(--amber)", "var(--violet)", "var(--green)", "var(--red)", "var(--text-3)"];
  const langTotal = live ? live.languageDistribution.reduce((s, x) => s + x.repoCount, 0) : 0;
  const langSegs = live && live.languageDistribution.length
    ? live.languageDistribution.map((l, i) => ({
        w: langTotal ? Math.round((l.repoCount / langTotal) * 100) : 0,
        c: LANG_COLORS[i % LANG_COLORS.length],
        name: l.language,
        v: `${l.repoCount} 个`,
      }))
    : [];

  // 语言占比长条 scaleX 增长（原型 #langbar 细节动画）
  useGSAP(
    () => {
      if (!langBarRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(langBarRef.current.children, {
        scaleX: 0,
        transformOrigin: "left",
        duration: 1.1,
        stagger: 0.12,
        ease: "power3.out",
        delay: 0.3,
        clearProps: "all",
      });
    },
    { scope: langBarRef }
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* ===== 页头 ===== */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <SplitTitle className="font-display text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.02em]">
            开发者 <span className="text-amber">全景</span> 洞察
          </SplitTitle>
          <p className="mt-1.5 text-[13px] text-face-3">
            {meta.subtitle}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={syncData} disabled={syncing}>
            {syncing ? "同步中…" : "同步数据"}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/repos">管理仓库</Link>
          </Button>
        </div>
      </div>

      {/* ===== 用户卡片（当前登录身份，真实用户覆盖占位） ===== */}
      <div className="mb-5 flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <span className="size-13 shrink-0 overflow-hidden rounded-full border-2 border-line-strong">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={me?.avatar || meta.avatar} alt={me?.login || meta.user} className="size-full object-cover" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-semibold">{me?.login || meta.user}</h2>
          <div className="font-mono text-[13px] text-amber">
            {me?.login || meta.handle} · 已授权 {meta.name}
          </div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--green-soft)] px-3 py-1 text-[12px] font-semibold text-green">
          <span className="size-1.5 rounded-full bg-green" /> 在线
        </span>
      </div>

      {/* ===== KPI（数字滚动） ===== */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiView.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-5">
            <span className="mb-3.5 grid size-10 place-items-center rounded-lg bg-amber/10 text-amber">{k.icon}</span>
            <div className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em]">
              <CountUp to={k.value} suffix={k.suffix} />
            </div>
            <div className="mt-2 text-[13px] text-face-2">{k.label}</div>
          </div>
        ))}
      </div>

      {/* ===== 热力图 + 语言（3:1 并排） ===== */}
      <div className="mb-5 grid gap-4 md:grid-cols-[3fr_1fr]">
        <div className="min-w-0 rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-display text-[15px] font-semibold">提交活跃度</span>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-face-3">
              少 <span className="size-2.5 rounded-[3px] bg-ink-800" />
              <span className="size-2.5 rounded-[3px] bg-amber/50" />
              <span className="size-2.5 rounded-[3px] bg-amber" /> 多
            </span>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <AnimatedSelect
              value={year ? String(year) : ""}
              onChange={(v) => setYear(v ? Number(v) : undefined)}
              ariaLabel="选择贡献年份"
              triggerClassName="h-7 rounded-full px-3 text-[12px]"
              options={[
                { value: "", label: "近 12 个月" },
                ...years.map((y) => ({ value: String(y), label: `${y}` })),
              ]}
            />
            {heat && <span className="text-[12px] text-face-3">{heat.total} commit</span>}
          </div>
          <div className="overflow-x-auto pb-1">
            <HeatmapGrid data={heat} />
          </div>
          <div className="mt-3 text-[12.5px] text-face-3">◆ {live?.topRepos?.[0] ? `最佳仓库 ${live.topRepos[0].name}` : "最佳仓库 暂无数据"}</div>
        </div>

        <div className="min-w-0 rounded-2xl border border-border bg-card p-5">
          <span className="font-display text-[14px] font-semibold">语言占比</span>
          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded" ref={langBarRef}>
            {langSegs.map((b, i) => (
              <i key={i} className="h-full rounded-[2px]" style={{ width: `${b.w}%`, background: b.c }} />
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {langSegs.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-[12.5px]">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.c }} />
                <span className="text-face-1">{s.name}</span>
                <span className="ml-auto text-face-3">{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 最近仓库（3D 倾斜） ===== */}
      <section className="mb-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[16px] font-semibold">最近的仓库</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/repos">全部仓库</Link>
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {repoView.map((r) => (
            <Tilt key={r.n} className="rounded-2xl border border-border bg-card p-5 transition-[box-shadow,border-color] duration-200 hover:border-line-strong hover:shadow-[var(--shadow-m)]">
              <Link href={r.href ?? "/repo"} className="block">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-[15px] font-semibold" dangerouslySetInnerHTML={{ __html: r.n }} />
                    <div className="font-mono text-[12.5px] text-face-3">{r.owner}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${r.cls}`}>{r.tag}</span>
                </div>
                <div className="mt-3 flex items-center gap-3.5 text-[12.5px] text-face-3">
                  <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${r.lan}`} />{r.lanl}</span>
                  <span>★ {r.stars}</span>
                  <span>{r.prs} 待审 PR</span>
                </div>
              </Link>
            </Tilt>
          ))}
        </div>
      </section>

      {/* ===== 待审 PR ===== */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[16px] font-semibold">待审查 PR</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/review">进入审查</Link>
          </Button>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          {prView.map((p) => (
            <Link key={p.m} href="/review" className="flex items-center gap-3 border-b border-dashed border-line py-3.5 last:border-0">
              <span className="h-6 w-1.5 shrink-0 rounded" style={{ background: p.c }} />
              <div>
                <div className="text-[13.5px] font-semibold">{p.t}</div>
                <div className="font-mono text-[12px] text-face-3">{p.m}</div>
              </div>
              <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${p.lc}`}>{p.l}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 提交活跃度（GitHub 风格）：每周一列、7 行，月份/星期标签 */
function HeatmapGrid({ data }: { data?: HeatData | null }) {
  const root = useRef<HTMLDivElement>(null);
  const PITCH = 16; // 13 + 3
  const lvl = ["bg-ink-800", "bg-amber/30", "bg-amber/50", "bg-amber/80", "bg-amber"];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const real = !!data && data.weeks.length > 0;
  const weeks = real && data!.weeks ? data!.weeks : [];

  useGSAP(
    () => {
      if (!root.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const els = root.current.querySelectorAll("span");
      if (!els.length) return;
      gsap.fromTo(
        els,
        { scale: 0, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.35,
          stagger: { each: 0.004, from: "center" },
          ease: "back.out(2)",
          delay: 0.12,
          clearProps: "all",
        }
      );
    },
    { scope: root }
  );

  const level = (n: number | null) => {
    if (n === null || n === 0) return 0;
    if (n >= 8) return 4;
    if (n >= 4) return 3;
    if (n >= 2) return 2;
    return 1;
  };

  return (
    <div className="flex w-max gap-1.5">
      {/* 星期标签 */}
      <div className="flex flex-col gap-[3px] text-[9px] leading-[13px] text-face-3 select-none">
        {weekdays.map((d) => (
          <span key={d} className="h-[13px]">
            {d}
          </span>
        ))}
      </div>

      <div className="relative">
        {/* 月份标签 */}
        {real && data.months.length > 0 && (
          <div
            className="absolute -top-5 flex h-4 text-[9px] text-face-3 whitespace-nowrap"
            style={{ width: weeks.length * PITCH }}
          >
            {data.months.map((m, i) => (
              <span key={i} className="absolute" style={{ left: m.col * PITCH }}>
                {m.label}
              </span>
            ))}
          </div>
        )}

        {/* 周列：每周一列，竖向 Sun..Sat */}
        <div ref={root} className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]" style={{ width: 13 }}>
              {week.map((c, ri) => (
                <span key={ri} className={`size-[13px] rounded-[3px] ${lvl[level(c)]}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}