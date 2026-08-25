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
import { CountUp, Tilt, SplitTitle } from "@/app/components/motion";
import { usePlatform, type Platform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

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
}

interface HeatData {
  year: number;
  weeks: (number | null)[][];
  months: { label: string; col: number }[];
  total: number;
  max: number;
}

interface Repo {
  n: string;
  owner: string;
  href?: string;
  tag: string;
  cls: string;
  lan: string;
  lanl: string;
  stars: number;
  prs: number;
}

interface Pr {
  c: string;
  t: string;
  m: string;
  l: string;
  lc: string;
}

/** 每个登录身份对应的独立数据集合（多平台登录，但数据不聚合） */
const PLATFORMS: Record<Platform, {
  kpis: { icon: React.ReactNode; value: number; suffix: string; label: string }[];
  repos: Repo[];
  prs: Pr[];
  peak: string;
}> = {
  github: {
    kpis: [
      { icon: <History className="size-5" />, value: 1248, suffix: "", label: "年内提交" },
      { icon: <FolderGit2 className="size-5" />, value: 19, suffix: "", label: "仓库数" },
      { icon: <GitPullRequest className="size-5" />, value: 12, suffix: "", label: "待审 PR" },
      { icon: <RadioTower className="size-5" />, value: 96, suffix: "%", label: "问题检出率" },
    ],
    repos: [
      { n: "ai-pr-<b>review</b>", owner: "nicepkg · GitHub", tag: "审查中", cls: "text-amber bg-amber/10", lan: "bg-cyan", lanl: "TypeScript", stars: 128, prs: 3 },
      { n: "nextjs-<b>blog</b>", owner: "nicepkg · GitHub", tag: "已开启", cls: "text-green bg-[var(--green-soft)]", lan: "bg-cyan", lanl: "TypeScript", stars: 56, prs: 0 },
      { n: "rust-<b>parser</b>", owner: "nicepkg · GitHub", tag: "审查中", cls: "text-amber bg-amber/10", lan: "bg-[#ff8870]", lanl: "Rust", stars: 89, prs: 1 },
    ],
    prs: [
      { c: "var(--red)", t: "fix(handler): guard against missing upload file", m: "ai-pr-review #128 · +84 −21", l: "2 风险", lc: "text-red bg-[var(--red-soft)]" },
      { c: "var(--amber)", t: "feat: cache context snapshots to fuzzy hits", m: "ai-pr-review #127 · +320 −12", l: "3 建议", lc: "text-amber bg-amber/10" },
      { c: "var(--cyan)", t: "refactor: migrate dashboard to new design", m: "ai-pr-review #126 · +115 −89", l: "排队中", lc: "text-face-2 bg-ink-800" },
    ],
    peak: "8 月 · 最佳仓库 ai-pr-review",
  },
  gitee: {
    kpis: [
      { icon: <History className="size-5" />, value: 402, suffix: "", label: "年内提交" },
      { icon: <FolderGit2 className="size-5" />, value: 4, suffix: "", label: "仓库数" },
      { icon: <GitPullRequest className="size-5" />, value: 5, suffix: "", label: "待审 PR" },
      { icon: <RadioTower className="size-5" />, value: 88, suffix: "%", label: "问题检出率" },
    ],
    repos: [
      { n: "go-<b>gateway</b>", owner: "nicepkg · Gitee", tag: "审查中", cls: "text-amber bg-amber/10", lan: "bg-[#46d1e8]", lanl: "Go", stars: 67, prs: 1 },
      { n: "ml-<b>toolkit</b>", owner: "nicepkg · Gitee", tag: "未开启", cls: "text-face-2 bg-ink-800", lan: "bg-violet", lanl: "Python", stars: 42, prs: 0 },
      { n: "data-<b>pipeline</b>", owner: "nicepkg · Gitee", tag: "已开启", cls: "text-green bg-[var(--green-soft)]", lan: "bg-violet", lanl: "Python", stars: 38, prs: 2 },
    ],
    prs: [
      { c: "var(--red)", t: "feat: add gitee webhook receiver", m: "go-gateway #24 · +72 −6", l: "2 风险", lc: "text-red bg-[var(--red-soft)]" },
      { c: "var(--amber)", t: "fix: rate-limit model router retries", m: "go-gateway #23 · +31 −18", l: "3 建议", lc: "text-amber bg-amber/10" },
      { c: "var(--cyan)", t: "docs: update README for v2", m: "ml-toolkit #22 · +58 −12", l: "排队中", lc: "text-face-2 bg-ink-800" },
    ],
    peak: "7 月 · 最佳仓库 go-gateway",
  },
};

export default function DashboardPage() {
  const langBarRef = useRef<HTMLDivElement>(null);
  const { provider, meta } = usePlatform();
  const d = PLATFORMS[provider];

  // 接库：按当前登录身份拉 `/api/{p}/dashboard`，失败/未登录回退 mock
  const [live, setLive] = useState<LiveDashboard | null>(null);
  const [heat, setHeat] = useState<HeatData | null>(null);
  const [commitTotal, setCommitTotal] = useState<number | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  // 仅允许「近12个月」和「当前年」：GitHub 官方贡献接口只暴露最近 1 年，过往年份拿不到准确数据
  const years = [new Date().getFullYear()];
  useEffect(() => {
    if (provider !== "github" && provider !== "gitee") return;
    let cancelled = false;
    authFetch(`/api/${provider}/dashboard`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LiveDashboard;
      })
      .then((data) => {
        if (!cancelled && typeof data.repoCount === "number") setLive(data);
      })
      .catch(() => {
        /* 忽略，回退 mock */
      });
    // 提交贡献热力图（独立接口，支持年份，慢则不影响卡片渲染）
    const q = year ? `?year=${year}` : "";
    authFetch(`/api/${provider}/contributions${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HeatData;
      })
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
  }, [provider, year]);

  const kpiView = d.kpis.map((k, i) => {
    if (i === 0 && commitTotal !== null) return { ...k, value: commitTotal };
    if (i === 1 && live) return { ...k, value: live.repoCount };
    if (i === 2 && live) return { ...k, value: live.openPullCount };
    return k;
  });
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
        prs: 0,
      }))
    : d.repos;
  const prView = live
    ? live.openPulls.slice(0, 5).map((p) => ({
        c: "var(--amber)",
        t: p.title,
        m: `${p.repo} #${p.number} · ${p.user}`,
        l: "待审",
        lc: "text-face-2 bg-ink-800",
      }))
    : d.prs;

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
    : [
        { w: 46, c: "var(--cyan)", name: "TypeScript", v: "46%" },
        { w: 22, c: "var(--amber)", name: "JavaScript", v: "22%" },
        { w: 16, c: "var(--violet)", name: "Python", v: "16%" },
        { w: 10, c: "var(--green)", name: "Go", v: "10%" },
        { w: 6, c: "var(--red)", name: "其他", v: "6%" },
      ];

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
          <Button variant="ghost" size="sm">同步数据</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/repos">管理仓库</Link>
          </Button>
        </div>
      </div>

      {/* ===== 用户卡片（当前登录身份） ===== */}
      <div className="mb-5 flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <span className="size-13 shrink-0 overflow-hidden rounded-full border-2 border-line-strong">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={meta.avatar} alt={meta.user} className="size-full object-cover" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-semibold">{meta.user}</h2>
          <div className="font-mono text-[13px] text-amber">{meta.handle} · 已授权 {meta.name}</div>
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
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-display text-[15px] font-semibold">提交活跃度</span>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-face-3">
              少 <span className="size-2.5 rounded-[3px] bg-ink-800" />
              <span className="size-2.5 rounded-[3px] bg-amber/50" />
              <span className="size-2.5 rounded-[3px] bg-amber" /> 多
            </span>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <select
              value={year ?? ""}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
              aria-label="选择贡献年份"
              className="h-7 cursor-pointer rounded-full border border-line bg-ink-850 px-2 text-[12px] text-face-2 outline-none focus:border-amber"
            >
              <option value="">近 12 个月</option>
              {years.map((y) => (
                <option key={y} value={y} className="bg-card">
                  {y}
                </option>
              ))}
            </select>
            {heat && <span className="text-[12px] text-face-3">{heat.total} commit</span>}
          </div>
          <div className="overflow-x-auto pb-1">
            <HeatmapGrid data={heat} />
          </div>
          <div className="mt-3 text-[12.5px] text-face-3">◆ 活跃峰值 {d.peak}</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
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
  const weeks = real ? data!.weeks : (() => {
    // 无数据时回退随机图案（52 周 × 7）
    const pattern = [0, 0, 0, 1, 1, 2, 3, 4, 0, 2];
    return Array.from({ length: 52 }, (_, w) =>
      Array.from({ length: 7 }, (_, r) => pattern[(w * 7 + r) % pattern.length]),
    );
  })();

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