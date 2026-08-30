import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AUTH, requestUsesHttps } from "./config";
import { signAccessToken, type AuthUser, type OAuthProvider } from "./jwt";
import { getRequestOrigin } from "@/lib/request";
import {
  authorizeUrl,
  buildSub,
  exchangeCode,
  fetchProviderUser,
  isProviderConfigured,
  resolveRedirectUri,
} from "./oauth";
import {
  deleteRefreshToken,
  generateRefreshToken,
  getRefreshUser,
  saveRefreshToken,
} from "./refresh-store";
import { upsertLoginUser, getPlatformUser, upsertInstallation } from "@/lib/db/mysql";
import { listInstallations } from "@/lib/github/user-client";

const cookie = (maxAge: number, secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge,
});

/** OAuth 第一步：生成 state 并重定向到平台授权页 */
export async function startOAuth(provider: OAuthProvider, req: NextRequest) {
  if (!isProviderConfigured(provider)) {
    // 相对 Location：浏览器按当前域名解析，兼容内网穿透改写 Host
    return new NextResponse(null, {
      status: 302,
      headers: { Location: `/login?error=not_configured&provider=${provider}` },
    });
  }
  const redirectUri = resolveRedirectUri(provider, getRequestOrigin(req));
  const state = randomBytes(16).toString("hex");
  const url = authorizeUrl(provider, redirectUri, state);

  const res = NextResponse.redirect(url);
  const secure = requestUsesHttps(req);
  res.cookies.set(AUTH.cookieName.state, state, cookie(600, secure));
  res.cookies.set(AUTH.cookieName.provider, provider, cookie(600, secure));
  return res;
}

/** OAuth 回调：换 token → 拉用户 → 签发双 token（access 存 cookie，refresh 存 cookie + Redis） */
export async function oauthCallback(provider: OAuthProvider, req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const stateCookie = req.cookies.get(AUTH.cookieName.state)?.value;

  const fail = (reason: string) => {
    const res = new NextResponse(null, {
      status: 302,
      headers: { Location: `/login?error=${reason}&provider=${provider}` },
    });
    const secure = requestUsesHttps(req);
    res.cookies.set(AUTH.cookieName.state, "", cookie(0, secure));
    res.cookies.set(AUTH.cookieName.provider, "", cookie(0, secure));
    return res;
  };

  if (!code || !state || state !== stateCookie) return fail("bad_state");

  try {
    const redirectUri = resolveRedirectUri(provider, getRequestOrigin(req));
    const { accessToken } = await exchangeCode(provider, code, redirectUri);
    const up = await fetchProviderUser(provider, accessToken);

    const user: AuthUser = {
      sub: buildSub(provider, up.providerUserId),
      provider,
      providerUserId: up.providerUserId,
      login: up.login,
      name: up.name,
      avatar: up.avatar,
    };

    const access = await signAccessToken(user);
    const refresh = generateRefreshToken();
    // Redis 存 refresh token（服务端可校验/主动吊销）
    await saveRefreshToken(refresh, user, AUTH.refreshTtlSec);

    // 落库：把登录身份 upsert 到 prreview_db.user，保存平台 token（加密）
    // 最佳努力写入，失败不阻断登录
    try {
      await upsertLoginUser({
        provider,
        providerUserId: up.providerUserId,
        login: up.login,
        name: up.name,
        avatar: up.avatar,
        email: undefined,
        accessToken,
        scopes: provider === "github" ? "read:user user:email repo" : "user_info projects pull_requests",
      });
    } catch (dbErr) {
      console.error(`[auth] upsert login user failed (${provider}):`, dbErr);
    }

    // GitHub：登录后同步 GitHub App 安装信息到 github_installation（若该账号安装了 App 则有数据）
    if (provider === "github") {
      try {
        const dbUser = await getPlatformUser(provider, up.providerUserId);
        if (dbUser) {
          const installs = await listInstallations(accessToken);
          for (const inst of installs) {
            await upsertInstallation({
              userId: dbUser.id,
              installationId: String(inst.id),
              accountLogin: inst.account.login,
              accountType: inst.account.type,
              appId: String(inst.app_id),
              permissions: JSON.stringify(inst.permissions),
              repositorySelection: inst.repository_selection,
            });
          }
        }
      } catch (instErr) {
        console.error(`[auth] sync github installations failed (${provider}):`, instErr);
      }
    }

    const res = new NextResponse(null, {
      status: 302,
      headers: { Location: `/dashboard?provider=${provider}` },
    });
    const secure = requestUsesHttps(req);
    res.cookies.set(AUTH.cookieName.access, access, cookie(AUTH.accessTtlSec, secure));
    res.cookies.set(AUTH.cookieName.refresh, refresh, cookie(AUTH.refreshTtlSec, secure));
    res.cookies.set(AUTH.cookieName.state, "", cookie(0, secure));
    res.cookies.set(AUTH.cookieName.provider, "", cookie(0, secure));
    return res;
  } catch (err) {
    console.error(`[auth] OAuth callback failed (${provider}):`, err);
    return fail("oauth_failed");
  }
}

/** 刷新令牌：校验 Redis 中的 refresh → 签发新 access（并轮换 refresh） */
export async function refreshAccessToken(req: NextRequest) {
  const refresh = req.cookies.get(AUTH.cookieName.refresh)?.value;
  if (!refresh) return null;

  const user = await getRefreshUser(refresh);
  if (!user) return null;

  // 轮换 refresh（防重放）
  await deleteRefreshToken(refresh);
  const newRefresh = generateRefreshToken();
  await saveRefreshToken(newRefresh, user, AUTH.refreshTtlSec);
  const newAccess = await signAccessToken(user);

  return { user, access: newAccess, refresh: newRefresh };
}

/** 登出：删除 Redis refresh + 清空 cookie */
export async function revokeSession(req: NextRequest) {
  const refresh = req.cookies.get(AUTH.cookieName.refresh)?.value;
  if (refresh) await deleteRefreshToken(refresh);
}