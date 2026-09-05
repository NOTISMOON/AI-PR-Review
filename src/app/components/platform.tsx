"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { authFetch } from "@/lib/client/auth-fetch";

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

/** 登录后由 /api/auth/me 校正出的真实用户身份（侧边栏左下角展示用） */
export interface AuthUserInfo {
  login: string;
  name: string;
  avatar: string;
}

interface PlatformCtxValue {
  provider: Platform;
  setProvider: (p: Platform) => void;
  meta: (typeof PLATFORM_META)[Platform];
  /** 真实登录用户（/api/auth/me 校正后填充；未登录/未就绪时为 null） */
  user: AuthUserInfo | null;
  /** 视角是否已用真实登录身份（/api/auth/me）校正过；未就绪前平台数据请求应跳过 */
  ready: boolean;
}

const PlatformCtx = createContext<PlatformCtxValue>({
  provider: "github",
  setProvider: () => {},
  meta: PLATFORM_META.github,
  user: null,
  ready: false,
});

export function PlatformProvider({ children }: { children: ReactNode }) {
  // SSR/客户端首次一致：先给默认值，挂载后再按 URL/localStorage 校正，避免 hydration 错乱
  const [provider, setProviderState] = useState<Platform>("github");
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProviderState(readInitialPlatform());
    // 视角跟随「真实登录身份」：URL/localStorage 可能缺失或残留脏值（例如 gitee 登录但 localStorage 仍是 github），
    // 会把平台请求打到错误平台接口导致一串 401 { error: "provider" }。以 /api/auth/me 的真实 provider 强制校正。
    authFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u && isPlatform(u.provider)) {
          try {
            localStorage.setItem("rf_platform", u.provider);
          } catch {
            /* 忽略 */
          }
          setProviderState(u.provider);
          // 真实登录用户信息（login/name/avatar），用于侧边栏左下角等展示，替换占位 meta
          setUser({
            login: u.login || "",
            name: u.name || u.login || "",
            avatar: u.avatar || "",
          });
        }
      })
      .catch(() => {
        /* 未登录/接口异常时保持现有视角 */
      })
      .finally(() => setReady(true));
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
    <PlatformCtx.Provider value={{ provider, setProvider, meta: PLATFORM_META[provider], user, ready }}>
      {children}
    </PlatformCtx.Provider>
  );
}

export function usePlatform() {
  return useContext(PlatformCtx);
}