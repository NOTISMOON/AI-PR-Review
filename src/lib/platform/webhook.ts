import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { verifyAccessToken, type OAuthProvider } from "@/lib/auth/jwt";
import {
  ensureWebhookTables,
  getPlatformAccessToken,
  getPlatformUser,
  getSettingJson,
  getUserById,
  getWebhookConfig,
  getWebhookStats,
  insertWebhookEvent,
  listWebhookSecrets,
  decryptToken,
} from "@/lib/db/mysql";
import { runReviewSafe } from "@/lib/review/graph";
import { publishReviewJob } from "@/lib/queue/rabbitmq";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";

/**
 * Webhook 共享逻辑：
 * - 任意平台登录态解析（config/logs 管理接口用）
 * - 端点配置组装（URL / Secret / 事件 / 规则 / 统计）
 * - 接收端点验签 + 幂等 + 日志（GitHub HMAC-SHA256 / Gitee X-Gitee-Token）
 */

/** 从 cookie 解析当前登录身份（github/gitee 通用，返回该平台的 DB 记录与解密 token） */
export async function resolveWebhookSession(req: NextRequest) {
  const at = req.cookies.get(AUTH.cookieName.access)?.value;
  if (!at) return { error: "unauthorized" as const };
  const user = await verifyAccessToken(at);
  if (!user) return { error: "unauthorized" as const };

  const dbUser = await getPlatformUser(user.provider, user.providerUserId);
  if (!dbUser) return { error: "no_db" as const };
  const token = await getPlatformAccessToken(user.provider, user.providerUserId);
  return {
    ctx: { user, dbUser },
    provider: user.provider,
    token,
  };
}

export interface WebhookConfigData {
  provider: OAuthProvider;
  url: string;
  enabled: boolean;
  secret: string | null;
  /** null 表示从未配置过（前端用默认订阅） */
  events: string[] | null;
  rules: Record<string, boolean> | null;
  verifySsl: boolean;
  repoCount: number | null;
  stats: { total: number; validRate: number; lastReceivedAt: string | null };
}

/** 组装前端端点卡片所需的配置数据（URL 基于请求 origin 构造） */
export async function buildWebhookConfig(
  provider: OAuthProvider,
  userId: number,
  token: string | null,
  origin: string,
): Promise<WebhookConfigData> {
  const cfg = await getWebhookConfig(userId, provider);
  const stats = await getWebhookStats(userId, provider);

  let repoCount: number | null = null;
  if (token) {
    try {
      const repos =
        provider === "github"
          ? await github.listRepos(token, 100)
          : await gitee.listRepos(token, 100);
      repoCount = Array.isArray(repos) ? repos.length : 0;
    } catch {
      /* 拉仓库失败不影响配置展示 */
    }
  }

  return {
    provider,
    url: `${origin}/api/webhook/${provider}`,
    enabled: cfg?.enabled ?? true,
    secret: cfg?.secret ?? null,
    events: cfg ? cfg.events : null,
    rules: cfg ? cfg.rules : null,
    verifySsl: cfg?.verifySsl ?? true,
    repoCount,
    stats: {
      total: stats.total,
      validRate: stats.validRate,
      lastReceivedAt: stats.lastReceivedAt?.toISOString() ?? null,
    },
  };
}

/** 生成新的 Webhook Secret（whsec_ 前缀，48 字节熵） */
export function generateWebhookSecret(): string {
  return "whsec_" + createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32) + createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 16);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface WebhookDeliveryResult {
  status: number;
  body: { ok: boolean; event?: string; reason?: string };
}

/**
 * 接收端点核心：验签 → 幂等写日志 → 返回状态。
 * GitHub 用 X-Hub-Signature-256（HMAC-SHA256）；Gitee 用 X-Gitee-Token。
 * 验签通过的事件记录为 PENDING（等待审查管线消费）。
 */
export async function handleWebhookDelivery(
  provider: OAuthProvider,
  rawBody: string,
  headers: Headers,
): Promise<WebhookDeliveryResult> {
  await ensureWebhookTables();

  let payload: Record<string, any> | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    /* payload 解析失败仍走验签与日志 */
  }

  const eventName =
    (provider === "github" ? headers.get("x-github-event") : headers.get("x-gitee-event")) ||
    payload?.hook_name ||
    "push";

  const deliveryId =
    provider === "github"
      ? headers.get("x-github-delivery") || sha256(rawBody)
      : headers.get("x-gitee-timestamp")
        ? `t:${headers.get("x-gitee-timestamp")}`
        : sha256(rawBody);

  // 验签：遍历该平台所有启用的全局端点 secret
  const secrets = await listWebhookSecrets(provider);
  let matchedOwner: number | null = null;
  let valid = false;

  if (provider === "github") {
    const sig = headers.get("x-hub-signature-256") || "";
    for (const s of secrets) {
      const expect = "sha256=" + createHmac("sha256", s.secret).update(rawBody).digest("hex");
      if (safeEqual(sig, expect)) {
        matchedOwner = s.ownerId;
        valid = true;
        break;
      }
    }
  } else {
    const token = headers.get("x-gitee-token") || "";
    for (const s of secrets) {
      if (s.secret && safeEqual(token, s.secret)) {
        matchedOwner = s.ownerId;
        valid = true;
        break;
      }
    }
  }

  const action = payload?.action ?? null;
  const prNumber = payload?.number ?? payload?.pull_request?.number ?? null;
  const status = valid ? 200 : 401;

  await insertWebhookEvent({
    ownerId: matchedOwner,
    provider,
    deliveryId,
    eventName,
    action,
    prNumber,
    payload,
    validSignature: valid,
    httpStatus: status,
    queueStatus: valid ? "PENDING" : "IGNORED",
  });

  // 审查闭环：GitHub pull_request 事件验签通过后，异步触发 LangGraph 审查（不阻塞响应）
  if (valid && provider === "github" && eventName === "pull_request" && payload) {
    void triggerReviewFromWebhook(matchedOwner, payload);
  }

  return {
    status,
    body: valid
      ? { ok: true, event: eventName }
      : { ok: false, reason: "signature mismatch" },
  };
}

/** 由 webhook 事件异步触发审查（fire-and-forget，失败仅记录） */
async function triggerReviewFromWebhook(ownerId: number | null, payload: Record<string, any>) {
  try {
    if (!ownerId) return;
    const repo = payload?.repository?.full_name;
    const prNumber = payload?.number ?? payload?.pull_request?.number;
    if (!repo || !prNumber) return;
    const [owner, name] = String(repo).split("/");
    if (!owner || !name) return;

    const user = await getUserById(ownerId);
    if (!user?.accessTokenEnc) return;
    const token = decryptToken(user.accessTokenEnc);
    if (!token) return;

    // 读取全局设置中的首选模型
    let preferredModel: string | null = null;
    try {
      const ai = await getSettingJson<{ model?: string }>(ownerId, "ai");
      preferredModel = ai?.model?.trim() ? ai.model.trim() : null;
    } catch {
      /* ignore */
    }

    // 优先入队（RabbitMQ 消费执行）；队列不可用时降级为直接触发
    const queued = await publishReviewJob({
      owner,
      repo: name,
      prNumber,
      depth: "standard",
      userId: ownerId,
      preferredModel,
    });
    if (queued) {
      console.log(`[webhook] 审查任务已入队 ${owner}/${name}#${prNumber}`);
      return;
    }

    console.log(`[webhook] RabbitMQ 不可用，直接触发审查 ${owner}/${name}#${prNumber} ...`);
    await runReviewSafe(
      {
        owner,
        repo: name,
        prNumber,
        depth: "standard",
        token,
        writeReview: false,
        userId: ownerId,
        platform: "github",
        preferredModel,
      },
      null,
    );
    console.log(`[webhook] 审查完成 ${owner}/${name}#${prNumber}`);
  } catch (e) {
    console.error("[webhook] 触发审查失败:", (e as Error).message);
  }
}

export interface RepoHookResult {
  created: boolean;
  id: number | null;
  url: string;
  hook: unknown;
}

/**
 * 一键创建：为某仓库配置 Webhook（自动回填本服务 URL + Secret + 订阅事件）。
 * 若该仓库已存在指向本服务 URL 的 hook，则幂等返回（不重复创建）。
 */
export async function ensureRepoHook(
  provider: OAuthProvider,
  token: string,
  input: { owner: string; repo: string; url: string; secret: string; events: string[] },
): Promise<RepoHookResult> {
  const hooks =
    provider === "github"
      ? await github.listRepoHooks(token, input.owner, input.repo)
      : await gitee.listRepoHooks(token, input.owner, input.repo);

  const existing = (Array.isArray(hooks) ? hooks : []).find(
    (h: any) => h?.config?.url === input.url || h?.url === input.url,
  );
  if (existing) {
    return { created: false, id: existing.id ?? null, url: input.url, hook: existing };
  }

  const created =
    provider === "github"
      ? await github.createRepoHook(token, input.owner, input.repo, {
          url: input.url,
          secret: input.secret,
          events: input.events,
        })
      : await gitee.createRepoHook(token, input.owner, input.repo, {
          url: input.url,
          secret: input.secret,
          events: input.events,
        });

  return { created: true, id: (created as any).id ?? null, url: input.url, hook: created };
}
