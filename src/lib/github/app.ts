import { SignJWT, importPKCS8 } from "jose";
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";

/**
 * GitHub App 机器人身份：
 * 用 App 私钥签发 JWT → 换安装令牌（installation token），以机器人身份回写 PR（批准 / 请求变更 / 评论 / 关闭）。
 * 解决「用户不能对自己的 PR 请求变更 / 批准」的 GitHub 限制。
 *
 * 配置（.env）：
 *   GITHUB_APP_ID=4713982
 *   GITHUB_APP_PRIVATE_KEY_PATH=C:/path/xxx.pem  或  GITHUB_APP_PRIVATE_KEY="-----BEGIN...-----"
 * 未配置 App（缺 APP_ID 或私钥）时返回 not_configured，由调用方回退到用户 token（原逻辑）。
 */

const API = "https://api.github.com";

export type BotTokenResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason: "not_configured" | "key_missing" | "not_installed" | "error";
      message?: string;
    };

/** 读取 App 私钥 PEM（支持文件路径或环境变量内联，含 \n 转义容错） */
function resolvePrivateKeyPem(): string | null {
  if (process.env.GITHUB_APP_PRIVATE_KEY) {
    return process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  const p = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!p) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

let cachedJwt: { token: string; exp: number } | null = null;

/** 签发 App JWT（RS256，GitHub 要求有效期 ≤10 分钟） */
async function createAppJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.exp > now + 60) return cachedJwt.token;
  const pem = resolvePrivateKeyPem();
  if (!pem) throw new Error("GITHUB_APP_PRIVATE_KEY 未配置");
  // GitHub 私钥为 PKCS#1（BEGIN RSA PRIVATE KEY），jose importPKCS8 需 PKCS#8；用 node:crypto 统一转换（两种格式都兼容）
  const pkcs8 = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
  const key = await importPKCS8(pkcs8, "RS256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(process.env.GITHUB_APP_ID))
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
  cachedJwt = { token, exp: now + 9 * 60 };
  return token;
}

/** 以 App 身份（JWT）调用 GitHub API */
async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const jwt = await createAppJwt();
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-pr-review-app/1.0",
      ...(init?.headers ?? {}),
    },
  });
}

// 安装令牌缓存（按 owner/repo，令牌有效期 1 小时，提前 1 分钟续期）
const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * 获取某仓库的机器人安装令牌。
 * 优先走 GitHub App 安装令牌（机器人身份）；未配置/未安装时返回失败原因，由调用方决定回退策略。
 */
export async function getBotToken(owner: string, repo: string): Promise<BotTokenResult> {
  if (!process.env.GITHUB_APP_ID) return { ok: false, reason: "not_configured" };
  if (!resolvePrivateKeyPem()) {
    return {
      ok: false,
      reason: "key_missing",
      message: "未配置 GitHub App 私钥（GITHUB_APP_PRIVATE_KEY_PATH 或 GITHUB_APP_PRIVATE_KEY）",
    };
  }
  const cacheKey = `${owner}/${repo}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.exp > now + 60) return { ok: true, token: hit.token };

  try {
    const instRes = await appFetch(`/repos/${owner}/${repo}/installation`);
    if (!instRes.ok) {
      return {
        ok: false,
        reason: "not_installed",
        message: `GitHub App 未安装到 ${owner}/${repo}（HTTP ${instRes.status}），请在仓库 Settings → GitHub Apps 中安装后重试`,
      };
    }
    const inst = (await instRes.json()) as { id?: number };
    if (!inst.id) return { ok: false, reason: "error", message: "GitHub App 安装信息缺失" };

    const tokRes = await appFetch(`/app/installations/${inst.id}/access_tokens`, { method: "POST" });
    if (!tokRes.ok) {
      return { ok: false, reason: "error", message: `获取安装令牌失败（HTTP ${tokRes.status}）` };
    }
    const body = (await tokRes.json()) as { token?: string; expires_at?: string };
    if (!body.token) return { ok: false, reason: "error", message: "安装令牌响应缺少 token" };

    const exp = body.expires_at
      ? Math.floor(new Date(body.expires_at).getTime() / 1000)
      : now + 3600;
    tokenCache.set(cacheKey, { token: body.token, exp });
    return { ok: true, token: body.token };
  } catch (e) {
    return { ok: false, reason: "error", message: (e as Error).message };
  }
}

/** 判断是否已配置 GitHub App（是否具备机器人回写能力） */
export function isAppConfigured(): boolean {
  return !!process.env.GITHUB_APP_ID && !!resolvePrivateKeyPem();
}
