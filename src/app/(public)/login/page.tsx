import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";

const FEATURE = [
  {
    icon: <path d="m9 6 6 6-6 6" />,
    t: "仅需一次授权",
    d: "用平台账号登录，App 代为安全调用你的代码平台 API。",
  },
  {
    icon: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
    t: "服务端安全保存",
    d: "令牌仅存于加密的服务端会话，前端永不接触原始凭证。",
  },
  {
    icon: <path d="M20 7 10 17l-5-5" />,
    t: "随时断开",
    d: "可在设置中解绑任一账号，立即停止数据同步与自动审查。",
  },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const { error, provider } = await searchParams;

  const errorMsgs: Record<string, string> = {
    not_configured: `该平台（${provider || ""}）的授权尚未在后台配置，请联系管理员。`,
    bad_state: "授权校验未通过，请重新登录。",
    oauth_failed: "登录失败，请重试或换一种方式。",
  };
  const errorMsg = error ? errorMsgs[error] || "登录失败，请重试。" : null;

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* ===== Left brand panel ===== */}
      <section className="relative hidden overflow-hidden bg-card p-12 lg:flex lg:items-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_20%_10%,rgba(232,163,61,0.12),transparent_60%),radial-gradient(50%_50%_at_90%_90%,rgba(167,155,255,0.1),transparent_60%)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "linear-gradient(180deg, transparent, #000 40%, #000)",
          }}
        />
        <div className="relative mx-auto w-full max-w-md">
          <span className="mb-9 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-[radial-gradient(circle_at_30%_30%,var(--amber),#b97a1f)] font-mono text-[18px] font-bold text-[var(--text-on-amber)]">
              RF
            </span>
            <span className="font-display text-[21px] font-semibold">
              Review<b className="text-amber">Forge</b>
            </span>
          </span>
          <h1 className="font-display text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
            连接账号，
            <br />
            <span className="text-amber">立刻开始</span>审查
          </h1>
          <div className="mt-8">
            {FEATURE.map((f) => (
              <div key={f.t} className="flex gap-3 border-b border-border py-4 last:border-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber/10 text-amber">
                  <svg viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {f.icon}
                  </svg>
                </span>
                <div>
                  <h4 className="text-[14.5px] font-semibold">{f.t}</h4>
                  <p className="text-[13px] leading-relaxed text-face-2">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Right form ===== */}
      <section className="flex items-center justify-center px-6 py-12 lg:py-0">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3.5 py-2 text-sm text-face-2 transition-colors hover:text-foreground hover:border-line-strong"
          >
            <ArrowLeft className="size-4" /> 返回首页
          </Link>

          <div className="mb-6 flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[radial-gradient(circle_at_30%_30%,var(--amber),#b97a1f)] font-mono text-[15px] font-bold text-[var(--text-on-amber)]">RF</span>
            <span className="font-display text-[16px] font-semibold">Review<b className="text-amber">Forge</b></span>
          </div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em]">登录 ReviewForge</h1>
          <p className="mb-7 mt-2 text-[14px] leading-relaxed text-face-2">
            选择一种方式继续。我们会引导你在 GitHub 或 Gitee 完成授权。多平台登录，数据各自独立。
          </p>

          <div className="space-y-3.5">
            <Button
              asChild
              variant="outline"
              className="h-12 w-full justify-start gap-3 rounded-lg border-line-strong bg-card px-4 text-[15px] font-semibold hover:bg-card hover:border-line-strong"
            >
              <Link href="/api/auth/github">
                <GithubMark /> 使用 <b>GitHub</b> 账号登录
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-12 w-full justify-start gap-3 rounded-lg border-line-strong bg-card px-4 text-[15px] font-semibold hover:bg-card hover:border-line-strong"
            >
              <Link href="/api/auth/gitee">
                <GiteeMark /> 使用 <b>Gitee</b> 账号登录
              </Link>
            </Button>
          </div>

          {errorMsg && (
            <div role="alert" className="mt-5 rounded-md border border-red/40 bg-[var(--red-soft)] px-3.5 py-2.5 text-[13px] text-red">
              {errorMsg}
            </div>
          )}

          <div className="my-6 flex items-center gap-3 text-[12px] text-face-3">
            <span className="h-px flex-1 bg-line" /> 授权范围 <span className="h-px flex-1 bg-line" />
          </div>

          <p className="text-[12.5px] leading-relaxed text-face-3">
            我们将代表你读取：<b className="text-face-2">公开与私有仓库列表</b>、<b className="text-face-2">代码与提交记录</b>、<b className="text-face-2">PR 与 review</b>。App 不会未经同意修改你的代码。
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["读取仓库", "读取代码", "提交 review", "设置提交状态"].map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-face-3">
                <Check className="size-3 text-amber" /> {s}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GiteeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#c71d23" />
      <path fill="#fff" d="M12 5.5c-3.6 0-6.5 2.9-6.5 6.5 0 3.6 2.9 6.5 6.5 6.5 3.6 0 6.5-2.9 6.5-6.5 0-3.6-2.9-6.5-6.5-6.5zm1.9 7.4h-3.8c-.3 0-.5-.3-.5-.7 0-.4.2-.7.5-.7h3.8c.3 0 .5.3.5.7 0 .4-.2.7-.5.7z" />
    </svg>
  );
}