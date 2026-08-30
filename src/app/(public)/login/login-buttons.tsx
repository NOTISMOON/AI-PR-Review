"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";

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

type Provider = "github" | "gitee";

/**
 * 登录按钮组：点击后立即进入 loading（禁用两枚按钮防重复触发 OAuth），
 * 随即跳转对应平台的授权入口。
 */
export function LoginButtons() {
  const [pending, setPending] = useState<Provider | null>(null);

  function start(provider: Provider) {
    if (pending) return; // 正在跳转，忽略二次点击
    setPending(provider);
    // 让 loading 态先渲染一帧，再执行授权跳转
    window.setTimeout(() => {
      window.location.href = `/api/auth/${provider}`;
    }, 120);
  }

  const btnBase =
    "h-12 w-full justify-start gap-3 rounded-lg border-line-strong bg-card px-4 text-[15px] font-semibold";

  return (
    <div className="space-y-3.5">
      <Button
        type="button"
        variant="outline"
        onClick={() => start("github")}
        disabled={pending !== null}
        className={btnBase}
      >
        {pending === "github" ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <GithubMark />
        )}
        使用 <b>GitHub</b> 账号登录
        {pending === "github" && <span className="ml-auto text-[12px] text-face-3">正在跳转授权…</span>}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => start("gitee")}
        disabled={pending !== null}
        className={btnBase}
      >
        {pending === "gitee" ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <GiteeMark />
        )}
        使用 <b>Gitee</b> 账号登录
        {pending === "gitee" && <span className="ml-auto text-[12px] text-face-3">正在跳转授权…</span>}
      </Button>
    </div>
  );
}