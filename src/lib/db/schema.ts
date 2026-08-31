import {
  mysqlTable,
  bigint,
  varchar,
  tinyint,
  text,
  mediumtext,
  longtext,
  datetime,
  int,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/**
 * PR Review 平台业务库（MySQL）表结构定义（Drizzle ORM）。
 * 与 docs/数据库设计.md 中的 DDL 保持一致。
 *
 * 说明：
 * - 仅用于提供「类型安全的查询」与「一致的表名/列名」，建表仍由 ensure* 幂等迁移函数执行。
 * - user / github_installation / contribution_summary 这三张表的 DDL 在外部初始化（代码内不建表），
 *   此处仍定义 schema，保证读写走类型化 API。
 */

/** 平台用户（一个登录身份；provider+provider_user_id 唯一） */
export const user = mysqlTable(
  "user",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    provider: varchar("provider", { length: 16 }).notNull(),
    providerUserId: varchar("provider_user_id", { length: 64 }).notNull(),
    login: varchar("login", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    email: varchar("email", { length: 128 }),
    avatarUrl: varchar("avatar_url", { length: 512 }),
    accessTokenEnc: varchar("access_token_enc", { length: 512 }),
    refreshTokenEnc: varchar("refresh_token_enc", { length: 512 }),
    tokenExpiresAt: datetime("token_expires_at"),
    scopes: varchar("scopes", { length: 512 }),
    role: tinyint("role").notNull().default(1),
    status: tinyint("status").notNull().default(1),
    lastLoginAt: datetime("last_login_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_provider_uid").on(t.provider, t.providerUserId),
    uniqueIndex("uk_provider_login").on(t.provider, t.login),
    index("idx_status_created").on(t.status, t.createdAt),
  ],
);

/** GitHub App 安装信息 */
export const githubInstallation = mysqlTable(
  "github_installation",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: varchar("account_login", { length: 64 }).notNull(),
    accountType: varchar("account_type", { length: 16 }).notNull(),
    appId: varchar("app_id", { length: 64 }),
    permissions: text("permissions"),
    repositorySelection: varchar("repository_selection", { length: 32 }).default("selected"),
    status: tinyint("status").notNull().default(1),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_installation").on(t.installationId),
    index("idx_user_id").on(t.userId),
  ],
);

/** 开发者贡献日聚合（热力图） */
export const contributionSummary = mysqlTable(
  "contribution_summary",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    statDate: date("stat_date").notNull(),
    commits: int("commits").notNull().default(0),
    prsCreated: int("prs_created").notNull().default(0),
    reviews: int("reviews").notNull().default(0),
    issuesCreated: int("issues_created").notNull().default(0),
    aiReviews: int("ai_reviews").notNull().default(0),
    aiIssues: int("ai_issues").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_user_date").on(t.userId, t.statDate),
    index("idx_date").on(t.statDate),
  ],
);

/** Webhook 端点订阅配置（owner+platform 全局唯一） */
export const webhookSubscription = mysqlTable(
  "webhook_subscription",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    repositoryId: bigint("repository_id", { mode: "number" }),
    events: varchar("events", { length: 1024 }).notNull(),
    secretEnc: varchar("secret_enc", { length: 512 }),
    url: varchar("url", { length: 512 }),
    enabled: tinyint("enabled").notNull().default(1),
    verifySsl: tinyint("verify_ssl").notNull().default(1),
    rulesJson: text("rules_json"),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_owner_platform").on(t.ownerId, t.platform),
    index("idx_owner_platform").on(t.ownerId, t.platform, t.enabled),
  ],
);

/** Webhook 事件日志 */
export const webhookEvent = mysqlTable(
  "webhook_event",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }),
    platform: varchar("platform", { length: 16 }).notNull(),
    deliveryId: varchar("delivery_id", { length: 64 }).notNull(),
    eventName: varchar("event_name", { length: 64 }).notNull(),
    action: varchar("action", { length: 32 }),
    repositoryId: bigint("repository_id", { mode: "number" }),
    prNumber: int("pr_number"),
    payload: text("payload"),
    validSignature: tinyint("valid_signature").notNull().default(1),
    httpStatus: int("http_status"),
    queueStatus: varchar("queue_status", { length: 16 }).notNull().default("PENDING"),
    retryCount: int("retry_count").notNull().default(0),
    receivedAt: datetime("received_at"),
    processedAt: datetime("processed_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_delivery").on(t.platform, t.deliveryId),
    index("idx_queue").on(t.queueStatus, t.retryCount),
    index("idx_event_time").on(t.eventName, t.createdAt),
    index("idx_owner_time").on(t.ownerId, t.createdAt),
  ],
);

/** AI 审查 Job */
export const aiReviewJob = mysqlTable(
  "ai_review_job",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull().default("github"),
    prNumber: int("pr_number").notNull(),
    repoFullName: varchar("repo_full_name", { length: 255 }).notNull(),
    prTitle: varchar("pr_title", { length: 255 }),
    commitSha: varchar("commit_sha", { length: 40 }).notNull(),
    triggerSource: varchar("trigger_source", { length: 16 }).notNull().default("webhook"),
    provider: varchar("provider", { length: 32 }),
    model: varchar("model", { length: 64 }),
    depth: varchar("depth", { length: 16 }).default("standard"),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    decision: varchar("decision", { length: 16 }).notNull().default("PENDING"),
    summary: mediumtext("summary"),
    riskLevel: varchar("risk_level", { length: 16 }),
    riskCount: int("risk_count").notNull().default(0),
    suggestionCount: int("suggestion_count").notNull().default(0),
    positiveCount: int("positive_count").notNull().default(0),
    latencyMs: int("latency_ms"),
    inputTokens: int("input_tokens"),
    outputTokens: int("output_tokens"),
    resultJson: longtext("result_json"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 512 }),
    startedAt: datetime("started_at"),
    completedAt: datetime("completed_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_owner_pr_sha").on(t.ownerId, t.prNumber, t.commitSha),
    index("idx_owner_status").on(t.ownerId, t.status, t.createdAt),
    index("idx_owner_created").on(t.ownerId, t.createdAt),
  ],
);

/** 审查问题/评论（关联 ai_review_job） */
export const reviewIssue = mysqlTable(
  "review_issue",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    jobId: bigint("job_id", { mode: "number" }).notNull(),
    prNumber: int("pr_number").notNull(),
    repoFullName: varchar("repo_full_name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    severity: varchar("severity", { length: 16 }),
    title: varchar("title", { length: 255 }).notNull(),
    description: mediumtext("description"),
    file: varchar("file", { length: 255 }),
    line: int("line"),
    code: mediumtext("code"),
    suggestion: mediumtext("suggestion"),
    confidence: varchar("confidence", { length: 16 }),
    category: varchar("category", { length: 32 }),
    source: varchar("source", { length: 16 }).notNull().default("ai"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    commentId: varchar("comment_id", { length: 64 }),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [
    index("idx_job").on(t.jobId),
    index("idx_owner_pr").on(t.ownerId, t.prNumber, t.createdAt),
    index("idx_kind_severity").on(t.kind, t.severity),
  ],
);

/** 站内通知 */
export const notification = mysqlTable(
  "notification",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: varchar("body", { length: 1024 }),
    link: varchar("link", { length: 512 }),
    bizType: varchar("biz_type", { length: 32 }),
    bizId: varchar("biz_id", { length: 64 }),
    platform: varchar("platform", { length: 16 }).notNull().default(""),
    readStatus: tinyint("read_status").notNull().default(0),
    readAt: datetime("read_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_user_biz").on(t.userId, t.bizType, t.bizId),
    index("idx_user_read").on(t.userId, t.readStatus, t.createdAt),
    index("idx_type_time").on(t.type, t.createdAt),
  ],
);

/** 用户/全局设置（KV） */
export const userSetting = mysqlTable(
  "user_setting",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    settingKey: varchar("setting_key", { length: 64 }).notNull(),
    settingValue: varchar("setting_value", { length: 1024 }).notNull(),
    remark: varchar("remark", { length: 255 }),
    createdAt: datetime("created_at").notNull().default(new Date()),
    updatedAt: datetime("updated_at").notNull().default(new Date()),
  },
  (t) => [uniqueIndex("uk_user_key").on(t.userId, t.settingKey)],
);

export const schema = {
  user,
  githubInstallation,
  contributionSummary,
  webhookSubscription,
  webhookEvent,
  aiReviewJob,
  reviewIssue,
  notification,
  userSetting,
};

export type Schema = typeof schema;