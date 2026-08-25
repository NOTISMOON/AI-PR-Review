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
import { cacheDel, cacheDelPattern } from "@/lib/cache/redis";
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
  let matchedEvents: string[] = [];
  let valid = false;

  if (provider === "github") {
    const sig = headers.get("x-hub-signature-256") || "";
    for (const s of secrets) {
      const expect = "sha256=" + createHmac("sha256", s.secret).update(rawBody).digest("hex");
      if (safeEqual(sig, expect)) {
        matchedOwner = s.ownerId;
        matchedEvents = s.events;
        valid = true;
        break;
      }
    }
  } else {
    const token = headers.get("x-gitee-token") || "";
    for (const s of secrets) {
      if (s.secret && safeEqual(token, s.secret)) {
        matchedOwner = s.ownerId;
        matchedEvents = s.events;
        valid = true;
        break;
      }
    }
  }

  const action = payload?.action ?? null;
  const prNumber = payload?.number ?? payload?.pull_request?.number ?? null;
  const status = valid ? 200 : 401;

  // 验签通过：主动失效该用户相关缓存（dashboard/repos/pulls/contributions），
  // 覆盖 push / PR、MR 变更场景，避免外部变更后依赖 TTL 或手动同步才可见；失败仅降级不影响主流程
  if (valid && matchedOwner != null) {
    try {
      await cacheDel(`${provider}:dashboard:${matchedOwner}`);
      await cacheDel(`${provider}:repos:${matchedOwner}`);
      await cacheDelPattern(`${provider}:pulls:${matchedOwner}:*`);
      await cacheDelPattern(`${provider}:contributions:${matchedOwner}:*`);
    } catch (e) {
      console.warn("[webhook] 缓存主动失效失败（降级）:", (e as Error).message);
    }
  }

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

  // 审查闭环：pull_request / Gitee Merge Request Hook 事件验签通过后，异步触发 LangGraph 审查（不阻塞响应，GitHub/Gitee 均支持）
  // 注意：Gitee 的 PR 触发事件在 x-gitee-event 里名为 "Merge Request Hook"（Gitee 称之为 Merge Request），并非 pull_request
  const isPrEvent =
    eventName === "pull_request" ||
    (provider === "gitee" && eventName === "Merge Request Hook");
  if (valid && isPrEvent && payload) {
    // 事件订阅过滤：未订阅 pull_request 则只记录，不触发审查
    if (!matchedEvents.length || matchedEvents.includes("pull_request")) {
      void triggerReviewFromWebhook(provider, matchedOwner, payload);
    }
  }

  return {
    status,
    body: valid
      ? { ok: true, event: eventName }
      : { ok: false, reason: "signature mismatch" },
  };
}

/** 由 webhook 事件异步触发审查（fire-and-forget，失败仅记录） */
async function triggerReviewFromWebhook(provider: OAuthProvider, ownerId: number | null, payload: Record<string, any>) {
  try {
    if (!ownerId) return;
    // 仓库字段：GitHub 用 repository.full_name，Gitee MR 事件用 project.full_name
    const repo =
      provider === "gitee"
        ? payload?.project?.full_name || payload?.repository?.full_name
        : payload?.repository?.full_name;
    const prNumber = payload?.number ?? payload?.pull_request?.number;
    if (!repo || !prNumber) return;
    const [owner, name] = String(repo).split("/");
    if (!owner || !name) return;
    const fullName = `${owner}/${name}`;

    const user = await getUserById(ownerId);
    if (!user?.accessTokenEnc) return;
    const token = decryptToken(user.accessTokenEnc);
    if (!token) return;

    // 读取全局设置：AI 参数 + 审查规则 + 仓库开关
    let preferredModel: string | null = null;
    let depth: "fast" | "standard" | "deep" = "standard";
    let riskThreshold = "默认";
    let temperature = 0.1;
    let maxComments = 10;
    let autoWrite = false;
    let diffOnly = false;
    let skipDraft = false;
    let setStatus = false;
    try {
      const [ai, switches, repoAuto] = await Promise.all([
        getSettingJson<{
          model?: string;
          depth?: string;
          riskThreshold?: string;
          temperature?: number;
          maxComments?: string | number;
        }>(ownerId, "ai"),
        getSettingJson<{ auto_write?: boolean; diff_only?: boolean; skip_draft?: boolean; set_status?: boolean }>(ownerId, "switches"),
        getSettingJson<Record<string, boolean>>(ownerId, "repo_auto_review"),
      ]);
      preferredModel = ai?.model?.trim() ? ai.model.trim() : null;
      depth = ai?.depth === "fast" || ai?.depth === "deep" ? ai.depth : "standard";
      riskThreshold = ai?.riskThreshold?.trim() ? ai.riskThreshold.trim() : "默认";
      if (typeof ai?.temperature === "number") temperature = ai.temperature;
      const mc = Number(ai?.maxComments);
      if (Number.isFinite(mc) && mc > 0) maxComments = Math.min(Math.floor(mc), 50);
      autoWrite = !!switches?.auto_write;
      diffOnly = !!switches?.diff_only;
      skipDraft = !!switches?.skip_draft;
      setStatus = !!switches?.set_status;

      // 仓库开关：关闭了自动审查的仓库不触发
      if (repoAuto?.[fullName] === false) {
        console.log(`[webhook] ${fullName} 已关闭自动审查，跳过 #${prNumber}`);
        return;
      }
    } catch {
      /* ignore */
    }

    // 通知规则（webhook 页）：skip_draft / skip_bot / threshold_pause
    try {
      const cfg = await getWebhookConfig(ownerId, provider);
      const rules = cfg?.rules ?? {};
      const pr = payload?.pull_request ?? {};
      const prTitle = String(pr.title || payload?.title || "");
      if (skipDraft || rules.skip_draft) {
        const isDraft = pr.draft === true;
        const isWip = /^wip[:\s]/i.test(prTitle);
        if (isDraft || isWip) {
          console.log(`[webhook] 跳过草稿/WIP PR ${fullName}#${prNumber}`);
          return;
        }
      }
      if (rules.skip_bot) {
        const author = String(pr.user?.login || payload?.sender?.login || "");
        if (/\[bot\]$/i.test(author) || /-bot$/i.test(author)) {
          console.log(`[webhook] 跳过机器人账号 ${author} 的变更`);
          return;
        }
      }
      if (rules.threshold_pause) {
        const changed = Number(pr.changed_files ?? 0);
        if (changed > 30) {
          console.log(`[webhook] 变更文件超过阈值（${changed}），暂停审查`);
          return;
        }
      }
    } catch {
      /* ignore */
    }

    // 自动回写 review / 设置提交状态（仅 GitHub 支持相关 API）
    const writeReview = autoWrite && provider === "github";
    const writeStatus = setStatus && provider === "github";

    // 优先入队（RabbitMQ 消费执行）；队列不可用时降级为直接触发
    const queued = await publishReviewJob({
      owner,
      repo: name,
      prNumber,
      depth,
      userId: ownerId,
      platform: provider,
      preferredModel,
      riskThreshold,
      writeReview,
      writeStatus,
      temperature,
      maxComments,
      diffOnly,
    });
    if (queued) {
      console.log(`[webhook] 审查任务已入队 ${provider} ${fullName}#${prNumber} (depth=${depth}, threshold=${riskThreshold})`);
      return;
    }

    console.log(`[webhook] RabbitMQ 不可用，直接触发审查 ${fullName}#${prNumber} ...`);
    await runReviewSafe(
      {
        owner,
        repo: name,
        prNumber,
        depth,
        token,
        writeReview,
        writeStatus,
        userId: ownerId,
        platform: provider,
        preferredModel,
        riskThreshold,
        temperature,
        maxComments,
        diffOnly,
      },
      null,
    );
    console.log(`[webhook] 审查完成 ${fullName}#${prNumber}`);
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

/** 销毁某仓库指向本服务 URL 的 Webhook（关闭自动审查时调用），返回是否已删除 */
export async function removeRepoHook(
  provider: OAuthProvider,
  token: string,
  input: { owner: string; repo: string; url: string },
): Promise<boolean> {
  const hooks =
    provider === "github"
      ? await github.listRepoHooks(token, input.owner, input.repo)
      : await gitee.listRepoHooks(token, input.owner, input.repo);
  const target = (Array.isArray(hooks) ? hooks : []).find(
    (h: any) => h?.config?.url === input.url || h?.url === input.url,
  );
  if (!target) return false;
  if (provider === "github") {
    return github.deleteRepoHook(token, input.owner, input.repo, target.id as number);
  }
  return gitee.deleteRepoHook(token, input.owner, input.repo, target.id as number);
}
