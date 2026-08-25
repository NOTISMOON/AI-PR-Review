"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * 多平台登录、单登录身份、数据隔离。
 * 每个登录身份（provider）只看到自己的数据，不做跨平台聚合。
 */
export type Platform = "github" | "gitee";

export function isPlatform(v: string | null | undefined): v is Platform {
  return v === "github" || v === "gitee";
}

function readInitialPlatform(): Platform {
  try {
    const m = window.location.search.match(/[?&]provider=(github|gitee)/);
    if (m && isPlatform(m[1])) {
      localStorage.setItem("rf_platform", m[1]);
      return m[1];
    }
    const v = localStorage.getItem("rf_platform");
    if (isPlatform(v)) return v;
  } catch {
    /* localStorage 不可用时回退默认 */
  }
  return "github";
}

/** 每个登录身份对应的展示元信息（冗余展示字段，非聚合依据） */
export const PLATFORM_META: Record<Platform, {
  name: string;
  user: string;
  handle: string;
  avatar: string;
  authLabel: string;
  subtitle: string;
}> = {
  github: {
    name: "GitHub",
    user: "octocat",
    handle: "@octocat",
    avatar: "https://avatars.githubusercontent.com/u/583231?v=4",
    authLabel: "GitHub · 管理员",
    subtitle: "当前 GitHub 视角 · 提交、仓库与待审 PR 数据独立",
  },
  gitee: {
    name: "Gitee",
    user: "nicepkg",
    handle: "@nicepkg",
    avatar: "https://www.gitee.com/assets/new_portal/logo/first/index_white.svg",
    authLabel: "Gitee · 管理员",
    subtitle: "当前 Gitee 视角 · 提交、仓库与待审 PR 数据独立",
  },
};

interface PlatformCtxValue {
  provider: Platform;
  setProvider: (p: Platform) => void;
  meta: (typeof PLATFORM_META)[Platform];
}

const PlatformCtx = createContext<PlatformCtxValue>({
  provider: "github",
  setProvider: () => {},
  meta: PLATFORM_META.github,
});

export function PlatformProvider({ children }: { children: ReactNode }) {
  // SSR/客户端首次一致：先给默认值，挂载后再按 URL/localStorage 校正，避免 hydration 错乱
  const [provider, setProviderState] = useState<Platform>("github");

  useEffect(() => {
    setProviderState(readInitialPlatform());
  }, []);

  const setProvider = useCallback((p: Platform) => {
    setProviderState(p);
    try {
      localStorage.setItem("rf_platform", p);
    } catch {
      /* 忽略 */
    }
  }, []);

  return (
    <PlatformCtx.Provider value={{ provider, setProvider, meta: PLATFORM_META[provider] }}>
      {children}
    </PlatformCtx.Provider>
  );
}

export function usePlatform() {
  return useContext(PlatformCtx);
}