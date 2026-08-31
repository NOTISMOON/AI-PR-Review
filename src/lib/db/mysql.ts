import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { AUTH } from "@/lib/auth/config";
import type { OAuthProvider } from "@/lib/auth/jwt";
import { getDb, getPool, closeDb as closeDbPool } from "./drizzle";
import {
  user,
  githubInstallation,
  contributionSummary,
  webhookSubscription,
  webhookEvent,
  aiReviewJob,
  reviewIssue,
  notification,
  userSetting,
} from "./schema";

/**
 * PR Review 平台业务库（MySQL）数据访问层。
 * 全部读写走 Drizzle ORM（类型化、参数化，天然防 SQL 注入）。
 * 使用 PR_MYSQL_URL；未配置时静默跳过（不阻断登录），便于本地/原型运行。
 * 建表仍由 ensure* 幂等迁移函数执行（静态 DDL，见 docs/数据库设计.md）。
 */

// ── 平台 token 加密（AES-256-GCM，密钥由 AUTH.jwtSecret 派生） ──
function cipherKey(): Buffer {
  return createHash("sha256").update(AUTH.jwtSecret).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptToken(encoded: string): string | null {
  try {
    const [ivB64, tagB64, encB64] = encoded.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cipherKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export interface PersistLoginUser {
  provider: OAuthProvider;
  providerUserId: string;
  login: string;
  name: string;
  avatar: string;
  email?: string;
  accessToken?: string; // 平台侧 access_token（非平台 JWT）
  scopes?: string;
}

/** 登录后 upsert 用户：以 provider+provider_user_id 幂等写入，并更新平台 token / 登录时间 */
export async function upsertLoginUser(u: PersistLoginUser): Promise<void> {
  const db = getDb();
  if (!db) return;
  const accessEnc = u.accessToken ? encryptToken(u.accessToken) : null;
  const now = new Date();
  await db
    .insert(user)
    .values({
      provider: u.provider,
      providerUserId: u.providerUserId,
      login: u.login,
      displayName: u.name,
      email: u.email ?? null,
      avatarUrl: u.avatar,
      accessTokenEnc: accessEnc,
      scopes: u.scopes ?? null,
      lastLoginAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        login: sql`values(login)`,
        displayName: sql`values(display_name)`,
        email: sql`values(email)`,
        avatarUrl: sql`values(avatar_url)`,
        accessTokenEnc: sql`values(access_token_enc)`,
        scopes: sql`values(scopes)`,
        lastLoginAt: sql`values(last_login_at)`,
        updatedAt: sql`values(updated_at)`,
      },
    });
}

export { closeDbPool as closeDb };

/** 按登录身份取平台用户（用于拿解密 token 调 GitHub API） */
export async function getPlatformUser(
  provider: OAuthProvider,
  providerUserId: string,
): Promise<{ id: number; login: string; accessTokenEnc?: string | null } | null> {
  const db = getDb();
  if (!db) return null;
  const [r] = await db
    .select({
      id: user.id,
      login: user.login,
      accessTokenEnc: user.accessTokenEnc,
    })
    .from(user)
    .where(and(eq(user.provider, provider), eq(user.providerUserId, providerUserId)))
    .limit(1);
  if (!r) return null;
  return { id: r.id, login: r.login, accessTokenEnc: r.accessTokenEnc ?? null };
}

/** 解密当前用户的平台 access_token（用于调用 GitHub/Gitee API） */
export async function getPlatformAccessToken(
  provider: OAuthProvider,
  providerUserId: string,
): Promise<string | null> {
  const u = await getPlatformUser(provider, providerUserId);
  if (u?.accessTokenEnc) return decryptToken(u.accessTokenEnc);
  return null;
}

/** 按 user.id 取平台账号（webhook 验签命中后定位 token 用） */
export async function getUserById(
  userId: number,
): Promise<{ id: number; provider: OAuthProvider; providerUserId: string; login: string; accessTokenEnc?: string | null } | null> {
  const db = getDb();
  if (!db) return null;
  const [r] = await db
    .select({
      id: user.id,
      provider: user.provider,
      providerUserId: user.providerUserId,
      login: user.login,
      accessTokenEnc: user.accessTokenEnc,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    provider: r.provider as OAuthProvider,
    providerUserId: r.providerUserId,
    login: r.login,
    accessTokenEnc: r.accessTokenEnc ?? null,
  };
}

/** upsert GitHub App 安装信息（github_installation） */
export async function upsertInstallation(input: {
  userId: number;
  installationId: string;
  accountLogin: string;
  accountType: string;
  appId?: string;
  permissions?: string;
  repositorySelection?: string;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(githubInstallation)
    .values({
      userId: input.userId,
      installationId: Number(input.installationId),
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      appId: input.appId ?? null,
      permissions: input.permissions ? JSON.stringify(input.permissions) : null,
      repositorySelection: input.repositorySelection ?? null,
      status: 1,
    })
    .onDuplicateKeyUpdate({
      set: {
        accountLogin: sql`values(account_login)`,
        accountType: sql`values(account_type)`,
        appId: sql`values(app_id)`,
        permissions: sql`values(permissions)`,
        repositorySelection: sql`values(repository_selection)`,
        status: sql`1`,
      },
    });
}

/** upsert 某用户某天的贡献数到 contribution_summary（供热力图/统计持久化与读取） */
export async function upsertContributionDay(
  userId: number,
  provider: OAuthProvider,
  date: string, // YYYY-MM-DD
  commits: number,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(contributionSummary)
    .values({
      userId,
      statDate: new Date(date),
      commits,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        commits: sql`values(commits)`,
        updatedAt: sql`values(updated_at)`,
      },
    });
}

/** 读取某用户某天起（区间）的贡献，用于渲染热力图 */
export async function getContributionsByUser(
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; commits: number }[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({ date: contributionSummary.statDate, commits: contributionSummary.commits })
    .from(contributionSummary)
    .where(
      and(
        eq(contributionSummary.userId, userId),
        sql`${contributionSummary.statDate} BETWEEN ${fromDate} AND ${toDate}`,
        sql`${contributionSummary.commits} > 0`,
      ),
    );
  // statDate 为 DATE 类型，drizzle 映射回 Date；统一格式化为 YYYY-MM-DD
  return rows.map((r) => ({ date: formatDateOnly(r.date), commits: r.commits }));
}

/** 把 Date 格式化为 YYYY-MM-DD（本地时区） */
function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Webhook（订阅配置 + 事件日志，表结构见 docs/数据库设计.md §3.4） ──

/** 幂等建表：路由入口调用一次，避免用户手动执行 SQL */
export async function ensureWebhookTables(): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.query(`CREATE TABLE IF NOT EXISTS webhook_subscription (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id      BIGINT UNSIGNED NOT NULL,
    platform      VARCHAR(16) NOT NULL,
    repository_id BIGINT UNSIGNED DEFAULT NULL,
    events        VARCHAR(1024) NOT NULL,
    secret_enc    VARCHAR(512) DEFAULT NULL,
    url           VARCHAR(512) DEFAULT NULL,
    enabled       TINYINT NOT NULL DEFAULT 1,
    verify_ssl    TINYINT NOT NULL DEFAULT 1,
    rules_json    JSON DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_owner_platform (owner_id, platform),
    KEY idx_owner_platform (owner_id, platform, enabled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await p.query(`CREATE TABLE IF NOT EXISTS webhook_event (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id        BIGINT UNSIGNED DEFAULT NULL,
    platform        VARCHAR(16) NOT NULL,
    delivery_id     VARCHAR(64) NOT NULL,
    event_name      VARCHAR(64) NOT NULL,
    action          VARCHAR(32) DEFAULT NULL,
    repository_id   BIGINT UNSIGNED DEFAULT NULL,
    pr_number       INT UNSIGNED DEFAULT NULL,
    payload         JSON DEFAULT NULL,
    valid_signature TINYINT NOT NULL DEFAULT 1,
    http_status     SMALLINT DEFAULT NULL,
    queue_status    VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    retry_count     INT NOT NULL DEFAULT 0,
    received_at     DATETIME DEFAULT NULL,
    processed_at    DATETIME DEFAULT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_delivery (platform, delivery_id),
    KEY idx_queue (queue_status, retry_count),
    KEY idx_event_time (event_name, created_at),
    KEY idx_owner_time (owner_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // 兼容旧表：CREATE TABLE IF NOT EXISTS 不会给已存在的表补索引。
  // 若缺唯一键，先合并重复行再补键，否则 ON DUPLICATE KEY UPDATE 永不生效（每次保存都新增一行）。
  await ensureUniqueKey(
    p,
    "webhook_subscription",
    "uk_owner_platform",
    "owner_id, platform",
  );
  await ensureUniqueKey(p, "webhook_event", "uk_delivery", "platform, delivery_id");
}

/** 给已存在但缺唯一键的表补键：先去重（保留每组 key 中 id 最小的一行）再加唯一索引 */
async function ensureUniqueKey(
  p: import("mysql2/promise").Pool,
  table: string,
  keyName: string,
  cols: string,
): Promise<void> {
  const [idx] = await p.query<any>(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [keyName]);
  if (Array.isArray(idx) && idx.length > 0) return;

  const a = cols.split(",").map((c) => c.trim());
  const joinOn = a.map((c) => `t1.${c} = t2.${c}`).join(" AND ");
  await p.query(`DELETE t1 FROM ${table} t1 INNER JOIN ${table} t2 ON ${joinOn} AND t1.id > t2.id`);
  await p.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${keyName} (${cols})`);
}

/** 给已存在但缺列的表补列（幂等，避免旧表结构与新代码不一致） */
async function ensureColumns(
  p: import("mysql2/promise").Pool,
  table: string,
  cols: { name: string; ddl: string }[],
): Promise<void> {
  const [rows] = await p.query<any>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  const existing = new Set((rows || []).map((r: any) => r.COLUMN_NAME));
  for (const c of cols) {
    if (!existing.has(c.name)) {
      await p.query(`ALTER TABLE ${table} ADD COLUMN ${c.ddl}`);
    }
  }
}

/** 把已存在且 NOT NULL 无默认值的列修正为可空（兼容旧版表结构，幂等） */
async function ensureColumnNullable(
  p: import("mysql2/promise").Pool,
  table: string,
  column: string,
  nullableDdl: string,
): Promise<void> {
  const [rows] = await p.query<any>(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  const col = rows?.[0];
  if (!col) return; // 列不存在则忽略
  if (col.IS_NULLABLE === "YES") return; // 已可空
  await p.query(`ALTER TABLE ${table} MODIFY COLUMN ${nullableDdl}`);
}

export interface WebhookSubscription {
  id: number;
  ownerId: number;
  platform: OAuthProvider;
  events: string[];
  secret: string | null;
  url: string | null;
  enabled: boolean;
  verifySsl: boolean;
  rules: Record<string, boolean>;
}

function parseRulesJson(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** 读取某用户某平台的全局端点配置（repository_id IS NULL），无则返回 null */
export async function getWebhookConfig(
  userId: number,
  provider: OAuthProvider,
): Promise<WebhookSubscription | null> {
  const db = getDb();
  if (!db) return null;
  const [r] = await db
    .select()
    .from(webhookSubscription)
    .where(
      and(
        eq(webhookSubscription.ownerId, userId),
        eq(webhookSubscription.platform, provider),
        sql`${webhookSubscription.repositoryId} IS NULL`,
      ),
    )
    .orderBy(desc(webhookSubscription.id))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId,
    platform: r.platform as OAuthProvider,
    events: (r.events || "").split(",").filter(Boolean),
    secret: r.secretEnc ? decryptToken(r.secretEnc) : null,
    url: r.url ?? null,
    enabled: !!r.enabled,
    verifySsl: !!r.verifySsl,
    rules: parseRulesJson(r.rulesJson ?? null),
  };
}

/** 保存全局端点配置：events 逗号串、rules JSON；secret 仅在传入时更新（首次生成/轮换） */
export async function upsertWebhookConfig(input: {
  userId: number;
  provider: OAuthProvider;
  events: string[];
  rules: Record<string, boolean>;
  enabled: boolean;
  url?: string | null;
  verifySsl?: boolean;
  secret?: string | null; // 明文，仅首次/轮换时传入
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  const secretEnc = input.secret ? encryptToken(input.secret) : null;
  await db
    .insert(webhookSubscription)
    .values({
      ownerId: input.userId,
      platform: input.provider,
      events: input.events.join(","),
      secretEnc,
      url: input.url ?? null,
      enabled: input.enabled ? 1 : 0,
      verifySsl: input.verifySsl === undefined ? 1 : input.verifySsl ? 1 : 0,
      rulesJson: JSON.stringify(input.rules),
    })
    .onDuplicateKeyUpdate({
      set: {
        events: sql`values(events)`,
        url: sql`values(url)`,
        enabled: sql`values(enabled)`,
        verifySsl: sql`values(verify_ssl)`,
        rulesJson: sql`values(rules_json)`,
        secretEnc: sql`IF(values(secret_enc) IS NOT NULL, values(secret_enc), secret_enc)`,
      },
    });
}

/** 接收端点用：该平台所有启用的全局端点 secret（解密后），用于逐一验签 */
export async function listWebhookSecrets(
  provider: OAuthProvider,
): Promise<{ ownerId: number; secret: string; events: string[] }[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      ownerId: webhookSubscription.ownerId,
      secretEnc: webhookSubscription.secretEnc,
      events: webhookSubscription.events,
    })
    .from(webhookSubscription)
    .where(
      and(
        eq(webhookSubscription.platform, provider),
        sql`${webhookSubscription.repositoryId} IS NULL`,
        eq(webhookSubscription.enabled, 1),
        sql`${webhookSubscription.secretEnc} IS NOT NULL`,
      ),
    );
  return rows
    .map((r) => ({
      ownerId: r.ownerId,
      secret: decryptToken(r.secretEnc),
      events: Array.isArray(r.events) ? r.events : r.events ? String(r.events).split(",") : [],
    }))
    .filter((x) => !!x.secret) as { ownerId: number; secret: string; events: string[] }[];
}

/** 写入一条 webhook 事件日志；delivery 幂等（重复投递返回 false） */
export async function insertWebhookEvent(input: {
  ownerId?: number | null;
  provider: OAuthProvider;
  deliveryId: string;
  eventName: string;
  action?: string | null;
  prNumber?: number | null;
  payload?: unknown;
  validSignature?: boolean;
  httpStatus?: number | null;
  queueStatus?: string;
  receivedAt?: Date;
}): Promise<boolean> {
  const db = getDb();
  if (!db) return true;
  const res = await db
    .insert(webhookEvent)
    .ignore()
    .values({
      ownerId: input.ownerId ?? null,
      platform: input.provider,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      action: input.action ?? null,
      prNumber: input.prNumber ?? null,
      payload: input.payload !== undefined ? JSON.stringify(input.payload) : null,
      validSignature: input.validSignature === false ? 0 : 1,
      httpStatus: input.httpStatus ?? null,
      queueStatus: input.queueStatus ?? "PENDING",
      receivedAt: input.receivedAt ?? new Date(),
    });
  const info = Array.isArray(res) ? res[0] : res;
  return Number((info as any)?.affectedRows ?? 0) > 0;
}

/** 前端日志：某用户某平台最近的触发记录 */
export async function listWebhookEvents(
  userId: number,
  provider: OAuthProvider,
  limit = 30,
): Promise<{
  id: number;
  event: string;
  action: string | null;
  prNumber: number | null;
  repository: string | null;
  deliveryId: string;
  validSignature: boolean;
  httpStatus: number | null;
  createdAt: Date;
}[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: webhookEvent.id,
      eventName: webhookEvent.eventName,
      action: webhookEvent.action,
      prNumber: webhookEvent.prNumber,
      deliveryId: webhookEvent.deliveryId,
      validSignature: webhookEvent.validSignature,
      httpStatus: webhookEvent.httpStatus,
      createdAt: webhookEvent.createdAt,
      payloadStr: webhookEvent.payload,
    })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.ownerId, userId),
        eq(webhookEvent.platform, provider),
      ),
    )
    .orderBy(desc(webhookEvent.id))
    .limit(limit);
  return rows.map((r) => {
    let repository: string | null = null;
    try {
      if (r.payloadStr) {
        const p = JSON.parse(r.payloadStr);
        repository = p?.repository?.full_name ?? null;
      }
    } catch {
      repository = null;
    }
    return {
      id: r.id,
      event: r.eventName,
      action: r.action ?? null,
      prNumber: r.prNumber ?? null,
      repository,
      deliveryId: r.deliveryId,
      validSignature: !!r.validSignature,
      httpStatus: r.httpStatus ?? null,
      createdAt: new Date(r.createdAt),
    };
  });
}

/** 端点卡片统计：触发总数 / 验签通过率 / 最近触发时间 */
export async function getWebhookStats(
  userId: number,
  provider: OAuthProvider,
): Promise<{ total: number; validRate: number; lastReceivedAt: Date | null }> {
  const db = getDb();
  if (!db) return { total: 0, validRate: 1, lastReceivedAt: null };
  const [r] = await db
    .select({
      total: count(webhookEvent.id),
      valid: sql<number>`SUM(${webhookEvent.validSignature} = 1)`,
      last: sql<Date>`MAX(${webhookEvent.createdAt})`,
    })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.ownerId, userId),
        eq(webhookEvent.platform, provider),
      ),
    );
  const total = Number(r?.total ?? 0);
  const valid = Number(r?.valid ?? 0);
  return {
    total,
    validRate: total > 0 ? valid / total : 1,
    lastReceivedAt: r?.last ? new Date(r.last) : null,
  };
}

// ── 自动审查结果（ai_review_job + review_issue，表结构见 docs/数据库设计.md §3.3） ──

/** 幂等建表：webhook 自动审查结果 + 审查问题/评论（供用户处理：批准/评论/采纳/拒绝） */
export async function ensureReviewTables(): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.query(`CREATE TABLE IF NOT EXISTS ai_review_job (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id         BIGINT UNSIGNED NOT NULL,
    platform         VARCHAR(16) NOT NULL DEFAULT 'github',
    pr_number        INT UNSIGNED NOT NULL,
    repo_full_name   VARCHAR(255) NOT NULL,
    pr_title         VARCHAR(255) DEFAULT NULL,
    commit_sha       CHAR(40) NOT NULL,
    trigger_source   VARCHAR(16) NOT NULL DEFAULT 'webhook',
    provider         VARCHAR(32) DEFAULT NULL,
    model            VARCHAR(64) DEFAULT NULL,
    depth            VARCHAR(16) DEFAULT 'standard',
    status           VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    decision         VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    summary          MEDIUMTEXT,
    risk_level       VARCHAR(16) DEFAULT NULL,
    risk_count       INT NOT NULL DEFAULT 0,
    suggestion_count INT NOT NULL DEFAULT 0,
    positive_count   INT NOT NULL DEFAULT 0,
    latency_ms       INT DEFAULT NULL,
    input_tokens     INT DEFAULT NULL,
    output_tokens    INT DEFAULT NULL,
    result_json      LONGTEXT,
    error_code       VARCHAR(64) DEFAULT NULL,
    error_message    VARCHAR(512) DEFAULT NULL,
    started_at       DATETIME DEFAULT NULL,
    completed_at     DATETIME DEFAULT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_owner_pr_sha (owner_id, pr_number, commit_sha),
    KEY idx_owner_status (owner_id, status, created_at),
    KEY idx_owner_created (owner_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await p.query(`CREATE TABLE IF NOT EXISTS review_issue (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id      BIGINT UNSIGNED NOT NULL,
    job_id        BIGINT UNSIGNED NOT NULL,
    pr_number     INT UNSIGNED NOT NULL,
    repo_full_name VARCHAR(255) NOT NULL,
    kind          VARCHAR(16) NOT NULL,
    severity      VARCHAR(16) DEFAULT NULL,
    title         VARCHAR(255) NOT NULL,
    description   MEDIUMTEXT,
    file          VARCHAR(255) DEFAULT NULL,
    line          INT DEFAULT NULL,
    code          MEDIUMTEXT,
    suggestion    MEDIUMTEXT,
    confidence    VARCHAR(16) DEFAULT NULL,
    category      VARCHAR(32) DEFAULT NULL,
    source        VARCHAR(16) NOT NULL DEFAULT 'ai',
    status        VARCHAR(16) NOT NULL DEFAULT 'pending',
    comment_id    VARCHAR(64) DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_job (job_id),
    KEY idx_owner_pr (owner_id, pr_number, created_at),
    KEY idx_kind_severity (kind, severity)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // 兼容旧表（docs 版本的表缺列/缺幂等唯一键）：补齐新代码依赖的结构
  await ensureColumns(p, "ai_review_job", [
    { name: "platform", ddl: "platform VARCHAR(16) NOT NULL DEFAULT 'github'" },
    { name: "repo_full_name", ddl: "repo_full_name VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "pr_title", ddl: "pr_title VARCHAR(255) DEFAULT NULL" },
    { name: "decision", ddl: "decision VARCHAR(16) NOT NULL DEFAULT 'PENDING'" },
    { name: "result_json", ddl: "result_json LONGTEXT" },
  ]);
  // 旧版表的 repository_id / pull_request_id 为 NOT NULL 无默认值，会导致插入缺默认值失败；改为可空
  await ensureColumnNullable(p, "ai_review_job", "repository_id", "repository_id BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumnNullable(p, "ai_review_job", "pull_request_id", "pull_request_id BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumns(p, "review_issue", [
    { name: "repo_full_name", ddl: "repo_full_name VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "comment_id", ddl: "comment_id VARCHAR(64) DEFAULT NULL" },
  ]);
  // 旧版 review_issue 同样存在 NOT NULL 无默认值的 repository_id / pull_request_id
  await ensureColumnNullable(p, "review_issue", "repository_id", "repository_id BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumnNullable(p, "review_issue", "pull_request_id", "pull_request_id BIGINT UNSIGNED DEFAULT NULL");
  await ensureUniqueKey(p, "ai_review_job", "uk_owner_pr_sha", "owner_id, pr_number, commit_sha");
}

export interface ReviewIssueInput {
  kind: "RISK" | "SUGGESTION" | "POSITIVE";
  severity?: string | null;
  title: string;
  description?: string;
  file?: string | null;
  line?: number | null;
  code?: string;
  suggestion?: string;
  confidence?: string | null;
  category?: string | null;
}

export interface ReviewJobResult {
  id: number;
  prNumber: number;
  repoFullName: string;
  prTitle: string | null;
  commitSha: string;
  status: string;
  decision: string;
  summary: string | null;
  riskLevel: string | null;
  riskCount: number;
  suggestionCount: number;
  positiveCount: number;
  model: string | null;
  provider: string | null;
  depth: string | null;
  latencyMs: number | null;
  result: Record<string, unknown> | null;
  completedAt: Date | null;
  createdAt: Date;
}

function mapJob(r: typeof aiReviewJob.$inferSelect): ReviewJobResult {
  return {
    id: r.id,
    prNumber: r.prNumber,
    repoFullName: r.repoFullName,
    prTitle: r.prTitle ?? null,
    commitSha: r.commitSha,
    status: r.status,
    decision: r.decision,
    summary: r.summary ?? null,
    riskLevel: r.riskLevel ?? null,
    riskCount: Number(r.riskCount ?? 0),
    suggestionCount: Number(r.suggestionCount ?? 0),
    positiveCount: Number(r.positiveCount ?? 0),
    model: r.model ?? null,
    provider: r.provider ?? null,
    depth: r.depth ?? null,
    latencyMs: r.latencyMs ?? null,
    result: r.resultJson ? safeParseJson(r.resultJson) : null,
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    createdAt: new Date(r.createdAt),
  };
}

/** 写入一次审查结果（幂等：同 owner+pr+commit_sha 只保留一次），返回 job id */
export async function upsertReviewJob(input: {
  userId: number;
  platform: OAuthProvider;
  prNumber: number;
  repoFullName: string;
  prTitle?: string | null;
  commitSha: string;
  triggerSource?: string;
  provider?: string | null;
  model?: string | null;
  depth?: string;
  status: string;
  decision?: string;
  summary?: string | null;
  riskLevel?: string | null;
  riskCount?: number;
  suggestionCount?: number;
  positiveCount?: number;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  resultJson?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  completedAt?: Date;
}): Promise<number | null> {
  const db = getDb();
  if (!db) return null;
  await db
    .insert(aiReviewJob)
    .values({
      ownerId: input.userId,
      platform: input.platform,
      prNumber: input.prNumber,
      repoFullName: input.repoFullName,
      prTitle: input.prTitle ?? null,
      commitSha: input.commitSha,
      triggerSource: input.triggerSource ?? "webhook",
      provider: input.provider ?? null,
      model: input.model ?? null,
      depth: input.depth ?? "standard",
      status: input.status,
      decision: input.decision ?? "PENDING",
      summary: input.summary ?? null,
      riskLevel: input.riskLevel ?? null,
      riskCount: input.riskCount ?? 0,
      suggestionCount: input.suggestionCount ?? 0,
      positiveCount: input.positiveCount ?? 0,
      latencyMs: input.latencyMs ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      resultJson: input.resultJson ? JSON.stringify(input.resultJson) : null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      completedAt: input.completedAt ?? new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        platform: sql`values(platform)`,
        repoFullName: sql`values(repo_full_name)`,
        prTitle: sql`values(pr_title)`,
        triggerSource: sql`values(trigger_source)`,
        provider: sql`values(provider)`,
        model: sql`values(model)`,
        depth: sql`values(depth)`,
        status: sql`values(status)`,
        summary: sql`values(summary)`,
        riskLevel: sql`values(risk_level)`,
        riskCount: sql`values(risk_count)`,
        suggestionCount: sql`values(suggestion_count)`,
        positiveCount: sql`values(positive_count)`,
        latencyMs: sql`values(latency_ms)`,
        inputTokens: sql`values(input_tokens)`,
        outputTokens: sql`values(output_tokens)`,
        resultJson: sql`values(result_json)`,
        errorCode: sql`values(error_code)`,
        errorMessage: sql`values(error_message)`,
        completedAt: sql`values(completed_at)`,
      },
    });
  // 返回 job id（幂等 upsert 后取该 pr+sha 的记录）
  const [r] = await db
    .select({ id: aiReviewJob.id })
    .from(aiReviewJob)
    .where(
      and(
        eq(aiReviewJob.ownerId, input.userId),
        eq(aiReviewJob.prNumber, input.prNumber),
        eq(aiReviewJob.commitSha, input.commitSha),
      ),
    )
    .limit(1);
  return r?.id ?? null;
}

/** 写入审查问题/评论（先清空该 job 的旧问题再写入，保证与结果一致） */
export async function replaceReviewIssues(
  jobId: number,
  userId: number,
  prNumber: number,
  repoFullName: string,
  issues: ReviewIssueInput[],
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.delete(reviewIssue).where(eq(reviewIssue.jobId, jobId));
  if (!issues.length) return;
  await db.insert(reviewIssue).values(
    issues.map((it) => ({
      ownerId: userId,
      jobId,
      prNumber,
      repoFullName,
      kind: it.kind,
      severity: it.severity ?? null,
      title: it.title,
      description: it.description ?? null,
      file: it.file ?? null,
      line: it.line ?? null,
      code: it.code ?? null,
      suggestion: it.suggestion ?? null,
      confidence: it.confidence ?? null,
      category: it.category ?? null,
    })),
  );
}

/** 审查队列：该用户最近的一次审查 Job（同一 PR 保留最新一次） */
export async function listReviewJobs(
  userId: number,
  platform: OAuthProvider,
  limit = 30,
): Promise<ReviewJobResult[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(aiReviewJob)
    .where(and(eq(aiReviewJob.ownerId, userId), eq(aiReviewJob.platform, platform)))
    .orderBy(desc(aiReviewJob.id))
    .limit(limit);
  return rows.map(mapJob);
}

/**
 * 待审队列：仅返回「已分析完成（status='COMPLETED'）且尚未处理（decision='PENDING'）」的审查。
 * 过滤掉：分析中的任务（避免详情尚未生成时点击落空）+ 已处理过的审查。
 */
export async function listPendingReviewJobs(
  userId: number,
  platform: OAuthProvider,
  limit = 30,
): Promise<ReviewJobResult[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(aiReviewJob)
    .where(
      and(
        eq(aiReviewJob.ownerId, userId),
        eq(aiReviewJob.platform, platform),
        eq(aiReviewJob.status, "COMPLETED"),
        eq(aiReviewJob.decision, "PENDING"),
      ),
    )
    .orderBy(desc(aiReviewJob.id))
    .limit(limit);
  return rows.map(mapJob);
}

/** 单次审查 Job 详情（含完整结果） */
export async function getReviewJob(userId: number, jobId: number): Promise<ReviewJobResult | null> {
  const db = getDb();
  if (!db) return null;
  const [r] = await db
    .select()
    .from(aiReviewJob)
    .where(and(eq(aiReviewJob.ownerId, userId), eq(aiReviewJob.id, jobId)))
    .limit(1);
  if (!r) return null;
  return mapJob(r);
}

/** 删除一次审查 Job 及其关联问题（审查历史删除） */
export async function deleteReviewJob(userId: number, jobId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .delete(reviewIssue)
    .where(and(eq(reviewIssue.ownerId, userId), eq(reviewIssue.jobId, jobId)));
  await db
    .delete(aiReviewJob)
    .where(and(eq(aiReviewJob.ownerId, userId), eq(aiReviewJob.id, jobId)));
}

/** 用户决策（批准 / 请求变更 / 已评论等） */
export async function updateReviewDecision(
  userId: number,
  jobId: number,
  decision: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(aiReviewJob)
    .set({ decision })
    .where(and(eq(aiReviewJob.ownerId, userId), eq(aiReviewJob.id, jobId)));
}

/** 某 Job 的问题列表（供采纳/忽略建议） */
export async function listReviewIssues(
  userId: number,
  jobId: number,
): Promise<{ id: number; kind: string; severity: string | null; title: string; description: string | null; file: string | null; line: number | null; code: string | null; suggestion: string | null; category: string | null; status: string; commentId: string | null }[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: reviewIssue.id,
      kind: reviewIssue.kind,
      severity: reviewIssue.severity,
      title: reviewIssue.title,
      description: reviewIssue.description,
      file: reviewIssue.file,
      line: reviewIssue.line,
      code: reviewIssue.code,
      suggestion: reviewIssue.suggestion,
      category: reviewIssue.category,
      status: reviewIssue.status,
      commentId: reviewIssue.commentId,
    })
    .from(reviewIssue)
    .where(and(eq(reviewIssue.ownerId, userId), eq(reviewIssue.jobId, jobId)))
    .orderBy(asc(reviewIssue.id));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity ?? null,
    title: r.title,
    description: r.description ?? null,
    file: r.file ?? null,
    line: r.line ?? null,
    code: r.code ?? null,
    suggestion: r.suggestion ?? null,
    category: r.category ?? null,
    status: r.status,
    commentId: r.commentId ?? null,
  }));
}

/** 采纳 / 忽略 / 取消（pending）某条建议；commentId 用于记录回写评论 id（undefined 不动，null 清空） */
export async function updateReviewIssueStatus(
  userId: number,
  issueId: number,
  status: "accepted" | "dismissed" | "pending",
  commentId?: string | null,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(reviewIssue)
    .set(commentId === undefined ? { status } : { status, commentId })
    .where(and(eq(reviewIssue.ownerId, userId), eq(reviewIssue.id, issueId)));
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── 站内通知（表结构见 docs/数据库设计.md §3.5） ──

/** 幂等建表：审查完成 / 待处理等通知 */
export async function ensureNotificationTables(): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.query(`CREATE TABLE IF NOT EXISTS notification (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED NOT NULL,
    type           VARCHAR(32) NOT NULL,
    title          VARCHAR(255) NOT NULL,
    body           VARCHAR(1024) DEFAULT NULL,
    link           VARCHAR(512) DEFAULT NULL,
    biz_type       VARCHAR(32) DEFAULT NULL,
    biz_id         VARCHAR(64) DEFAULT NULL,
    read_status    TINYINT NOT NULL DEFAULT 0,
    read_at        DATETIME DEFAULT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_read (user_id, read_status, created_at),
    KEY idx_type_time (type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // 历史表无 platform 列：补齐（空串视为「未标注平台」，按平台过滤时兼容显示）
  await ensureColumns(p, "notification", [
    { name: "platform", ddl: "platform VARCHAR(16) NOT NULL DEFAULT ''" },
  ]);
  // 幂等通知：同一 (用户, 业务类型, 业务id) 只保留一条
  // （防止同一 PR 的 opened/synchronize 等重复事件触发多次审查，产生重复通知）
  await ensureUniqueKey(p, "notification", "uk_user_biz", "user_id, biz_type, biz_id");
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
}

/** 写入一条通知；借助 (user_id,biz_type,biz_id) 唯一键幂等，重复返回 false（供调用方避免重复广播） */
export async function insertNotification(input: {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  bizType?: string | null;
  bizId?: string | null;
  platform?: string;
}): Promise<boolean> {
  const db = getDb();
  if (!db) return true;
  const res = await db
    .insert(notification)
    .ignore()
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      bizType: input.bizType ?? null,
      bizId: input.bizId ?? null,
      platform: input.platform ?? "",
    });
  const info = Array.isArray(res) ? res[0] : res;
  return Number((info as any)?.affectedRows ?? 0) > 0;
}

/** 通知列表（最新在前；仅当前平台，兼容无平台标注的历史数据） */
export async function listNotifications(
  userId: number,
  provider: OAuthProvider,
  limit = 30,
): Promise<NotificationItem[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      readStatus: notification.readStatus,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        sql`(${notification.platform} = ${provider} OR ${notification.platform} = '')`,
      ),
    )
    .orderBy(desc(notification.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    read: !!r.readStatus,
    createdAt: new Date(r.createdAt),
  }));
}

/** 未读数量（仅当前平台，兼容无平台标注的历史数据） */
export async function countUnreadNotifications(userId: number, provider: OAuthProvider): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [r] = await db
    .select({ n: count(notification.id) })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.readStatus, 0),
        sql`(${notification.platform} = ${provider} OR ${notification.platform} = '')`,
      ),
    );
  return Number(r?.n ?? 0);
}

/** 标记单条已读（仅当前平台） */
export async function markNotificationRead(userId: number, id: number, provider: OAuthProvider): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(notification)
    .set({ readStatus: 1, readAt: new Date() })
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.id, id),
        sql`(${notification.platform} = ${provider} OR ${notification.platform} = '')`,
      ),
    );
}

/** 全部标记已读（仅当前平台） */
export async function markAllNotificationsRead(userId: number, provider: OAuthProvider): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(notification)
    .set({ readStatus: 1, readAt: new Date() })
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.readStatus, 0),
        sql`(${notification.platform} = ${provider} OR ${notification.platform} = '')`,
      ),
    );
}

/** 删除单条通知（仅当前平台） */
export async function deleteNotification(userId: number, id: number, provider: OAuthProvider): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .delete(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.id, id),
        sql`(${notification.platform} = ${provider} OR ${notification.platform} = '')`,
      ),
    );
}

// ── 审查历史（ai_review_job 列表 + 统计，供 /history 页） ──

export interface ReviewHistoryItem {
  id: number;
  prNumber: number;
  repoFullName: string;
  prTitle: string | null;
  riskLevel: string | null;
  riskCount: number;
  suggestionCount: number;
  positiveCount: number;
  status: string;
  decision: string;
  depth: string | null;
  model: string | null;
  latencyMs: number | null;
  additions: number;
  deletions: number;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ReviewHistoryData {
  items: ReviewHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

function extractAddDel(resultJson: string | null): { additions: number; deletions: number } {
  if (!resultJson) return { additions: 0, deletions: 0 };
  try {
    const r = JSON.parse(resultJson) as { fileChanges?: { additions?: number; deletions?: number }[] };
    const files = r.fileChanges ?? [];
    return {
      additions: files.reduce((s, f) => s + (f.additions ?? 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions ?? 0), 0),
    };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

/** 审查历史分页查询（筛选：all|risky|suggestion|written；q：仓库/标题模糊搜索） */
export async function listReviewHistory(
  userId: number,
  platform: OAuthProvider,
  opts: { page: number; pageSize: number; filter?: string; q?: string },
): Promise<ReviewHistoryData> {
  const db = getDb();
  if (!db) return { items: [], total: 0, page: opts.page, pageSize: opts.pageSize };
  const conditions = [
    eq(aiReviewJob.ownerId, userId),
    eq(aiReviewJob.platform, platform),
  ];

  if (opts.filter === "risky") conditions.push(sql`${aiReviewJob.riskCount} > 0`);
  else if (opts.filter === "suggestion")
    conditions.push(sql`${aiReviewJob.riskCount} = 0 AND ${aiReviewJob.suggestionCount} > 0`);
  else if (opts.filter === "written")
    conditions.push(sql`${aiReviewJob.decision} != 'PENDING'`);
  if (opts.q) {
    conditions.push(
      sql`(${aiReviewJob.repoFullName} LIKE ${`%${opts.q}%`} OR ${aiReviewJob.prTitle} LIKE ${`%${opts.q}%`})`,
    );
  }
  const where = and(...conditions);
  const offset = Math.max(0, (opts.page - 1) * opts.pageSize);

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count(aiReviewJob.id) }).from(aiReviewJob).where(where),
    db
      .select({
        id: aiReviewJob.id,
        prNumber: aiReviewJob.prNumber,
        repoFullName: aiReviewJob.repoFullName,
        prTitle: aiReviewJob.prTitle,
        riskLevel: aiReviewJob.riskLevel,
        riskCount: aiReviewJob.riskCount,
        suggestionCount: aiReviewJob.suggestionCount,
        positiveCount: aiReviewJob.positiveCount,
        status: aiReviewJob.status,
        decision: aiReviewJob.decision,
        depth: aiReviewJob.depth,
        model: aiReviewJob.model,
        latencyMs: aiReviewJob.latencyMs,
        resultJson: aiReviewJob.resultJson,
        completedAt: aiReviewJob.completedAt,
        createdAt: aiReviewJob.createdAt,
      })
      .from(aiReviewJob)
      .where(where)
      .orderBy(desc(aiReviewJob.id))
      .limit(opts.pageSize)
      .offset(offset),
  ]);

  const items: ReviewHistoryItem[] = rows.map((r) => {
    const { additions, deletions } = extractAddDel(r.resultJson);
    return {
      id: r.id,
      prNumber: r.prNumber,
      repoFullName: r.repoFullName,
      prTitle: r.prTitle ?? null,
      riskLevel: r.riskLevel ?? null,
      riskCount: Number(r.riskCount ?? 0),
      suggestionCount: Number(r.suggestionCount ?? 0),
      positiveCount: Number(r.positiveCount ?? 0),
      status: r.status,
      decision: r.decision,
      depth: r.depth ?? null,
      model: r.model ?? null,
      latencyMs: r.latencyMs ?? null,
      additions,
      deletions,
      completedAt: r.completedAt ? new Date(r.completedAt) : null,
      createdAt: new Date(r.createdAt),
    };
  });

  return {
    items,
    total: Number(totalRows?.[0]?.n ?? 0),
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

/** 审查历史 KPI：累计审查 / 评论采纳率 / 平均耗时 / 一次通过率（低风险占比） */
export async function getReviewHistoryKpi(
  userId: number,
  platform: OAuthProvider,
): Promise<{ total: number; adoptRate: number; avgLatencyMs: number | null; passRate: number }> {
  const db = getDb();
  if (!db) return { total: 0, adoptRate: 0, avgLatencyMs: null, passRate: 0 };

  const [jobRows, issueRows] = await Promise.all([
    db
      .select({
        total: count(aiReviewJob.id),
        avgLat: sql<number>`AVG(${aiReviewJob.latencyMs})`,
        lowCount: sql<number>`SUM(${aiReviewJob.riskLevel} = 'low')`,
      })
      .from(aiReviewJob)
      .where(
        and(
          eq(aiReviewJob.ownerId, userId),
          eq(aiReviewJob.platform, platform),
          eq(aiReviewJob.status, "COMPLETED"),
        ),
      ),
    db
      .select({
        accepted: sql<number>`SUM(${reviewIssue.status} = 'accepted')`,
        total: count(reviewIssue.id),
      })
      .from(reviewIssue)
      .where(eq(reviewIssue.ownerId, userId)),
  ]);

  const j = jobRows?.[0] ?? { total: 0, avgLat: null, lowCount: 0 };
  const i = issueRows?.[0] ?? { accepted: 0, total: 0 };
  const total = Number(j.total ?? 0);
  const accepted = Number(i.accepted ?? 0);
  const issueTotal = Number(i.total ?? 0);
  return {
    total,
    adoptRate: issueTotal > 0 ? Math.round((accepted / issueTotal) * 100) : 0,
    avgLatencyMs: j.avgLat != null ? Math.round(Number(j.avgLat)) : null,
    passRate: total > 0 ? Math.round((Number(j.lowCount ?? 0) / total) * 100) : 0,
  };
}

// ── 用户/全局设置（KV 表，表结构见 docs/数据库设计.md §3.6） ──

/** 幂等建表：前端设置页 模型/温度/评论数/风险阈值/审查规则/仓库开关 */
export async function ensureSettingTables(): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.query(`CREATE TABLE IF NOT EXISTS user_setting (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       BIGINT UNSIGNED NOT NULL,
    setting_key   VARCHAR(64) NOT NULL,
    setting_value VARCHAR(1024) NOT NULL,
    remark        VARCHAR(255) DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_key (user_id, setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/** 读取一个设置（无则返回 null） */
export async function getSetting(userId: number, key: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [r] = await db
    .select({ settingValue: userSetting.settingValue })
    .from(userSetting)
    .where(and(eq(userSetting.userId, userId), eq(userSetting.settingKey, key)))
    .limit(1);
  return r?.settingValue ?? null;
}

/** 读取一个 JSON 设置（解析失败返回 null） */
export async function getSettingJson<T>(userId: number, key: string): Promise<T | null> {
  const raw = await getSetting(userId, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 写入一个设置（幂等 upsert） */
export async function setSetting(userId: number, key: string, value: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(userSetting)
    .values({ userId, settingKey: key, settingValue: value })
    .onDuplicateKeyUpdate({ set: { settingValue: sql`values(setting_value)` } });
}

/** 控制台审查洞察：累计审查 / 检出问题 / 待处理 / 一次通过率（无风险 PR 占比） */
export async function getReviewStats(
  userId: number,
  platform: OAuthProvider,
): Promise<{ totalReviews: number; riskyReviews: number; totalRisks: number; pendingReviews: number; passRate: number }> {
  const db = getDb();
  if (!db) return { totalReviews: 0, riskyReviews: 0, totalRisks: 0, pendingReviews: 0, passRate: 0 };
  const [r] = await db
    .select({
      total: count(aiReviewJob.id),
      risky: sql<number>`SUM(${aiReviewJob.riskCount} > 0)`,
      risks: sql<number>`SUM(${aiReviewJob.riskCount})`,
      pending: sql<number>`SUM(${aiReviewJob.decision} = 'PENDING')`,
    })
    .from(aiReviewJob)
    .where(
      and(
        eq(aiReviewJob.ownerId, userId),
        eq(aiReviewJob.platform, platform),
        eq(aiReviewJob.status, "COMPLETED"),
      ),
    );
  const total = Number(r?.total ?? 0);
  const risky = Number(r?.risky ?? 0);
  return {
    totalReviews: total,
    riskyReviews: risky,
    totalRisks: Number(r?.risks ?? 0),
    pendingReviews: Number(r?.pending ?? 0),
    passRate: total > 0 ? Math.round(((total - risky) / total) * 100) : 0,
  };
}