# AI-PR-Review 平台重构规划方案

> 目标：将当前「手动粘贴 PR 分析」的 Next.js 应用，重构为一个完整的 **PR Review 云平台**。
> 用户链路：`GitHub/Gitee 授权登录 → 用户画像与提交活跃度 → 仓库列表与在线代码浏览 → PR 变更自动 AI 审查评论`。

## 1. 现状分析

| 维度 | 现状 | 问题 |
|------|------|------|
| 授权 | 无账号体系，手动填 GitHub Token | 门槛高，无法获取用户级活跃度 |
| 入口 | 粘贴单个 PR URL 分析 | 只能"一次性分析"，非持续平台 |
| 数据 | 单次分析瞬态结果，存本地/内存 | 无仓库、PR、历史记录聚合 |
| 自动化 | 无 | PR 变更无法自动触发审查 |
| 前端 | 单页 App + 常规深色模板 | 视觉模板化，缺少多页面信息架构 |

现有可复用资产：`src/lib`（GitHub 客户端、AI 模型路由/提供方、提示词、上下文/缓存）、`prisma/schema.prisma`、shadcn/ui 组件库、`src/lib/analysis-store.ts`。

## 2. 目标信息架构（页面地图）

```
/public                    # 落地页（营销 + 登录入口）
/login                    # 授权登录（GitHub / Gitee 双 OAuth）
/dashboard                # 控制台：用户画像 + 提交活跃度 + 待审 PR
/account                  # 个人资料 / 账户设置
/repos                    # 仓库列表（来源：GitHub + Gitee 聚合）
/repos/[owner]/[repo]     # 仓库详情：分支、README、代码文件浏览
/repos/[owner]/[repo]/tree/[branch]/[path]  # 代码文件 + 语法高亮 + 单文件历史
/repos/[owner]/[repo]/pulls             # 该仓库的 PR 列表
/pulls/[number]           # PR 详情：概览 + AI 自动审查结果
/repos/[owner]/[repo]/settings          # 仓库级设置（自动审查开关、模型、规则）
/settings                 # 全局设置（模型、通知、审查规则）
/webhooks                 # 自动化：Webhook / 定时扫描配置
```

### 页面要点
- `dashboard`：Commit 热力图、提交趋势、语言占比、Top 仓库、待审查 PR 队列。
- 代码浏览：文件树、分支切换、语法高亮、可点击行内 diff。
- `pulls/[number]`：统一 diff 视图 + 右侧 AI 评论轨道（风险/建议/赞同/FAQ 分类），支持行内评论与"采纳/忽略"。

## 3. 功能模块划分

| 模块 | 说明 |
|------|------|
| **A. 身份与授权** | NextAuth 会话；GitHub / Gitee OAuth2；Provider 抽象；凭证安全存储 |
| **B. 数据摄取** | 双平台 API 客户端；仓库/分支/文件/提交/PR 数据同步到 Prisma |
| **C. 用户洞察** | commit 活跃度聚合；热力图；语言/时间段统计；贡献画像 |
| **D. 代码浏览** | 文件树遍历 + 内容拉取 + 语法高亮（缓存落库） |
| **E. PR 自动审查（核心）** | Webhook 订阅 `pull_request` 事件 → 提取变更 → 上下文构建 → 多模型审查 → 结构化评论 → 回写平台评论/状态 |
| **F. 审查配置** | 每仓库/全局：启用开关、模型选择、审查深度、规则（安全/性能/风格）、自定义 Prompt |
| **G. 历史与审计** | 审查记录、详情、重新审查、导出 |

## 4. 技术方案（保持 Next.js 全栈）

- **框架**：Next.js (App Router) + React + TypeScript（沿用现有）。
- **UI**：shadcn/ui + Tailwind，沿用现有组件库；整体按新设计系统重排。
- **鉴权**：`next-auth`（`Auth.js`），配 GitHub & Gitee Provider，JWT 会话 + `jose` 加密 token。
- **数据**：Prisma + Postgres 或 SQLite（取决于部署），新增 `Account / Repository / Branch / File / PullRequest / Review / ReviewComment / Webhook` 模型。
- **异步**：Webhook 用 `route.ts` + 队列（BullMQ 或轻量 `POST` 回调 + 乐观更新 + 轮询）；分析任务入库。
- **AI**：复用现有 `src/lib/models`（OpenAI / Anthropic / DeepSeek / Custom），通过 Provider 工厂路由。
- **部署**：Vercel（Webhook 用 Upsert + 队列）或自托管。

### Prisma 增量模型（草稿）
```prisma
model Account {
  id              String    @id @default(cuid())
  provider        String    // 'github' | 'gitee'
  providerUserId  String
  user            User      @relation(fields: [userId], references: [id])
  userId          String
  accessToken     String?
  refreshToken    String?
  email           String?
  avatarUrl       String?
  login           String?   // handle
  createdAt       DateTime  @default(now())
  @@unique([provider, providerUserId])
}

model Repository {
  id            String  @id @default(cuid())
  platform      String  // 'github' | 'gitee'
  providerId    String
  owner         String
  name          String
  isPrivate     Boolean @default(false)
  defaultBranch String?
  language      String?
  description   String?
  autoReview    Boolean @default(false)
  accounts      Account @relation(fields: [accountId], references: [id])
  accountId     String
  @@unique([platform, providerId])
}

model PullRequest {
  id          String   @id @default(cuid())
  number      Int
  repoId      String
  title       String
  state       String   // open | closed | merged
  headSha     String
  baseSha     String?
  diffUrl     String?
  reviews     Review[]
  @@unique([repoId, number])
}

model Review {
  id          String   @id @default(cuid())
  prId        String
  status      String   // queued | processing | done | failed
  model       String
  summary     String?
  comments    ReviewComment[]
  @relation(...)
}

model ReviewComment {
  id         String @id @default(cuid())
  reviewId   String
  file       String?
  line       Int?
  kind       String // concern | suggestion | positive | question
  severity   String // critical | warning | info
  body       String
  suggestion String?
  status     String // pending | accepted | dismissed
}
```

## 5. 自动化链路（核心闭环）

```
[GitHub/Gitee] PR 创建/更新
        │ Webhook(pull_request) 或定时扫描
        ▼
Webhook route → 验签 → 找到对应 Repository 与配置
        ▼
Enqueue ReviewJob（重试/超时）→ 拉取 PR diff + 上下文快照
        ▼
缓存命中外层 → 组装 Prompt（复用 src/lib/prompts）→ 模型路由
        ▼
解析结构化 JSON → 持久化 Review + ReviewComment
        ▼
回写：平台内评论轨道 + 可选在 PR 上以 bot 账号发表 review / 设置检验状态
```

失败处理：任务入队带重试与退避；失败保留原始报错供前端展示；支持手动"重新审查"。

## 6. 设计系统与视觉方向

沿用上一轮定的设计方向（详见原型），核心原则：
- 面向开发者的"精密仪表盘"气质，避免通用 SAAS 模板感。
- 仅一处强签名元素（hero 代码批注流光动画），其余克制。
- 深色优先（开发场景），语义色专用于 diff（增删/风险）。
- 字体：展示用 Space Grotesk、正文 Inter、等宽 JetBrains Mono。
- 动效：GSAP core + ScrollTrigger，尊重 `prefers-reduced-motion`。

## 7. 实施阶段

1. **P0 - 地基**：设计系统落地、通用组件、路由骨架、空态/加载态。
2. **P1 - 身份**：OAuth 双平台登录、会话、凭证加密、账户关联。
3. **P2 - 数据**：Platform 客户端抽象、仓库/PR/代码同步、用户活跃度聚合。
4. **P3 - 浏览**：仓库页、代码文件页、分支切换、语法高亮。
5. **P4 - 审查（核心）**：Webhook 收件、队列、diff 提取、上下文构建、多模型审查、评论渲染与采纳/忽略。
6. **P5 - 洞察**：热力图、统计图表（复用现有 chart.tsx）。
7. **P6 - 打磨**：历史审计、配置页、空态、无障碍、性能。

## 8. 风险与对策
- 第三方 API 限流 → 本地缓存 + 聚合入库 + 配额提示。
- Webhook 不可达（本地开发）→ fetch 接口兜底：提供"手动同步" + 定时任务。
- Token 安全 → 仅服务端使用、`.env` + `jose` 加密、过期刷新。
- 单 PR 审查延迟 → 队列异步、结果轮询/乐观 UI、可多模型并行。

---
*配套文件：`prototype/*.html` 为包含全部页面与功能的静态高保真原型（含 GSAP 动画），用于视觉定稿与评审。*