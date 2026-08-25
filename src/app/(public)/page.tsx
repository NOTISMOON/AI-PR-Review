"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Flame } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Button } from "@/app/components/ui/button";
import { Entrance, SplitTitle } from "@/app/components/motion";

gsap.registerPlugin(useGSAP);

const LANG_BAR = [
  { w: 52, c: "var(--cyan)" },
  { w: 24, c: "var(--amber)" },
  { w: 14, c: "#46d1e8" },
  { w: 10, c: "var(--violet)" },
];

const LANG_LIST = [
  { d: "bg-cyan", n: "TypeScript", v: "52%" },
  { d: "bg-amber", n: "JavaScript", v: "24%" },
  { d: "bg-cyan", n: "Go", v: "14%" },
  { d: "bg-violet", n: "Python", v: "10%" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ===== Topbar ===== */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-15 items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5 font-display text-base font-semibold">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[radial-gradient(circle_at_30%_30%,var(--amber),#b97a1f)] font-mono text-[12px] font-bold text-[var(--text-on-amber)]">
              RF
            </span>
            Review<b className="text-amber">Forge</b>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
            <a href="#how" className="rounded-md px-3 py-2 text-[13.5px] font-medium text-face-2 hover:text-foreground">如何工作</a>
            <a href="#insights" className="rounded-md px-3 py-2 text-[13.5px] font-medium text-face-2 hover:text-foreground">用户洞察</a>
            <a href="#code" className="rounded-md px-3 py-2 text-[13.5px] font-medium text-face-2 hover:text-foreground">代码浏览</a>
            <a href="#review" className="rounded-md px-3 py-2 text-[13.5px] font-medium text-face-2 hover:text-foreground">自动审查</a>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">演示面板</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">登录</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden px-6 pt-28 pb-20 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(48%_44%_at_50%_0%,rgba(232,163,61,0.14),transparent_62%),radial-gradient(34%_40%_at_82%_22%,rgba(167,155,255,0.1),transparent_60%)]" />
        <Entrance className="relative mx-auto max-w-3xl">
          <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-4 py-1.5 text-[13px] font-semibold text-amber">
            <span className="size-1.5 rounded-full bg-amber animate-pulse" />
            v2.0 · 全新平台架构
          </div>
          <SplitTitle className="font-display text-[clamp(44px,7vw,72px)] font-semibold leading-[1.02] tracking-[-0.03em]">
            让每次代码变更
            <br />
            都被 <span className="text-amber">认真审阅</span>
          </SplitTitle>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-face-2">
            用你的 GitHub 或 Gitee 账号登录，查看提交活跃度、在线浏览代码，
            并在 PR 出现的那一刻获得 AI 的结构化审查评论。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/login">立即开始 · 免费</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how">查看工作方式</a>
            </Button>
          </div>
        </Entrance>

        {/* demo code window */}
        <div className="relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-2xl border border-border text-left shadow-[var(--shadow-m)]">
          <div className="flex items-center gap-2.5 border-b border-border bg-card px-4 py-2.5 font-mono text-[12px] text-face-2">
            <span className="flex gap-1.5"><i className="size-2.5 rounded-full bg-[#ef6e6e]" /><i className="size-2.5 rounded-full bg-amber" /><i className="size-2.5 rounded-full bg-green" /></span>
            <span className="ml-1">PR <b className="text-face-1">#128</b> · src/handlers/upload.ts</span>
            <span className="ml-auto rounded-full bg-amber/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber">AI Review 进行中</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
            <div className="overflow-x-auto border-t border-border bg-[var(--ink-950)] font-mono text-[12.5px] leading-7">
              <div className="flex bg-[var(--red-soft)]"><span className="w-10 shrink-0 pr-2.5 text-right text-face-3 select-none">31</span><span className="w-4 shrink-0 text-center text-red select-none">-</span><span className="pr-4 whitespace-pre"><span className="text-[var(--red)]">const</span> <span className="text-[var(--cyan)]">size</span> = <span className="text-[var(--cyan)]">req</span>.<span className="text-[var(--cyan)]">file</span>.<span className="text-[var(--violet)]">size</span>;</span></div>
              <div className="flex bg-[var(--green-soft)]"><span className="w-10 shrink-0 pr-2.5 text-right text-face-3 select-none">32</span><span className="w-4 shrink-0 text-center text-green select-none">+</span><span className="pr-4 whitespace-pre"><span className="text-[var(--red)]">const</span> <span className="text-[var(--cyan)]">size</span> = <span className="text-[var(--cyan)]">req</span>.<span className="text-[var(--cyan)]">file</span>?.<span className="text-[var(--cyan)]">size</span> ?? <span className="text-[var(--cyan)]">0</span>;</span><span className="size-3 shrink-0 self-center rounded-full bg-amber shadow-[0_0_0_3px_var(--amber-soft)]" /></div>
              <div className="flex bg-[var(--green-soft)]"><span className="w-10 shrink-0 pr-2.5 text-right text-face-3 select-none">33</span><span className="w-4 shrink-0 text-center text-green select-none">+</span><span className="pr-4 whitespace-pre"><span className="text-[var(--red)]">if</span> (<span className="text-[var(--cyan)]">size</span> &gt; <span className="text-[var(--cyan)]">10</span> * <span className="text-[var(--cyan)]">1024</span> * <span className="text-[var(--cyan)]">1024</span>) <span className="text-[var(--red)]">throw</span> <span className="text-[var(--red)]">new</span> <span className="text-[var(--violet)]">Error</span>(<span className="text-[var(--green)]">&apos;limit&apos;</span>);</span><span className="size-3 shrink-0 self-center rounded-full bg-amber shadow-[0_0_0_3px_var(--amber-soft)]" /></div>
              <div className="flex"><span className="w-10 shrink-0 pr-2.5 text-right text-face-3 select-none">34</span><span className="w-4 shrink-0 text-center select-none"></span><span className="pr-4 whitespace-pre"><span className="italic text-face-3">  // ...</span></span></div>
            </div>
            <div className="hidden border-l border-border bg-card p-4 md:block">
              <div className="rounded-xl border-l-[3px] border-[var(--red)] bg-card p-3.5 text-left">
                <div className="mb-1.5 flex items-center gap-2"><span className="text-[11px] font-bold tracking-wide text-red uppercase">Risk</span><span className="ml-auto font-mono text-[11px] text-face-3">L32</span></div>
                <p className="text-[12.5px] leading-relaxed text-face-2"><code className="rounded bg-amber/10 px-1 font-mono text-[11px] text-amber">req.file</code> 可能为 undefined，已用可选链兜底；但当文件缺失时应返回 400 而非静默为 0。</p>
              </div>
              <div className="mt-3 rounded-xl border-l-[3px] border-[var(--amber)] bg-card p-3.5 text-left">
                <div className="mb-1.5 flex items-center gap-2"><span className="text-[11px] font-bold tracking-wide text-amber uppercase">Suggestion</span><span className="ml-auto font-mono text-[11px] text-face-3">L33</span></div>
                <p className="text-[12.5px] leading-relaxed text-face-2">超限阈值建议抽为常量 <code className="rounded bg-amber/10 px-1 font-mono text-[11px] text-amber">MAX_UPLOAD_BYTES</code>，便于测试与复用。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Logos ===== */}
      <section className="border-b border-border px-6 py-11">
        <p className="mb-6 text-center text-[12px] tracking-[0.12em] text-face-3 uppercase">接入你的代码，审查你的 PR</p>
        <div className="flex flex-wrap items-center justify-center gap-10 font-display text-[17px] font-semibold text-face-3/80">
          <span>GitHub</span><span>Gitee</span><span>OpenAI</span><span>Anthropic</span><span>DeepSeek</span><span>自托管模型</span>
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section className="px-6 py-24" id="how">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <div className="mb-3 text-[12px] font-bold tracking-[0.12em] text-amber uppercase">How it works</div>
            <h2 className="mx-auto max-w-2xl font-display text-[clamp(28px,4vw,42px)] font-semibold tracking-[-0.02em]">从授权登录到自动审查，三步完成</h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] text-face-2">没有复杂的 Token 配置，没有多余的脚本——连接即用。</p>
          </div>
          <Entrance className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { n: "01", t: "授权登录", d: "用 GitHub 或 Gitee 账号一键 OAuth 登录，安全获取仓库访问权限。" },
              { n: "02", t: "浏览与洞察", d: "查看提交活跃度热力图、仓库列表，在线浏览分支与代码文件。" },
              { n: "03", t: "PR 自动审查", d: "PR 变化自动触发 AI，生成带风险等级的评论，可采纳、忽略或回写。" },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-border bg-card p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="mb-5 grid size-10 place-items-center rounded-lg bg-amber/10 font-mono text-[16px] font-semibold text-amber">{s.n}</div>
                <h3 className="font-display text-[17px] font-semibold">{s.t}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-face-2">{s.d}</p>
              </div>
            ))}
          </Entrance>
        </div>
      </section>

      {/* ===== Insights ===== */}
      <section className="border-t border-border px-6 py-24" id="insights">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <div>
            <div className="mb-3 text-[12px] font-bold tracking-[0.12em] text-amber uppercase">User Insights</div>
            <h2 className="font-display text-[clamp(28px,4vw,42px)] font-semibold tracking-[-0.02em]">你的提交贡献，一眼看清</h2>
            <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-face-2">登录后进入个人控制台：全年提交热力图、语言占比、最近活跃仓库与待审 PR 队列，所有数据来自你授权的平台。</p>
            <Button asChild className="mt-7"><Link href="/login">查看演示控制台</Link></Button>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-[15px] font-semibold">Commit Activity</span>
              <div className="flex items-center gap-1.5 text-[11.5px] text-face-3">少 <span className="size-2.5 rounded-[3px] bg-ink-800" /><span className="size-2.5 rounded-[3px] bg-amber/50" /><span className="size-2.5 rounded-[3px] bg-amber" /> 多</div>
            </div>
            <div className="h-28 overflow-hidden rounded-md">
              <HeatmapGrid />
            </div>
            <div className="mt-6"><span className="font-display text-[15px] font-semibold">语言占比</span>
              <LangBar />
              <div className="mt-3 grid grid-cols-2 gap-x-4">
                {LANG_LIST.map((l) => (
                  <div key={l.n} className="flex items-center gap-2.5 py-1.5"><span className={`size-2 rounded-full ${l.d}`} /><span className="text-[13.5px] text-face-1">{l.n}</span><span className="ml-auto text-[13px] text-face-3">{l.v}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Auto review pipeline ===== */}
      <section className="border-t border-border px-6 py-24" id="review">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-3 text-[12px] font-bold tracking-[0.12em] text-amber uppercase">Auto Review</div>
          <h2 className="font-display text-[clamp(28px,4vw,42px)] font-semibold tracking-[-0.02em]">PR 一变，审核跟上</h2>
          <p className="mx-auto mt-4 max-w-lg text-[15.5px] text-face-2">Webhook 即时触发，AI 提取变更、构建上下文、生成结构化审查，自动回写评论与检验状态。</p>
        </div>
        <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-border bg-card p-8">
          {[
            ["Pull Request 事件", "opened/synchronize · Webhook 验签通过", true],
            ["提取变更 Diff", "12 files · +84 / −21 · 上下文快照命中缓存", true],
            ["模型审查", "deepseek-chat · review-mode · 结构化输出", true],
            ["回写评论", "6 条评论已生成 · 1 条已写入 PR 评论", true],
          ].map(([t, s, done], i) => (
            <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
              <span className="mt-1 grid size-3 shrink-0 place-items-center rounded-full bg-amber"><i className="size-1.5 rounded-full bg-background" /></span>
              <div><div className="text-[13.5px] font-semibold text-green">{t}</div><div className="text-[12px] text-face-3">{s}</div></div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="px-6 pt-20 pb-24">
        <div className="mx-auto max-w-2xl rounded-3xl border border-line-strong bg-card p-12 text-center shadow-[var(--shadow-m)]">
          <span className="mx-auto mb-6 grid size-12 place-items-center rounded-xl bg-[radial-gradient(circle_at_30%_30%,var(--amber),#b97a1f)] font-mono text-[16px] font-bold text-[var(--text-on-amber)]"><Flame className="size-5" /></span>
          <h2 className="font-display text-[32px] font-semibold tracking-[-0.02em]">开始锻造更高质量的代码</h2>
          <p className="mx-auto mt-4 max-w-md text-[15.5px] text-face-2">连接你的 GitHub 或 Gitee 账号，AI 会从第一条 PR 开始为你把关。</p>
          <div className="mt-7 flex flex-wrap justify-center gap-4">
            <Button asChild size="lg"><Link href="/login">使用 GitHub 登录 <ArrowRight className="size-4" /></Link></Button>
            <Button asChild variant="outline" size="lg"><Link href="/login">使用 Gitee 登录</Link></Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-[13px] text-face-3">
          <span>© 2026 ReviewForge · 为认真写代码的开发者打造</span>
          <span className="flex gap-4"><a href="#" className="hover:text-face-2">文档</a><a href="#" className="hover:text-face-2">隐私</a><a href="#" className="hover:text-face-2">服务条款</a></span>
        </div>
      </footer>
    </div>
  );
}

function HeatmapGrid() {
  const root = useRef<HTMLDivElement>(null);
  const lvl = ["bg-ink-800", "bg-amber/30", "bg-amber/50", "bg-amber/80", "bg-amber"];

  useGSAP(
    () => {
      if (!root.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const cells = root.current.children;
      if (!cells.length) return;
      gsap.fromTo(
        cells,
        { scale: 0, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.35,
          stagger: { each: 0.005, from: "center" },
          ease: "back.out(2)",
          clearProps: "all",
        }
      );
    },
    { scope: root }
  );

  const cells = Array.from({ length: 52 * 7 });
  return (
    <div ref={root} className="grid h-full grid-rows-7 auto-cols-[13px] grid-flow-col gap-[3px]">
      {cells.map((_, i) => {
        // 确定性分布：避免 Math.random 导致 SSR/客户端不一致触发 hydration 错乱
        const l = (i * 13 + Math.floor(i / 7) * 5) % 5;
        return <span key={i} className={`size-[13px] rounded-[3px] ${lvl[l]}`} />;
      })}
    </div>
  );
}

/** 语言占比长条：从左侧 scaleX 依次增长 */
function LangBar() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!root.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(root.current.children, {
        scaleX: 0,
        transformOrigin: "left",
        duration: 1.1,
        stagger: 0.12,
        ease: "power3.out",
        clearProps: "all",
      });
    },
    { scope: root }
  );

  return (
    <div ref={root} className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded">
      {LANG_BAR.map((b, i) => (
        <i key={i} className="rounded-[2px]" style={{ width: `${b.w}%`, background: b.c }} />
      ))}
    </div>
  );
}