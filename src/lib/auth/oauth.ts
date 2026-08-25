import type { OAuthProvider } from "./jwt";

function enc(s: string) {
  return encodeURIComponent(s);
}

const CONFIG = {
  github: {
    // 兼容旧的 Python 项目键名（CLIENT_ID/CLIENT_SECRET）
    clientId: process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET || "",
    redirectUri: process.env.GITHUB_REDIRECT_URI || "",
    login: "https://github.com",
    api: "https://api.github.com",
  },
  gitee: {
    clientId: process.env.GITEE_CLIENT_ID || "",
    clientSecret: process.env.GITEE_CLIENT_SECRET || "",
    redirectUri: process.env.GITEE_REDIRECT_URI || "",
    login: "https://gitee.com",
    api: "https://gitee.com/api",
  },
} as const;

/**
 * 解析 OAuth 回调地址：
 * 优先用环境变量里登记的 redirect_uri（如 GITHUB_REDIRECT_URI / GITEE_REDIRECT_URI），
 * 否则统一回退到共享的 /callback 路由（由 /callback 按 provider cookie 区分平台）。
 */
export function resolveRedirectUri(p: OAuthProvider, base: string): string {
  if (CONFIG[p].redirectUri) return CONFIG[p].redirectUri;
  return new URL(`/callback`, base).toString();
}

export function isProviderConfigured(p: OAuthProvider): boolean {
  const c = CONFIG[p];
  return Boolean(c.clientId && c.clientSecret);
}

/** 构造授权跳转 URL */
export function authorizeUrl(p: OAuthProvider, redirectUri: string, state: string): string {
  const c = CONFIG[p];
  if (p === "github") {
    const scope = "read:user user:email repo";
    return `${c.login}/login/oauth/authorize?client_id=${enc(c.clientId)}&redirect_uri=${enc(
      redirectUri,
    )}&scope=${enc(scope)}&state=${enc(state)}`;
  }
  const scope = "user_info projects pull_requests";
  return `${c.login}/oauth/authorize?client_id=${enc(c.clientId)}&redirect_uri=${enc(
    redirectUri,
  )}&response_type=code&scope=${enc(scope)}&state=${enc(state)}`;
}

/** 用 code 换取访问令牌（返回平台侧 token） */
export async function exchangeCode(
  p: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; providerUserId: string }> {
  const c = CONFIG[p];
  if (p === "github") {
    const body = new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch(`${c.login}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) throw new Error(`github token error: ${data.error || "missing"}`);
    return { accessToken: data.access_token, providerUserId: "" };
  }

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${c.login}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`gitee token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`gitee token error: ${data.error || "missing"}`);
  return { accessToken: data.access_token, providerUserId: "" };
}

/** 拉取平台用户信息 */
export async function fetchProviderUser(
  p: OAuthProvider,
  accessToken: string,
): Promise<{ providerUserId: string; login: string; name: string; avatar: string }> {
  const c = CONFIG[p];
  if (p === "github") {
    const res = await fetch(`${c.api}/user`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`github user failed: ${res.status}`);
    const u = (await res.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };
    return {
      providerUserId: String(u.id),
      login: u.login,
      name: u.name || u.login,
      avatar: u.avatar_url || "",
    };
  }

  const res = await fetch(`${c.api}/v5/user?access_token=${enc(accessToken)}`);
  if (!res.ok) throw new Error(`gitee user failed: ${res.status}`);
  const u = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  return {
    providerUserId: String(u.id),
    login: u.login,
    name: u.name || u.login,
    avatar: u.avatar_url || "",
  };
}

/** 构建 {provider}:{provider_user_id} 唯一身份 */
export function buildSub(p: OAuthProvider, providerUserId: string): string {
  return `${p}:${providerUserId}`;
}