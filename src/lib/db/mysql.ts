import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { AUTH } from "@/lib/auth/config";
import type { OAuthProvider } from "@/lib/auth/jwt";

/**
 * PR Review 平台业务库（MySQL，见《数据库设计》）
 * 这里只负责登录落库：把登录身份 upsert 到 prreview_db.user，并加密保存平台 token。
 * 使用 PR_MYSQL_URL；未配置时静默跳过（不阻断登录），便于本地/原型运行。
 */
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool | null {
  if (!process.env.PR_MYSQL_URL) return null;
  if (!pool) {
    pool = mysql.createPool({
      uri: process.env.PR_MYSQL_URL,
      connectionLimit: 5,
      waitForConnections: true,
      namedPlaceholders: true,
    });
  }
  return pool;
}

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
  const p = getPool();
  if (!p) return;

  const accessEnc = u.accessToken ? encryptToken(u.accessToken) : null;
  const now = new Date();

  await p.execute(
    `INSERT INTO \`user\`
      (provider, provider_user_id, login, display_name, email, avatar_url,
       access_token_enc, scopes, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       login = VALUES(login),
       display_name = VALUES(display_name),
       email = VALUES(email),
       avatar_url = VALUES(avatar_url),
       access_token_enc = VALUES(access_token_enc),
       scopes = VALUES(scopes),
       last_login_at = VALUES(last_login_at),
       updated_at = VALUES(updated_at)`,
    [
      u.provider,
      u.providerUserId,
      u.login,
      u.name,
      u.email ?? null,
      u.avatar,
      accessEnc,
      u.scopes ?? null,
      now,
      now,
      now,
    ],
  );
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** 按登录身份取平台用户（用于拿解密 token 调 GitHub API） */
export async function getPlatformUser(
  provider: OAuthProvider,
  providerUserId: string,
): Promise<{ id: number; login: string; accessTokenEnc?: string | null } | null> {
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<any>(
    `SELECT id, provider, provider_user_id, login, access_token_enc FROM \`user\` WHERE provider=? AND provider_user_id=? LIMIT 1`,
    [provider, providerUserId],
  );
  const r = rows?.[0];
  if (!r) return null;
  return { id: r.id, login: r.login, accessTokenEnc: r.access_token_enc ?? null };
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
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<any>(
    `SELECT id, provider, provider_user_id, login, access_token_enc FROM \`user\` WHERE id=? LIMIT 1`,
    [userId],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    id: r.id,
    provider: r.provider as OAuthProvider,
    providerUserId: r.provider_user_id,
    login: r.login,
    accessTokenEnc: r.access_token_enc ?? null,
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
  const p = getPool();
  if (!p) return;
  await p.execute(
    `INSERT INTO github_installation
      (user_id, installation_id, account_login, account_type, app_id, permissions, repository_selection, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       account_login = VALUES(account_login),
       account_type = VALUES(account_type),
       app_id = VALUES(app_id),
       permissions = VALUES(permissions),
       repository_selection = VALUES(repository_selection),
       status = 1`,
    [
      input.userId,
      input.installationId,
      input.accountLogin,
      input.accountType,
      input.appId ?? null,
      input.permissions ? JSON.stringify(input.permissions) : null,
      input.repositorySelection ?? null,
    ],
  );
}

/** upsert 某用户某天的贡献数到 contribution_summary（供热力图/统计持久化与读取） */
export async function upsertContributionDay(
  userId: number,
  provider: OAuthProvider,
  date: string, // YYYY-MM-DD
  commits: number,
): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `INSERT INTO contribution_summary (user_id, stat_date, commits, created_at, updated_at)
     VALUES (?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       commits = VALUES(commits),
       updated_at = NOW()`,
    [userId, date, commits],
  );
}

/** 读取某用户某天起（区间）的贡献，用于渲染热力图 */
export async function getContributionsByUser(
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; commits: number }[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT stat_date, commits FROM contribution_summary
     WHERE user_id = ? AND stat_date BETWEEN ? AND ? AND commits > 0`,
    [userId, fromDate, toDate],
  );
  return (rows || []).map((r: any) => ({ date: r.stat_date, commits: r.commits }));
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
  p: mysql.Pool,
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
  p: mysql.Pool,
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
  p: mysql.Pool,
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
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<any>(
    `SELECT id, owner_id, platform, events, secret_enc, url, enabled, verify_ssl, rules_json
     FROM webhook_subscription
     WHERE owner_id = ? AND platform = ? AND repository_id IS NULL
     ORDER BY id DESC LIMIT 1`,
    [userId, provider],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.owner_id,
    platform: r.platform as OAuthProvider,
    events: (r.events || "").split(",").filter(Boolean),
    secret: r.secret_enc ? decryptToken(r.secret_enc) : null,
    url: r.url ?? null,
    enabled: !!r.enabled,
    verifySsl: !!r.verify_ssl,
    rules: parseRulesJson(r.rules_json),
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
  const p = getPool();
  if (!p) return;
  const secretEnc = input.secret ? encryptToken(input.secret) : null;
  await p.execute(
    `INSERT INTO webhook_subscription
      (owner_id, platform, events, secret_enc, url, enabled, verify_ssl, rules_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       events = VALUES(events),
       url = VALUES(url),
       enabled = VALUES(enabled),
       verify_ssl = VALUES(verify_ssl),
       rules_json = VALUES(rules_json),
       secret_enc = IF(VALUES(secret_enc) IS NOT NULL, VALUES(secret_enc), secret_enc)`,
    [
      input.userId,
      input.provider,
      input.events.join(","),
      secretEnc,
      input.url ?? null,
      input.enabled ? 1 : 0,
      input.verifySsl === undefined ? 1 : input.verifySsl ? 1 : 0,
      JSON.stringify(input.rules),
    ],
  );
}

/** 接收端点用：该平台所有启用的全局端点 secret（解密后），用于逐一验签 */
export async function listWebhookSecrets(
  provider: OAuthProvider,
): Promise<{ ownerId: number; secret: string; events: string[] }[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT owner_id, secret_enc, events FROM webhook_subscription
     WHERE platform = ? AND repository_id IS NULL AND enabled = 1 AND secret_enc IS NOT NULL`,
    [provider],
  );
  return (rows || [])
    .map((r: any) => ({
      ownerId: r.owner_id,
      secret: decryptToken(r.secret_enc),
      events: Array.isArray(r.events) ? r.events : r.events ? String(r.events).split(",") : [],
    }))
    .filter((x: { secret: string | null }) => !!x.secret) as { ownerId: number; secret: string; events: string[] }[];
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
  const p = getPool();
  if (!p) return true;
  const [result] = await p.execute(
    `INSERT IGNORE INTO webhook_event
      (owner_id, platform, delivery_id, event_name, action, pr_number, payload,
       valid_signature, http_status, queue_status, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerId ?? null,
      input.provider,
      input.deliveryId,
      input.eventName,
      input.action ?? null,
      input.prNumber ?? null,
      input.payload !== undefined ? JSON.stringify(input.payload) : null,
      input.validSignature === false ? 0 : 1,
      input.httpStatus ?? null,
      input.queueStatus ?? "PENDING",
      input.receivedAt ?? new Date(),
    ],
  );
  return (result as mysql.ResultSetHeader).affectedRows > 0;
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
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT id, event_name, action, pr_number, delivery_id, valid_signature, http_status, created_at,
       JSON_UNQUOTE(JSON_EXTRACT(payload, '$.repository.full_name')) AS repository
     FROM webhook_event
     WHERE owner_id = ? AND platform = ?
     ORDER BY id DESC LIMIT ?`,
    [userId, provider, limit],
  );
  return (rows || []).map((r: any) => ({
    id: r.id,
    event: r.event_name,
    action: r.action ?? null,
    prNumber: r.pr_number ?? null,
    repository: r.repository || null,
    deliveryId: r.delivery_id,
    validSignature: !!r.valid_signature,
    httpStatus: r.http_status ?? null,
    createdAt: new Date(r.created_at),
  }));
}

/** 端点卡片统计：触发总数 / 验签通过率 / 最近触发时间 */
export async function getWebhookStats(
  userId: number,
  provider: OAuthProvider,
): Promise<{ total: number; validRate: number; lastReceivedAt: Date | null }> {
  const p = getPool();
  if (!p) return { total: 0, validRate: 1, lastReceivedAt: null };
  const [rows] = await p.query<any>(
    `SELECT
       COUNT(*) AS total,
       SUM(valid_signature = 1) AS valid,
       MAX(created_at) AS last
     FROM webhook_event WHERE owner_id = ? AND platform = ?`,
    [userId, provider],
  );
  const r = rows?.[0];
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
  const p = getPool();
  if (!p) return null;
  await p.execute(
    `INSERT INTO ai_review_job
      (owner_id, platform, pr_number, repo_full_name, pr_title, commit_sha, trigger_source,
       provider, model, depth, status, decision, summary, risk_level, risk_count,
       suggestion_count, positive_count, latency_ms, input_tokens, output_tokens,
       result_json, error_code, error_message, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform), repo_full_name = VALUES(repo_full_name),
       pr_title = VALUES(pr_title), trigger_source = VALUES(trigger_source),
       provider = VALUES(provider), model = VALUES(model), depth = VALUES(depth),
       status = VALUES(status), summary = VALUES(summary), risk_level = VALUES(risk_level),
       risk_count = VALUES(risk_count), suggestion_count = VALUES(suggestion_count),
       positive_count = VALUES(positive_count), latency_ms = VALUES(latency_ms),
       input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens),
       result_json = VALUES(result_json), error_code = VALUES(error_code),
       error_message = VALUES(error_message), completed_at = VALUES(completed_at)`,
    [
      input.userId,
      input.platform,
      input.prNumber,
      input.repoFullName,
      input.prTitle ?? null,
      input.commitSha,
      input.triggerSource ?? "webhook",
      input.provider ?? null,
      input.model ?? null,
      input.depth ?? "standard",
      input.status,
      input.decision ?? "PENDING",
      input.summary ?? null,
      input.riskLevel ?? null,
      input.riskCount ?? 0,
      input.suggestionCount ?? 0,
      input.positiveCount ?? 0,
      input.latencyMs ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.resultJson ? JSON.stringify(input.resultJson) : null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.completedAt ?? new Date(),
    ],
  );
  // 返回 job id（幂等 upsert 后取该 pr+sha 的记录）
  const [rows] = await p.query<any>(
    `SELECT id FROM ai_review_job WHERE owner_id=? AND pr_number=? AND commit_sha=? LIMIT 1`,
    [input.userId, input.prNumber, input.commitSha],
  );
  return rows?.[0]?.id ?? null;
}

/** 写入审查问题/评论（先清空该 job 的旧问题再写入，保证与结果一致） */
export async function replaceReviewIssues(
  jobId: number,
  userId: number,
  prNumber: number,
  repoFullName: string,
  issues: ReviewIssueInput[],
): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(`DELETE FROM review_issue WHERE job_id=?`, [jobId]);
  if (!issues.length) return;
  const values: Array<string | number | null> = [];
  // 每个 issue 按列顺序推入全部 14 个值（owner_id, job_id, pr_number, repo_full_name, kind, severity, title, description, file, line, code, suggestion, confidence, category）
  const placeholders = issues
    .map((it) => {
      values.push(
        userId,
        jobId,
        prNumber,
        repoFullName,
        it.kind,
        it.severity ?? null,
        it.title,
        it.description ?? null,
        it.file ?? null,
        it.line ?? null,
        it.code ?? null,
        it.suggestion ?? null,
        it.confidence ?? null,
        it.category ?? null,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    })
    .join(",");
  await p.execute(
    `INSERT INTO review_issue
      (owner_id, job_id, pr_number, repo_full_name, kind, severity, title, description,
       file, line, code, suggestion, confidence, category)
     VALUES ${placeholders}`,
    values,
  );
}

/** 审查队列：该用户最近的一次审查 Job（同一 PR 保留最新一次） */
export async function listReviewJobs(
  userId: number,
  platform: OAuthProvider,
  limit = 30,
): Promise<ReviewJobResult[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT id, pr_number, repo_full_name, pr_title, commit_sha, status, decision, summary,
            risk_level, risk_count, suggestion_count, positive_count, model, provider, depth,
            latency_ms, result_json, completed_at, created_at
     FROM ai_review_job
     WHERE owner_id = ? AND platform = ?
     ORDER BY id DESC LIMIT ?`,
    [userId, platform, limit],
  );
  return (rows || []).map((r: any) => ({
    id: r.id,
    prNumber: r.pr_number,
    repoFullName: r.repo_full_name,
    prTitle: r.pr_title ?? null,
    commitSha: r.commit_sha,
    status: r.status,
    decision: r.decision,
    summary: r.summary ?? null,
    riskLevel: r.risk_level ?? null,
    riskCount: Number(r.risk_count ?? 0),
    suggestionCount: Number(r.suggestion_count ?? 0),
    positiveCount: Number(r.positive_count ?? 0),
    model: r.model ?? null,
    provider: r.provider ?? null,
    depth: r.depth ?? null,
    latencyMs: r.latency_ms ?? null,
    result: r.result_json ? safeParseJson(r.result_json) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    createdAt: new Date(r.created_at),
  }));
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
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT id, pr_number, repo_full_name, pr_title, commit_sha, status, decision, summary,
            risk_level, risk_count, suggestion_count, positive_count, model, provider, depth,
            latency_ms, result_json, completed_at, created_at
     FROM ai_review_job
     WHERE owner_id = ? AND platform = ? AND status = 'COMPLETED' AND decision = 'PENDING'
     ORDER BY id DESC LIMIT ?`,
    [userId, platform, limit],
  );
  return (rows || []).map((r: any) => ({
    id: r.id,
    prNumber: r.pr_number,
    repoFullName: r.repo_full_name,
    prTitle: r.pr_title ?? null,
    commitSha: r.commit_sha,
    status: r.status,
    decision: r.decision,
    summary: r.summary ?? null,
    riskLevel: r.risk_level ?? null,
    riskCount: Number(r.risk_count ?? 0),
    suggestionCount: Number(r.suggestion_count ?? 0),
    positiveCount: Number(r.positive_count ?? 0),
    model: r.model ?? null,
    provider: r.provider ?? null,
    depth: r.depth ?? null,
    latencyMs: r.latency_ms ?? null,
    result: r.result_json ? safeParseJson(r.result_json) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    createdAt: new Date(r.created_at),
  }));
}

/** 单次审查 Job 详情（含完整结果） */
export async function getReviewJob(userId: number, jobId: number): Promise<ReviewJobResult | null> {
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<any>(
    `SELECT id, pr_number, repo_full_name, pr_title, commit_sha, status, decision, summary,
            risk_level, risk_count, suggestion_count, positive_count, model, provider, depth,
            latency_ms, result_json, completed_at, created_at
     FROM ai_review_job WHERE owner_id=? AND id=? LIMIT 1`,
    [userId, jobId],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    id: r.id,
    prNumber: r.pr_number,
    repoFullName: r.repo_full_name,
    prTitle: r.pr_title ?? null,
    commitSha: r.commit_sha,
    status: r.status,
    decision: r.decision,
    summary: r.summary ?? null,
    riskLevel: r.risk_level ?? null,
    riskCount: Number(r.risk_count ?? 0),
    suggestionCount: Number(r.suggestion_count ?? 0),
    positiveCount: Number(r.positive_count ?? 0),
    model: r.model ?? null,
    provider: r.provider ?? null,
    depth: r.depth ?? null,
    latencyMs: r.latency_ms ?? null,
    result: r.result_json ? safeParseJson(r.result_json) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    createdAt: new Date(r.created_at),
  };
}

/** 删除一次审查 Job 及其关联问题（审查历史删除） */
export async function deleteReviewJob(userId: number, jobId: number): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(`DELETE FROM review_issue WHERE owner_id = ? AND job_id = ?`, [userId, jobId]);
  await p.execute(`DELETE FROM ai_review_job WHERE owner_id = ? AND id = ?`, [userId, jobId]);
}

/** 用户决策（批准 / 请求变更 / 已评论等） */
export async function updateReviewDecision(
  userId: number,
  jobId: number,
  decision: string,
): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `UPDATE ai_review_job SET decision=? WHERE owner_id=? AND id=?`,
    [decision, userId, jobId],
  );
}

/** 某 Job 的问题列表（供采纳/忽略建议） */
export async function listReviewIssues(
  userId: number,
  jobId: number,
): Promise<{ id: number; kind: string; severity: string | null; title: string; description: string | null; file: string | null; line: number | null; code: string | null; suggestion: string | null; category: string | null; status: string; commentId: string | null }[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT id, kind, severity, title, description, file, line, code, suggestion, category, status, comment_id
     FROM review_issue WHERE owner_id=? AND job_id=? ORDER BY id`,
    [userId, jobId],
  );
  return (rows || []).map((r: any) => ({
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
    commentId: r.comment_id ?? null,
  }));
}

/** 采纳 / 忽略 / 取消（pending）某条建议；commentId 用于记录回写评论 id（undefined 不动，null 清空） */
export async function updateReviewIssueStatus(
  userId: number,
  issueId: number,
  status: "accepted" | "dismissed" | "pending",
  commentId?: string | null,
): Promise<void> {
  const p = getPool();
  if (!p) return;
  if (commentId === undefined) {
    await p.execute(
      `UPDATE review_issue SET status=? WHERE owner_id=? AND id=?`,
      [status, userId, issueId],
    );
  } else {
    await p.execute(
      `UPDATE review_issue SET status=?, comment_id=? WHERE owner_id=? AND id=?`,
      [status, commentId, userId, issueId],
    );
  }
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
  const p = getPool();
  if (!p) return true;
  const [result] = await p.execute(
    `INSERT IGNORE INTO notification (user_id, type, title, body, link, biz_type, biz_id, platform)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.type,
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.bizType ?? null,
      input.bizId ?? null,
      input.platform ?? "",
    ],
  );
  return (result as mysql.ResultSetHeader).affectedRows > 0;
}

/** 通知列表（最新在前；仅当前平台，兼容无平台标注的历史数据） */
export async function listNotifications(
  userId: number,
  provider: OAuthProvider,
  limit = 30,
): Promise<NotificationItem[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<any>(
    `SELECT id, type, title, body, link, read_status, created_at
     FROM notification WHERE user_id = ? AND (platform = ? OR platform = '')
     ORDER BY id DESC LIMIT ?`,
    [userId, provider, limit],
  );
  return (rows || []).map((r: any) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    read: !!r.read_status,
    createdAt: new Date(r.created_at),
  }));
}

/** 未读数量（仅当前平台，兼容无平台标注的历史数据） */
export async function countUnreadNotifications(userId: number, provider: OAuthProvider): Promise<number> {
  const p = getPool();
  if (!p) return 0;
  const [rows] = await p.query<any>(
    `SELECT COUNT(*) AS n FROM notification
     WHERE user_id = ? AND read_status = 0 AND (platform = ? OR platform = '')`,
    [userId, provider],
  );
  return Number(rows?.[0]?.n ?? 0);
}

/** 标记单条已读（仅当前平台） */
export async function markNotificationRead(userId: number, id: number, provider: OAuthProvider): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `UPDATE notification SET read_status = 1, read_at = NOW()
     WHERE user_id = ? AND id = ? AND (platform = ? OR platform = '')`,
    [userId, id, provider],
  );
}

/** 全部标记已读（仅当前平台） */
export async function markAllNotificationsRead(userId: number, provider: OAuthProvider): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `UPDATE notification SET read_status = 1, read_at = NOW()
     WHERE user_id = ? AND read_status = 0 AND (platform = ? OR platform = '')`,
    [userId, provider],
  );
}

/** 删除单条通知（仅当前平台） */
export async function deleteNotification(userId: number, id: number, provider: OAuthProvider): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `DELETE FROM notification WHERE user_id = ? AND id = ? AND (platform = ? OR platform = '')`,
    [userId, id, provider],
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
  const p = getPool();
  if (!p) return { items: [], total: 0, page: opts.page, pageSize: opts.pageSize };
  const where: string[] = ["owner_id = ?", "platform = ?"];
  const params: Array<string | number> = [userId, platform];

  if (opts.filter === "risky") where.push("risk_count > 0");
  else if (opts.filter === "suggestion") where.push("risk_count = 0 AND suggestion_count > 0");
  else if (opts.filter === "written") where.push("decision != 'PENDING'");
  if (opts.q) {
    where.push("(repo_full_name LIKE ? OR pr_title LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like);
  }
  const whereSql = where.join(" AND ");
  const offset = Math.max(0, (opts.page - 1) * opts.pageSize);

  const [[totalRows], [rows]] = await Promise.all([
    p.query<any>(`SELECT COUNT(*) AS n FROM ai_review_job WHERE ${whereSql}`, params),
    p.query<any>(
      `SELECT id, pr_number, repo_full_name, pr_title, risk_level, risk_count, suggestion_count,
              positive_count, status, decision, depth, model, latency_ms, result_json, completed_at, created_at
       FROM ai_review_job WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, opts.pageSize, offset],
    ),
  ]);

  const items: ReviewHistoryItem[] = (rows || []).map((r: any) => {
    const { additions, deletions } = extractAddDel(r.result_json);
    return {
      id: r.id,
      prNumber: r.pr_number,
      repoFullName: r.repo_full_name,
      prTitle: r.pr_title ?? null,
      riskLevel: r.risk_level ?? null,
      riskCount: Number(r.risk_count ?? 0),
      suggestionCount: Number(r.suggestion_count ?? 0),
      positiveCount: Number(r.positive_count ?? 0),
      status: r.status,
      decision: r.decision,
      depth: r.depth ?? null,
      model: r.model ?? null,
      latencyMs: r.latency_ms ?? null,
      additions,
      deletions,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      createdAt: new Date(r.created_at),
    };
  });

  return { items, total: Number(totalRows?.[0]?.n ?? 0), page: opts.page, pageSize: opts.pageSize };
}

/** 审查历史 KPI：累计审查 / 评论采纳率 / 平均耗时 / 一次通过率（低风险占比） */
export async function getReviewHistoryKpi(
  userId: number,
  platform: OAuthProvider,
): Promise<{ total: number; adoptRate: number; avgLatencyMs: number | null; passRate: number }> {
  const p = getPool();
  if (!p) return { total: 0, adoptRate: 0, avgLatencyMs: null, passRate: 0 };

  const [[jobRows], [issueRows]] = await Promise.all([
    p.query<any>(
      `SELECT COUNT(*) AS total, AVG(latency_ms) AS avg_lat,
              SUM(risk_level = 'low') AS low_count
       FROM ai_review_job WHERE owner_id = ? AND platform = ? AND status = 'COMPLETED'`,
      [userId, platform],
    ),
    p.query<any>(
      `SELECT
         SUM(status = 'accepted') AS accepted,
         COUNT(*) AS total
       FROM review_issue WHERE owner_id = ?`,
      [userId],
    ),
  ]);

  const j = jobRows?.[0] ?? {};
  const i = issueRows?.[0] ?? {};
  const total = Number(j.total ?? 0);
  const accepted = Number(i.accepted ?? 0);
  const issueTotal = Number(i.total ?? 0);
  return {
    total,
    adoptRate: issueTotal > 0 ? Math.round((accepted / issueTotal) * 100) : 0,
    avgLatencyMs: j.avg_lat != null ? Math.round(Number(j.avg_lat)) : null,
    passRate: total > 0 ? Math.round((Number(j.low_count ?? 0) / total) * 100) : 0,
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
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<any>(
    `SELECT setting_value FROM user_setting WHERE user_id=? AND setting_key=? LIMIT 1`,
    [userId, key],
  );
  return rows?.[0]?.setting_value ?? null;
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
  const p = getPool();
  if (!p) return;
  await p.execute(
    `INSERT INTO user_setting (user_id, setting_key, setting_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [userId, key, value],
  );
}

/** 控制台审查洞察：累计审查 / 检出问题 / 待处理 / 一次通过率（无风险 PR 占比） */
export async function getReviewStats(
  userId: number,
  platform: OAuthProvider,
): Promise<{ totalReviews: number; riskyReviews: number; totalRisks: number; pendingReviews: number; passRate: number }> {
  const p = getPool();
  if (!p) return { totalReviews: 0, riskyReviews: 0, totalRisks: 0, pendingReviews: 0, passRate: 0 };
  const [rows] = await p.query<any>(
    `SELECT COUNT(*) AS total, SUM(risk_count > 0) AS risky, SUM(risk_count) AS risks,
            SUM(decision = 'PENDING') AS pending
     FROM ai_review_job WHERE owner_id = ? AND platform = ? AND status = 'COMPLETED'`,
    [userId, platform],
  );
  const r = rows?.[0] ?? {};
  const total = Number(r.total ?? 0);
  const risky = Number(r.risky ?? 0);
  return {
    totalReviews: total,
    riskyReviews: risky,
    totalRisks: Number(r.risks ?? 0),
    pendingReviews: Number(r.pending ?? 0),
    passRate: total > 0 ? Math.round(((total - risky) / total) * 100) : 0,
  };
}